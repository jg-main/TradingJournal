/**
 * One-off backfill: mirror trade_executions created between the last
 * accounting migration (2026-07-16) and the trade-execution-sync feature
 * (2026-07-29) that were never mirrored to accounting_executions.
 *
 * Safe: uses the same idempotent syncTradeExecution path the app uses, so
 * re-running is a no-op. Then rebuilds the FIFO position projection so
 * account_positions reflects the complete ledger.
 *
 * Usage: npx tsx scripts/backfill-missing-executions.ts <db-path>
 */
import Database from 'better-sqlite3';
import { syncAndRebuildPositions } from '../src/lib/positions/trade-execution-sync';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: npx tsx scripts/backfill-missing-executions.ts <db-path>');
  process.exit(2);
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Find trade_executions not mirrored (missing idempotency key in accounting_executions).
const missing = sqlite
  .prepare(
    `SELECT te.id, te.trade_id, te.action, te.quantity, te.price,
            COALESCE(te.fees, 0) AS fees, te.executed_at,
            t.symbol, t.account_id
     FROM trade_executions te
     JOIN trades t ON t.id = te.trade_id
     LEFT JOIN accounting_executions ae
       ON ae.idempotency_key = 'trade-execution-' || te.id
       OR ae.idempotency_key = 'migrated:trade_executions:' || te.id
     WHERE ae.id IS NULL
     ORDER BY te.executed_at`,
  )
  .all() as Array<{
  id: string;
  trade_id: string;
  action: string;
  quantity: number;
  price: number;
  fees: number;
  executed_at: string | null;
  symbol: string;
  account_id: string;
}>;

console.log(`Found ${missing.length} unsynced execution(s)`);
for (const m of missing) {
  console.log(`  ${m.symbol} ${m.action} ${m.quantity} @ ${m.price} (${m.executed_at})`);
}

for (const m of missing) {
  const result = syncAndRebuildPositions(
    sqlite,
    {
      id: m.id,
      tradeId: m.trade_id,
      action: m.action,
      quantity: m.quantity,
      price: m.price,
      fees: m.fees,
      executedAt: m.executed_at,
    },
    m.account_id,
    m.symbol,
  );
  if ('error' in result) {
    console.error(`  FAILED ${m.symbol} ${m.action}: ${result.error}`);
  } else {
    const position = result.rebuildResult.positions.get(
      `${m.account_id}:${result.accountingExecution.instrument_id}`,
    );
    console.log(
      `  OK ${m.symbol} ${m.action} -> qty=${position?.quantity ?? '0.00'} avg=${position?.averageCost ?? '0.00'}`,
    );
  }
}

// Final verification: any remaining unsynced executions?
const remaining = sqlite
  .prepare(
    `SELECT te.id, t.symbol
     FROM trade_executions te
     JOIN trades t ON t.id = te.trade_id
     LEFT JOIN accounting_executions ae
       ON ae.idempotency_key = 'trade-execution-' || te.id
       OR ae.idempotency_key = 'migrated:trade_executions:' || te.id
     WHERE ae.id IS NULL`,
  )
  .all();
console.log(`\nRemaining unsynced: ${remaining.length}`);

// Show final open positions
const open = sqlite
  .prepare(
    `SELECT i.symbol, ap.quantity, ap.average_cost
     FROM account_positions ap
     JOIN instruments i ON i.id = ap.instrument_id
     WHERE ap.quantity != '0.00'
     ORDER BY i.symbol`,
  )
  .all() as Array<{ symbol: string; quantity: string; average_cost: string }>;
console.log('\nOpen positions after backfill:');
for (const p of open) console.log(`  ${p.symbol.padEnd(6)} qty=${p.quantity} avg=${p.average_cost}`);

sqlite.close();
