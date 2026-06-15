import type { Utterance, Speaker } from '../types';

interface Props {
  utterance: Utterance;
  speaker: Speaker | undefined;
  displayLanguage: string;
  onSpeak: (text: string, lang: string) => void;
  align?: 'left' | 'right';
}

function getInitials(label: string): string {
  // If it's a default "Speaker N" label, return the number
  const speakerMatch = label.match(/^(?:Speaker|Guest)\s*(\d+)$/i);
  if (speakerMatch) return speakerMatch[1];
  // Otherwise return up to 2 initials
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function UtteranceCard({
  utterance,
  speaker,
  displayLanguage,
  onSpeak,
  align = 'left',
}: Props) {
  const color = speaker?.color ?? '#888';
  const label = speaker?.label ?? utterance.speakerLabel;
  const time = new Date(utterance.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const initials = getInitials(label);

  const displayLangBase = displayLanguage.split('-')[0];
  const originalLangBase = utterance.detectedLanguage.split('-')[0];
  const isOriginalLanguage = displayLangBase === originalLangBase;

  const displayText = isOriginalLanguage
    ? utterance.originalText
    : utterance.translatedTexts[displayLangBase] ?? utterance.originalText;

  const subtitleText = isOriginalLanguage
    ? Object.values(utterance.translatedTexts)[0]
    : utterance.originalText;

  return (
    <div className={`chat-bubble-row chat-bubble-row--${align}`}>
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
            title="Listen"
            onClick={() => onSpeak(displayText, displayLanguage)}
          >
            🔊
          </button>
        </div>
        <p className="chat-bubble-text">{displayText}</p>
        {subtitleText && subtitleText !== displayText && (
          <p className="chat-bubble-subtitle">{subtitleText}</p>
        )}
      </div>
    </div>
  );
}
