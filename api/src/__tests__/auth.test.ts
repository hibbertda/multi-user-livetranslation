/**
 * Unit tests for Static Web Apps / Easy Auth client principal parsing.
 */
import { describe, it, expect } from 'vitest';
import {
  decodeClientPrincipal,
  extractAuthenticatedUser,
  getAuthenticatedUser,
  type ClientPrincipal,
} from '../auth.js';

function encode(principal: unknown): string {
  return Buffer.from(JSON.stringify(principal), 'utf8').toString('base64');
}

function requestWith(header: string | null) {
  return { headers: new Headers(header ? { 'x-ms-client-principal': header } : {}) } as never;
}

const OID_CLAIM = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const NAME_ID_CLAIM = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier';
const EMAIL_CLAIM = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';

describe('decodeClientPrincipal', () => {
  it('decodes a base64 JSON principal', () => {
    const principal: ClientPrincipal = { auth_typ: 'aad', claims: [{ typ: 'oid', val: 'user-1' }] };
    expect(decodeClientPrincipal(encode(principal))).toEqual(principal);
  });

  it('returns null for missing headers', () => {
    expect(decodeClientPrincipal(null)).toBeNull();
    expect(decodeClientPrincipal(undefined)).toBeNull();
    expect(decodeClientPrincipal('')).toBeNull();
  });

  it('returns null for non-JSON payloads', () => {
    expect(decodeClientPrincipal(Buffer.from('not json', 'utf8').toString('base64'))).toBeNull();
  });

  it('returns null when the payload is JSON but not an object', () => {
    expect(decodeClientPrincipal(encode('a string'))).toBeNull();
    expect(decodeClientPrincipal(encode(null))).toBeNull();
  });
});

describe('extractAuthenticatedUser', () => {
  it('returns null without a principal', () => {
    expect(extractAuthenticatedUser(null)).toBeNull();
  });

  it('returns null when no user id claim is present', () => {
    expect(extractAuthenticatedUser({ claims: [{ typ: 'name', val: 'Alice' }] })).toBeNull();
  });

  it('returns null when the principal has no claims', () => {
    expect(extractAuthenticatedUser({})).toBeNull();
  });

  it('prefers the object identifier claim for the user id', () => {
    const user = extractAuthenticatedUser({
      claims: [
        { typ: NAME_ID_CLAIM, val: 'name-id' },
        { typ: OID_CLAIM, val: 'object-id' },
        { typ: 'oid', val: 'short-oid' },
      ],
    });

    expect(user?.userId).toBe('object-id');
  });

  it('falls back to the nameidentifier claim', () => {
    const user = extractAuthenticatedUser({ claims: [{ typ: NAME_ID_CLAIM, val: 'name-id' }] });
    expect(user?.userId).toBe('name-id');
  });

  it('extracts email, name and auth type', () => {
    const user = extractAuthenticatedUser({
      auth_typ: 'aad',
      claims: [
        { typ: 'oid', val: 'user-1' },
        { typ: 'preferred_username', val: 'alice@example.com' },
        { typ: 'name', val: 'Alice Example' },
      ],
    });

    expect(user).toMatchObject({
      userId: 'user-1',
      email: 'alice@example.com',
      name: 'Alice Example',
      authType: 'aad',
    });
  });

  it('falls back through the email claim list', () => {
    const user = extractAuthenticatedUser({
      claims: [
        { typ: 'oid', val: 'user-1' },
        { typ: EMAIL_CLAIM, val: 'fallback@example.com' },
      ],
    });

    expect(user?.email).toBe('fallback@example.com');
  });

  it('trims claim values and skips blank ones', () => {
    const user = extractAuthenticatedUser({
      claims: [
        { typ: 'oid', val: '   ' },
        { typ: NAME_ID_CLAIM, val: '  user-2  ' },
      ],
    });

    expect(user?.userId).toBe('user-2');
  });

  it('collects roles from the declared role claim type and the roles claim', () => {
    const user = extractAuthenticatedUser({
      role_typ: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
      claims: [
        { typ: 'oid', val: 'user-1' },
        { typ: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role', val: 'admin' },
        { typ: 'roles', val: ' reader ' },
        { typ: 'name', val: 'Alice' },
      ],
    });

    expect(user?.roles).toEqual(['admin', 'reader']);
  });

  it('returns an empty role list when no role claims exist', () => {
    const user = extractAuthenticatedUser({ claims: [{ typ: 'oid', val: 'user-1' }] });
    expect(user?.roles).toEqual([]);
  });
});

describe('getAuthenticatedUser', () => {
  it('reads and decodes the client principal header', () => {
    const header = encode({ claims: [{ typ: 'oid', val: 'user-1' }] });
    expect(getAuthenticatedUser(requestWith(header))?.userId).toBe('user-1');
  });

  it('returns null when the header is absent', () => {
    expect(getAuthenticatedUser(requestWith(null))).toBeNull();
  });

  it('returns null when the header is malformed', () => {
    expect(getAuthenticatedUser(requestWith('%%%not-base64%%%'))).toBeNull();
  });
});
