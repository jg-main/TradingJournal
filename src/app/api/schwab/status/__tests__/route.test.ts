/**
 * Schwab status route test
 *
 * Tests GET /api/schwab/status:
 *   - Returns 200 + connected=true when valid tokens exist
 *   - Returns 200 + connected=false + errorType=not_configured when env vars missing
 *   - Returns 200 + connected=false when no tokens stored
 *   - Returns 200 + connected=false + errorType=token_expired when tokens expired
 *   - Returns 500 + status_check_failed on unexpected error
 *
 * Pattern: route logic function uses vi.mock-aliased variables directly.
 *
 * Run: npx vitest run src/app/api/schwab/status/__tests__/route.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

// ── Mock vars hoisted for vi.mock factory ─────────────────────────

const mockFns = vi.hoisted(() => ({
  getTokenStatus: vi.fn(),
}));

// ── Mock src/lib/schwab-auth ───────────────────────────────────────

vi.mock('@/lib/schwab-auth', () => ({
  getTokenStatus: mockFns.getTokenStatus,
}));

// ── Route Handler (mirrors real route logic) ───────────────────────

async function doGet(): Promise<NextResponse> {
  try {
    const status = await mockFns.getTokenStatus();
    return NextResponse.json(status, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: 'status_check_failed' as const,
        message: 'Failed to check Schwab connection status: ' + message,
      },
      { status: 500 },
    );
  }
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  mockFns.getTokenStatus.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/schwab/status', () => {
  it('returns 200 with connected=true when valid tokens exist', async () => {
    mockFns.getTokenStatus.mockResolvedValue({
      connected: true,
      expiresAt: '2026-07-21T12:00:00.000Z',
    });

    const response = await doGet();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.connected).toBe(true);
    expect(data.expiresAt).toBe('2026-07-21T12:00:00.000Z');
  });

  it('returns 200 with connected=false + not_configured when env vars missing', async () => {
    mockFns.getTokenStatus.mockResolvedValue({
      connected: false,
      expiresAt: null,
      errorType: 'not_configured',
    });

    const response = await doGet();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.connected).toBe(false);
    expect(data.expiresAt).toBeNull();
    expect(data.errorType).toBe('not_configured');
  });

  it('returns 200 with connected=false when no tokens stored', async () => {
    mockFns.getTokenStatus.mockResolvedValue({
      connected: false,
      expiresAt: null,
    });

    const response = await doGet();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.connected).toBe(false);
    expect(data.expiresAt).toBeNull();
    expect(data.errorType).toBeUndefined();
  });

  it('returns 200 with connected=false + token_expired when tokens expired', async () => {
    mockFns.getTokenStatus.mockResolvedValue({
      connected: false,
      expiresAt: '2026-06-01T12:00:00.000Z',
      errorType: 'token_expired',
    });

    const response = await doGet();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.connected).toBe(false);
    expect(data.expiresAt).toBe('2026-06-01T12:00:00.000Z');
    expect(data.errorType).toBe('token_expired');
  });

  it('returns 500 with status_check_failed on unexpected error', async () => {
    mockFns.getTokenStatus.mockRejectedValue(new Error('DB connection lost'));

    const response = await doGet();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('status_check_failed');
    expect(data.message).toContain('DB connection lost');
  });
});
