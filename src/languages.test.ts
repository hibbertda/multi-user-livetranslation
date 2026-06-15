import { describe, expect, it } from 'vitest';
import { getLanguageLabel, lookupLanguageDisplay, toLanguageBase } from './languages';

describe('languages metadata', () => {
  it('returns known labels and fallbacks', () => {
    expect(getLanguageLabel('en-US')).toBe('English');
    expect(getLanguageLabel('es-MX')).toBe('Spanish');
    expect(getLanguageLabel('xx-ZZ')).toBe('xx-ZZ');
  });

  it('resolves display metadata with a flag and name', () => {
    const english = lookupLanguageDisplay('en-US');
    expect(english.name).toBe('English');
    expect(english.flag.length).toBeGreaterThan(0);

    const fallback = lookupLanguageDisplay('xx-ZZ');
    expect(fallback.name).toBe('xx-ZZ');
  });

  it('normalizes language code base', () => {
    expect(toLanguageBase('fr-CA')).toBe('fr');
    expect(toLanguageBase('de')).toBe('de');
  });
});
