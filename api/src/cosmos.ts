import { CosmosClient, Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

let _container: Container | null = null;

function getContainer(): Container {
  if (_container) return _container;

  const endpoint = process.env.COSMOS_ENDPOINT;
  const database = process.env.COSMOS_DATABASE ?? 'live-translation';
  const container = process.env.COSMOS_CONTAINER ?? 'sessions';

  if (!endpoint) throw new Error('COSMOS_ENDPOINT not configured');

  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  _container = client.database(database).container(container);
  return _container;
}

export interface SessionUtterance {
  id: string;
  speakerLabel: string;
  originalText: string;
  translatedTexts: Record<string, string>;
  detectedLanguage: string;
  timestamp: number;
}

export interface SessionInvite {
  hash: string;
  expiresAt: number;
  revoked: boolean;
  maxUses: number;
  useCount: number;
}

export interface SessionGuest {
  id: string;
  name: string;
  email?: string;
  language: string;
  joinedAt: number;
}

export interface SessionRecord {
  id: string;
  type?: 'session';
  ownerId: string;
  title: string;
  hostName: string;
  hostEmail?: string;
  languageA: string;
  languageB: string;
  invites: SessionInvite[];
  guests: SessionGuest[];
  utteranceCount: number;
  utterances?: SessionUtterance[];
  startedAt: number;
  endedAt?: number | null;
  durationMs?: number | null;
  audioUrl?: string;
  status: 'active' | 'ended';
}

export interface GuestRequestRecord {
  id: string;
  type: 'guestRequest';
  sessionId: string;
  inviteHash: string;
  name: string;
  language: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  requestSecret: string;
  createdAt: number;
  expiresAt: number;
  ip: string;
  ticketHash?: string;
  ticketExpiresAt?: number;
  ticketJti?: string;
  ticketDelivered?: boolean;
  ticketUsed?: boolean;
  ticketUsedAt?: number;
  approvedAt?: number;
  deniedAt?: number;
}

export interface GuestAdmissionRecord {
  id: string;
  type: 'guestAdmission';
  sessionId: string;
  requestId: string;
  guestId: string;
  guestName: string;
  language: string;
  admittedAt: number;
  revoked: boolean;
  revokedAt?: number;
  userId: string;
  connectionId?: string;
  /** Last time the guest proved liveness (heartbeat or connection event). */
  lastSeenAt?: number;
  /** Set when the transport dropped; cleared on reconnect. Starts the grace period. */
  disconnectedAt?: number | null;
  /** True once the guest has left (explicitly or by timeout). */
  left?: boolean;
  leftAt?: number;
  leftReason?: 'left' | 'timeout' | 'revoked';
}

export interface UserSettings {
  id: string;
  type: 'userSettings';
  microphoneDeviceId: string;
  translationMode: 'standard' | 'realtime';
}

async function readDocument<T extends { type?: string }>(id: string): Promise<T | null> {
  const container = getContainer();
  try {
    const { resource } = await container.item(id, id).read<T>();
    return resource ?? null;
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && (e as { code: number }).code === 404) return null;
    throw e;
  }
}

async function replaceDocument<T extends { id: string }>(document: T): Promise<void> {
  const container = getContainer();
  await container.item(document.id, document.id).replace(document);
}

async function patchDocument<T extends { id: string }>(id: string, patch: Partial<T>): Promise<void> {
  const container = getContainer();
  const operations = Object.entries(patch)
    .filter(([key, value]) => key !== 'id' && value !== undefined)
    .map(([key, value]) => ({
      op: 'set' as const,
      path: `/${key}`,
      value,
    }));

  if (operations.length === 0) return;
  await container.item(id, id).patch(operations);
}

async function queryDocuments<T>(query: string, parameters: Array<{ name: string; value: string | number | boolean | null }>): Promise<T[]> {
  const container = getContainer();
  const { resources } = await container.items.query<T>({ query, parameters }).fetchAll();
  return resources;
}

export async function createSession(record: SessionRecord): Promise<void> {
  const container = getContainer();
  await container.items.create({ ...record, type: 'session' });
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  const resource = await readDocument<SessionRecord>(id);
  if (!resource) return null;
  if (resource.type && resource.type !== 'session') return null;
  return { ...resource, invites: resource.invites ?? [], guests: resource.guests ?? [] };
}

export async function replaceSession(record: SessionRecord): Promise<void> {
  await replaceDocument({ ...record, type: 'session' });
}

export async function patchSession(id: string, patch: Partial<SessionRecord>): Promise<void> {
  await patchDocument<SessionRecord>(id, patch);
}

export async function appendSessionGuest(sessionId: string, guest: SessionGuest): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;

  if (!session.guests.some((existing) => existing.id === guest.id)) {
    session.guests = [...session.guests, guest];
    await replaceSession(session);
  }
}

export async function removeSessionGuest(sessionId: string, guestId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;

  session.guests = session.guests.filter((guest) => guest.id !== guestId);
  await replaceSession(session);
}

export async function endSession(
  id: string,
  utteranceCount: number,
  guests: SessionGuest[],
  utterances?: SessionUtterance[],
): Promise<void> {
  const now = Date.now();
  const existing = await getSession(id);
  const durationMs = existing ? now - existing.startedAt : 0;

  const patch: Partial<SessionRecord> = {
    status: 'ended',
    endedAt: now,
    durationMs,
    utteranceCount,
    guests,
  };
  if (utterances && utterances.length > 0) {
    patch.utterances = utterances;
  }
  await patchSession(id, patch);
}

export async function deleteSession(id: string): Promise<void> {
  const container = getContainer();
  await container.item(id, id).delete();
}

export async function listSessions(ownerId: string, limit = 50, offset = 0): Promise<SessionRecord[]> {
  const resources = await queryDocuments<SessionRecord>(
    'SELECT c.id, c.ownerId, c.title, c.hostName, c.hostEmail, c.languageA, c.languageB, c.invites, c.guests, c.utteranceCount, c.startedAt, c.endedAt, c.durationMs, c.audioUrl, c.status FROM c WHERE (c.type = "session" OR NOT IS_DEFINED(c.type)) AND c.ownerId = @ownerId ORDER BY c.startedAt DESC OFFSET @offset LIMIT @limit',
    [
      { name: '@ownerId', value: ownerId },
      { name: '@limit', value: limit },
      { name: '@offset', value: offset },
    ],
  );
  return resources.map((resource) => ({ ...resource, invites: resource.invites ?? [], guests: resource.guests ?? [] }));
}

export async function createGuestRequest(record: GuestRequestRecord): Promise<void> {
  const container = getContainer();
  await container.items.create(record);
}

export async function getGuestRequest(id: string): Promise<GuestRequestRecord | null> {
  const resource = await readDocument<GuestRequestRecord>(id);
  if (!resource || resource.type !== 'guestRequest') return null;
  return resource;
}

export async function patchGuestRequest(id: string, patch: Partial<GuestRequestRecord>): Promise<void> {
  await patchDocument<GuestRequestRecord>(id, patch);
}

export async function countPendingGuestRequests(sessionId: string, now = Date.now()): Promise<number> {
  const results = await queryDocuments<number>(
    'SELECT VALUE COUNT(1) FROM c WHERE c.type = "guestRequest" AND c.sessionId = @sessionId AND c.status = "pending" AND c.expiresAt > @now',
    [
      { name: '@sessionId', value: sessionId },
      { name: '@now', value: now },
    ],
  );
  return results[0] ?? 0;
}

export async function listPendingGuestRequests(sessionId: string, now = Date.now()): Promise<GuestRequestRecord[]> {
  return queryDocuments<GuestRequestRecord>(
    'SELECT c.id, c.sessionId, c.name, c.language, c.createdAt, c.status, c.type, c.expiresAt FROM c WHERE c.type = "guestRequest" AND c.sessionId = @sessionId AND c.status = "pending" AND c.expiresAt > @now ORDER BY c.createdAt ASC',
    [
      { name: '@sessionId', value: sessionId },
      { name: '@now', value: now },
    ],
  );
}

export async function listGuestRequestsForSession(sessionId: string): Promise<GuestRequestRecord[]> {
  return queryDocuments<GuestRequestRecord>(
    'SELECT * FROM c WHERE c.type = "guestRequest" AND c.sessionId = @sessionId',
    [{ name: '@sessionId', value: sessionId }],
  );
}

export async function findApprovedGuestRequestByTicketHash(
  sessionId: string,
  ticketHash: string,
): Promise<GuestRequestRecord | null> {
  const results = await queryDocuments<GuestRequestRecord>(
    'SELECT TOP 1 * FROM c WHERE c.type = "guestRequest" AND c.sessionId = @sessionId AND c.ticketHash = @ticketHash AND c.status = "approved"',
    [
      { name: '@sessionId', value: sessionId },
      { name: '@ticketHash', value: ticketHash },
    ],
  );
  return results[0] ?? null;
}

export async function upsertGuestAdmission(admission: GuestAdmissionRecord): Promise<void> {
  const container = getContainer();
  await container.items.upsert(admission);
}

export async function getGuestAdmission(id: string): Promise<GuestAdmissionRecord | null> {
  const resource = await readDocument<GuestAdmissionRecord>(id);
  if (!resource || resource.type !== 'guestAdmission') return null;
  return resource;
}

export async function patchGuestAdmission(id: string, patch: Partial<GuestAdmissionRecord>): Promise<void> {
  await patchDocument<GuestAdmissionRecord>(id, patch);
}

export async function listGuestAdmissionsForSession(sessionId: string): Promise<GuestAdmissionRecord[]> {
  return queryDocuments<GuestAdmissionRecord>(
    'SELECT * FROM c WHERE c.type = "guestAdmission" AND c.sessionId = @sessionId',
    [{ name: '@sessionId', value: sessionId }],
  );
}

export async function getGuestAdmissionByUserId(userId: string): Promise<GuestAdmissionRecord | null> {
  const results = await queryDocuments<GuestAdmissionRecord>(
    'SELECT TOP 1 * FROM c WHERE c.type = "guestAdmission" AND c.userId = @userId',
    [{ name: '@userId', value: userId }],
  );
  return results[0] ?? null;
}

/**
 * Admissions that are still considered present in a session, i.e. not revoked
 * and not already marked as left. Used by the liveness sweeper.
 */
export async function listPresentGuestAdmissions(): Promise<GuestAdmissionRecord[]> {
  return queryDocuments<GuestAdmissionRecord>(
    'SELECT * FROM c WHERE c.type = "guestAdmission" AND c.revoked = false AND (NOT IS_DEFINED(c.left) OR c.left = false)',
    [],
  );
}

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const resource = await readDocument<UserSettings>(userId);
  if (!resource || resource.type !== 'userSettings') return null;
  return resource;
}

export async function upsertUserSettings(settings: UserSettings): Promise<void> {
  const container = getContainer();
  await container.items.upsert(settings);
}
