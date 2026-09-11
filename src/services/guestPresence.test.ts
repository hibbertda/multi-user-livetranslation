import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiResponseError,
  sendGuestHeartbeat,
  sendGuestLeave,
  sendGuestLeaveBeacon,
} from './guestAdmission';

vi.mock('../config', () => ({
  config: {
    speechRegion: '',
    speechResourceName: '',
    translatorEndpoint: '',
    translatorRegion: '',
    azureClientId: '',
    azureTenantId: '',
    signalingEndpoint: '',
  },
}));

const identity = { sessionId: 'session-1', guestId: 'guest-1', admissionId: 'guest-1' };

function stubFetch(response: Response | Error) {
  const fetchMock = response instanceof Error
    ? vi.fn().mockRejectedValue(response)
    : vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendGuestLeave', () => {
  it('posts the guest identity to the leave endpoint', async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendGuestLeave(identity);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/guest/leave');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(identity);
  });

  it('surfaces an API error', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'Session unavailable' }), { status: 410 }));

    await expect(sendGuestLeave(identity)).rejects.toBeInstanceOf(ApiResponseError);
  });
});

describe('sendGuestHeartbeat', () => {
  it('posts the guest identity to the heartbeat endpoint', async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await sendGuestHeartbeat(identity);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/guest/heartbeat');
    expect(JSON.parse(init.body as string)).toEqual(identity);
  });

  it('rejects when rate limited', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'Heartbeat rate limit exceeded' }), { status: 429 }));

    await expect(sendGuestHeartbeat(identity)).rejects.toMatchObject({ status: 429 });
  });
});

describe('sendGuestLeaveBeacon', () => {
  it('prefers navigator.sendBeacon', () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon });
    const fetchMock = stubFetch(new Response('{}', { status: 200 }));

    expect(sendGuestLeaveBeacon(identity)).toBe(true);
    expect(sendBeacon).toHaveBeenCalledWith('/api/guest/leave', expect.any(Blob));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a keepalive fetch when sendBeacon is unavailable', () => {
    vi.stubGlobal('navigator', {});
    const fetchMock = stubFetch(new Response('{}', { status: 200 }));

    expect(sendGuestLeaveBeacon(identity)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/guest/leave');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual(identity);
  });

  it('falls back to fetch when sendBeacon throws', () => {
    vi.stubGlobal('navigator', { sendBeacon: () => { throw new Error('blocked'); } });
    const fetchMock = stubFetch(new Response('{}', { status: 200 }));

    expect(sendGuestLeaveBeacon(identity)).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('reports failure when the browser refuses the beacon', () => {
    vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => false) });

    expect(sendGuestLeaveBeacon(identity)).toBe(false);
  });

  it('swallows a fetch failure', () => {
    vi.stubGlobal('navigator', {});
    stubFetch(new Response('{}', { status: 500 }));

    expect(sendGuestLeaveBeacon(identity)).toBe(true);
  });
});
