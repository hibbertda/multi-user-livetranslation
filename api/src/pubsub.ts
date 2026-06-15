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

/**
 * Generate a client access URL for a session participant.
 * The userId encodes role + session so the server-side event handler
 * can route messages to the correct session group.
 */
export async function getClientUrl(
  sessionId: string,
  token: string,
  role: 'host' | 'guest',
): Promise<string> {
  const client = getClient();
  const userId = `${role}:${sessionId}`;
  const { url } = await client.getClientAccessToken({
    userId,
    groups: [sessionId],
    roles: [
      `webpubsub.joinLeaveGroup.${sessionId}`,
      `webpubsub.sendToGroup.${sessionId}`,
    ],
  });
  return url;
}
