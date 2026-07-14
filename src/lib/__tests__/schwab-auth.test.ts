/**
 * schwab-auth test
 *
 * Tests the Schwab OAuth authentication library:
 *   - schwabIsConfigured() env var detection
 *   - generateAuthUrl() with mocked @sudowealth/schwab-api
 *   - exchangeCode() success and error paths
 *   - getTokenStatus() with DB-stored tokens
 *   - clearTokens() disconnect
 *
 * Pattern: in-memory SQLite DB + mocked schwab-api library.
 * Uses vi.hoisted() for mock variable declarations so they are available
 * when vi.mock() factory functions execute (vitest hoisting).
 *
 * Run: npx vitest run src/lib/__tests__/schwab-auth.test.ts
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { schwabTokens } from '@/db/schema';
import {
  encryptToken,
  serializeEncryptedData,
} from '../token-encryption';

// ── Hoisted mock vars (available before vi.mock factories run) ─────

const mockFns = vi.hoisted(() => ({
  mockGetAuthorizationUrl: vi.fn(),
  mockExchangeCode: vi.fn(),
  mockGetTokenData: vi.fn(),
  mockClearTokens: vi.fn(),
}));

// ── Mock server-only (blocks in test env) ─────────────────────────
vi.mock('server-only', () => ({}));

// ── Mock @/db (use in-memory SQLite instead of real DB) ───────────

const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
const testDb = drizzle(sqlite, { schema });

vi.mock('@/db', () => ({
  db: testDb,
  initializeDatabase: () => testDb,
  getSqliteHandle: () => sqlite,
}));

// ── Mock @sudowealth/schwab-api ───────────────────────────────────

vi.mock('@sudowealth/schwab-api', () => ({
  createSchwabAuth: vi.fn(() => ({
    getAuthorizationUrl: mockFns.mockGetAuthorizationUrl,
    exchangeCode: mockFns.mockExchangeCode,
    getTokenData: mockFns.mockGetTokenData,
    clearTokens: mockFns.mockClearTokens,
    supportsRefresh: vi.fn().mockReturnValue(true),
    saveTokens: vi.fn(),
    getAccessToken: vi.fn(),
    refreshIfNeeded: vi.fn(),
  })),
  AuthStrategy: { ENHANCED: 'enhanced' },
}));

// ── Create schwab_tokens table ────────────────────────────────────

beforeEach(() => {
  sqlite.exec(`
    DROP TABLE IF EXISTS schwab_tokens;
    CREATE TABLE schwab_tokens (
      id TEXT PRIMARY KEY NOT NULL,
      encrypted_access_token TEXT NOT NULL,
      encrypted_refresh_token TEXT,
      scope TEXT,
      token_type TEXT DEFAULT 'Bearer',
      expires_at TEXT,
      refresh_token_expires_at TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (current_timestamp),
      updated_at TEXT DEFAULT (current_timestamp)
    );
  `);
});

afterEach(() => {
  vi.restoreAllMocks();

  // Clear env vars set during tests
  delete process.env.SCHWAB_CLIENT_ID;
  delete process.env.SCHWAB_CLIENT_SECRET;
  delete process.env.SCHWAB_REDIRECT_URI;
});

// ── Helper: re-init module with fresh mocks ───────────────────────

async function freshAuth() {
  // Reset module cache to pick up mock changes
  vi.resetModules();
  const mod = await import('../schwab-auth');
  mod.resetAuthClient();
  return mod;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('schwabIsConfigured', () => {
  beforeEach(() => {
    delete process.env.SCHWAB_CLIENT_ID;
    delete process.env.SCHWAB_CLIENT_SECRET;
    delete process.env.SCHWAB_REDIRECT_URI;
  });

  it('returns false when no env vars set', async () => {
    const { schwabIsConfigured } = await freshAuth();
    expect(schwabIsConfigured()).toBe(false);
  });

  it('returns false when only CLIENT_ID set', async () => {
    process.env.SCHWAB_CLIENT_ID = 'test-client';
    const { schwabIsConfigured } = await freshAuth();
    expect(schwabIsConfigured()).toBe(false);
  });

  it('returns false when CLIENT_SECRET missing', async () => {
    process.env.SCHWAB_CLIENT_ID = 'test-client';
    process.env.SCHWAB_REDIRECT_URI = 'http://localhost:3000/api/schwab/callback';
    const { schwabIsConfigured } = await freshAuth();
    expect(schwabIsConfigured()).toBe(false);
  });

  it('returns false when REDIRECT_URI missing', async () => {
    process.env.SCHWAB_CLIENT_ID = 'test-client';
    process.env.SCHWAB_CLIENT_SECRET = 'test-secret';
    const { schwabIsConfigured } = await freshAuth();
    expect(schwabIsConfigured()).toBe(false);
  });

  it('returns true when all env vars set', async () => {
    process.env.SCHWAB_CLIENT_ID = 'test-client';
    process.env.SCHWAB_CLIENT_SECRET = 'test-secret';
    process.env.SCHWAB_REDIRECT_URI = 'http://localhost:3000/api/schwab/callback';
    const { schwabIsConfigured } = await freshAuth();
    expect(schwabIsConfigured()).toBe(true);
  });
});

describe('generateAuthUrl', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    process.env.SCHWAB_CLIENT_ID = 'test-client';
    process.env.SCHWAB_CLIENT_SECRET = 'test-secret';
    process.env.SCHWAB_REDIRECT_URI = 'http://localhost:3000/api/schwab/callback';
  });

  it('returns authUrl when configured and successful', async () => {
    mockFns.mockGetAuthorizationUrl.mockResolvedValue({
      authUrl: 'https://api.schwab.com/oauth/authorize?response_type=code&client_id=test-client',
    });

    const { generateAuthUrl, resetAuthClient } = await freshAuth();
    resetAuthClient(); // Force re-init with our mock

    const result = await generateAuthUrl();
    expect('authUrl' in result).toBe(true);
    if ('authUrl' in result) {
      expect(result.authUrl).toContain('oauth');
    }
  });

  it('returns error when getAuthorizationUrl throws', async () => {
    mockFns.mockGetAuthorizationUrl.mockRejectedValue(new Error('Failed to generate URL'));

    const { generateAuthUrl, resetAuthClient } = await freshAuth();
    resetAuthClient();

    const result = await generateAuthUrl();
    expect('error' in result).toBe(true);
  });
});

describe('exchangeCode', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    process.env.SCHWAB_CLIENT_ID = 'test-client';
    process.env.SCHWAB_CLIENT_SECRET = 'test-secret';
    process.env.SCHWAB_REDIRECT_URI = 'http://localhost:3000/api/schwab/callback';
  });

  it('returns success with expiresAt when exchange succeeds', async () => {
    const futureExpiry = Date.now() + 3600000;
    mockFns.mockExchangeCode.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: futureExpiry,
    });

    const { exchangeCode, resetAuthClient } = await freshAuth();
    resetAuthClient();

    const result = await exchangeCode('valid-code', 'valid-state');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.expiresAt).toBeDefined();
      expect(new Date(result.expiresAt).toISOString()).toBe(result.expiresAt);
    }
  });

  it('returns state_mismatch when exchange fails due to state error', async () => {
    mockFns.mockExchangeCode.mockRejectedValue(new Error('State validation failed: invalid state parameter'));

    const { exchangeCode, resetAuthClient } = await freshAuth();
    resetAuthClient();

    const result = await exchangeCode('bad-code', 'bad-state');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('state_mismatch');
    }
  });

  it('returns connection_failed when exchange fails due to network error', async () => {
    mockFns.mockExchangeCode.mockRejectedValue(new Error('fetch failed: ENOTFOUND api.schwab.com'));

    const { exchangeCode, resetAuthClient } = await freshAuth();
    resetAuthClient();

    const result = await exchangeCode('test-code');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('connection_failed');
    }
  });

  it('returns exchange_failed for generic errors', async () => {
    mockFns.mockExchangeCode.mockRejectedValue(new Error('Unknown server error'));

    const { exchangeCode, resetAuthClient } = await freshAuth();
    resetAuthClient();

    const result = await exchangeCode('test-code');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('exchange_failed');
    }
  });
});

describe('getTokenStatus', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    process.env.SCHWAB_CLIENT_ID = 'test-client';
    process.env.SCHWAB_CLIENT_SECRET = 'test-secret';
    process.env.SCHWAB_REDIRECT_URI = 'http://localhost:3000/api/schwab/callback';
  });

  it('returns connected=true when token data is valid', async () => {
    const futureExpiry = Date.now() + 3600000;
    mockFns.mockGetTokenData.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: futureExpiry,
    });

    const { getTokenStatus, resetAuthClient } = await freshAuth();
    resetAuthClient();

    const status = await getTokenStatus();
    expect(status.connected).toBe(true);
    expect(status.expiresAt).toBeDefined();
    expect(status.errorType).toBeUndefined();
  });

  it('returns connected=false when no stored tokens', async () => {
    mockFns.mockGetTokenData.mockResolvedValue(null);

    const { getTokenStatus, resetAuthClient } = await freshAuth();
    resetAuthClient();

    const status = await getTokenStatus();
    expect(status.connected).toBe(false);
    expect(status.expiresAt).toBeNull();
  });
});

describe('resetAuthClient', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    process.env.SCHWAB_CLIENT_ID = 'test-client';
    process.env.SCHWAB_CLIENT_SECRET = 'test-secret';
    process.env.SCHWAB_REDIRECT_URI = 'http://localhost:3000/api/schwab/callback';
  });

  it('allows re-initialization after reset', async () => {
    mockFns.mockGetAuthorizationUrl.mockResolvedValue({
      authUrl: 'https://api.schwab.com/oauth/authorize',
    });

    const mod = await freshAuth();
    mod.resetAuthClient();

    // Re-init should work
    vi.resetModules();
    const mod2 = await import('../schwab-auth');
    mod2.resetAuthClient();

    const result2 = await mod2.generateAuthUrl();
    expect('authUrl' in result2).toBe(true);
  });
});

describe('clearTokens', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  });

  it('succeeds when not configured', async () => {
    // Don't set schwab env vars
    const { clearTokens } = await freshAuth();

    // clearTokens should still work (belt-and-suspenders)
    await expect(clearTokens()).resolves.toBeUndefined();
  });

  it('clears stored tokens from DB', async () => {
    process.env.SCHWAB_CLIENT_ID = 'test-client';
    process.env.SCHWAB_CLIENT_SECRET = 'test-secret';
    process.env.SCHWAB_REDIRECT_URI = 'http://localhost:3000/api/schwab/callback';
    mockFns.mockClearTokens.mockResolvedValue(undefined);

    // Insert a test token into the db
    const TEST_ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const id = randomUUID();
    const encryptedToken = serializeEncryptedData(
      encryptToken('test-access-token', Buffer.from(TEST_ENCRYPTION_KEY, 'hex')),
    );
    sqlite.prepare(
      'INSERT INTO schwab_tokens (id, encrypted_access_token, status) VALUES (?, ?, ?)',
    ).run(id, encryptedToken, 'active');

    const { clearTokens, resetAuthClient } = await freshAuth();
    resetAuthClient();
    await clearTokens();

    // Verify tokens are marked inactive
    const row = testDb.select().from(schwabTokens).where(eq(schwabTokens.id, id)).get();
    expect(row).toBeDefined();
    expect(row!.status).toBe('inactive');
  });
});
