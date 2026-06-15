import { MicrophoneSelector } from './MicrophoneSelector';
import type { TranslationMode } from '../types';

interface Props {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  translationMode: TranslationMode;
  onTranslationModeChange: (mode: TranslationMode) => void;
}

export function SettingsPage({
  devices,
  selectedDeviceId,
  onSelectDevice,
  translationMode,
  onTranslationModeChange,
}: Props) {
  return (
    <div className="settings-page">
      <p className="settings-page-desc">These preferences persist across all translation modes.</p>

      <div className="settings-page-section">
        <label className="settings-label">Microphone</label>
        <MicrophoneSelector
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelect={onSelectDevice}
          disabled={false}
        />
        {devices.length <= 1 && (
          <p className="settings-hint">Only one microphone detected — it will be used automatically.</p>
        )}
      </div>

      <hr className="setup-divider" />

      <div className="settings-page-section">
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
    </div>
  );
}
