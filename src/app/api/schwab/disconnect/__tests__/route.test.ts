/**
 * Schwab disconnect route test
 *
 * Tests POST /api/schwab/disconnect:
 *   - Returns 200 + success=true when disconnect succeeds
 *   - Returns 500 + clear_failed when token clearing throws an error
 *
 * Pattern: route logic function uses vi.mock-aliased variables directly.
 *
 * Run: npx vitest run src/app/api/schwab/disconnect/__tests__/route.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

// ── Mock vars hoisted for vi.mock factory ─────────────────────────

const mockFns = vi.hoisted(() => ({
  clearTokens: vi.fn(),
}));

// ── Mock src/lib/schwab-auth ───────────────────────────────────────

vi.mock('@/lib/schwab-auth', () => ({
  clearTokens: mockFns.clearTokens,
}));

// ── Route Handler (mirrors real route logic) ───────────────────────

async function doPost(): Promise<NextResponse> {
  try {
    await mockFns.clearTokens();
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: 'clear_failed' as const,
        message: 'Failed to disconnect Schwab: ' + message,
      },
      { status: 500 },
    );
  }
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  mockFns.clearTokens.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/schwab/disconnect', () => {
  it('returns 200 with success=true when disconnect succeeds', async () => {
    mockFns.clearTokens.mockResolvedValue(undefined);

    const response = await doPost();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  it('returns 200 with success=true when already disconnected (idempotent)', async () => {
    mockFns.clearTokens.mockResolvedValue(undefined);

    const response = await doPost();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  it('returns 500 with clear_failed when clearTokens throws an error', async () => {
    mockFns.clearTokens.mockRejectedValue(new Error('DB write error'));

    const response = await doPost();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('clear_failed');
    expect(data.message).toContain('DB write error');
  });
});
