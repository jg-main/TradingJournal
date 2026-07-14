/**
 * GET /api/schwab/callback
 *
 * Handles the Schwab OAuth callback redirect after the user authorizes
 * the application in the Schwab browser flow.
 *
 * Extracts the authorization code and state from query parameters,
 * exchanges the code for tokens, encrypts and stores them, then redirects
 * the browser back to the settings page with a status indicator.
 *
 * Expected query params:
 *   - code: string (authorization code from Schwab)
 *   - state: string (PKCE state from Schwab, contains code verifier)
 *   - error: string (present if the user denied authorization)
 *
 * Redirect targets:
 *   /settings/market-data?schwab=connected        — success
 *   /settings/market-data?schwab=error&reason=X   — failure (X = error code)
 */

import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/schwab-auth';

export const dynamic = 'force-dynamic';

/**
 * Derive the public base URL for redirects.
 *
 * When behind a reverse proxy (Caddy), request.url contains the internal
 * Docker hostname (http://trading-journal:3000). Use X-Forwarded-Host
 * to redirect back to the public domain (https://journal.homelab).
 */
function getPublicOrigin(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const redirectTo = (params: Record<string, string>) => {
    const url = new URL('/settings/market-data', getPublicOrigin(request));
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    return NextResponse.redirect(url);
  };

  // User denied authorization at Schwab
  if (error) {
    return redirectTo({ schwab: 'error', reason: `user_denied:${error}` });
  }

  // Missing authorization code
  if (!code) {
    return redirectTo({ schwab: 'error', reason: 'missing_code' });
  }

  // Exchange code for tokens
  const result = await exchangeCode(code, state || undefined);

  if (!result.success) {
    return redirectTo({ schwab: 'error', reason: result.error });
  }

  // Success — tokens have been encrypted and persisted by the save callback
  return redirectTo({ schwab: 'connected', expiresAt: result.expiresAt });
}
