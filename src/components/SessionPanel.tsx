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
import type { DetectionMode, GuestRequest, Session, SessionRecord, TranslationMode } from '../types';
import { getLanguageLabel } from '../languages';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import {
  createSessionRecord,
  endSessionRecord,
  createDebouncedUpdater,
  resumeSessionRecord,
  uploadSessionAudio,
} from '../services/sessionStoreService';
import {
  approveGuestRequest,
  fetchPendingGuestRequests,
  revokeGuest,
  denyGuestRequest,
} from '../services/guestAdmission';
import { createId } from '../utils/id';

interface SessionPanelProps {
  resumeRecord?: SessionRecord | null;
  onResumeHandled?: () => void;
  translationMode: TranslationMode;
  onTranslationModeChange: (mode: TranslationMode) => void;
  microphoneDeviceId: string;
  onMicrophoneChange: (deviceId: string) => void;
}

export function SessionPanel({ resumeRecord, onResumeHandled, translationMode, onTranslationModeChange, microphoneDeviceId, onMicrophoneChange }: SessionPanelProps) {
  const { getToken, getApiToken, account, userId } = useAuth();
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
  const [pendingRequests, setPendingRequests] = useState<GuestRequest[]>([]);

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
    removeGuest,
    broadcastUtterance,
    broadcastUtteranceUpdate,
  } = useHostSession({ getApiToken });

  const resumeHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!resumeRecord || session || resumeHandledRef.current === resumeRecord.id) return;

    resumeHandledRef.current = resumeRecord.id;
    setLanguageA(resumeRecord.languageA);
    setLanguageB(resumeRecord.languageB);
    setHostDisplayLanguage(resumeRecord.languageA);
    setSessionTitle(resumeRecord.title);

    const restoredSession: Session = {
      id: resumeRecord.id,
      ownerId: resumeRecord.ownerId,
      hostName: resumeRecord.hostName,
      createdAt: resumeRecord.startedAt,
      languageA: resumeRecord.languageA,
      languageB: resumeRecord.languageB,
      title: resumeRecord.title,
    };

    void (async () => {
      const accessToken = await getApiToken();
      const ok = await resumeSessionRecord(resumeRecord.id, accessToken);
      if (!ok) throw new Error('Unable to resume session.');
      resumeSession(restoredSession);
      setShowInvite(true);
      onResumeHandled?.();
    })().catch((error) => {
      setUiError(error instanceof Error ? error.message : 'Unable to resume session.');
    });
  }, [getApiToken, onResumeHandled, resumeRecord, resumeSession, session]);

  const lastBroadcastCountRef = useRef(0);
  const broadcastedTranslationsRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!session) return;
    if (utterances.length > lastBroadcastCountRef.current) {
      const newOnes = utterances.slice(lastBroadcastCountRef.current);
      const name = account?.name ?? account?.username ?? 'Host';
      for (const utterance of newOnes) {
        broadcastUtterance({ ...utterance, speakerLabel: name });
      }
      lastBroadcastCountRef.current = utterances.length;
    }
  }, [account, broadcastUtterance, session, utterances]);

  useEffect(() => {
    if (!session) return;
    for (const utterance of utterances) {
      const translationCount = Object.keys(utterance.translatedTexts).length;
      const lastCount = broadcastedTranslationsRef.current.get(utterance.id) ?? 0;
      if (translationCount > lastCount) {
        broadcastUtteranceUpdate(utterance.id, utterance.translatedTexts);
        broadcastedTranslationsRef.current.set(utterance.id, translationCount);
      }
    }
  }, [broadcastUtteranceUpdate, session, utterances]);

  const clearError = useCallback(() => {
    setUiError(null);
    clearTranscriptionError();
  }, [clearTranscriptionError]);

  const activeError = uiError ?? transcriptionError;

  const debouncedUpdaterRef = useRef<ReturnType<typeof createDebouncedUpdater> | null>(null);
  useEffect(() => {
    if (!session) {
      debouncedUpdaterRef.current = null;
      return;
    }
    debouncedUpdaterRef.current = createDebouncedUpdater(session.id, getApiToken);
  }, [getApiToken, session]);

  useEffect(() => {
    if (session && debouncedUpdaterRef.current && utterances.length > 0) {
      debouncedUpdaterRef.current.update({ utteranceCount: utterances.length });
    }
  }, [session, utterances.length]);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const accessToken = await getApiToken();
        const requests = await fetchPendingGuestRequests(session.id, accessToken);
        if (!cancelled) setPendingRequests(requests);
      } catch {
        if (!cancelled) setPendingRequests([]);
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [getApiToken, session]);

  const handleStartSession = useCallback(() => {
    void (async () => {
      clearError();
      if (!userId) throw new Error('Authenticated user ID not available.');

      const hostName = account?.name ?? account?.username ?? 'Host';
      const createdAt = Date.now();
      const nextSession: Session = {
        id: createId(),
        ownerId: userId,
        hostName,
        createdAt,
        languageA,
        languageB,
        title: sessionTitle.trim() || undefined,
      };
      const record: SessionRecord = {
        id: nextSession.id,
        ownerId: userId,
        title: nextSession.title ?? `Session ${new Date(createdAt).toLocaleDateString()}`,
        hostName,
        hostEmail: account?.username,
        languageA,
        languageB,
        invites: [],
        guests: [],
        utteranceCount: 0,
        startedAt: createdAt,
        status: 'active',
      };

      const accessToken = await getApiToken();
      const created = await createSessionRecord(record, accessToken);
      if (!created) throw new Error('Unable to create session.');

      createSession(nextSession);
      setHostDisplayLanguage(languageA);
      setShowInvite(true);
      lastBroadcastCountRef.current = 0;
      broadcastedTranslationsRef.current.clear();
    })().catch((error) => {
      setUiError(error instanceof Error ? error.message : 'Unable to start session.');
    });
  }, [account, clearError, createSession, getApiToken, languageA, languageB, sessionTitle, userId]);

  const handleEndSession = useCallback(() => {
    const currentSession = session;
    const currentGuests = guests;
    const currentUtterances = utterances;
    endSession();
    setShowInvite(false);
    setPendingRequests([]);

    void (async () => {
      if (!currentSession) return;
      await debouncedUpdaterRef.current?.flush();
      const accessToken = await getApiToken();
      await endSessionRecord(currentSession.id, currentUtterances.length, currentGuests, accessToken, currentUtterances);

      if (isRecording) {
        const blob = await stopRecording();
        if (blob.size > 0) {
          await uploadSessionAudio(currentSession.id, blob, accessToken);
        }
      }
    })().catch((error) => {
      setUiError(error instanceof Error ? error.message : 'Unable to end session cleanly.');
    });
  }, [endSession, getApiToken, guests, isRecording, session, stopRecording, utterances]);

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

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (session && guests.length > 0 && !isListening && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void handleStartListening();
    }
  }, [guests.length, handleStartListening, isListening, session]);

  useEffect(() => {
    if (!session) autoStartedRef.current = false;
  }, [session]);

  const handleApprove = useCallback((requestId: string) => {
    if (!session) return;
    void (async () => {
      const accessToken = await getApiToken();
      await approveGuestRequest(session.id, requestId, accessToken);
      setPendingRequests((previous) => previous.filter((request) => request.requestId !== requestId));
    })().catch((error) => {
      setUiError(error instanceof Error ? error.message : 'Unable to approve guest request.');
    });
  }, [getApiToken, session]);

  const handleDeny = useCallback((requestId: string) => {
    if (!session) return;
    void (async () => {
      const accessToken = await getApiToken();
      await denyGuestRequest(session.id, requestId, accessToken);
      setPendingRequests((previous) => previous.filter((request) => request.requestId !== requestId));
    })().catch((error) => {
      setUiError(error instanceof Error ? error.message : 'Unable to deny guest request.');
    });
  }, [getApiToken, session]);

  const handleRevoke = useCallback((guestId: string) => {
    if (!session) return;
    void (async () => {
      const accessToken = await getApiToken();
      await revokeGuest(session.id, guestId, accessToken);
      removeGuest(guestId);
    })().catch((error) => {
      setUiError(error instanceof Error ? error.message : 'Unable to revoke guest access.');
    });
  }, [getApiToken, removeGuest, session]);

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
            <p>Create a session and invite someone to join from their phone. They&apos;ll request admission before seeing the live translation.</p>

            <div className="session-title-field">
              <label htmlFor="session-title">Session Title</label>
              <input
                id="session-title"
                type="text"
                className="session-title-input"
                placeholder="e.g. Patient intake — Dr. Smith"
                value={sessionTitle}
                onChange={(event) => setSessionTitle(event.target.value)}
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
          <div className="session-status-bar">
            <div className="session-status-info">
              <span className={`session-status-dot session-status-dot--${connectionStatus}`} />
              <span className="session-status-label">
                {session.title ?? (connectionStatus === 'connected' ? 'Session Active' : connectionStatus)}
              </span>
              <span className="session-guest-count">
                {guests.length} guest{guests.length === 1 ? '' : 's'}
                {guests.length > 0 ? `: ${guests.map((guest) => guest.name).join(', ')}` : ''}
              </span>
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
              <button className="session-invite-btn" onClick={() => setShowInvite(true)}>
                Invite
              </button>
              <button className="session-end-btn" onClick={handleEndSession}>
                End Session
              </button>
            </div>
          </div>

          <div className="session-settings-row">
            <label className="session-display-lang">
              <span>Display:</span>
              <select value={hostDisplayLanguage} onChange={(event) => setHostDisplayLanguage(event.target.value)}>
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
            <button className="clear-btn" onClick={clearTranscript} disabled={utterances.length === 0}>
              Clear Transcript
            </button>
          </div>

          <div className="speaker-panel">
            <h3>Pending guest requests</h3>
            {(session ? pendingRequests : []).length === 0 ? (
              <p className="settings-hint">No pending requests.</p>
            ) : (
              <ul className="speaker-list">
                {(session ? pendingRequests : []).map((request) => (
                  <li key={request.requestId} className="speaker-item">
                    <span>{request.name} · {getLanguageLabel(request.language)}</span>
                    <button className="recent-session-resume" onClick={() => handleApprove(request.requestId)}>Approve</button>
                    <button className="session-delete-btn" onClick={() => handleDeny(request.requestId)}>Deny</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="speaker-panel">
            <h3>Connected guests</h3>
            {guests.length === 0 ? (
              <p className="settings-hint">No guests connected.</p>
            ) : (
              <ul className="speaker-list">
                {guests.map((guest) => (
                  <li key={guest.id} className="speaker-item">
                    <span>{guest.name} · {getLanguageLabel(guest.language)}</span>
                    <button className="session-delete-btn" onClick={() => handleRevoke(guest.id)}>Revoke</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

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

      {showInvite && session && (
        <InviteModal sessionId={session.id} getApiToken={getApiToken} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}
