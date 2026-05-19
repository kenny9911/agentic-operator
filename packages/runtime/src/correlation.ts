/**
 * Correlation IDs — one per run, propagated to every step, log line, and
 * emitted event. Per Plan agent review: must be threaded NOW, not retrofitted.
 *
 * `event.data.__correlationId` is checked first (chained runs propagate it);
 * absent → mint a new one.
 */

export function correlationFromEvent(event: {
  data?: unknown;
}): string {
  const data = event.data as { __correlationId?: unknown } | undefined;
  const existing =
    typeof data?.__correlationId === "string" ? data.__correlationId : undefined;
  return existing ?? crypto.randomUUID();
}

export function withCorrelation<T extends Record<string, unknown>>(
  correlationId: string,
  data: T,
): T & { __correlationId: string } {
  return { ...data, __correlationId: correlationId };
}
