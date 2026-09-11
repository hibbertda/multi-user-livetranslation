import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createDebouncedUpdater } from './sessionStoreService';

describe('sessionStoreService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('createDebouncedUpdater', () => {
    it('flushes pending patches', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const updater = createDebouncedUpdater('session-1', async () => 'token-abc', 100);
      updater.update({ title: 'Test' });
      await updater.flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/sessions/session-1');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ title: 'Test' });
    });

    it('logs warning when server rejects update', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));

      const updater = createDebouncedUpdater('session-1', async () => 'token', 100);
      updater.update({ title: 'Bad' });
      await updater.flush();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rejected'));
    });
  });
});
