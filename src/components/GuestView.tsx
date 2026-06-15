import { useEffect, useRef, useState, useCallback } from 'react';
import type { Utterance, Speaker } from '../types';
import { UtteranceCard } from './UtteranceCard';
import { toLanguageBase, getLanguageLabel, LANGUAGE_POOL } from '../languages';
import { useTranscriptExport } from '../hooks/useTranscriptExport';
import { useMicrophoneList } from '../hooks/useMicrophoneList';

interface Props {
  utterances: Utterance[];
  speakers: Map<string, Speaker>;
  displayLanguage: string;
  sessionEnded: boolean;
  connectionStatus: string;
  hostName: string;
  guestName: string;
  onSendAudio: (text: string, detectedLanguage: string) => void;
  onLanguageChange: (language: string) => void;
}

export function GuestView({
  utterances,
  speakers,
  displayLanguage,
  sessionEnded,
  connectionStatus,
  hostName,
  guestName,
  onLanguageChange,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { exportAsJson, exportAsText } = useTranscriptExport();
  const { devices } = useMicrophoneList();
  const [showSettings, setShowSettings] = useState(false);

  // Suppress unused warnings — mic integration will use these
  void devices;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [utterances]);

  const speakerOrder: string[] = [];
  utterances.forEach((u) => {
    if (!speakerOrder.includes(u.speakerId)) speakerOrder.push(u.speakerId);
  });

  const displayLangBase = toLanguageBase(displayLanguage);

  // Noop speak for guest (no TTS controls on guest side)
  const noop = useCallback(() => {}, []);

  return (
    <div className="guest-view">
      <header className="guest-header">
        <div className="guest-header-left">
          <h1>Live Translation</h1>
          <span className="guest-host-label">Session with {hostName}</span>
        </div>
        <div className="guest-header-right">
          <span className={`session-status-dot session-status-dot--${connectionStatus}`} />
          <span className="guest-name-label">{guestName}</span>
          <button
            className="guest-settings-btn"
            onClick={() => setShowSettings(!showSettings)}
          >
            ⚙
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="guest-settings-bar">
          <label className="guest-lang-selector">
            <span>Display Language:</span>
            <select
              value={displayLanguage}
              onChange={(e) => onLanguageChange(e.target.value)}
            >
              {LANGUAGE_POOL.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="guest-conversation">
        <h2 className="panel-title">{getLanguageLabel(displayLanguage)}</h2>
        <div className="utterance-list guest-utterance-list">
          {utterances.length === 0 && !sessionEnded && (
            <div className="guest-waiting">
              <p>Connected to session. Waiting for the host to start speaking…</p>
            </div>
          )}
          {utterances.map((u) => {
            const speakerIdx = speakerOrder.indexOf(u.speakerId);
            // Display in guest's language, or original if same language
            const hasTranslation = u.translatedTexts[displayLangBase] != null;
            const isOriginalLanguage = toLanguageBase(u.detectedLanguage) === displayLangBase;

            // Show a waiting indicator if translation hasn't arrived yet and it's not the original language
            const showWaiting = !isOriginalLanguage && !hasTranslation && Object.keys(u.translatedTexts).length === 0;

            return (
              <div key={u.id}>
                <UtteranceCard
                  utterance={u}
                  speaker={speakers.get(u.speakerId)}
                  displayLanguage={displayLanguage}
                  onSpeak={noop}
                  align={speakerIdx % 2 === 0 ? 'left' : 'right'}
                />
                {showWaiting && (
                  <div className="guest-translating-indicator">Translating…</div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {sessionEnded && (
        <div className="guest-ended-overlay">
          <div className="guest-ended-card">
            <h2>Session Ended</h2>
            <p>The host has ended this translation session.</p>
            {utterances.length > 0 && (
              <div className="guest-ended-actions">
                <button
                  className="guest-download-btn"
                  onClick={() => exportAsJson(utterances, speakers)}
                >
                  Download JSON
                </button>
                <button
                  className="guest-download-btn"
                  onClick={() => exportAsText(utterances, speakers)}
                >
                  Download Text
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
