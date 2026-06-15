import { useEffect, useRef } from 'react';
import type { Utterance, Speaker } from '../types';

interface Props {
  utterances: Utterance[];
  speakers: Map<string, Speaker>;
  targetLanguage: string;
  targetLabel: string;
  onSpeak: (text: string, lang: string) => void;
}

function getInitials(label: string): string {
  const speakerMatch = label.match(/^(?:Speaker|Guest)\s*(\d+)$/i);
  if (speakerMatch) return speakerMatch[1];
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function UnifiedPanel({
  utterances,
  speakers,
  targetLanguage,
  targetLabel,
  onSpeak,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [utterances]);

  const targetBase = targetLanguage.split('-')[0];

  // Track speaker order for alternating alignment
  const speakerOrder: string[] = [];
  utterances.forEach((u) => {
    if (!speakerOrder.includes(u.speakerId)) speakerOrder.push(u.speakerId);
  });

  return (
    <div className="unified-panel">
      <h2 className="panel-title">Translating to {targetLabel}</h2>
      <div className="utterance-list">
        {utterances.map((u) => {
          const speaker = speakers.get(u.speakerId);
          const color = speaker?.color ?? '#888';
          const label = speaker?.label ?? u.speakerLabel;
          const time = new Date(u.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          const initials = getInitials(label);
          const originalBase = u.detectedLanguage.split('-')[0];
          const needsTranslation = originalBase !== targetBase;
          const translation = needsTranslation
            ? u.translatedTexts[targetBase]
            : Object.values(u.translatedTexts)[0];
          const translationLang = needsTranslation
            ? targetLanguage
            : Object.keys(u.translatedTexts)[0];
          const speakerIdx = speakerOrder.indexOf(u.speakerId);
          const align = speakerIdx % 2 === 0 ? 'left' : 'right';

          return (
            <div className={`chat-bubble-row chat-bubble-row--${align}`} key={u.id}>
              <div
                className="chat-avatar"
                style={{ backgroundColor: color }}
                title={label}
              >
                {initials}
              </div>
              <div className={`chat-bubble chat-bubble--${align}`}>
                <div className="chat-bubble-header">
                  <span className="chat-bubble-name">{label}</span>
                  <span className="chat-bubble-time">{time}</span>
                  <button
                    className="tts-btn"
                    title="Listen original"
                    onClick={() => onSpeak(u.originalText, u.detectedLanguage)}
                  >
                    🔊
                  </button>
                </div>
                <p className="chat-bubble-text">{u.originalText}</p>
                {translation && (
                  <div className="chat-bubble-translation">
                    <button
                      className="tts-btn"
                      title="Listen translation"
                      onClick={() => onSpeak(translation, translationLang ?? targetLanguage)}
                    >
                      🔊
                    </button>
                    <p className="chat-bubble-translated">{translation}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
