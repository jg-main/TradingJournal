/**
 * Repair ledger cash effects omitted by an older journal execution sync.
 *
 * Only executions identified by the `trade-execution-` sync key are eligible.
 * Migrated legacy executions and manually entered accounting executions are
 * deliberately excluded. The financial event key is deterministic, so an
 * interrupted or repeated apply is safe: already repaired executions are
 * skipped and never affect cash twice.
 *
 * Usage:
 *   npx tsx scripts/backfill-missing-execution-ledger-effects.ts <db-path>
 *   npx tsx scripts/backfill-missing-execution-ledger-effects.ts <db-path> --apply
 *   npx tsx scripts/backfill-missing-execution-ledger-effects.ts <db-path> --apply --account-id <uuid>
 */

import Database from 'better-sqlite3';
import {
  buildExecutionFinancialEventInput,
  ensureExecutionFinancialEvent,
} from '../src/lib/accounting/execution-posting';
import { rebuildAccountPerformance } from '../src/lib/performance/performance-rebuild';
import { rebuildPositions } from '../src/lib/positions/rebuild';
import type { AccountingExecutionRow } from '../src/db/accounting-repository';

interface MissingExecution extends AccountingExecutionRow {
  symbol: string;
}

function usage(): never {
  console.error(
    'usage: npx tsx scripts/backfill-missing-execution-ledger-effects.ts <db-path> [--apply] [--account-id <uuid>]',
  );
  process.exit(2);
}

const [dbPath, ...flags] = process.argv.slice(2);
if (!dbPath) usage();

let apply = false;
let accountId: string | undefined;
for (let index = 0; index < flags.length; index += 1) {
  const flag = flags[index];
  if (flag === '--apply') {
    apply = true;
  } else if (flag === '--account-id') {
    accountId = flags[index + 1];
    if (!accountId) usage();
    index += 1;
  } else {
    usage();
  }
}

const sqlite = new Database(dbPath, apply ? undefined : { readonly: true });
sqlite.pragma('foreign_keys = ON');

try {
  const missing = sqlite
    .prepare(
      `SELECT ae.id, ae.account_id, ae.instrument_id, ae.action, ae.quantity,
              ae.price, ae.fees, ae.idempotency_key, ae.journal_trade_id,
              ae.description, ae.posted_at, ae.created_at, i.symbol
       FROM accounting_executions ae
       JOIN instruments i ON i.id = ae.instrument_id
       LEFT JOIN financial_events fe
         ON fe.idempotency_key = 'accounting-execution-' || ae.id
       WHERE ae.idempotency_key LIKE 'trade-execution-%'
         AND fe.id IS NULL
         AND (? IS NULL OR ae.account_id = ?)
       ORDER BY ae.account_id, ae.posted_at, ae.id`,
    )
    .all(accountId ?? null, accountId ?? null) as MissingExecution[];

  const byAccount = new Map<string, { count: number; cashDeltaMicros: number }>();
  for (const execution of missing) {
    const event = buildExecutionFinancialEventInput({
      accountingExecutionId: execution.id,
      accountId: execution.account_id,
      symbol: execution.symbol,
      action: execution.action,
      quantity: execution.quantity,
      price: execution.price,
      fees: execution.fees,
      journalTradeId: execution.journal_trade_id,
      description: execution.description,
      postedAt: execution.posted_at,
    });
    if (!event.effect) {
      throw new Error(`Missing generated cash effect for execution ${execution.id}`);
    }
    const effect = JSON.parse(event.effect) as {
      direction: 'increase' | 'decrease';
      amountMicros: number;
    };
    const previous = byAccount.get(execution.account_id) ?? { count: 0, cashDeltaMicros: 0 };
    byAccount.set(execution.account_id, {
      count: previous.count + 1,
      cashDeltaMicros: previous.cashDeltaMicros + (
        effect.direction === 'increase' ? effect.amountMicros : -effect.amountMicros
      ),
    });
  }

  const mode = apply ? 'APPLY' : 'DRY RUN';
  console.log(`${mode}: ${missing.length} missing execution cash effect(s)`);
  for (const [id, summary] of byAccount) {
    console.log(
      `  ${id}: ${summary.count} execution(s), net cash change ${(summary.cashDeltaMicros / 1_000_000).toFixed(2)}`,
    );
  }

  if (!apply) {
    console.log('No data changed. Re-run with --apply after taking a database backup.');
    process.exitCode = 0;
  } else {
    const repairedAccounts = new Set<string>();
    let failures = 0;

    for (const execution of missing) {
      try {
        const result = ensureExecutionFinancialEvent(sqlite, execution, execution.symbol);
        if (result.inserted) repairedAccounts.add(execution.account_id);
      } catch (error) {
        failures += 1;
        console.error(
          `FAILED ${execution.account_id} ${execution.symbol} ${execution.action}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    for (const id of repairedAccounts) {
      rebuildPositions(sqlite, id);
      const performance = rebuildAccountPerformance(sqlite, id);
      if (!performance.success) {
        failures += 1;
        console.error(`FAILED performance rebuild for ${id}: ${performance.error ?? 'unknown error'}`);
      } else {
        console.log(`  rebuilt ${id}: NAV ${performance.nav ?? 'unavailable'}`);
      }
    }

    const remaining = sqlite
      .prepare(
        `SELECT COUNT(*) AS count
         FROM accounting_executions ae
         LEFT JOIN financial_events fe
           ON fe.idempotency_key = 'accounting-execution-' || ae.id
         WHERE ae.idempotency_key LIKE 'trade-execution-%'
           AND fe.id IS NULL
           AND (? IS NULL OR ae.account_id = ?)`,
      )
      .get(accountId ?? null, accountId ?? null) as { count: number };
    console.log(`Remaining missing execution cash effects: ${remaining.count}`);

    if (failures > 0 || remaining.count > 0) {
      process.exitCode = 1;
    }
  }
} finally {
  sqlite.close();
}
