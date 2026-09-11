import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTranscriptExport } from './useTranscriptExport';
import type { Speaker, Utterance } from '../types';

const UTTERANCES: Utterance[] = [
  {
    id: 'u1',
    speakerId: 's1',
    speakerLabel: 'Speaker 1',
    originalText: 'hello',
    translatedTexts: { es: 'hola', fr: 'bonjour' },
    detectedLanguage: 'en-US',
    timestamp: Date.UTC(2024, 0, 1, 12, 30, 0),
  } as Utterance,
];

const SPEAKERS = new Map<string, Speaker>([
  ['s1', { id: 's1', label: 'Alice', color: '#fff' } as Speaker],
]);

describe('useTranscriptExport', () => {
  let created: Blob[];
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let revokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    created = [];
    revokeSpy = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob);
        return 'blob:mock-url';
      }),
      revokeObjectURL: revokeSpy,
    });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  }

  it('exports JSON containing speakers, utterances and an export timestamp', async () => {
    const { result } = renderHook(() => useTranscriptExport());

    act(() => {
      result.current.exportAsJson(UTTERANCES, SPEAKERS);
    });

    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('application/json');
    const parsed = JSON.parse(await readBlob(created[0]));
    expect(parsed.utterances).toEqual(UTTERANCES);
    expect(parsed.speakers.s1.label).toBe('Alice');
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('exports plain text with speaker labels, language and translations', async () => {
    const { result } = renderHook(() => useTranscriptExport());

    act(() => {
      result.current.exportAsText(UTTERANCES, SPEAKERS);
    });

    expect(created[0].type).toBe('text/plain');
    const text = await readBlob(created[0]);
    expect(text).toContain('Alice (en-US):');
    expect(text).toContain('hello');
    expect(text).toContain('[es] hola');
    expect(text).toContain('[fr] bonjour');
  });

  it('falls back to the utterance speaker label when the speaker is unknown', async () => {
    const { result } = renderHook(() => useTranscriptExport());

    act(() => {
      result.current.exportAsText(UTTERANCES, new Map());
    });

    const text = await readBlob(created[0]);
    expect(text).toContain('Speaker 1 (en-US):');
  });

  it('names downloads with a filesystem-safe timestamp', () => {
    const anchors: HTMLAnchorElement[] = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = createElement(tag);
      if (tag === 'a') anchors.push(element as HTMLAnchorElement);
      return element;
    });

    const { result } = renderHook(() => useTranscriptExport());
    act(() => {
      result.current.exportAsJson(UTTERANCES, SPEAKERS);
    });

    expect(anchors[0].download).toMatch(/^transcript-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/);
    expect(anchors[0].download).not.toContain(':');
  });

  it('handles an empty transcript', async () => {
    const { result } = renderHook(() => useTranscriptExport());

    act(() => {
      result.current.exportAsText([], new Map());
    });

    expect(await readBlob(created[0])).toBe('');
  });
});
