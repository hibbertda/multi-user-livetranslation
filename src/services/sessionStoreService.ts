import { config } from '../config';
import type { SessionRecord, SessionGuest, Utterance, SessionUtterance } from '../types';

/**
 * Client-side service to persist session records via the session API (Azure Function).
 * The API proxies to Cosmos DB and Blob Storage.
 * All calls are fire-and-forget (non-blocking) unless awaited explicitly.
 */

function apiBase(): string {
  return config.signalingEndpoint || '';
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${apiBase()}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}

/** Create a new session record */
export async function createSessionRecord(record: SessionRecord): Promise<void> {
  try {
    await apiFetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(record),
    });
  } catch {
    console.warn('[sessionStore] Failed to create session record');
  }
}

/** Update a session record (partial patch) */
export async function updateSessionRecord(
  sessionId: string,
  patch: Partial<SessionRecord>,
): Promise<void> {
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  } catch {
    console.warn('[sessionStore] Failed to update session record');
  }
}

/** End a session — sets endedAt, durationMs, status */
/** Convert full Utterance to lightweight SessionUtterance for storage */
function toSessionUtterance(u: Utterance): SessionUtterance {
  return {
    id: u.id,
    speakerLabel: u.speakerLabel,
    originalText: u.originalText,
    translatedTexts: u.translatedTexts,
    detectedLanguage: u.detectedLanguage,
    timestamp: u.timestamp,
  };
}

export async function endSessionRecord(
  sessionId: string,
  utteranceCount: number,
  guests: SessionGuest[],
  utterances?: Utterance[],
): Promise<void> {
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/end`, {
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

/** Resume a session — sets status back to active */
export async function resumeSessionRecord(sessionId: string): Promise<void> {
  try {
    await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active', endedAt: null, durationMs: null }),
    });
  } catch {
    console.warn('[sessionStore] Failed to resume session record');
  }
}

/** Upload audio blob after session ends */
export async function uploadSessionAudio(
  sessionId: string,
  audioBlob: Blob,
): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, `session-${sessionId}.webm`);
    const res = await fetch(`${apiBase()}/api/sessions/${encodeURIComponent(sessionId)}/audio`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.audioUrl ?? null;
  } catch {
    console.warn('[sessionStore] Failed to upload audio');
    return null;
  }
}

/** Fetch recent sessions for the current user */
export async function fetchRecentSessions(limit = 10): Promise<SessionRecord[]> {
  try {
    const res = await apiFetch(`/api/sessions?limit=${limit}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    console.warn('[sessionStore] Failed to fetch sessions');
    return [];
  }
}

/** Fetch all sessions with optional filters */
export async function fetchSessionHistory(params?: {
  limit?: number;
  offset?: number;
}): Promise<SessionRecord[]> {
  try {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const res = await apiFetch(`/api/sessions?${query.toString()}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    console.warn('[sessionStore] Failed to fetch session history');
    return [];
  }
}

/** Fetch a single session with full transcript */
export async function fetchSession(sessionId: string): Promise<SessionRecord | null> {
  try {
    const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    console.warn('[sessionStore] Failed to fetch session');
    return null;
  }
}

/** Delete a session permanently */
export async function deleteSessionRecord(sessionId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    console.warn('[sessionStore] Failed to delete session');
    return false;
  }
}

/**
 * Debounced updater — batches utterance count updates so we don't
 * hammer Cosmos on every single utterance.
 */
export function createDebouncedUpdater(sessionId: string, intervalMs = 5000) {
  let pending: Partial<SessionRecord> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (pending) {
      void updateSessionRecord(sessionId, pending);
      pending = null;
    }
    timer = null;
  }

  return {
    update(patch: Partial<SessionRecord>) {
      pending = { ...pending, ...patch };
      if (!timer) {
        timer = setTimeout(flush, intervalMs);
      }
    },
    flush() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}

// --------------- User Settings ---------------

export interface PersistedSettings {
  microphoneDeviceId: string;
  translationMode: 'standard' | 'realtime';
}

/** Fetch user settings from Cosmos DB */
export async function fetchUserSettings(userId: string): Promise<PersistedSettings | null> {
  try {
    const res = await apiFetch(`/api/settings/${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    console.warn('[sessionStore] Failed to fetch user settings');
    return null;
  }
}

/** Save user settings to Cosmos DB */
export async function saveUserSettings(userId: string, settings: PersistedSettings): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/settings/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    return res.ok;
  } catch {
    console.warn('[sessionStore] Failed to save user settings');
    return false;
  }
}
