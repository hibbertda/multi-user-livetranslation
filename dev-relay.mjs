/**
 * Local WebSocket relay for development.
 * Routes messages between host and guest(s) in the same session.
 * Runs on plain WS — Vite proxies /ws to this server over the same HTTPS origin.
 *
 * Usage: node dev-relay.mjs
 */

import { WebSocketServer } from 'ws';

const PORT = 8089;

/**
 * Per-session state.
 * @typedef {{ token: string | null, clients: Set<import('ws').WebSocket>, hostWs: import('ws').WebSocket | null, ended: boolean }} SessionState
 */

/** @type {Map<string, SessionState>} */
const sessions = new Map();

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `ws://localhost:${PORT}`);
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
    const state = sessions.get(sessionId);
    state.hostWs = ws;
    state.ended = false;
    state.clients.add(ws);
    console.log(`[relay] host joined session ${sessionId.slice(0, 8)}… (${state.clients.size} clients)`);
  } else {
    // Guest — validate before allowing in
    const state = sessions.get(sessionId);
    if (!state) {
      console.log(`[relay] guest rejected — session ${sessionId.slice(0, 8)}… not found`);
      ws.close(4001, 'Session not found');
      return;
    }
    if (state.token && state.token !== token) {
      console.log(`[relay] guest rejected — invalid token for session ${sessionId.slice(0, 8)}…`);
      ws.close(4002, 'Invalid session token');
      return;
    }
    if (state.ended) {
      console.log(`[relay] guest rejected — session ${sessionId.slice(0, 8)}… has ended`);
      ws.close(4003, 'Session has ended');
      return;
    }
    if (!state.hostWs || state.hostWs.readyState !== 1) {
      console.log(`[relay] guest rejected — no host in session ${sessionId.slice(0, 8)}…`);
      ws.close(4004, 'Host is not connected');
      return;
    }
    state.clients.add(ws);
    console.log(`[relay] guest joined session ${sessionId.slice(0, 8)}… (${state.clients.size} clients)`);
  }

  const state = sessions.get(sessionId);

  ws.on('message', (data) => {
    const msg = data.toString();
    try {
      const parsed = JSON.parse(msg);
      console.log(`[relay] ${role} → ${parsed.type} (${state.clients.size - 1} recipients)`);
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
    console.log(`[relay] ${role} left session ${sessionId.slice(0, 8)}… (${state.clients.size} clients)`);
    // Clean up ended sessions with no clients
    if (state.clients.size === 0 && state.ended) {
      sessions.delete(sessionId);
    }
  });
});

console.log(`[relay] WS relay listening on ws://127.0.0.1:${PORT} (Vite proxies /ws here)`);
