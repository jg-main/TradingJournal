import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

import * as schema from '@/db/schema';

const sqlite = new Database(':memory:');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

sqlite.exec(`
  CREATE TABLE app_profile (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT,
    timezone TEXT DEFAULT 'America/Bogota',
    default_currency TEXT DEFAULT 'USD',
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT,
    starting_account_value REAL,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    journal_start_date TEXT,
    currency TEXT DEFAULT 'USD',
    backup_enabled INTEGER DEFAULT 0,
    backup_retention_count INTEGER DEFAULT 3,
    backup_last_run_at TEXT,
    backup_last_run_status TEXT,
    backup_cron_time TEXT DEFAULT '02:00',
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
`);

vi.mock('@/db', () => ({ db }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('@/lib/scheduler', () => ({
  reschedule: vi.fn(),
  cronTimeToUTCExpression: vi.fn((time: string) => {
    const [h, m] = time.split(':').map(Number);
    return `${m} ${h} * * *`;
  }),
  isSchedulerActive: vi.fn(() => false),
}));
vi.mock('@/lib/backup-job', () => ({
  runBackupJob: vi.fn(),
}));

async function loadRoute() {
  return import('../route');
}

function cleanup() {
  sqlite.exec('DELETE FROM app_profile;');
}

function seedProfile(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.appProfile)
    .values({
      id,
      displayName: 'Initial User',
      timezone: 'America/Bogota',
      defaultCurrency: 'USD',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.appProfile).where(eq(schema.appProfile.id, id)).get() as Record<string, unknown>;
}

describe('app-profile route', () => {
  beforeEach(() => {
    cleanup();
  });

  it('returns a missing-profile message when no row exists', async () => {
    const { GET } = await loadRoute();
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'No app profile configured yet. Use PUT to create.',
    });
  });

  it('creates a new app profile row on PUT', async () => {
    const { PUT } = await loadRoute();
    const response = await PUT(
      new NextRequest('http://localhost/api/app-profile', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: 'Ada Lovelace',
          timezone: 'UTC',
          defaultCurrency: 'USD',
        }),
      }),
    );

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toBeDefined();
    expect(data.displayName).toBe('Ada Lovelace');
    expect(data.timezone).toBe('UTC');
    expect(data.defaultCurrency).toBe('USD');
  });

  it('updates an existing app profile row on PUT', async () => {
    seedProfile();
    const { PUT } = await loadRoute();
    const response = await PUT(
      new NextRequest('http://localhost/api/app-profile', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: 'Grace Hopper',
          timezone: 'Europe/London',
          defaultCurrency: 'GBP',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.displayName).toBe('Grace Hopper');
    expect(data.timezone).toBe('Europe/London');
    expect(data.defaultCurrency).toBe('GBP');
  });

  it('rejects an empty display name', async () => {
    const { PUT } = await loadRoute();
    const response = await PUT(
      new NextRequest('http://localhost/api/app-profile', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: '   ',
          timezone: 'UTC',
          defaultCurrency: 'USD',
        }),
      }),
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Validation failed');
  });

  it('rejects malformed timezone and currency payloads', async () => {
    const { PUT } = await loadRoute();
    const response = await PUT(
      new NextRequest('http://localhost/api/app-profile', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: 'Ada',
          timezone: '',
          defaultCurrency: 'USDT',
        }),
      }),
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Validation failed');
    expect(JSON.stringify(data.details)).toContain('timezone');
    expect(JSON.stringify(data.details)).toContain('defaultCurrency');
  });
});
