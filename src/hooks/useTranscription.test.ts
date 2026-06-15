import { describe, expect, it } from 'vitest';
import { pushWithBackpressure } from './useTranscription';

describe('pushWithBackpressure', () => {
  it('pushes without dropping when queue is under max size', () => {
    const queue = [1, 2];
    const dropped = pushWithBackpressure(queue, 3, 5);

    expect(dropped).toBe(false);
    expect(queue).toEqual([1, 2, 3]);
  });

  it('drops oldest item when queue is full', () => {
    const queue = ['a', 'b', 'c'];
    const dropped = pushWithBackpressure(queue, 'd', 3);

    expect(dropped).toBe(true);
    expect(queue).toEqual(['b', 'c', 'd']);
  });
});
