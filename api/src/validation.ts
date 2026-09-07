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
