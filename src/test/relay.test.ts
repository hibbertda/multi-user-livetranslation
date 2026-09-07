/**
 * Tests for dev-relay session state logic.
 * Validates host reconnect rejection for ended sessions.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

// Extract relay state logic for testing
interface SessionState {
  token: string | null;
  clients: Set<unknown>;
  hostWs: unknown | null;
  ended: boolean;
}

function canHostJoin(sessions: Map<string, SessionState>, sessionId: string): { allowed: boolean; reason?: string } {
  const state = sessions.get(sessionId);
  if (!state) return { allowed: true }; // new session
  if (state.ended) return { allowed: false, reason: 'Session has ended' };
  return { allowed: true };
}

function canGuestJoin(sessions: Map<string, SessionState>, sessionId: string, token: string | null): { allowed: boolean; reason?: string } {
  const state = sessions.get(sessionId);
  if (!state) return { allowed: false, reason: 'Session not found' };
  if (state.token && state.token !== token) return { allowed: false, reason: 'Invalid session token' };
  if (state.ended) return { allowed: false, reason: 'Session has ended' };
  if (!state.hostWs) return { allowed: false, reason: 'Host is not connected' };
  return { allowed: true };
}

describe('dev-relay state logic', () => {
  it('allows host to create a new session', () => {
    const sessions = new Map<string, SessionState>();
    expect(canHostJoin(sessions, 'session-1')).toEqual({ allowed: true });
  });

  it('allows host to reconnect to a non-ended session', () => {
    const sessions = new Map<string, SessionState>();
    sessions.set('session-1', { token: null, clients: new Set(), hostWs: {}, ended: false });
    expect(canHostJoin(sessions, 'session-1')).toEqual({ allowed: true });
  });

  it('rejects host reconnect to an ended session', () => {
    const sessions = new Map<string, SessionState>();
    sessions.set('session-1', { token: null, clients: new Set(), hostWs: null, ended: true });
    const result = canHostJoin(sessions, 'session-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('ended');
  });

  it('rejects guest when session not found', () => {
    const sessions = new Map<string, SessionState>();
    const result = canGuestJoin(sessions, 'nonexistent', null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('rejects guest when session has ended', () => {
    const sessions = new Map<string, SessionState>();
    sessions.set('session-1', { token: null, clients: new Set(), hostWs: null, ended: true });
    const result = canGuestJoin(sessions, 'session-1', null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('ended');
  });

  it('rejects guest with invalid token', () => {
    const sessions = new Map<string, SessionState>();
    sessions.set('session-1', { token: 'secret-token', clients: new Set(), hostWs: {}, ended: false });
    const result = canGuestJoin(sessions, 'session-1', 'wrong-token');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Invalid');
  });

  it('allows guest with valid token and connected host', () => {
    const sessions = new Map<string, SessionState>();
    sessions.set('session-1', { token: 'secret-token', clients: new Set(), hostWs: {}, ended: false });
    expect(canGuestJoin(sessions, 'session-1', 'secret-token')).toEqual({ allowed: true });
  });
});
