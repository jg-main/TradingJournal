/**
 * POST /api/market-data/clickhouse/test-connection
 *
 * Tests the ClickHouse connection using the current config from
 * market_data_settings, with optional override fields from the request body.
 *
 * Returns a JSON response with `ok` (boolean) and `error` (string, if failed).
 * Catches all connection errors and never throws.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createDefaultClickHouseClient } from '@/lib/clickhouse-client';

interface TestConnectionBody {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export async function POST(request: NextRequest) {
  try {
    let body: TestConnectionBody = {};
    try {
      body = (await request.json()) as TestConnectionBody;
    } catch {
      // Empty body — use default config resolution
    }

    // Build config override from request body (if provided)
    const configOverride: {
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      database?: string;
    } = {};

    if (body.host !== undefined) configOverride.host = body.host;
    if (body.port !== undefined) configOverride.port = body.port;
    if (body.user !== undefined) configOverride.user = body.user;
    if (body.password !== undefined) configOverride.password = body.password;
    if (body.database !== undefined) configOverride.database = body.database;

    // Create client with potential overrides
    const hasOverrides = Object.keys(configOverride).length > 0;
    const client = hasOverrides
      ? createDefaultClickHouseClient(configOverride)
      : createDefaultClickHouseClient();

    // Test the connection by checking freshness (cheap query)
    const result = await client.checkFreshness(30);

    if (result.status === 'error') {
      return NextResponse.json(
        { ok: false, error: result.message },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true,
      status: result.status,
      latestDate: result.latestDate ?? null,
      message: result.message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: `Connection test failed: ${message}` },
      { status: 200 },
    );
  }
}
