/**
 * POST /api/ai-settings/test-connection
 *
 * Tests the ClickHouse connection. Accepts optional body overrides for
 * host, port, user, password, and database. Falls back to the DB row
 * when values are not provided in the request body.
 *
 * Body (all optional):
 *   { clickhouseHost?, clickhousePort?, clickhouseUser?, clickhousePassword?, clickhouseDatabase? }
 *
 * Returns:
 *   { ok: true }              — Connection succeeded (200)
 *   { ok: false, error }      — Connection failed (200)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { aiSettings } from '@/db/schema';
import { z } from 'zod';

const testConnectionSchema = z.object({
  clickhouseHost: z.string().optional(),
  clickhousePort: z.number().int().min(1).max(65535).optional(),
  clickhouseUser: z.string().optional(),
  clickhousePassword: z.string().optional(),
  clickhouseDatabase: z.string().optional(),
});

async function testConnection(
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
) {
  const encodedUser = encodeURIComponent(user);
  const encodedPass = encodeURIComponent(password);
  const encodedDb = encodeURIComponent(database);
  const url = `http://${host}:${port}/?user=${encodedUser}&password=${encodedPass}&database=${encodedDb}&default_format=TabSeparatedWithNames`;

  const startTime = Date.now();
  let elapsed: number;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'SELECT 1',
      signal: AbortSignal.timeout(10_000),
    });

    elapsed = Date.now() - startTime;

    if (!response.ok) {
      const body = await response.text().catch(() => '(no body)');
      const errorMsg = `ClickHouse HTTP ${response.status}: ${body.slice(0, 500)}`;
      console.log(JSON.stringify({ event: 'clickhouse_test_connection', host, port, database, ok: false, error: errorMsg, elapsedMs: elapsed }));
      return NextResponse.json({ ok: false, error: errorMsg });
    }

    console.log(JSON.stringify({ event: 'clickhouse_test_connection', host, port, database, ok: true, elapsedMs: elapsed }));
    return NextResponse.json({ ok: true });
  } catch (err) {
    elapsed = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ event: 'clickhouse_test_connection', host, port, database, ok: false, error: message, elapsedMs: elapsed }));
    return NextResponse.json({ ok: false, error: message });
  }
}

export async function POST(request: NextRequest) {
  try {
    let overrides: z.infer<typeof testConnectionSchema> = {};
    try {
      const body = await request.json();
      const parsed = testConnectionSchema.safeParse(body);
      if (parsed.success) overrides = parsed.data;
    } catch {
      // No body or invalid JSON — use DB values only
    }

    const row = db.select().from(aiSettings).limit(1).get();

    // Body overrides > DB row > defaults
    const host = overrides.clickhouseHost ?? row?.clickhouseHost ?? 'localhost';
    const port = overrides.clickhousePort ?? row?.clickhousePort ?? 8123;
    const user = overrides.clickhouseUser ?? row?.clickhouseUser ?? 'default';
    const password = overrides.clickhousePassword ?? row?.clickhousePassword ?? '';
    const database = overrides.clickhouseDatabase ?? row?.clickhouseDatabase ?? 'market';

    return testConnection(host, port, user, password, database);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
