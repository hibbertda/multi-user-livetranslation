/**
 * Integration tests for the real dev relay (dev-relay.mjs) running in-process.
 *
 * Starts the actual relay server on an ephemeral port and drives it with real
 * `ws` clients acting as a host and two guest devices, so the routing, admission
 * and session-end rules are exercised end to end rather than mirrored.
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
// @ts-expect-error - dev-relay.mjs is plain JS with JSDoc types only.
import { createRelayServer } from '../../dev-relay.mjs';

interface RelayHandle {
  wss: { address: () => { port: number } | string | null; on: (event: string, listener: () => void) => void };
  sessions: Map<string, { ended: boolean; clients: Set<unknown>; hostWs: unknown }>;
  address: () => { port: number } | string | null;
  close: () => Promise<unknown>;
}

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'session-token';

let relay: RelayHandle;
let port: number;
const openSockets: WebSocket[] = [];

function connect(params: Record<string, string>): WebSocket {
  const query = new URLSearchParams(params).toString();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`);
  openSockets.push(socket);
  return socket;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

/**
 * The relay accepts the handshake and then closes refused clients with an
 * application close code, so rejection is observed on the close event.
 */
async function connectExpectingRejection(params: Record<string, string>): Promise<{ code: number; reason: string }> {
  const socket = connect(params);
  return waitForClose(socket);
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
  });
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('message', (data: Buffer) => resolve(JSON.parse(data.toString())));
  });
}

/** Collects every message a socket receives for later assertions. */
function collectMessages(socket: WebSocket): unknown[] {
  const received: unknown[] = [];
  socket.on('message', (data: Buffer) => received.push(JSON.parse(data.toString())));
  return received;
}

/** Lets queued relay I/O drain so "nothing was delivered" assertions are meaningful. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

async function connectHost(params: Record<string, string> = {}): Promise<WebSocket> {
  const host = connect({ session: SESSION_ID, role: 'host', token: TOKEN, ...params });
  await waitForOpen(host);
  return host;
}

async function connectGuest(params: Record<string, string> = {}): Promise<WebSocket> {
  const guest = connect({ session: SESSION_ID, role: 'guest', token: TOKEN, ...params });
  await waitForOpen(guest);
  return guest;
}

describe('dev relay two-party session', () => {
  beforeEach(async () => {
    relay = createRelayServer({ port: 0, logger: { log: () => undefined } }) as RelayHandle;
    await new Promise<void>((resolve) => relay.wss.on('listening', resolve));
    port = (relay.address() as { port: number }).port;
  });

  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      socket.removeAllListeners();
      socket.close();
    }
    await relay.close();
  });

  describe('admission', () => {
    it('rejects a guest before the host has created the session', async () => {
      const closed = await connectExpectingRejection({ session: SESSION_ID, role: 'guest', token: TOKEN });

      expect(closed.code).toBe(4001);
      expect(closed.reason).toBe('Session not found');
    });

    it('rejects a connection without a session parameter', async () => {
      const closed = await connectExpectingRejection({ role: 'host' });

      expect(closed.code).toBe(4000);
    });

    it('rejects a guest presenting the wrong token', async () => {
      await connectHost();

      const closed = await connectExpectingRejection({ session: SESSION_ID, role: 'guest', token: 'wrong-token' });
      expect(closed.code).toBe(4002);
      expect(closed.reason).toBe('Invalid session token');
    });

    it('rejects a guest when the host has disconnected', async () => {
      const host = await connectHost();
      host.close();
      await waitForClose(host);

      const closed = await connectExpectingRejection({ session: SESSION_ID, role: 'guest', token: TOKEN });
      expect(closed.code).toBe(4004);
      expect(closed.reason).toBe('Host is not connected');
    });

    it('admits guests once the host is connected with a matching token', async () => {
      await connectHost();

      await expect(connectGuest()).resolves.toBeDefined();
      expect(relay.sessions.get(SESSION_ID)?.clients.size).toBe(2);
    });
  });

  describe('message fan-out across devices', () => {
    it('delivers a guest message to the host and the other guest but not back to the sender', async () => {
      const host = await connectHost();
      const guestA = await connectGuest();
      const guestB = await connectGuest();

      const hostReceived = collectMessages(host);
      const guestAReceived = collectMessages(guestA);
      const guestBReceived = collectMessages(guestB);

      const message = { type: 'guest-audio', guestId: 'guest-a', text: 'hola', detectedLanguage: 'es-ES' };
      guestA.send(JSON.stringify(message));
      await settle();

      expect(hostReceived).toEqual([message]);
      expect(guestBReceived).toEqual([message]);
      expect(guestAReceived).toEqual([]);
    });

    it('broadcasts host utterances to every connected guest', async () => {
      const host = await connectHost();
      const guestA = await connectGuest();
      const guestB = await connectGuest();

      const utterance = {
        type: 'utterance',
        utterance: {
          id: 'u1',
          speakerId: 's1',
          speakerLabel: 'Host',
          originalText: 'good morning',
          translatedTexts: { es: 'buenos días' },
          detectedLanguage: 'en-US',
          timestamp: 1,
        },
      };

      const guestAMessage = nextMessage(guestA);
      const guestBMessage = nextMessage(guestB);
      host.send(JSON.stringify(utterance));

      await expect(guestAMessage).resolves.toEqual(utterance);
      await expect(guestBMessage).resolves.toEqual(utterance);
    });

    it('relays non-JSON payloads without dropping the connection', async () => {
      const host = await connectHost();
      const guest = await connectGuest();

      const raw = new Promise<string>((resolve) => guest.once('message', (data: Buffer) => resolve(data.toString())));
      host.send('not json');

      await expect(raw).resolves.toBe('not json');
      expect(guest.readyState).toBe(WebSocket.OPEN);
      expect(host.readyState).toBe(WebSocket.OPEN);
    });

    it('stops delivering to a guest that has left', async () => {
      const host = await connectHost();
      const guestA = await connectGuest();
      const guestB = await connectGuest();

      const guestBReceived = collectMessages(guestB);
      guestA.close();
      await waitForClose(guestA);

      host.send(JSON.stringify({ type: 'utterance', utterance: { id: 'u2' } }));
      await settle();

      expect(guestBReceived).toHaveLength(1);
      expect(relay.sessions.get(SESSION_ID)?.clients.size).toBe(2);
    });
  });

  describe('guest disconnect', () => {
    it('synthesises a leave for an identified guest that drops', async () => {
      const host = await connectHost();
      const alice = await connectGuest();
      const bob = await connectGuest();

      alice.send(JSON.stringify({ type: 'join', guest: { id: 'guest-alice', name: 'Alice', language: 'es-ES', joinedAt: 1 } }));
      await settle();

      const hostMessages = collectMessages(host);
      const bobMessages = collectMessages(bob);
      alice.close();
      await settle();

      expect(hostMessages).toContainEqual({ type: 'leave', guestId: 'guest-alice', reason: 'timeout' });
      expect(bobMessages).toContainEqual({ type: 'leave', guestId: 'guest-alice', reason: 'timeout' });
    });

    it('identifies a guest from its audio when it never announced a join', async () => {
      const host = await connectHost();
      const alice = await connectGuest();

      alice.send(JSON.stringify({ type: 'guest-audio', guestId: 'guest-alice', text: 'hola', detectedLanguage: 'es-ES' }));
      await settle();

      const hostMessages = collectMessages(host);
      alice.close();
      await settle();

      expect(hostMessages).toContainEqual({ type: 'leave', guestId: 'guest-alice', reason: 'timeout' });
    });

    it('does not synthesise a leave for an anonymous guest', async () => {
      const host = await connectHost();
      const alice = await connectGuest();

      const hostMessages = collectMessages(host);
      alice.close();
      await settle();

      expect(hostMessages).toEqual([]);
    });

    it('does not synthesise a leave after an explicit leave', async () => {
      const host = await connectHost();
      const alice = await connectGuest();

      alice.send(JSON.stringify({ type: 'join', guest: { id: 'guest-alice', name: 'Alice', language: 'es-ES', joinedAt: 1 } }));
      await settle();
      alice.send(JSON.stringify({ type: 'leave', guestId: 'guest-alice', reason: 'left' }));
      await settle();

      const hostMessages = collectMessages(host);
      alice.close();
      await settle();

      expect(hostMessages).toEqual([]);
    });

    it('does not synthesise a leave when the host disconnects', async () => {
      const host = await connectHost();
      const alice = await connectGuest();

      const aliceMessages = collectMessages(alice);
      host.close();
      await settle();

      expect(aliceMessages).toEqual([]);
    });
  });

  describe('session end', () => {
    it('marks the session ended and blocks further joins', async () => {
      const host = await connectHost();
      const guest = await connectGuest();

      const guestMessage = nextMessage(guest);
      host.send(JSON.stringify({ type: 'session-end' }));
      await expect(guestMessage).resolves.toEqual({ type: 'session-end' });

      expect(relay.sessions.get(SESSION_ID)?.ended).toBe(true);

      const closed = await connectExpectingRejection({ session: SESSION_ID, role: 'guest', token: TOKEN });
      expect(closed.code).toBe(4003);
      expect(closed.reason).toBe('Session has ended');
    });

    it('blocks the host from re-opening a session that is still ending', async () => {
      const host = await connectHost();
      // A guest stays connected so the ended session is not yet garbage collected.
      await connectGuest();
      host.send(JSON.stringify({ type: 'session-end' }));
      await settle();
      host.close();
      await waitForClose(host);

      const closed = await connectExpectingRejection({ session: SESSION_ID, role: 'host', token: TOKEN });
      expect(closed.code).toBe(4003);
    });

    it('discards ended session state once every client has left, freeing the id for reuse', async () => {
      const host = await connectHost();
      const guest = await connectGuest();

      host.send(JSON.stringify({ type: 'session-end' }));
      await settle();

      guest.close();
      await waitForClose(guest);
      host.close();
      await waitForClose(host);
      await settle();

      expect(relay.sessions.has(SESSION_ID)).toBe(false);

      // A fresh host may then reuse the id for a brand new session.
      await expect(connectHost()).resolves.toBeDefined();
      expect(relay.sessions.get(SESSION_ID)?.ended).toBe(false);
    });
  });

  describe('host reconnection', () => {
    it('allows the host to rejoin an active session and keeps guests reachable', async () => {
      const host = await connectHost();
      const guest = await connectGuest();
      host.close();
      await waitForClose(host);

      const reconnectedHost = await connectHost();
      const guestMessage = nextMessage(guest);
      reconnectedHost.send(JSON.stringify({ type: 'speaker-update', speaker: { id: 's1', label: 'Host' } }));

      await expect(guestMessage).resolves.toMatchObject({ type: 'speaker-update' });
    });

    it('isolates messages between concurrent sessions', async () => {
      const otherSessionId = '99999999-8888-4777-8666-555555555555';
      const hostA = await connectHost();
      const guestA = await connectGuest();

      const hostB = connect({ session: otherSessionId, role: 'host', token: TOKEN });
      await waitForOpen(hostB);
      const guestB = connect({ session: otherSessionId, role: 'guest', token: TOKEN });
      await waitForOpen(guestB);

      const guestAReceived = collectMessages(guestA);
      const guestBReceived = collectMessages(guestB);

      hostA.send(JSON.stringify({ type: 'utterance', utterance: { id: 'from-a' } }));
      hostB.send(JSON.stringify({ type: 'utterance', utterance: { id: 'from-b' } }));
      await settle();

      expect(guestAReceived).toEqual([{ type: 'utterance', utterance: { id: 'from-a' } }]);
      expect(guestBReceived).toEqual([{ type: 'utterance', utterance: { id: 'from-b' } }]);
    });
  });
});
