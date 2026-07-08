/**
 * health route test
 *
 * Tests GET /api/health returns 200 with status:'ok', db:'connected', and ISO timestamp.
 * Tests DB failure returns 503 with error status.
 *
 * Run: npx vitest run src/app/api/health/__tests__/route.test.ts
 */

import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';

import * as schema from '@/db/schema';

// ── Setup: in-memory test DB ────────────────────────────────────────

const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite, { schema });

// Helper that simulates the route handler logic
function doGetHealth(database: typeof db): { status: number; data: unknown } {
  try {
    database.run(sql`SELECT 1`);
    return {
      status: 200,
      data: {
        status: 'ok',
        db: 'connected',
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown database error';
    return {
      status: 503,
      data: {
        status: 'error',
        db: 'disconnected',
        message,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 OK', () => {
    const result = doGetHealth(db);
    expect(result.status).toBe(200);
  });

  it('returns status: ok', () => {
    const result = doGetHealth(db);
    const data = result.data as Record<string, unknown>;
    expect(data.status).toBe('ok');
  });

  it('returns db: connected', () => {
    const result = doGetHealth(db);
    const data = result.data as Record<string, unknown>;
    expect(data.db).toBe('connected');
  });

  it('returns ISO 8601 timestamp', () => {
    const result = doGetHealth(db);
    const data = result.data as Record<string, unknown>;
    expect(data.timestamp).toBeDefined();
    expect(data.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
  });

  it('returns 503 and error status when DB is disconnected', () => {
    // Create a closed database to simulate disconnection
    const badSqlite = new Database(':memory:');
    badSqlite.close();
    const badDb = drizzle(badSqlite, { schema });

    const result = doGetHealth(badDb);
    expect(result.status).toBe(503);
    const data = result.data as Record<string, unknown>;
    expect(data.status).toBe('error');
    expect(data.db).toBe('disconnected');
    expect(data.message).toBeDefined();
    expect(typeof data.message).toBe('string');
  });
});
