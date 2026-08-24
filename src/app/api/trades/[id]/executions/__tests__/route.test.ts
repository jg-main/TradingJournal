/**
 * trade executions route test
 *
 * Tests GET (list by tradeId) and POST (create with validation and status recalculation).
 *
 * Run: npx tsx src/app/api/trades/[id]/executions/__tests__/route.test.ts
 *      (also registered in vitest.config.ts include; run via
 *       `npx vitest run src/app/api/trades/[id]/executions/__tests__/route.test.ts`)
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

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('executions');
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
    direction TEXT NOT NULL,
    sector_id TEXT,
    setup_id TEXT,
    market_condition_id TEXT,
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
    status = 'partially_closed';
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

  return { status, openedAt, closedAt };
}

// ── Simulated route logic ───────────────────────────────────────────

const DIRECTION_ACTIONS: Record<string, string[]> = {
  long: ['buy', 'add', 'sell', 'reduce'],
  short: ['sell_short', 'buy_to_cover'],
};

function doGetExecutions(tradeId: string): { status: number; data: unknown } {
  try {
    const trade = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get();

    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    const executions = db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, tradeId))
      .orderBy(schema.tradeExecutions.executedAt, schema.tradeExecutions.createdAt)
      .all();

    return { status: 200, data: executions };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to fetch executions', details: String(error) } };
  }
}

function doPostExecution(tradeId: string, body: Record<string, unknown>): { status: number; data: unknown } {
  try {
    // Zod-compatible validation
    const action = body.action;
    if (!['buy', 'sell', 'buy_to_cover', 'sell_short', 'add', 'reduce'].includes(action as string)) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { action: ['Invalid action'] } } } };
    }

    const quantity = body.quantity;
    if (typeof quantity !== 'number' || quantity <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { quantity: ['Quantity must be positive'] } } } };
    }

    const price = body.price;
    if (typeof price !== 'number' || price <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { price: ['Price must be positive'] } } } };
    }

    const fees = (body.fees as number) ?? 0;
    if (typeof fees !== 'number' || fees < 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { fees: ['Fees must be >= 0'] } } } };
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

    const trade = db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, tradeId))
      .get();

    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }

    const tradeRec = trade as Record<string, unknown>;

    if (tradeRec.status === 'scratched') {
      return { status: 400, data: { error: 'Cannot add executions to a scratched trade' } };
    }

    if (!DIRECTION_ACTIONS[tradeRec.direction as string]?.includes(action as string)) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              action: [
                `Action "${action}" is not valid for a ${tradeRec.direction} trade. ` +
                `Valid actions: ${DIRECTION_ACTIONS[tradeRec.direction as string].join(', ')}`,
              ],
            },
          },
        },
      };
    }

    // ── Checklist gate: first fill only (D3 + F8) ──────────────────
    //
    // When the trade is still 'planned' this is the first fill: enforce the
    // required items of the merged active checklist (account + resolved setup)
    // before any mutation. Subsequent fills (status already 'open'/'closed')
    // do NOT re-enforce the gate. Submitted results are persisted with an
    // item-text snapshot (F7).
    const checkResults = (body.checkResults as CheckResultInput[] | undefined) ?? [];
    const itemTextById = new Map<string, string>();

    // Shared execution timestamp + hoisted execution context (T04): the
    // equity/account reads are computed once in the first-fill gate and reused
    // by the risk-snapshot section below.
    const now = new Date().toISOString();
    const execTimestamp = (body.executedAt as string) ?? now;
    let riskOverrideReasonToStore: string | null = null;
    let equityContext: ReturnType<typeof computeExecutionContext> | undefined;

    if (tradeRec.status === 'planned') {
      // Resolve setup definition ID from the trade's setup lookup value
      let setupDefId: string | undefined;
      if (tradeRec.setupId) {
        const lookupVal = db
          .select()
          .from(schema.lookupValues)
          .where(eq(schema.lookupValues.id, tradeRec.setupId as string))
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

      const mergedChecks = db
        .select()
        .from(schema.checklistDefinitions)
        .where(
          and(
            or(
              eq(schema.checklistDefinitions.accountId, tradeRec.accountId as string),
              ...(setupDefId ? [eq(schema.checklistDefinitions.setupId, setupDefId)] : []),
            ),
            isNull(schema.checklistDefinitions.deletedAt),
          ),
        )
        .orderBy(asc(schema.checklistDefinitions.sortOrder), asc(schema.checklistDefinitions.createdAt))
        .all() as Array<Record<string, unknown>>;

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

      // ── Execution readiness gate (T04): first fill only ─────────────
      // Initial risk comes from the entry price and the planned stop (P2 has
      // no per-fill stopPrice; the risk snapshot uses trade.plannedStop).
      const initialRiskAmount =
        tradeRec.plannedStop != null
          ? Math.abs((price as number) - (tradeRec.plannedStop as number)) * (quantity as number)
          : null;

      equityContext = computeExecutionContext(
        db,
        (tradeRec.accountId as string | null) ?? null,
        execTimestamp,
      );

      const riskOverrideReason = (body.riskOverrideReason as string | undefined) ?? null;

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
        tradeStatus: tradeRec.status as string,
        initialRiskAmount,
        equityAtOpen: equityContext.equityAtOpen,
        hasOpeningCash: equityContext.hasOpeningCash,
        // Required items were enforced by the checklist gate above.
        requiredChecklistPassed: true,
      });

      const nonMaxRiskFailure = readiness.failures.find(
        (f) => f.code !== 'max-risk-exceeded',
      );
      if (nonMaxRiskFailure) {
        const status =
          nonMaxRiskFailure.code === 'account-not-active' ||
          nonMaxRiskFailure.code === 'account-not-trading-ready'
            ? 409
            : 400;
        return { status, data: { error: nonMaxRiskFailure.message } };
      }

      const maxRiskFailure = readiness.failures.find(
        (f) => f.code === 'max-risk-exceeded',
      );
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
      if (maxRiskFailure && riskOverrideReason) {
        riskOverrideReasonToStore = riskOverrideReason;
      }
    }

    const executionId = randomUUID();

    db.insert(schema.tradeExecutions)
      .values({
        id: executionId,
        tradeId,
        action: action as 'buy' | 'sell' | 'buy_to_cover' | 'sell_short' | 'add' | 'reduce',
        quantity: quantity as number,
        price: price as number,
        fees,
        executedAt: execTimestamp,
        reasonId: (body.reasonId as string) ?? null,
        notes: (body.notes as string) ?? null,
        createdAt: now,
      })
      .run();

    // ── Persist first-fill check results (item-text snapshot) ───────
    if (tradeRec.status === 'planned' && checkResults.length > 0) {
      for (const cr of checkResults) {
        db.insert(schema.tradeCheckResults)
          .values({
            id: randomUUID(),
            tradeId,
            checklistDefinitionId: cr.checklistDefinitionId,
            itemText: itemTextById.get(cr.checklistDefinitionId) ?? null,
            passed: cr.passed,
            comment: cr.comment ?? null,
            checkedAt: now,
            createdAt: now,
          })
          .run();
      }
    }

    // ── Recalculate trade status ────────────────────────────────

    const allExecutions = db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.tradeId, tradeId))
      .orderBy(schema.tradeExecutions.executedAt, schema.tradeExecutions.createdAt)
      .all();

    const execData = allExecutions.map((r) => ({
      action: r.action,
      quantity: r.quantity,
      executedAt: r.executedAt ?? r.createdAt ?? '',
    }));

    const derived = simulateDeriveStatus(
      execData.map((e) => ({ ...e, price: 0 })),
      tradeRec.direction as Direction,
    );

    db.update(schema.trades)
      .set({
        status: derived.status as 'open' | 'planned' | 'closed' | 'deleted',
        openedAt: derived.openedAt,
        closedAt: derived.closedAt,
        updatedAt: now,
        ...(riskOverrideReasonToStore ? { riskOverrideReason: riskOverrideReasonToStore } : {}),
      })
      .where(eq(schema.trades.id, tradeId))
      .run();

    // ── Upsert risk snapshot on first entry ──────────────────────

    if (derived.status !== 'planned') {
      const entryExecs = allExecutions.filter((e) =>
        (tradeRec.direction as string) === 'long'
          ? e.action === 'buy' || e.action === 'add'
          : e.action === 'sell_short',
      );

      if (entryExecs.length > 0) {
        const totalEntryQty = entryExecs.reduce((s, e) => s + e.quantity, 0);
        const weightedSum = entryExecs.reduce((s, e) => s + e.price * e.quantity, 0);
        const avgEntryPrice = weightedSum / totalEntryQty;

        const existingSnapshot = db
          .select()
          .from(schema.tradeRiskSnapshots)
          .where(eq(schema.tradeRiskSnapshots.tradeId, tradeId))
          .get();

        if (!existingSnapshot) {
          const snapshotValues: Record<string, unknown> = {
            id: randomUUID(),
            tradeId,
            initialEntryPrice: avgEntryPrice,
            initialQuantity: totalEntryQty,
            createdAt: now,
          };

          if (tradeRec.plannedStop != null) {
            snapshotValues.initialStopPrice = tradeRec.plannedStop;
          }

          // Equity context is hoisted from the readiness gate (T04) — the
          // same reads the inline derivation below used to perform.
          if (equityContext?.equityAtOpen != null) {
            snapshotValues.accountEquityAtOpen = equityContext.equityAtOpen;
          }

          db.insert(schema.tradeRiskSnapshots)
            .values(snapshotValues as typeof schema.tradeRiskSnapshots.$inferInsert)
            .run();
        }
      }
    }

    const created = db
      .select()
      .from(schema.tradeExecutions)
      .where(eq(schema.tradeExecutions.id, executionId))
      .get();

    return { status: 201, data: created };
  } catch (error) {
    return { status: 500, data: { error: 'Failed to create execution', details: String(error) } };
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
      startingBalance: 10000,
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

function seedExecution(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.tradeExecutions)
    .values({
      id,
      tradeId: overrides.tradeId as string,
      action: 'buy',
      quantity: 100,
      price: 150.0,
      fees: 0,
      executedAt: now,
      createdAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.tradeExecutions).where(eq(schema.tradeExecutions.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Trade Executions API Tests ---\n');

// ── 1. GET: Returns empty list for trade with no executions ─────────

console.log('\n1. GET returns empty list for trade with no executions:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doGetExecutions(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as unknown[];
  assert(Array.isArray(data), 'response is an array');
  assertEqual(data.length, 0, 'array is empty');
}

// ── 2. GET: 404 for nonexistent trade ───────────────────────────────

console.log('\n2. GET returns 404 for nonexistent trade:');
{
  cleanup();
  const result = doGetExecutions('nonexistent-trade');
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 3. GET: Returns executions ordered by executedAt ────────────────

console.log('\n3. GET returns executions ordered by executedAt:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

  const exec1 = seedExecution({ tradeId: trade.id, action: 'buy', quantity: 50, price: 148.0, executedAt: '2025-06-01T10:00:00Z' });
  const exec2 = seedExecution({ tradeId: trade.id, action: 'add', quantity: 50, price: 150.0, executedAt: '2025-06-01T11:00:00Z' });

  const result = doGetExecutions(trade.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>[];
  assertEqual(data.length, 2, 'returns 2 executions');
  assertEqual(data[0].id, exec1.id, 'first execution is the earliest');
  assertEqual(data[1].id, exec2.id, 'second execution is the later one');
  assertEqual(data[0].action, 'buy', 'first action is buy');
  assertEqual(data[1].action, 'add', 'second action is add');
}

// ── 4. POST: Creates execution with valid data ──────────────────────

console.log('\n4. POST creates execution with valid data:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
    fees: 5.0,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.action, 'buy', 'action matches');
  assertEqual(data.quantity, 100, 'quantity matches');
  assertEqual(data.price, 150.0, 'price matches');
  assertEqual(data.fees, 5.0, 'fees matches');
  assertEqual(data.tradeId, trade.id, 'tradeId matches');

  // Verify trade status updated to 'open'
  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'open', 'trade status updated to open');
  assertNotNull(updatedTrade.openedAt, 'trade has openedAt');
}

// ── 5. POST: Validates action enum ──────────────────────────────────

console.log('\n5. POST returns 400 for invalid action:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostExecution(trade.id as string, {
    action: 'invalid',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400');
}

// ── 6. POST: Validates positive quantity ────────────────────────────

console.log('\n6. POST returns 400 for non-positive quantity:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: -10,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400 for negative quantity');

  const result2 = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 0,
    price: 150.0,
  });

  assert(result2.status === 400, 'returns 400 for zero quantity');
}

// ── 7. POST: Validates positive price ───────────────────────────────

console.log('\n7. POST returns 400 for non-positive price:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 0,
  });

  assert(result.status === 400, 'returns 400 for zero price');
}

// ── 8. POST: Validates fees >= 0 ────────────────────────────────────

console.log('\n8. POST returns 400 for negative fees:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
    fees: -1,
  });

  assert(result.status === 400, 'returns 400 for negative fees');
}

// ── 9. POST: 404 for nonexistent trade ──────────────────────────────

console.log('\n9. POST returns 404 for nonexistent trade:');
{
  cleanup();
  const result = doPostExecution('nonexistent-trade', {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });
  assert(result.status === 404, 'returns 404');
  assertEqual((result.data as { error: string }).error, 'Trade not found', 'error message');
}

// ── 10. POST: Recalculates status from planned to closed on full exit ─

console.log('\n10. POST recalculates status from open to closed on full exit:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  // First entry
  doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  // Full exit
  const result = doPostExecution(trade.id as string, {
    action: 'sell',
    quantity: 100,
    price: 160.0,
  });

  assert(result.status === 201, 'returns 201');
  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'closed', 'trade status is closed');
  assertNotNull(updatedTrade.closedAt, 'trade has closedAt');
  assertNotNull(updatedTrade.openedAt, 'trade has openedAt');
}

// ── 11. POST: Returns 400 for scratched trade ───────────────────────

console.log('\n11. POST returns 400 for scratched trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'scratched' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400');
  const data = result.data as { error: string };
  assert(data.error.includes('scratched'), 'error mentions scratched');
}

// ── 12. POST: Successfully adds execution to a closed trade ───────────

console.log('\n12. POST successfully adds execution to a closed trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'closed' });

  // Seed executions to make it properly closed (buy 100, then sell 100)
  seedExecution({ tradeId: trade.id, action: 'buy', quantity: 100, price: 150.0, executedAt: '2025-06-01T10:00:00Z' });
  seedExecution({ tradeId: trade.id, action: 'sell', quantity: 100, price: 160.0, executedAt: '2025-06-01T11:00:00Z' });

  // Now add an additional exit execution on the closed trade
  const result = doPostExecution(trade.id as string, {
    action: 'sell',
    quantity: 100,
    price: 162.0,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.action, 'sell', 'action matches');
  assertEqual(data.quantity, 100, 'quantity matches');
  assertEqual(data.price, 162.0, 'price matches');

  // Trade status should remain closed
  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'closed', 'trade status remains closed');
}

// ── 13. POST: Validates action-direction compatibility for long trade ──

console.log('\n13. POST validates action-direction compatibility for long trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', direction: 'long' });

  const result = doPostExecution(trade.id as string, {
    action: 'sell_short',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400 for incompatible action');
  const data = result.data as { details: { fieldErrors: Record<string, string[]> } };
  assertNotNull(data.details, 'has details');
  assertNotNull(data.details.fieldErrors?.action, 'has action field error');
}

// ── 14. POST: Validates action-direction compatibility for short trade ─

console.log('\n14. POST validates action-direction compatibility for short trade:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', direction: 'short' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400 for incompatible action');
}

// ── 15. POST: Creates risk snapshot on first entry with plannedStop ───

console.log('\n15. POST creates risk snapshot on first entry when plannedStop is set:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 201, 'returns 201');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;

  assertNotNull(snapshot, 'risk snapshot was created');
  assertEqual(snapshot!.initialEntryPrice, 150.0, 'initialEntryPrice matches buy price');
  assertEqual(snapshot!.initialQuantity, 100, 'initialQuantity matches');
  assertEqual(snapshot!.initialStopPrice, 145.0, 'initialStopPrice matches plannedStop');
}

// ── 16. POST: Creates risk snapshot on first entry without plannedStop ─

console.log('\n16. POST creates risk snapshot without initialStopPrice when plannedStop is null:');
{
  cleanup();
  seedAccount({ id: 'test-account-id' });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: null });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 201, 'returns 201');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;

  assertNotNull(snapshot, 'risk snapshot was created');
  assertEqual(snapshot!.initialEntryPrice, 150.0, 'initialEntryPrice matches');
  assertEqual(snapshot!.initialStopPrice, null, 'initialStopPrice is null');
}

// ── 17. POST: Populates accountEquityAtOpen from account.startingBalance ─

console.log('\n17. POST populates accountEquityAtOpen from account.startingBalance:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 201, 'returns 201');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;

  assertNotNull(snapshot, 'risk snapshot was created');
  assertEqual(snapshot!.accountEquityAtOpen, 10000, 'accountEquityAtOpen matches startingBalance');
}

// ── 18. POST: accountEquityAtOpen includes deposit contributions ───────

console.log('\n18. POST accountEquityAtOpen includes deposit contributions:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 5000 });

  const now = new Date().toISOString();
  db.insert(schema.accountTransactions)
    .values({
      id: randomUUID(),
      accountId: 'test-account-id',
      type: 'deposit',
      amount: 3000,
      balanceAfter: 8000,
      date: now,
      notes: null,
      createdAt: now,
    })
    .run();

  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 201, 'returns 201');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;

  assertNotNull(snapshot, 'risk snapshot was created');
  assertEqual(snapshot!.accountEquityAtOpen, 8000, 'equity = startingBalance + deposit (5000 + 3000)');
}

// ── 19. POST: accountEquityAtOpen subtracts withdrawals ────────────────

console.log('\n19. POST accountEquityAtOpen subtracts withdrawals:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 5000 });

  const now = new Date().toISOString();
  db.insert(schema.accountTransactions)
    .values({
      id: randomUUID(),
      accountId: 'test-account-id',
      type: 'withdrawal',
      amount: 2000,
      balanceAfter: 3000,
      date: now,
      notes: null,
      createdAt: now,
    })
    .run();

  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 201, 'returns 201');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;

  assertNotNull(snapshot, 'risk snapshot was created');
  assertEqual(snapshot!.accountEquityAtOpen, 3000, 'equity = startingBalance - withdrawal (5000 - 2000)');
}

// ── 20. POST: Falls back to settings.startingAccountValue when no account data ─

console.log('\n20. POST falls back to settings.startingAccountValue:');
{
  cleanup();
  // Create a trade with no account (accountId is set to an unlinked UUID so
  // the lookup finds no account row — the test seedTrade always sets
  // accountId = 'test-account-id', so we need an account with null startingBalance)
  seedAccount({ id: 'test-account-id', startingBalance: null });

  // Insert a settings row with startingAccountValue
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

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 201, 'returns 201');

  const snapshot = db
    .select()
    .from(schema.tradeRiskSnapshots)
    .where(eq(schema.tradeRiskSnapshots.tradeId, trade.id as string))
    .get() as Record<string, unknown> | undefined;

  assertNotNull(snapshot, 'risk snapshot was created');
  assertEqual(snapshot!.accountEquityAtOpen, 25000, 'equity falls back to settings.startingAccountValue');
}

// ── 21. POST: Blocks execution when the account has no cash/equity ──

console.log('\n21. POST blocks execution when the account has no cash (equity unavailable):');
{
  cleanup();
  // No settings row, account has no startingBalance → equity null → no opening
  // cash → the T04 readiness gate rejects before any mutation.
  seedAccount({ id: 'test-account-id', startingBalance: null });

  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 409, 'returns 409 when the account has no cash');
  const data = result.data as { error: string };
  assertEqual(data.error, 'Account setup incomplete for trading', 'error names the readiness failure');

  const execs = db
    .select()
    .from(schema.tradeExecutions)
    .where(eq(schema.tradeExecutions.tradeId, trade.id as string))
    .all();
  assertEqual(execs.length, 0, 'no execution created when readiness rejects');
}

// ── 22. First fill enforces required checklist items ─────────────────

console.log('\n22. First fill enforces required checklist items:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  seedCheckDefinition({ accountId: 'test-account-id', description: 'Required pre-trade check', sortOrder: 1 });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 400, 'returns 400 when required checklist item missing on first fill');
  const data = result.data as { details: { fieldErrors: Record<string, string[]> } };
  const errors = (data.details?.fieldErrors?.checkResults ?? []).join(' ');
  assert(errors.includes('Required pre-trade check'), 'error names the missing required item');

  // Gate fires before mutation: no execution created.
  const execs = db
    .select()
    .from(schema.tradeExecutions)
    .where(eq(schema.tradeExecutions.tradeId, trade.id as string))
    .all();
  assertEqual(execs.length, 0, 'no execution created when the gate rejects');
}

// ── 23. First fill passes with required submitted; optional omitted ──

console.log('\n23. First fill passes with required items submitted (optional omitted) and persists itemText:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned' });

  const check1 = seedCheckDefinition({ accountId: 'test-account-id', description: 'Required check A', sortOrder: 1 });
  seedCheckDefinition({ accountId: 'test-account-id', description: 'Optional check B', sortOrder: 2, isRequired: false });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
    checkResults: [
      { checklistDefinitionId: check1.id as string, passed: true },
      // Optional check B omitted — must not gate.
    ],
  });

  assert(result.status === 201, 'returns 201');
  const persisted = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
    .all();
  assertEqual(persisted.length, 1, '1 check result persisted');
  assertEqual(persisted[0].checklistDefinitionId, check1.id as string, 'required item persisted');
  assertEqual(persisted[0].itemText, 'Required check A', 'itemText snapshots the description');
}

// ── 24. Subsequent fills skip the checklist gate ─────────────────────

console.log('\n24. Subsequent fills skip the checklist gate:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'open' });

  // Trade already open with a required checklist defined — an add/reduce fill
  // must NOT re-enforce the gate (F8 fixed without breaking post-open fills).
  seedCheckDefinition({ accountId: 'test-account-id', description: 'Required check', sortOrder: 1 });
  seedExecution({ tradeId: trade.id, action: 'buy', quantity: 100, price: 150.0 });

  const result = doPostExecution(trade.id as string, {
    action: 'add',
    quantity: 50,
    price: 152.0,
  });

  assert(result.status === 201, 'returns 201 on subsequent fill with no checkResults');
  const persisted = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, trade.id as string))
    .all();
  assertEqual(persisted.length, 0, 'no check results persisted on subsequent fill');
}

// ── 25. Max-risk exceeded blocks the first fill with 422 ──────────

console.log('\n25. Max-risk exceeded blocks the first fill with 422 and no mutation:');
{
  cleanup();
  // 0.5% max risk of $10,000 equity = $50 limit.
  seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0, // risk = $500 > $50 limit
  });

  assert(result.status === 422, 'returns 422 for max-risk exceeded');
  const data = result.data as { error: string; details: { limit: number; computed: number; overrideable: boolean } };
  assertEqual(data.error, 'Max risk exceeded', 'error message');
  assertEqual(data.details.limit, 50, 'details.limit = 0.5% of 10000');
  assertEqual(data.details.computed, 500, 'details.computed = proposed risk');
  assert(data.details.overrideable === true, 'details.overrideable is true');

  const execs = db
    .select()
    .from(schema.tradeExecutions)
    .where(eq(schema.tradeExecutions.tradeId, trade.id as string))
    .all();
  assertEqual(execs.length, 0, 'no execution created when max-risk blocks');
}

// ── 26. Max-risk override executes and stores the reason ───────────

console.log('\n26. Max-risk override with reason executes and stores the reason:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
    riskOverrideReason: 'Gap risk accepted per desk policy',
  });

  assert(result.status === 201, 'returns 201 with override reason');
  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.riskOverrideReason, 'Gap risk accepted per desk policy', 'riskOverrideReason stored on trade');
  assertEqual(updatedTrade.status, 'open', 'trade opened');
}

// ── 27. Subsequent fills skip the readiness/max-risk gate ─────────

console.log('\n27. Subsequent fills skip the readiness gate (no max-risk re-check):');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'open', plannedStop: 145.0 });
  seedExecution({ tradeId: trade.id, action: 'buy', quantity: 100, price: 150.0 });

  // This fill's risk ($500) exceeds the $50 limit, but the trade is already
  // open — the gate (first fill only) must NOT re-enforce max-risk.
  const result = doPostExecution(trade.id as string, {
    action: 'add',
    quantity: 100,
    price: 150.0,
    riskOverrideReason: 'ignored on subsequent fills',
  });

  assert(result.status === 201, 'returns 201 on subsequent fill despite risk');
  const updatedTrade = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id as string)).get() as Record<string, unknown>;
  assertEqual(updatedTrade.riskOverrideReason, null, 'override reason not stored on subsequent fills');
}

// ── 28. Account not trading-ready blocks the first fill with 409 ──

console.log('\n28. Account not trading-ready blocks the first fill with 409:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: null });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
  });

  assert(result.status === 409, 'returns 409 for account not trading-ready');
  const data = result.data as { error: string };
  assertEqual(data.error, 'Account setup incomplete for trading', 'error message');
}

// ── 29. Empty riskOverrideReason fails zod validation ─────────────

console.log('\n29. Empty riskOverrideReason returns 400 validation error:');
{
  cleanup();
  seedAccount({ id: 'test-account-id', startingBalance: 10000, maxRiskPerTradePct: 0.5 });
  const trade = seedTrade({ accountId: 'test-account-id', status: 'planned', plannedStop: 145.0 });

  const result = doPostExecution(trade.id as string, {
    action: 'buy',
    quantity: 100,
    price: 150.0,
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
  test('standalone executions route harness (assertions run at import)', () => {
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
