interface Props {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onSelect: (deviceId: string) => void;
  disabled: boolean;
}

export function MicrophoneSelector({
  devices,
  selectedDeviceId,
  onSelect,
  disabled,
}: Props) {
  if (devices.length <= 1) return null;

  return (
    <div className="mic-selector">
      <label htmlFor="mic-select">🎤</label>
      <select
        id="mic-select"
        value={selectedDeviceId}
        onChange={(e) => onSelect(e.target.value)}
        disabled={disabled}
      >
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  );
}
