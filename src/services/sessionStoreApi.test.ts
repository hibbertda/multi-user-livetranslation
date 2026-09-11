import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionRecord,
  deleteSessionRecord,
  endSessionRecord,
  fetchRecentSessions,
  fetchSession,
  fetchSessionHistory,
  fetchUserSettings,
  resumeSessionRecord,
  saveUserSettings,
  updateSessionRecord,
  uploadSessionAudio,
} from './sessionStoreService';
import type { SessionRecord, Utterance } from '../types';

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

const TOKEN = 'access-token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(response: Response | Error) {
  const fetchMock = response instanceof Error
    ? vi.fn().mockRejectedValue(response)
    : vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
}

const SESSION: SessionRecord = {
  id: 'session-1',
  title: 'Standup',
  startedAt: 1,
  status: 'active',
} as SessionRecord;

describe('sessionStoreService API helpers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('createSessionRecord', () => {
    it('POSTs the record with a bearer token and JSON content type', async () => {
      const fetchMock = stubFetch(jsonResponse({}, 201));

      await expect(createSessionRecord(SESSION, TOKEN)).resolves.toBe(true);

      const [url, init] = lastCall(fetchMock);
      expect(url).toBe('/api/sessions');
      expect(init.method).toBe('POST');
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toContain(TOKEN);
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual(SESSION);
    });

    it('returns false on non-OK responses', async () => {
      stubFetch(jsonResponse({}, 500));
      await expect(createSessionRecord(SESSION, TOKEN)).resolves.toBe(false);
    });

    it('returns false and warns when the request throws', async () => {
      stubFetch(new Error('offline'));
      await expect(createSessionRecord(SESSION, TOKEN)).resolves.toBe(false);
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('updateSessionRecord', () => {
    it('PATCHes the encoded session id with the patch body', async () => {
      const fetchMock = stubFetch(jsonResponse({}));

      await expect(updateSessionRecord('a/b', { title: 'New' }, TOKEN)).resolves.toBe(true);

      const [url, init] = lastCall(fetchMock);
      expect(url).toBe('/api/sessions/a%2Fb');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ title: 'New' });
    });

    it('warns with the status code on failure', async () => {
      stubFetch(jsonResponse({}, 409));
      await expect(updateSessionRecord('session-1', { title: 'x' }, TOKEN)).resolves.toBe(false);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('409'));
    });
  });

  describe('endSessionRecord', () => {
    const utterance: Utterance = {
      id: 'u1',
      speakerId: 's1',
      speakerLabel: 'Speaker 1',
      originalText: 'hello',
      translatedTexts: { es: 'hola' },
      detectedLanguage: 'en-US',
      timestamp: 100,
    } as Utterance;

    it('POSTs counts, guests and trimmed utterances', async () => {
      const fetchMock = stubFetch(jsonResponse({}));

      await expect(endSessionRecord('session-1', 2, [], TOKEN, [utterance])).resolves.toBe(true);

      const [url, init] = lastCall(fetchMock);
      expect(url).toBe('/api/sessions/session-1/end');
      const body = JSON.parse(init.body as string);
      expect(body.utteranceCount).toBe(2);
      expect(body.guests).toEqual([]);
      expect(body.utterances).toEqual([
        {
          id: 'u1',
          speakerLabel: 'Speaker 1',
          originalText: 'hello',
          translatedTexts: { es: 'hola' },
          detectedLanguage: 'en-US',
          timestamp: 100,
        },
      ]);
      // Internal-only fields are not persisted.
      expect(body.utterances[0]).not.toHaveProperty('speakerId');
    });

    it('omits utterances when none are supplied', async () => {
      const fetchMock = stubFetch(jsonResponse({}));

      await endSessionRecord('session-1', 0, [], TOKEN);

      const [, init] = lastCall(fetchMock);
      expect(JSON.parse(init.body as string).utterances).toBeUndefined();
    });

    it('returns false on failure', async () => {
      stubFetch(jsonResponse({}, 500));
      await expect(endSessionRecord('session-1', 0, [], TOKEN)).resolves.toBe(false);
    });
  });

  describe('resumeSessionRecord', () => {
    it('clears end metadata and marks the session active', async () => {
      const fetchMock = stubFetch(jsonResponse({}));

      await expect(resumeSessionRecord('session-1', TOKEN)).resolves.toBe(true);

      const [, init] = lastCall(fetchMock);
      expect(JSON.parse(init.body as string)).toEqual({ status: 'active', endedAt: null, durationMs: null });
    });
  });

  describe('uploadSessionAudio', () => {
    it('uploads multipart form data and returns the audio URL', async () => {
      const fetchMock = stubFetch(jsonResponse({ audioUrl: 'https://blob/audio.webm' }));

      const blob = new Blob(['abc'], { type: 'audio/webm' });
      await expect(uploadSessionAudio('session-1', blob, TOKEN)).resolves.toBe('https://blob/audio.webm');

      const [url, init] = lastCall(fetchMock);
      expect(url).toBe('/api/sessions/session-1/audio');
      expect(init.body).toBeInstanceOf(FormData);
      // Content-Type must be left to the browser for multipart boundaries.
      expect(new Headers(init.headers).get('Content-Type')).toBeNull();
      const file = (init.body as FormData).get('audio') as File;
      expect(file.name).toBe('session-session-1.webm');
    });

    it('returns null when the upload fails', async () => {
      stubFetch(jsonResponse({}, 413));
      await expect(uploadSessionAudio('session-1', new Blob(['a']), TOKEN)).resolves.toBeNull();
    });

    it('returns null when the response has no audio URL', async () => {
      stubFetch(jsonResponse({}));
      await expect(uploadSessionAudio('session-1', new Blob(['a']), TOKEN)).resolves.toBeNull();
    });
  });

  describe('session queries', () => {
    it('fetchRecentSessions uses the default limit', async () => {
      const fetchMock = stubFetch(jsonResponse([SESSION]));

      await expect(fetchRecentSessions(TOKEN)).resolves.toEqual([SESSION]);
      expect(lastCall(fetchMock)[0]).toBe('/api/sessions?limit=10');
    });

    it('fetchRecentSessions returns an empty list on error', async () => {
      stubFetch(jsonResponse({}, 500));
      await expect(fetchRecentSessions(TOKEN)).resolves.toEqual([]);
    });

    it('fetchSessionHistory forwards limit and offset', async () => {
      const fetchMock = stubFetch(jsonResponse([]));

      await fetchSessionHistory(TOKEN, { limit: 25, offset: 50 });
      expect(lastCall(fetchMock)[0]).toBe('/api/sessions?limit=25&offset=50');
    });

    it('fetchSessionHistory omits absent params', async () => {
      const fetchMock = stubFetch(jsonResponse([]));

      await fetchSessionHistory(TOKEN);
      expect(lastCall(fetchMock)[0]).toBe('/api/sessions?');
    });

    it('fetchSession returns null when not found', async () => {
      stubFetch(jsonResponse({ error: 'not found' }, 404));
      await expect(fetchSession('missing', TOKEN)).resolves.toBeNull();
    });

    it('fetchSession returns the record when found', async () => {
      stubFetch(jsonResponse(SESSION));
      await expect(fetchSession('session-1', TOKEN)).resolves.toEqual(SESSION);
    });

    it('deleteSessionRecord issues a DELETE request', async () => {
      const fetchMock = stubFetch(jsonResponse({}, 200));

      await expect(deleteSessionRecord('session-1', TOKEN)).resolves.toBe(true);
      const [url, init] = lastCall(fetchMock);
      expect(url).toBe('/api/sessions/session-1');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('user settings', () => {
    it('fetchUserSettings returns parsed settings', async () => {
      stubFetch(jsonResponse({ microphoneDeviceId: 'mic-1', translationMode: 'realtime' }));

      await expect(fetchUserSettings('user-1', TOKEN)).resolves.toEqual({
        microphoneDeviceId: 'mic-1',
        translationMode: 'realtime',
      });
    });

    it('fetchUserSettings returns null when missing', async () => {
      stubFetch(jsonResponse({}, 404));
      await expect(fetchUserSettings('user-1', TOKEN)).resolves.toBeNull();
    });

    it('saveUserSettings PUTs the settings for the encoded user id', async () => {
      const fetchMock = stubFetch(jsonResponse({}));

      await expect(saveUserSettings('user one', { microphoneDeviceId: '', translationMode: 'standard' }, TOKEN)).resolves.toBe(true);

      const [url, init] = lastCall(fetchMock);
      expect(url).toBe('/api/settings/user%20one');
      expect(init.method).toBe('PUT');
    });

    it('saveUserSettings returns false when the request throws', async () => {
      stubFetch(new Error('offline'));
      await expect(saveUserSettings('user-1', { microphoneDeviceId: '', translationMode: 'standard' }, TOKEN)).resolves.toBe(false);
    });
  });
});
