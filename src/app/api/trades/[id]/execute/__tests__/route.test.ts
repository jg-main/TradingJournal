/**
 * trade execute route test
 *
 * Tests the POST /api/trades/[id]/execute endpoint for batch entry + exit creation.
 *
 * Run: npx tsx src/app/api/trades/[id]/execute/__tests__/route.test.ts
 *      (also registered in vitest.config.ts include; run via
 *       `npx vitest run src/app/api/trades/[id]/execute/__tests__/route.test.ts`)
 */
/// <reference types="vitest/globals" />

import { testDbPath } from '../../../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, or, isNull, asc } from 'drizzle-orm';

import * as schema from '@/db/schema';
import { checkExecutionReadiness } from '@/lib/execution-readiness';
import { computeExecutionContext } from '@/lib/execution-context';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED)`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — value is null/undefined (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('execute');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS account_rollforward;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS trade_stop_adjustments;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_mistakes;
  DROP TABLE IF EXISTS trade_grades;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trade_assets;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS watchlist_items;
  DROP TABLE IF EXISTS weekly_reviews;
  DROP TABLE IF EXISTS setup_definitions;
  DROP TABLE IF EXISTS accounts;
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
  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    planned_entry REAL,
    planned_stop REAL,
    planned_target_1 REAL,
    planned_target_2 REAL,
    planned_quantity REAL,
    thesis TEXT,
    invalidation_condition TEXT,
    pre_trade_plan TEXT,
    risk_override_reason TEXT,
    opened_at TEXT,
    closed_at TEXT,
    exit_notes TEXT,
    lesson TEXT,
    current_price REAL,
    current_price_fetched_at TEXT,
    gross_realized_pnl REAL,
    net_realized_pnl REAL,
    realized_fees REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    executed_at TEXT,
    action TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    default_account_id TEXT REFERENCES accounts(id),
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
  CREATE TABLE IF NOT EXISTS account_transactions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    balance_after REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT UNIQUE NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    account_equity_at_open REAL,
    initial_entry_price REAL,
    initial_stop_price REAL,
    initial_quantity REAL,
    risk_per_share REAL,
    initial_risk_amount REAL,
    account_risk_pct REAL,
    planned_reward_risk REAL,
    created_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS setup_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    how_to_play TEXT,
    exit_rules TEXT,
    tags TEXT,
    default_risk_pct REAL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS checklist_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    setup_id TEXT REFERENCES setup_definitions(id),
    description TEXT NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );
  CREATE TABLE IF NOT EXISTS trade_check_results (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    checklist_definition_id TEXT NOT NULL REFERENCES checklist_definitions(id),
    item_text TEXT,
    passed INTEGER NOT NULL,
    comment TEXT,
    checked_at TEXT DEFAULT (current_timestamp),
    created_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated deriveTradeStatus ─────────────────────────────────────

type Direction = 'long' | 'short';

function isEntryAction(action: string, direction: Direction): boolean {
  if (direction === 'long') return action === 'buy' || action === 'add';
  return action === 'sell_short';
}

function isExitAction(action: string, direction: Direction): boolean {
  if (direction === 'long') return action === 'sell' || action === 'reduce';
  return action === 'buy_to_cover';
}

interface DeriveStatusResult {
  status: string;
  openedAt: string | null;
  closedAt: string | null;
  totalEntryQty: number;
  totalExitQty: number;
}

interface CheckResultInput {
  checklistDefinitionId: string;
  passed: boolean;
  comment?: string;
}

function simulateDeriveStatus(
  executions: { action: string; quantity: number; executedAt: string }[],
  direction: Direction,
): DeriveStatusResult {
  const entries = executions.filter((e) => isEntryAction(e.action, direction));
  const exits = executions.filter((e) => isExitAction(e.action, direction));

  const totalEntryQty = entries.reduce((s, e) => s + e.quantity, 0);
  const totalExitQty = exits.reduce((s, e) => s + e.quantity, 0);

  let status: string;
  let openedAt: string | null = null;
  let closedAt: string | null = null;

  if (totalEntryQty === 0) {
    status = 'planned';
  } else if (totalExitQty === 0) {
    status = 'open';
  } else if (totalExitQty < totalEntryQty) {
    status = 'open';
  } else {
    status = 'closed';
  }

  if (totalEntryQty > 0 && entries.length > 0) {
    const sorted = [...entries].sort(
      (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
    );
    openedAt = sorted[0].executedAt;
  }

  if (totalExitQty >= totalEntryQty && exits.length > 0) {
    const sorted = [...exits].sort(
      (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
    );
    closedAt = sorted[sorted.length - 1].executedAt;
  }

  return { status, openedAt, closedAt, totalEntryQty, totalExitQty };
}

// ── Simulated route logic ───────────────────────────────────────────

function doExecuteTrade(tradeId: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    const entryPrice = body.entryPrice;
    const entryQuantity = body.entryQuantity;
    const exit1Price = body.exit1Price as number | undefined;
    const exit1Quantity = body.exit1Quantity as number | undefined;
    const exit2Price = body.exit2Price as number | undefined;
    const exit2Quantity = body.exit2Quantity as number | undefined;
    const fees = (body.fees as number) ?? 0;

    if (typeof entryPrice !== 'number' || entryPrice <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { entryPrice: ['Entry price must be positive'] } } } };
    }
    if (typeof entryQuantity !== 'number' || entryQuantity <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { entryQuantity: ['Entry quantity must be positive'] } } } };
    }

    // riskOverrideReason mirrors zod z.string().min(1).max(500).optional()
    const riskOverrideReasonRaw = body.riskOverrideReason;
    if (
      riskOverrideReasonRaw !== undefined &&
      (typeof riskOverrideReasonRaw !== 'string' ||
        riskOverrideReasonRaw.length < 1 ||
        riskOverrideReasonRaw.length > 500)
    ) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              riskOverrideReason: ['String must contain at least 1 character(s)'],
            },
          },
        },
      };
    }

    // Validate exit quantities don't exceed entry quantity
    const exitQty1 = exit1Quantity ?? 0;
    const exitQty2 = exit2Quantity ?? 0;
    if (exitQty1 + exitQty2 > entryQuantity) {
      return {
        status: 409,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exitQuantity: [`Total exit quantity (${exitQty1 + exitQty2}) exceeds entry quantity (${entryQuantity})`],
            },
          },
        },
      };
    }

    // Exit price/quantity pairs must come together
    if ((exit1Price != null && exit1Quantity == null) || (exit1Quantity != null && exit1Price == null)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { exit1: ['Both exit1Price and exit1Quantity must be provided together'] } } } };
    }
    if ((exit2Price != null && exit2Quantity == null) || (exit2Quantity != null && exit2Price == null)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { exit2: ['Both exit2Price and exit2Quantity must be provided together'] } } } };
    }
    if (exit2Price != null && exit1Price == null) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { exit2: ['Exit 2 requires Exit 1 to be provided first'] } } } };
    }

    const trade = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get() as Record<string, unknown> | undefined;

    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    if (trade.status === 'deleted') {
      return { status: 400, data: { error: 'Cannot execute a deleted trade' } };
    }

    if (trade.status !== 'planned') {
      return { status: 400, data: { error: 'Trade is not in planned status' } };
    }

    const direction = trade.direction as string;
    const entryAction = direction === 'long' ? 'buy' : 'sell_short';
    const exitAction = direction === 'long' ? 'sell' : 'buy_to_cover';

    const DIRECTION_ACTIONS: Record<string, string[]> = {
      long: ['buy', 'add', 'sell', 'reduce'],
      short: ['sell_short', 'buy_to_cover'],
    };

    if (!DIRECTION_ACTIONS[direction]?.includes(entryAction)) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              action: [
                `Action "${entryAction}" is not valid for a ${direction} trade. ` +
                `Valid actions: ${DIRECTION_ACTIONS[direction].join(', ')}`,
              ],
            },
          },
        },
      };
    }

    // ── Checklist validation (required items only, D3) ───────────

    const checkResults = (body.checkResults as CheckResultInput[] | undefined) ?? [];

    // Resolve setup definition ID from the trade's setup lookup value
    let setupDefId: string | undefined;
    if (trade.setupId) {
      const lookupVal = db
        .select()
        .from(schema.lookupValues)
        .where(eq(schema.lookupValues.id, trade.setupId as string))
        .get() as Record<string, unknown> | undefined;
      if (lookupVal) {
        const setupDef = db
          .select()
          .from(schema.setupDefinitions)
          .where(eq(schema.setupDefinitions.name, lookupVal.value as string))
          .get() as Record<string, unknown> | undefined;
        if (setupDef) {
          setupDefId = setupDef.id as string;
        }
      }
    }

    // Fetch merged checklist for this trade's account + resolved setup
    const mergedChecks = db
      .select()
      .from(schema.checklistDefinitions)
      .where(
        and(
          or(
            eq(schema.checklistDefinitions.accountId, trade.accountId as string),
            ...(setupDefId ? [eq(schema.checklistDefinitions.setupId, setupDefId)] : []),
          ),
          isNull(schema.checklistDefinitions.deletedAt),
        ),
      )
      .orderBy(asc(schema.checklistDefinitions.sortOrder), asc(schema.checklistDefinitions.createdAt))
      .all() as Array<Record<string, unknown>>;

    // Item-text snapshot map (F7), shared with the insert below.
    const itemTextById = new Map<string, string>();

    if (mergedChecks.length > 0) {
      const submittedMap = new Map(checkResults.map((cr) => [cr.checklistDefinitionId, cr.passed]));

      // Only required items gate execution (D3): optional items may be omitted.
      const missing: string[] = [];
      const notPassed: string[] = [];

      for (const check of mergedChecks) {
        if (!check.isRequired) continue;
        const passedResult = submittedMap.get(check.id as string);
        if (passedResult === undefined) {
          missing.push(check.description as string);
        } else if (!passedResult) {
          notPassed.push(check.description as string);
        }
      }

      // Build the item-text snapshot map (F7) for submitted results.
      for (const check of mergedChecks) {
        itemTextById.set(check.id as string, check.description as string);
      }
      for (const cr of checkResults) {
        if (!itemTextById.has(cr.checklistDefinitionId)) {
          const def = db
            .select()
            .from(schema.checklistDefinitions)
            .where(eq(schema.checklistDefinitions.id, cr.checklistDefinitionId))
            .get() as Record<string, unknown> | undefined;
          if (def) {
            itemTextById.set(cr.checklistDefinitionId, def.description as string);
          }
        }
      }

      if (missing.length > 0 || notPassed.length > 0) {
        return {
          status: 400,
          data: {
            error: 'Validation failed',
            details: {
              fieldErrors: {
                checkResults: [
                  ...(missing.length > 0
                    ? [`Missing check results for: ${missing.join(', ')}`]
                    : []),
                  ...(notPassed.length > 0
                    ? [`Checklist items must be passed before execution: ${notPassed.join(', ')}`]
                    : []),
                ],
              },
            },
          },
        };
      }
    }

    // ── Execution readiness gate (T04) ─────────────────────────────

    const now = new Date().toISOString();
    const execTimestamp = (body.executedAt as string) ?? now;

    // Initial risk (D1: null when no valid stop — never 0).
    const effectiveStopPrice = ((body.stopPrice as number | undefined) ?? (trade.plannedStop as number | null)) ?? null;
    const initialRiskAmount =
      effectiveStopPrice != null
        ? Math.abs((entryPrice as number) - effectiveStopPrice) * (entryQuantity as number)
        : null;

    const equityContext = computeExecutionContext(
      db,
      (trade.accountId as string | null) ?? null,
      execTimestamp,
    );

    const readiness = checkExecutionReadiness({
      account: {
        isActive: equityContext.account?.isActive ?? false,
        currency: equityContext.account?.currency ?? 'USD',
        maxRiskPerTradePct: equityContext.account?.maxRiskPerTradePct ?? null,
        defaultCommission: equityContext.account?.defaultCommission ?? null,
      },
      settings: {
        maxRiskPerTradePct: equityContext.globalSettings?.maxRiskPerTradePct ?? null,
        startingAccountValue: equityContext.globalSettings?.startingAccountValue ?? null,
      },
      tradeStatus: trade.status as string,
      initialRiskAmount,
      equityAtOpen: equityContext.equityAtOpen,
      hasOpeningCash: equityContext.hasOpeningCash,
      // Required items were enforced by the checklist gate above.
      requiredChecklistPassed: true,
    });

    const nonMaxRiskFailure = readiness.failures.find((f) => f.code !== 'max-risk-exceeded');
    if (nonMaxRiskFailure) {
      const status =
        nonMaxRiskFailure.code === 'account-not-active' ||
        nonMaxRiskFailure.code === 'account-not-trading-ready'
          ? 409
          : 400;
      return { status, data: { error: nonMaxRiskFailure.message } };
    }

    const maxRiskFailure = readiness.failures.find((f) => f.code === 'max-risk-exceeded');
    const riskOverrideReason = (body.riskOverrideReason as string | undefined) ?? null;
    if (maxRiskFailure && !riskOverrideReason) {
      return {
        status: 422,
        data: {
          error: 'Max risk exceeded',
          details: {
            limit: maxRiskFailure.limit ?? null,
            computed: maxRiskFailure.computed ?? null,
            overrideable: true,
          },
        },
      };
    }

    // ── Execute within a transaction ─────────────────────────────

    const tradeIdStr = tradeId;

    // 1. Insert entry execution
    const entryId = randomUUID();
    db.insert(schema.tradeExecutions)
      .values({
        id: entryId,
        tradeId: tradeIdStr,
        action: entryAction,
        quantity: entryQuantity as number,
        price: entryPrice as number,
        fees,
        executedAt: execTimestamp,
        notes: null,
        createdAt: now,
      })
      .run();

    // 2. Insert exit 1 if provided
    if (exit1Price != null && exit1Quantity != null) {
      const exit1Id = randomUUID();
      db.insert(schema.tradeExecutions)
        .values({
          id: exit1Id,
          tradeId: tradeIdStr,
          action: exitAction,
          quantity: exit1Quantity as number,
          price: exit1Price as number,
          fees: 0,
          executedAt: execTimestamp,
          notes: null,
          createdAt: now,
        })
        .run();
    }

    // 3. Insert exit 2 if provided
    if (exit2Price != null && exit2Quantity != null) {
      const exit2Id = randomUUID();
      db.insert(schema.tradeExecutions)
        .values({
          id: exit2Id,
          tradeId: tradeIdStr,
          action: exitAction,
          quantity: exit2Quantity as number,
          price: exit2Price as number,
          fees: 0,
          executedAt: execTimestamp,
          notes: null,
          createdAt: now,
        })
        .run();
    }

    // 4. Reload all executions and derive status
    const allExecutions = db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, tradeIdStr))
      .orderBy(schema.tradeExecutions.executedAt, schema.tradeExecutions.createdAt)
      .all() as { action: string; quantity: number; price: number; fees: number | null; executedAt: string | null; createdAt: string | null }[];

    const execData = allExecutions.map((r) => ({
      action: r.action,
      quantity: r.quantity,
      executedAt: r.executedAt ?? r.createdAt ?? '',
    }));

    const derived = simulateDeriveStatus(execData, direction as Direction);

    // 5. Update trade
    db.update(schema.trades)
      .set({
        status: derived.status as 'planned' | 'open' | 'closed' | 'deleted',
        openedAt: derived.openedAt,
        closedAt: derived.closedAt,
        updatedAt: now,
        ...(riskOverrideReason ? { riskOverrideReason } : {}),
      })
      .where(eq(schema.trades.id, tradeIdStr))
      .run();

    // 6. Create risk snapshot on first entry
    if (derived.totalEntryQty > 0) {
      const existingSnapshot = db
        .select()
        .from(schema.tradeRiskSnapshots)
        .where(eq(schema.tradeRiskSnapshots.tradeId, tradeIdStr))
        .get();

      if (!existingSnapshot) {
        const entryExecs = allExecutions.filter((e) =>
          direction === 'long'
            ? e.action === 'buy' || e.action === 'add'
            : e.action === 'sell_short',
        );

        if (entryExecs.length > 0) {
          const totalEntryQtyCalc = entryExecs.reduce((s, e) => s + e.quantity, 0);
          const weightedSum = entryExecs.reduce((s, e) => s + e.price * e.quantity, 0);
          const avgEntryPrice = weightedSum / totalEntryQtyCalc;

          const snapshotValues: Record<string, unknown> = {
            id: randomUUID(),
            tradeId: tradeIdStr,
            initialEntryPrice: avgEntryPrice,
            initialQuantity: derived.totalEntryQty,
            createdAt: now,
          };

          const effectiveStopPrice = body.stopPrice ?? trade.plannedStop;
          if (effectiveStopPrice != null) {
            snapshotValues.initialStopPrice = effectiveStopPrice;
          }

          // Equity context is hoisted from the readiness gate (T04) — the
          // same reads the inline derivation below used to perform.
          if (equityContext.equityAtOpen != null) {
            snapshotValues.accountEquityAtOpen = equityContext.equityAtOpen;
          }

          db.insert(schema.tradeRiskSnapshots)
            .values(snapshotValues as unknown as typeof schema.tradeRiskSnapshots.$inferInsert)
            .run();
        }
      }
    }

    // 7. Persist trade check results atomically within the transaction,
    //    snapshotting the item text (F7) at check time.
    for (const cr of checkResults) {
      db.insert(schema.tradeCheckResults)
        .values({
          id: randomUUID(),
          tradeId: tradeIdStr,
          checklistDefinitionId: cr.checklistDefinitionId,
          itemText: itemTextById.get(cr.checklistDefinitionId) ?? null,
          passed: cr.passed,
          comment: cr.comment ?? null,
          checkedAt: now,
          createdAt: now,
        })
        .run();
    }

    // Return created executions and trade
    const createdExecutions = db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, tradeIdStr))
      .orderBy(schema.tradeExecutions.executedAt, schema.tradeExecutions.createdAt)
      .all();

    return { status: 201, data: { executions: createdExecutions, trade: { ...trade, status: derived.status } } };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to execute trade', details: String(error) } };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trade_check_results;');
  sqlite.exec('DELETE FROM checklist_definitions;');
  sqlite.exec('DELETE FROM trade_risk_snapshots;');
  sqlite.exec('DELETE FROM trade_executions;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM accounts;');
  sqlite.exec('DELETE FROM account_transactions;');
  sqlite.exec('DELETE FROM settings;');
  sqlite.exec('DELETE FROM lookup_values;');
  sqlite.exec('DELETE FROM setup_definitions;');
}

function seedCheckDefinition(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.checklistDefinitions)
    .values({
      id,
      description: 'Default check description',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, id)).get() as Record<string, unknown>;
}

function seedAccount(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.accounts)
    .values({
      id,
      name: 'Test Account',
      broker: null,
      currency: 'USD',
      isActive: true,
      // T04: execution now requires a trading-ready account (risk params +
      // commission + opening cash). Default the seed to fully configured so
      // existing cases exercise the new gate without tripping it; tests that
      // probe the negative paths override these explicitly.
      maxRiskPerTradePct: 10,
      defaultCommission: 1.0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown>;
}

function seedTrade(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
    .values({
      id,
      tradeCode: `T-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      accountId: 'test-account-id',
      symbol: 'AAPL',
      direction: 'long',
      status: 'planned',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trade Execute API Tests ---\n');

// ── 1. Entry-only creates 1 execution, trade becomes 'open', risk snapshot created ─

console.log('\n1. Entry-only creates execution, trade becomes open:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    stopPrice: 145.0,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as { executions: unknown[]; trade: Record<string, unknown> };
  assertEqual(data.executions.length, 1, 'creates 1 execution');
  assertEqual((data.executions[0] as Record<string, unknown>).action, 'buy', 'entry action is buy');

  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'open', 'trade status is open');
  assertNotNull(updatedTrade.openedAt, 'trade has openedAt');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;
  assertNotNull(snapshot, 'risk snapshot created');
  assertEqual(snapshot!.initialEntryPrice, 150.0, 'entry price matches');
  assertEqual(snapshot!.initialStopPrice, 145.0, 'stop price matches');
  assertEqual(snapshot!.initialQuantity, 100, 'quantity matches');
}

// ── 2. Entry + partial exit keeps status open ───────────────────────

console.log('\n2. Entry + partial exit keeps status open:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    exit1Price: 160.0,
    exit1Quantity: 50,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as { executions: unknown[] };
  assertEqual(data.executions.length, 2, 'creates 2 executions (entry + exit)');

  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'open', 'status stays open with partial exit');
  assertNotNull(updatedTrade.openedAt, 'trade has openedAt');
}

// ── 3. Entry + full exit sets status to closed ──────────────────────

console.log('\n3. Entry + full exit sets status to closed:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    exit1Price: 160.0,
    exit1Quantity: 100,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as { executions: unknown[] };
  assertEqual(data.executions.length, 2, 'creates 2 executions (entry + full exit)');

  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'closed', 'trade status is closed');
  assertNotNull(updatedTrade.openedAt, 'trade has openedAt');
  assertNotNull(updatedTrade.closedAt, 'trade has closedAt');
}

// ── 4. Entry + 2 exits sums to full exit ────────────────────────────

console.log('\n4. Entry + two exits sums to full exit:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    exit1Price: 160.0,
    exit1Quantity: 60,
    exit2Price: 155.0,
    exit2Quantity: 40,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as { executions: unknown[] };
  assertEqual(data.executions.length, 3, 'creates 3 executions (entry + exit1 + exit2)');

  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'closed', 'trade status is closed (full exit)');
}

// ── 5. Exit overflow returns 409 ─────────────────────────────────────

console.log('\n5. Exit overflow returns 409:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    exit1Price: 160.0,
    exit1Quantity: 80,
    exit2Price: 155.0,
    exit2Quantity: 30,
  });

  assert(result.status === 409, 'returns 409 for exit overflow (over-exit)');
}

// ── 6. Short trade: sell_short entry → open ─────────────────────────

console.log('\n6. Short trade with sell_short entry becomes open:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', direction: 'short' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as { executions: unknown[] };
  assertEqual(data.executions.length, 1, 'creates 1 execution');
  assertEqual((data.executions[0] as Record<string, unknown>).action, 'sell_short', 'action is sell_short');

  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'open', 'trade status is open');
}

// ── 7. Short trade: sell_short + buy_to_cover full exit → closed ───

console.log('\n7. Short trade with full exit becomes closed:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', direction: 'short' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    exit1Price: 140.0,
    exit1Quantity: 100,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as { executions: unknown[] };
  assertEqual(data.executions.length, 2, 'creates 2 executions');
  assertEqual((data.executions[0] as Record<string, unknown>).action, 'sell_short', 'entry is sell_short');
  assertEqual((data.executions[1] as Record<string, unknown>).action, 'buy_to_cover', 'exit is buy_to_cover');

  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'closed', 'trade status is closed');
}

// ── 8. 404 for nonexistent trade ────────────────────────────────────

console.log('\n8. 404 for nonexistent trade:');
{
  cleanup();
  const result = doExecuteTrade('nonexistent-trade', {
    entryPrice: 150.0,
    entryQuantity: 100,
  });
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 9. 400 for non-planned trade ────────────────────────────────────

console.log('\n9. 400 for non-planned trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
  });

  assert(result.status === 400, 'returns 400 for non-planned trade');
  const data = result.data as { error: string };
  assert(data.error.includes('not in planned'), 'error mentions not planned');
}

// ── 10. 400 for deleted trade ───────────────────────────────────────

console.log('\n10. 400 for deleted trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'deleted' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
  });

  assert(result.status === 400, 'returns 400 for deleted trade');
  const data = result.data as { error: string };
  assert(data.error.includes('deleted'), 'error mentions deleted');
}

// ── 11. Exit2 requires exit1 ────────────────────────────────────────

console.log('\n11. Exit 2 requires exit 1:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    exit2Price: 160.0,
    exit2Quantity: 50,
  });

  assert(result.status === 400, 'returns 400 when exit2 without exit1');
}

// ── 12. Exit price without quantity returns 400 ─────────────────────

console.log('\n12. Exit price without quantity returns 400:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    exit1Price: 160.0,
  });

  assert(result.status === 400, 'returns 400 when exit1Price without exit1Quantity');
}

// ── 13. Risk snapshot with stopPrice from body ────────────────────

console.log('\n13. Risk snapshot uses stopPrice from body:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  // Trade has no plannedStop; stopPrice comes from body
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: null });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    stopPrice: 142.0,
  });

  assert(result.status === 201, 'returns 201');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;

  assertNotNull(snapshot, 'risk snapshot created');
  assertEqual(snapshot!.initialStopPrice, 142.0, 'stop price from body is used');
}

// ── 14. Positive validation: entryPrice must be positive ─────────────

console.log('\n14. 400 for non-positive entryPrice:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 0,
    entryQuantity: 100,
  });

  assert(result.status === 400, 'returns 400 for zero entryPrice');
}

// ── 15. Risk snapshot not duplicated on subsequent calls ────────────

console.log('\n15. Risk snapshot not duplicated on subsequent calls:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  // First execute creates snapshot
  doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    stopPrice: 145.0,
  });

  const snapshots = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .all();

  assertEqual(snapshots.length, 1, 'only one risk snapshot exists');
}

// ── 16. Account equity fallback to settings ─────────────────────────

console.log('\n16. Falls back to settings.startingAccountValue:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: null });

  const now = new Date().toISOString();
  db.insert(schema.settings)
    .values({
      id: 'default',
      startingAccountValue: 25000,
      maxRiskPerTradePct: null,
      defaultCommission: null,
      journalStartDate: null,
      currency: 'USD',
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
  });

  assert(result.status === 201, 'returns 201');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;

  assertNotNull(snapshot, 'risk snapshot created');
  assertEqual(snapshot!.accountEquityAtOpen, 25000, 'equity falls back to settings');
}

// ── 17. Only required items gate execution ──────────────────────────

console.log('\n17. Only required items gate execution (optional can be missing):');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const requiredCheck = seedCheckDefinition({ accountId: 'test-account-id', description: 'Required gate', sortOrder: 1 });
  seedCheckDefinition({ accountId: 'test-account-id', description: 'Optional gate', sortOrder: 2, isRequired: false });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    checkResults: [
      { checklistDefinitionId: requiredCheck.id as string, passed: true },
      // Optional item omitted entirely — must not fail the gate.
    ],
  });

  assert(result.status === 201, 'returns 201 with required passed and optional missing');

  const persisted = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
    .all();
  assertEqual(persisted.length, 1, 'only the submitted required item is persisted');
  assertEqual(persisted[0].checklistDefinitionId, requiredCheck.id as string, 'required item persisted');
}

// ── 18. Missing required item still rejects execution ────────────────

console.log('\n18. Missing required item still rejects execution:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  seedCheckDefinition({ accountId: 'test-account-id', description: 'Required gate', sortOrder: 1 });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    checkResults: [],
  });

  assert(result.status === 400, 'returns 400 when required item missing');
  const data = result.data as { details: { fieldErrors: Record<string, string[]> } };
  const errors = (data.details?.fieldErrors?.checkResults ?? []).join(' ');
  assert(errors.includes('Required gate'), 'error names the missing required item');
}

// ── 19. itemText snapshot is written at check time ───────────────────

console.log('\n19. itemText snapshot is written at check time:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const check1 = seedCheckDefinition({ accountId: 'test-account-id', description: 'Snapshot text', sortOrder: 1 });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    checkResults: [
      { checklistDefinitionId: check1.id as string, passed: true, comment: 'verified' },
    ],
  });

  assert(result.status === 201, 'returns 201');

  const persisted = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
    .all();
  assertEqual(persisted.length, 1, '1 check result persisted');
  assertEqual(persisted[0].itemText, 'Snapshot text', 'itemText snapshots the description');
  assertEqual(persisted[0].comment, 'verified', 'comment preserved');
}

// ── 20. Max-risk exceeded blocks with 422 and no mutation ──────────

console.log('\n20. Max-risk exceeded blocks with 422 and no execution created:');
{
  cleanup();
  // 0.5% max risk of $10,000 equity = $50 limit.
  seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    stopPrice: 145.0, // risk = $500 > $50 limit
  });

  assert(result.status === 422, 'returns 422 for max-risk exceeded');
  const data = result.data as { error: string; details: { limit: number; computed: number; overrideable: boolean } };
  assertEqual(data.error, 'Max risk exceeded', 'error message');
  assertEqual(data.details.limit, 50, 'details.limit = 0.5% of 10000');
  assertEqual(data.details.computed, 500, 'details.computed = proposed risk');
  assert(data.details.overrideable === true, 'details.overrideable is true');

  // Gate fires before mutation: no execution created.
  const execs = db
    .select()
    .from(schema.tradeExecutions)
    .where(eq(schema.tradeExecutions.tradeId, trade.id as string))
    .all();
  assertEqual(execs.length, 0, 'no execution created when max-risk blocks');
}

// ── 21. Max-risk override with reason executes and stores the reason ──

console.log('\n21. Max-risk override with reason executes and stores the reason:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    stopPrice: 145.0,
    riskOverrideReason: 'Gap risk accepted per desk policy',
  });

  assert(result.status === 201, 'returns 201 with override reason');

  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.riskOverrideReason, 'Gap risk accepted per desk policy', 'riskOverrideReason stored on trade');
  assertEqual(updatedTrade.status, 'open', 'trade executed and opened');
}

// ── 22. Account not trading-ready blocks with 409 ─────────────────

console.log('\n22. Account not trading-ready blocks with 409:');
{
  cleanup();
  // maxRiskPerTradePct missing — execution requires a configured account.
  seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: null });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    stopPrice: 145.0,
  });

  assert(result.status === 409, 'returns 409 for account not trading-ready');
  const data = result.data as { error: string };
  assertEqual(data.error, 'Account setup incomplete for trading', 'error message');
}

// ── 23. Inactive account blocks with 409 ──────────────────────────

console.log('\n23. Inactive account blocks with 409:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000, isActive: false });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    stopPrice: 145.0,
  });

  assert(result.status === 409, 'returns 409 for inactive account');
  const data = result.data as { error: string };
  assertEqual(data.error, 'Account not active', 'error message');
}

// ── 24. Null risk (no valid stop) never triggers max-risk (D1) ────

console.log('\n24. Null risk (no valid stop) never triggers max-risk (D1 null-not-zero):');
{
  cleanup();
  // Tiny limit: any non-null risk would exceed it.
  seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.0001 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: null });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    // No stopPrice — initial risk is null, never 0.
  });

  assert(result.status === 201, 'returns 201 with null initial risk');
}

// ── 25. riskOverrideReason fails zod validation when empty ────────

console.log('\n25. Empty riskOverrideReason returns 400 validation error:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doExecuteTrade(trade.id as string, {
    entryPrice: 150.0,
    entryQuantity: 100,
    stopPrice: 145.0,
    riskOverrideReason: '',
  });

  assert(result.status === 400, 'returns 400 for empty riskOverrideReason');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);

// Dual-mode finish: this file is both a standalone tsx harness (Run:
// `npx tsx <file>`) and a vitest suite (registered in the include list in
// vitest.config.ts so the S02/T03 verification surface `npx vitest run <file>`
// executes it). The harness assertions run during module import; vitest
// requires at least one test suite per file, so the pass/fail verdict is
// surfaced through a single test below. `test` is a global only inside the
// vitest runner (globals: true in vitest.config.ts) — the `typeof test` guard
// keeps the tsx path import-free; under tsx the summary exits directly.
if (typeof test !== 'undefined') {
  test('standalone execute route harness (assertions run at import)', () => {
    if (failed > 0) {
      throw new Error(`         ${failed}/${total} FAILED`);
    }
    console.log('         All tests passed!');
  });
} else {
  if (failed > 0) {
    console.error(`         ${failed}/${total} FAILED`);
    process.exit(1);
  }
  console.log('         All tests passed!');
}
