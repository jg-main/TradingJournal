/**
 * POST /api/ai-settings/test-connection
 *
 * Tests the ClickHouse connection using the configured settings from the
 * ai_settings database row. Attempts a SELECT 1 query and returns a
 * structured result.
 *
 * Returns:
 *   { ok: true }                              — Connection succeeded (200)
 *   { ok: false, error: string }              — Connection failed (200)
 *   { ok: false, error: string, status: 400 } — No ai_settings configured (400)
 */

import { NextResponse } from 'next/server';
import { db } from '@/db';
import { aiSettings } from '@/db/schema';

export async function POST() {
  try {
    const row = db.select().from(aiSettings).limit(1).get();

    if (!row) {
      return NextResponse.json(
        { ok: false, error: 'No AI settings configured. Configure ClickHouse settings first.' },
        { status: 400 }
      );
    }

    // Build ClickHouse config from DB settings with fallbacks
    const host = row.clickhouseHost || 'localhost';
    const port = row.clickhousePort ?? 8123;
    const user = row.clickhouseUser || 'default';
    const password = row.clickhousePassword || '';
    const database = row.clickhouseDatabase || 'market';

    // Build the ClickHouse HTTP URL
    const encodedUser = encodeURIComponent(user);
    const encodedPass = encodeURIComponent(password);
    const encodedDb = encodeURIComponent(database);
    const url = `http://${host}:${port}/?user=${encodedUser}&password=${encodedPass}&database=${encodedDb}&default_format=TabSeparatedWithNames`;

    // Execute SELECT 1 to test connectivity
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

        console.log(JSON.stringify({
          event: 'clickhouse_test_connection',
          host,
          port,
          database,
          ok: false,
          error: errorMsg,
          elapsedMs: elapsed,
        }));

        return NextResponse.json({ ok: false, error: errorMsg });
      }

      console.log(JSON.stringify({
        event: 'clickhouse_test_connection',
        host,
        port,
        database,
        ok: true,
        elapsedMs: elapsed,
      }));

      return NextResponse.json({ ok: true });
    } catch (err) {
      elapsed = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      console.log(JSON.stringify({
        event: 'clickhouse_test_connection',
        host,
        port,
        database,
        ok: false,
        error: message,
        elapsedMs: elapsed,
      }));

      return NextResponse.json({ ok: false, error: message });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
