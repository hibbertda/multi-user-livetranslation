import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTranscription } from '../hooks/useTranscription';
import { useHostSession } from '../hooks/useHostSession';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useMicrophoneList } from '../hooks/useMicrophoneList';
import { useTranscriptExport } from '../hooks/useTranscriptExport';
import { ConversationPanel } from './ConversationPanel';
import { LanguageSelector } from './LanguageSelector';
import { MicrophoneSelector } from './MicrophoneSelector';
import { SaveControls } from './SaveControls';
import { InviteModal } from './InviteModal';
import type { DetectionMode, TranslationMode, SessionRecord } from '../types';
import { getLanguageLabel } from '../languages';

import { useAudioRecorder } from '../hooks/useAudioRecorder';
import {
  createSessionRecord,
  endSessionRecord,
  resumeSessionRecord,
  uploadSessionAudio,
  createDebouncedUpdater,
} from '../services/sessionStoreService';

interface SessionPanelProps {
  resumeRecord?: SessionRecord | null;
  onResumeHandled?: () => void;
  translationMode: TranslationMode;
  onTranslationModeChange: (mode: TranslationMode) => void;
  microphoneDeviceId: string;
  onMicrophoneChange: (deviceId: string) => void;
}

export function SessionPanel({ resumeRecord, onResumeHandled, translationMode, onTranslationModeChange, microphoneDeviceId, onMicrophoneChange }: SessionPanelProps) {
  const { getToken, account } = useAuth();
  const { devices, selectedDeviceId } = useMicrophoneList();
  const { speak } = useSpeechSynthesis(getToken);
  const { exportAsJson, exportAsText } = useTranscriptExport();

  const mode: DetectionMode = 'specify';
  const [languageA, setLanguageA] = useState('en-US');
  const [languageB, setLanguageB] = useState('ar-SA');
  const [hostDisplayLanguage, setHostDisplayLanguage] = useState('en-US');
  const [showInvite, setShowInvite] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');

  const effectiveDeviceId = microphoneDeviceId || selectedDeviceId;

  const {
    utterances,
    speakers,
    isListening,
    start,
    stop,
    clearTranscript,
    lastError: transcriptionError,
    clearError: clearTranscriptionError,
  } = useTranscription({ getToken, mode, translationMode, languageA, languageB, deviceId: effectiveDeviceId });

  const { isRecording, startRecording, stopRecording, saveRecording } = useAudioRecorder(effectiveDeviceId);

  const {
    session,
    guests,
    connectionStatus,
    createSession,
    resumeSession,
    endSession,
    inviteUrl,
    broadcastUtterance,
    broadcastUtteranceUpdate,
  } = useHostSession();

  // Handle resume from history
  const resumeHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (resumeRecord && !session && resumeHandledRef.current !== resumeRecord.id) {
      resumeHandledRef.current = resumeRecord.id;
      const restoredSession = {
        id: resumeRecord.id,
        token: resumeRecord.token,
        hostName: resumeRecord.hostName,
        createdAt: resumeRecord.startedAt,
        languageA: resumeRecord.languageA,
        languageB: resumeRecord.languageB,
        title: resumeRecord.title,
      };
      setLanguageA(resumeRecord.languageA);
      setLanguageB(resumeRecord.languageB);
      setHostDisplayLanguage(resumeRecord.languageA);
      setSessionTitle(resumeRecord.title);
      resumeSession(restoredSession);
      // Await the resume PATCH so the session status is 'active' before
      // the guest can negotiate (otherwise negotiate returns 410).
      void resumeSessionRecord(resumeRecord.id).then(() => {
        setShowInvite(true);
      });
      onResumeHandled?.();
    }
  }, [resumeRecord, session, resumeSession, onResumeHandled]);

  // Track what we've already broadcast to avoid duplicates
  const lastBroadcastCountRef = useRef(0);
  const broadcastedTranslationsRef = useRef(new Map<string, number>());

  // Broadcast new utterances when they appear (override speaker to host name)
  useEffect(() => {
    if (!session) return;
    if (utterances.length > lastBroadcastCountRef.current) {
      const newOnes = utterances.slice(lastBroadcastCountRef.current);
      const name = account?.name ?? account?.username ?? 'Host';
      for (const u of newOnes) {
        broadcastUtterance({ ...u, speakerLabel: name });
      }
      lastBroadcastCountRef.current = utterances.length;
    }
  }, [session, utterances, broadcastUtterance, account]);

  // Broadcast translation updates
  useEffect(() => {
    if (!session) return;
    for (const u of utterances) {
      const translationCount = Object.keys(u.translatedTexts).length;
      const lastCount = broadcastedTranslationsRef.current.get(u.id) ?? 0;
      if (translationCount > lastCount) {
        broadcastUtteranceUpdate(u.id, u.translatedTexts);
        broadcastedTranslationsRef.current.set(u.id, translationCount);
      }
    }
  }, [session, utterances, broadcastUtteranceUpdate]);

  const clearError = useCallback(() => {
    setUiError(null);
    clearTranscriptionError();
  }, [clearTranscriptionError]);

  const activeError = uiError ?? transcriptionError;

  const debouncedUpdaterRef = useRef<ReturnType<typeof createDebouncedUpdater> | null>(null);

  const handleStartSession = useCallback(() => {
    const hostName = account?.name ?? account?.username ?? 'Host';
    createSession(hostName, languageA, languageB);
    setShowInvite(true);
  }, [account, createSession, languageA, languageB]);

  // Persist session record to Cosmos DB when a NEW session starts (skip for resumed)
  const isResumedRef = useRef(false);
  useEffect(() => {
    if (!session) {
      isResumedRef.current = false;
      return;
    }
    // If this session was triggered by resume, don't create a new record
    if (resumeHandledRef.current === session.id) {
      isResumedRef.current = true;
    }
    if (isResumedRef.current) {
      debouncedUpdaterRef.current = createDebouncedUpdater(session.id);
      return;
    }
    const title = sessionTitle.trim() || `Session ${new Date(session.createdAt).toLocaleDateString()}`;
    const record: SessionRecord = {
      id: session.id,
      token: session.token,
      title,
      hostName: session.hostName,
      hostEmail: account?.username,
      languageA: session.languageA,
      languageB: session.languageB,
      guests: [],
      utteranceCount: 0,
      startedAt: session.createdAt,
      status: 'active',
    };
    void createSessionRecord(record);
    debouncedUpdaterRef.current = createDebouncedUpdater(session.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // Debounced utterance count updates
  useEffect(() => {
    if (session && debouncedUpdaterRef.current && utterances.length > 0) {
      debouncedUpdaterRef.current.update({ utteranceCount: utterances.length });
    }
  }, [session, utterances.length]);

  const handleEndSession = useCallback(() => {
    if (session) {
      debouncedUpdaterRef.current?.flush();
      // Fire-and-forget: mark session as ended, include transcript
      void endSessionRecord(session.id, utterances.length, guests, utterances);

      // Upload audio if we were recording
      if (isRecording) {
        void (async () => {
          const blob = await stopRecording();
          if (blob.size > 0) {
            void uploadSessionAudio(session.id, blob);
          }
        })();
      }
    }
    endSession();
  }, [endSession, session, utterances.length, guests, isRecording, stopRecording]);

  const handleStartListening = useCallback(async () => {
    clearError();
    try {
      await start();
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Unable to start transcription.');
    }
  }, [clearError, start]);

  const handleStopListening = useCallback(async () => {
    try {
      await stop();
    } catch (error) {
      setUiError(error instanceof Error ? error.message : 'Unable to stop transcription.');
    }
  }, [stop]);

  // Auto-start listening when a guest connects
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (session && guests.length > 0 && !isListening && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void handleStartListening();
    }
  }, [session, guests.length, isListening, handleStartListening]);

  // Reset auto-start flag when session ends
  useEffect(() => {
    if (!session) autoStartedRef.current = false;
  }, [stop]);

  // In session mode, all local utterances belong to the host.
  // Override speaker labels so there's one fixed identity per side.
  const hostName = account?.name ?? account?.username ?? 'Host';
  const sessionSpeakers = new Map(speakers);
  for (const [id, speaker] of sessionSpeakers) {
    sessionSpeakers.set(id, { ...speaker, label: hostName });
  }

  return (
    <div className="session-panel">
      {activeError && (
        <div className="app-alert" role="alert">
          <span>{activeError}</span>
          <button type="button" className="app-alert-close" onClick={clearError}>Dismiss</button>
        </div>
      )}

      {!session ? (
        <div className="session-setup">
          <div className="session-setup-card">
            <h2>Start a Shared Session</h2>
            <p>Create a session and invite someone to join from their phone. They&apos;ll see the live translation in their chosen language.</p>

            <div className="session-title-field">
              <label htmlFor="session-title">Session Title</label>
              <input
                id="session-title"
                type="text"
                className="session-title-input"
                placeholder="e.g. Patient intake — Dr. Smith"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
              />
            </div>

            <hr className="setup-divider" />

            <div className="settings-section">
              <label className="settings-label">Primary Language Detection</label>
              <LanguageSelector
                mode={mode}
                languageA={languageA}
                languageB={languageB}
                onModeChange={() => {}}
                onLanguageAChange={setLanguageA}
                onLanguageBChange={setLanguageB}
                disabled={false}
                hideMode
              />
            </div>

            <hr className="setup-divider" />

            <div className="settings-section">
              <label className="settings-label">Microphone</label>
              <MicrophoneSelector
                devices={devices}
                selectedDeviceId={effectiveDeviceId}
                onSelect={onMicrophoneChange}
                disabled={false}
              />
            </div>

            <hr className="setup-divider" />

            <div className="settings-section">
              <label className="settings-label">Translation Speed</label>
              <div className="translation-mode-toggle">
                <button
                  className={`translation-mode-btn ${translationMode === 'standard' ? 'translation-mode-btn--active' : ''}`}
                  onClick={() => onTranslationModeChange('standard')}
                >
                  Standard
                </button>
                <button
                  className={`translation-mode-btn ${translationMode === 'realtime' ? 'translation-mode-btn--active' : ''}`}
                  onClick={() => onTranslationModeChange('realtime')}
                >
                  Real-time
                </button>
              </div>
              <p className="settings-hint">
                {translationMode === 'standard'
                  ? 'Waits for full sentences, then translates. Best quality.'
                  : 'Translates word-by-word as you speak. Faster but may shift as context builds.'}
              </p>
            </div>

            <button className="session-start-btn" onClick={handleStartSession}>
              Start Session
            </button>
          </div>
        </div>
      ) : (
        <div className="session-active">
          {/* Session status bar */}
          <div className="session-status-bar">
            <div className="session-status-info">
              <span className={`session-status-dot session-status-dot--${connectionStatus}`} />
              <span className="session-status-label">
                {session.title ?? (connectionStatus === 'connected' ? 'Session Active' : connectionStatus)}
              </span>
              {guests.length > 0 && (
                <span className="session-guest-count">
                  {guests.map((g) => g.name).join(', ')} connected
                </span>
              )}
            </div>
            <div className="session-status-actions">
              <button
                className={`session-listening-badge ${isListening ? 'session-listening-badge--active' : 'session-listening-badge--idle'}`}
                onClick={() => { if (isListening) void handleStopListening(); else void handleStartListening(); }}
                title={isListening ? 'Click to pause' : 'Click to start listening'}
              >
                <span className="session-listening-badge-dot" />
                {isListening ? 'Listening' : guests.length === 0 ? 'Waiting for guest…' : 'Paused'}
              </button>
              <button
                className="session-invite-btn"
                onClick={() => setShowInvite(true)}
              >
                Invite
              </button>
              <button className="session-end-btn" onClick={handleEndSession}>
                End Session
              </button>
            </div>
          </div>

          {/* Settings row */}
          <div className="session-settings-row">
            <label className="session-display-lang">
              <span>Display:</span>
              <select
                value={hostDisplayLanguage}
                onChange={(e) => setHostDisplayLanguage(e.target.value)}
              >
                <option value={languageA}>{getLanguageLabel(languageA)}</option>
                <option value={languageB}>{getLanguageLabel(languageB)}</option>
              </select>
            </label>
            <SaveControls
              isRecording={isRecording}
              onStartRecording={() => void startRecording()}
              onSaveRecording={() => void saveRecording()}
              onExportJson={exportAsJson}
              onExportText={exportAsText}
              utterances={utterances}
              speakers={speakers}
            />
            <button
              className="clear-btn"
              onClick={clearTranscript}
              disabled={utterances.length === 0}
            >
              Clear Transcript
            </button>
          </div>

          {/* Conversation display - single language */}
          <div className="session-conversation session-conversation--single">
            <ConversationPanel
              utterances={utterances}
              speakers={sessionSpeakers}
              displayLanguage={hostDisplayLanguage}
              title={getLanguageLabel(hostDisplayLanguage)}
              onSpeak={speak}
            />
          </div>


        </div>
      )}

      {showInvite && inviteUrl && (
        <InviteModal inviteUrl={inviteUrl} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}
