import type { SessionMessage } from '../types';
import { config } from '../config';
import { trackEvent } from '../utils/telemetry';

type MessageHandler = (message: SessionMessage) => void;
type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'rejected') => void;

/** Close codes 4001-4004 indicate the session is invalid / gone. */
const SESSION_REJECTION_CODES = new Set([4001, 4002, 4003, 4004]);

/** Web PubSub JSON subprotocol identifier */
const WPS_SUBPROTOCOL = 'json.webpubsub.azure.v1';

export class SignalingChannel {
  private ws: WebSocket | null = null;
  private onMessage: MessageHandler;
  private onStatus: StatusHandler;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string;
  private token: string;
  private role: 'host' | 'guest';
  private closed = false;
  /** True when connected via Web PubSub (production), false for dev-relay */
  private useWebPubSub = false;

  constructor(opts: {
    sessionId: string;
    token: string;
    role: 'host' | 'guest';
    onMessage: MessageHandler;
    onStatus: StatusHandler;
  }) {
    this.sessionId = opts.sessionId;
    this.token = opts.token;
    this.role = opts.role;
    this.onMessage = opts.onMessage;
    this.onStatus = opts.onStatus;
  }

  connect(): void {
    if (this.closed) return;
    this.onStatus('connecting');

    const endpoint = config.signalingEndpoint;
    if (endpoint) {
      // Production — negotiate with the Function App to get a Web PubSub URL
      this.useWebPubSub = true;
      this.negotiateAndConnect(endpoint);
    } else {
      // Dev — connect directly via Vite proxy to dev-relay
      this.useWebPubSub = false;
      const base = window.location.origin.replace(/^http/, 'ws');
      const url = `${base}/ws?session=${encodeURIComponent(this.sessionId)}&token=${encodeURIComponent(this.token)}&role=${this.role}`;
      this.openSocket(url);
    }
  }

  private async negotiateAndConnect(endpoint: string): Promise<void> {
    try {
      const params = new URLSearchParams({
        session: this.sessionId,
        token: this.token,
        role: this.role,
      });
      const res = await fetch(`${endpoint}/api/negotiate?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
        trackEvent('signaling.negotiate_failed', { status: res.status, error: msg });
        if (res.status === 404 || res.status === 403 || res.status === 410) {
          this.closed = true;
          this.onStatus('rejected');
          return;
        }
        this.onStatus('error');
        this.scheduleReconnect();
        return;
      }
      const { url } = (await res.json()) as { url: string };
      this.openSocket(url, [WPS_SUBPROTOCOL]);
    } catch {
      trackEvent('signaling.negotiate_error', { role: this.role });
      this.onStatus('error');
      this.scheduleReconnect();
    }
  }

  private openSocket(url: string, protocols?: string[]): void {
    if (this.closed) return;

    this.ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);

    this.ws.onopen = () => {
      trackEvent('signaling.connected', { role: this.role, sessionId: this.sessionId, wps: this.useWebPubSub });
      if (this.useWebPubSub) {
        // Join the session group (permissions were granted via the access token)
        this.ws!.send(JSON.stringify({
          type: 'joinGroup',
          group: this.sessionId,
        }));
      }
      this.onStatus('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string);

        if (this.useWebPubSub) {
          // Web PubSub wraps messages: { type: "message", from: "group", data: ... }
          if (raw.type === 'message' && raw.from === 'group') {
            this.onMessage(raw.data as SessionMessage);
          }
          // Ignore ack, system, and other Web PubSub frames
          return;
        }

        // Dev relay — raw messages
        this.onMessage(raw as SessionMessage);
      } catch {
        trackEvent('signaling.parse_error', { data: String(event.data).slice(0, 200) });
      }
    };

    this.ws.onclose = (event) => {
      if (SESSION_REJECTION_CODES.has(event.code)) {
        trackEvent('signaling.rejected', { role: this.role, code: event.code, reason: event.reason });
        this.closed = true;
        this.onStatus('rejected');
        return;
      }
      trackEvent('signaling.disconnected', { role: this.role });
      this.onStatus('disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      trackEvent('signaling.error', { role: this.role });
      this.onStatus('error');
    };
  }

  send(message: SessionMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    if (this.useWebPubSub) {
      // Send via Web PubSub group with noEcho so sender doesn't receive own message
      this.ws.send(JSON.stringify({
        type: 'sendToGroup',
        group: this.sessionId,
        noEcho: true,
        dataType: 'json',
        data: message,
      }));
    } else {
      // Dev relay — raw message
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.reconnectTimer = setTimeout(() => {
      trackEvent('signaling.reconnecting', { role: this.role });
      this.connect();
    }, 3000);
  }
}
