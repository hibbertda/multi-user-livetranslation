import type { SessionMessage } from '../types';
import { config } from '../config';
import { trackEvent } from '../utils/telemetry';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'rejected';

type MessageHandler = (message: SessionMessage) => void;
type StatusHandler = (status: ConnectionStatus) => void;

const SESSION_REJECTION_CODES = new Set([4001, 4002, 4003, 4004]);
const WPS_SUBPROTOCOL = 'json.webpubsub.azure.v1';

export class SignalingChannel {
  private ws: WebSocket | null = null;
  private readonly onMessage: MessageHandler;
  private readonly onStatus: StatusHandler;
  private readonly sessionId: string;
  private readonly role: 'host' | 'guest';
  private readonly getAccessToken?: () => Promise<string>;
  private readonly directUrl?: string;
  private readonly devToken?: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private useWebPubSub = false;

  constructor(opts: {
    sessionId: string;
    role: 'host' | 'guest';
    onMessage: MessageHandler;
    onStatus: StatusHandler;
    getAccessToken?: () => Promise<string>;
    directUrl?: string;
    devToken?: string;
  }) {
    this.sessionId = opts.sessionId;
    this.role = opts.role;
    this.onMessage = opts.onMessage;
    this.onStatus = opts.onStatus;
    this.getAccessToken = opts.getAccessToken;
    this.directUrl = opts.directUrl;
    this.devToken = opts.devToken;
  }

  connect(): void {
    if (this.closed) return;
    this.onStatus('connecting');

    if (this.directUrl) {
      this.useWebPubSub = true;
      this.openSocket(this.directUrl, [WPS_SUBPROTOCOL]);
      return;
    }

    const endpoint = config.signalingEndpoint;
    if (endpoint && this.getAccessToken) {
      this.useWebPubSub = true;
      void this.negotiateAndConnect(endpoint);
      return;
    }

    this.useWebPubSub = false;
    const base = window.location.origin.replace(/^http/, 'ws');
    const params = new URLSearchParams({
      session: this.sessionId,
      role: this.role,
    });
    if (this.devToken) params.set('token', this.devToken);
    this.openSocket(`${base}/ws?${params.toString()}`);
  }

  private async negotiateAndConnect(endpoint: string): Promise<void> {
    if (!this.getAccessToken) return;

    try {
      const accessToken = await this.getAccessToken();
      const params = new URLSearchParams({ session: this.sessionId });
      const response = await fetch(`${endpoint}/api/negotiate?${params.toString()}`, {
        headers: {
          Authorization: 'Bearer ' + accessToken,
        },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = (body as { error?: string }).error ?? `HTTP ${response.status}`;
        trackEvent('signaling.negotiate_failed', { status: response.status, error: message });
        if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 410) {
          this.closed = true;
          this.onStatus('rejected');
          return;
        }
        this.onStatus('error');
        this.scheduleReconnect();
        return;
      }

      const { url } = await response.json() as { url: string };
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
        this.ws?.send(JSON.stringify({
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
          if (raw.type === 'message' && (raw.from === 'group' || raw.from === 'user')) {
            this.onMessage(raw.data as SessionMessage);
          }
          return;
        }
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
      this.ws.send(JSON.stringify({
        type: 'sendToGroup',
        group: this.sessionId,
        noEcho: true,
        dataType: 'json',
        data: message,
      }));
      return;
    }

    this.ws.send(JSON.stringify(message));
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      trackEvent('signaling.reconnecting', { role: this.role });
      this.connect();
    }, 3000);
  }
}
