import type { Speaker } from '../types';

interface Props {
  speakers: Map<string, Speaker>;
  onUpdateLabel: (speakerId: string, label: string) => void;
}

export function SpeakerPanel({ speakers, onUpdateLabel }: Props) {
  if (speakers.size === 0) return null;

  return (
    <div className="speaker-panel">
      <h3>Speakers</h3>
      <ul className="speaker-list">
        {Array.from(speakers.values()).map((speaker) => (
          <li key={speaker.id} className="speaker-item">
            <span
              className="speaker-dot"
              style={{ backgroundColor: speaker.color }}
            />
            <input
              className="speaker-name-input"
              value={speaker.label}
              onChange={(e) => onUpdateLabel(speaker.id, e.target.value)}
            />
            <span className="speaker-lang">({speaker.language})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
