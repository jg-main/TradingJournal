/**
 * generate-test-backup.mjs
 *
 * Generates a backup ZIP file with 100+ realistic test trades,
 * restoreable via the Settings → Restore flow (M015).
 *
 * Output: test-backup.zip in the project root.
 *
 * Usage: node .scripts/generate-test-backup.mjs
 */

import AdmZip from 'adm-zip';
import { statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// ── Existing reference data from the journal DB ─────────────────────────

const APP_PROFILE_ID = '358cb049-2d52-472d-a980-28f7d9d32eb6';
const ACCOUNT_ID = '84fff008-5afd-41f2-b0af-f9a991e1c691';
const SETTINGS_ID = '85b06627-d812-4272-b5a5-fa32d2c8a179';

const SETUPS = {
  breakdown: '594b7a3e-75b9-4e22-a121-cf3f933fe1a7',
  momentum: '32bc98ee-2c78-49ea-a2fb-aab76010dc62',
  breakout: '1b994055-c1cc-421a-b46b-614a32833c1b',
  pullback: '3a41aa47-8ac2-473b-8ec5-1630a5d0f1f7',
  reversal: '890d2f97-971c-427d-895c-d3443768960c',
  pattern: 'efc1b4ba-dc5b-45f4-b818-e4e385760ed3',
  swing: '78a9fe4f-cf62-46bc-a374-a02e85eb7a05',
  scalp: '2ee5f34d-bb5a-4a83-a67a-4c43b78b3002',
};

const SECTORS = {
  technology: 'de688b8d-6f25-4c25-8b34-8d35ece30975',
  semiconductors: '78e36d57-fa6f-4eea-9d9a-1e56c34589cb',
  software: '645412c4-8698-4e92-9256-fab760ad835d',
  energy: '71f86b6e-2544-478d-9be0-9c4dce6b2d1e',
  financials: 'ca1eb48e-0341-43d6-b830-460ea6217c0d',
  consumer_cyclical: '8ff1b360-5c49-47b4-8bad-e4ebaf6a083b',
  healthcare: '4c016c65-1b77-4d47-9f15-ce8141377e48',
  industrials: '3e9b7f36-98ec-41cc-8067-a9145ddcacd3',
  communication: '2e8eceff-55a5-4552-949a-3873b7028fb5',
};

const MARKET_CONDITIONS = {
  trending_up: 'a89d397d-60d5-4712-9a6f-467beacb5853',
  trending_down: '52998ecc-827a-427c-a9c4-9463b81ffe28',
  ranging: '11fb2ed2-8f8f-4eb1-aec5-0042dd5ab2a5',
  volatile: '3fc75f13-63b9-49e9-8ce8-e6db9c8580e4',
};

const EXEC_REASONS = {
  manual_entry: 'a7f081a0-e9a4-4297-9409-4a5f0dcbed59',
  limit_order: 'd36ae336-6f42-426b-a622-daeb059c4e9e',
  partial_exit: '8de950b9-87b7-421a-aaec-57f02c2e6913',
  full_exit: '296ee894-2e3e-477b-a062-a1c30389df30',
  stop_loss: 'abd13929-a20a-48c2-bbf4-c9fd6794c87f',
  take_profit: '14e05f7e-9f96-4638-8743-d769365a0ea9',
};

const MISTAKE_TYPES = {
  fv_entry_timing: '75b6472b-bf74-4521-8f7c-f02415b0c0cb',
  fv_patience: '731f5114-a735-47f6-b243-b7ac5aa16f25',
  fv_risk_assessment: 'aafb876e-63a9-4023-a3b2-1726abdbdd12',
  fv_position_sizing: '48e2a31e-4856-49c6-aa9d-888bf132fc84',
  fv_stop_placement: 'b198d103-1a58-4964-b513-d1980e7b9140',
  fv_exit_discipline: '92f78767-eaee-4d3c-a8b9-5be7c22a73c7',
  fv_psychology: 'fe241a90-e3a0-439d-a59d-1adbed3a7927',
};

const ACTION_ITEM_STATUSES = {
  open: '0fcd0368-e20d-4baa-b4e9-596f26c5cf51',
  in_progress: '04461484-f3b2-487c-9219-ced32de4bc43',
  done: '190a4317-47af-4668-94af-c29681829042',
};

// ── Ticker universe ─────────────────────────────────────────────────────

const TICKERS = [
  { symbol: 'AAPL', sector: 'technology', priceRange: [170, 230] },
  { symbol: 'MSFT', sector: 'technology', priceRange: [380, 460] },
  { symbol: 'NVDA', sector: 'semiconductors', priceRange: [110, 150] },
  { symbol: 'AMD', sector: 'semiconductors', priceRange: [130, 180] },
  { symbol: 'GOOGL', sector: 'communication', priceRange: [165, 200] },
  { symbol: 'META', sector: 'communication', priceRange: [480, 540] },
  { symbol: 'AMZN', sector: 'consumer_cyclical', priceRange: [175, 220] },
  { symbol: 'TSLA', sector: 'consumer_cyclical', priceRange: [240, 360] },
  { symbol: 'JPM', sector: 'financials', priceRange: [195, 220] },
  { symbol: 'GS', sector: 'financials', priceRange: [480, 540] },
  { symbol: 'UNH', sector: 'healthcare', priceRange: [520, 580] },
  { symbol: 'XOM', sector: 'energy', priceRange: [110, 130] },
  { symbol: 'CVX', sector: 'energy', priceRange: [155, 175] },
  { symbol: 'CAT', sector: 'industrials', priceRange: [330, 380] },
  { symbol: 'BA', sector: 'industrials', priceRange: [180, 230] },
  { symbol: 'NFLX', sector: 'communication', priceRange: [650, 720] },
  { symbol: 'CRM', sector: 'software', priceRange: [260, 310] },
  { symbol: 'MU', sector: 'semiconductors', priceRange: [95, 140] },
];

const SETUP_KEYS = Object.keys(SETUPS);
const MC_KEYS = Object.keys(MARKET_CONDITIONS);

// ── Helpers ─────────────────────────────────────────────────────────────

function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
function iso(d) { return d.toISOString(); }
function round2(n) { return Math.round(n * 100) / 100; }
function makeId() { return randomUUID(); }

// ── Data generation ─────────────────────────────────────────────────────

const startDate = new Date('2026-05-26T09:30:00-04:00');
const endDate = new Date('2026-07-03T16:00:00-04:00');
const TOTAL_TRADES = 105;
const WIN_RATE = 0.58;

let tradeCounter = 1;
const trades = [], executions = [], riskSnapshots = [], stopAdjustments = [];
const grades = [], mistakes = [], watchlistItems = [], accountTransactions = [];
const accountRollforward = [], weeklyReviews = [], reviewActionItems = [];

for (let i = 0; i < TOTAL_TRADES; i++) {
  const ticker = pick(TICKERS);
  const dayIndex = Math.floor((i / TOTAL_TRADES) * 28);
  const minuteOffset = randInt(30, 390);
  const tradeDate = new Date(startDate);
  tradeDate.setDate(tradeDate.getDate() + dayIndex);
  tradeDate.setMinutes(minuteOffset);
  if (tradeDate.getDay() === 0) tradeDate.setDate(tradeDate.getDate() + 1);
  if (tradeDate.getDay() === 6) tradeDate.setDate(tradeDate.getDate() + 2);

  const entryPrice = round2(rand(ticker.priceRange[0], ticker.priceRange[1]));
  const stopPrice = round2(entryPrice * (1 - rand(0.008, 0.035)));
  const target1 = round2(entryPrice * (1 + rand(0.015, 0.06)));
  const target2 = round2(entryPrice * (1 + rand(0.025, 0.10)));
  const riskPerShare = entryPrice - stopPrice;
  const accountRisk = rand(40, 120);
  const quantity = Math.max(10, Math.floor(accountRisk / riskPerShare));
  const isWinner = Math.random() < WIN_RATE;
  const isPartialClose = Math.random() < 0.25 && isWinner;
  const hasStopAdjustment = Math.random() < 0.20;
  const setup = pick(SETUP_KEYS);
  const mc = pick(MC_KEYS);
  const tradeId = makeId();
  const tradeCode = `T${String(tradeCounter++).padStart(4, '0')}`;

  const trade = {
    id: tradeId, tradeCode, accountId: ACCOUNT_ID, symbol: ticker.symbol,
    direction: 'long', sectorId: SECTORS[ticker.sector], setupId: SETUPS[setup],
    marketConditionId: MARKET_CONDITIONS[mc], status: 'closed',
    plannedEntry: entryPrice, plannedStop: stopPrice,
    plannedTarget1: target1, plannedTarget2: target2, plannedQuantity: quantity,
    thesis: `${ticker.symbol} ${setup} in ${mc.replace(/_/g, ' ')}. Support ${stopPrice}, target ${target1}.`,
    invalidationCondition: `Break below ${stopPrice} on volume`,
    preTradePlan: `Enter ${entryPrice}, stop ${stopPrice}, T1 ${target1}, T2 ${target2}. Scale 50% at T1.`,
    openedAt: iso(tradeDate), closedAt: null, exitNotes: null, lesson: null,
    createdAt: iso(tradeDate), updatedAt: iso(tradeDate),
  };

  // Entry execution
  executions.push({
    id: makeId(), tradeId, executedAt: iso(tradeDate), action: 'buy',
    quantity, price: entryPrice, fees: round2(quantity * entryPrice * 0.0005),
    reasonId: pick([EXEC_REASONS.manual_entry, EXEC_REASONS.limit_order]),
    notes: `Entry on ${ticker.symbol}`, createdAt: iso(tradeDate),
  });

  const exitDate = new Date(tradeDate);
  exitDate.setDate(exitDate.getDate() + randInt(1, 14));
  if (exitDate > endDate) exitDate.setTime(endDate.getTime());

  if (isWinner) {
    if (isPartialClose) {
      const halfQty = Math.floor(quantity / 2);
      const fst = new Date(exitDate); fst.setDate(fst.getDate() - randInt(0, 3));
      executions.push({
        id: makeId(), tradeId, executedAt: iso(fst), action: 'sell',
        quantity: halfQty, price: target1, fees: round2(halfQty * target1 * 0.0005),
        reasonId: EXEC_REASONS.take_profit, notes: `Scale out 50% at ${target1}`, createdAt: iso(fst),
      });
      const snd = new Date(fst); snd.setDate(snd.getDate() + randInt(1, 5));
      const sp = round2(target2 - rand(0, target2 * 0.02));
      executions.push({
        id: makeId(), tradeId, executedAt: iso(snd), action: 'sell',
        quantity: quantity - halfQty, price: sp, fees: round2((quantity - halfQty) * sp * 0.0005),
        reasonId: EXEC_REASONS.take_profit, notes: `Remainder at ${sp}`, createdAt: iso(snd),
      });
      trade.closedAt = iso(snd);
    } else {
      const ep = round2(target1 + rand(0, target1 * 0.02));
      executions.push({
        id: makeId(), tradeId, executedAt: iso(exitDate), action: 'sell',
        quantity, price: ep, fees: round2(quantity * ep * 0.0005),
        reasonId: EXEC_REASONS.take_profit, notes: `Full exit at ${ep}`, createdAt: iso(exitDate),
      });
      trade.closedAt = iso(exitDate);
    }
    if (Math.random() < 0.3) trade.lesson = pick([
      'Patience paid off. Stuck to the plan.', 'Let winners run per the plan.',
      'Proper sizing kept emotions in check.', 'Followed the system and it worked.',
    ]);
  } else {
    const ep = round2(stopPrice + rand(-0.2, 0.2));
    executions.push({
      id: makeId(), tradeId, executedAt: iso(exitDate), action: 'sell',
      quantity, price: ep, fees: round2(quantity * ep * 0.0005),
      reasonId: EXEC_REASONS.stop_loss, notes: `Stop loss at ${ep}`, createdAt: iso(exitDate),
    });
    trade.closedAt = iso(exitDate);
    trade.exitNotes = pick([
      'Stop loss hit — thesis invalidated.', 'Exited on stop. Move on.',
      'Stop saved further losses.', 'Trade went against quickly.',
    ]);
    trade.lesson = pick([
      'Cut losses. Stop did its job.', 'Dont average down on losers.',
      'Setup didnt work. Accept it.', 'Better small loss than big one.',
      'Entry timing off. Wait for confirmation.',
    ]);
  }

  if (hasStopAdjustment) {
    const adj = new Date(tradeDate); adj.setDate(adj.getDate() + randInt(1, 5));
    if (adj < new Date(trade.closedAt)) {
      stopAdjustments.push({
        id: makeId(), tradeId, adjustedAt: iso(adj),
        previousStop: stopPrice, newStop: round2(entryPrice + rand(0.5, 3)),
        reason: pick(['Breakeven', 'Trailing stop', 'Technical level']),
        ruleBased: true, notes: 'Adjusted stop to breakeven.', createdAt: iso(adj),
      });
    }
  }

  riskSnapshots.push({
    id: makeId(), tradeId, accountEquityAtOpen: 10000,
    initialEntryPrice: entryPrice, initialStopPrice: stopPrice,
    initialQuantity: quantity, riskPerShare: round2(riskPerShare),
    initialRiskAmount: round2(riskPerShare * quantity),
    accountRiskPct: round2((riskPerShare * quantity / 10000) * 100),
    plannedRewardRisk: round2((target1 - entryPrice) / riskPerShare),
    createdAt: iso(tradeDate),
  });

  if (Math.random() < 0.85) {
    const scores = [
      randInt(4, 10), randInt(5, 10), isWinner ? randInt(6, 10) : randInt(2, 5),
      isWinner ? randInt(5, 9) : randInt(2, 6), isWinner ? randInt(6, 10) : randInt(3, 7), randInt(4, 10),
    ];
    const ts = round2(scores.reduce((a, b) => a + b, 0) / 6);
    grades.push({
      id: makeId(), tradeId,
      setupQualityScore: scores[0], riskQualityScore: scores[1],
      entryQualityScore: scores[2], managementQualityScore: scores[3],
      exitQualityScore: scores[4], reviewQualityScore: scores[5],
      totalScore: ts,
      gradeLabel: ts >= 9 ? 'A' : ts >= 8 ? 'B' : ts >= 6 ? 'C' : ts >= 4 ? 'D' : 'F',
      followedPlan: isWinner ? true : Math.random() < 0.3,
      ruleViolation: !isWinner && Math.random() < 0.4,
      notes: isWinner ? pick(['Good plan execution.', 'Solid trade.']) : pick(['Entry was premature.', 'Market didnt cooperate.']),
      createdAt: iso(exitDate), updatedAt: iso(exitDate),
    });
  }

  if ((!isWinner && Math.random() < 0.6) || (isWinner && Math.random() < 0.1)) {
    const mt = pick(['fv_entry_timing', 'fv_patience', 'fv_position_sizing', 'fv_stop_placement']);
    mistakes.push({
      id: makeId(), tradeId,
      mistakeTypeId: MISTAKE_TYPES[mt],
      phase: pick(['pre_trade', 'entry', 'management']),
      severity: isWinner ? 'minor' : pick(['moderate', 'major']),
      rootCause: pick(['Entered too early.', 'Did not wait for confirmation.', 'Risked too much.', 'Moved stop too early.']),
      correctiveAction: pick(['Wait for candle close.', 'Use pre-trade checklist.', 'Hard stop limits.', 'Let stops work.']),
      status: pick(['addressed', 'improved', 'resolved']),
      createdAt: iso(exitDate), updatedAt: iso(exitDate),
    });
  }

  trades.push(trade);

  if (i < 15 && Math.random() < 0.5) {
    const wt = pick(TICKERS.filter(t => t.symbol !== ticker.symbol));
    const wp = round2(rand(wt.priceRange[0], wt.priceRange[1]));
    watchlistItems.push({
      id: makeId(), dateAdded: iso(new Date(tradeDate.getTime() - randInt(1,5)*86400000)),
      symbol: wt.symbol, sectorId: SECTORS[wt.sector], setupId: SETUPS[pick(SETUP_KEYS)],
      direction: 'long', thesis: `Watching ${wt.symbol} at ${wp}.`,
      marketContext: mc.replace(/_/g, ' '), keyLevel: wp,
      triggerPrice: round2(wp * 1.01), plannedStop: round2(wp * 0.97),
      targetPrice: round2(wp * 1.05), status: pick(['watching', 'pending']),
      notes: null, promotedTradeId: null,
      createdAt: iso(tradeDate), updatedAt: iso(tradeDate),
    });
  }
}

// Account transaction
accountTransactions.push({
  id: makeId(), accountId: ACCOUNT_ID, type: 'deposit',
  amount: 10000, balanceAfter: 10000, date: '2026-05-26',
  notes: 'Initial deposit', createdAt: '2026-05-26T09:00:00.000Z',
});

// Account rollforward
const weekData = [
  { d: '2026-05-29', e: 10150 }, { d: '2026-06-05', e: 10320 },
  { d: '2026-06-12', e: 9870 }, { d: '2026-06-19', e: 10240 },
  { d: '2026-06-26', e: 10580 }, { d: '2026-07-03', e: 10750 },
];
let cumPnl = 0, hwm = 10000;
for (const w of weekData) {
  cumPnl = w.e - 10000;
  const dd = hwm > w.e ? round2(hwm - w.e) : 0;
  if (w.e > hwm) hwm = w.e;
  accountRollforward.push({
    id: makeId(), accountId: ACCOUNT_ID, date: w.d,
    beginningEquity: round2(10000 + cumPnl - (w.e - 10000)),
    depositsWithdrawals: 0, realizedGrossPnl: round2(w.e - 10000),
    fees: round2(rand(10, 30)), endingEquity: w.e,
    cumulativePnl: round2(cumPnl), highWaterMark: hwm,
    drawdownAmount: dd, drawdownPct: hwm > 0 && hwm > w.e ? round2((dd / hwm) * 100) : 0,
    notes: null, createdAt: `${w.d}T16:00:00.000Z`, updatedAt: `${w.d}T16:00:00.000Z`,
  });
}

// Weekly reviews
const reviews = [
  { s: '2026-06-01', e: '2026-06-07', c: 14, pnl: 360, r: 1.8, wr: 0.57, ps: 6.5 },
  { s: '2026-06-08', e: '2026-06-14', c: 18, pnl: -420, r: -0.6, wr: 0.44, ps: 5.2 },
  { s: '2026-06-15', e: '2026-06-21', c: 20, pnl: 550, r: 2.1, wr: 0.65, ps: 7.8 },
  { s: '2026-06-22', e: '2026-06-28', c: 22, pnl: 380, r: 1.5, wr: 0.59, ps: 7.1 },
];
for (const rv of reviews) {
  const rid = makeId();
  weeklyReviews.push({
    id: rid, weekStart: rv.s, weekEnd: rv.e, accountId: ACCOUNT_ID,
    closedTrades: rv.c, netPnl: rv.pnl, avgR: rv.r, winRate: rv.wr,
    avgProcessScore: rv.ps,
    notes: pick(['Good week overall.', 'Tough week emotionally.', 'Strong week. Consistent.', 'Solid progress.']),
    focusNextWeek: pick(['A+ setups only.', 'Review all losers.', 'Stick to stops.', 'Consistent sizing.']),
    createdAt: `${rv.e}T17:00:00.000Z`, updatedAt: `${rv.e}T17:00:00.000Z`,
  });
  reviewActionItems.push({
    id: makeId(), sourceType: 'weekly_review', sourceId: rid,
    actionText: pick(['Review all trades by mistake type.', 'Create pre-trade checklist.', 'Journal within 15 min.', 'Read psychology chapter.']),
    status: pick([ACTION_ITEM_STATUSES.open, ACTION_ITEM_STATUSES.in_progress, ACTION_ITEM_STATUSES.done]),
    dueDate: null, createdAt: `${rv.e}T17:00:00.000Z`, updatedAt: `${rv.e}T17:00:00.000Z`,
  });
}

// ── Lookup values ───────────────────────────────────────────────────────

const lookupValues = [
  { id: '0fcd0368-e20d-4baa-b4e9-596f26c5cf51', type: 'action_item_status', value: 'open', sortOrder: 59, isActive: true },
  { id: '04461484-f3b2-487c-9219-ced32de4bc43', type: 'action_item_status', value: 'in_progress', sortOrder: 60, isActive: true },
  { id: '190a4317-47af-4668-94af-c29681829042', type: 'action_item_status', value: 'done', sortOrder: 61, isActive: true },
  { id: '0f57503a-e47e-4534-8d50-fbf1df1947b6', type: 'action_item_status', value: 'cancelled', sortOrder: 62, isActive: true },
  { id: 'a7f081a0-e9a4-4297-9409-4a5f0dcbed59', type: 'execution_reason', value: 'manual_entry', sortOrder: 47, isActive: true },
  { id: 'd36ae336-6f42-426b-a622-daeb059c4e9e', type: 'execution_reason', value: 'limit_order', sortOrder: 48, isActive: true },
  { id: '7369281b-65de-4e77-8028-60f21a5b5890', type: 'execution_reason', value: 'stop_order', sortOrder: 49, isActive: true },
  { id: 'fe3c13bb-b115-4e20-98aa-b3febbeff45b', type: 'execution_reason', value: 'scalp', sortOrder: 50, isActive: true },
  { id: 'ae9c10b5-c6ea-47c5-b948-ac77968e73c8', type: 'execution_reason', value: 'scale_in', sortOrder: 51, isActive: true },
  { id: '8de950b9-87b7-421a-aaec-57f02c2e6913', type: 'execution_reason', value: 'partial_exit', sortOrder: 52, isActive: true },
  { id: '296ee894-2e3e-477b-a062-a1c30389df30', type: 'execution_reason', value: 'full_exit', sortOrder: 53, isActive: true },
  { id: 'abd13929-a20a-48c2-bbf4-c9fd6794c87f', type: 'execution_reason', value: 'stop_loss', sortOrder: 54, isActive: true },
  { id: '14e05f7e-9f96-4638-8743-d769365a0ea9', type: 'execution_reason', value: 'take_profit', sortOrder: 55, isActive: true },
  { id: 'a89d397d-60d5-4712-9a6f-467beacb5853', type: 'market_condition', value: 'trending_up', sortOrder: 25, isActive: true },
  { id: '52998ecc-827a-427c-a9c4-9463b81ffe28', type: 'market_condition', value: 'trending_down', sortOrder: 26, isActive: true },
  { id: '11fb2ed2-8f8f-4eb1-aec5-0042dd5ab2a5', type: 'market_condition', value: 'ranging', sortOrder: 27, isActive: true },
  { id: '3fc75f13-63b9-49e9-8ce8-e6db9c8580e4', type: 'market_condition', value: 'volatile', sortOrder: 28, isActive: true },
  { id: 'e40a76ae-f98d-4a8e-9f8d-7e20699a5c94', type: 'market_condition', value: 'low_volume', sortOrder: 29, isActive: true },
  { id: 'e083a883-5ea3-4f6f-b58f-2e833e09c855', type: 'market_condition', value: 'high_volume', sortOrder: 30, isActive: true },
  { id: '4a3e9719-1f60-46cb-939f-086091b310d6', type: 'mistake_type', value: 'fv_setup_selection', sortOrder: 31, isActive: true },
  { id: 'aafb876e-63a9-4023-a3b2-1726abdbdd12', type: 'mistake_type', value: 'fv_risk_assessment', sortOrder: 32, isActive: true },
  { id: '75b6472b-bf74-4521-8f7c-f02415b0c0cb', type: 'mistake_type', value: 'fv_entry_timing', sortOrder: 33, isActive: true },
  { id: '48e2a31e-4856-49c6-aa9d-888bf132fc84', type: 'mistake_type', value: 'fv_position_sizing', sortOrder: 34, isActive: true },
  { id: 'b198d103-1a58-4964-b513-d1980e7b9140', type: 'mistake_type', value: 'fv_stop_placement', sortOrder: 35, isActive: true },
  { id: '0d229bec-c389-4c69-8f1b-8a31d814da29', type: 'mistake_type', value: 'fv_target_setting', sortOrder: 36, isActive: true },
  { id: '731f5114-a735-47f6-b243-b7ac5aa16f25', type: 'mistake_type', value: 'fv_patience', sortOrder: 37, isActive: true },
  { id: '7076f0ff-49ca-4daf-9b67-a61524f5984b', type: 'mistake_type', value: 'fv_management', sortOrder: 38, isActive: true },
  { id: '92f78767-eaee-4d3c-a8b9-5be7c22a73c7', type: 'mistake_type', value: 'fv_exit_discipline', sortOrder: 39, isActive: true },
  { id: 'fe241a90-e3a0-439d-a59d-1adbed3a7927', type: 'mistake_type', value: 'fv_psychology', sortOrder: 40, isActive: true },
  { id: '0f19176e-1c5a-4820-8628-d72c944c97d5', type: 'phase', value: 'pre_trade', sortOrder: 41, isActive: true },
  { id: '15389060-14e8-4d26-a56d-97bda43c585a', type: 'phase', value: 'entry', sortOrder: 42, isActive: true },
  { id: 'ccb76b45-90a8-432d-ad1b-9cf569e409f4', type: 'phase', value: 'risk', sortOrder: 43, isActive: true },
  { id: 'b3933b3c-9d98-405e-b7c7-933230d5c714', type: 'phase', value: 'management', sortOrder: 44, isActive: true },
  { id: 'cd7fb8bc-8821-491d-8457-1702c76073b0', type: 'phase', value: 'exit', sortOrder: 45, isActive: true },
  { id: '85716e82-1a17-4286-af50-d3e078f85c7d', type: 'phase', value: 'psychology', sortOrder: 46, isActive: true },
  { id: 'de688b8d-6f25-4c25-8b34-8d35ece30975', type: 'sector', value: 'technology', sortOrder: 10, isActive: true },
  { id: '78e36d57-fa6f-4eea-9d9a-1e56c34589cb', type: 'sector', value: 'semiconductors', sortOrder: 11, isActive: true },
  { id: '645412c4-8698-4e92-9256-fab760ad835d', type: 'sector', value: 'software', sortOrder: 12, isActive: true },
  { id: '795abba8-93ea-4a1b-9efc-e353df087894', type: 'sector', value: 'biotech', sortOrder: 13, isActive: true },
  { id: '4704d2d8-77ad-4018-88dd-682116197fb3', type: 'sector', value: 'pharma', sortOrder: 14, isActive: true },
  { id: '71f86b6e-2544-478d-9be0-9c4dce6b2d1e', type: 'sector', value: 'energy', sortOrder: 15, isActive: true },
  { id: 'ca1eb48e-0341-43d6-b830-460ea6217c0d', type: 'sector', value: 'financials', sortOrder: 16, isActive: true },
  { id: '8ff1b360-5c49-47b4-8bad-e4ebaf6a083b', type: 'sector', value: 'consumer_cyclical', sortOrder: 17, isActive: true },
  { id: '170f0591-1547-430f-96c8-22bf3a8e7ee6', type: 'sector', value: 'consumer_defensive', sortOrder: 18, isActive: true },
  { id: '4c016c65-1b77-4d47-9f15-ce8141377e48', type: 'sector', value: 'healthcare', sortOrder: 19, isActive: true },
  { id: '3e9b7f36-98ec-41cc-8067-a9145ddcacd3', type: 'sector', value: 'industrials', sortOrder: 20, isActive: true },
  { id: '9cfae722-ae2b-4770-8966-3c1350499422', type: 'sector', value: 'materials', sortOrder: 21, isActive: true },
  { id: 'af394ccf-7575-43dd-89cf-38d4ae8462c2', type: 'sector', value: 'real_estate', sortOrder: 22, isActive: true },
  { id: 'efd07197-96d2-4a24-914d-8507e3ea1208', type: 'sector', value: 'utilities', sortOrder: 23, isActive: true },
  { id: '2e8eceff-55a5-4552-949a-3873b7028fb5', type: 'sector', value: 'communication', sortOrder: 24, isActive: true },
  { id: 'a14b29a4-7657-4de6-ac94-0796cf9262d4', type: 'severity', value: 'minor', sortOrder: 63, isActive: true },
  { id: 'b43f0d1a-ecf5-45a4-9c15-7ea3f68fc147', type: 'severity', value: 'moderate', sortOrder: 64, isActive: true },
  { id: '432da58e-1479-4b3b-9b3c-7735295e2cbe', type: 'severity', value: 'major', sortOrder: 65, isActive: true },
  { id: 'a1019e0d-0e8a-4cae-a5d6-8f1ebc174db5', type: 'severity', value: 'critical', sortOrder: 66, isActive: true },
  { id: '388a1398-3f34-49fb-b006-98a7c4d326c0', type: 'asset_type', value: 'screenshot', sortOrder: 1, isActive: true },
  { id: '1f06faf9-c1e0-49ab-93b4-589ff242cc09', type: 'asset_type', value: 'document', sortOrder: 2, isActive: true },
  { id: '4e14f1f8-69f0-478b-891a-26a347845195', type: 'asset_type', value: 'link', sortOrder: 3, isActive: true },
  { id: 'f85a95e7-0423-4be3-a4d6-9fcd350bbe50', type: 'asset_type', value: 'image', sortOrder: 4, isActive: true },
  { id: 'c72e15ad-3f7d-4508-9e1d-7de15cac7e1c', type: 'asset_type', value: 'other', sortOrder: 5, isActive: true },
  { id: '594b7a3e-75b9-4e22-a121-cf3f933fe1a7', type: 'setup', value: 'breakdown', sortOrder: null, isActive: true },
  { id: '32bc98ee-2c78-49ea-a2fb-aab76010dc62', type: 'setup', value: 'momentum', sortOrder: 0, isActive: true },
  { id: '1b994055-c1cc-421a-b46b-614a32833c1b', type: 'setup', value: 'breakout', sortOrder: 1, isActive: true },
  { id: '3a41aa47-8ac2-473b-8ec5-1630a5d0f1f7', type: 'setup', value: 'pullback', sortOrder: 2, isActive: true },
  { id: '890d2f97-971c-427d-895c-d3443768960c', type: 'setup', value: 'reversal', sortOrder: 3, isActive: true },
  { id: '580a6c0e-1148-4591-ade4-873c8fb46a07', type: 'setup', value: 'range', sortOrder: 4, isActive: true },
  { id: '705890cc-fe6e-435b-acfa-50fe088b99a5', type: 'setup', value: 'gap', sortOrder: 5, isActive: true },
  { id: '2ee5f34d-bb5a-4a83-a67a-4c43b78b3002', type: 'setup', value: 'scalp', sortOrder: 6, isActive: true },
  { id: '78a9fe4f-cf62-46bc-a374-a02e85eb7a05', type: 'setup', value: 'swing', sortOrder: 7, isActive: true },
  { id: 'efc1b4ba-dc5b-45f4-b818-e4e385760ed3', type: 'setup', value: 'pattern', sortOrder: 8, isActive: true },
  { id: 'd095d221-3866-49cf-986a-ca711b25b653', type: 'setup', value: 'news', sortOrder: 9, isActive: true },
  { id: '745ed39b-5c38-4855-85cb-10c44d47991d', type: 'source_type', value: 'weekly_review', sortOrder: 56, isActive: true },
  { id: '532b6c10-543b-4c28-9d2e-5542f57fd67e', type: 'source_type', value: 'trade_review', sortOrder: 57, isActive: true },
  { id: '7e0be55e-a815-4d1d-8a89-cff0bab20ebd', type: 'source_type', value: 'general', sortOrder: 58, isActive: true },
];

const ts = new Date().toISOString();
for (const lv of lookupValues) {
  lv.description = null;
  lv.createdAt = ts;
  lv.updatedAt = ts;
}

// ── Build the ZIP ───────────────────────────────────────────────────────

const zip = new AdmZip();

const tableCounts = {
  app_profile: 1, accounts: 1, settings: 1,
  lookup_values: lookupValues.length, setup_definitions: 1,
  trades: trades.length, trade_executions: executions.length,
  trade_risk_snapshots: riskSnapshots.length, trade_stop_adjustments: stopAdjustments.length,
  trade_assets: 0, trade_grades: grades.length, trade_mistakes: mistakes.length,
  trade_check_results: 0, checklist_definitions: 0,
  watchlist_items: watchlistItems.length, account_transactions: accountTransactions.length,
  account_rollforward: accountRollforward.length, weekly_reviews: weeklyReviews.length,
  review_action_items: reviewActionItems.length,
};

const manifest = {
  schemaVersion: 6, backupTimestamp: ts, appVersion: '0.1.0', tables: tableCounts,
};
zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

const tableData = [
  { name: 'app_profile', data: [{ id: APP_PROFILE_ID, displayName: 'Javier', timezone: 'America/Bogota', defaultCurrency: 'USD', createdAt: ts, updatedAt: ts }] },
  { name: 'accounts', data: [{ id: ACCOUNT_ID, name: 'Paper.Main', broker: 'Schwab', currency: 'USD', isActive: true, maxRiskPerTradePct: 1, defaultCommission: null, startingBalance: 10000, createdAt: ts, updatedAt: ts }] },
  { name: 'settings', data: [{ id: SETTINGS_ID, defaultAccountId: ACCOUNT_ID, startingAccountValue: 10000, maxRiskPerTradePct: 1, defaultCommission: null, journalStartDate: '2026-05-26', currency: 'USD', createdAt: ts, updatedAt: ts }] },
  { name: 'lookup_values', data: lookupValues },
  { name: 'checklist_definitions', data: [] },
  { name: 'setup_definitions', data: [{ id: SETUPS.breakdown, name: 'Breakdown', description: 'Breakdown below key support', howToPlay: null, entryRules: null, exitRules: null, tags: null, defaultRiskPct: null, positionSizingRules: null, chartPatterns: null, isActive: true, createdAt: ts, updatedAt: ts }] },
  { name: 'trades', data: trades },
  { name: 'trade_executions', data: executions },
  { name: 'trade_risk_snapshots', data: riskSnapshots },
  { name: 'trade_stop_adjustments', data: stopAdjustments },
  { name: 'trade_assets', data: [] },
  { name: 'trade_check_results', data: [] },
  { name: 'trade_grades', data: grades },
  { name: 'trade_mistakes', data: mistakes },
  { name: 'watchlist_items', data: watchlistItems },
  { name: 'account_transactions', data: accountTransactions },
  { name: 'account_rollforward', data: accountRollforward },
  { name: 'weekly_reviews', data: weeklyReviews },
  { name: 'review_action_items', data: reviewActionItems },
];

for (const { name, data } of tableData) {
  zip.addFile(`data/${name}.json`, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
}

const outPath = 'test-backup.zip';
zip.writeZip(outPath);

const fsize = statSync(outPath).size;
console.log(`test-backup.zip generated (${(fsize / 1024).toFixed(0)} KB)`);
console.log(`${trades.length} trades across ${[...new Set(trades.map(t => t.symbol))].length} tickers`);
console.log(`Executions: ${executions.length}, Grades: ${grades.length}, Mistakes: ${mistakes.length}`);
console.log(`Weekly reviews: ${weeklyReviews.length}, Watchlist: ${watchlistItems.length}`);
console.log(`Stop adjustments: ${stopAdjustments.length}`);
console.log(`Schema version: 6 — restore via Settings > Restore from Backup`);
