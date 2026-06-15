import type { Utterance, Speaker } from '../types';

interface Props {
  isRecording: boolean;
  onStartRecording: () => void;
  onSaveRecording: () => void;
  onExportJson: (utterances: Utterance[], speakers: Map<string, Speaker>) => void;
  onExportText: (utterances: Utterance[], speakers: Map<string, Speaker>) => void;
  utterances: Utterance[];
  speakers: Map<string, Speaker>;
}

export function SaveControls({
  isRecording,
  onStartRecording,
  onSaveRecording,
  onExportJson,
  onExportText,
  utterances,
  speakers,
}: Props) {
  return (
    <div className="save-controls">
      {isRecording ? (
        <button className="save-btn save-btn--recording" onClick={onSaveRecording}>
          ⏹ Stop & Save Recording
        </button>
      ) : (
        <button className="save-btn" onClick={onStartRecording}>
          ⏺ Record Audio
        </button>
      )}
      <button
        className="save-btn"
        onClick={() => onExportJson(utterances, speakers)}
        disabled={utterances.length === 0}
      >
        💾 Export JSON
      </button>
      <button
        className="save-btn"
        onClick={() => onExportText(utterances, speakers)}
        disabled={utterances.length === 0}
      >
        📄 Export Text
      </button>
    </div>
  );
}
