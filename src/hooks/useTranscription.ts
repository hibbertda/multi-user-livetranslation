import { useState, useCallback, useEffect, useRef } from 'react';
import type { ConversationTranscriber, TranslationRecognizer } from 'microsoft-cognitiveservices-speech-sdk';
import { createTranscriber, createTranslationRecognizer, fetchSpeechToken } from '../services/speechService';
import { translateText } from '../services/translatorService';
import type { Speaker, Utterance, DetectionMode, TranslationMode } from '../types';
import { SPEAKER_COLORS } from '../types';
import { LANGUAGE_POOL, toLanguageBase } from '../languages';
import { createId } from '../utils/id';
import { measureAsync, trackEvent } from '../utils/telemetry';

interface UseTranscriptionOptions {
  getToken: () => Promise<string>;
  mode: DetectionMode;
  translationMode: TranslationMode;
  languageA: string;
  languageB: string;
  deviceId?: string;
}

interface PendingTranslation {
  utteranceId: string;
  text: string;
  detectedLang: string;
}

const MAX_PENDING_TRANSLATIONS = 50;

export function pushWithBackpressure<T>(queue: T[], item: T, maxSize: number): boolean {
  let dropped = false;
  if (queue.length >= maxSize) {
    queue.shift();
    dropped = true;
  }
  queue.push(item);
  return dropped;
}

export function useTranscription({
  getToken,
  mode,
  translationMode,
  languageA,
  languageB,
  deviceId,
}: UseTranscriptionOptions) {
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [speakers, setSpeakers] = useState<Map<string, Speaker>>(new Map());
  const [isListening, setIsListening] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [queueDepth, setQueueDepth] = useState(0);
  const [droppedTranslations, setDroppedTranslations] = useState(0);

  const transcriberRef = useRef<ConversationTranscriber | null>(null);
  const translationRecognizerRef = useRef<TranslationRecognizer | null>(null);
  const pendingRealtimeIdRef = useRef<string | null>(null);
  const speakerCountRef = useRef(0);
  const speakersRef = useRef<Map<string, Speaker>>(new Map());
  const translationQueueRef = useRef<PendingTranslation[]>([]);
  const isProcessingQueueRef = useRef(false);

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  const getTargetLanguages = useCallback((detectedLang: string): string[] => {
    if (mode === 'specify') {
      const fromLangBase = toLanguageBase(detectedLang);
      const languageABase = toLanguageBase(languageA);
      return fromLangBase === languageABase ? [languageB] : [languageA];
    }

    const fromLangBase = toLanguageBase(detectedLang);
    return [
      ...new Set(
        LANGUAGE_POOL
          .map((language) => toLanguageBase(language.code))
          .filter((languageBase) => languageBase !== fromLangBase),
      ),
    ];
  }, [languageA, languageB, mode]);

  const applyTranslations = useCallback((utteranceId: string, translatedTexts: Record<string, string>) => {
    setUtterances((prev) => prev.map((utterance) => {
      if (utterance.id !== utteranceId) return utterance;
      return {
        ...utterance,
        translatedTexts,
      };
    }));
  }, []);

  const processTranslationQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    try {
      while (translationQueueRef.current.length > 0) {
        const pending = translationQueueRef.current.shift();
        setQueueDepth(translationQueueRef.current.length);
        if (!pending) continue;

        const targetLanguages = getTargetLanguages(pending.detectedLang);
        if (targetLanguages.length === 0) {
          continue;
        }

        try {
          const token = await getToken();
          const result = await measureAsync(
            'translation.request',
            () => translateText(
              token,
              pending.text,
              toLanguageBase(pending.detectedLang),
              targetLanguages,
            ),
            {
              targetCount: targetLanguages.length,
            },
          );

          const translatedTexts: Record<string, string> = {};
          for (const translation of result.translations) {
            translatedTexts[translation.to] = translation.text;
          }
          applyTranslations(pending.utteranceId, translatedTexts);
        } catch (error) {
          setLastError('Translation request failed for one or more utterances.');
          trackEvent('translation.failure', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      isProcessingQueueRef.current = false;
    }
  }, [applyTranslations, getTargetLanguages, getToken]);

  const enqueueTranslation = useCallback((item: PendingTranslation) => {
    if (pushWithBackpressure(translationQueueRef.current, item, MAX_PENDING_TRANSLATIONS)) {
      setDroppedTranslations((prev) => prev + 1);
      trackEvent('translation.backpressure_drop', {
        maxDepth: MAX_PENDING_TRANSLATIONS,
      });
    }

    setQueueDepth(translationQueueRef.current.length);
    void processTranslationQueue();
  }, [processTranslationQueue]);

  const getOrCreateSpeaker = useCallback(
    (speakerId: string, detectedLang: string): Speaker => {
      const existing = speakersRef.current.get(speakerId);
      if (existing) return existing;

      const index = speakerCountRef.current++;
      const speaker: Speaker = {
        id: speakerId,
        label: `Speaker ${index + 1}`,
        language: detectedLang,
        color: SPEAKER_COLORS[index % SPEAKER_COLORS.length],
      };
      speakersRef.current.set(speakerId, speaker);
      setSpeakers(new Map(speakersRef.current));
      return speaker;
    },
    [],
  );

  const updateSpeakerLabel = useCallback(
    (speakerId: string, label: string) => {
      const speaker = speakersRef.current.get(speakerId);
      if (speaker) {
        speaker.label = label;
        speakersRef.current.set(speakerId, speaker);
        setSpeakers(new Map(speakersRef.current));
        setUtterances((prev) =>
          prev.map((u) =>
            u.speakerId === speakerId ? { ...u, speakerLabel: label } : u,
          ),
        );
      }
    },
    [],
  );

  const start = useCallback(async () => {
    clearError();

    const token = await getToken();
    const speechToken = await fetchSpeechToken(token);

    const languageCodes =
      mode === 'specify'
        ? [languageA, languageB]
        : LANGUAGE_POOL.map((l) => l.code);

    if (translationMode === 'realtime') {
      // ---- Real-time translation via TranslationRecognizer ----
      const targetLangs = mode === 'specify'
        ? [toLanguageBase(languageA), toLanguageBase(languageB)]
        : [...new Set(LANGUAGE_POOL.map((l) => toLanguageBase(l.code)))];

      const recognizer = createTranslationRecognizer(
        speechToken,
        languageCodes,
        targetLangs,
        deviceId,
      );
      translationRecognizerRef.current = recognizer;

      // Partial results — upsert a pending utterance with latest text + translations
      recognizer.recognizing = (_sender, event) => {
        const text = event.result.text;
        if (!text) return;

        const detectedLang =
          event.result.language || (mode === 'specify' ? languageA : 'en-US');

        const translatedTexts: Record<string, string> = {};
        const translations = event.result.translations;
        if (translations) {
          for (const lang of translations.languages) {
            translatedTexts[lang] = translations.get(lang, '');
          }
        }

        let pendingId = pendingRealtimeIdRef.current;
        if (!pendingId) {
          pendingId = createId();
          pendingRealtimeIdRef.current = pendingId;
          const speaker = getOrCreateSpeaker('realtime', detectedLang);
          const utterance: Utterance = {
            id: pendingId,
            speakerId: 'realtime',
            speakerLabel: speaker.label,
            originalText: text,
            translatedTexts,
            detectedLanguage: detectedLang,
            timestamp: Date.now(),
          };
          setUtterances((prev) => [...prev, utterance]);
        } else {
          // Update the existing pending utterance in place
          setUtterances((prev) =>
            prev.map((u) =>
              u.id === pendingId
                ? { ...u, originalText: text, translatedTexts, detectedLanguage: detectedLang }
                : u,
            ),
          );
        }
      };

      // Final result — finalize the pending utterance and clear the pending ID
      recognizer.recognized = (_sender, event) => {
        const text = event.result.text;
        if (!text) {
          pendingRealtimeIdRef.current = null;
          return;
        }

        const detectedLang =
          event.result.language || (mode === 'specify' ? languageA : 'en-US');

        const translatedTexts: Record<string, string> = {};
        const translations = event.result.translations;
        if (translations) {
          for (const lang of translations.languages) {
            translatedTexts[lang] = translations.get(lang, '');
          }
        }

        const pendingId = pendingRealtimeIdRef.current;
        if (pendingId) {
          // Finalize existing pending utterance
          setUtterances((prev) =>
            prev.map((u) =>
              u.id === pendingId
                ? { ...u, originalText: text, translatedTexts, detectedLanguage: detectedLang }
                : u,
            ),
          );
        } else {
          // No pending — add as new finalized utterance
          const speaker = getOrCreateSpeaker('realtime', detectedLang);
          setUtterances((prev) => [
            ...prev,
            {
              id: createId(),
              speakerId: 'realtime',
              speakerLabel: speaker.label,
              originalText: text,
              translatedTexts,
              detectedLanguage: detectedLang,
              timestamp: Date.now(),
            },
          ]);
        }
        pendingRealtimeIdRef.current = null;
      };

      recognizer.canceled = (_sender, event) => {
        setLastError(`Translation canceled: ${event.errorDetails || 'unknown error'}`);
        trackEvent('translation_recognizer.canceled', { error: event.errorDetails });
        setIsListening(false);
      };

      try {
        await new Promise<void>((resolve, reject) => {
          recognizer.startContinuousRecognitionAsync(
            () => {
              trackEvent('translation_recognizer.start.success');
              resolve();
            },
            (err: string) => {
              trackEvent('translation_recognizer.start.failure', { error: err });
              reject(new Error(err));
            },
          );
        });
        setIsListening(true);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : 'Failed to start real-time translation.');
        translationRecognizerRef.current = null;
        throw err;
      }
    } else {
      // ---- Standard mode: ConversationTranscriber + Translator API ----
      const transcriber = createTranscriber(speechToken, languageCodes, deviceId);
      transcriberRef.current = transcriber;

      transcriber.transcribed = (_sender, event) => {
        const text = event.result.text;
        if (!text) return;

        const speakerId = event.result.speakerId || 'Unknown';
        const detectedLang =
          event.result.language || (mode === 'specify' ? languageA : 'en-US');

        const speaker = getOrCreateSpeaker(speakerId, detectedLang);

        const utterance: Utterance = {
          id: createId(),
          speakerId,
          speakerLabel: speaker.label,
          originalText: text,
          translatedTexts: {},
          detectedLanguage: detectedLang,
          timestamp: Date.now(),
        };

        setUtterances((prev) => [...prev, utterance]);
        enqueueTranslation({
          utteranceId: utterance.id,
          text,
          detectedLang,
        });
      };

      transcriber.canceled = (_sender, event) => {
        setLastError(`Transcription canceled: ${event.errorDetails || 'unknown error'}`);
        trackEvent('transcription.canceled', {
          error: event.errorDetails,
        });
        setIsListening(false);
      };

      transcriber.sessionStarted = () => {
        trackEvent('transcription.session_started');
      };

      try {
        await new Promise<void>((resolve, reject) => {
          transcriber.startTranscribingAsync(
            () => {
              trackEvent('transcription.start.success');
              resolve();
            },
            (err: string) => {
              trackEvent('transcription.start.failure', { error: err });
              reject(new Error(err));
            },
          );
        });
        setIsListening(true);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : 'Failed to start transcription.');
        transcriberRef.current = null;
        throw err;
      }
    }
  }, [clearError, deviceId, enqueueTranslation, getOrCreateSpeaker, getToken, languageA, languageB, mode, translationMode]);

  const stopInternal = useCallback(async () => {
    if (transcriberRef.current) {
      await new Promise<void>((resolve) => {
        transcriberRef.current!.stopTranscribingAsync(
          () => resolve(),
          () => resolve(),
        );
      });
      transcriberRef.current.close();
      transcriberRef.current = null;
    }
    if (translationRecognizerRef.current) {
      await new Promise<void>((resolve) => {
        translationRecognizerRef.current!.stopContinuousRecognitionAsync(
          () => resolve(),
          () => resolve(),
        );
      });
      translationRecognizerRef.current.close();
      translationRecognizerRef.current = null;
    }
    pendingRealtimeIdRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    try {
      await stopInternal();
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Unable to stop transcription.');
      throw error;
    }
    setIsListening(false);
  }, [stopInternal]);

  useEffect(() => {
    return () => {
      void stopInternal();
    };
  }, [stopInternal]);

  const clearTranscript = useCallback(() => {
    setUtterances([]);
    setSpeakers(new Map());
    speakersRef.current = new Map();
    speakerCountRef.current = 0;
    translationQueueRef.current = [];
    setQueueDepth(0);
    setDroppedTranslations(0);
  }, []);

  return {
    utterances,
    speakers,
    isListening,
    start,
    stop,
    clearTranscript,
    updateSpeakerLabel,
    lastError,
    clearError,
    queueDepth,
    droppedTranslations,
  };
}
