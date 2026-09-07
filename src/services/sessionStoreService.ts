import { config } from '../config';
import type { SessionRecord, SessionGuest, Utterance, SessionUtterance } from '../types';

function apiBase(): string {
  return config.signalingEndpoint || '';
}

async function apiFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', 'Bearer ' + accessToken);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${apiBase()}${path}`, {
    ...init,
    headers,
  });
}

export async function createSessionRecord(record: SessionRecord, accessToken: string): Promise<boolean> {
  try {
    const response = await apiFetch('/api/sessions', accessToken, {
      method: 'POST',
      body: JSON.stringify(record),
    });
    return response.ok;
  } catch {
    console.warn('[sessionStore] Failed to create session record');
    return false;
  }
}

export async function updateSessionRecord(
  sessionId: string,
  patch: Partial<SessionRecord>,
  accessToken: string,
): Promise<void> {
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, accessToken, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  } catch {
    console.warn('[sessionStore] Failed to update session record');
  }
}

function toSessionUtterance(utterance: Utterance): SessionUtterance {
  return {
    id: utterance.id,
    speakerLabel: utterance.speakerLabel,
    originalText: utterance.originalText,
    translatedTexts: utterance.translatedTexts,
    detectedLanguage: utterance.detectedLanguage,
    timestamp: utterance.timestamp,
  };
}

export async function endSessionRecord(
  sessionId: string,
  utteranceCount: number,
  guests: SessionGuest[],
  accessToken: string,
  utterances?: Utterance[],
): Promise<void> {
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/end`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        utteranceCount,
        guests,
        utterances: utterances?.map(toSessionUtterance),
      }),
    });
  } catch {
    console.warn('[sessionStore] Failed to end session record');
  }
}

export async function resumeSessionRecord(sessionId: string, accessToken: string): Promise<boolean> {
  try {
    const response = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active', endedAt: null, durationMs: null }),
    });
    return response.ok;
  } catch {
    console.warn('[sessionStore] Failed to resume session record');
    return false;
  }
}

export async function uploadSessionAudio(
  sessionId: string,
  audioBlob: Blob,
  accessToken: string,
): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, `session-${sessionId}.webm`);
    const response = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/audio`, accessToken, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.audioUrl ?? null;
  } catch {
    console.warn('[sessionStore] Failed to upload audio');
    return null;
  }
}

export async function fetchRecentSessions(accessToken: string, limit = 10): Promise<SessionRecord[]> {
  try {
    const response = await apiFetch(`/api/sessions?limit=${limit}`, accessToken);
    if (!response.ok) return [];
    return response.json();
  } catch {
    console.warn('[sessionStore] Failed to fetch sessions');
    return [];
  }
}

export async function fetchSessionHistory(
  accessToken: string,
  params?: { limit?: number; offset?: number },
): Promise<SessionRecord[]> {
  try {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const response = await apiFetch(`/api/sessions?${query.toString()}`, accessToken);
    if (!response.ok) return [];
    return response.json();
  } catch {
    console.warn('[sessionStore] Failed to fetch session history');
    return [];
  }
}

export async function fetchSession(sessionId: string, accessToken: string): Promise<SessionRecord | null> {
  try {
    const response = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, accessToken);
    if (!response.ok) return null;
    return response.json();
  } catch {
    console.warn('[sessionStore] Failed to fetch session');
    return null;
  }
}

export async function deleteSessionRecord(sessionId: string, accessToken: string): Promise<boolean> {
  try {
    const response = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, accessToken, {
      method: 'DELETE',
    });
    return response.ok;
  } catch {
    console.warn('[sessionStore] Failed to delete session');
    return false;
  }
}

export function createDebouncedUpdater(
  sessionId: string,
  getAccessToken: () => Promise<string>,
  intervalMs = 5000,
) {
  let pending: Partial<SessionRecord> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flushPending() {
    const nextPatch = pending;
    pending = null;
    timer = null;
    if (!nextPatch) return;

    try {
      const accessToken = await getAccessToken();
      await updateSessionRecord(sessionId, nextPatch, accessToken);
    } catch {
      console.warn('[sessionStore] Failed to flush debounced session update');
    }
  }

  return {
    update(patch: Partial<SessionRecord>) {
      pending = { ...pending, ...patch };
      if (!timer) {
        timer = setTimeout(() => {
          void flushPending();
        }, intervalMs);
      }
    },
    async flush() {
      if (timer) clearTimeout(timer);
      await flushPending();
    },
  };
}

export interface PersistedSettings {
  microphoneDeviceId: string;
  translationMode: 'standard' | 'realtime';
}

export async function fetchUserSettings(userId: string, accessToken: string): Promise<PersistedSettings | null> {
  try {
    const response = await apiFetch(`/api/settings/${encodeURIComponent(userId)}`, accessToken);
    if (!response.ok) return null;
    return response.json();
  } catch {
    console.warn('[sessionStore] Failed to fetch user settings');
    return null;
  }
}

export async function saveUserSettings(
  userId: string,
  settings: PersistedSettings,
  accessToken: string,
): Promise<boolean> {
  try {
    const response = await apiFetch(`/api/settings/${encodeURIComponent(userId)}`, accessToken, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    return response.ok;
  } catch {
    console.warn('[sessionStore] Failed to save user settings');
    return false;
  }
}
