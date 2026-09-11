import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureAsync, trackEvent } from './telemetry';

describe('trackEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the event name with a timestamp', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    trackEvent('session.start');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [prefix, payload] = infoSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(prefix).toBe('[telemetry]');
    expect(payload.eventName).toBe('session.start');
    expect(typeof payload.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(payload.timestamp as string))).toBe(false);
  });

  it('drops null and undefined properties but keeps falsy primitives', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    trackEvent('session.start', {
      sessionId: 'abc',
      count: 0,
      enabled: false,
      missing: undefined,
      empty: null,
    });

    const [, payload] = infoSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).toMatchObject({ sessionId: 'abc', count: 0, enabled: false });
    expect(payload).not.toHaveProperty('missing');
    expect(payload).not.toHaveProperty('empty');
  });
});

describe('measureAsync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the action result and logs a success event with duration', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(measureAsync('translate', async () => 'done', { lang: 'en-US' })).resolves.toBe('done');

    const [, payload] = infoSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.eventName).toBe('translate:success');
    expect(payload.lang).toBe('en-US');
    expect(typeof payload.durationMs).toBe('number');
    expect(payload.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it('logs a failure event and rethrows the original error', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const failure = new Error('boom');

    await expect(measureAsync('translate', async () => {
      throw failure;
    })).rejects.toBe(failure);

    const [, payload] = infoSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.eventName).toBe('translate:failure');
    expect(payload.error).toBe('boom');
  });

  it('stringifies non-Error rejections', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(measureAsync('translate', async () => {
      throw 'plain failure';
    })).rejects.toBe('plain failure');

    const [, payload] = infoSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.error).toBe('plain failure');
  });
});
