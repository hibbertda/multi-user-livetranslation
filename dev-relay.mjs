/**
 * Local WebSocket relay for development.
 * Routes messages between host and guest(s) in the same session.
 * Runs on plain WS — Vite proxies /ws to this server over the same HTTPS origin.
 *
 * Usage: node dev-relay.mjs
 */

import { WebSocketServer } from 'ws';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PORT = 8089;

/**
 * Per-session state.
 * @typedef {{ token: string | null, clients: Set<import('ws').WebSocket>, hostWs: import('ws').WebSocket | null, ended: boolean }} SessionState
 */

/**
 * Create a relay server instance.
 * Exported so tests can run the real routing logic on an ephemeral port.
 *
 * @param {{ port?: number, host?: string, logger?: Pick<Console, 'log'> }} [options]
 */
export function createRelayServer(options = {}) {
  const {
    port = DEFAULT_PORT,
    host = '127.0.0.1',
    logger = console,
  } = options;

  /** @type {Map<string, SessionState>} */
  const sessions = new Map();

  const wss = new WebSocketServer({ port, host });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `ws://localhost:${port}`);
    const sessionId = url.searchParams.get('session');
    const token = url.searchParams.get('token');
    const role = url.searchParams.get('role');

    if (!sessionId) {
      ws.close(4000, 'Missing session parameter');
      return;
    }

    if (role === 'host') {
      // Host creates / re-joins the session
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, { token, clients: new Set(), hostWs: null, ended: false });
      }
      const hostState = sessions.get(sessionId);
      if (hostState.ended) {
        logger.log(`[relay] host rejected — session ${sessionId.slice(0, 8)}… has ended`);
        ws.close(4003, 'Session has ended');
        return;
      }
      hostState.hostWs = ws;
      hostState.clients.add(ws);
      logger.log(`[relay] host joined session ${sessionId.slice(0, 8)}… (${hostState.clients.size} clients)`);
    } else {
      // Guest — validate before allowing in
      const guestState = sessions.get(sessionId);
      if (!guestState) {
        logger.log(`[relay] guest rejected — session ${sessionId.slice(0, 8)}… not found`);
        ws.close(4001, 'Session not found');
        return;
      }
      if (guestState.token && guestState.token !== token) {
        logger.log(`[relay] guest rejected — invalid token for session ${sessionId.slice(0, 8)}…`);
        ws.close(4002, 'Invalid session token');
        return;
      }
      if (guestState.ended) {
        logger.log(`[relay] guest rejected — session ${sessionId.slice(0, 8)}… has ended`);
        ws.close(4003, 'Session has ended');
        return;
      }
      if (!guestState.hostWs || guestState.hostWs.readyState !== 1) {
        logger.log(`[relay] guest rejected — no host in session ${sessionId.slice(0, 8)}…`);
        ws.close(4004, 'Host is not connected');
        return;
      }
      guestState.clients.add(ws);
      logger.log(`[relay] guest joined session ${sessionId.slice(0, 8)}… (${guestState.clients.size} clients)`);
    }

    const state = sessions.get(sessionId);

    ws.on('message', (data) => {
      const msg = data.toString();
      try {
        const parsed = JSON.parse(msg);
        logger.log(`[relay] ${role} → ${parsed.type} (${state.clients.size - 1} recipients)`);
        // Mark session as ended when host sends session-end
        if (parsed.type === 'session-end') {
          state.ended = true;
        }
      } catch { /* ignore parse errors in logging */ }
      for (const client of state.clients) {
        if (client !== ws && client.readyState === 1) {
          client.send(msg);
        }
      }
    });

    ws.on('close', () => {
      state.clients.delete(ws);
      if (role === 'host') {
        state.hostWs = null;
      }
      logger.log(`[relay] ${role} left session ${sessionId.slice(0, 8)}… (${state.clients.size} clients)`);
      // Clean up ended sessions with no clients
      if (state.clients.size === 0 && state.ended) {
        sessions.delete(sessionId);
      }
    });
  });

  return {
    wss,
    sessions,
    /** Port the server is actually listening on (resolved once listening). */
    address: () => wss.address(),
    close: () => new Promise((resolve) => wss.close(() => resolve(undefined))),
  };
}

// Start the relay when run directly (node dev-relay.mjs), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createRelayServer();
  console.log(`[relay] WS relay listening on ws://127.0.0.1:${DEFAULT_PORT} (Vite proxies /ws here)`);
}
