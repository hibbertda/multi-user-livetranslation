/**
 * Unit tests for the API request validation helpers in api/src/validation.ts.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  constantTimeEqual,
  findUnknownFields,
  isExpired,
  isSupportedLanguage,
  isValidSessionId,
  normalizeName,
  validateDurationMs,
  validateGuestName,
  validateLanguage,
  validateSessionStatus,
  validateText,
  validateTitle,
  validateUtteranceCount,
} from '../validation.js';

describe('normalizeName / validateGuestName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeName('  Alice  ')).toBe('Alice');
    expect(validateGuestName('  Alice  ')).toBe('Alice');
  });

  it('rejects empty or whitespace-only names', () => {
    expect(validateGuestName('')).toBeNull();
    expect(validateGuestName('   ')).toBeNull();
  });

  it('accepts names at the 100 character limit and rejects longer ones', () => {
    expect(validateGuestName('a'.repeat(100))).toHaveLength(100);
    expect(validateGuestName('a'.repeat(101))).toBeNull();
  });
});

describe('language validation', () => {
  it.each(['en-US', 'ar-SA', 'es-ES', 'fr-FR', 'de-DE', 'zh-CN', 'ja-JP', 'pt-BR', 'hi-IN', 'ko-KR'])(
    'accepts %s',
    (language) => {
      expect(isSupportedLanguage(language)).toBe(true);
      expect(validateLanguage(language)).toBe(language);
    },
  );

  it.each(['en', 'EN-US', 'en-GB', '', 'xx-XX'])('rejects %s', (language) => {
    expect(isSupportedLanguage(language)).toBe(false);
    expect(validateLanguage(language)).toBeNull();
  });
});

describe('validateText', () => {
  it('trims and returns the text', () => {
    expect(validateText('  hello  ')).toBe('hello');
  });

  it('rejects blank text', () => {
    expect(validateText('')).toBeNull();
    expect(validateText('   ')).toBeNull();
  });

  it('enforces the default 5000 character limit', () => {
    expect(validateText('a'.repeat(5000))).toHaveLength(5000);
    expect(validateText('a'.repeat(5001))).toBeNull();
  });

  it('honours a custom maximum length', () => {
    expect(validateText('abcdef', 5)).toBeNull();
    expect(validateText('abcde', 5)).toBe('abcde');
  });
});

describe('isExpired', () => {
  it('treats timestamps at or before now as expired', () => {
    expect(isExpired(1000, 1000)).toBe(true);
    expect(isExpired(999, 1000)).toBe(true);
  });

  it('treats future timestamps as valid', () => {
    expect(isExpired(1001, 1000)).toBe(false);
  });

  it('treats a missing expiry as never expiring', () => {
    expect(isExpired(undefined, 1000)).toBe(false);
  });
});

describe('isValidSessionId', () => {
  it('accepts ids produced by crypto.randomUUID', () => {
    expect(isValidSessionId(randomUUID())).toBe(true);
  });

  it('is case insensitive', () => {
    expect(isValidSessionId('ABCDEF01-2345-6789-ABCD-EF0123456789')).toBe(true);
  });

  it.each([
    '',
    'not-a-uuid',
    '12345678-1234-1234-1234-12345678901',
    '12345678-1234-1234-1234-1234567890123',
    '12345678123412341234123456789012',
    "12345678-1234-1234-1234-123456789012' OR 1=1--",
  ])('rejects %s', (value) => {
    expect(isValidSessionId(value)).toBe(false);
  });
});

describe('validateTitle', () => {
  it('trims valid titles', () => {
    expect(validateTitle('  Weekly sync ')).toBe('Weekly sync');
  });

  it('rejects blank titles', () => {
    expect(validateTitle('   ')).toBeNull();
  });

  it('enforces the 200 character limit', () => {
    expect(validateTitle('a'.repeat(200))).toHaveLength(200);
    expect(validateTitle('a'.repeat(201))).toBeNull();
  });
});

describe('validateSessionStatus', () => {
  it('accepts known statuses', () => {
    expect(validateSessionStatus('active')).toBe('active');
    expect(validateSessionStatus('ended')).toBe('ended');
  });

  it('rejects anything else', () => {
    expect(validateSessionStatus('Active')).toBeNull();
    expect(validateSessionStatus('deleted')).toBeNull();
    expect(validateSessionStatus('')).toBeNull();
  });
});

describe('validateUtteranceCount', () => {
  it('accepts non-negative integers within range', () => {
    expect(validateUtteranceCount(0)).toBe(0);
    expect(validateUtteranceCount(100_000)).toBe(100_000);
  });

  it.each([-1, 1.5, 100_001, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined, {}])(
    'rejects %s',
    (value) => {
      expect(validateUtteranceCount(value)).toBeNull();
    },
  );
});

describe('validateDurationMs', () => {
  it('accepts non-negative finite numbers', () => {
    expect(validateDurationMs(0)).toBe(0);
    expect(validateDurationMs(1234.5)).toBe(1234.5);
  });

  it('treats explicit null as a clear operation', () => {
    expect(validateDurationMs(null)).toBeNull();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, '100', undefined])('rejects %s', (value) => {
    expect(validateDurationMs(value)).toBeNull();
  });
});

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
  });

  it('returns false for different lengths without throwing', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns false when either value is empty', () => {
    expect(constantTimeEqual('', '')).toBe(false);
    expect(constantTimeEqual('abc', '')).toBe(false);
    expect(constantTimeEqual('', 'abc')).toBe(false);
  });
});

describe('findUnknownFields', () => {
  const allowed = new Set(['title', 'status']);

  it('returns an empty array when all fields are allowed', () => {
    expect(findUnknownFields({ title: 'x', status: 'active' }, allowed)).toEqual([]);
    expect(findUnknownFields({}, allowed)).toEqual([]);
  });

  it('lists unknown field names', () => {
    expect(findUnknownFields({ title: 'x', ownerId: 'someone-else' }, allowed)).toEqual(['ownerId']);
  });

  it('flags attempts to inject privileged fields', () => {
    expect(findUnknownFields({ id: '1', userId: 'other', title: 'ok' }, allowed)).toEqual(['id', 'userId']);
  });
});
