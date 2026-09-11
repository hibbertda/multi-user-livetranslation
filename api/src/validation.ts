import { timingSafeEqual } from 'node:crypto';

const SUPPORTED_LANGUAGE_CODES = new Set([
  'en-US',
  'ar-SA',
  'es-ES',
  'fr-FR',
  'de-DE',
  'zh-CN',
  'ja-JP',
  'pt-BR',
  'hi-IN',
  'ko-KR',
]);

export function normalizeName(name: string): string {
  return name.trim();
}

export function validateGuestName(name: string): string | null {
  const normalized = normalizeName(name);
  if (!normalized || normalized.length > 100) return null;
  return normalized;
}

export function isSupportedLanguage(language: string): boolean {
  return SUPPORTED_LANGUAGE_CODES.has(language);
}

export function validateLanguage(language: string): string | null {
  return isSupportedLanguage(language) ? language : null;
}

export function validateText(text: string, maxLength = 5000): string | null {
  const normalized = text.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

export function isExpired(expiresAt: number | undefined, now = Date.now()): boolean {
  return typeof expiresAt === 'number' && expiresAt <= now;
}

/** UUID v4 format as produced by crypto.randomUUID(). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(id: string): boolean {
  return UUID_RE.test(id);
}

export function validateTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
}

export function validateSessionStatus(status: string): 'active' | 'ended' | null {
  if (status === 'active' || status === 'ended') return status;
  return null;
}

export function validateUtteranceCount(count: unknown): number | null {
  if (typeof count !== 'number') return null;
  if (!Number.isInteger(count) || count < 0 || count > 100_000) return null;
  return count;
}

export function validateDurationMs(ms: unknown): number | null {
  if (ms === null) return null; // allow explicit null to clear
  if (typeof ms !== 'number') return null;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms;
}

/**
 * Constant-time comparison of two hex strings.
 * Returns false if either is empty or they differ in length.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return timingSafeEqual(bufA, bufB);
}

/**
 * Checks that a PATCH payload contains only the allowed field names.
 * Returns the list of unknown field names, or an empty array if all are valid.
 */
export function findUnknownFields(payload: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(payload).filter((key) => !allowed.has(key));
}
