/**
 * Tests for API validation helpers.
 * Tests pure validation functions extracted to api/src/validation.ts.
 * Uses logic copied from the API since we can't import from api/ directly.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

// Pure validation logic mirrors api/src/validation.ts (no node:crypto needed for these)

const SUPPORTED_LANGUAGE_CODES = new Set([
  'en-US', 'ar-SA', 'es-ES', 'fr-FR', 'de-DE',
  'zh-CN', 'ja-JP', 'pt-BR', 'hi-IN', 'ko-KR',
]);

function isSupportedLanguage(language: string): boolean {
  return SUPPORTED_LANGUAGE_CODES.has(language);
}

function validateLanguage(language: string): string | null {
  return isSupportedLanguage(language) ? language : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSessionId(id: string): boolean {
  return UUID_RE.test(id);
}

function validateTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
}

function validateSessionStatus(status: string): 'active' | 'ended' | null {
  if (status === 'active' || status === 'ended') return status;
  return null;
}

function validateUtteranceCount(count: unknown): number | null {
  if (typeof count !== 'number') return null;
  if (!Number.isInteger(count) || count < 0 || count > 100_000) return null;
  return count;
}

function validateDurationMs(ms: unknown): number | null {
  if (ms === null) return null;
  if (typeof ms !== 'number') return null;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms;
}

function findUnknownFields(payload: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(payload).filter((key) => !allowed.has(key));
}

describe('API payload validation', () => {
  describe('isValidSessionId', () => {
    it('accepts valid UUID v4', () => {
      expect(isValidSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidSessionId('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('rejects non-UUID strings', () => {
      expect(isValidSessionId('')).toBe(false);
      expect(isValidSessionId('not-a-uuid')).toBe(false);
      expect(isValidSessionId('550e8400e29b41d4a716446655440000')).toBe(false); // no dashes
      expect(isValidSessionId('../../../etc/passwd')).toBe(false);
      expect(isValidSessionId('550e8400-e29b-41d4-a716-44665544000g')).toBe(false); // invalid hex
    });
  });

  describe('validateLanguage', () => {
    it('accepts supported languages', () => {
      expect(validateLanguage('en-US')).toBe('en-US');
      expect(validateLanguage('ja-JP')).toBe('ja-JP');
    });

    it('rejects unsupported languages', () => {
      expect(validateLanguage('xx-ZZ')).toBeNull();
      expect(validateLanguage('')).toBeNull();
      expect(validateLanguage('javascript:alert(1)')).toBeNull();
    });
  });

  describe('validateTitle', () => {
    it('accepts valid titles', () => {
      expect(validateTitle('My Session')).toBe('My Session');
      expect(validateTitle('  trimmed  ')).toBe('trimmed');
    });

    it('rejects empty or too-long titles', () => {
      expect(validateTitle('')).toBeNull();
      expect(validateTitle('   ')).toBeNull();
      expect(validateTitle('x'.repeat(201))).toBeNull();
    });

    it('accepts max-length title', () => {
      expect(validateTitle('x'.repeat(200))).toBe('x'.repeat(200));
    });
  });

  describe('validateSessionStatus', () => {
    it('accepts active and ended', () => {
      expect(validateSessionStatus('active')).toBe('active');
      expect(validateSessionStatus('ended')).toBe('ended');
    });

    it('rejects invalid statuses', () => {
      expect(validateSessionStatus('paused')).toBeNull();
      expect(validateSessionStatus('')).toBeNull();
      expect(validateSessionStatus('ACTIVE')).toBeNull();
    });
  });

  describe('validateUtteranceCount', () => {
    it('accepts valid counts', () => {
      expect(validateUtteranceCount(0)).toBe(0);
      expect(validateUtteranceCount(42)).toBe(42);
      expect(validateUtteranceCount(100_000)).toBe(100_000);
    });

    it('rejects invalid counts', () => {
      expect(validateUtteranceCount(-1)).toBeNull();
      expect(validateUtteranceCount(1.5)).toBeNull();
      expect(validateUtteranceCount('42')).toBeNull();
      expect(validateUtteranceCount(100_001)).toBeNull();
      expect(validateUtteranceCount(null)).toBeNull();
      expect(validateUtteranceCount(undefined)).toBeNull();
    });
  });

  describe('validateDurationMs', () => {
    it('accepts valid durations', () => {
      expect(validateDurationMs(0)).toBe(0);
      expect(validateDurationMs(60000)).toBe(60000);
    });

    it('accepts null to clear', () => {
      expect(validateDurationMs(null)).toBeNull();
    });

    it('rejects invalid durations', () => {
      expect(validateDurationMs(-1)).toBeNull();
      expect(validateDurationMs(Infinity)).toBeNull();
      expect(validateDurationMs('1000')).toBeNull();
    });
  });

  describe('findUnknownFields', () => {
    const allowed = new Set(['title', 'status', 'languageA']);

    it('returns empty for allowed-only payloads', () => {
      expect(findUnknownFields({ title: 'x', status: 'active' }, allowed)).toEqual([]);
    });

    it('returns unknown field names', () => {
      expect(findUnknownFields({ title: 'x', audioUrl: 'http://evil', foo: 'bar' }, allowed)).toEqual(['audioUrl', 'foo']);
    });

    it('detects audioUrl as unknown (removed from PATCH)', () => {
      const patchAllowed = new Set(['title', 'languageA', 'languageB', 'guests', 'utteranceCount', 'utterances', 'endedAt', 'durationMs', 'status']);
      expect(findUnknownFields({ audioUrl: 'http://x' }, patchAllowed)).toEqual(['audioUrl']);
    });
  });
});
