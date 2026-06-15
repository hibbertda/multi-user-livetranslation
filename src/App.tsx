import { useState, useEffect, useRef, useCallback } from 'react';
import { useIsAuthenticated } from '@azure/msal-react';
import { useAuth } from './hooks/useAuth';
import { useTranscription } from './hooks/useTranscription';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useTranscriptExport } from './hooks/useTranscriptExport';
import { ConversationPanel } from './components/ConversationPanel';
import { UnifiedPanel } from './components/UnifiedPanel';
import { AudioIdentify } from './components/AudioIdentify';
import { SessionPanel } from './components/SessionPanel';
import { SessionHistory } from './components/SessionHistory';
import { RecentSessionsMenu } from './components/RecentSessionsMenu';
import { SpeakerPanel } from './components/SpeakerPanel';
import { LanguageSelector } from './components/LanguageSelector';
import { MicControls } from './components/MicControls';
import { SaveControls } from './components/SaveControls';
import { UserMenu } from './components/UserMenu';
import { SettingsPage } from './components/SettingsPage';
import type { DetectionMode, SessionRecord } from './types';
import { getLanguageLabel } from './languages';
import { useMicrophoneList } from './hooks/useMicrophoneList';
import { usePersistedSettings } from './hooks/usePersistedSettings';
import { trackEvent } from './utils/telemetry';
import './App.css';

function App() {
  const isAuthenticated = useIsAuthenticated();
  const { login, logout, getToken, getGraphToken, account } = useAuth();

  const { settings, updateSettings } = usePersistedSettings(account?.localAccountId);
  const [mode, setMode] = useState<DetectionMode>('specify');
  const [languageA, setLanguageA] = useState('en-US');
  const [languageB, setLanguageB] = useState('ar-SA');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [view, setView] = useState<'split' | 'unified' | 'identify' | 'session' | 'history'>(() => {
    const saved = sessionStorage.getItem('activeTab');
    return saved === 'split' || saved === 'unified' || saved === 'identify' || saved === 'session' || saved === 'history' ? saved : 'session';
  });

  const [resumeRecord, setResumeRecord] = useState<SessionRecord | null>(null);

  const handleResumeSession = useCallback((record: SessionRecord) => {
    setResumeRecord(record);
    setView('session');
  }, []);

  useEffect(() => {
    sessionStorage.setItem('activeTab', view);
  }, [view]);
  const { devices, selectedDeviceId } = useMicrophoneList();

  const {
    utterances,
    speakers,
    isListening,
    start,
    stop,
    clearTranscript,
    updateSpeakerLabel,
    lastError: transcriptionError,
    clearError: clearTranscriptionError,
    queueDepth,
    droppedTranslations,
  } = useTranscription({ getToken, mode, translationMode: settings.translationMode, languageA, languageB, deviceId: settings.microphoneDeviceId || selectedDeviceId });

  const { speak } = useSpeechSynthesis(getToken);
  const { isRecording, startRecording, saveRecording } = useAudioRecorder(settings.microphoneDeviceId || selectedDeviceId);
  const { exportAsJson, exportAsText } = useTranscriptExport();

  const clearError = useCallback(() => {
    setUiError(null);
    clearTranscriptionError();
  }, [clearTranscriptionError]);

  const activeError = uiError ?? transcriptionError;

  const startListening = useCallback(async () => {
    clearError();
    try {
      await start();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start transcription.';
      setUiError(message);
    }
  }, [clearError, start]);

  const stopListening = useCallback(async () => {
    try {
      await stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to stop transcription cleanly.';
      setUiError(message);
    }
  }, [stop]);

  const startRecordingAudio = useCallback(async () => {
    clearError();
    try {
      await startRecording();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to access microphone for recording.';
      setUiError(message);
    }
  }, [clearError, startRecording]);

  const saveRecordingAudio = useCallback(async () => {
    try {
      await saveRecording();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save recording.';
      setUiError(message);
    }
  }, [saveRecording]);

  // Synchronized scrolling for split-view panels
  const scrollARef = useRef<HTMLDivElement>(null);
  const scrollBRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  const onScrollA = useCallback(() => {
    if (isSyncing.current) return;
    const s = scrollARef.current;
    const t = scrollBRef.current;
    if (!s || !t) return;
    isSyncing.current = true;
    const maxScroll = s.scrollHeight - s.clientHeight;
    const pct = maxScroll > 0 ? s.scrollTop / maxScroll : 0;
    const targetMax = t.scrollHeight - t.clientHeight;
    t.scrollTop = pct * targetMax;
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  const onScrollB = useCallback(() => {
    if (isSyncing.current) return;
    const s = scrollBRef.current;
    const t = scrollARef.current;
    if (!s || !t) return;
    isSyncing.current = true;
    const maxScroll = s.scrollHeight - s.clientHeight;
    const pct = maxScroll > 0 ? s.scrollTop / maxScroll : 0;
    const targetMax = t.scrollHeight - t.clientHeight;
    t.scrollTop = pct * targetMax;
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  if (!isAuthenticated) {
    return (
      <div className="login-screen">
        <h1>Live Translation</h1>
        <p>Sign in with your Azure account to get started.</p>
        <button className="login-btn" onClick={login}>
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <button className="nav-hamburger" onClick={() => setNavOpen(!navOpen)} aria-label="Menu">
            ☰
          </button>
          <div className="app-header-title">
            <h1>Live Translation</h1>
            <span className="app-header-mode">{{ session: 'Shared Session', history: 'History', split: 'Side by Side', unified: 'Unified', identify: 'Identify Language' }[view]}</span>
          </div>
        </div>
        <div className="app-header-right">
          <button className="header-icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <RecentSessionsMenu onViewAll={() => { setView('history'); setNavOpen(false); }} onResume={handleResumeSession} />
          {account && <UserMenu account={account} onLogout={logout} getGraphToken={getGraphToken} />}
        </div>
      </header>

      {/* Navigation drawer */}
      {navOpen && <div className="nav-overlay" onClick={() => setNavOpen(false)} />}
      <div className={`nav-drawer ${navOpen ? 'nav-drawer--open' : ''}`}>
        <nav className="nav-drawer-list">
          {([
            { key: 'session', label: 'Shared Session', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> },
            { key: 'history', label: 'History', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
            { key: 'split', label: 'Side by Side', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg> },
            { key: 'unified', label: 'Unified', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg> },
            { key: 'identify', label: 'Identify Language', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              className={`nav-drawer-item ${view === key ? 'nav-drawer-item--active' : ''}`}
              onClick={() => { setView(key); setNavOpen(false); }}
            >
              <span className="nav-drawer-icon">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
      </div>

      {activeError && (
        <div className="app-alert" role="alert">
          <span>{activeError}</span>
          <button type="button" className="app-alert-close" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}

      {(queueDepth > 0 || droppedTranslations > 0) && (
        <div className="app-health-banner">
          <span>Translation queue: {queueDepth}</span>
          {droppedTranslations > 0 && <span>Dropped (backpressure): {droppedTranslations}</span>}
        </div>
      )}

      {view !== 'identify' && view !== 'session' && view !== 'history' && (
        <button
          className="settings-toggle"
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-label="Options"
        >
          ☰ Options
        </button>
      )}

      {settingsOpen && (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)} />
      )}
      <div className={`settings-drawer ${settingsOpen ? 'settings-drawer--open' : ''}`}>
        <div className="settings-drawer-header">
          <h2>Options</h2>
          <button className="settings-close" onClick={() => setSettingsOpen(false)}>✕</button>
        </div>
        <div className="settings-drawer-body">
          <LanguageSelector
            mode={mode}
            languageA={languageA}
            languageB={languageB}
            onModeChange={setMode}
            onLanguageAChange={setLanguageA}
            onLanguageBChange={setLanguageB}
            disabled={isListening}
          />
          <SpeakerPanel speakers={speakers} onUpdateLabel={updateSpeakerLabel} />
          <SaveControls
            isRecording={isRecording}
            onStartRecording={() => {
              void startRecordingAudio();
            }}
            onSaveRecording={() => {
              void saveRecordingAudio();
            }}
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
      </div>

      {view === 'split' ? (
        <main className="conversation-area">
          <ConversationPanel
            utterances={utterances}
            speakers={speakers}
            displayLanguage={languageA}
            title={getLanguageLabel(languageA)}
            onSpeak={speak}
            scrollRef={scrollARef}
            onScroll={onScrollA}
          />
          <ConversationPanel
            utterances={utterances}
            speakers={speakers}
            displayLanguage={languageB}
            title={getLanguageLabel(languageB)}
            onSpeak={speak}
            scrollRef={scrollBRef}
            onScroll={onScrollB}
          />
        </main>
      ) : view === 'unified' ? (
        <main className="conversation-area conversation-area--unified">
          <UnifiedPanel
            utterances={utterances}
            speakers={speakers}
            targetLanguage={languageB}
            targetLabel={getLanguageLabel(languageB)}
            onSpeak={speak}
          />
        </main>
      ) : view === 'session' ? (
        <main className="conversation-area conversation-area--unified">
          <SessionPanel
            resumeRecord={resumeRecord}
            onResumeHandled={() => setResumeRecord(null)}
            translationMode={settings.translationMode}
            onTranslationModeChange={(m) => updateSettings({ translationMode: m })}
            microphoneDeviceId={settings.microphoneDeviceId}
            onMicrophoneChange={(id) => updateSettings({ microphoneDeviceId: id })}
          />
        </main>
      ) : view === 'history' ? (
        <main className="conversation-area conversation-area--unified">
          <SessionHistory onResume={handleResumeSession} />
        </main>
      ) : (
        <main className="conversation-area conversation-area--unified">
          <AudioIdentify getToken={getToken} />
        </main>
      )}

      {view !== 'identify' && view !== 'session' && view !== 'history' && (
        <footer className="app-footer">
          <MicControls
            isListening={isListening}
            onStart={() => {
              trackEvent('ui.mic.start_clicked');
              void startListening();
            }}
            onStop={() => {
              trackEvent('ui.mic.stop_clicked');
              void stopListening();
            }}
          />
        </footer>
      )}

      {/* Settings modal */}
      {showSettings && (
        <>
          <div className="settings-modal-overlay" onClick={() => setShowSettings(false)} />
          <div className="settings-modal">
            <div className="settings-modal-header">
              <h2>Settings</h2>
              <button className="settings-modal-close" onClick={() => setShowSettings(false)}>&#x2715;</button>
            </div>
            <div className="settings-modal-body">
              <SettingsPage
                devices={devices}
                selectedDeviceId={settings.microphoneDeviceId || selectedDeviceId}
                onSelectDevice={(id) => updateSettings({ microphoneDeviceId: id })}
                translationMode={settings.translationMode}
                onTranslationModeChange={(m) => updateSettings({ translationMode: m })}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
