import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiResponseError,
  buildInviteUrl,
  computeSha256Hex,
  exchangeGuestTicket,
  extractInviteSecretFromHash,
  isExpired,
  scrubInviteFragment,
  scrubInviteFromLocation,
  validateRequestSecret,
} from './guestAdmission';

describe('guest admission helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/join?session=session-123#invite=secret-value');
  });

  it('computes SHA-256 hashes', async () => {
    await expect(computeSha256Hex('invite-secret')).resolves.toBe('2a1ed5f04ebb12c50d33ea3031b46260a6d503e72c1d992b2fd3d9e048cd5c8f');
  });

  it('builds invite URLs with a fragment secret', () => {
    const url = buildInviteUrl('https://example.com', 'session-123', 'secret-value');
    expect(url).toBe('https://example.com/join?session=session-123#invite=secret-value');
  });

  it('extracts and scrubs invite fragments', () => {
    expect(extractInviteSecretFromHash('#invite=secret-value')).toBe('secret-value');
    expect(scrubInviteFragment('https://example.com/join?session=session-123#invite=secret-value')).toBe('https://example.com/join?session=session-123');
    expect(scrubInviteFromLocation()).toBe('secret-value');
    expect(window.location.hash).toBe('');
  });

  it('validates request secrets', () => {
    expect(validateRequestSecret('abc', 'abc')).toBe(true);
    expect(validateRequestSecret('abc', 'xyz')).toBe(false);
  });

  it('exchanges tickets through the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: 'wss://signal.example/ws',
      guestId: 'guest-1',
      admissionId: 'guest-1',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(exchangeGuestTicket('ticket-1', 'session-123')).resolves.toEqual({
      url: 'wss://signal.example/ws',
      guestId: 'guest-1',
      admissionId: 'guest-1',
    });
  });

  it('throws API errors on failed ticket exchange', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid ticket' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(exchangeGuestTicket('bad-ticket', 'session-123')).rejects.toEqual(expect.objectContaining<ApiResponseError>({
      name: 'ApiResponseError',
      status: 403,
      message: 'Invalid ticket',
    }));
  });

  it('checks expiry timestamps', () => {
    expect(isExpired(1000, 1000)).toBe(true);
    expect(isExpired(1001, 1000)).toBe(false);
  });
});
