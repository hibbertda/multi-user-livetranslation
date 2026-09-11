import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock external boundaries ────────────────────────────────────────

vi.mock('@azure/functions', () => ({
  app: { http: vi.fn(), timer: vi.fn() },
}));

vi.mock('../cosmos.js', () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  replaceSession: vi.fn(),
  patchSession: vi.fn(),
  deleteSession: vi.fn(),
  listSessions: vi.fn(),
  createGuestRequest: vi.fn(),
  getGuestRequest: vi.fn(),
  patchGuestRequest: vi.fn(),
  countPendingGuestRequests: vi.fn(),
  listPendingGuestRequests: vi.fn(),
  listGuestRequestsForSession: vi.fn(),
  findApprovedGuestRequestByTicketHash: vi.fn(),
  upsertGuestAdmission: vi.fn(),
  getGuestAdmission: vi.fn(),
  getGuestAdmissionByUserId: vi.fn(),
  patchGuestAdmission: vi.fn(),
  listGuestAdmissionsForSession: vi.fn(),
  listPresentGuestAdmissions: vi.fn(),
  appendSessionGuest: vi.fn(),
  removeSessionGuest: vi.fn(),
  endSession: vi.fn(),
  getUserSettings: vi.fn(),
  upsertUserSettings: vi.fn(),
}));

vi.mock('../storage.js', () => ({
  uploadAudio: vi.fn(),
  deleteAudioBlob: vi.fn(),
  BlobConflictError: class BlobConflictError extends Error {},
  normaliseAllowedMime: vi.fn(() => 'audio/webm'),
  validateMagicBytes: vi.fn(() => true),
  getMaxUploadBytes: vi.fn(() => 1024),
  audioBlobName: vi.fn((id: string) => `session-${id}.webm`),
  isBlobAlreadyExistsError: vi.fn(() => false),
}));

vi.mock('../pubsub.js', () => ({
  getHostClientUrl: vi.fn().mockResolvedValue('wss://mock/host'),
  getGuestClientUrl: vi.fn().mockResolvedValue('wss://mock/guest'),
  getGuestUserId: vi.fn((s: string, g: string) => `guest:${s}:${g}`),
  sendGroupMessage: vi.fn().mockResolvedValue(undefined),
  sendUserMessage: vi.fn().mockResolvedValue(undefined),
  removeConnectionFromSession: vi.fn().mockResolvedValue(undefined),
}));

import type { GuestAdmissionRecord, SessionRecord } from '../cosmos.js';
import * as cosmos from '../cosmos.js';
import * as pubsub from '../pubsub.js';

import {
  guestLeaveHandler,
  guestHeartbeatHandler,
  webPubSubEventHandler,
  sweepGuestLiveness,
  isAdmissionExpired,
  getGuestTimeoutMs,
  getGuestDisconnectGraceMs,
} from '../index.js';

// ── Helpers ─────────────────────────────────────────────────────────

interface MockReqOpts {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  jsonThrows?: boolean;
}

function makeReq(opts: MockReqOpts = {}): Record<string, unknown> {
  const headers = new Map(Object.entries(opts.headers ?? {}));
  const query = new Map(Object.entries(opts.query ?? {}));
  return {
    method: opts.method ?? 'POST',
    headers: { get: (k: string) => headers.get(k) ?? null, has: (k: string) => headers.has(k) },
    params: {},
    query: { get: (k: string) => query.get(k) ?? null },
    json: async () => {
      if (opts.jsonThrows) throw new Error('invalid json');
      return opts.body ?? {};
    },
  };
}

function parseBody(res: { body?: string | null }): Record<string, unknown> {
  return res.body ? JSON.parse(res.body) : {};
}

const SESSION_ID = 'session-1';
const GUEST_ID = 'guest-1';

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SESSION_ID,
    ownerId: 'owner',
    title: 'Session',
    hostName: 'Host',
    languageA: 'en-US',
    languageB: 'es-ES',
    invites: [],
    guests: [],
    utteranceCount: 0,
    startedAt: Date.now(),
    status: 'active',
    ...overrides,
  };
}

function makeAdmission(overrides: Partial<GuestAdmissionRecord> = {}): GuestAdmissionRecord {
  return {
    id: GUEST_ID,
    type: 'guestAdmission',
    sessionId: SESSION_ID,
    requestId: 'request-1',
    guestId: GUEST_ID,
    guestName: 'Guest One',
    language: 'es-ES',
    admittedAt: Date.now(),
    revoked: false,
    userId: `guest:${SESSION_ID}:${GUEST_ID}`,
    ...overrides,
  };
}

const identity = { sessionId: SESSION_ID, guestId: GUEST_ID, admissionId: GUEST_ID };

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks drops implementations, so restore the promise-returning ones.
  vi.mocked(pubsub.sendGroupMessage).mockResolvedValue(undefined);
  vi.mocked(pubsub.sendUserMessage).mockResolvedValue(undefined);
  vi.mocked(pubsub.removeConnectionFromSession).mockResolvedValue(undefined);
  vi.mocked(cosmos.patchGuestAdmission).mockResolvedValue(undefined);
  vi.mocked(cosmos.removeSessionGuest).mockResolvedValue(undefined);
  vi.mocked(cosmos.getSession).mockResolvedValue(makeSession());
  vi.mocked(cosmos.getGuestAdmission).mockResolvedValue(makeAdmission());
});

// ── POST /api/guest/leave ───────────────────────────────────────────

describe('guestLeaveHandler', () => {
  it('removes the guest and broadcasts a leave message', async () => {
    const res = await guestLeaveHandler(makeReq({ body: identity }) as never);

    expect(res.status ?? 200).toBe(200);
    expect(parseBody(res as { body?: string }).ok).toBe(true);
    expect(cosmos.removeSessionGuest).toHaveBeenCalledWith(SESSION_ID, GUEST_ID);
    expect(cosmos.patchGuestAdmission).toHaveBeenCalledWith(
      GUEST_ID,
      expect.objectContaining({ left: true, leftReason: 'left' }),
    );
    expect(pubsub.sendGroupMessage).toHaveBeenCalledWith(SESSION_ID, {
      type: 'leave',
      guestId: GUEST_ID,
      reason: 'left',
    });
  });

  it('answers OPTIONS preflight without touching state', async () => {
    const res = await guestLeaveHandler(makeReq({ method: 'OPTIONS' }) as never);

    expect(res.status).toBe(204);
    expect(cosmos.removeSessionGuest).not.toHaveBeenCalled();
  });

  it('rejects payloads missing identifiers', async () => {
    const res = await guestLeaveHandler(makeReq({ body: { sessionId: SESSION_ID } }) as never);

    expect(res.status).toBe(400);
    expect(cosmos.removeSessionGuest).not.toHaveBeenCalled();
  });

  it('rejects a mismatched guest and admission id', async () => {
    const res = await guestLeaveHandler(makeReq({
      body: { sessionId: SESSION_ID, guestId: GUEST_ID, admissionId: 'someone-else' },
    }) as never);

    expect(res.status).toBe(400);
    expect(pubsub.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('tolerates an unparsable body', async () => {
    const res = await guestLeaveHandler(makeReq({ jsonThrows: true }) as never);

    expect(res.status).toBe(400);
  });

  it('is a no-op for an unknown admission', async () => {
    vi.mocked(cosmos.getGuestAdmission).mockResolvedValue(null);

    const res = await guestLeaveHandler(makeReq({ body: identity }) as never);

    expect(res.status ?? 200).toBe(200);
    expect(pubsub.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('refuses to remove a guest belonging to another session', async () => {
    vi.mocked(cosmos.getGuestAdmission).mockResolvedValue(makeAdmission({ sessionId: 'other-session' }));

    const res = await guestLeaveHandler(makeReq({ body: identity }) as never);

    expect(res.status ?? 200).toBe(200);
    expect(cosmos.removeSessionGuest).not.toHaveBeenCalled();
    expect(pubsub.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('acknowledges a revoked admission without re-broadcasting', async () => {
    vi.mocked(cosmos.getGuestAdmission).mockResolvedValue(makeAdmission({ revoked: true }));

    const res = await guestLeaveHandler(makeReq({ body: identity }) as never);

    expect(res.status ?? 200).toBe(200);
    expect(pubsub.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('is idempotent when the guest already left', async () => {
    vi.mocked(cosmos.getGuestAdmission).mockResolvedValue(makeAdmission({ left: true }));

    const res = await guestLeaveHandler(makeReq({ body: identity }) as never);

    expect(res.status ?? 200).toBe(200);
    expect(cosmos.removeSessionGuest).not.toHaveBeenCalled();
    expect(pubsub.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('drops the guest connection from the session group when known', async () => {
    vi.mocked(cosmos.getGuestAdmission).mockResolvedValue(makeAdmission({ connectionId: 'conn-1' }));

    await guestLeaveHandler(makeReq({ body: identity }) as never);

    expect(pubsub.removeConnectionFromSession).toHaveBeenCalledWith(SESSION_ID, 'conn-1');
  });
});

// ── POST /api/guest/heartbeat ───────────────────────────────────────

describe('guestHeartbeatHandler', () => {
  it('records liveness and clears a pending disconnect', async () => {
    const res = await guestHeartbeatHandler(makeReq({ body: identity }) as never);

    expect(res.status ?? 200).toBe(200);
    expect(cosmos.patchGuestAdmission).toHaveBeenCalledWith(
      GUEST_ID,
      expect.objectContaining({ disconnectedAt: null }),
    );
    const patch = vi.mocked(cosmos.patchGuestAdmission).mock.calls[0][1] as GuestAdmissionRecord;
    expect(typeof patch.lastSeenAt).toBe('number');
  });

  it('rejects a heartbeat without identifiers', async () => {
    const res = await guestHeartbeatHandler(makeReq({ body: {} }) as never);

    expect(res.status).toBe(400);
    expect(cosmos.patchGuestAdmission).not.toHaveBeenCalled();
  });

  it('rejects a heartbeat for a revoked admission', async () => {
    vi.mocked(cosmos.getGuestAdmission).mockResolvedValue(makeAdmission({ revoked: true }));

    const res = await guestHeartbeatHandler(makeReq({ body: identity }) as never);

    expect(res.status).toBe(403);
  });

  it('rejects a heartbeat once the session has ended', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(makeSession({ status: 'ended' }));

    const res = await guestHeartbeatHandler(makeReq({ body: identity }) as never);

    expect(res.status).toBe(410);
  });

  it('rate limits an excessively chatty guest', async () => {
    const chatty = { sessionId: SESSION_ID, guestId: 'chatty', admissionId: 'chatty' };
    vi.mocked(cosmos.getGuestAdmission).mockResolvedValue(makeAdmission({ id: 'chatty', guestId: 'chatty' }));

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await guestHeartbeatHandler(makeReq({ body: chatty }) as never);
      statuses.push(res.status ?? 200);
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });
});

// ── Web PubSub CloudEvents webhook ──────────────────────────────────

describe('webPubSubEventHandler', () => {
  const SECRET = 'webhook-secret';

  beforeEach(() => {
    process.env.WEBPUBSUB_EVENT_SECRET = SECRET;
    delete process.env.WEBPUBSUB_EVENT_ORIGIN;
    vi.mocked(cosmos.getGuestAdmissionByUserId).mockResolvedValue(makeAdmission());
  });

  afterEach(() => {
    delete process.env.WEBPUBSUB_EVENT_SECRET;
    delete process.env.WEBPUBSUB_EVENT_ORIGIN;
  });

  it('rejects requests without the shared secret', async () => {
    const res = await webPubSubEventHandler(makeReq({
      headers: { 'ce-type': 'azure.webpubsub.sys.connected' },
    }) as never);

    expect(res.status).toBe(401);
    expect(cosmos.patchGuestAdmission).not.toHaveBeenCalled();
  });

  it('rejects requests with the wrong secret', async () => {
    const res = await webPubSubEventHandler(makeReq({ query: { secret: 'nope' } }) as never);

    expect(res.status).toBe(401);
  });

  it('rejects everything when no secret is configured', async () => {
    delete process.env.WEBPUBSUB_EVENT_SECRET;

    const res = await webPubSubEventHandler(makeReq({ query: { secret: SECRET } }) as never);

    expect(res.status).toBe(401);
  });

  it('completes the abuse protection handshake', async () => {
    const res = await webPubSubEventHandler(makeReq({
      method: 'OPTIONS',
      query: { secret: SECRET },
      headers: { 'webhook-request-origin': 'hub.webpubsub.azure.com' },
    }) as never);

    expect(res.status).toBe(200);
    expect(res.headers?.['WebHook-Allowed-Origin']).toBe('hub.webpubsub.azure.com');
  });

  it('rejects a handshake without an origin', async () => {
    const res = await webPubSubEventHandler(makeReq({ method: 'OPTIONS', query: { secret: SECRET } }) as never);

    expect(res.status).toBe(400);
  });

  it('rejects a handshake from an unexpected origin', async () => {
    process.env.WEBPUBSUB_EVENT_ORIGIN = 'hub.webpubsub.azure.com';

    const res = await webPubSubEventHandler(makeReq({
      method: 'OPTIONS',
      query: { secret: SECRET },
      headers: { 'webhook-request-origin': 'evil.example.com' },
    }) as never);

    expect(res.status).toBe(403);
  });

  it('stores the connection id when a guest connects', async () => {
    const res = await webPubSubEventHandler(makeReq({
      query: { secret: SECRET },
      headers: {
        'ce-type': 'azure.webpubsub.sys.connected',
        'ce-userid': `guest:${SESSION_ID}:${GUEST_ID}`,
        'ce-connectionid': 'conn-9',
      },
    }) as never);

    expect(res.status).toBe(200);
    expect(cosmos.patchGuestAdmission).toHaveBeenCalledWith(
      GUEST_ID,
      expect.objectContaining({ connectionId: 'conn-9', disconnectedAt: null }),
    );
  });

  it('starts the grace period when a guest disconnects', async () => {
    const res = await webPubSubEventHandler(makeReq({
      query: { secret: SECRET },
      headers: {
        'ce-type': 'azure.webpubsub.sys.disconnected',
        'ce-userid': `guest:${SESSION_ID}:${GUEST_ID}`,
        'ce-connectionid': 'conn-9',
      },
    }) as never);

    expect(res.status).toBe(200);
    const patch = vi.mocked(cosmos.patchGuestAdmission).mock.calls[0][1] as GuestAdmissionRecord;
    expect(typeof patch.disconnectedAt).toBe('number');
    // The disconnect alone must not remove the guest — the sweeper decides later.
    expect(pubsub.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('ignores a disconnect for a superseded connection', async () => {
    vi.mocked(cosmos.getGuestAdmissionByUserId).mockResolvedValue(makeAdmission({ connectionId: 'conn-new' }));

    await webPubSubEventHandler(makeReq({
      query: { secret: SECRET },
      headers: {
        'ce-type': 'azure.webpubsub.sys.disconnected',
        'ce-userid': `guest:${SESSION_ID}:${GUEST_ID}`,
        'ce-connectionid': 'conn-old',
      },
    }) as never);

    expect(cosmos.patchGuestAdmission).not.toHaveBeenCalled();
  });

  it('ignores host connections', async () => {
    await webPubSubEventHandler(makeReq({
      query: { secret: SECRET },
      headers: {
        'ce-type': 'azure.webpubsub.sys.connected',
        'ce-userid': `host:${SESSION_ID}:owner`,
      },
    }) as never);

    expect(cosmos.getGuestAdmissionByUserId).not.toHaveBeenCalled();
  });

  it('ignores unrelated event types', async () => {
    await webPubSubEventHandler(makeReq({
      query: { secret: SECRET },
      headers: {
        'ce-type': 'azure.webpubsub.user.message',
        'ce-userid': `guest:${SESSION_ID}:${GUEST_ID}`,
      },
    }) as never);

    expect(cosmos.patchGuestAdmission).not.toHaveBeenCalled();
  });

  it('ignores events for an unknown admission', async () => {
    vi.mocked(cosmos.getGuestAdmissionByUserId).mockResolvedValue(null);

    const res = await webPubSubEventHandler(makeReq({
      query: { secret: SECRET },
      headers: {
        'ce-type': 'azure.webpubsub.sys.connected',
        'ce-userid': `guest:${SESSION_ID}:${GUEST_ID}`,
      },
    }) as never);

    expect(res.status).toBe(200);
    expect(cosmos.patchGuestAdmission).not.toHaveBeenCalled();
  });

  it('accepts the secret from a header as well as the query string', async () => {
    const res = await webPubSubEventHandler(makeReq({
      headers: {
        'x-webpubsub-event-secret': SECRET,
        'ce-type': 'azure.webpubsub.sys.connected',
        'ce-userid': `guest:${SESSION_ID}:${GUEST_ID}`,
      },
    }) as never);

    expect(res.status).toBe(200);
  });
});

// ── Liveness sweeper ────────────────────────────────────────────────

describe('guest liveness thresholds', () => {
  afterEach(() => {
    delete process.env.GUEST_TIMEOUT_MS;
    delete process.env.GUEST_DISCONNECT_GRACE_MS;
  });

  it('falls back to defaults when unset', () => {
    expect(getGuestTimeoutMs()).toBe(90_000);
    expect(getGuestDisconnectGraceMs()).toBe(30_000);
  });

  it('reads overrides from app settings', () => {
    process.env.GUEST_TIMEOUT_MS = '5000';
    process.env.GUEST_DISCONNECT_GRACE_MS = '1000';

    expect(getGuestTimeoutMs()).toBe(5_000);
    expect(getGuestDisconnectGraceMs()).toBe(1_000);
  });

  it('ignores nonsense overrides', () => {
    process.env.GUEST_TIMEOUT_MS = 'not-a-number';
    process.env.GUEST_DISCONNECT_GRACE_MS = '-1';

    expect(getGuestTimeoutMs()).toBe(90_000);
    expect(getGuestDisconnectGraceMs()).toBe(30_000);
  });
});

describe('isAdmissionExpired', () => {
  const now = 1_000_000;

  it('keeps a guest with a fresh heartbeat', () => {
    const admission = makeAdmission({ lastSeenAt: now - 1_000 });
    expect(isAdmissionExpired(admission, now, 90_000, 30_000)).toBe(false);
  });

  it('expires a guest whose heartbeat is stale', () => {
    const admission = makeAdmission({ lastSeenAt: now - 90_001 });
    expect(isAdmissionExpired(admission, now, 90_000, 30_000)).toBe(true);
  });

  it('falls back to the admission time when never seen', () => {
    const admission = makeAdmission({ admittedAt: now - 120_000, lastSeenAt: undefined });
    expect(isAdmissionExpired(admission, now, 90_000, 30_000)).toBe(true);
  });

  it('keeps a recently disconnected guest inside the grace period', () => {
    const admission = makeAdmission({ lastSeenAt: now, disconnectedAt: now - 29_999 });
    expect(isAdmissionExpired(admission, now, 90_000, 30_000)).toBe(false);
  });

  it('expires a guest once the grace period elapses', () => {
    const admission = makeAdmission({ lastSeenAt: now, disconnectedAt: now - 30_000 });
    expect(isAdmissionExpired(admission, now, 90_000, 30_000)).toBe(true);
  });
});

describe('sweepGuestLiveness', () => {
  const now = 2_000_000;

  it('removes only the expired guests', async () => {
    const fresh = makeAdmission({ id: 'fresh', guestId: 'fresh', lastSeenAt: now - 1_000 });
    const stale = makeAdmission({ id: 'stale', guestId: 'stale', lastSeenAt: now - 200_000 });
    vi.mocked(cosmos.listPresentGuestAdmissions).mockResolvedValue([fresh, stale]);

    const result = await sweepGuestLiveness(now);

    expect(result.removed).toBe(1);
    expect(cosmos.removeSessionGuest).toHaveBeenCalledTimes(1);
    expect(cosmos.removeSessionGuest).toHaveBeenCalledWith(SESSION_ID, 'stale');
    expect(pubsub.sendGroupMessage).toHaveBeenCalledWith(SESSION_ID, {
      type: 'leave',
      guestId: 'stale',
      reason: 'timeout',
    });
  });

  it('removes a guest whose disconnect grace period expired', async () => {
    const dropped = makeAdmission({ id: 'dropped', guestId: 'dropped', lastSeenAt: now, disconnectedAt: now - 60_000 });
    vi.mocked(cosmos.listPresentGuestAdmissions).mockResolvedValue([dropped]);

    const result = await sweepGuestLiveness(now);

    expect(result.removed).toBe(1);
    expect(cosmos.patchGuestAdmission).toHaveBeenCalledWith(
      'dropped',
      expect.objectContaining({ left: true, leftReason: 'timeout' }),
    );
  });

  it('never re-removes a guest that already left', async () => {
    const alreadyLeft = makeAdmission({ id: 'gone', guestId: 'gone', lastSeenAt: now - 200_000, left: true });
    vi.mocked(cosmos.listPresentGuestAdmissions).mockResolvedValue([alreadyLeft]);

    const result = await sweepGuestLiveness(now);

    expect(result.removed).toBe(0);
    expect(pubsub.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('does nothing when nothing is expired', async () => {
    vi.mocked(cosmos.listPresentGuestAdmissions).mockResolvedValue([makeAdmission({ lastSeenAt: now })]);

    const result = await sweepGuestLiveness(now);

    expect(result.removed).toBe(0);
    expect(cosmos.removeSessionGuest).not.toHaveBeenCalled();
  });

  it('keeps sweeping when one removal fails', async () => {
    const bad = makeAdmission({ id: 'bad', guestId: 'bad', lastSeenAt: now - 200_000 });
    const good = makeAdmission({ id: 'good', guestId: 'good', lastSeenAt: now - 200_000 });
    vi.mocked(cosmos.listPresentGuestAdmissions).mockResolvedValue([bad, good]);
    vi.mocked(cosmos.patchGuestAdmission).mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('cosmos unavailable');
    });

    const result = await sweepGuestLiveness(now);

    expect(result.removed).toBe(1);
    expect(cosmos.removeSessionGuest).toHaveBeenCalledWith(SESSION_ID, 'good');
  });

  it('respects configured thresholds', async () => {
    process.env.GUEST_TIMEOUT_MS = '10000';
    vi.mocked(cosmos.listPresentGuestAdmissions).mockResolvedValue([
      makeAdmission({ id: 'edge', guestId: 'edge', lastSeenAt: now - 20_000 }),
    ]);

    const result = await sweepGuestLiveness(now);
    delete process.env.GUEST_TIMEOUT_MS;

    expect(result.removed).toBe(1);
  });
});
