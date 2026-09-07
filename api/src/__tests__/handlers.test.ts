import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// ── Mock external boundaries ────────────────────────────────────────

// Mock @azure/functions – prevent real Azure Function registration
vi.mock('@azure/functions', () => ({
  app: { http: vi.fn() },
}));

// Mock cosmos
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
  patchGuestAdmission: vi.fn(),
  listGuestAdmissionsForSession: vi.fn(),
  appendSessionGuest: vi.fn(),
  removeSessionGuest: vi.fn(),
  endSession: vi.fn(),
  getUserSettings: vi.fn(),
  upsertUserSettings: vi.fn(),
}));

// Mock storage
vi.mock('../storage.js', () => ({
  uploadAudio: vi.fn(),
  deleteAudioBlob: vi.fn(),
  BlobConflictError: class BlobConflictError extends Error {
    constructor(blobName: string) { super(`Blob already exists: ${blobName}`); this.name = 'BlobConflictError'; }
  },
  normaliseAllowedMime: vi.fn((raw: string) => {
    const allowed = new Set([
      'audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus',
      'audio/wav', 'audio/wave', 'audio/mp4', 'video/webm', 'video/webm;codecs=opus',
    ]);
    const n = raw.toLowerCase().replace(/\s*;\s*/g, ';').trim();
    return allowed.has(n) ? n : null;
  }),
  validateMagicBytes: vi.fn(() => true),
  getMaxUploadBytes: vi.fn(() => 100 * 1024 * 1024),
  audioBlobName: vi.fn((id: string) => `session-${id}.webm`),
  isBlobAlreadyExistsError: vi.fn(() => false),
}));

// Mock pubsub
vi.mock('../pubsub.js', () => ({
  getHostClientUrl: vi.fn().mockResolvedValue('wss://mock/host'),
  getGuestClientUrl: vi.fn().mockResolvedValue('wss://mock/guest'),
  getGuestUserId: vi.fn((_s: string, g: string) => `guest:mock:${g}`),
  sendGroupMessage: vi.fn(),
  sendUserMessage: vi.fn(),
  removeConnectionFromSession: vi.fn(),
}));

import type { SessionRecord, GuestRequestRecord } from '../cosmos.js';
import * as cosmos from '../cosmos.js';
import * as pubsub from '../pubsub.js';
import * as storage from '../storage.js';

// Import handlers AFTER mocks are set up
import {
  sessionsHandler,
  sessionByIdHandler,
  guestRequestHandler,
  approveGuestHandler,
  guestExchangeHandler,
  guestRequestStatusHandler,
  uploadAudioHandler,
} from '../index.js';

// ── Helpers ─────────────────────────────────────────────────────────

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function makeClientPrincipal(userId: string) {
  const obj = {
    auth_typ: 'aad',
    claims: [
      { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: userId },
      { typ: 'preferred_username', val: `${userId}@test.com` },
      { typ: 'name', val: 'Test User' },
    ],
  };
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

interface MockReqOpts {
  method?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  formDataEntries?: Record<string, { value: unknown }>;
  formDataError?: boolean;
}

function makeReq(opts: MockReqOpts = {}): Record<string, unknown> {
  const headers = new Map(Object.entries(opts.headers ?? {}));
  const query = new Map(Object.entries(opts.query ?? {}));
  return {
    method: opts.method ?? 'GET',
    headers: {
      get: (k: string) => headers.get(k) ?? null,
      has: (k: string) => headers.has(k),
      entries: () => headers.entries(),
    },
    params: opts.params ?? {},
    query: {
      get: (k: string) => query.get(k) ?? null,
    },
    json: async () => opts.body ?? {},
    formData: opts.formDataError
      ? async () => { throw new Error('bad multipart'); }
      : async () => {
          const entries = opts.formDataEntries ?? {};
          return { get: (k: string) => (entries[k]?.value ?? null) };
        },
  };
}

function makeAuthReq(userId: string, opts: Omit<MockReqOpts, 'headers'> & { headers?: Record<string, string> } = {}) {
  return makeReq({
    ...opts,
    headers: {
      'x-ms-client-principal': makeClientPrincipal(userId),
      ...opts.headers,
    },
  });
}

function parseBody(res: { body?: string | null }): Record<string, unknown> {
  return res.body ? JSON.parse(res.body) : undefined;
}

const OWNER = 'owner-user-id';
const OTHER = 'other-user-id';
const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function activeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SESSION_ID,
    ownerId: OWNER,
    title: 'Test',
    hostName: 'Host',
    languageA: 'en-US',
    languageB: 'es-ES',
    invites: [],
    guests: [],
    utteranceCount: 0,
    startedAt: Date.now() - 60000,
    status: 'active',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Authorization: protected endpoints ──────────────────────────────

describe('authorization', () => {
  it('rejects unauthenticated caller', async () => {
    const res = await sessionsHandler(makeReq());
    expect(res.status).toBe(401);
    expect(parseBody(res).error).toMatch(/Authentication required/i);
  });

  it('rejects non-owner for session-by-id', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    const res = await sessionByIdHandler(makeAuthReq(OTHER, { params: { id: SESSION_ID } }));
    expect(res.status).toBe(403);
  });

  it('owner succeeds for session-by-id GET', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    const res = await sessionByIdHandler(makeAuthReq(OWNER, { params: { id: SESSION_ID } }));
    expect(res.status).toBe(200);
    const body = parseBody(res);
    expect(body.id).toBe(SESSION_ID);
  });
});

// ── Creation / PATCH validation ─────────────────────────────────────

describe('session creation validation', () => {
  it('rejects malformed session ID', async () => {
    const res = await sessionsHandler(makeAuthReq(OWNER, {
      method: 'POST',
      body: { id: 'not-a-uuid', hostName: 'H', languageA: 'en-US', languageB: 'es-ES' },
    }));
    expect(res.status).toBe(400);
    expect(parseBody(res).error).toMatch(/Invalid session ID/i);
  });

  it('rejects unsupported language on create', async () => {
    const res = await sessionsHandler(makeAuthReq(OWNER, {
      method: 'POST',
      body: { id: SESSION_ID, hostName: 'H', languageA: 'xx-YY', languageB: 'es-ES' },
    }));
    expect(res.status).toBe(400);
    expect(parseBody(res).error).toMatch(/Unsupported language/i);
  });

  it('rejects missing required fields', async () => {
    const res = await sessionsHandler(makeAuthReq(OWNER, {
      method: 'POST',
      body: { id: SESSION_ID },
    }));
    expect(res.status).toBe(400);
    expect(parseBody(res).error).toMatch(/Missing required fields/i);
  });

  it('accepts valid create', async () => {
    vi.mocked(cosmos.createSession).mockResolvedValue(undefined);
    const res = await sessionsHandler(makeAuthReq(OWNER, {
      method: 'POST',
      body: { id: SESSION_ID, hostName: 'Host', languageA: 'en-US', languageB: 'es-ES' },
    }));
    expect(res.status).toBe(201);
    expect(cosmos.createSession).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH validation', () => {
  it('rejects unknown fields', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    const res = await sessionByIdHandler(makeAuthReq(OWNER, {
      method: 'PATCH',
      params: { id: SESSION_ID },
      body: { unknownField: 'bad' },
    }));
    expect(res.status).toBe(400);
    expect(parseBody(res).error).toMatch(/Unknown fields.*unknownField/);
  });

  it('rejects invalid language in PATCH', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    const res = await sessionByIdHandler(makeAuthReq(OWNER, {
      method: 'PATCH',
      params: { id: SESSION_ID },
      body: { languageA: 'zz-ZZ' },
    }));
    expect(res.status).toBe(400);
    expect(parseBody(res).error).toMatch(/Invalid languageA/);
  });

  it('rejects invalid status', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    const res = await sessionByIdHandler(makeAuthReq(OWNER, {
      method: 'PATCH',
      params: { id: SESSION_ID },
      body: { status: 'bogus' },
    }));
    expect(res.status).toBe(400);
    expect(parseBody(res).error).toMatch(/Invalid status/);
  });

  it('accepts valid PATCH', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    vi.mocked(cosmos.patchSession).mockResolvedValue(undefined);
    const res = await sessionByIdHandler(makeAuthReq(OWNER, {
      method: 'PATCH',
      params: { id: SESSION_ID },
      body: { title: 'New Title', status: 'ended' },
    }));
    expect(res.status).toBe(200);
    expect(cosmos.patchSession).toHaveBeenCalledTimes(1);
  });
});

// ── Guest request: invalid/expired invite ──────────────────────────

describe('guest request', () => {
  it('rejects when invite is expired', async () => {
    const inviteSecret = 'my-secret-invite-string';
    const inviteHash = sha256Hex(inviteSecret);
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession({
      invites: [{ hash: inviteHash, expiresAt: Date.now() - 1000, revoked: false, maxUses: 5, useCount: 0 }],
    }));
    const res = await guestRequestHandler(makeReq({
      method: 'POST',
      body: { sessionId: SESSION_ID, inviteSecret, name: 'Alice', language: 'en-US' },
    }));
    expect(res.status).toBe(403);
    expect(parseBody(res).error).toMatch(/Invite invalid or expired/i);
  });

  it('rejects when session is ended', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession({ status: 'ended' }));
    const res = await guestRequestHandler(makeReq({
      method: 'POST',
      body: { sessionId: SESSION_ID, inviteSecret: 'x', name: 'Alice', language: 'en-US' },
    }));
    expect(res.status).toBe(410);
  });

  it('rejects invalid payload (missing name)', async () => {
    const res = await guestRequestHandler(makeReq({
      method: 'POST',
      body: { sessionId: SESSION_ID, inviteSecret: 'x', name: '', language: 'en-US' },
    }));
    expect(res.status).toBe(400);
    expect(parseBody(res).error).toMatch(/Invalid guest request payload/);
  });

  it('succeeds with valid invite', async () => {
    const inviteSecret = 'valid-secret';
    const inviteHash = sha256Hex(inviteSecret);
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession({
      invites: [{ hash: inviteHash, expiresAt: Date.now() + 100000, revoked: false, maxUses: 5, useCount: 0 }],
    }));
    vi.mocked(cosmos.countPendingGuestRequests).mockResolvedValue(0);
    vi.mocked(cosmos.createGuestRequest).mockResolvedValue(undefined);

    const res = await guestRequestHandler(makeReq({
      method: 'POST',
      body: { sessionId: SESSION_ID, inviteSecret, name: 'Alice', language: 'en-US' },
    }));
    expect(res.status).toBe(201);
    const body = parseBody(res);
    expect(body.requestId).toBeDefined();
    expect(body.requestSecret).toBeDefined();
    expect(cosmos.createGuestRequest).toHaveBeenCalledTimes(1);
  });
});

// ── Approve guest: expired / cross-session ─────────────────────────

describe('approve guest', () => {
  const REQUEST_ID = 'req-1111';

  it('rejects expired guest request', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    vi.mocked(cosmos.getGuestRequest).mockResolvedValue({
      id: REQUEST_ID,
      type: 'guestRequest',
      sessionId: SESSION_ID,
      inviteHash: 'abc',
      name: 'Alice',
      language: 'en-US',
      status: 'pending',
      requestSecret: 'hash',
      createdAt: Date.now() - 300000,
      expiresAt: Date.now() - 1000, // expired
      ip: 'x',
    });
    vi.mocked(cosmos.patchGuestRequest).mockResolvedValue(undefined);

    const res = await approveGuestHandler(makeAuthReq(OWNER, {
      method: 'POST',
      params: { id: SESSION_ID, requestId: REQUEST_ID },
    }));
    expect(res.status).toBe(410);
    expect(parseBody(res).error).toMatch(/expired/i);
  });

  it('rejects cross-session request', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    vi.mocked(cosmos.getGuestRequest).mockResolvedValue({
      id: REQUEST_ID,
      type: 'guestRequest',
      sessionId: 'other-session-id', // different session
      inviteHash: 'abc',
      name: 'Alice',
      language: 'en-US',
      status: 'pending',
      requestSecret: 'hash',
      createdAt: Date.now(),
      expiresAt: Date.now() + 100000,
      ip: 'x',
    });

    const res = await approveGuestHandler(makeAuthReq(OWNER, {
      method: 'POST',
      params: { id: SESSION_ID, requestId: REQUEST_ID },
    }));
    expect(res.status).toBe(404);
    expect(parseBody(res).error).toMatch(/not found/i);
  });

  it('succeeds and issues ticket for valid pending request', async () => {
    const inviteHash = 'invite-hash-valid';
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession({
      invites: [{ hash: inviteHash, expiresAt: Date.now() + 100000, revoked: false, maxUses: 5, useCount: 0 }],
    }));
    vi.mocked(cosmos.getGuestRequest).mockResolvedValue({
      id: REQUEST_ID,
      type: 'guestRequest',
      sessionId: SESSION_ID,
      inviteHash,
      name: 'Alice',
      language: 'en-US',
      status: 'pending',
      requestSecret: 'hash',
      createdAt: Date.now(),
      expiresAt: Date.now() + 100000,
      ip: 'x',
    });
    vi.mocked(cosmos.patchGuestRequest).mockResolvedValue(undefined);

    const res = await approveGuestHandler(makeAuthReq(OWNER, {
      method: 'POST',
      params: { id: SESSION_ID, requestId: REQUEST_ID },
    }));
    expect(res.status).toBe(200);
    const body = parseBody(res);
    expect(body.ok).toBe(true);
    expect(body.admissionTicket).toBeDefined();
    expect(cosmos.patchGuestRequest).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({
      status: 'approved',
      ticketHash: expect.any(String),
      ticketJti: expect.any(String),
    }));
  });
});

// ── Guest exchange ──────────────────────────────────────────────────

describe('guest exchange', () => {
  function makeApprovedRequest(overrides: Partial<GuestRequestRecord> = {}): GuestRequestRecord {
    return {
      id: 'req-111',
      type: 'guestRequest',
      sessionId: SESSION_ID,
      inviteHash: 'inv-hash',
      name: 'Alice',
      language: 'en-US',
      status: 'approved',
      requestSecret: 'sec-hash',
      createdAt: Date.now() - 60000,
      expiresAt: Date.now() + 60000,
      ip: 'x',
      ticketHash: '', // will be set per test
      ticketExpiresAt: Date.now() + 300000,
      ticketJti: 'jti-1',
      ticketDelivered: true,
      ticketUsed: false,
      ...overrides,
    };
  }

  it('rejects expired ticket', async () => {
    const ticket = 'some-ticket-value';
    const ticketHash = sha256Hex(ticket);
    vi.mocked(cosmos.findApprovedGuestRequestByTicketHash).mockResolvedValue(
      makeApprovedRequest({ ticketHash, ticketExpiresAt: Date.now() - 1000 }),
    );
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession({
      invites: [{ hash: 'inv-hash', expiresAt: Date.now() + 100000, revoked: false, maxUses: 5, useCount: 0 }],
    }));

    const res = await guestExchangeHandler(makeReq({
      method: 'POST',
      body: { ticket, sessionId: SESSION_ID },
    }));
    expect(res.status).toBe(410);
    expect(parseBody(res).error).toMatch(/expired/i);
  });

  it('rejects replayed ticket (already used)', async () => {
    const ticket = 'replayed-ticket';
    const ticketHash = sha256Hex(ticket);
    vi.mocked(cosmos.findApprovedGuestRequestByTicketHash).mockResolvedValue(
      makeApprovedRequest({ ticketHash, ticketUsed: true }),
    );
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession({
      invites: [{ hash: 'inv-hash', expiresAt: Date.now() + 100000, revoked: false, maxUses: 5, useCount: 0 }],
    }));

    const res = await guestExchangeHandler(makeReq({
      method: 'POST',
      body: { ticket, sessionId: SESSION_ID },
    }));
    expect(res.status).toBe(409);
    expect(parseBody(res).error).toMatch(/already used/i);
  });

  it('rejects cross-session ticket', async () => {
    const ticket = 'cross-session-ticket';
    // findApprovedGuestRequestByTicketHash is called with sessionId from body,
    // so for a cross-session case the lookup returns null
    vi.mocked(cosmos.findApprovedGuestRequestByTicketHash).mockResolvedValue(null);

    const res = await guestExchangeHandler(makeReq({
      method: 'POST',
      body: { ticket, sessionId: 'different-session-id' },
    }));
    expect(res.status).toBe(403);
    expect(parseBody(res).error).toMatch(/Invalid ticket/i);
  });

  it('valid single exchange succeeds and calls external boundaries', async () => {
    const ticket = 'valid-ticket';
    const ticketHash = sha256Hex(ticket);
    const inviteHash = 'inv-hash-ok';
    vi.mocked(cosmos.findApprovedGuestRequestByTicketHash).mockResolvedValue(
      makeApprovedRequest({ ticketHash, inviteHash }),
    );
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession({
      invites: [{ hash: inviteHash, expiresAt: Date.now() + 100000, revoked: false, maxUses: 5, useCount: 0 }],
    }));
    vi.mocked(cosmos.replaceSession).mockResolvedValue(undefined);
    vi.mocked(cosmos.patchGuestRequest).mockResolvedValue(undefined);
    vi.mocked(cosmos.upsertGuestAdmission).mockResolvedValue(undefined);

    const res = await guestExchangeHandler(makeReq({
      method: 'POST',
      body: { ticket, sessionId: SESSION_ID },
    }));
    expect(res.status).toBe(200);
    const body = parseBody(res);
    expect(body.url).toBe('wss://mock/guest');
    expect(body.guestId).toBeDefined();
    expect(body.admissionId).toBe(body.guestId);

    // External boundaries called correctly
    expect(cosmos.replaceSession).toHaveBeenCalledTimes(1);
    expect(cosmos.patchGuestRequest).toHaveBeenCalledWith(
      'req-111',
      expect.objectContaining({ ticketUsed: true }),
    );
    expect(cosmos.upsertGuestAdmission).toHaveBeenCalledTimes(1);
    expect(pubsub.getGuestClientUrl).toHaveBeenCalledWith(SESSION_ID, expect.any(String));
  });
});

// ── Denied request status does not issue ticket ─────────────────────

describe('denied request status', () => {
  it('returns denied status without ticket', async () => {
    const requestSecret = 'my-secret';
    const requestSecretHash = sha256Hex(requestSecret);
    vi.mocked(cosmos.getGuestRequest).mockResolvedValue({
      id: 'req-denied',
      type: 'guestRequest',
      sessionId: SESSION_ID,
      inviteHash: 'h',
      name: 'Bob',
      language: 'en-US',
      status: 'denied',
      requestSecret: requestSecretHash,
      createdAt: Date.now(),
      expiresAt: Date.now() + 100000,
      ip: 'x',
      deniedAt: Date.now(),
    });
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());

    const res = await guestRequestStatusHandler(makeReq({
      method: 'GET',
      params: { requestId: 'req-denied' },
      headers: { 'x-request-secret': requestSecret },
    }));
    expect(res.status).toBe(200);
    const body = parseBody(res);
    expect(body.status).toBe('denied');
    expect(body.admissionTicket).toBeUndefined();
  });
});

// ── CORS disallowed origin ──────────────────────────────────────────

describe('CORS', () => {
  it('returns 403 for disallowed origin on json response', async () => {
    // The module reads ALLOWED_ORIGINS at load time; since it's empty-string
    // by default, any explicit Origin header should be blocked.
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    const res = await sessionByIdHandler(makeAuthReq(OWNER, {
      params: { id: SESSION_ID },
      headers: {
        'x-ms-client-principal': makeClientPrincipal(OWNER),
        origin: 'https://evil.example.com',
      },
    }));
    // Should be 403 with "Origin not allowed"
    expect(res.status).toBe(403);
    expect(parseBody(res).error).toMatch(/Origin not allowed/i);
  });
});

// ── Audio upload ────────────────────────────────────────────────────

// WebM EBML header magic bytes
const WEBM_MAGIC = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 0x00, 0x00, 0x00, 0x00]);

function makeFakeBlob(size: number, type: string): { size: number; type: string; arrayBuffer: () => Promise<ArrayBuffer> } {
  const buf = new ArrayBuffer(size);
  new Uint8Array(buf).set(WEBM_MAGIC.slice(0, Math.min(size, WEBM_MAGIC.length)));
  return {
    size,
    type,
    arrayBuffer: async () => buf,
  };
}

function makeUploadReq(userId: string, sessionId: string, overrides: Partial<MockReqOpts> & { blob?: ReturnType<typeof makeFakeBlob> | null } = {}) {
  const blob = overrides.blob !== undefined ? overrides.blob : makeFakeBlob(1024, 'audio/webm');
  return makeAuthReq(userId, {
    method: 'POST',
    params: { id: sessionId },
    formDataEntries: blob ? { audio: { value: blob } } : {},
    ...overrides,
  });
}

describe('uploadAudioHandler', () => {
  beforeEach(() => {
    vi.mocked(storage.getMaxUploadBytes).mockReturnValue(100 * 1024 * 1024);
    vi.mocked(storage.validateMagicBytes).mockReturnValue(true);
  });

  it('rejects unauthenticated caller', async () => {
    const res = await uploadAudioHandler(makeReq({ method: 'POST', params: { id: SESSION_ID } }));
    expect(res.status).toBe(401);
  });

  it('rejects non-owner', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    const res = await uploadAudioHandler(makeUploadReq(OTHER, SESSION_ID));
    expect(res.status).toBe(403);
  });

  it('rejects unsupported MIME type', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    const res = await uploadAudioHandler(makeUploadReq(OWNER, SESSION_ID, {
      blob: makeFakeBlob(1024, 'application/octet-stream'),
    }));
    expect(res.status).toBe(415);
    expect(parseBody(res).error).toMatch(/Unsupported audio type/);
  });

  it('rejects oversized Content-Length before formData parsing', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    vi.mocked(storage.getMaxUploadBytes).mockReturnValue(1000);
    const res = await uploadAudioHandler(makeUploadReq(OWNER, SESSION_ID, {
      headers: {
        'x-ms-client-principal': makeClientPrincipal(OWNER),
        'content-length': '2000',
      },
    }));
    expect(res.status).toBe(413);
    expect(parseBody(res).error).toMatch(/too large/);
    // uploadAudio should NOT have been called
    expect(storage.uploadAudio).not.toHaveBeenCalled();
  });

  it('rejects oversized Blob after parsing', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    vi.mocked(storage.getMaxUploadBytes).mockReturnValue(500);
    const res = await uploadAudioHandler(makeUploadReq(OWNER, SESSION_ID, {
      blob: makeFakeBlob(1024, 'audio/webm'),
    }));
    expect(res.status).toBe(413);
    expect(parseBody(res).error).toMatch(/too large/);
  });

  it('rejects forged Content-Type (signature mismatch)', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    vi.mocked(storage.validateMagicBytes).mockReturnValue(false);
    const res = await uploadAudioHandler(makeUploadReq(OWNER, SESSION_ID));
    expect(res.status).toBe(415);
    expect(parseBody(res).error).toMatch(/signature does not match/);
  });

  it('returns 201 on successful upload', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    vi.mocked(storage.uploadAudio).mockResolvedValue('https://blob.example/session-audio/session-test.webm');
    vi.mocked(cosmos.patchSession).mockResolvedValue(undefined);

    const res = await uploadAudioHandler(makeUploadReq(OWNER, SESSION_ID));
    expect(res.status).toBe(201);
    const body = parseBody(res);
    expect(body.audioUrl).toBe('https://blob.example/session-audio/session-test.webm');
    expect(storage.uploadAudio).toHaveBeenCalledTimes(1);
    expect(cosmos.patchSession).toHaveBeenCalledWith(SESSION_ID, { audioUrl: 'https://blob.example/session-audio/session-test.webm' });
  });

  it('returns 409 when audio already exists (duplicate upload)', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    vi.mocked(storage.uploadAudio).mockRejectedValue(
      new (storage as unknown as Record<string, new (...a: unknown[]) => Error>).BlobConflictError('session-test.webm'),
    );

    const res = await uploadAudioHandler(makeUploadReq(OWNER, SESSION_ID));
    expect(res.status).toBe(409);
    expect(parseBody(res).error).toMatch(/already uploaded/);
  });

  it('cleans up blob when Cosmos patch fails', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    vi.mocked(storage.uploadAudio).mockResolvedValue('https://blob.example/test.webm');
    vi.mocked(cosmos.patchSession).mockRejectedValue(new Error('Cosmos down'));
    vi.mocked(storage.deleteAudioBlob).mockResolvedValue(undefined);

    await expect(uploadAudioHandler(makeUploadReq(OWNER, SESSION_ID))).rejects.toThrow('Cosmos down');
    expect(storage.deleteAudioBlob).toHaveBeenCalledWith(SESSION_ID);
  });

  it('rejects empty audio file', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    const res = await uploadAudioHandler(makeUploadReq(OWNER, SESSION_ID, {
      blob: makeFakeBlob(0, 'audio/webm'),
    }));
    expect(res.status).toBe(400);
    expect(parseBody(res).error).toMatch(/empty/i);
  });

  it('rejects missing audio field in form data', async () => {
    vi.mocked(cosmos.getSession).mockResolvedValue(activeSession());
    const res = await uploadAudioHandler(makeUploadReq(OWNER, SESSION_ID, { blob: null }));
    expect(res.status).toBe(400);
    expect(parseBody(res).error).toMatch(/Missing audio file/);
  });
});
