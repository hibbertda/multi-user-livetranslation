import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalingChannel, type ConnectionStatus } from './signalingService';
import type { SessionMessage } from '../types';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    speechRegion: '',
    speechResourceName: '',
    translatorEndpoint: '',
    translatorRegion: '',
    azureClientId: '',
    azureTenantId: '',
    signalingEndpoint: '',
  },
}));

vi.mock('../config', () => ({ config: mockConfig }));
vi.mock('../utils/telemetry', () => ({ trackEvent: vi.fn() }));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  readonly url: string;
  readonly protocols?: string[];

  constructor(url: string, protocols?: string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  fireClose(code = 1006, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

function setup(overrides: Partial<ConstructorParameters<typeof SignalingChannel>[0]> = {}) {
  const messages: SessionMessage[] = [];
  const statuses: ConnectionStatus[] = [];
  const channel = new SignalingChannel({
    sessionId: 'session-1',
    role: 'host',
    onMessage: (message) => messages.push(message),
    onStatus: (status) => statuses.push(status),
    ...overrides,
  });
  return { channel, messages, statuses };
}

function latestSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

describe('SignalingChannel', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    mockConfig.signalingEndpoint = '';
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('dev relay transport (no signaling endpoint)', () => {
    it('connects to the local relay with session and role query params', () => {
      const { channel, statuses } = setup();
      channel.connect();

      expect(statuses).toEqual(['connecting']);
      const socket = latestSocket();
      expect(socket.url).toBe(`${window.location.origin.replace(/^http/, 'ws')}/ws?session=session-1&role=host`);
      expect(socket.protocols).toBeUndefined();
    });

    it('includes the dev token when provided', () => {
      const { channel } = setup({ devToken: 'dev-123' });
      channel.connect();

      expect(latestSocket().url).toContain('token=dev-123');
    });

    it('reports connected on open without joining a group', () => {
      const { channel, statuses } = setup();
      channel.connect();
      latestSocket().open();

      expect(statuses).toEqual(['connecting', 'connected']);
      expect(latestSocket().sent).toEqual([]);
    });

    it('forwards parsed messages verbatim', () => {
      const { channel, messages } = setup();
      channel.connect();
      const socket = latestSocket();
      socket.open();
      socket.emit({ type: 'utterance', payload: { id: 'u1' } });

      expect(messages).toEqual([{ type: 'utterance', payload: { id: 'u1' } }]);
    });

    it('ignores malformed message payloads', () => {
      const { channel, messages } = setup();
      channel.connect();
      const socket = latestSocket();
      socket.open();
      socket.emit('{not json');

      expect(messages).toEqual([]);
    });

    it('sends raw JSON messages when the socket is open', () => {
      const { channel } = setup();
      channel.connect();
      const socket = latestSocket();
      socket.open();
      channel.send({ type: 'ping' } as unknown as SessionMessage);

      expect(socket.sent).toEqual([JSON.stringify({ type: 'ping' })]);
    });

    it('drops sends while the socket is not open', () => {
      const { channel } = setup();
      channel.connect();
      const socket = latestSocket();
      channel.send({ type: 'ping' } as unknown as SessionMessage);

      expect(socket.sent).toEqual([]);
    });
  });

  describe('reconnection', () => {
    it('reconnects after an unexpected close', () => {
      const { channel, statuses } = setup();
      channel.connect();
      latestSocket().fireClose(1006);

      expect(statuses).toEqual(['connecting', 'disconnected']);
      expect(FakeWebSocket.instances).toHaveLength(1);

      vi.advanceTimersByTime(3000);
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it.each([4001, 4002, 4003, 4004])('does not reconnect after rejection code %i', (code) => {
      const { channel, statuses } = setup();
      channel.connect();
      latestSocket().fireClose(code, 'denied');

      expect(statuses).toEqual(['connecting', 'rejected']);
      vi.advanceTimersByTime(10_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('reports error status on socket error without closing', () => {
      const { channel, statuses } = setup();
      channel.connect();
      latestSocket().onerror?.();

      expect(statuses).toEqual(['connecting', 'error']);
    });

    it('cancels pending reconnects when closed', () => {
      const { channel } = setup();
      channel.connect();
      latestSocket().fireClose(1006);
      channel.close();

      vi.advanceTimersByTime(10_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('ignores connect() after close()', () => {
      const { channel, statuses } = setup();
      channel.close();
      channel.connect();

      expect(statuses).toEqual([]);
      expect(FakeWebSocket.instances).toHaveLength(0);
    });
  });

  describe('Web PubSub transport', () => {
    it('joins the session group on open when using a direct URL', () => {
      const { channel } = setup({ directUrl: 'wss://pubsub.example/client' });
      channel.connect();

      const socket = latestSocket();
      expect(socket.protocols).toEqual(['json.webpubsub.azure.v1']);
      socket.open();

      expect(JSON.parse(socket.sent[0])).toEqual({ type: 'joinGroup', group: 'session-1' });
    });

    it('unwraps group and user messages and ignores system frames', () => {
      const { channel, messages } = setup({ directUrl: 'wss://pubsub.example/client' });
      channel.connect();
      const socket = latestSocket();
      socket.open();

      socket.emit({ type: 'message', from: 'group', data: { type: 'utterance', id: 'u1' } });
      socket.emit({ type: 'message', from: 'user', data: { type: 'control', id: 'c1' } });
      socket.emit({ type: 'system', event: 'connected' });
      socket.emit({ type: 'message', from: 'server', data: { type: 'ignored' } });

      expect(messages).toEqual([
        { type: 'utterance', id: 'u1' },
        { type: 'control', id: 'c1' },
      ]);
    });

    it('wraps outbound messages in a sendToGroup envelope', () => {
      const { channel } = setup({ directUrl: 'wss://pubsub.example/client' });
      channel.connect();
      const socket = latestSocket();
      socket.open();
      socket.sent.length = 0;

      channel.send({ type: 'utterance' } as unknown as SessionMessage);

      expect(JSON.parse(socket.sent[0])).toEqual({
        type: 'sendToGroup',
        group: 'session-1',
        noEcho: true,
        dataType: 'json',
        data: { type: 'utterance' },
      });
    });
  });

  describe('negotiation', () => {
    beforeEach(() => {
      mockConfig.signalingEndpoint = 'https://api.example.com';
    });

    it('negotiates a client URL and connects with the Web PubSub subprotocol', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: 'wss://pubsub.example/negotiated' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      vi.stubGlobal('fetch', fetchMock);

      const { channel } = setup({ getAccessToken: async () => 'access-token' });
      channel.connect();
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.example.com/api/negotiate?session=session-1');
      expect((init.headers as Record<string, string>).Authorization).toContain('access-token');
      expect(latestSocket().url).toBe('wss://pubsub.example/negotiated');
      expect(latestSocket().protocols).toEqual(['json.webpubsub.azure.v1']);
    });

    it.each([401, 403, 404, 410])('rejects permanently on HTTP %i', async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'denied' }), { status })));

      const { channel, statuses } = setup({ getAccessToken: async () => 'access-token' });
      channel.connect();
      await vi.waitFor(() => expect(statuses).toContain('rejected'));

      vi.advanceTimersByTime(10_000);
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('schedules a reconnect on transient negotiate failures', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));

      const { channel, statuses } = setup({ getAccessToken: async () => 'access-token' });
      channel.connect();
      await vi.waitFor(() => expect(statuses).toContain('error'));

      vi.advanceTimersByTime(3000);
      expect(statuses.filter((status) => status === 'connecting')).toHaveLength(2);
    });

    it('schedules a reconnect when the negotiate request throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

      const { channel, statuses } = setup({ getAccessToken: async () => 'access-token' });
      channel.connect();
      await vi.waitFor(() => expect(statuses).toContain('error'));
    });
  });
});
