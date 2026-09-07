import { config } from '../config';
import type { GuestRequest, Session, SessionMessage, Speaker, Utterance } from '../types';

export class ApiResponseError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiResponseError';
    this.status = status;
  }
}

export interface WelcomePayload {
  session: Session;
  speakers: [string, Speaker][];
  utterances: Utterance[];
}

export interface GuestRequestStatusResponse {
  status: 'pending' | 'approved' | 'denied' | 'expired';
  admissionTicket?: string;
}

export interface GuestExchangeResponse {
  url: string;
  guestId: string;
  admissionId: string;
}

function apiBase(): string {
  return config.signalingEndpoint || '';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = (payload as { error?: string }).error ?? `HTTP ${response.status}`;
    throw new ApiResponseError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function generateInviteSecret(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function computeSha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildInviteUrl(baseUrl: string, sessionId: string, inviteSecret: string): string {
  const inviteUrl = new URL('/join', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  inviteUrl.searchParams.set('session', sessionId);
  inviteUrl.hash = `invite=${inviteSecret}`;
  return inviteUrl.toString();
}

export function extractInviteSecretFromHash(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(fragment);
  const invite = params.get('invite')?.trim();
  return invite || null;
}

export function scrubInviteFragment(url: string): string {
  const next = new URL(url, window.location.origin);
  next.hash = '';
  return next.toString();
}

export function scrubInviteFromLocation(): string | null {
  const inviteSecret = extractInviteSecretFromHash(window.location.hash);
  if (!inviteSecret) return null;

  const cleanUrl = new URL(window.location.href);
  cleanUrl.hash = '';
  window.history.replaceState(null, '', `${cleanUrl.pathname}${cleanUrl.search}`);
  return inviteSecret;
}

export function validateRequestSecret(expected: string, actual: string): boolean {
  return Boolean(expected) && expected === actual;
}

export function isExpired(expiresAt: number, now = Date.now()): boolean {
  return expiresAt <= now;
}

export async function createInvite(
  sessionId: string,
  accessToken: string,
  invite: { hash: string; expiresAt: number; maxUses: number },
): Promise<void> {
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/invites`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify(invite),
  });
}

export async function revokeInvite(sessionId: string, accessToken: string, hash: string): Promise<void> {
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/invites/revoke`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify({ hash }),
  });
}

export async function requestGuestAccess(payload: {
  inviteSecret: string;
  sessionId: string;
  name: string;
  language: string;
}): Promise<{ requestId: string; requestSecret: string }> {
  return requestJson('/api/guest/request', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getGuestRequestStatus(requestId: string, requestSecret: string): Promise<GuestRequestStatusResponse> {
  const query = new URLSearchParams({ secret: requestSecret });
  return requestJson(`/api/guest/request/${encodeURIComponent(requestId)}/status?${query.toString()}`);
}

export async function exchangeGuestTicket(ticket: string, sessionId: string): Promise<GuestExchangeResponse> {
  return requestJson('/api/guest/exchange', {
    method: 'POST',
    body: JSON.stringify({ ticket, sessionId }),
  });
}

export async function sendGuestJoin(payload: {
  sessionId: string;
  guestId: string;
  name: string;
  language: string;
  admissionId: string;
}): Promise<void> {
  await requestJson('/api/guest/join', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function sendGuestAudio(payload: {
  sessionId: string;
  guestId: string;
  text: string;
  detectedLanguage: string;
  admissionId: string;
}): Promise<void> {
  await requestJson('/api/guest/audio', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function pollGuestWelcome(
  sessionId: string,
  guestId: string,
  admissionId: string,
): Promise<{ status: 'pending' } | { status: 'ready'; welcome: WelcomePayload }> {
  const query = new URLSearchParams({ guestId, admissionId });
  return requestJson(`/api/guest/welcome/${encodeURIComponent(sessionId)}?${query.toString()}`);
}

export async function fetchPendingGuestRequests(sessionId: string, accessToken: string): Promise<GuestRequest[]> {
  return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/guests/pending`, {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
}

export async function approveGuestRequest(sessionId: string, requestId: string, accessToken: string): Promise<void> {
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/guests/${encodeURIComponent(requestId)}/approve`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
  });
}

export async function denyGuestRequest(sessionId: string, requestId: string, accessToken: string): Promise<void> {
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/guests/${encodeURIComponent(requestId)}/deny`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
  });
}

export async function revokeGuest(sessionId: string, guestId: string, accessToken: string): Promise<void> {
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/guests/${encodeURIComponent(guestId)}/revoke`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
  });
}

export async function sendWelcome(
  sessionId: string,
  guestId: string,
  admissionId: string,
  welcome: WelcomePayload,
  accessToken: string,
): Promise<void> {
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/welcome`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify({ guestId, admissionId, ...welcome }),
  });
}

export function isWelcomeMessageForGuest(message: SessionMessage, guestId: string): boolean {
  return message.type === 'welcome' && (!('targetGuestId' in message) || !message.targetGuestId || message.targetGuestId === guestId);
}
