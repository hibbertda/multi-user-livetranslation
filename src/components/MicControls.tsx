interface Props {
  isListening: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function MicControls({ isListening, onStart, onStop }: Props) {
  return (
    <div className="mic-controls">
      {isListening ? (
        <button className="mic-btn mic-btn--active" onClick={onStop}>
          <span className="mic-icon">🎙️</span> Stop Listening
        </button>
      ) : (
        <button className="mic-btn" onClick={onStart}>
          <span className="mic-icon">🎙️</span> Start Listening
        </button>
      )}
      {isListening && <span className="mic-pulse" />}
    </div>
  );
}
