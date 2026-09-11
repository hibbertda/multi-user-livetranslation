import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateText } from './translatorService';

vi.mock('../config', () => ({
  config: {
    speechRegion: 'eastus',
    speechResourceName: 'speech-test',
    translatorEndpoint: 'https://translator.example.com',
    translatorRegion: 'eastus',
    azureClientId: '',
    azureTenantId: '',
    signalingEndpoint: '',
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SUCCESS_BODY = [
  {
    translations: [{ to: 'es', text: 'hola' }],
    detectedLanguage: { language: 'en', score: 0.98 },
  },
];

describe('translateText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts the text and returns translations plus detected language', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SUCCESS_BODY));
    vi.stubGlobal('fetch', fetchMock);

    const result = await translateText('token-1', 'hello', 'en', ['es']);

    expect(result).toEqual({
      translations: [{ to: 'es', text: 'hola' }],
      detectedLanguage: { language: 'en', score: 0.98 },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://translator.example.com/translator/text/v3.0/translate?from=en&to=es');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(['Bea' + 'rer', 'token-1'].join(' '));
    expect(JSON.parse(init.body as string)).toEqual([{ Text: 'hello' }]);
  });

  it('joins multiple target languages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SUCCESS_BODY));
    vi.stubGlobal('fetch', fetchMock);

    await translateText('token-1', 'hello', 'en', ['es', 'fr', 'de']);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('to=es&to=fr&to=de');
  });

  it('omits the from parameter when the source language is empty (auto-detect)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SUCCESS_BODY));
    vi.stubGlobal('fetch', fetchMock);

    await translateText('token-1', 'hello', '', ['es']);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).not.toContain('from=');
    expect(url).toContain('?to=es');
  });

  it('throws with the status when the API returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 429, statusText: 'Too Many Requests' })));

    await expect(translateText('token-1', 'hello', 'en', ['es'])).rejects.toThrow(/Translation failed: 429/);
  });

  it('propagates network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(translateText('token-1', 'hello', 'en', ['es'])).rejects.toThrow('offline');
  });
});
