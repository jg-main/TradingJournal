/**
 * /api/market-data/settings
 *
 * GET  — Fetch market data provider settings (single-row config)
 * PUT  — Create or update market data provider settings
 *
 * The `providers` column is a TEXT JSON blob storing per-provider
 * configuration (host, port, credentials, tokens etc.).
 * Sensitive fields (e.g. `password`) are stripped from GET responses.
 *
 * Pattern: src/app/api/ai-settings/route.ts (single-row config with Zod validation)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { marketDataSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  DEFAULT_MTM_REFRESH_INTERVAL_SECONDS,
  MAX_MTM_REFRESH_INTERVAL_SECONDS,
  MIN_MTM_REFRESH_INTERVAL_SECONDS,
  resolveMtmRefreshIntervalSeconds,
} from '@/lib/market-data-refresh-interval';

// ── Zod Schemas ─────────────────────────────────────────────────────────

/**
 * Validates a single ClickHouse provider config block.
 */
const clickhouseProviderSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1, 'Port must be >= 1').max(65535, 'Port must be <= 65535'),
  user: z.string().min(1, 'User is required'),
  password: z.string().optional(),
  database: z.string().min(1, 'Database is required'),
});

/**
 * Top-level market data settings schema.
 * `providers` must be a record where each key is a provider name and the
 * value is an object with the provider's configuration fields.
 */
const marketDataSettingsSchema = z.object({
  activeProvider: z.string().min(1, 'activeProvider must be a non-empty string').optional(),
  providers: z.record(z.string(), z.object({}).catchall(z.any())).optional(),
  refreshIntervalSeconds: z
    .number()
    .int()
    .min(MIN_MTM_REFRESH_INTERVAL_SECONDS)
    .max(MAX_MTM_REFRESH_INTERVAL_SECONDS)
    .optional(),
});

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Known sensitive field names that must be stripped from GET responses.
 * Extend this list when adding new providers with different secret fields.
 */
const SENSITIVE_FIELDS = new Set(['password']);

/**
 * Strip sensitive fields from each provider config in the providers record.
 * Returns a new object; the original is not mutated.
 */
function stripProviderSecrets(
  providers: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [providerName, config] of Object.entries(providers)) {
    if (config && typeof config === 'object') {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
        if (!SENSITIVE_FIELDS.has(key)) {
          clean[key] = value;
        }
      }
      safe[providerName] = clean;
    } else {
      safe[providerName] = config;
    }
  }
  return safe;
}

/**
 * Safely parse the providers JSON string, returning an empty object on failure.
 */
function parseProviders(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// ── Route Handlers ──────────────────────────────────────────────────────

/**
 * GET /api/market-data/settings
 *
 * Returns the single market_data_settings row with providers parsed from
 * JSON and sensitive fields stripped. If no row exists, returns a message
 * with 200 status (idempotent read).
 */
export async function GET() {
  try {
    const row = db.select().from(marketDataSettings).limit(1).get();

    if (!row) {
      return NextResponse.json(
        { message: 'No market data settings configured yet. Use PUT to create.' },
        { status: 200 },
      );
    }

    const providers = parseProviders(row.providers);
    const safeProviders = stripProviderSecrets(providers);

    return NextResponse.json({
      id: row.id,
      activeProvider: row.activeProvider,
      providers: safeProviders,
      refreshIntervalSeconds: resolveMtmRefreshIntervalSeconds(row.refreshIntervalSeconds),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch market data settings', details: String(error) },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/market-data/settings
 *
 * Creates or updates the single market_data_settings row. If no row exists,
 * a new one is created with defaults. If a row exists, only the provided
 * fields are updated (partial update semantics).
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = marketDataSettingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const existing = db.select().from(marketDataSettings).limit(1).get();

    if (!existing) {
      // ── Create new row ──────────────────────────────────────────────
      const id = crypto.randomUUID();
      const providers = parsed.data.providers
        ? JSON.stringify(parsed.data.providers)
        : '{}';

      db.insert(marketDataSettings)
        .values({
          id,
          activeProvider: parsed.data.activeProvider ?? 'clickhouse',
          providers,
          refreshIntervalSeconds:
            parsed.data.refreshIntervalSeconds ??
            DEFAULT_MTM_REFRESH_INTERVAL_SECONDS,
        })
        .run();

      const row = db.select().from(marketDataSettings).where(eq(marketDataSettings.id, id)).get();
      if (!row) {
        return NextResponse.json(
          { error: 'Failed to create market data settings' },
          { status: 500 },
        );
      }

      const rowProviders = parseProviders(row.providers);
      return NextResponse.json(
        {
          id: row.id,
          activeProvider: row.activeProvider,
          providers: stripProviderSecrets(rowProviders),
          refreshIntervalSeconds: resolveMtmRefreshIntervalSeconds(row.refreshIntervalSeconds),
        },
        { status: 201 },
      );
    }

    // ── Update existing row ───────────────────────────────────────────
    const updateData: Record<string, unknown> = {};

    if (parsed.data.activeProvider !== undefined) {
      updateData.activeProvider = parsed.data.activeProvider;
    }

    if (parsed.data.providers !== undefined) {
      // Merge: overlay incoming provider configs on top of existing ones
      const existingProviders = parseProviders(existing.providers);
      const mergedProviders = {
        ...existingProviders,
        ...parsed.data.providers,
      } as Record<string, unknown>;
      updateData.providers = JSON.stringify(mergedProviders);
    }

    if (parsed.data.refreshIntervalSeconds !== undefined) {
      updateData.refreshIntervalSeconds = parsed.data.refreshIntervalSeconds;
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updatedAt = new Date().toISOString();
      db.update(marketDataSettings)
        .set(updateData)
        .where(eq(marketDataSettings.id, existing.id))
        .run();
    }

    const row = db.select().from(marketDataSettings).where(eq(marketDataSettings.id, existing.id)).get();
    if (!row) {
      return NextResponse.json(
        { error: 'Failed to fetch updated market data settings' },
        { status: 500 },
      );
    }

    const rowProviders = parseProviders(row.providers);
    return NextResponse.json({
      id: row.id,
      activeProvider: row.activeProvider,
      providers: stripProviderSecrets(rowProviders),
      refreshIntervalSeconds: resolveMtmRefreshIntervalSeconds(row.refreshIntervalSeconds),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update market data settings', details: String(error) },
      { status: 500 },
    );
  }
}
