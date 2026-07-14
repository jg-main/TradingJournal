/**
 * schwab-auth.ts
 *
 * Schwab OAuth 2.0 Authorization Code + PKCE authentication library.
 *
 * Wraps @sudowealth/schwab-api's EnhancedTokenManager with encrypted token
 * persistence in the schwab_tokens table. Handles:
 *   - Authorization URL generation with PKCE
 *   - Authorization code exchange for tokens
 *   - Encrypted token storage/retrieval
 *   - Token status and expiry inspection
 *   - Token clearing (disconnect)
 *
 * The auth client is lazily initialized as a module-level singleton.
 * Callers check schwabIsConfigured() before using auth functions.
 *
 * Pattern: pure-library wrapper with encrypted persistence via load/save callbacks.
 * Dependencies: @sudowealth/schwab-api (createSchwabAuth), drizzle-orm, token-encryption.ts.
 */

import { createSchwabAuth, AuthStrategy } from '@sudowealth/schwab-api';
import type { TokenData } from '@sudowealth/schwab-api';
import { db } from '@/db';
import { schwabTokens } from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  encryptToken,
  decryptToken,
  serializeEncryptedData,
  deserializeEncryptedData,
} from './token-encryption';
import { randomUUID } from 'node:crypto';

// ── Types ───────────────────────────────────────────────────────────────

export interface AuthUrlResult {
  authUrl: string;
}

export interface ExchangeSuccess {
  success: true;
  expiresAt: string;
}

export interface ExchangeError {
  success: false;
  error:
    | 'not_configured'
    | 'state_mismatch'
    | 'connection_failed'
    | 'exchange_failed'
    | 'invalid_request';
}

export type ExchangeResult = ExchangeSuccess | ExchangeError;

export interface TokenStatus {
  connected: boolean;
  expiresAt: string | null;
  errorType?: 'not_configured' | 'token_expired';
}

// ── Configuration ───────────────────────────────────────────────────────

/**
 * Check whether Schwab API credentials are present in the environment.
 * All three env vars must be set: SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET,
 * and SCHWAB_REDIRECT_URI.
 */
export function schwabIsConfigured(): boolean {
  return !!(
    process.env.SCHWAB_CLIENT_ID &&
    process.env.SCHWAB_CLIENT_SECRET &&
    process.env.SCHWAB_REDIRECT_URI
  );
}

interface SchwabConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function getSchwabConfig(): SchwabConfig | null {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

// ── Auth Client Singleton ───────────────────────────────────────────────

let authClient: ReturnType<typeof createSchwabAuth> | null = null;

/**
 * Load and decrypt tokens from the schwab_tokens table.
 * Called internally by the EnhancedTokenManager's load callback.
 */
async function loadTokensFromDb(): Promise<TokenData | null> {
  try {
    const row = db
      .select()
      .from(schwabTokens)
      .where(eq(schwabTokens.status, 'active'))
      .get();

    if (!row) return null;

    const accessData = deserializeEncryptedData(row.encryptedAccessToken);
    const accessToken = decryptToken(accessData);

    let refreshToken: string | undefined;
    if (row.encryptedRefreshToken) {
      const refreshData = deserializeEncryptedData(row.encryptedRefreshToken);
      refreshToken = decryptToken(refreshData);
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).getTime() : undefined,
    };
  } catch (err) {
    console.error('[schwab-auth] Failed to load tokens from DB:', err);
    return null;
  }
}

/**
 * Encrypt and persist tokens to the schwab_tokens table.
 * Marks any existing active tokens as inactive, then inserts the new token row.
 * Called internally by the EnhancedTokenManager's save callback.
 */
async function saveTokensToDb(tokenData: TokenData): Promise<void> {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();

    const encryptedAccess = serializeEncryptedData(
      encryptToken(tokenData.accessToken),
    );

    let encryptedRefresh: string | null = null;
    if (tokenData.refreshToken) {
      encryptedRefresh = serializeEncryptedData(
        encryptToken(tokenData.refreshToken),
      );
    }

    // Mark existing active tokens as inactive
    db.update(schwabTokens)
      .set({ status: 'inactive' })
      .where(eq(schwabTokens.status, 'active'))
      .run();

    // Insert new token row
    db.insert(schwabTokens)
      .values({
        id,
        encryptedAccessToken: encryptedAccess,
        encryptedRefreshToken: encryptedRefresh,
        expiresAt: tokenData.expiresAt
          ? new Date(tokenData.expiresAt).toISOString()
          : null,
        scope: 'api offline_access',
        tokenType: 'Bearer',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .run();
  } catch (err) {
    console.error('[schwab-auth] Failed to save tokens to DB:', err);
    throw err;
  }
}

/**
 * Lazily initialize and return the auth client singleton.
 * Returns null if Schwab is not configured (env vars missing).
 */
function getClient(): ReturnType<typeof createSchwabAuth> | null {
  if (authClient) return authClient;

  const config = getSchwabConfig();
  if (!config) return null;

  authClient = createSchwabAuth({
    oauthConfig: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      load: loadTokensFromDb,
      save: saveTokensToDb,
    },
  });

  return authClient;
}

/**
 * Reset the auth client singleton (useful for tests that change env vars).
 */
export function resetAuthClient(): void {
  authClient = null;
}

// ── Auth URL Generation ─────────────────────────────────────────────────

/**
 * Generate a Schwab OAuth authorization URL with PKCE.
 *
 * Returns an AuthUrlResult on success, or an error object if Schwab is
 * not configured or URL generation fails.
 */
export async function generateAuthUrl(): Promise<
  AuthUrlResult | { error: string }
> {
  const client = getClient();
  if (!client) {
    return { error: 'not_configured' };
  }

  try {
    const { authUrl } = await client.getAuthorizationUrl();
    return { authUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[schwab-auth] Failed to generate auth URL:', message);
    return { error: message };
  }
}

// ── Code Exchange ───────────────────────────────────────────────────────

/**
 * Exchange an OAuth authorization code for access/refresh tokens.
 *
 * The state parameter (received from the callback URL) contains the PKCE
 * code verifier for verification. Tokens are automatically encrypted and
 * persisted via the save callback on the auth client.
 *
 * @param code - The authorization code from Schwab's redirect
 * @param state - The state parameter from Schwab's redirect (contains PKCE verifier)
 */
export async function exchangeCode(
  code: string,
  state?: string,
): Promise<ExchangeResult> {
  const client = getClient();
  if (!client) {
    return { success: false, error: 'not_configured' };
  }

  try {
    const tokens = await client.exchangeCode(code, state);
    return {
      success: true,
      expiresAt: tokens.expiresAt
        ? new Date(tokens.expiresAt).toISOString()
        : 'unknown',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[schwab-auth] Code exchange failed:', message);

    if (
      message.toLowerCase().includes('state') &&
      !message.toLowerCase().includes('connection')
    ) {
      return { success: false, error: 'state_mismatch' };
    }
    if (
      message.toLowerCase().includes('connection') ||
      message.toLowerCase().includes('fetch') ||
      message.toLowerCase().includes('timeout') ||
      message.toLowerCase().includes('enotfound') ||
      message.toLowerCase().includes('econnrefused')
    ) {
      return { success: false, error: 'connection_failed' };
    }
    return { success: false, error: 'exchange_failed' };
  }
}

// ── Token Status ────────────────────────────────────────────────────────

/**
 * Get the current Schwab token status.
 *
 * Checks whether valid tokens are stored and returns expiry information.
 * Does NOT trigger a refresh — use this for the settings page status display.
 */
export async function getTokenStatus(): Promise<TokenStatus> {
  const client = getClient();
  if (!client) {
    return { connected: false, expiresAt: null, errorType: 'not_configured' };
  }

  try {
    const tokenData = await client.getTokenData();
    if (!tokenData) {
      return { connected: false, expiresAt: null };
    }

    // Check if token is expired
    if (tokenData.expiresAt && tokenData.expiresAt < Date.now()) {
      return {
        connected: false,
        expiresAt: new Date(tokenData.expiresAt).toISOString(),
        errorType: 'token_expired',
      };
    }

    return {
      connected: true,
      expiresAt: tokenData.expiresAt
        ? new Date(tokenData.expiresAt).toISOString()
        : null,
    };
  } catch (err) {
    console.error('[schwab-auth] Failed to get token status:', err);
    return { connected: false, expiresAt: null };
  }
}

// ── Token Clearing ──────────────────────────────────────────────────────

/**
 * Clear stored Schwab tokens from the database.
 * Marks all active tokens as inactive.
 */
export async function clearTokens(): Promise<void> {
  const client = getClient();
  if (client) {
    try {
      await client.clearTokens();
    } catch (err) {
      console.error('[schwab-auth] Failed to clear tokens:', err);
      throw err;
    }
  }

  // Also mark any remaining active tokens as inactive (belt-and-suspenders)
  try {
    db.update(schwabTokens)
      .set({ status: 'inactive' })
      .where(eq(schwabTokens.status, 'active'))
      .run();
  } catch (err) {
    console.error('[schwab-auth] Failed to mark tokens as inactive:', err);
    throw err;
  }
}
