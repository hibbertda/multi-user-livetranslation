export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for environments without crypto.randomUUID.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
