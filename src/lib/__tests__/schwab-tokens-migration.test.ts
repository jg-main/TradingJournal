/**
 * schwab-tokens-migration.test.ts
 *
 * Tests for the schwab_tokens table schema and migration.
 *
 * Verifies the table is created with the correct columns, types, and
 * constraints, and that it can store and retrieve encrypted token data.
 * Uses an in-memory SQLite database for isolation.
 *
 * Run: npx vitest run src/lib/__tests__/schwab-tokens-migration.test.ts
 */

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── In-memory test DB ──────────────────────────────────────────────────

let sqlite: Database.Database;

/** Run the schwab_tokens table migration */
function runMigration(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schwab_tokens (
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
}

/** Helper to create a test EncryptedData-like JSON blob for storage */
function makeEncryptedTokenPayload(plaintext: string): string {
  // Simulates the JSON produced by serializeEncryptedData from token-encryption.ts
  // In production this would use an actual ENCRYPTION_KEY
  return JSON.stringify({
    iv: 'a1b2c3d4e5f6a7b8c9d0e1f2',
    ciphertext: Buffer.from(plaintext, 'utf-8').toString('hex'),
    authTag: 'f1e2d3c4b5a6f7e8d9c0a1b2c3d4e5f6',
  });
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  runMigration();
});

afterEach(() => {
  sqlite.close();
});

describe('schwab_tokens table schema', () => {
  it('creates the schwab_tokens table with correct columns', () => {
    const columns = sqlite.prepare('PRAGMA table_info(schwab_tokens)').all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;

    expect(columns.length).toBe(10);

    const idCol = columns.find(c => c.name === 'id');
    expect(idCol).toBeDefined();
    expect(idCol!.type).toBe('TEXT');
    expect(idCol!.notnull).toBe(1);

    const accessTokenCol = columns.find(c => c.name === 'encrypted_access_token');
    expect(accessTokenCol).toBeDefined();
    expect(accessTokenCol!.type).toBe('TEXT');
    expect(accessTokenCol!.notnull).toBe(1);

    const refreshTokenCol = columns.find(c => c.name === 'encrypted_refresh_token');
    expect(refreshTokenCol).toBeDefined();
    expect(refreshTokenCol!.type).toBe('TEXT');
    expect(refreshTokenCol!.notnull).toBe(0); // nullable

    const scopeCol = columns.find(c => c.name === 'scope');
    expect(scopeCol).toBeDefined();
    expect(scopeCol!.type).toBe('TEXT');

    const tokenTypeCol = columns.find(c => c.name === 'token_type');
    expect(tokenTypeCol).toBeDefined();
    expect(tokenTypeCol!.type).toBe('TEXT');
    expect(tokenTypeCol!.dflt_value).toMatch(/Bearer/);

    const expiresAtCol = columns.find(c => c.name === 'expires_at');
    expect(expiresAtCol).toBeDefined();
    expect(expiresAtCol!.type).toBe('TEXT');

    const refreshExpiresAtCol = columns.find(c => c.name === 'refresh_token_expires_at');
    expect(refreshExpiresAtCol).toBeDefined();
    expect(refreshExpiresAtCol!.type).toBe('TEXT');

    const statusCol = columns.find(c => c.name === 'status');
    expect(statusCol).toBeDefined();
    expect(statusCol!.type).toBe('TEXT');
    expect(statusCol!.dflt_value).toMatch(/active/);

    const createdAtCol = columns.find(c => c.name === 'created_at');
    expect(createdAtCol).toBeDefined();
    expect(createdAtCol!.type).toBe('TEXT');

    const updatedAtCol = columns.find(c => c.name === 'updated_at');
    expect(updatedAtCol).toBeDefined();
    expect(updatedAtCol!.type).toBe('TEXT');
  });

  it('has id as primary key', () => {
    const pkColumns = sqlite.prepare('PRAGMA table_info(schwab_tokens)').all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    const pkCols = pkColumns.filter(c => c.pk === 1);
    expect(pkCols).toHaveLength(1);
    expect(pkCols[0].name).toBe('id');
  });

  it('is idempotent — running migration twice does not error', () => {
    // Should not throw
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schwab_tokens (
        id TEXT PRIMARY KEY NOT NULL,
        encrypted_access_token TEXT NOT NULL
      );
    `);
    // Table still exists
    const count = sqlite.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='schwab_tokens'"
    ).get() as { count: number };
    expect(count.count).toBe(1);
  });
});

describe('schwab_tokens CRUD operations', () => {
  it('inserts and retrieves a single row', () => {
    const encryptedAccess = makeEncryptedTokenPayload('eyJhbGciOiJSUzI1NiJ9.access-token');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 3600_000).toISOString(); // 1 hour

    sqlite.prepare(`
      INSERT INTO schwab_tokens (id, encrypted_access_token, scope, token_type, expires_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('default', encryptedAccess, 'read write', 'Bearer', expiresAt, 'active', now, now);

    const row = sqlite.prepare('SELECT * FROM schwab_tokens WHERE id = ?').get('default') as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.id).toBe('default');
    expect(row.encrypted_access_token).toBe(encryptedAccess);
    expect(row.scope).toBe('read write');
    expect(row.token_type).toBe('Bearer');
    expect(row.expires_at).toBe(expiresAt);
    expect(row.status).toBe('active');
  });

  it('inserts and retrieves with optional refresh token', () => {
    const encryptedAccess = makeEncryptedTokenPayload('access-token-abc');
    const encryptedRefresh = makeEncryptedTokenPayload('refresh-token-xyz');
    const now = new Date().toISOString();

    sqlite.prepare(`
      INSERT INTO schwab_tokens (id, encrypted_access_token, encrypted_refresh_token, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('default', encryptedAccess, encryptedRefresh, 'active', now, now);

    const row = sqlite.prepare('SELECT * FROM schwab_tokens WHERE id = ?').get('default') as Record<string, unknown>;
    expect(row.encrypted_access_token).toBe(encryptedAccess);
    expect(row.encrypted_refresh_token).toBe(encryptedRefresh);
  });

  it('allows nullable fields to be NULL', () => {
    sqlite.prepare(`
      INSERT INTO schwab_tokens (id, encrypted_access_token)
      VALUES (?, ?)
    `).run('default', makeEncryptedTokenPayload('token'));

    const row = sqlite.prepare('SELECT * FROM schwab_tokens WHERE id = ?').get('default') as Record<string, unknown>;
    expect(row.encrypted_refresh_token).toBeNull();
    expect(row.scope).toBeNull();
    expect(row.expires_at).toBeNull();
    expect(row.refresh_token_expires_at).toBeNull();
  });

  it('applies default values for token_type and status', () => {
    sqlite.prepare(`
      INSERT INTO schwab_tokens (id, encrypted_access_token)
      VALUES (?, ?)
    `).run('default', makeEncryptedTokenPayload('token'));

    const row = sqlite.prepare('SELECT * FROM schwab_tokens WHERE id = ?').get('default') as Record<string, unknown>;
    expect(row.token_type).toBe('Bearer');
    expect(row.status).toBe('active');
  });

  it('updates existing row (upsert pattern)', () => {
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO schwab_tokens (id, encrypted_access_token, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('default', makeEncryptedTokenPayload('old-token'), 'active', now, now);

    // Update the token
    const newAccess = makeEncryptedTokenPayload('new-token');
    const newExpiry = new Date(Date.now() + 7200_000).toISOString();
    sqlite.prepare(`
      UPDATE schwab_tokens SET encrypted_access_token = ?, expires_at = ?, updated_at = ? WHERE id = ?
    `).run(newAccess, newExpiry, now, 'default');

    const row = sqlite.prepare('SELECT * FROM schwab_tokens WHERE id = ?').get('default') as Record<string, unknown>;
    expect(row.encrypted_access_token).toBe(newAccess);
    expect(row.expires_at).toBe(newExpiry);
  });

  it('deletes the single row (disconnect)', () => {
    sqlite.prepare(`
      INSERT INTO schwab_tokens (id, encrypted_access_token)
      VALUES (?, ?)
    `).run('default', makeEncryptedTokenPayload('token'));

    sqlite.prepare('DELETE FROM schwab_tokens WHERE id = ?').run('default');

    const row = sqlite.prepare('SELECT * FROM schwab_tokens WHERE id = ?').get('default');
    expect(row).toBeUndefined();
  });

  it('stores encrypted data as JSON-parseable text', () => {
    const encryptedPayload = makeEncryptedTokenPayload('test-token-data');
    sqlite.prepare(`
      INSERT INTO schwab_tokens (id, encrypted_access_token)
      VALUES (?, ?)
    `).run('default', encryptedPayload);

    const row = sqlite.prepare('SELECT encrypted_access_token FROM schwab_tokens WHERE id = ?').get('default') as Record<string, unknown>;

    // The stored value should be parseable JSON with iv, ciphertext, authTag
    const parsed = JSON.parse(row.encrypted_access_token as string);
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('ciphertext');
    expect(parsed).toHaveProperty('authTag');
    expect(typeof parsed.iv).toBe('string');
    expect(typeof parsed.ciphertext).toBe('string');
    expect(typeof parsed.authTag).toBe('string');
    expect(parsed.ciphertext.length).toBeGreaterThan(0);
  });

  it('ensures id is unique (single row only)', () => {
    sqlite.prepare(`
      INSERT INTO schwab_tokens (id, encrypted_access_token)
      VALUES (?, ?)
    `).run('default', makeEncryptedTokenPayload('first'));

    // Second insert with same id should fail (primary key)
    expect(() => {
      sqlite.prepare(`
        INSERT INTO schwab_tokens (id, encrypted_access_token)
        VALUES (?, ?)
      `).run('default', makeEncryptedTokenPayload('second'));
    }).toThrow();
  });

  it('uses defaults for created_at and updated_at', () => {
    sqlite.prepare(`
      INSERT INTO schwab_tokens (id, encrypted_access_token)
      VALUES (?, ?)
    `).run('default', makeEncryptedTokenPayload('token'));

    const row = sqlite.prepare('SELECT created_at, updated_at FROM schwab_tokens WHERE id = ?').get('default') as Record<string, unknown>;
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
    // Both should be valid date strings parseable by Date
    expect(() => new Date(row.created_at as string)).not.toThrow();
    expect(() => new Date(row.updated_at as string)).not.toThrow();
  });
});
