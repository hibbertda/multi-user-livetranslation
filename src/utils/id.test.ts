import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from './id';

describe('createId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses crypto.randomUUID when available', () => {
    const randomUUID = vi.fn().mockReturnValue('11111111-2222-4333-8444-555555555555');
    vi.stubGlobal('crypto', { randomUUID });

    expect(createId()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('falls back to a timestamp/random id when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {});

    const id = createId();
    expect(id).toMatch(/^\d+-[0-9a-z]+$/);
  });

  it('produces unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createId()));
    expect(ids.size).toBe(50);
  });
});
