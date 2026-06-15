import { useState, useRef, useEffect } from 'react';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { fetchSpeechToken } from '../services/speechService';
import { translateText } from '../services/translatorService';
import { config } from '../config';
import {
  ALL_LID_LANGUAGES,
  DEFAULT_LID_CODES,
  LANGUAGE_POOL,
  lookupLanguageDisplay,
} from '../languages';
import { trackEvent } from '../utils/telemetry';

interface TimedWord {
  word: string;
  offsetSec: number;
  durationSec: number;
}

interface Props {
  getToken: () => Promise<string>;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

export function AudioIdentify({ getToken }: Props) {
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ flag: string; name: string; code: string } | null>(null);
  const [originalText, setOriginalText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadedFileRef = useRef<File | null>(null);

  // Full transcription state
  // LID controls state
  const [lidMode, setLidMode] = useState<'default' | 'at-start' | 'continuous'>('default');
  const [selectedLangs, setSelectedLangs] = useState<string[]>([]);
  const [skipSeconds, setSkipSeconds] = useState(0);

  // Full transcription state
  const [fullTranscribing, setFullTranscribing] = useState(false);
  const [timedWords, setTimedWords] = useState<TimedWord[]>([]);
  const [fullTranslated, setFullTranslated] = useState('');
  const [activeWordIdx, setActiveWordIdx] = useState(-1);
  const audioRef = useRef<HTMLAudioElement>(null);

  const maxCandidates = lidMode === 'at-start' ? 4 : 10;
  const effectiveCandidates =
    lidMode === 'default'
      ? LANGUAGE_POOL.map((l) => l.code)
      : selectedLangs;

  useEffect(() => {
    if (status === 'processing') {
      timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  async function handleFile(file: File) {
    if (lidMode !== 'default' && selectedLangs.length === 0) return;
    setElapsed(0);
    setFileName(file.name);
    setStatus('processing');
    setResult(null);
    setOriginalText('');
    setTranslatedText('');
    setErrorMsg('');

    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(file));
    uploadedFileRef.current = file;

    try {
      const startedAt = performance.now();
      const entraToken = await getToken();
      const speechToken = await fetchSpeechToken(entraToken);

      // Decode audio to PCM using Web Audio API and clip to first 30s
      const fileBuffer = await file.arrayBuffer();
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const decoded = await audioCtx.decodeAudioData(fileBuffer);
      const skipSamples = 16000 * skipSeconds;
      const maxSamples = 16000 * 30; // 30 seconds at 16kHz
      const channelData = decoded.getChannelData(0);
      const samples = channelData.slice(skipSamples, skipSamples + maxSamples);
      audioCtx.close();

      // Convert to 16-bit PCM WAV
      const wavBuffer = encodeWav(samples, 16000);

      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
        speechToken,
        config.speechRegion,
      );

      // Set LID mode
      if (lidMode !== 'at-start') {
        speechConfig.setProperty(
          'SpeechServiceConnection_LanguageIdMode',
          'Continuous',
        );
      }

      const candidateCodes = effectiveCandidates;
      trackEvent('identify.start', {
        lidMode,
        candidateCount: candidateCodes.length,
        skipSeconds,
      });
      const autoDetectConfig =
        SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(candidateCodes);

      const pushStream = SpeechSDK.AudioInputStream.createPushStream(
        SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1),
      );
      pushStream.write(wavBuffer.slice(44)); // skip WAV header, send raw PCM
      pushStream.close();

      const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);

      const recognizer = SpeechSDK.SpeechRecognizer.FromConfig(
        speechConfig,
        autoDetectConfig,
        audioConfig,
      );

      // Shared handler for a recognition result
      function handleRecognitionResult(resultObj: SpeechSDK.SpeechRecognitionResult) {
        const langResult =
          SpeechSDK.AutoDetectSourceLanguageResult.fromResult(resultObj);
        const detected = langResult.language;
        trackEvent('identify.result', {
          detectedLanguage: detected,
          durationMs: Math.round(performance.now() - startedAt),
        });

        if (detected && detected !== 'Unknown') {
          const spokenText = resultObj.text;
          setOriginalText(spokenText);
          setResult(lookupLanguageDisplay(detected));

          const detectedBase = detected.split('-')[0];
          if (detectedBase !== 'en' && spokenText) {
            getToken()
              .then((token) => translateText(token, spokenText, detectedBase, ['en']))
              .then((tr) => {
                const eng = tr.translations.find((t) => t.to === 'en');
                setTranslatedText(eng?.text ?? '');
                setStatus('done');
              })
              .catch((err) => {
                trackEvent('identify.translation.failure', {
                  error: err instanceof Error ? err.message : String(err),
                });
                setTranslatedText('(translation unavailable)');
                setStatus('done');
              });
          } else {
            setTranslatedText(spokenText);
            setStatus('done');
          }
        } else {
          setErrorMsg('Could not identify the language. Try a longer or clearer clip.');
          setStatus('error');
        }
      }

      if (lidMode === 'at-start') {
        // At-start LID: recognizeOnceAsync (up to 4 candidates)
        recognizer.recognizeOnceAsync(
          (resultObj) => {
            recognizer.close();
            if (resultObj.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
              handleRecognitionResult(resultObj);
            } else {
              setErrorMsg('Could not identify the language. Try a longer or clearer clip.');
              setStatus('error');
            }
          },
          (err) => {
            recognizer.close();
            trackEvent('identify.recognize_once.failure', {
              error: String(err),
            });
            setErrorMsg(String(err));
            setStatus('error');
          },
        );
      } else {
        // Continuous LID: startContinuousRecognitionAsync (up to 10 candidates)
        recognizer.recognized = (_sender, e) => {
          if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            recognizer.stopContinuousRecognitionAsync(() => {
              recognizer.close();
            });
            handleRecognitionResult(e.result);
          }
        };

        recognizer.canceled = (_sender, e) => {
          trackEvent('identify.canceled', {
            reason: SpeechSDK.CancellationReason[e.reason],
            error: e.errorDetails,
          });
          recognizer.stopContinuousRecognitionAsync(() => {
            recognizer.close();
          });
          if (e.reason === SpeechSDK.CancellationReason.EndOfStream) {
            if (!result) {
              setErrorMsg('Could not identify the language. Try a longer or clearer clip.');
              setStatus('error');
            }
          } else {
            setErrorMsg(`Recognition canceled: ${e.errorDetails || SpeechSDK.CancellationReason[e.reason]}`);
            setStatus('error');
          }
        };

        recognizer.startContinuousRecognitionAsync(
          () => {
            trackEvent('identify.continuous.started');
          },
          (err) => {
            trackEvent('identify.continuous.start_failure', {
              error: String(err),
            });
            recognizer.close();
            setErrorMsg(String(err));
            setStatus('error');
          },
        );
      }
    } catch (err) {
      trackEvent('identify.failure', {
        error: err instanceof Error ? err.message : String(err),
      });
      setErrorMsg(String(err));
      setStatus('error');
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleReset() {
    setStatus('idle');
    setResult(null);
    setOriginalText('');
    setTranslatedText('');
    setErrorMsg('');
    setFileName('');
    setTimedWords([]);
    setFullTranslated('');
    setActiveWordIdx(-1);
    setFullTranscribing(false);
    uploadedFileRef.current = null;
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFullTranscription() {
    if (!uploadedFileRef.current || !result) return;
    setFullTranscribing(true);
    setTimedWords([]);
    setFullTranslated('');
    setActiveWordIdx(-1);

    try {
      const entraToken = await getToken();
      const speechToken = await fetchSpeechToken(entraToken);

      const fileBuffer = await uploadedFileRef.current.arrayBuffer();
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const decoded = await audioCtx.decodeAudioData(fileBuffer);
      const samples = decoded.getChannelData(0);
      audioCtx.close();

      const wavBuffer = encodeWav(samples, 16000);

      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
        speechToken,
        config.speechRegion,
      );
      speechConfig.setProperty(
        'SpeechServiceConnection_LanguageIdMode',
        'Continuous',
      );
      speechConfig.requestWordLevelTimestamps();
      speechConfig.speechRecognitionLanguage = result.code;

      const candidateCodes = LANGUAGE_POOL.map((l) => l.code);
      const autoDetectConfig =
        SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(candidateCodes);

      const pushStream = SpeechSDK.AudioInputStream.createPushStream(
        SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1),
      );
      pushStream.write(wavBuffer.slice(44));
      pushStream.close();

      const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
      const recognizer = SpeechSDK.SpeechRecognizer.FromConfig(
        speechConfig,
        autoDetectConfig,
        audioConfig,
      );

      const allWords: TimedWord[] = [];
      const allTexts: string[] = [];

      recognizer.recognized = (_sender, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
          allTexts.push(e.result.text);

          // Extract word-level timestamps from the detailed JSON
          try {
            const json = JSON.parse(
              e.result.properties.getProperty(
                SpeechSDK.PropertyId.SpeechServiceResponse_JsonResult,
              ),
            );
            const words = json?.NBest?.[0]?.Words;
            if (Array.isArray(words)) {
              for (const w of words) {
                allWords.push({
                  word: w.Word,
                  offsetSec: w.Offset / 10_000_000,
                  durationSec: w.Duration / 10_000_000,
                });
              }
            }
          } catch {
            // If word-level parsing fails, still collect text
            trackEvent('identify.full_transcribe.word_parse_failed');
          }
        }
      };

      recognizer.canceled = () => {
        recognizer.stopContinuousRecognitionAsync(() => {
          recognizer.close();
        });

        const fullText = allTexts.join(' ');
        setTimedWords(allWords);
        trackEvent('identify.full_transcribe.completed', {
          segmentCount: allTexts.length,
          wordCount: allWords.length,
        });

        // Translate full text
        const detectedBase = result.code.split('-')[0];
        if (detectedBase !== 'en' && fullText) {
          getToken()
            .then((token) => translateText(token, fullText, detectedBase, ['en']))
            .then((tr) => {
              const eng = tr.translations.find((t) => t.to === 'en');
              setFullTranslated(eng?.text ?? '');
              setFullTranscribing(false);
            })
            .catch(() => {
              setFullTranslated('(translation unavailable)');
              setFullTranscribing(false);
            });
        } else {
          setFullTranslated(fullText);
          setFullTranscribing(false);
        }
      };

      recognizer.startContinuousRecognitionAsync();
    } catch (err) {
      trackEvent('identify.full_transcribe.failure', {
        error: err instanceof Error ? err.message : String(err),
      });
      setFullTranscribing(false);
    }
  }

  function handleTimeUpdate() {
    if (!audioRef.current || timedWords.length === 0) return;
    const t = audioRef.current.currentTime;
    const idx = timedWords.findIndex(
      (w) => t >= w.offsetSec && t < w.offsetSec + w.durationSec,
    );
    setActiveWordIdx(idx);
  }

  function toggleLang(locale: string) {
    setSelectedLangs((prev) => {
      if (prev.includes(locale)) return prev.filter((l) => l !== locale);
      if (prev.length >= maxCandidates) return prev;
      return [...prev, locale];
    });
  }

  function handleModeChange(mode: 'default' | 'at-start' | 'continuous') {
    setLidMode(mode);
    if (mode === 'default') {
      setSelectedLangs([]);
    } else {
      // Trim selection if switching from continuous (10) to at-start (4)
      const max = mode === 'at-start' ? 4 : 10;
      setSelectedLangs((prev) => prev.slice(0, max));
    }
  }

  return (
    <div className="audio-identify">
      {status === 'idle' && (
        <>
          <div className="identify-upload-row">
            <div
              className="audio-dropzone"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
              <div className="dropzone-icon">🎤</div>
              <p className="dropzone-text">Drop an audio file here or click to browse</p>
              <p className="dropzone-hint">Supports WAV, MP3, M4A, WebM, OGG, etc.</p>
            </div>

            <div className="lid-controls">
              <h3 className="lid-controls-title">Detection Mode</h3>
              <div className="lid-mode-buttons">
                {(['default', 'at-start', 'continuous'] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`lid-mode-btn ${lidMode === mode ? 'lid-mode-btn--active' : ''}`}
                    onClick={() => handleModeChange(mode)}
                  >
                    {mode === 'default' ? 'Default' : mode === 'at-start' ? 'At-start' : 'Continuous'}
                  </button>
                ))}
              </div>
              <p className="lid-mode-desc">
                {lidMode === 'default' && `Uses the ${LANGUAGE_POOL.length} pre-selected languages with Continuous LID.`}
                {lidMode === 'at-start' && 'Identifies the language once from the first few seconds. Up to 4 candidates. Skip past intros/music with the offset below.'}
                {lidMode === 'continuous' && 'Identifies languages throughout the audio. Up to 10 candidates.'}
              </p>

              <div className="lid-skip-control">
                <label className="lid-skip-label" htmlFor="skip-seconds">
                  Skip first
                </label>
                <input
                  id="skip-seconds"
                  type="number"
                  className="lid-skip-input"
                  min={0}
                  max={300}
                  value={skipSeconds}
                  onChange={(e) => setSkipSeconds(Math.max(0, Number(e.target.value)))}
                />
                <span className="lid-skip-unit">seconds</span>
              </div>

              {lidMode !== 'default' && (
                <div className="lid-lang-picker">
                  <div className="lid-lang-picker-header">
                    <span className="lid-lang-picker-label">
                      Languages ({selectedLangs.length}/{maxCandidates})
                    </span>
                    {selectedLangs.length > 0 && (
                      <button
                        className="lid-lang-clear"
                        onClick={() => setSelectedLangs([])}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="lid-lang-list">
                    {ALL_LID_LANGUAGES.map((lang) => {
                      const info = lookupLanguageDisplay(lang.locale);
                      const isSelected = selectedLangs.includes(lang.locale);
                      const isDisabled = !isSelected && selectedLangs.length >= maxCandidates;
                      return (
                        <button
                          key={lang.locale}
                          className={`lid-lang-chip ${isSelected ? 'lid-lang-chip--selected' : ''} ${isDisabled ? 'lid-lang-chip--disabled' : ''}`}
                          onClick={() => toggleLang(lang.locale)}
                          disabled={isDisabled}
                          title={lang.locale}
                        >
                          {info.flag} {lang.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {lidMode !== 'default' && selectedLangs.length === 0 && (
                <p className="lid-warning">Select at least 1 language to begin detection.</p>
              )}
            </div>
          </div>

          <div className="identify-info-section">
            <h2 className="identify-info-title">How Language Detection Works</h2>
            <p className="identify-info-text">
              This tool uses <strong>Azure AI Speech</strong> with <strong>Continuous Language
              Identification (LID)</strong> to automatically detect the spoken language from
              an audio file. The audio is decoded to 16&thinsp;kHz mono PCM, streamed into the
              Speech SDK, and analysed against the candidate languages below.
            </p>

            <div className="identify-info-steps">
              <div className="identify-step">
                <span className="identify-step-num">1</span>
                <div>
                  <strong>Audio Decoding</strong>
                  <p>Your file is decoded client-side via the Web Audio API and converted to 16-bit PCM WAV at 16&thinsp;kHz — the format required by the Speech SDK.</p>
                </div>
              </div>
              <div className="identify-step">
                <span className="identify-step-num">2</span>
                <div>
                  <strong>Continuous Language ID</strong>
                  <p>The SDK runs continuous recognition with Continuous LID mode, evaluating the audio against all {LANGUAGE_POOL.length} candidate languages simultaneously.</p>
                </div>
              </div>
              <div className="identify-step">
                <span className="identify-step-num">3</span>
                <div>
                  <strong>Transcription &amp; Translation</strong>
                  <p>Once the language is identified, the speech is transcribed and automatically translated to English using the Azure Translator API.</p>
                </div>
              </div>
            </div>

            <details className="identify-lang-details">
              <summary className="identify-lang-summary">
                Supported Languages for LID ({ALL_LID_LANGUAGES.length})
              </summary>
              <p className="identify-info-text">
                Azure Speech supports <strong>{ALL_LID_LANGUAGES.length} languages</strong> for
                Language Identification. The <span className="lid-badge-inline">✓ Default</span> badge
                marks the {LANGUAGE_POOL.length} languages used in this demo's auto-detect pool.
                Continuous LID evaluates up to 10 candidates per request.
              </p>
              <table className="identify-lang-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Language</th>
                    <th>Locale</th>
                    <th>Demo Default</th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_LID_LANGUAGES.map((lang) => {
                    const info = lookupLanguageDisplay(lang.locale);
                    const isDefault = DEFAULT_LID_CODES.has(lang.locale);
                    return (
                      <tr key={lang.locale} className={isDefault ? 'lang-row--default' : ''}>
                        <td className="lang-table-flag">{info.flag}</td>
                        <td>{lang.name}</td>
                        <td><code>{lang.locale}</code></td>
                        <td className="lang-table-default">
                          {isDefault && <span className="lid-badge">✓ Default</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          </div>
        </>
      )}

      {status === 'processing' && (
        <div className="identify-result identify-result--placeholder">
          <span className="identify-flag identify-flag--placeholder">🌐</span>
          <div className="identify-info">
            <span className="identify-name identify-name--placeholder">Detecting…</span>
            <span className="identify-code">{fileName}</span>
          </div>
        </div>
      )}

      {status === 'done' && result && (
        <>
          <div className="identify-result">
            <span className="identify-flag">{result.flag}</span>
            <div className="identify-info">
              <span className="identify-name">{result.name}</span>
              <span className="identify-code">{result.code}</span>
              <span className="identify-time">Detected in {elapsed}s</span>
            </div>
            <button className="identify-reset" onClick={handleReset}>Try Another</button>
          </div>
          <div className="identify-texts">
            <div className="identify-text-box">
              <h3 className="identify-text-label">Original ({result.name})</h3>
              <p className="identify-text-content">{originalText}</p>
            </div>
            <div className="identify-text-box">
              <h3 className="identify-text-label">English</h3>
              <p className="identify-text-content">{translatedText}</p>
            </div>
          </div>

          {timedWords.length === 0 && !fullTranscribing && (
            <button
              className="full-transcribe-btn"
              onClick={handleFullTranscription}
            >
              Full Transcription
            </button>
          )}

          {fullTranscribing && (
            <div className="identify-status-inline">
              <div className="identify-spinner" />
              <span>Transcribing full audio…</span>
            </div>
          )}

          {timedWords.length > 0 && (
            <div className="identify-texts">
              <div className="identify-text-box identify-text-box--karaoke">
                <h3 className="identify-text-label">Full Transcript ({result.name})</h3>
                <p className="identify-text-content karaoke-text">
                  {timedWords.map((w, i) => (
                    <span
                      key={i}
                      className={`karaoke-word ${i === activeWordIdx ? 'karaoke-word--active' : ''}`}
                    >
                      {w.word}{' '}
                    </span>
                  ))}
                </p>
              </div>
              <div className="identify-text-box">
                <h3 className="identify-text-label">Full Translation (English)</h3>
                <p className="identify-text-content">{fullTranslated}</p>
              </div>
            </div>
          )}

          {audioUrl && (
            <audio
              ref={audioRef}
              className="identify-player"
              controls
              src={audioUrl}
              onTimeUpdate={handleTimeUpdate}
            />
          )}
        </>
      )}

      {status === 'error' && (
        <div className="identify-result identify-result--error">
          <div className="identify-error">{errorMsg}</div>
          <button className="identify-reset" onClick={handleReset}>Try Again</button>
        </div>
      )}

      {status === 'processing' && (
        <div className="identify-progress-toast">
          <div className="identify-spinner" />
          <span>Identifying… {elapsed}s</span>
        </div>
      )}
    </div>
  );
}
