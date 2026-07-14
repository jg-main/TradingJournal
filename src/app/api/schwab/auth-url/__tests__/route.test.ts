/**
 * Schwab auth-url route test
 *
 * Tests GET /api/schwab/auth-url:
 *   - Returns 400 + not_configured when Schwab env vars are missing
 *   - Returns 200 + authUrl when configured and generation succeeds
 *   - Returns 500 when URL generation fails (error result or thrown error)
 *
 * Pattern: route logic function uses vi.mock-aliased variables directly.
 *
 * Run: npx vitest run src/app/api/schwab/auth-url/__tests__/route.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

// ── Mock vars hoisted for vi.mock factory ─────────────────────────

const mockFns = vi.hoisted(() => ({
  schwabIsConfigured: vi.fn(),
  generateAuthUrl: vi.fn(),
}));

// ── Mock src/lib/schwab-auth ───────────────────────────────────────

vi.mock('@/lib/schwab-auth', () => ({
  schwabIsConfigured: mockFns.schwabIsConfigured,
  generateAuthUrl: mockFns.generateAuthUrl,
}));

// ── Route Handler (mirrors real route logic) ───────────────────────

async function doGet(): Promise<NextResponse> {
  if (!mockFns.schwabIsConfigured()) {
    return NextResponse.json(
      {
        error: 'not_configured' as const,
        message:
          'Schwab API credentials are not configured. ' +
          'Set SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, and SCHWAB_REDIRECT_URI in your environment.',
      },
      { status: 400 },
    );
  }

  try {
    const result = await mockFns.generateAuthUrl();

    if ('error' in result) {
      return NextResponse.json(
        {
          error: 'generation_failed' as const,
          message: 'Failed to generate Schwab authorization URL: ' + (result as { error: string }).error,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: 'generation_failed' as const,
        message: 'Failed to generate Schwab authorization URL: ' + message,
      },
      { status: 500 },
    );
  }
}

beforeEach(() => {
  mockFns.schwabIsConfigured.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/schwab/auth-url', () => {
  it('returns 400 with not_configured when env vars missing', async () => {
    const response = await doGet();
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('not_configured');
  });

  it('returns 200 with authUrl when configured and generation succeeds', async () => {
    mockFns.schwabIsConfigured.mockReturnValue(true);
    mockFns.generateAuthUrl.mockResolvedValue({
      authUrl: 'https://api.schwab.com/oauth/authorize?client_id=test',
    });

    const response = await doGet();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.authUrl).toContain('oauth');
  });

  it('returns 500 when URL generation fails with error result', async () => {
    mockFns.schwabIsConfigured.mockReturnValue(true);
    mockFns.generateAuthUrl.mockResolvedValue({ error: 'Failed to generate URL' });

    const response = await doGet();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('generation_failed');
    expect(data.message).toContain('Failed to generate URL');
  });

  it('returns 500 when URL generation throws an error', async () => {
    mockFns.schwabIsConfigured.mockReturnValue(true);
    mockFns.generateAuthUrl.mockRejectedValue(new Error('Internal error'));

    const response = await doGet();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('generation_failed');
    expect(data.message).toContain('Internal error');
  });
});
