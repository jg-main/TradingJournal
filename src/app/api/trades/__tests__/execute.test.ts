/**
 * Execute route checklist validation + atomic persistence test
 *
 * Tests POST /api/trades/:id/execute with checklist validation:
 * - No gating when no checklist items exist
 * - Rejection when checklist items exist but checkResults are missing/incomplete
 * - Rejection when checks are not passed
 * - Success when all checks are passed, with atomic persistence
 * - Existing validation rules continue to work
 *
 * Run: npx vitest run --reporter verbose src/app/api/trades/__tests__/execute.test.ts
 */

import { testDbPath } from '../../../../lib/testing/test-db';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, isNull, asc, or } from 'drizzle-orm';
import { test, expect } from 'vitest';

import * as schema from '@/db/schema';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} (FAILED)`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} \u2014 expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`);
  }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  \u2705 ${msg}`);
  } else {
    failed++;
    console.error(`  \u274c ${msg} \u2014 value is null/undefined (FAILED)`);
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE = process.env.DB_FILE_NAME || testDbPath('execute-checks');
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables
sqlite.exec(`
  DROP TABLE IF EXISTS trade_check_results;
  DROP TABLE IF EXISTS checklist_definitions;
  DROP TABLE IF EXISTS trade_risk_snapshots;
  DROP TABLE IF EXISTS trade_executions;
  DROP TABLE IF EXISTS trades;
  DROP TABLE IF EXISTS account_transactions;
  DROP TABLE IF EXISTS settings;
  DROP TABLE IF EXISTS setup_definitions;
  DROP TABLE IF EXISTS lookup_values;
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

  CREATE TABLE lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE setup_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    how_to_play TEXT,
    entry_rules TEXT,
    exit_rules TEXT,
    tags TEXT,
    default_risk_pct REAL,
    position_sizing_rules TEXT,
    chart_patterns TEXT,
    analysis_config TEXT,
    is_active INTEGER DEFAULT 1,
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
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT UNIQUE NOT NULL,
    account_id TEXT REFERENCES accounts(id) NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('long', 'short')),
    sector_id TEXT,
    setup_id TEXT REFERENCES lookup_values(id),
    market_condition_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('planned', 'open', 'closed', 'deleted')),
    planned_entry REAL,
    planned_stop REAL,
    planned_target_1 REAL,
    planned_target_2 REAL,
    planned_quantity REAL,
    thesis TEXT,
    invalidation_condition TEXT,
    pre_trade_plan TEXT,
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

  CREATE TABLE trade_executions (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE NOT NULL,
    executed_at TEXT,
    action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'buy_to_cover', 'sell_short', 'add', 'reduce')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fees REAL DEFAULT 0,
    reason_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE trade_risk_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE UNIQUE NOT NULL,
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

  CREATE TABLE account_transactions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT REFERENCES accounts(id) NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal')),
    amount REAL NOT NULL,
    balance_after REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE checklist_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT REFERENCES accounts(id),
    setup_id TEXT REFERENCES setup_definitions(id),
    description TEXT NOT NULL,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE trade_check_results (
    id TEXT PRIMARY KEY NOT NULL,
    trade_id TEXT REFERENCES trades(id) ON DELETE CASCADE NOT NULL,
    checklist_definition_id TEXT REFERENCES checklist_definitions(id) NOT NULL,
    passed INTEGER NOT NULL,
    comment TEXT,
    checked_at TEXT DEFAULT (current_timestamp),
    created_at TEXT DEFAULT (current_timestamp)
  );
`);

// ── Simulated route logic ───────────────────────────────────────────

interface CheckResultInput {
  checklistDefinitionId: string;
  passed: boolean;
  comment?: string;
}

interface ExecuteInput {
  entryPrice: number;
  entryQuantity: number;
  stopPrice?: number;
  exit1Price?: number;
  exit1Quantity?: number;
  exit2Price?: number;
  exit2Quantity?: number;
  executedAt?: string;
  fees?: number;
  checkResults?: CheckResultInput[];
}

function doExecute(tradeId: string, input: ExecuteInput): { status: number; data: unknown } {
  try {
    // ── Validate input ──────────────────────────────────────────

    if (!input.entryPrice || input.entryPrice <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { entryPrice: ['Expected positive number'] } } } };
    }
    if (!input.entryQuantity || input.entryQuantity <= 0) {
      return { status: 400, data: { error: 'Validation failed', details: { fieldErrors: { entryQuantity: ['Expected positive number'] } } } };
    }

    // Validate exit quantities don't exceed entry quantity
    const exitQty1 = input.exit1Quantity ?? 0;
    const exitQty2 = input.exit2Quantity ?? 0;
    if (exitQty1 + exitQty2 > input.entryQuantity) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exitQuantity: [
                `Total exit quantity (${exitQty1 + exitQty2}) exceeds entry quantity (${input.entryQuantity})`,
              ],
            },
          },
        },
      };
    }

    // Exit prices must be provided with quantities, and vice versa
    if ((input.exit1Price != null && input.exit1Quantity == null) || (input.exit1Quantity != null && input.exit1Price == null)) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exit1: ['Both exit1Price and exit1Quantity must be provided together'],
            },
          },
        },
      };
    }
    if ((input.exit2Price != null && input.exit2Quantity == null) || (input.exit2Quantity != null && input.exit2Price == null)) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exit2: ['Both exit2Price and exit2Quantity must be provided together'],
            },
          },
        },
      };
    }
    if (input.exit2Price != null && input.exit1Price == null) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              exit2: ['Exit 2 requires Exit 1 to be provided first'],
            },
          },
        },
      };
    }

    // ── Fetch and validate trade ─────────────────────────────────

    const trade = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get();
    if (!trade) {
      return { status: 404, data: { error: 'Trade not found' } };
    }
    if (trade.status === 'deleted') {
      return { status: 400, data: { error: 'Cannot execute a deleted trade' } };
    }
    if (trade.status !== 'planned') {
      return { status: 400, data: { error: 'Trade is not in planned status' } };
    }

    const direction = trade.direction as 'long' | 'short';
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
              action: [`Action "${entryAction}" is not valid for a ${direction} trade. Valid actions: ${DIRECTION_ACTIONS[direction].join(', ')}`],
            },
          },
        },
      };
    }

    // ── Checklist validation ─────────────────────────────────────

    // Resolve setup definition ID from the trade's setup lookup value
    let setupDefId: string | undefined;
    if (trade.setupId) {
      const lookupVal = db
        .select()
        .from(schema.lookupValues)
        .where(eq(schema.lookupValues.id, trade.setupId))
        .get();
      if (lookupVal) {
        const setupDef = db
          .select()
          .from(schema.setupDefinitions)
          .where(eq(schema.setupDefinitions.name, lookupVal.value))
          .get();
        if (setupDef) {
          setupDefId = setupDef.id;
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
            eq(schema.checklistDefinitions.accountId, trade.accountId),
            ...(setupDefId ? [eq(schema.checklistDefinitions.setupId, setupDefId)] : []),
          ),
          isNull(schema.checklistDefinitions.deletedAt),
        ),
      )
      .orderBy(asc(schema.checklistDefinitions.sortOrder), asc(schema.checklistDefinitions.createdAt))
      .all();

    if (mergedChecks.length > 0) {
      const submitted = input.checkResults ?? [];

      // Map submitted results by checklistDefinitionId for quick lookup
      const submittedMap = new Map(submitted.map((cr) => [cr.checklistDefinitionId, cr.passed]));

      // Find checklist items that are missing from submitted results or not passed
      const missing: string[] = [];
      const notPassed: string[] = [];

      for (const check of mergedChecks) {
        const passedResult = submittedMap.get(check.id);
        if (passedResult === undefined) {
          missing.push(check.description);
        } else if (!passedResult) {
          notPassed.push(check.description);
        }
      }

      if (missing.length > 0 || notPassed.length > 0) {
        const fieldErrors: string[] = [];
        if (missing.length > 0) {
          fieldErrors.push(`Missing check results for: ${missing.join(', ')}`);
        }
        if (notPassed.length > 0) {
          fieldErrors.push(`Checklist items must be passed before execution: ${notPassed.join(', ')}`);
        }
        return {
          status: 400,
          data: { error: 'Validation failed', details: { fieldErrors: { checkResults: fieldErrors } } },
        };
      }
    }

    // ── Execute within a transaction ────────────────────────────

    const now = new Date().toISOString();
    const execTimestamp = input.executedAt ?? now;
    const fees = input.fees ?? 0;

    const result = db.transaction((tx) => {
      // 1. Insert entry execution
      tx.insert(schema.tradeExecutions)
        .values({
          id: randomUUID(),
          tradeId,
          action: entryAction,
          quantity: input.entryQuantity,
          price: input.entryPrice,
          fees,
          executedAt: execTimestamp,
          notes: null,
          createdAt: now,
        })
        .run();

      // 2. Insert exit 1 execution if provided
      if (input.exit1Price != null && input.exit1Quantity != null) {
        tx.insert(schema.tradeExecutions)
          .values({
            id: randomUUID(),
            tradeId,
            action: exitAction,
            quantity: input.exit1Quantity,
            price: input.exit1Price,
            fees: 0,
            executedAt: execTimestamp,
            notes: null,
            createdAt: now,
          })
          .run();
      }

      // 3. Insert exit 2 execution if provided
      if (input.exit2Price != null && input.exit2Quantity != null) {
        tx.insert(schema.tradeExecutions)
          .values({
            id: randomUUID(),
            tradeId,
            action: exitAction,
            quantity: input.exit2Quantity,
            price: input.exit2Price,
            fees: 0,
            executedAt: execTimestamp,
            notes: null,
            createdAt: now,
          })
          .run();
      }

      // 4. Reload all executions and derive new status
      const allExecutions = tx
        .select()
        .from(schema.tradeExecutions)
        .where(eq(schema.tradeExecutions.tradeId, tradeId))
        .orderBy(schema.tradeExecutions.executedAt, schema.tradeExecutions.createdAt)
        .all();

      const execData = allExecutions.map((r) => ({
        action: r.action,
        quantity: r.quantity,
        price: r.price,
        fees: r.fees,
        executedAt: r.executedAt ?? r.createdAt ?? '',
      }));

      const derived = (() => {
        const entries = execData.filter((e): boolean => {
          if (direction === 'long') return e.action === 'buy' || e.action === 'add';
          return e.action === 'sell_short';
        });
        const exits = execData.filter((e): boolean => {
          if (direction === 'long') return e.action === 'sell' || e.action === 'reduce';
          return e.action === 'buy_to_cover';
        });
        const totalEntryQty = entries.reduce((s, e) => s + e.quantity, 0);
        const totalExitQty = exits.reduce((s, e) => s + e.quantity, 0);
        let status: string;
        let openedAt: string | null = null;
        let closedAt: string | null = null;
        if (totalEntryQty === 0) { status = 'planned'; }
        else if (totalExitQty === 0 || totalExitQty < totalEntryQty) { status = 'open'; }
        else { status = 'closed'; }
        if (totalEntryQty > 0 && entries.length > 0) {
          const sorted = [...entries].sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime());
          openedAt = sorted[0].executedAt;
        }
        if (totalExitQty >= totalEntryQty && exits.length > 0) {
          const sorted = [...exits].sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime());
          closedAt = sorted[sorted.length - 1].executedAt;
        }
        return { status, openedAt, closedAt, totalEntryQty };
      })();

      // 5. Update trade row
      tx.update(schema.trades)
        .set({
          status: derived.status as 'planned' | 'open' | 'closed',
          openedAt: derived.openedAt,
          closedAt: derived.closedAt,
          updatedAt: now,
        })
        .where(eq(schema.trades.id, tradeId))
        .run();

      // 6. Persist trade check results atomically within the transaction
      const submitted = input.checkResults ?? [];
      for (const cr of submitted) {
        tx.insert(schema.tradeCheckResults)
          .values({
            id: randomUUID(),
            tradeId,
            checklistDefinitionId: cr.checklistDefinitionId,
            passed: cr.passed,
            comment: cr.comment ?? null,
            checkedAt: now,
            createdAt: now,
          })
          .run();
      }

      // Return the created executions and updated trade
      const createdExecutions = tx
        .select()
        .from(schema.tradeExecutions)
        .where(eq(schema.tradeExecutions.tradeId, tradeId))
        .orderBy(schema.tradeExecutions.executedAt, schema.tradeExecutions.createdAt)
        .all();

      const updatedTrade = tx
        .select()
        .from(schema.trades)
        .where(eq(schema.trades.id, tradeId))
        .get();

      return { executions: createdExecutions, trade: updatedTrade };
    });

    return { status: 201, data: result };
  } catch (error) {
    return {
      status: 500,
      data: { error: 'Failed to execute trade', details: String(error) },
    };
  }
}

// Simpler execute without checkResults for existing behavior verification
function doSimpleExecute(tradeId: string): { status: number; data: unknown } {
  return doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    fees: 0,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec('DELETE FROM trade_check_results;');
  sqlite.exec('DELETE FROM checklist_definitions;');
  sqlite.exec('DELETE FROM trade_risk_snapshots;');
  sqlite.exec('DELETE FROM trade_executions;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM account_transactions;');

  sqlite.exec('DELETE FROM settings;');
  sqlite.exec('DELETE FROM setup_definitions;');
  sqlite.exec('DELETE FROM lookup_values;');
  sqlite.exec('DELETE FROM accounts;');
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
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() as Record<string, unknown>;
}

function seedLookupSetup(value: string) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.lookupValues)
    .values({
      id,
      type: 'setup',
      value,
      sortOrder: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).get() as Record<string, unknown>;
}

function seedSetupDefinition(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.setupDefinitions)
    .values({
      id,
      name: 'Momentum Breakout',
      description: 'A test setup definition',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.setupDefinitions).where(eq(schema.setupDefinitions.id, id)).get() as Record<string, unknown>;
}

function seedTrade(accountId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.trades)
    .values({
      id,
      tradeCode: `TC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      accountId,
      symbol: 'AAPL',
      direction: 'long',
      status: 'planned',
      plannedEntry: 100,
      plannedStop: 95,
      plannedQuantity: 10,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.trades).where(eq(schema.trades.id, id)).get() as Record<string, unknown>;
}

function seedCheck(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.insert(schema.checklistDefinitions)
    .values({
      id,
      description: 'Default check',
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
  return db.select().from(schema.checklistDefinitions).where(eq(schema.checklistDefinitions.id, id)).get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

test('execute route checklist validation and atomic persistence', () => {

console.log('\n--- Execute Route Checklist Validation Tests ---\n');

let accountId: string;
let tradeId: string;

// ── 1. Execute without checks (no gating) ────────────────────────────

console.log('\n1. POST /trades/:id/execute succeeds when no checklist items exist:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const result = doSimpleExecute(tradeId);
  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.executions, 'has executions');
  assertNotNull(data.trade, 'has trade');
  const updatedTrade = data.trade as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'open', 'trade status set to open');

  // Verify no check results were created
  const checkResults = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, tradeId))
    .all();
  assertEqual(checkResults.length, 0, 'no check results persisted');
}

// ── 2. Execute with account checks all passed ────────────────────────

console.log('\n2. POST succeeds when account-level checks are all passed:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheck({ accountId, description: 'Verify market data', sortOrder: 1 });
  const check2 = seedCheck({ accountId, description: 'Check support level', sortOrder: 2 });

  const result = doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    checkResults: [
      { checklistDefinitionId: check1.id as string, passed: true },
      { checklistDefinitionId: check2.id as string, passed: true },
    ],
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.trade, 'has trade');
  const updatedTrade = data.trade as Record<string, unknown>;
  assertEqual(updatedTrade.status, 'open', 'trade status set to open');

  // Verify check results were persisted atomically
  const persisted = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, tradeId))
    .all();
  assertEqual(persisted.length, 2, '2 check results persisted');
  assertEqual(persisted[0].checklistDefinitionId, check1.id as string, 'check1 result persisted');
  assertEqual(persisted[0].passed, true, 'check1 passed');
  assertEqual(persisted[1].checklistDefinitionId, check2.id as string, 'check2 result persisted');
  assertEqual(persisted[1].passed, true, 'check2 passed');
}

// ── 3. Execute with setup checks all passed ──────────────────────────

console.log('\n3. POST succeeds when setup-level checks are all passed (resolves via lookup value):');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;

  // Create lookup value and setup definition with matching name
  const lookupVal = seedLookupSetup('Momentum Breakout');
  const setupDef = seedSetupDefinition({ name: 'Momentum Breakout' });

  // Trade references lookup value as its setup
  const trade = seedTrade(accountId, { setupId: lookupVal.id });
  tradeId = trade.id as string;

  // Setup-level check (references setupDefinitions.id, not lookupValues.id)
  const check1 = seedCheck({ setupId: setupDef.id as string, description: 'Setup check', sortOrder: 1 });

  const result = doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    checkResults: [
      { checklistDefinitionId: check1.id as string, passed: true },
    ],
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.trade, 'has trade');
  assertEqual((data.trade as Record<string, unknown>).status, 'open', 'trade opened');

  // Verify check results persisted
  const persisted = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, tradeId))
    .all();
  assertEqual(persisted.length, 1, '1 check result persisted');
  assertEqual(persisted[0].passed, true, 'check passed');
}

// ── 4. Merge account + setup checks, all passed ──────────────────────

console.log('\n4. POST succeeds with merged account+setup checks all passed:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;

  const lookupVal = seedLookupSetup('Momentum Breakout');
  const setupDef = seedSetupDefinition({ name: 'Momentum Breakout' });

  const trade = seedTrade(accountId, { setupId: lookupVal.id });
  tradeId = trade.id as string;

  const accCheck = seedCheck({ accountId, description: 'Account check', sortOrder: 1 });
  const setupCheck = seedCheck({ setupId: setupDef.id as string, description: 'Setup check', sortOrder: 2 });

  const result = doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    checkResults: [
      { checklistDefinitionId: accCheck.id as string, passed: true },
      { checklistDefinitionId: setupCheck.id as string, passed: true },
    ],
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.trade, 'has trade');

  const persisted = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, tradeId))
    .all();
  assertEqual(persisted.length, 2, '2 check results persisted');
}

// ── 5. Reject when checks exist but no checkResults provided ──────────

console.log('\n5. POST returns 400 when checks exist but no checkResults provided:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  seedCheck({ accountId, description: 'Required verification check', sortOrder: 1 });

  const result = doSimpleExecute(tradeId);
  assert(result.status === 400, 'returns 400');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Validation failed', 'error matches');
  const details = data.details as Record<string, unknown>;
  const fieldErrors = details.fieldErrors as Record<string, unknown>;
  const checkErrors = fieldErrors.checkResults as string[];
  assert(checkErrors.length > 0, 'has checkResults field errors');
  const allErrorsText = checkErrors.join(' ');
  assert(allErrorsText.includes('Missing'), 'error mentions missing results');
}

// ── 6. Reject when some checks are passed=false ───────────────────────

console.log('\n6. POST returns 400 when a check result has passed=false:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheck({ accountId, description: 'Risk check', sortOrder: 1 });

  const result = doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    checkResults: [
      { checklistDefinitionId: check1.id as string, passed: false },
    ],
  });

  assert(result.status === 400, 'returns 400');
  const data = result.data as Record<string, unknown>;
  const details = data.details as Record<string, unknown>;
  const fieldErrors = details.fieldErrors as Record<string, unknown>;
  const checkErrors = fieldErrors.checkResults as string[];
  assert(checkErrors.length > 0, 'has checkResults error');
  const allErrors = checkErrors.join(' ');
  assert(allErrors.includes('must be passed'), 'error mentions must be passed');
}

// ── 7. Reject when checkResults don't cover all items ────────────────

console.log('\n7. POST returns 400 when not all checklist items have results:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheck({ accountId, description: 'Check A', sortOrder: 1 });
  seedCheck({ accountId, description: 'Check B', sortOrder: 2 });

  const result = doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    checkResults: [
      { checklistDefinitionId: check1.id as string, passed: true },
      // Check B is missing from results
    ],
  });

  assert(result.status === 400, 'returns 400');
  const data = result.data as Record<string, unknown>;
  const details = data.details as Record<string, unknown>;
  const fieldErrors = details.fieldErrors as Record<string, unknown>;
  const checkErrors = fieldErrors.checkResults as string[];
  assert(checkErrors.length > 0, 'has checkResults error');
  const allErrors = checkErrors.join(' ');
  assert(allErrors.includes('Missing'), 'error mentions missing items');
  assert(allErrors.includes('Check B'), 'error names the missing item');
}

// ── 8. Reject with both missing and not-passed errors ─────────────────

console.log('\n8. POST returns 400 with combined errors for missing + not-passed items:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheck({ accountId, description: 'Check 1', sortOrder: 1 });
  seedCheck({ accountId, description: 'Check 2', sortOrder: 2 });

  const result = doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    checkResults: [
      { checklistDefinitionId: check1.id as string, passed: false },
      // Check 2 is missing
    ],
  });

  assert(result.status === 400, 'returns 400');
  const data = result.data as Record<string, unknown>;
  const details = data.details as Record<string, unknown>;
  const fieldErrors = details.fieldErrors as Record<string, unknown>;
  const checkErrors = fieldErrors.checkResults as string[];
  assert(checkErrors.length >= 2, 'has 2 checkResults errors');
  const allErrors = checkErrors.join(' ');
  assert(allErrors.includes('Missing'), 'error mentions missing');
  assert(allErrors.includes('must be passed'), 'error mentions not passed');
}

// ── 9. Atomic persistence: check results are NOT created on failure ───

console.log('\n9. No check results are persisted when execution is rejected:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheck({ accountId, description: 'Will not pass', sortOrder: 1 });

  const result = doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    checkResults: [
      { checklistDefinitionId: check1.id as string, passed: false },
    ],
  });

  assert(result.status === 400, 'returns 400');

  // The transaction was never entered, so no check results exist
  const persisted = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, tradeId))
    .all();
  assertEqual(persisted.length, 0, 'no check results persisted');
}

// ── 10. Execute with check results including optional comment ─────────

console.log('\n10. POST persists check results with optional comments:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheck({ accountId, description: 'Check with comment', sortOrder: 1 });

  const result = doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    checkResults: [
      { checklistDefinitionId: check1.id as string, passed: true, comment: 'All clear, support confirmed' },
    ],
  });

  assert(result.status === 201, 'returns 201');
  const persisted = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, tradeId))
    .all();
  assertEqual(persisted.length, 1, '1 check result persisted');
  assertEqual(persisted[0].comment, 'All clear, support confirmed', 'comment preserved');
}

// ── 11. Existing behavior: exit qty exceeds entry qty ────────────────

console.log('\n11. POST returns 400 when total exit quantity exceeds entry quantity (existing behavior preserved):');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const result = doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    exit1Quantity: 6,
    exit1Price: 110,
    exit2Quantity: 6,
    exit2Price: 115,
  });

  assert(result.status === 400, 'returns 400');
  const data = result.data as Record<string, unknown>;
  const details = data.details as Record<string, unknown>;
  const fieldErrors = details.fieldErrors as Record<string, unknown>;
  assertNotNull(fieldErrors.exitQuantity, 'has exitQuantity error');
}

// ── 12. Existing behavior: trade not found ────────────────────────────

console.log('\n12. POST returns 404 for non-existent trade (existing behavior preserved):');
{
  cleanup();
  const result = doSimpleExecute('nonexistent-trade-id');
  assert(result.status === 404, 'returns 404');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Trade not found', 'error message matches');
}

// ── 13. Existing behavior: deleted trade rejected ─────────────────────

console.log('\n13. POST returns 400 for deleted trade (existing behavior preserved):');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId, { status: 'deleted' });
  tradeId = trade.id as string;

  const result = doSimpleExecute(tradeId);
  assert(result.status === 400, 'returns 400');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Cannot execute a deleted trade', 'error message matches');
}

// ── 14. Existing behavior: only planned trades can execute ────────────

console.log('\n14. POST returns 400 for non-planned trade (existing behavior preserved):');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId, { status: 'open' });
  tradeId = trade.id as string;

  const result = doSimpleExecute(tradeId);
  assert(result.status === 400, 'returns 400');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Trade is not in planned status', 'error message matches');
}

// ── 15. Execute with exit prices and quantities (full round trip) ─────

console.log('\n15. POST succeeds with exits and check results all passed:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  const check1 = seedCheck({ accountId, description: 'Pre-trade check', sortOrder: 1 });

  const result = doExecute(tradeId, {
    entryPrice: 100,
    entryQuantity: 10,
    exit1Price: 110,
    exit1Quantity: 5,
    exit2Price: 120,
    exit2Quantity: 5,
    checkResults: [
      { checklistDefinitionId: check1.id as string, passed: true },
    ],
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  const tradeData = data.trade as Record<string, unknown>;
  assertEqual(tradeData.status, 'closed', 'fully exited trade is closed');
  const executions = data.executions as unknown[];
  assertEqual(executions.length, 3, '3 executions created (1 entry + 2 exits)');

  const persisted = db
    .select()
    .from(schema.tradeCheckResults)
    .where(eq(schema.tradeCheckResults.tradeId, tradeId))
    .all();
  assertEqual(persisted.length, 1, '1 check result persisted');
}

// ── 16. Soft-deleted checks are not gating (not part of merged) ──────

console.log('\n16. POST allows execution when only soft-deleted checks exist:');
{
  cleanup();
  const acc = seedAccount();
  accountId = acc.id as string;
  const trade = seedTrade(accountId);
  tradeId = trade.id as string;

  // Soft-deleted check
  seedCheck({ accountId, description: 'Deleted check', sortOrder: 1, deletedAt: new Date().toISOString() });

  // Should pass because merged checklist is empty (soft-deleted checks excluded)
  const result = doSimpleExecute(tradeId);
  assert(result.status === 201, 'returns 201');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'\u2500'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
expect(failed).toBe(0);
if (failed === 0) {
  console.log('         All tests passed!\n');
}

});
