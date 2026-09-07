/**
 * Unit tests for storage helper functions.
 * These exercise the actual logic (no mocking) for:
 *  - audioBlobName (stable MIME-independent key)
 *  - isBlobAlreadyExistsError (409 + 412 classification)
 *  - normaliseAllowedMime
 *  - validateMagicBytes
 *  - getMaxUploadBytes (config parsing & upper bound)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { RestError } from '@azure/storage-blob';
import {
  audioBlobName,
  isBlobAlreadyExistsError,
  normaliseAllowedMime,
  validateMagicBytes,
  getMaxUploadBytes,
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES_UPPER_BOUND,
  BlobConflictError,
} from '../storage.js';

// ── audioBlobName ───────────────────────────────────────────────────

describe('audioBlobName', () => {
  it('produces a stable .webm key regardless of MIME type', () => {
    const name = audioBlobName('abc-123');
    expect(name).toBe('session-abc-123.webm');
  });

  it('is deterministic (same session → same name)', () => {
    expect(audioBlobName('x')).toBe(audioBlobName('x'));
  });
});

// ── isBlobAlreadyExistsError ────────────────────────────────────────

describe('isBlobAlreadyExistsError', () => {
  function makeRestError(statusCode: number, code: string): RestError {
    const err = new RestError(`status ${statusCode}`, { statusCode, code });
    return err;
  }

  it('returns true for 409 BlobAlreadyExists', () => {
    expect(isBlobAlreadyExistsError(makeRestError(409, 'BlobAlreadyExists'))).toBe(true);
  });

  it('returns true for 412 ConditionNotMet', () => {
    expect(isBlobAlreadyExistsError(makeRestError(412, 'ConditionNotMet'))).toBe(true);
  });

  it('returns false for 409 with different code (e.g. LeaseConflict)', () => {
    expect(isBlobAlreadyExistsError(makeRestError(409, 'LeaseIdMissing'))).toBe(false);
  });

  it('returns false for 412 with different code (e.g. ETag mismatch)', () => {
    expect(isBlobAlreadyExistsError(makeRestError(412, 'TargetConditionNotMet'))).toBe(false);
  });

  it('returns false for non-RestError', () => {
    expect(isBlobAlreadyExistsError(new Error('random'))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isBlobAlreadyExistsError(null)).toBe(false);
    expect(isBlobAlreadyExistsError(undefined)).toBe(false);
  });
});

// ── BlobConflictError ───────────────────────────────────────────────

describe('BlobConflictError', () => {
  it('has correct name and message', () => {
    const err = new BlobConflictError('session-x.webm');
    expect(err.name).toBe('BlobConflictError');
    expect(err.message).toContain('session-x.webm');
    expect(err).toBeInstanceOf(Error);
  });
});

// ── normaliseAllowedMime ────────────────────────────────────────────

describe('normaliseAllowedMime', () => {
  it('accepts audio/webm', () => {
    expect(normaliseAllowedMime('audio/webm')).toBe('audio/webm');
  });

  it('normalises whitespace around semicolons', () => {
    expect(normaliseAllowedMime('audio/webm ; codecs=opus')).toBe('audio/webm;codecs=opus');
  });

  it('lowercases input', () => {
    expect(normaliseAllowedMime('Audio/WebM')).toBe('audio/webm');
  });

  it('rejects disallowed types', () => {
    expect(normaliseAllowedMime('application/octet-stream')).toBeNull();
    expect(normaliseAllowedMime('text/html')).toBeNull();
  });

  it('accepts all allowed MIME types', () => {
    const allowed = [
      'audio/webm', 'audio/webm;codecs=opus', 'audio/ogg',
      'audio/ogg;codecs=opus', 'audio/wav', 'audio/wave',
      'audio/mp4', 'video/webm', 'video/webm;codecs=opus',
    ];
    for (const m of allowed) {
      expect(normaliseAllowedMime(m)).toBe(m);
    }
  });
});

// ── validateMagicBytes ──────────────────────────────────────────────

describe('validateMagicBytes', () => {
  it('validates EBML header for audio/webm', () => {
    const buf = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0]).buffer;
    expect(validateMagicBytes('audio/webm', buf)).toBe(true);
  });

  it('validates OggS for audio/ogg', () => {
    const buf = new Uint8Array([0x4F, 0x67, 0x67, 0x53, 0, 0]).buffer;
    expect(validateMagicBytes('audio/ogg', buf)).toBe(true);
  });

  it('validates RIFF for audio/wav', () => {
    const buf = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0]).buffer;
    expect(validateMagicBytes('audio/wav', buf)).toBe(true);
  });

  it('validates ftyp for audio/mp4', () => {
    const buf = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]).buffer;
    expect(validateMagicBytes('audio/mp4', buf)).toBe(true);
  });

  it('rejects mismatched magic bytes', () => {
    const ogg = new Uint8Array([0x4F, 0x67, 0x67, 0x53]).buffer;
    expect(validateMagicBytes('audio/webm', ogg)).toBe(false);
  });

  it('rejects unknown MIME type', () => {
    expect(validateMagicBytes('application/pdf', new ArrayBuffer(8))).toBe(false);
  });

  it('rejects buffer too small for signature', () => {
    expect(validateMagicBytes('audio/webm', new ArrayBuffer(2))).toBe(false);
  });
});

// ── getMaxUploadBytes ───────────────────────────────────────────────

describe('getMaxUploadBytes', () => {
  const orig = process.env.AUDIO_MAX_UPLOAD_BYTES;

  afterEach(() => {
    if (orig === undefined) delete process.env.AUDIO_MAX_UPLOAD_BYTES;
    else process.env.AUDIO_MAX_UPLOAD_BYTES = orig;
  });

  it('returns default when env is unset', () => {
    delete process.env.AUDIO_MAX_UPLOAD_BYTES;
    expect(getMaxUploadBytes()).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it('returns valid positive integer from env', () => {
    process.env.AUDIO_MAX_UPLOAD_BYTES = '5242880';
    expect(getMaxUploadBytes()).toBe(5242880);
  });

  it('rejects non-integer (float)', () => {
    process.env.AUDIO_MAX_UPLOAD_BYTES = '1.5';
    expect(getMaxUploadBytes()).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it('rejects zero', () => {
    process.env.AUDIO_MAX_UPLOAD_BYTES = '0';
    expect(getMaxUploadBytes()).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it('rejects negative', () => {
    process.env.AUDIO_MAX_UPLOAD_BYTES = '-100';
    expect(getMaxUploadBytes()).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it('rejects values exceeding upper bound', () => {
    process.env.AUDIO_MAX_UPLOAD_BYTES = String(MAX_UPLOAD_BYTES_UPPER_BOUND + 1);
    expect(getMaxUploadBytes()).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it('accepts exactly the upper bound', () => {
    process.env.AUDIO_MAX_UPLOAD_BYTES = String(MAX_UPLOAD_BYTES_UPPER_BOUND);
    expect(getMaxUploadBytes()).toBe(MAX_UPLOAD_BYTES_UPPER_BOUND);
  });

  it('rejects non-numeric string', () => {
    process.env.AUDIO_MAX_UPLOAD_BYTES = 'abc';
    expect(getMaxUploadBytes()).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it('rejects Infinity', () => {
    process.env.AUDIO_MAX_UPLOAD_BYTES = 'Infinity';
    expect(getMaxUploadBytes()).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });
});
