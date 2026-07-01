/**
 * 10K Trade Seed Script - generates benchmark-scale test data.
 *
 * Run with: npx tsx src/db/seed-10k.ts          (defaults to 10,000 trades)
 *            COUNT=5 npx tsx src/db/seed-10k.ts  (custom count)
 *
 * Creates a single '10K Benchmark Account' if none exists.
 * Generates trades, executions, risk snapshots, grades, mistakes,
 * account_rollforward rows, and weekly reviews.
 *
 * Idempotent: skips if trades table already has rows.
 * Self-contained: no imports from @/ paths (per MEM003).
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { count as drizzleCount, sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

const DB_FILE = process.env.DB_FILE_NAME || './.trading-journal/journal.db';

mkdirSync(dirname(DB_FILE), { recursive: true });
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// ── Stock pool (50+ symbols) ────────────────────────────────────────────

const STOCKS = [
  { symbol: 'AAPL', sector: 'technology', base: 180 },
  { symbol: 'MSFT', sector: 'technology', base: 380 },
  { symbol: 'GOOGL', sector: 'technology', base: 140 },
  { symbol: 'AMZN', sector: 'technology', base: 150 },
  { symbol: 'NVDA', sector: 'semiconductors', base: 700 },
  { symbol: 'TSLA', sector: 'technology', base: 250 },
  { symbol: 'META', sector: 'technology', base: 350 },
  { symbol: 'JPM', sector: 'financials', base: 160 },
  { symbol: 'BAC', sector: 'financials', base: 30 },
  { symbol: 'WMT', sector: 'consumer_defensive', base: 160 },
  { symbol: 'PG', sector: 'consumer_defensive', base: 150 },
  { symbol: 'UNH', sector: 'healthcare', base: 500 },
  { symbol: 'JNJ', sector: 'healthcare', base: 150 },
  { symbol: 'V', sector: 'financials', base: 260 },
  { symbol: 'MA', sector: 'financials', base: 400 },
  { symbol: 'HD', sector: 'consumer_cyclical', base: 320 },
  { symbol: 'DIS', sector: 'communication', base: 90 },
  { symbol: 'NFLX', sector: 'communication', base: 400 },
  { symbol: 'ADBE', sector: 'software', base: 500 },
  { symbol: 'INTC', sector: 'semiconductors', base: 40 },
  { symbol: 'AMD', sector: 'semiconductors', base: 150 },
  { symbol: 'CRM', sector: 'software', base: 250 },
  { symbol: 'PYPL', sector: 'financials', base: 60 },
  { symbol: 'UBER', sector: 'technology', base: 60 },
  { symbol: 'SQ', sector: 'financials', base: 70 },
  { symbol: 'COIN', sector: 'financials', base: 120 },
  { symbol: 'SNAP', sector: 'communication', base: 15 },
  { symbol: 'PLTR', sector: 'software', base: 20 },
  { symbol: 'SHOP', sector: 'software', base: 70 },
  { symbol: 'SOFI', sector: 'financials', base: 10 },
  { symbol: 'RIVN', sector: 'technology', base: 15 },
  { symbol: 'MRNA', sector: 'biotech', base: 100 },
  { symbol: 'ABNB', sector: 'consumer_cyclical', base: 140 },
  { symbol: 'DDOG', sector: 'software', base: 110 },
  { symbol: 'CRWD', sector: 'software', base: 250 },
  { symbol: 'PANW', sector: 'software', base: 280 },
  { symbol: 'MU', sector: 'semiconductors', base: 80 },
  { symbol: 'QCOM', sector: 'semiconductors', base: 130 },
  { symbol: 'TXN', sector: 'semiconductors', base: 160 },
  { symbol: 'AVGO', sector: 'semiconductors', base: 1000 },
  { symbol: 'CAT', sector: 'industrials', base: 280 },
  { symbol: 'BA', sector: 'industrials', base: 200 },
  { symbol: 'NKE', sector: 'consumer_cyclical', base: 100 },
  { symbol: 'SBUX', sector: 'consumer_cyclical', base: 100 },
  { symbol: 'LMT', sector: 'industrials', base: 420 },
  { symbol: 'GE', sector: 'industrials', base: 130 },
  { symbol: 'XOM', sector: 'energy', base: 100 },
  { symbol: 'CVX', sector: 'energy', base: 150 },
  { symbol: 'LLY', sector: 'pharma', base: 600 },
  { symbol: 'PFE', sector: 'pharma', base: 40 },
  { symbol: 'TMO', sector: 'healthcare', base: 500 },
  { symbol: 'ABT', sector: 'healthcare', base: 100 },
  { symbol: 'CMG', sector: 'consumer_cyclical', base: 50 },
  { symbol: 'COST', sector: 'consumer_defensive', base: 600 },
  { symbol: 'LRCX', sector: 'semiconductors', base: 700 },
  { symbol: 'KLAC', sector: 'semiconductors', base: 500 },
];

// ── Direction-action pairs per MEM025 ───────────────────────────────────

const DIRECTION_ACTIONS: Record<string, string[]> = {
  long: ['buy', 'add', 'sell', 'reduce'],
  short: ['sell_short', 'buy_to_cover'],
};

// ── Phases for mistakes (not including 'entry' since that's phase-specific) ──

const MISTAKE_PHASES = ['pre_trade', 'entry', 'management', 'exit', 'review'] as const;
type MistakePhase = typeof MISTAKE_PHASES[number];

const SEVERITIES = ['minor', 'moderate', 'major', 'critical'] as const;
const MISTAKE_STATUSES = ['open', 'addressed', 'improved', 'resolved'] as const;

// ── Helpers ─────────────────────────────────────────────────────────────

function rng(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function rngInt(min: number, max: number): number {
  return Math.floor(rng(min, max + 1));
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: readonly T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Return the Monday of the week containing `date`.
 */
function weekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekEnd(date: Date): Date {
  const ws = weekStart(date);
  const we = new Date(ws);
  we.setDate(ws.getDate() + 6);
  return we;
}

/**
 * Generate trading dates between start and end, skipping weekends and a few
 * common US market holidays.
 */
function* tradingDays(start: Date, end: Date): Generator<Date> {
  const HOLIDAYS = new Set([
    '01-01', // New Year's
    '01-20', // MLK (approx, used as generic Jan holiday)
    '02-17', // Presidents' Day (approx)
    '05-26', // Memorial Day (approx)
    '07-04', // Independence Day
    '09-01', // Labor Day (approx)
    '11-27', // Thanksgiving (approx)
    '12-25', // Christmas
  ]);
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    const mmdd = formatDate(cur).slice(5);
    if (dow !== 0 && dow !== 6 && !HOLIDAYS.has(mmdd)) {
      yield new Date(cur);
    }
    cur.setDate(cur.getDate() + 1);
  }
}

// ── Main seed ───────────────────────────────────────────────────────────

function seed() {
  // Accept COUNT from env var or first CLI argument (for compatibility)
  const tradeCount = parseInt(process.env.COUNT || process.argv[2] || '10000', 10);
  console.log(`Starting seed with ${tradeCount} trades...`);

  // ── Idempotency check ──────────────────────────────────────────────────
  const existingTradeCount = db.select({ c: drizzleCount() }).from(schema.trades).get();
  if (existingTradeCount && existingTradeCount.c > 0) {
    console.log(`  trades table already has ${existingTradeCount.c} rows — skipping.`);
    return;
  }

  // ── Cache lookup values ────────────────────────────────────────────────
  const allLookups = db.select().from(schema.lookupValues).all();
  const byTypeAndValue = new Map<string, schema.LookupValues>();
  for (const lv of allLookups) {
    byTypeAndValue.set(`${lv.type}:${lv.value}`, lv);
  }

  const getLookup = (type: string, value: string) => {
    const found = byTypeAndValue.get(`${type}:${value}`);
    if (!found) throw new Error(`Lookup not found: ${type}:${value}`);
    return found;
  };

  // ── Create account ────────────────────────────────────────────────────
  let account = db.select().from(schema.accounts).where(
    sql`name = '10K Benchmark Account'`
  ).get();

  if (!account) {
    const accountId = crypto.randomUUID();
    db.insert(schema.accounts).values({
      id: accountId,
      name: '10K Benchmark Account',
      broker: 'Seed Script',
      currency: 'USD',
      isActive: true,
    }).run();
    account = db.select().from(schema.accounts).where(
      sql`name = '10K Benchmark Account'`
    ).get()!;
    console.log(`  Created account: ${account.id}`);
  } else {
    console.log(`  Using existing account: ${account.id}`);
  }

  // ── Date range ────────────────────────────────────────────────────────
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - 18); // 18 months back
  const tradingDates: Date[] = [...tradingDays(startDate, endDate)];

  // ── Compute trade distributions ────────────────────────────────────────
  const closedCount = Math.floor(tradeCount * 0.80);
  const scratchedCount = Math.floor(tradeCount * 0.05);
  const openPlannedCount = tradeCount - closedCount - scratchedCount;

  // ── Generate all trades ────────────────────────────────────────────────
  const now = new Date().toISOString();
  const tradeRows: (typeof schema.trades.$inferInsert)[] = [];
  const executionRows: (typeof schema.tradeExecutions.$inferInsert)[] = [];
  const riskRows: (typeof schema.tradeRiskSnapshots.$inferInsert)[] = [];
  const gradeRows: (typeof schema.tradeGrades.$inferInsert)[] = [];
  const mistakeRows: (typeof schema.tradeMistakes.$inferInsert)[] = [];

  // Track PnL per trading day for rollforward
  const dailyPnl = new Map<string, number>();
  const dailyFees = new Map<string, number>();
  // Track closed trade data per week for reviews
  const weeklyTrades = new Map<string, {
    count: number;
    pnl: number;
    rValues: number[];
    processScores: number[];
  }>();

  let totalExecutions = 0;
  let totalGrades = 0;
  let totalMistakes = 0;

  for (let i = 0; i < tradeCount; i++) {
    const stock = pick(STOCKS);
    const tradeId = crypto.randomUUID();
    const tradeCode = `SEED-${String(i + 1).padStart(6, '0')}`;
    const direction = Math.random() < 0.6 ? 'long' as const : 'short' as const;

    const sectorLv = getLookup('sector', stock.sector);
    const setupLv = getLookup('setup', pick([
      'momentum', 'breakout', 'pullback', 'reversal', 'range',
      'gap', 'scalp', 'swing', 'pattern', 'news',
    ]));
    const conditionLv = getLookup('market_condition', pick([
      'trending_up', 'trending_down', 'ranging', 'volatile',
      'low_volume', 'high_volume',
    ]));

    const openedAt = pick(tradingDates);
    let status: string;
    let closedAt: string | null = null;
    let isClosed = false;
    let isScratched = false;

    if (i < closedCount) {
      status = 'closed';
      isClosed = true;
      const closeDate = new Date(openedAt);
      closeDate.setDate(closeDate.getDate() + rngInt(1, 30));
      if (closeDate > endDate) closeDate.setTime(endDate.getTime());
      closedAt = formatDate(closeDate);
    } else if (i < closedCount + scratchedCount) {
      status = 'scratched';
      isScratched = true;
    } else {
      status = Math.random() < 0.5 ? 'open' : 'planned';
    }

    const priceBase = stock.base * (1 + rng(-0.02, 0.02));
    const plannedEntry = round2(priceBase * (1 + rng(-0.03, 0.03)));
    const plannedStop = direction === 'long'
      ? round2(plannedEntry * (1 - rng(0.01, 0.05)))
      : round2(plannedEntry * (1 + rng(0.01, 0.05)));
    const plannedTarget1 = direction === 'long'
      ? round2(plannedEntry * (1 + rng(0.02, 0.08)))
      : round2(plannedEntry * (1 - rng(0.02, 0.08)));
    const plannedTarget2 = direction === 'long'
      ? round2(plannedTarget1 * (1 + rng(0.01, 0.04)))
      : round2(plannedTarget1 * (1 - rng(0.01, 0.04)));

    tradeRows.push({
      id: tradeId,
      tradeCode,
      accountId: account!.id,
      symbol: stock.symbol,
      direction,
      sectorId: sectorLv.id,
      setupId: setupLv.id,
      marketConditionId: conditionLv.id,
      status: status as any,
      plannedEntry,
      plannedStop,
      plannedTarget1,
      plannedTarget2,
      thesis: `Seed trade on ${stock.symbol} — ${setupLv.value} setup in ${stock.sector}`,
      invalidationCondition: `${direction === 'long' ? 'Below' : 'Above'} ${plannedStop}`,
      openedAt: formatDate(openedAt),
      closedAt,
      lesson: isClosed ? `Learned about ${pick(['position sizing', 'risk management', 'entry timing', 'patience'])}` : null,
      createdAt: now,
      updatedAt: now,
    });

    // ── Executions for closed trades ──────────────────────────────────────
    if (isClosed) {
      const numExecutions = rngInt(1, 6);
      const actions = direction === 'long'
        ? (numExecutions <= 2 ? ['buy', 'sell'] : ['buy', 'add', 'sell', 'reduce'])
        : (numExecutions <= 2 ? ['sell_short', 'buy_to_cover'] : ['sell_short', 'sell_short', 'buy_to_cover', 'buy_to_cover']);

      // Distribute executions across the trade's lifespan
      const msRange = new Date(closedAt!).getTime() - openedAt.getTime();
      let totalQty = 0;
      let totalPnl = 0;
      let totalFee = 0;

      for (let e = 0; e < numExecutions; e++) {
        const action = direction === 'long'
          ? (e < Math.ceil(numExecutions / 2) ? pick(['buy', 'add']) : pick(['sell', 'reduce']))
          : (e < Math.ceil(numExecutions / 2) ? pick(['sell_short', 'sell_short']) : pick(['buy_to_cover', 'buy_to_cover']));

        const execDate = e === 0
          ? openedAt
          : new Date(openedAt.getTime() + rng(0.01, 0.99) * msRange);

        const execPrice = round2(priceBase * (1 + rng(-0.02, 0.02)));

        // Quantity: avoid very small shares for realism
        let qty: number;
        if (priceBase > 500) {
          qty = rngInt(1, 10);
        } else if (priceBase > 100) {
          qty = rngInt(5, 50);
        } else {
          qty = rngInt(20, 200);
        }

        const fees = round2(qty * execPrice * 0.0005 + 0.35); // ~0.05% + $0.35

        totalQty += qty;
        totalFee += fees;

        // For PnL tracking: buy actions decrease PnL, sell actions increase it
        if (direction === 'long') {
          if (action === 'buy' || action === 'add') {
            totalPnl -= qty * execPrice;
          } else {
            totalPnl += qty * execPrice;
          }
        } else {
          if (action === 'sell_short') {
            totalPnl += qty * execPrice;
          } else {
            totalPnl -= qty * execPrice;
          }
        }

        const reasonLv = getLookup('execution_reason', pick([
          'manual_entry', 'limit_order', 'stop_order', 'scalp', 'scale_in',
          'partial_exit', 'full_exit', 'stop_loss', 'take_profit',
        ]));

        executionRows.push({
          id: crypto.randomUUID(),
          tradeId,
          executedAt: formatDate(execDate),
          action: action as any,
          quantity: qty,
          price: execPrice,
          fees,
          reasonId: reasonLv.id,
          notes: e === 0 ? 'Initial entry' : e === numExecutions - 1 ? 'Final exit' : `Execution ${e + 1}`,
          createdAt: now,
        });
        totalExecutions++;
      }

      // Realized PnL = totalPnl (sum of cost basis for buys subtracted, sells added) - fees
      const realizedPnl = round2(totalPnl - totalFee);
      const tradeDateKey = formatDate(openedAt);

      // Accumulate daily PnL
      dailyPnl.set(tradeDateKey, (dailyPnl.get(tradeDateKey) || 0) + realizedPnl);
      dailyFees.set(tradeDateKey, (dailyFees.get(tradeDateKey) || 0) + totalFee);

      // ── Risk snapshot ─────────────────────────────────────────────────
      const firstExec = executionRows[executionRows.length - numExecutions];
      const initialQty = firstExec ? firstExec.quantity : totalQty / numExecutions;
      const riskPerShare = direction === 'long'
        ? plannedEntry - plannedStop
        : plannedStop - plannedEntry;
      const initialRiskAmount = round2(riskPerShare * initialQty);
      const accountRiskPct = round2((initialRiskAmount / 100000) * 100); // Assume $100K account

      riskRows.push({
        id: crypto.randomUUID(),
        tradeId,
        accountEquityAtOpen: 100000,
        initialEntryPrice: plannedEntry,
        initialStopPrice: plannedStop,
        initialQuantity: initialQty,
        riskPerShare: round2(riskPerShare),
        initialRiskAmount: rngInt(50, 500),
        accountRiskPct,
        plannedRewardRisk: round2(
          Math.abs(plannedTarget1 - plannedEntry) / Math.abs(riskPerShare)
        ),
        createdAt: now,
      });

      // ── Grades (60% of closed trades) ────────────────────────────────
      if (Math.random() < 0.6) {
        const scores = [0, 0, 0, 0, 0, 0].map(() => rngInt(4, 9));
        const totalScore = scores.reduce((a, b) => a + b, 0);
        const gradeLabel = totalScore >= 42 ? 'A' : totalScore >= 36 ? 'B' : totalScore >= 30 ? 'C' : 'D';

        gradeRows.push({
          id: crypto.randomUUID(),
          tradeId,
          setupQualityScore: scores[0],
          riskQualityScore: scores[1],
          entryQualityScore: scores[2],
          managementQualityScore: scores[3],
          exitQualityScore: scores[4],
          reviewQualityScore: scores[5],
          totalScore,
          gradeLabel,
          followedPlan: Math.random() < 0.7,
          ruleViolation: Math.random() < 0.15,
          notes: `Auto-graded at ${totalScore}`,
          createdAt: now,
          updatedAt: now,
        });
        totalGrades++;

        // Track for weekly review
        const ws = weekStart(openedAt);
        const wsStr = formatDate(ws);
        if (!weeklyTrades.has(wsStr)) {
          weeklyTrades.set(wsStr, { count: 0, pnl: 0, rValues: [], processScores: [] });
        }
        const wd = weeklyTrades.get(wsStr)!;
        wd.count++;
        wd.pnl += realizedPnl;
        wd.rValues.push(totalScore / 6); // Rough R-multiple proxy
        wd.processScores.push(totalScore / 6);
      }

      // ── Mistakes (70% of closed trades) ──────────────────────────────
      if (Math.random() < 0.7) {
        const numMistakes = rngInt(1, 3);
        for (let m = 0; m < numMistakes; m++) {
          const mtLv = getLookup('mistake_type', pick([
            'fv_setup_selection', 'fv_risk_assessment', 'fv_entry_timing',
            'fv_position_sizing', 'fv_stop_placement', 'fv_target_setting',
            'fv_patience', 'fv_management', 'fv_exit_discipline', 'fv_psychology',
          ]));

          mistakeRows.push({
            id: crypto.randomUUID(),
            tradeId,
            mistakeTypeId: mtLv.id,
            phase: pick(MISTAKE_PHASES) as MistakePhase,
            severity: pick(SEVERITIES) as typeof schema.tradeMistakes.$inferInsert['severity'],
            rootCause: `Root cause analysis for ${mtLv.value}`,
            correctiveAction: `Improve ${mtLv.value.replace('fv_', '').replace(/_/g, ' ')} process`,
            status: pick(MISTAKE_STATUSES) as typeof schema.tradeMistakes.$inferInsert['status'],
            createdAt: now,
            updatedAt: now,
          });
          totalMistakes++;
        }
      }

      // ── Weekly review data for non-graded closed trades too ────────────
      if (Math.random() >= 0.6) {
        const ws = weekStart(openedAt);
        const wsStr = formatDate(ws);
        if (!weeklyTrades.has(wsStr)) {
          weeklyTrades.set(wsStr, { count: 0, pnl: 0, rValues: [], processScores: [] });
        }
        const wd = weeklyTrades.get(wsStr)!;
        wd.count++;
        wd.pnl += realizedPnl;
        wd.rValues.push(realizedPnl / initialRiskAmount);
      }
    }

    // Log progress every 1000 trades
    if ((i + 1) % 1000 === 0) {
      console.log(`  Prepared ${i + 1}/${tradeCount} trades...`);
    }
  }

  // ── Batch insert trades ───────────────────────────────────────────────
  console.log(`\nInserting ${tradeRows.length} trades...`);
  for (let i = 0; i < tradeRows.length; i += 500) {
    db.insert(schema.trades).values(tradeRows.slice(i, i + 500)).run();
  }

  console.log(`Inserting ${executionRows.length} executions...`);
  for (let i = 0; i < executionRows.length; i += 500) {
    db.insert(schema.tradeExecutions).values(executionRows.slice(i, i + 500)).run();
  }

  console.log(`Inserting ${riskRows.length} risk snapshots...`);
  for (let i = 0; i < riskRows.length; i += 500) {
    db.insert(schema.tradeRiskSnapshots).values(riskRows.slice(i, i + 500)).run();
  }

  console.log(`Inserting ${gradeRows.length} grades...`);
  for (let i = 0; i < gradeRows.length; i += 500) {
    db.insert(schema.tradeGrades).values(gradeRows.slice(i, i + 500)).run();
  }

  console.log(`Inserting ${mistakeRows.length} mistakes...`);
  for (let i = 0; i < mistakeRows.length; i += 500) {
    db.insert(schema.tradeMistakes).values(mistakeRows.slice(i, i + 500)).run();
  }

  // ── Account rollforward ──────────────────────────────────────────────
  console.log(`Generating account_rollforward for ${tradingDates.length} trading days...`);
  const rfRows: (typeof schema.accountRollforward.$inferInsert)[] = [];

  let equity = 100000;
  let cumulativePnl = 0;
  let hwm = 100000;

  for (const td of tradingDates) {
    const dateKey = formatDate(td);
    const dayPnl = dailyPnl.get(dateKey) || 0;
    const dayFees = dailyFees.get(dateKey) || 0;
    const dayNet = dayPnl - dayFees;

    equity = round2(equity + dayNet);
    cumulativePnl = round2(cumulativePnl + dayNet);
    if (equity > hwm) hwm = equity;
    const drawdown = round2(hwm - equity);
    const drawdownPct = hwm > 0 ? round2((drawdown / hwm) * 100) : 0;

    rfRows.push({
      id: crypto.randomUUID(),
      accountId: account!.id,
      date: dateKey,
      beginningEquity: round2(equity - dayNet),
      depositsWithdrawals: 0,
      realizedGrossPnl: round2(dayPnl),
      fees: dayFees,
      endingEquity: equity,
      cumulativePnl,
      highWaterMark: hwm,
      drawdownAmount: drawdown,
      drawdownPct,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  console.log(`Inserting ${rfRows.length} rollforward rows...`);
  for (let i = 0; i < rfRows.length; i += 500) {
    db.insert(schema.accountRollforward).values(rfRows.slice(i, i + 500)).run();
  }

  // ── Weekly reviews ────────────────────────────────────────────────────
  console.log(`Generating weekly reviews from ${weeklyTrades.size} weeks of data...`);
  const reviewRows: (typeof schema.weeklyReviews.$inferInsert)[] = [];

  for (const [wsStr, data] of weeklyTrades.entries()) {
    const wsDate = new Date(wsStr);
    const we = weekEnd(wsDate);
    const avgR = data.rValues.length > 0
      ? round2(data.rValues.reduce((a, b) => a + b, 0) / data.rValues.length)
      : 0;
    const winRate = data.pnl > 0
      ? round2((data.rValues.filter(r => r > 0).length / data.rValues.length) * 100)
      : 0;
    const avgScore = data.processScores.length > 0
      ? round2(data.processScores.reduce((a, b) => a + b, 0) / data.processScores.length * 10)
      : 0;

    reviewRows.push({
      id: crypto.randomUUID(),
      weekStart: wsStr,
      weekEnd: formatDate(we),
      accountId: account!.id,
      closedTrades: data.count,
      netPnl: round2(data.pnl),
      avgR,
      winRate,
      avgProcessScore: avgScore,
      notes: `Auto-generated review for week of ${wsStr}`,
      focusNextWeek: pick([
        'Focus on following the plan',
        'Improve stop placement',
        'Work on patience',
        'Review risk management rules',
        'Focus on high-probability setups',
      ]),
      createdAt: now,
      updatedAt: now,
    });
  }

  console.log(`Inserting ${reviewRows.length} weekly reviews...`);
  for (let i = 0; i < reviewRows.length; i += 500) {
    db.insert(schema.weeklyReviews).values(reviewRows.slice(i, i + 500)).run();
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n=== Seed Summary ===');
  console.log(`  Trades:           ${tradeRows.length}`);
  console.log(`    - Closed:       ${closedCount}`);
  console.log(`    - Scratched:    ${scratchedCount}`);
  console.log(`    - Open/Planned: ${openPlannedCount}`);
  console.log(`  Executions:       ${totalExecutions}`);
  console.log(`  Risk Snapshots:   ${riskRows.length}`);
  console.log(`  Grades:           ${totalGrades}`);
  console.log(`  Mistakes:         ${totalMistakes}`);
  console.log(`  Rollforward Days: ${rfRows.length}`);
  console.log(`  Weekly Reviews:   ${reviewRows.length}`);
}

seed();
