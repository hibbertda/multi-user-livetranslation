import { WebPubSubServiceClient } from '@azure/web-pubsub';

const HUB_NAME = 'session';

let _client: WebPubSubServiceClient | null = null;

function getClient(): WebPubSubServiceClient {
  if (_client) return _client;

  const connectionString = process.env.WebPubSubConnectionString;
  if (!connectionString) throw new Error('WebPubSubConnectionString not configured');

  _client = new WebPubSubServiceClient(connectionString, HUB_NAME);
  return _client;
}

export function getGuestUserId(sessionId: string, guestId: string): string {
  return `guest:${sessionId}:${guestId}`;
}

export async function getHostClientUrl(sessionId: string, ownerId: string): Promise<string> {
  const client = getClient();
  const { url } = await client.getClientAccessToken({
    userId: `host:${sessionId}:${ownerId}`,
    groups: [sessionId],
    roles: [
      `webpubsub.joinLeaveGroup.${sessionId}`,
      `webpubsub.sendToGroup.${sessionId}`,
    ],
  });
  return url;
}

export async function getGuestClientUrl(sessionId: string, guestId: string): Promise<string> {
  const client = getClient();
  const { url } = await client.getClientAccessToken({
    userId: getGuestUserId(sessionId, guestId),
    groups: [sessionId],
    roles: [`webpubsub.joinLeaveGroup.${sessionId}`],
  });
  return url;
}

export async function sendGroupMessage(sessionId: string, message: Record<string, unknown>): Promise<void> {
  const client = getClient();
  await client.group(sessionId).sendToAll(message);
}

export async function sendUserMessage(userId: string, message: Record<string, unknown>): Promise<void> {
  const client = getClient();
  await client.sendToUser(userId, message);
}

export async function removeConnectionFromSession(sessionId: string, connectionId: string): Promise<void> {
  const client = getClient();
  await client.group(sessionId).removeConnection(connectionId);
}
