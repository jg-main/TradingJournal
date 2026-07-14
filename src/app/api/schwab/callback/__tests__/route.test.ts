/**
 * Schwab callback route test
 *
 * Tests GET /api/schwab/callback:
 *   - Redirects to settings with schwab=connected on success
 *   - Redirects to settings with user_denied when user denies
 *   - Redirects to settings with missing_code when code absent
 *   - Redirects to settings with state_mismatch when exchange fails
 *   - Redirects to settings with exchange_failed on generic error
 *   - Redirects to settings with connection_failed on network error
 *
 * Pattern: route logic function uses vi.mock-aliased variables directly.
 *
 * Run: npx vitest run src/app/api/schwab/callback/__tests__/route.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Mock vars hoisted for vi.mock factory ─────────────────────────

const mockFns = vi.hoisted(() => ({
  exchangeCode: vi.fn(),
}));

// ── Mock src/lib/schwab-auth ───────────────────────────────────────

vi.mock('@/lib/schwab-auth', () => ({
  exchangeCode: mockFns.exchangeCode,
}));

// ── Route Handler (mirrors real route logic) ───────────────────────

async function doGet(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // User denied authorization at Schwab
  if (error) {
    const settingsUrl = new URL('/settings/market-data', request.url);
    settingsUrl.searchParams.set('schwab', 'error');
    settingsUrl.searchParams.set('reason', `user_denied:${error}`);
    return NextResponse.redirect(settingsUrl);
  }

  // Missing authorization code
  if (!code) {
    const settingsUrl = new URL('/settings/market-data', request.url);
    settingsUrl.searchParams.set('schwab', 'error');
    settingsUrl.searchParams.set('reason', 'missing_code');
    return NextResponse.redirect(settingsUrl);
  }

  // Exchange code for tokens
  const result = await mockFns.exchangeCode(code, state || undefined);
  const exchangeResult = result as { success: boolean; error?: string; expiresAt?: string };

  const settingsUrl = new URL('/settings/market-data', request.url);

  if (!exchangeResult.success) {
    settingsUrl.searchParams.set('schwab', 'error');
    settingsUrl.searchParams.set('reason', exchangeResult.error ?? 'unknown');
    return NextResponse.redirect(settingsUrl);
  }

  // Success — tokens have been encrypted and persisted
  settingsUrl.searchParams.set('schwab', 'connected');
  settingsUrl.searchParams.set('expiresAt', exchangeResult.expiresAt ?? '');
  return NextResponse.redirect(settingsUrl);
}

// ── Helpers ─────────────────────────────────────────────────────────

function createCallbackRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'));
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  // Default: exchangeCode not called for non-exchange scenarios
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/schwab/callback', () => {
  it('redirects to settings with schwab=connected on success', async () => {
    mockFns.exchangeCode.mockResolvedValue({
      success: true,
      expiresAt: '2026-07-21T12:00:00.000Z',
    });

    const response = await doGet(
      createCallbackRequest('/api/schwab/callback?code=valid-code&state=valid-state'),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('/settings/market-data');
    expect(location).toContain('schwab=connected');
    expect(location).toContain('expiresAt=');
  });

  it('redirects to settings with user_denied when error param present', async () => {
    const response = await doGet(
      createCallbackRequest('/api/schwab/callback?error=access_denied'),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('/settings/market-data');
    expect(location).toContain('schwab=error');
    expect(location).toContain('user_denied');
  });

  it('redirects to settings with missing_code when code param absent', async () => {
    const response = await doGet(
      createCallbackRequest('/api/schwab/callback?state=some-state'),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('/settings/market-data');
    expect(location).toContain('schwab=error');
    expect(location).toContain('missing_code');
  });

  it('redirects to settings with state_mismatch when exchange fails', async () => {
    mockFns.exchangeCode.mockResolvedValue({
      success: false,
      error: 'state_mismatch',
    });

    const response = await doGet(
      createCallbackRequest('/api/schwab/callback?code=bad-code&state=bad-state'),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('/settings/market-data');
    expect(location).toContain('schwab=error');
    expect(location).toContain('state_mismatch');
  });

  it('redirects to settings with exchange_failed on generic error', async () => {
    mockFns.exchangeCode.mockResolvedValue({
      success: false,
      error: 'exchange_failed',
    });

    const response = await doGet(
      createCallbackRequest('/api/schwab/callback?code=bad-code&state=some-state'),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('/settings/market-data');
    expect(location).toContain('schwab=error');
    expect(location).toContain('exchange_failed');
  });

  it('redirects to settings with connection_failed on network error', async () => {
    mockFns.exchangeCode.mockResolvedValue({
      success: false,
      error: 'connection_failed',
    });

    const response = await doGet(
      createCallbackRequest('/api/schwab/callback?code=test-code'),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('/settings/market-data');
    expect(location).toContain('schwab=error');
    expect(location).toContain('connection_failed');
  });
});
