import type { DetectionMode } from '../types';
import { LANGUAGE_POOL } from '../languages';

interface Props {
  mode: DetectionMode;
  languageA: string;
  languageB: string;
  onModeChange: (mode: DetectionMode) => void;
  onLanguageAChange: (code: string) => void;
  onLanguageBChange: (code: string) => void;
  disabled: boolean;
  hideMode?: boolean;
}

export function LanguageSelector({
  mode,
  languageA,
  languageB,
  onModeChange,
  onLanguageAChange,
  onLanguageBChange,
  disabled,
  hideMode,
}: Props) {
  return (
    <div className="language-selector">
      {!hideMode && (
        <div className="mode-toggle">
          <button
            type="button"
            className={`mode-toggle-btn${mode === 'auto' ? ' mode-toggle-btn--active' : ''}`}
            onClick={() => onModeChange('auto')}
            disabled={disabled}
          >
            Auto-detect
          </button>
          <button
            type="button"
            className={`mode-toggle-btn${mode === 'specify' ? ' mode-toggle-btn--active' : ''}`}
            onClick={() => onModeChange('specify')}
            disabled={disabled}
          >
            Select Languages
          </button>
        </div>
      )}

      {(mode === 'specify' || hideMode) && (
        <div className="language-dropdowns">
          <div className="language-field">
            <label className="language-field-label">Local</label>
            <select
              value={languageA}
              onChange={(e) => onLanguageAChange(e.target.value)}
              disabled={disabled}
            >
              {LANGUAGE_POOL.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="language-field">
            <label className="language-field-label">Remote</label>
            <select
              value={languageB}
              onChange={(e) => onLanguageBChange(e.target.value)}
              disabled={disabled}
            >
              {LANGUAGE_POOL.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
