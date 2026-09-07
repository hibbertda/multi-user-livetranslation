import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getGuestRequestStatus,
} from './guestAdmission';

describe('guest request status transport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends secret in X-Request-Secret header, not in query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getGuestRequestStatus('request-123', 'my-secret');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    // Secret must NOT be in the URL
    expect(url).not.toContain('my-secret');
    expect(url).not.toContain('secret=');

    // Secret must be in the header
    const headers = new Headers(init.headers);
    expect(headers.get('X-Request-Secret')).toBe('my-secret');
  });
});
