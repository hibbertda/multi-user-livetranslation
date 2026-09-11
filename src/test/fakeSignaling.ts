/**
 * Test doubles that let the host and guest session hooks run against a shared,
 * in-memory signalling hub — approximating several devices in one session.
 */
import type {
  SignalingChannelFactory,
  SignalingChannelOptions,
  SignalingTransport,
} from '../services/signalingService';
import type { SessionMessage } from '../types';

export interface DeliveredMessage {
  role: 'host' | 'guest';
  label: string;
  message: SessionMessage;
}

class FakeChannel implements SignalingTransport {
  connected = false;
  readonly received: SessionMessage[] = [];

  private readonly hub: FakeSignalingHub;
  readonly options: SignalingChannelOptions;
  readonly label: string;

  constructor(hub: FakeSignalingHub, options: SignalingChannelOptions, label: string) {
    this.hub = hub;
    this.options = options;
    this.label = label;
  }

  connect(): void {
    this.options.onStatus('connecting');
    this.hub.register(this);
    this.connected = true;
    this.options.onStatus('connected');
  }

  send(message: SessionMessage): void {
    if (!this.connected) return;
    this.hub.broadcast(this, message);
  }

  close(): void {
    if (!this.connected) return;
    this.connected = false;
    this.hub.unregister(this);
  }

  /** Deliver a message to this channel only (host welcome, targeted revoke, …). */
  deliver(message: SessionMessage): void {
    if (!this.connected) return;
    this.received.push(message);
    this.options.onMessage(message);
  }

  /** Simulate the transport being dropped by the server. */
  drop(status: 'disconnected' | 'rejected' = 'disconnected'): void {
    this.connected = false;
    this.hub.unregister(this);
    this.options.onStatus(status);
  }
}

/**
 * Routes messages between every channel registered for the same session id,
 * mirroring the relay's "everyone except the sender" fan-out.
 */
export class FakeSignalingHub {
  private readonly channels = new Map<string, Set<FakeChannel>>();
  readonly delivered: DeliveredMessage[] = [];
  private channelCount = 0;

  /** Builds a factory to pass to a hook as its `createChannel` option. */
  factory(label?: string): SignalingChannelFactory {
    return (options: SignalingChannelOptions) => {
      this.channelCount += 1;
      const channel = new FakeChannel(this, options, label ?? `${options.role}-${this.channelCount}`);
      this.lastCreated = channel;
      return channel;
    };
  }

  lastCreated: FakeChannel | null = null;

  register(channel: FakeChannel): void {
    const set = this.channels.get(channel.options.sessionId) ?? new Set<FakeChannel>();
    set.add(channel);
    this.channels.set(channel.options.sessionId, set);
  }

  unregister(channel: FakeChannel): void {
    this.channels.get(channel.options.sessionId)?.delete(channel);
  }

  broadcast(sender: FakeChannel, message: SessionMessage): void {
    this.delivered.push({ role: sender.options.role, label: sender.label, message });
    for (const channel of this.channels.get(sender.options.sessionId) ?? []) {
      if (channel === sender) continue;
      channel.deliver(message);
    }
  }

  /** Inject a message as if the backend had published it (guest joins, audio, …). */
  publish(sessionId: string, message: SessionMessage, options: { to?: string } = {}): void {
    for (const channel of this.channels.get(sessionId) ?? []) {
      if (options.to && channel.label !== options.to) continue;
      channel.deliver(message);
    }
  }

  channelsFor(sessionId: string): FakeChannel[] {
    return Array.from(this.channels.get(sessionId) ?? []);
  }

  find(label: string): FakeChannel | undefined {
    for (const set of this.channels.values()) {
      for (const channel of set) {
        if (channel.label === label) return channel;
      }
    }
    return undefined;
  }

  messagesSentBy(label: string): SessionMessage[] {
    return this.delivered.filter((entry) => entry.label === label).map((entry) => entry.message);
  }

  reset(): void {
    this.channels.clear();
    this.delivered.length = 0;
    this.lastCreated = null;
    this.channelCount = 0;
  }
}

export type { FakeChannel };
