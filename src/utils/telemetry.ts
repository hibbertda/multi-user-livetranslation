type TelemetryProperties = Record<string, string | number | boolean | null | undefined>;

function sanitize(properties: TelemetryProperties): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined && value !== null),
  ) as Record<string, string | number | boolean>;
}

export function trackEvent(eventName: string, properties: TelemetryProperties = {}): void {
  const payload = {
    eventName,
    timestamp: new Date().toISOString(),
    ...sanitize(properties),
  };
  console.info('[telemetry]', payload);
}

export async function measureAsync<T>(
  eventName: string,
  action: () => Promise<T>,
  properties: TelemetryProperties = {},
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await action();
    trackEvent(`${eventName}:success`, {
      ...properties,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (error) {
    trackEvent(`${eventName}:failure`, {
      ...properties,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
