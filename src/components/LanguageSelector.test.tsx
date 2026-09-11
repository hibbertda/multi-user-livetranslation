import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageSelector } from './LanguageSelector';
import { LANGUAGE_POOL } from '../languages';

function renderSelector(overrides: Partial<Parameters<typeof LanguageSelector>[0]> = {}) {
  const handlers = {
    onModeChange: vi.fn(),
    onLanguageAChange: vi.fn(),
    onLanguageBChange: vi.fn(),
  };
  const utils = render(
    <LanguageSelector
      mode="auto"
      languageA={LANGUAGE_POOL[0].code}
      languageB={LANGUAGE_POOL[1].code}
      disabled={false}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...utils, ...handlers };
}

describe('LanguageSelector', () => {
  it('hides the language dropdowns in auto-detect mode', () => {
    renderSelector();

    expect(screen.queryByLabelText?.('Local')).toBeNull();
    expect(document.querySelectorAll('select')).toHaveLength(0);
  });

  it('shows both dropdowns in specify mode', () => {
    renderSelector({ mode: 'specify' });

    const selects = document.querySelectorAll('select');
    expect(selects).toHaveLength(2);
    expect(selects[0].querySelectorAll('option')).toHaveLength(LANGUAGE_POOL.length);
  });

  it('shows dropdowns without the mode toggle when hideMode is set', () => {
    renderSelector({ hideMode: true });

    expect(screen.queryByText('Auto-detect')).not.toBeInTheDocument();
    expect(document.querySelectorAll('select')).toHaveLength(2);
  });

  it('marks the active mode button', () => {
    renderSelector({ mode: 'specify' });

    expect(screen.getByText('Select Languages')).toHaveClass('mode-toggle-btn--active');
    expect(screen.getByText('Auto-detect')).not.toHaveClass('mode-toggle-btn--active');
  });

  it('emits mode changes', () => {
    const { onModeChange } = renderSelector();

    fireEvent.click(screen.getByText('Select Languages'));

    expect(onModeChange).toHaveBeenCalledWith('specify');
  });

  it('emits language changes for each side', () => {
    const { onLanguageAChange, onLanguageBChange } = renderSelector({ mode: 'specify' });

    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: LANGUAGE_POOL[2].code } });
    fireEvent.change(selects[1], { target: { value: LANGUAGE_POOL[3].code } });

    expect(onLanguageAChange).toHaveBeenCalledWith(LANGUAGE_POOL[2].code);
    expect(onLanguageBChange).toHaveBeenCalledWith(LANGUAGE_POOL[3].code);
  });

  it('disables every control while disabled', () => {
    renderSelector({ mode: 'specify', disabled: true });

    expect(screen.getByText('Auto-detect')).toBeDisabled();
    expect(screen.getByText('Select Languages')).toBeDisabled();
    document.querySelectorAll('select').forEach((select) => expect(select).toBeDisabled());
  });
});
