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

export interface SessionRecord {
  id: string;
  token: string;
  title: string;
  hostName: string;
  hostEmail?: string;
  languageA: string;
  languageB: string;
  guests: SessionGuest[];
  utteranceCount: number;
  utterances?: SessionUtterance[];
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  audioUrl?: string;
  status: 'active' | 'ended';
}

export interface SessionGuest {
  id: string;
  name: string;
  email?: string;
  language: string;
  joinedAt: number;
}

export async function createSession(record: SessionRecord): Promise<void> {
  const container = getContainer();
  await container.items.create(record);
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  const container = getContainer();
  try {
    const { resource } = await container.item(id, id).read<SessionRecord>();
    return resource ?? null;
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && (e as { code: number }).code === 404) return null;
    throw e;
  }
}

export async function patchSession(id: string, patch: Partial<SessionRecord>): Promise<void> {
  const container = getContainer();
  const operations = Object.entries(patch)
    .filter(([key]) => key !== 'id')
    .map(([key, value]) => ({
      op: 'set' as const,
      path: `/${key}`,
      value,
    }));
  if (operations.length === 0) return;
  await container.item(id, id).patch(operations);
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

export async function listSessions(limit = 50, offset = 0): Promise<SessionRecord[]> {
  const container = getContainer();
  const query = {
    query: 'SELECT c.id, c.token, c.title, c.hostName, c.hostEmail, c.languageA, c.languageB, c.guests, c.utteranceCount, c.startedAt, c.endedAt, c.durationMs, c.audioUrl, c.status FROM c WHERE c.type = "session" OR NOT IS_DEFINED(c.type) ORDER BY c.startedAt DESC OFFSET @offset LIMIT @limit',
    parameters: [
      { name: '@limit', value: limit },
      { name: '@offset', value: offset },
    ],
  };
  const { resources } = await container.items.query<SessionRecord>(query).fetchAll();
  return resources;
}

// --------------- User Settings ---------------

export interface UserSettings {
  id: string;            // userId (MSAL oid)
  type: 'userSettings';
  microphoneDeviceId: string;
  translationMode: 'standard' | 'realtime';
}

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const container = getContainer();
  try {
    const { resource } = await container.item(userId, userId).read<UserSettings>();
    if (resource && resource.type === 'userSettings') return resource;
    return null;
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && (e as { code: number }).code === 404) return null;
    throw e;
  }
}

export async function upsertUserSettings(settings: UserSettings): Promise<void> {
  const container = getContainer();
  await container.items.upsert(settings);
}
