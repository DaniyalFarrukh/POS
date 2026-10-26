/**
 * Computes the next retry delay in milliseconds using exponential backoff with jitter:
 * - 2s initial delay doubling with each attempt (2s, 4s, 8s, 16s...)
 * - Capped at 5 minutes (300,000 ms)
 * - +/- 20% jitter applied to prevent thundering herd
 *
 * @param attempt 0-indexed attempt count (0, 1, 2, ...)
 * @param random Injected random function returning [0, 1), defaults to Math.random
 */
export function nextDelayMs(
  attempt: number,
  random: () => number = Math.random
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const baseMs = 2000 * Math.pow(2, safeAttempt);
  const maxCapMs = 5 * 60 * 1000; // 300,000 ms (5 minutes)
  const cappedMs = Math.min(baseMs, maxCapMs);

  // +/- 20% jitter: factor in range [0.8, 1.2]
  const jitterFactor = 0.8 + random() * 0.4;
  return Math.round(cappedMs * jitterFactor);
}
