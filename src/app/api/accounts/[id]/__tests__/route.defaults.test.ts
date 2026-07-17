import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/db/schema';

const sqlite = new Database(':memory:');
const db = drizzle(sqlite, { schema });

sqlite.exec(`
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    starting_balance REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE trades (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT,
    status TEXT NOT NULL
  );
`);

vi.mock('@/db', () => ({
  db,
  getSqliteHandle: () => sqlite,
}));

const { PUT } = await import('../route');

type AccountDefaults = {
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
};

function seedAccount(defaults: AccountDefaults = {
  maxRiskPerTradePct: null,
  defaultCommission: null,
}) {
  const id = randomUUID();
  db.insert(schema.accounts)
    .values({
      id,
      name: 'Handler test account',
      currency: 'USD',
      ...defaults,
    })
    .run();
  return id;
}

async function putDefaults(id: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/accounts/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const response = await PUT(request, { params: Promise.resolve({ id }) });
  return { response, body: await response.json() };
}

function persistedDefaults(id: string): AccountDefaults {
  const row = db.select({
    maxRiskPerTradePct: schema.accounts.maxRiskPerTradePct,
    defaultCommission: schema.accounts.defaultCommission,
  }).from(schema.accounts).where(eq(schema.accounts.id, id)).get();

  if (!row) throw new Error(`Missing test account ${id}`);
  return row;
}

describe('PUT /api/accounts/[id] account defaults', () => {
  beforeEach(() => {
    sqlite.exec('DELETE FROM trades; DELETE FROM accounts;');
  });

  afterAll(() => {
    sqlite.close();
  });

  it('persists numeric risk and commission overrides through the real handler', async () => {
    const id = seedAccount();

    const result = await putDefaults(id, {
      maxRiskPerTradePct: 1.25,
      defaultCommission: 4.75,
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({
      id,
      maxRiskPerTradePct: 1.25,
      defaultCommission: 4.75,
    });
    expect(persistedDefaults(id)).toEqual({
      maxRiskPerTradePct: 1.25,
      defaultCommission: 4.75,
    });
  });

  it('persists null to reset both overrides to inherited global defaults', async () => {
    const id = seedAccount({
      maxRiskPerTradePct: 2.5,
      defaultCommission: 1,
    });

    const result = await putDefaults(id, {
      maxRiskPerTradePct: null,
      defaultCommission: null,
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({
      id,
      maxRiskPerTradePct: null,
      defaultCommission: null,
    });
    expect(persistedDefaults(id)).toEqual({
      maxRiskPerTradePct: null,
      defaultCommission: null,
    });
  });

  it('returns the stable error shape when request JSON decoding fails', async () => {
    const id = seedAccount();
    const request = new NextRequest(`http://localhost/api/accounts/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{not-valid-json',
    });

    const response = await PUT(request, { params: Promise.resolve({ id }) });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: 'Failed to update account',
      details: expect.any(String),
    });
  });

  it.each([
    { payload: { maxRiskPerTradePct: 0 }, label: 'zero risk' },
    { payload: { maxRiskPerTradePct: -1 }, label: 'negative risk' },
    { payload: { defaultCommission: -0.01 }, label: 'negative commission' },
    { payload: { maxRiskPerTradePct: '1.5' }, label: 'non-numeric risk' },
  ])('rejects $payload without changing persisted defaults ($label)', async ({ payload }) => {
    const original = { maxRiskPerTradePct: 1.5, defaultCommission: 2 };
    const id = seedAccount(original);

    const result = await putDefaults(id, payload);

    expect(result.response.status).toBe(400);
    expect(result.body).toMatchObject({
      error: 'Validation failed',
      details: expect.any(Object),
    });
    expect(persistedDefaults(id)).toEqual(original);
  });
});
