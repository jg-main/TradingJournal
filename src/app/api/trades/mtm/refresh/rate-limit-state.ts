const RATE_LIMIT_MS = 10_000; // 10 seconds
let lastRefreshTimestampMs = 0;

export function resetRateLimit(): void {
  lastRefreshTimestampMs = 0;
}

export function getRateLimitMs(): number {
  return RATE_LIMIT_MS;
}

export function getRemainingCooldownMs(now = Date.now()): number {
  const elapsed = now - lastRefreshTimestampMs;
  return elapsed < RATE_LIMIT_MS ? RATE_LIMIT_MS - elapsed : 0;
}

export function isRateLimited(now = Date.now()): { limited: boolean; retryAfter: number } {
  const remainingMs = getRemainingCooldownMs(now);
  return {
    limited: remainingMs > 0,
    retryAfter: Math.ceil(remainingMs / 1000),
  };
}

export function markRefreshSucceeded(now = Date.now()): void {
  lastRefreshTimestampMs = now;
}
