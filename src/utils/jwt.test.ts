import { describe, expect, it } from 'vitest';
import { getTokenExpiryMs, getTokenTenantId, parseJwt } from './jwt';

function encodeSegment(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(payload: object): string {
  return `${encodeSegment({ alg: 'none', typ: 'JWT' })}.${encodeSegment(payload)}.signature`;
}

describe('parseJwt', () => {
  it('decodes a standard payload', () => {
    const token = makeToken({ exp: 1700000000, tid: 'tenant-1', sub: 'user-1' });
    expect(parseJwt(token)).toEqual({ exp: 1700000000, tid: 'tenant-1', sub: 'user-1' });
  });

  it('decodes base64url payloads that need padding', () => {
    // A payload whose base64 encoding requires '=' padding.
    const token = makeToken({ tid: 'ab' });
    expect(parseJwt(token)).toEqual({ tid: 'ab' });
  });

  it('returns an empty object when the token has fewer than two segments', () => {
    expect(parseJwt('not-a-token')).toEqual({});
    expect(parseJwt('')).toEqual({});
  });

  it('returns an empty object when the payload is not valid base64 JSON', () => {
    expect(parseJwt('header.!!!not-base64!!!.signature')).toEqual({});
    expect(parseJwt(`header.${btoa('not json')}.signature`)).toEqual({});
  });
});

describe('getTokenExpiryMs', () => {
  it('converts the exp claim from seconds to milliseconds', () => {
    expect(getTokenExpiryMs(makeToken({ exp: 1700000000 }))).toBe(1700000000000);
  });

  it('returns null when the exp claim is missing', () => {
    expect(getTokenExpiryMs(makeToken({ tid: 'tenant-1' }))).toBeNull();
  });

  it('returns null for malformed tokens', () => {
    expect(getTokenExpiryMs('garbage')).toBeNull();
  });
});

describe('getTokenTenantId', () => {
  it('returns the tid claim', () => {
    expect(getTokenTenantId(makeToken({ tid: 'tenant-42' }))).toBe('tenant-42');
  });

  it('returns null when the tid claim is missing', () => {
    expect(getTokenTenantId(makeToken({ exp: 1 }))).toBeNull();
  });
});
