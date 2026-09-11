import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import {
  appendSessionGuest,
  countPendingGuestRequests,
  createGuestRequest,
  createSession,
  deleteSession,
  endSession,
  findApprovedGuestRequestByTicketHash,
  getGuestAdmission,
  getGuestRequest,
  getSession,
  getUserSettings,
  listGuestAdmissionsForSession,
  listGuestRequestsForSession,
  listPendingGuestRequests,
  listSessions,
  patchGuestAdmission,
  patchGuestRequest,
  patchSession,
  removeSessionGuest,
  replaceSession,
  upsertGuestAdmission,
  upsertUserSettings,
  type GuestAdmissionRecord,
  type GuestRequestRecord,
  type SessionGuest,
  type SessionInvite,
  type SessionRecord,
  type UserSettings,
} from './cosmos.js';
import { uploadAudio, deleteAudioBlob, BlobConflictError, normaliseAllowedMime, validateMagicBytes, getMaxUploadBytes } from './storage.js';
import type { AuthenticatedUser } from './auth.js';
import { getAuthenticatedUser } from './auth.js';
import { isExpired, validateGuestName, validateLanguage, validateText, isValidSessionId, validateTitle, validateSessionStatus, validateUtteranceCount, validateDurationMs, constantTimeEqual, findUnknownFields } from './validation.js';
import {
  getGuestClientUrl,
  getGuestUserId,
  getHostClientUrl,
  removeConnectionFromSession,
  sendGroupMessage,
  sendUserMessage,
} from './pubsub.js';

interface PendingGuestSummary {
  requestId: string;
  name: string;
  language: string;
  createdAt: number;
}

interface WelcomePayload {
  session: Record<string, unknown>;
  speakers: Array<[string, { id: string; label: string; language: string; color: string }] | [string, Record<string, unknown>]>;
  utterances: Array<Record<string, unknown>>;
}

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TTL_MS = 30 * 60 * 1000;
const TICKET_TTL_MS = 5 * 60 * 1000;
const REQUESTS_PER_IP_PER_MINUTE = 5;
const GUEST_AUDIO_PER_MINUTE = 30;
const MAX_PENDING_REQUESTS_PER_SESSION = 20;
const ALLOWED_ORIGIN_VALUES = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const ALLOW_ALL_ORIGINS = ALLOWED_ORIGIN_VALUES.includes('*');
const welcomeCache = new Map<string, Map<string, WelcomePayload>>();
const ipRequestRateLimiter = new Map<string, number[]>();
const guestAudioRateLimiter = new Map<string, number[]>();

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function buildAdmissionTicket(requestSecret: string, ticketJti: string, sessionId: string): string {
  return sha256Hex(`${requestSecret}:${ticketJti}:${sessionId}`);
}

function getOriginHeader(req: HttpRequest): string | null {
  return req.headers.get('origin');
}

function resolveAllowedOrigin(req: HttpRequest): string | null {
  const origin = getOriginHeader(req);
  if (!origin) return ALLOW_ALL_ORIGINS ? '*' : null;
  if (ALLOW_ALL_ORIGINS) return '*';
  return ALLOWED_ORIGIN_VALUES.includes(origin) ? origin : null;
}

function buildHeaders(req: HttpRequest, additional: Record<string, string> = {}): Record<string, string> {
  const allowedOrigin = resolveAllowedOrigin(req);
  const requestOrigin = getOriginHeader(req);

  if (requestOrigin && !allowedOrigin) {
    throw new Error('Origin not allowed');
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-Secret',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...additional,
  };

  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    if (allowedOrigin !== '*') headers.Vary = 'Origin';
  }

  return headers;
}

function options(req: HttpRequest): HttpResponseInit {
  try {
    return { status: 204, headers: buildHeaders(req) };
  } catch {
    return {
      status: 403,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
      body: JSON.stringify({ error: 'Origin not allowed' }),
    };
  }
}

function json(req: HttpRequest, body: unknown, status = 200): HttpResponseInit {
  try {
    return {
      status,
      headers: buildHeaders(req, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    };
  } catch {
    return {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
      body: JSON.stringify({ error: 'Origin not allowed' }),
    };
  }
}

function error(req: HttpRequest, message: string, status = 400): HttpResponseInit {
  return json(req, { error: message }, status);
}

async function readJson<T>(req: HttpRequest): Promise<T> {
  return (await req.json()) as T;
}

function requireUser(req: HttpRequest): { user: AuthenticatedUser } | { response: HttpResponseInit } {
  const user = getAuthenticatedUser(req);
  if (!user) return { response: error(req, 'Authentication required', 401) };
  return { user };
}

async function requireOwnedSession(req: HttpRequest, sessionId: string): Promise<{ user: AuthenticatedUser; session: SessionRecord } | { response: HttpResponseInit }> {
  const auth = requireUser(req);
  if ('response' in auth) return auth;

  const session = await getSession(sessionId);
  if (!session) return { response: error(req, 'Session not found', 404) };
  if (session.ownerId !== auth.user.userId) return { response: error(req, 'Forbidden', 403) };
  return { user: auth.user, session };
}

function getClientIp(req: HttpRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const clientIp = req.headers.get('x-ms-client-ip')?.trim();
  return forwarded || clientIp || 'unknown';
}

function consumeRateLimit(map: Map<string, number[]>, key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const windowStart = now - windowMs;
  const next = (map.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  if (next.length >= limit) {
    map.set(key, next);
    return false;
  }
  next.push(now);
  map.set(key, next);
  return true;
}

function getWelcome(sessionId: string, guestId: string): WelcomePayload | null {
  return welcomeCache.get(sessionId)?.get(guestId) ?? null;
}

function setWelcome(sessionId: string, guestId: string, payload: WelcomePayload): void {
  const sessionCache = welcomeCache.get(sessionId) ?? new Map<string, WelcomePayload>();
  sessionCache.set(guestId, payload);
  welcomeCache.set(sessionId, sessionCache);
}

function takeWelcome(sessionId: string, guestId: string): WelcomePayload | null {
  const sessionCache = welcomeCache.get(sessionId);
  if (!sessionCache) return null;
  const payload = sessionCache.get(guestId) ?? null;
  if (payload) {
    sessionCache.delete(guestId);
    if (sessionCache.size === 0) welcomeCache.delete(sessionId);
  }
  return payload;
}

function clearWelcome(sessionId: string, guestId?: string): void {
  if (!guestId) {
    welcomeCache.delete(sessionId);
    return;
  }

  const sessionCache = welcomeCache.get(sessionId);
  if (!sessionCache) return;
  sessionCache.delete(guestId);
  if (sessionCache.size === 0) welcomeCache.delete(sessionId);
}

function getActiveInvite(session: SessionRecord, inviteHash: string, now = Date.now()): SessionInvite | undefined {
  return session.invites.find((invite) => (
    invite.hash === inviteHash
    && !invite.revoked
    && invite.expiresAt > now
    && invite.useCount < invite.maxUses
  ));
}

function markRequestExpiredIfNeeded(request: GuestRequestRecord, session: SessionRecord | null, now = Date.now()): GuestRequestRecord['status'] {
  if (!session || session.status === 'ended') return 'expired';
  if (request.status === 'pending' && request.expiresAt <= now) return 'expired';
  if (request.status === 'approved' && isExpired(request.ticketExpiresAt, now)) return 'expired';
  return request.status;
}

async function invalidateSessionArtifacts(sessionId: string): Promise<void> {
  const now = Date.now();
  const requests = await listGuestRequestsForSession(sessionId);
  const admissions = await listGuestAdmissionsForSession(sessionId);

  await Promise.all([
    ...requests.map(async (request) => {
      if (request.status === 'pending') {
        await patchGuestRequest(request.id, { status: 'expired' });
        return;
      }
      if (request.status === 'approved' && !request.ticketUsed) {
        await patchGuestRequest(request.id, { status: 'expired', ticketExpiresAt: now });
      }
    }),
    ...admissions
      .filter((admission) => !admission.revoked)
      .map(async (admission) => {
        await patchGuestAdmission(admission.id, { revoked: true, revokedAt: now });
      }),
  ]);

  clearWelcome(sessionId);
}

async function validateAdmission(req: HttpRequest, sessionId: string, guestId: string, admissionId: string): Promise<{ session: SessionRecord; admission: GuestAdmissionRecord } | { response: HttpResponseInit }> {
  if (!guestId || !admissionId || guestId !== admissionId) {
    return { response: error(req, 'Invalid admission', 403) };
  }

  const session = await getSession(sessionId);
  if (!session || session.status === 'ended') {
    return { response: error(req, 'Session unavailable', 410) };
  }

  const admission = await getGuestAdmission(admissionId);
  if (!admission || admission.sessionId !== sessionId || admission.guestId !== guestId) {
    return { response: error(req, 'Invalid admission', 403) };
  }

  if (admission.revoked) {
    return { response: error(req, 'Admission revoked', 403) };
  }

  return { session, admission };
}

export async function sessionsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const auth = requireUser(req);
  if ('response' in auth) return auth.response;

  if (req.method === 'GET') {
    const limit = Math.min(Number(req.query.get('limit')) || 50, 100);
    const offset = Math.max(Number(req.query.get('offset')) || 0, 0);
    const records = await listSessions(auth.user.userId, limit, offset);
    return json(req, records);
  }

  const body = await readJson<Partial<SessionRecord>>(req);
  if (!body.id || !body.hostName || !body.languageA || !body.languageB) {
    return error(req, 'Missing required fields: id, hostName, languageA, languageB');
  }

  if (!isValidSessionId(body.id)) {
    return error(req, 'Invalid session ID format');
  }

  if (!validateLanguage(body.languageA) || !validateLanguage(body.languageB)) {
    return error(req, 'Unsupported language code');
  }

  const hostName = body.hostName.trim();
  if (!hostName || hostName.length > 200) {
    return error(req, 'Invalid hostName');
  }

  const title = body.title?.trim() || `Session ${new Date().toLocaleString()}`;
  if (title.length > 200) {
    return error(req, 'Title too long');
  }

  const record: SessionRecord = {
    id: body.id,
    ownerId: auth.user.userId,
    title,
    hostName,
    hostEmail: auth.user.email,
    languageA: body.languageA,
    languageB: body.languageB,
    invites: [],
    guests: [],
    utteranceCount: 0,
    startedAt: Date.now(),
    status: 'active',
  };

  await createSession(record);
  return json(req, { ok: true }, 201);
}

app.http('sessions', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions',
  handler: sessionsHandler,
});

export async function sessionByIdHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const id = req.params.id;
  if (!id) return error(req, 'Missing session id', 400);

  const owned = await requireOwnedSession(req, id);
  if ('response' in owned) return owned.response;

  if (req.method === 'GET') {
    return json(req, owned.session);
  }

  if (req.method === 'DELETE') {
    await invalidateSessionArtifacts(id);
    await deleteSession(id);
    return json(req, { ok: true });
  }

  const PATCH_ALLOWED_FIELDS = new Set(['title', 'languageA', 'languageB', 'guests', 'utteranceCount', 'utterances', 'endedAt', 'durationMs', 'status']);
  const patch = await readJson<Record<string, unknown>>(req);
  const unknownFields = findUnknownFields(patch, PATCH_ALLOWED_FIELDS);
  if (unknownFields.length > 0) {
    return error(req, `Unknown fields: ${unknownFields.join(', ')}`);
  }

  const sanitizedPatch: Partial<SessionRecord> = {};

  if ('title' in patch) {
    if (typeof patch.title !== 'string') return error(req, 'title must be a string');
    const validTitle = validateTitle(patch.title);
    if (!validTitle) return error(req, 'Invalid title');
    sanitizedPatch.title = validTitle;
  }

  if ('languageA' in patch) {
    if (typeof patch.languageA !== 'string' || !validateLanguage(patch.languageA)) {
      return error(req, 'Invalid languageA');
    }
    sanitizedPatch.languageA = patch.languageA as SessionRecord['languageA'];
  }

  if ('languageB' in patch) {
    if (typeof patch.languageB !== 'string' || !validateLanguage(patch.languageB)) {
      return error(req, 'Invalid languageB');
    }
    sanitizedPatch.languageB = patch.languageB as SessionRecord['languageB'];
  }

  if ('status' in patch) {
    if (typeof patch.status !== 'string') return error(req, 'status must be a string');
    const validStatus = validateSessionStatus(patch.status);
    if (!validStatus) return error(req, 'Invalid status');
    sanitizedPatch.status = validStatus;
  }

  if ('utteranceCount' in patch) {
    const validCount = validateUtteranceCount(patch.utteranceCount);
    if (validCount === null) return error(req, 'Invalid utteranceCount');
    sanitizedPatch.utteranceCount = validCount;
  }

  if ('durationMs' in patch) {
    if (patch.durationMs === null) {
      sanitizedPatch.durationMs = null;
    } else {
      const validDuration = validateDurationMs(patch.durationMs);
      if (validDuration === null) return error(req, 'Invalid durationMs');
      sanitizedPatch.durationMs = validDuration;
    }
  }

  if ('endedAt' in patch) {
    if (patch.endedAt === null) {
      sanitizedPatch.endedAt = null;
    } else if (typeof patch.endedAt !== 'number' || !Number.isFinite(patch.endedAt)) {
      return error(req, 'Invalid endedAt');
    } else {
      sanitizedPatch.endedAt = patch.endedAt;
    }
  }

  if ('guests' in patch) {
    if (!Array.isArray(patch.guests)) return error(req, 'guests must be an array');
    sanitizedPatch.guests = (patch as Partial<SessionRecord>).guests;
  }

  if ('utterances' in patch) {
    if (patch.utterances !== undefined && !Array.isArray(patch.utterances)) {
      return error(req, 'utterances must be an array');
    }
    sanitizedPatch.utterances = (patch as Partial<SessionRecord>).utterances;
  }

  await patchSession(id, sanitizedPatch);
  return json(req, { ok: true });
}

app.http('sessionById', {
  methods: ['GET', 'PATCH', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}',
  handler: sessionByIdHandler,
});

export async function createInviteHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const sessionId = req.params.id;
  if (!sessionId) return error(req, 'Missing session id', 400);

  const owned = await requireOwnedSession(req, sessionId);
  if ('response' in owned) return owned.response;

  const body = await readJson<{ hash?: string; expiresAt?: number; maxUses?: number }>(req);
  const hash = body.hash?.trim();
  const expiresAt = body.expiresAt ?? Date.now() + INVITE_TTL_MS;
  const maxUses = Math.max(1, Math.min(body.maxUses ?? 5, 100));

  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return error(req, 'Invalid invite hash');
  }

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return error(req, 'Invite expiry must be in the future');
  }

  const nextInvites = [...owned.session.invites, { hash, expiresAt, revoked: false, maxUses, useCount: 0 }];
  await replaceSession({ ...owned.session, invites: nextInvites });
  return json(req, { ok: true, invite: nextInvites[nextInvites.length - 1] }, 201);
}

app.http('createInvite', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/invites',
  handler: createInviteHandler,
});

async function revokeInviteHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const sessionId = req.params.id;
  if (!sessionId) return error(req, 'Missing session id', 400);

  const owned = await requireOwnedSession(req, sessionId);
  if ('response' in owned) return owned.response;

  const body = await readJson<{ hash?: string }>(req);
  const hash = body.hash?.trim();
  if (!hash) return error(req, 'Missing invite hash');

  const inviteFound = owned.session.invites.some((invite) => invite.hash === hash);
  if (!inviteFound) return error(req, 'Invite not found', 404);

  const invites = owned.session.invites.map((invite) => (
    invite.hash === hash ? { ...invite, revoked: true } : invite
  ));
  await replaceSession({ ...owned.session, invites });
  return json(req, { ok: true });
}

app.http('revokeInvite', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/invites/revoke',
  handler: revokeInviteHandler,
});

async function endSessionHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const id = req.params.id;
  if (!id) return error(req, 'Missing session id', 400);

  const owned = await requireOwnedSession(req, id);
  if ('response' in owned) return owned.response;

  const body = await readJson<{ utteranceCount?: number; guests?: SessionRecord['guests']; utterances?: SessionRecord['utterances'] }>(req);
  await endSession(id, body.utteranceCount ?? 0, body.guests ?? [], body.utterances);
  await invalidateSessionArtifacts(id);
  await sendGroupMessage(id, { type: 'session-end' });
  return json(req, { ok: true });
}

app.http('endSession', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/end',
  handler: endSessionHandler,
});

export async function uploadAudioHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const id = req.params.id;
  if (!id) return error(req, 'Missing session id', 400);

  const owned = await requireOwnedSession(req, id);
  if ('response' in owned) return owned.response;

  // ── Pre-parse Content-Length guard ──────────────────────────────────
  const maxBytes = getMaxUploadBytes();
  const clHeader = req.headers.get('content-length');
  if (clHeader) {
    const cl = Number(clHeader);
    if (!Number.isFinite(cl) || cl <= 0) {
      return error(req, 'Invalid Content-Length', 400);
    }
    if (cl > maxBytes) {
      return error(req, `Request body too large (limit ${maxBytes} bytes)`, 413);
    }
  }

  // ── Parse multipart body ───────────────────────────────────────────
  // NOTE: Azure Functions v4 HttpRequest.formData() materializes the entire
  // body in memory (Web API FormData/Blob).  True streaming from req.body
  // would require a manual multipart parser; we enforce size limits instead.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return error(req, 'Invalid multipart form data', 400);
  }
  const file = formData.get('audio');
  if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') {
    return error(req, 'Missing audio file in form data', 400);
  }
  const audioFile = file as Blob;

  // ── Post-parse Blob size guard ─────────────────────────────────────
  if (audioFile.size === 0) {
    return error(req, 'Audio file is empty', 400);
  }
  if (audioFile.size > maxBytes) {
    return error(req, `Audio file too large (limit ${maxBytes} bytes)`, 413);
  }

  // ── MIME allowlist ─────────────────────────────────────────────────
  const mime = normaliseAllowedMime(audioFile.type || 'audio/webm');
  if (!mime) {
    return error(req, `Unsupported audio type: ${audioFile.type}`, 415);
  }

  // ── Magic-byte validation (reject forged Content-Type) ─────────────
  const arrayBuffer = await audioFile.arrayBuffer();
  if (!validateMagicBytes(mime, arrayBuffer)) {
    return error(req, 'File signature does not match declared content type', 415);
  }

  // ── Upload with fail-if-exists (one recording per session) ─────────
  let audioUrl: string;
  try {
    audioUrl = await uploadAudio(id, arrayBuffer, mime);
  } catch (err) {
    if (err instanceof BlobConflictError) {
      return error(req, 'Audio already uploaded for this session', 409);
    }
    throw err;
  }

  // ── Patch session; clean up blob on Cosmos failure ─────────────────
  try {
    await patchSession(id, { audioUrl });
  } catch (cosmosErr) {
    await deleteAudioBlob(id);
    throw cosmosErr;
  }
  return json(req, { audioUrl }, 201);
}

app.http('uploadAudio', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/audio',
  handler: uploadAudioHandler,
});

async function settingsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const userId = req.params.userId;
  if (!userId) return error(req, 'Missing userId', 400);

  const auth = requireUser(req);
  if ('response' in auth) return auth.response;
  if (auth.user.userId !== userId) return error(req, 'Forbidden', 403);

  if (req.method === 'GET') {
    const settings = await getUserSettings(userId);
    if (!settings) return json(req, { microphoneDeviceId: '', translationMode: 'standard' });
    return json(req, { microphoneDeviceId: settings.microphoneDeviceId, translationMode: settings.translationMode });
  }

  const body = await readJson<Partial<UserSettings>>(req);
  const doc: UserSettings = {
    id: userId,
    type: 'userSettings',
    microphoneDeviceId: body.microphoneDeviceId ?? '',
    translationMode: body.translationMode === 'realtime' ? 'realtime' : 'standard',
  };
  await upsertUserSettings(doc);
  return json(req, { ok: true });
}

app.http('settings', {
  methods: ['GET', 'PUT', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'settings/{userId}',
  handler: settingsHandler,
});

async function negotiateHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const sessionId = req.query.get('session');
  if (!sessionId) return error(req, 'Missing query param: session');

  const owned = await requireOwnedSession(req, sessionId);
  if ('response' in owned) return owned.response;

  const url = await getHostClientUrl(sessionId, owned.user.userId);
  return json(req, { url });
}

app.http('negotiate', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'negotiate',
  handler: negotiateHandler,
});

export async function guestRequestHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const body = await readJson<{ inviteSecret?: string; sessionId?: string; name?: string; language?: string }>(req);
  const sessionId = body.sessionId?.trim();
  const inviteSecret = body.inviteSecret?.trim();
  const name = validateGuestName(body.name ?? '');
  const language = validateLanguage(body.language ?? '');

  if (!sessionId || !inviteSecret || !name || !language) {
    return error(req, 'Invalid guest request payload');
  }

  const session = await getSession(sessionId);
  if (!session || session.status === 'ended') return error(req, 'Session unavailable', 410);

  const inviteHash = sha256Hex(inviteSecret);
  const invite = getActiveInvite(session, inviteHash);
  if (!invite) return error(req, 'Invite invalid or expired', 403);

  const now = Date.now();
  const pendingCount = await countPendingGuestRequests(sessionId, now);
  if (pendingCount >= MAX_PENDING_REQUESTS_PER_SESSION) {
    return error(req, 'Too many pending requests for this session', 429);
  }

  const ip = getClientIp(req);
  if (!consumeRateLimit(ipRequestRateLimiter, ip, REQUESTS_PER_IP_PER_MINUTE, 60_000, now)) {
    return error(req, 'Too many requests from this IP', 429);
  }

  const requestId = randomUUID();
  const requestSecret = randomHex(32);
  const requestSecretHash = sha256Hex(requestSecret);
  const request: GuestRequestRecord = {
    id: requestId,
    type: 'guestRequest',
    sessionId,
    inviteHash,
    name,
    language,
    status: 'pending',
    requestSecret: requestSecretHash,
    createdAt: now,
    expiresAt: now + REQUEST_TTL_MS,
    ip: sha256Hex(ip),
  };
  await createGuestRequest(request);
  return json(req, { requestId, requestSecret }, 201);
}

app.http('guestRequest', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'guest/request',
  handler: guestRequestHandler,
});

export async function guestRequestStatusHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const requestId = req.params.requestId;
  const secret = req.headers.get('x-request-secret')?.trim();
  if (!requestId || !secret) return error(req, 'Missing request id or secret');

  const request = await getGuestRequest(requestId);
  const secretHash = sha256Hex(secret);
  if (!request || !constantTimeEqual(request.requestSecret, secretHash)) return error(req, 'Request not found', 404);

  const session = await getSession(request.sessionId);
  const status = markRequestExpiredIfNeeded(request, session);
  if (status !== request.status) {
    await patchGuestRequest(request.id, { status });
  }

  if (status !== 'approved') {
    return json(req, { status });
  }

  if (!request.ticketJti || !request.ticketExpiresAt || isExpired(request.ticketExpiresAt)) {
    await patchGuestRequest(request.id, { status: 'expired' });
    return json(req, { status: 'expired' });
  }

  if (request.ticketDelivered) {
    return json(req, { status: 'approved' });
  }

  const admissionTicket = buildAdmissionTicket(request.requestSecret, request.ticketJti, request.sessionId);
  await patchGuestRequest(request.id, { ticketDelivered: true });
  return json(req, { status: 'approved', admissionTicket });
}

app.http('guestRequestStatus', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'guest/request/{requestId}/status',
  handler: guestRequestStatusHandler,
});

async function pendingGuestsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const sessionId = req.params.id;
  if (!sessionId) return error(req, 'Missing session id');

  const owned = await requireOwnedSession(req, sessionId);
  if ('response' in owned) return owned.response;

  const requests = await listPendingGuestRequests(sessionId);
  const pending: PendingGuestSummary[] = requests.map((request) => ({
    requestId: request.id,
    name: request.name,
    language: request.language,
    createdAt: request.createdAt,
  }));
  return json(req, pending);
}

app.http('pendingGuests', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/guests/pending',
  handler: pendingGuestsHandler,
});

export async function approveGuestHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const sessionId = req.params.id;
  const requestId = req.params.requestId;
  if (!sessionId || !requestId) return error(req, 'Missing identifiers');

  const owned = await requireOwnedSession(req, sessionId);
  if ('response' in owned) return owned.response;

  const request = await getGuestRequest(requestId);
  if (!request || request.sessionId !== sessionId) return error(req, 'Guest request not found', 404);
  if (markRequestExpiredIfNeeded(request, owned.session) === 'expired') {
    await patchGuestRequest(request.id, { status: 'expired' });
    return error(req, 'Guest request expired', 410);
  }
  if (request.status !== 'pending') return error(req, 'Guest request is not pending', 409);

  const invite = getActiveInvite(owned.session, request.inviteHash);
  if (!invite) return error(req, 'Invite invalid or exhausted', 409);

  const ticketJti = randomUUID();
  const admissionTicket = buildAdmissionTicket(request.requestSecret, ticketJti, sessionId);
  await patchGuestRequest(request.id, {
    status: 'approved',
    ticketHash: sha256Hex(admissionTicket),
    ticketExpiresAt: Date.now() + TICKET_TTL_MS,
    ticketJti,
    ticketDelivered: false,
    approvedAt: Date.now(),
  });

  return json(req, { ok: true, admissionTicket });
}

app.http('approveGuest', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/guests/{requestId}/approve',
  handler: approveGuestHandler,
});

export async function denyGuestHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const sessionId = req.params.id;
  const requestId = req.params.requestId;
  if (!sessionId || !requestId) return error(req, 'Missing identifiers');

  const owned = await requireOwnedSession(req, sessionId);
  if ('response' in owned) return owned.response;

  const request = await getGuestRequest(requestId);
  if (!request || request.sessionId !== sessionId) return error(req, 'Guest request not found', 404);

  await patchGuestRequest(request.id, { status: 'denied', deniedAt: Date.now() });
  return json(req, { ok: true });
}

app.http('denyGuest', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/guests/{requestId}/deny',
  handler: denyGuestHandler,
});

export async function guestExchangeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const body = await readJson<{ ticket?: string; sessionId?: string }>(req);
  const ticket = body.ticket?.trim();
  const sessionId = body.sessionId?.trim();
  if (!ticket || !sessionId) return error(req, 'Missing ticket or session id');

  const request = await findApprovedGuestRequestByTicketHash(sessionId, sha256Hex(ticket));
  if (!request) return error(req, 'Invalid ticket', 403);

  const session = await getSession(sessionId);
  if (!session || session.status === 'ended') return error(req, 'Session unavailable', 410);
  if (isExpired(request.ticketExpiresAt)) return error(req, 'Ticket expired', 410);
  if (request.ticketUsed) return error(req, 'Ticket already used', 409);

  const invites = session.invites.map((invite) => {
    if (invite.hash !== request.inviteHash) return invite;
    return { ...invite, useCount: invite.useCount + 1 };
  });
  const updatedInvite = invites.find((invite) => invite.hash === request.inviteHash);
  if (!updatedInvite || updatedInvite.revoked || updatedInvite.expiresAt <= Date.now() || updatedInvite.useCount > updatedInvite.maxUses) {
    return error(req, 'Invite exhausted', 409);
  }

  const guestId = randomUUID();
  const admission: GuestAdmissionRecord = {
    id: guestId,
    type: 'guestAdmission',
    sessionId,
    requestId: request.id,
    guestId,
    guestName: request.name,
    language: request.language,
    admittedAt: Date.now(),
    revoked: false,
    userId: getGuestUserId(sessionId, guestId),
  };

  await Promise.all([
    replaceSession({ ...session, invites }),
    patchGuestRequest(request.id, { ticketUsed: true, ticketUsedAt: Date.now() }),
    upsertGuestAdmission(admission),
  ]);

  const url = await getGuestClientUrl(sessionId, guestId);
  return json(req, { url, guestId, admissionId: guestId });
}

app.http('guestExchange', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'guest/exchange',
  handler: guestExchangeHandler,
});

async function guestJoinHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const body = await readJson<{ sessionId?: string; guestId?: string; name?: string; language?: string; admissionId?: string }>(req);
  const sessionId = body.sessionId?.trim();
  const guestId = body.guestId?.trim();
  const admissionId = body.admissionId?.trim();
  if (!sessionId || !guestId || !admissionId) return error(req, 'Missing guest join identifiers');

  const validated = await validateAdmission(req, sessionId, guestId, admissionId);
  if ('response' in validated) return validated.response;

  const guest: SessionGuest = {
    id: guestId,
    name: validated.admission.guestName,
    language: validated.admission.language,
    joinedAt: Date.now(),
  };

  await Promise.all([
    appendSessionGuest(sessionId, guest),
    sendGroupMessage(sessionId, { type: 'join', guest }),
  ]);

  return json(req, { ok: true });
}

app.http('guestJoin', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'guest/join',
  handler: guestJoinHandler,
});

async function guestAudioHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const body = await readJson<{ sessionId?: string; guestId?: string; text?: string; detectedLanguage?: string; admissionId?: string }>(req);
  const sessionId = body.sessionId?.trim();
  const guestId = body.guestId?.trim();
  const admissionId = body.admissionId?.trim();
  const text = validateText(body.text ?? '');
  const detectedLanguage = body.detectedLanguage?.trim() ?? '';

  if (!sessionId || !guestId || !admissionId || !text) {
    return error(req, 'Invalid guest audio payload');
  }

  const validated = await validateAdmission(req, sessionId, guestId, admissionId);
  if ('response' in validated) return validated.response;

  if (!consumeRateLimit(guestAudioRateLimiter, `${sessionId}:${guestId}`, GUEST_AUDIO_PER_MINUTE, 60_000)) {
    return error(req, 'Guest audio rate limit exceeded', 429);
  }

  await sendGroupMessage(sessionId, {
    type: 'guest-audio',
    guestId,
    text,
    detectedLanguage,
  });
  return json(req, { ok: true });
}

app.http('guestAudio', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'guest/audio',
  handler: guestAudioHandler,
});

async function guestWelcomeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const sessionId = req.params.sessionId;
  const guestId = req.query.get('guestId')?.trim();
  const admissionId = req.query.get('admissionId')?.trim();
  if (!sessionId || !guestId || !admissionId) return error(req, 'Missing welcome identifiers');

  const validated = await validateAdmission(req, sessionId, guestId, admissionId);
  if ('response' in validated) return validated.response;

  const welcome = takeWelcome(sessionId, guestId) ?? getWelcome(sessionId, guestId);
  if (!welcome) return json(req, { status: 'pending' });
  return json(req, { status: 'ready', welcome });
}

app.http('guestWelcome', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'guest/welcome/{sessionId}',
  handler: guestWelcomeHandler,
});

async function hostWelcomeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const sessionId = req.params.id;
  if (!sessionId) return error(req, 'Missing session id');

  const owned = await requireOwnedSession(req, sessionId);
  if ('response' in owned) return owned.response;

  const body = await readJson<{ guestId?: string; admissionId?: string; session?: Record<string, unknown>; speakers?: WelcomePayload['speakers']; utterances?: WelcomePayload['utterances'] }>(req);
  const guestId = body.guestId?.trim();
  const admissionId = body.admissionId?.trim();
  if (!guestId || !admissionId || !body.session || !Array.isArray(body.speakers) || !Array.isArray(body.utterances)) {
    return error(req, 'Invalid welcome payload');
  }

  const admission = await getGuestAdmission(admissionId);
  if (!admission || admission.sessionId !== sessionId || admission.guestId !== guestId || admission.revoked) {
    return error(req, 'Guest admission not found', 404);
  }

  const payload: WelcomePayload = {
    session: body.session,
    speakers: body.speakers,
    utterances: body.utterances,
  };
  setWelcome(sessionId, guestId, payload);
  await sendUserMessage(admission.userId, { type: 'welcome', ...payload });
  return json(req, { ok: true });
}

app.http('hostWelcome', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/welcome',
  handler: hostWelcomeHandler,
});

async function revokeGuestHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options(req);

  const sessionId = req.params.id;
  const guestId = req.params.guestId;
  if (!sessionId || !guestId) return error(req, 'Missing guest identifiers');

  const owned = await requireOwnedSession(req, sessionId);
  if ('response' in owned) return owned.response;

  const admission = await getGuestAdmission(guestId);
  if (!admission || admission.sessionId !== sessionId) return error(req, 'Guest not found', 404);

  await patchGuestAdmission(admission.id, { revoked: true, revokedAt: Date.now() });
  await removeSessionGuest(sessionId, guestId);
  clearWelcome(sessionId, guestId);

  if (admission.connectionId) {
    await removeConnectionFromSession(sessionId, admission.connectionId).catch(() => undefined);
  }

  await sendUserMessage(admission.userId, { type: 'revoked', guestId, message: 'Your session access has been revoked.' }).catch(() => undefined);
  return json(req, { ok: true });
}

app.http('revokeGuest', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/guests/{guestId}/revoke',
  handler: revokeGuestHandler,
});
