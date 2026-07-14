/**
 * scheduler.test.ts
 *
 * Unit tests for the scheduler module (startScheduler, stopScheduler,
 * reschedule, getNextScheduledAt).
 *
 * Uses vitest for vi.useFakeTimers support (testing the immediate-first-backup
 * 10-second delay without waiting in real time).
 *
 * Covers:
 *  - Production-only guard: NODE_ENV=test skips startup
 *  - Start/stop lifecycle: startScheduler creates a task, stopScheduler destroys it
 *  - Reschedule: stop + start with new expression
 *  - getNextScheduledAt: returns non-null after start, null after stop
 *  - Immediate first backup fires after 10s delay (via fake timers)
 *  - Multiple start calls: stop existing before creating new
 *
 * Run: npx vitest run src/lib/__tests__/scheduler.test.ts
 *
 * Pattern: src/lib/restore.test.ts (vitest with mocked server-only)
 */

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'production';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The scheduler module must be imported AFTER vi.useFakeTimers() is called
// because it uses setTimeout internally.
let startScheduler: typeof import('../scheduler')['startScheduler'];
let stopScheduler: typeof import('../scheduler')['stopScheduler'];
let reschedule: typeof import('../scheduler')['reschedule'];
let getNextScheduledAt: typeof import('../scheduler')['getNextScheduledAt'];

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.useFakeTimers();
  // Import after fake timers are active so the module's setTimeout uses
  // vi's fake timer implementation
  const mod = await import('../scheduler');
  startScheduler = mod.startScheduler;
  stopScheduler = mod.stopScheduler;
  reschedule = mod.reschedule;
  getNextScheduledAt = mod.getNextScheduledAt;
});

afterEach(() => {
  stopScheduler();
  vi.useRealTimers();
});

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Create a mock job function that records calls.
 */
function createMockJob(): { fn: () => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  const fn = async () => {
    calls.push(Date.now());
  };
  return { fn, calls };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('production-only guard', () => {
  it('does NOT start in NODE_ENV=test (default vi env)', async () => {
    const originalEnv = env.NODE_ENV;
    env.NODE_ENV = 'test';

    const { fn } = createMockJob();
    // Re-import with test env
    const scheduler = await import('../scheduler');
    scheduler.startScheduler('* * * * *', fn);

    expect(scheduler.getNextScheduledAt()).toBeNull();
    env.NODE_ENV = originalEnv;
  });

  it('starts in NODE_ENV=production', () => {
    env.NODE_ENV = 'production';
    const { fn } = createMockJob();
    startScheduler('* * * * *', fn);
    expect(getNextScheduledAt()).not.toBeNull();
  });

  it('starts in NODE_ENV=development', async () => {
    // Actually NODE_ENV=development should skip (only production works)
    const originalEnv = env.NODE_ENV;
    env.NODE_ENV = 'development';

    const scheduler = await import('../scheduler');
    scheduler.startScheduler('* * * * *', async () => {});
    expect(scheduler.getNextScheduledAt()).toBeNull();
    env.NODE_ENV = originalEnv;
  });
});

describe('startScheduler', () => {
  it('creates a scheduled task with the given cron expression', () => {
    const { fn } = createMockJob();
    startScheduler('0 2 * * *', fn);
    const next = getNextScheduledAt();
    expect(next).not.toBeNull();
    // The next run time should be a valid ISO string
    expect(() => new Date(next!)).not.toThrow();
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('schedules immediate first backup with 10s delay', () => {
    const { fn, calls } = createMockJob();
    startScheduler('0 2 * * *', fn);

    expect(calls.length).toBe(0);

    // Advance by 5 seconds — the immediate backup should not have fired yet
    vi.advanceTimersByTime(5_000);
    expect(calls.length).toBe(0);

    // Advance by another 6 seconds (total 11s) — the immediate backup fires at 10s
    vi.advanceTimersByTime(6_000);
    expect(calls.length).toBe(1);
  });

  it('fires immediate backup exactly once', () => {
    const { fn, calls } = createMockJob();
    startScheduler('30 2 * * *', fn);

    // Advance past the 10s immediate delay
    vi.advanceTimersByTime(15_000);
    expect(calls.length).toBe(1);

    // Advance further — the cron shouldn't have fired yet (30th minute of 2am, not now)
    // But fake timers with * * * * * would fire every minute by default
    // Since we used '30 2 * * *', no more ticks should happen within minutes
    vi.advanceTimersByTime(60_000);
    // Only the immediate backup should have fired
    expect(calls.length).toBe(1);
  });

  it('stops existing task before creating new one (multiple calls to start)', () => {
    const { fn: fn1, calls: calls1 } = createMockJob();
    const { fn: fn2, calls: calls2 } = createMockJob();

    startScheduler('0 2 * * *', fn1);
    vi.advanceTimersByTime(5_000);
    expect(calls1.length).toBe(0);

    // Start again with a different job — should stop the first
    startScheduler('0 3 * * *', fn2);
    vi.advanceTimersByTime(15_000);

    // Only the second job's immediate backup should have fired
    expect(calls1.length).toBe(0);
    expect(calls2.length).toBe(1);
  });
});

describe('stopScheduler', () => {
  it('stops the cron task and clears nextScheduledAt', () => {
    const { fn } = createMockJob();
    startScheduler('* * * * *', fn);

    expect(getNextScheduledAt()).not.toBeNull();

    stopScheduler();
    expect(getNextScheduledAt()).toBeNull();
  });

  it('cancels the immediate backup timeout', () => {
    const { fn, calls } = createMockJob();
    startScheduler('0 2 * * *', fn);

    stopScheduler();

    // Even after advancing past 10s, the immediate backup should not fire
    vi.advanceTimersByTime(15_000);
    expect(calls.length).toBe(0);
  });

  it('is safe to call when no scheduler is running (no-op)', () => {
    expect(() => stopScheduler()).not.toThrow();
  });

  it('is safe to call multiple times', () => {
    const { fn } = createMockJob();
    startScheduler('0 2 * * *', fn);
    stopScheduler();
    expect(() => stopScheduler()).not.toThrow();
    expect(getNextScheduledAt()).toBeNull();
  });
});

describe('reschedule', () => {
  it('stops existing and starts new with different expression', () => {
    const { fn, calls } = createMockJob();
    startScheduler('0 2 * * *', fn);
    const firstNext = getNextScheduledAt();

    reschedule('0 3 * * *', fn);
    const secondNext = getNextScheduledAt();

    // Both should be valid timestamps
    expect(firstNext).not.toBeNull();
    expect(secondNext).not.toBeNull();
  });

  it('immediate backup fires after reschedule', () => {
    const { fn, calls } = createMockJob();
    startScheduler('0 2 * * *', fn);
    vi.advanceTimersByTime(5_000);

    reschedule('0 3 * * *', fn);

    // The reschedule calls startScheduler which schedules a NEW immediate backup
    vi.advanceTimersByTime(15_000);
    expect(calls.length).toBe(1);
  });

  it('does not fire the old immediate backup after reschedule', () => {
    const { fn: fn1, calls: calls1 } = createMockJob();
    const { fn: fn2, calls: calls2 } = createMockJob();

    startScheduler('0 2 * * *', fn1);
    vi.advanceTimersByTime(5_000);

    reschedule('0 3 * * *', fn2);
    vi.advanceTimersByTime(15_000);

    // Only fn2 should have been called (via reschedule -> immediate backup)
    expect(calls1.length).toBe(0);
    expect(calls2.length).toBe(1);
  });
});

describe('getNextScheduledAt', () => {
  it('returns null before startScheduler is called', () => {
    expect(getNextScheduledAt()).toBeNull();
  });

  it('returns null after stopScheduler', () => {
    const { fn } = createMockJob();
    startScheduler('0 2 * * *', fn);
    expect(getNextScheduledAt()).not.toBeNull();
    stopScheduler();
    expect(getNextScheduledAt()).toBeNull();
  });

  it('returns valid ISO string when scheduler is active', () => {
    const { fn } = createMockJob();
    startScheduler('*/5 * * * *', fn);
    const next = getNextScheduledAt();
    expect(next).not.toBeNull();
    const parsed = new Date(next!);
    expect(parsed.getTime()).not.toBeNaN();
    // Should be in the future (within next hour for */5 pattern)
    expect(parsed.getTime()).toBeGreaterThan(Date.now());
  });
});

// ── cronTimeToExpression unit tests ──────────────────────────────────
// ZERO coverage before this block. Pure function — no fake timer dependency.

describe('cronTimeToExpression', () => {
  it('converts 00:00 (midnight) to "0 0 * * *"', async () => {
    const { cronTimeToExpression } = await import('../scheduler');
    expect(cronTimeToExpression('00:00')).toBe('0 0 * * *');
  });

  it('converts 23:59 (end of day) to "59 23 * * *"', async () => {
    const { cronTimeToExpression } = await import('../scheduler');
    expect(cronTimeToExpression('23:59')).toBe('59 23 * * *');
  });

  it('converts 12:00 (mid-day) to "0 12 * * *"', async () => {
    const { cronTimeToExpression } = await import('../scheduler');
    expect(cronTimeToExpression('12:00')).toBe('0 12 * * *');
  });

  it('converts 08:30 to "30 8 * * *"', async () => {
    const { cronTimeToExpression } = await import('../scheduler');
    expect(cronTimeToExpression('08:30')).toBe('30 8 * * *');
  });

  it('falls back to 02:00 for invalid format ("not-a-time")', async () => {
    const { cronTimeToExpression } = await import('../scheduler');
    expect(cronTimeToExpression('not-a-time')).toBe('0 2 * * *');
  });

  it('falls back to 02:00 for hour out of range ("24:00")', async () => {
    const { cronTimeToExpression } = await import('../scheduler');
    expect(cronTimeToExpression('24:00')).toBe('0 2 * * *');
  });

  it('falls back to 02:00 for minute out of range ("12:60")', async () => {
    const { cronTimeToExpression } = await import('../scheduler');
    expect(cronTimeToExpression('12:60')).toBe('0 2 * * *');
  });

  it('falls back to 02:00 for negative hour ("-1:00")', async () => {
    const { cronTimeToExpression } = await import('../scheduler');
    expect(cronTimeToExpression('-1:00')).toBe('0 2 * * *');
  });

  it('falls back to 02:00 for empty string', async () => {
    const { cronTimeToExpression } = await import('../scheduler');
    expect(cronTimeToExpression('')).toBe('0 2 * * *');
  });
});

// ── cronTimeToUTCExpression unit tests ───────────────────────────────
// ZERO coverage before this block. Uses Intl.DateTimeFormat for DST-aware
// offset computation. Tests use vi.setSystemTime to pin the reference date
// so expected UTC outputs are deterministic regardless of when tests run.

describe('cronTimeToUTCExpression', () => {
  it('converts 21:00 Bogota (UTC-5 winter) to "0 2 * * *"', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('21:00', 'America/Bogota')).toBe('0 2 * * *');
  });

  it('converts 21:00 Kolkata (UTC+5:30 no DST) to "30 15 * * *"', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('21:00', 'Asia/Kolkata')).toBe('30 15 * * *');
  });

  it('converts 06:00 Tokyo (UTC+9 no DST) to "0 21 * * *"', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('06:00', 'Asia/Tokyo')).toBe('0 21 * * *');
  });

  it('converts 18:00 Los Angeles (UTC-8 winter) to "0 2 * * *"', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('18:00', 'America/Los_Angeles')).toBe('0 2 * * *');
  });

  it('converts 09:00 Berlin (UTC+1 winter) to "0 8 * * *"', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('09:00', 'Europe/Berlin')).toBe('0 8 * * *');
  });

  it('converts 14:00 UTC (UTC+0) to "0 14 * * *"', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('14:00', 'UTC')).toBe('0 14 * * *');
  });

  it('converts 00:00 New York (UTC-5 winter) to "0 5 * * *" (midnight)', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('00:00', 'America/New_York')).toBe('0 5 * * *');
  });

  it('converts 23:00 New York (UTC-5 winter) to "0 4 * * *" (23:xx boundary)', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('23:00', 'America/New_York')).toBe('0 4 * * *');
  });

  it('converts 00:00 Kolkata (UTC+5:30) to "30 18 * * *" (wraps to previous UTC day)', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('00:00', 'Asia/Kolkata')).toBe('30 18 * * *');
  });

  it('DST-aware: 21:00 New York summer (UTC-4) vs winter (UTC-5) differ', async () => {
    // Pin to July 15 mid-year (EDT / UTC-4)
    vi.setSystemTime(new Date('2024-07-15T12:00:00Z'));
    const { cronTimeToUTCExpression: julFns } = await import('../scheduler');
    expect(julFns('21:00', 'America/New_York')).toBe('0 1 * * *');

    // Pin to January 15 (EST / UTC-5)
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression: janFns } = await import('../scheduler');
    expect(janFns('21:00', 'America/New_York')).toBe('0 2 * * *');
  });

  it('falls back to cronTimeToExpression for invalid timezone', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    // Invalid timezone throws RangeError caught by the function → falls back
    expect(cronTimeToUTCExpression('21:00', 'Invalid/Zone')).toBe('0 21 * * *');
  });

  it('falls back to 02:00 default for invalid HH:MM input', async () => {
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('invalid', 'America/New_York')).toBe('0 2 * * *');
  });

  it('handles 09:00 Berlin summer (UTC+2) correctly for DST transition', async () => {
    vi.setSystemTime(new Date('2024-07-15T12:00:00Z'));
    const { cronTimeToUTCExpression } = await import('../scheduler');
    expect(cronTimeToUTCExpression('09:00', 'Europe/Berlin')).toBe('0 7 * * *');
  });
});
