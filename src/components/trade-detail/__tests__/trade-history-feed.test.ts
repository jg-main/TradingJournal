/**
 * trade-history-feed.test.ts
 *
 * Source-contract tests for the M019/S03 TradeHistoryFeed: the unified
 * chronological history feed that renders stop adjustments, target
 * adjustments, and execution events in one most-recent-first card,
 * consumed from the S01 level-history API shape and the existing executions
 * fetch. T02 adds the wiring section: the page fetches the level-history API
 * in parallel and passes events to both phase views, which render the feed
 * between the lifecycle summary and the checklist card. S05 removed the
 * standalone Executions/Stop Adjustments cards from both phase views, so the
 * feed is now the last timeline card before the checklist/grade section.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/trade-history-feed.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compSourcePath = path.resolve(__dirname, '../trade-history-feed.tsx');
const pageSourcePath = path.resolve(__dirname, '../../../app/(legacy)/trades/[id]/page.tsx');
const activeViewPath = path.resolve(__dirname, '../active-phase-view.tsx');
const closedViewPath = path.resolve(__dirname, '../closed-phase-view.tsx');
const runAllTestsPath = path.resolve(__dirname, '../../../../scripts/run-all-tests.ts');

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

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED) — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// TradeHistoryFeed module contract
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## TradeHistoryFeed module contract');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('export default function TradeHistoryFeed'), 'exports TradeHistoryFeed as default');
  assert(source.includes('interface TradeHistoryFeedProps'), 'defines TradeHistoryFeedProps interface');
  assert(source.includes('export interface LevelHistoryEvent'), 'exports the LevelHistoryEvent interface (S01 API shape)');
  assert(source.includes("'use client'") || source.includes('"use client"'), 'has use client directive');
  assert(source.includes("import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';"), 'renders inside a Card');
  assert(source.includes("import { History } from 'lucide-react';"), 'uses the History icon for the card title');
  assert(
    !source.includes("from '@/app/api") && !source.includes("from '../app/api"),
    'does not import from an API route module (client component stays server-only free)'
  );
}

// ────────────────────────────────────────────────────────────────────────
// TradeHistoryFeed props interface
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## TradeHistoryFeed props interface');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('levelHistoryEvents: LevelHistoryEvent[]'), 'accepts levelHistoryEvents: LevelHistoryEvent[] (S01 API)');
  assert(source.includes('executions: Execution[]'), 'accepts executions: Execution[] (existing fetch)');
  assert(source.includes("import type { Execution } from './types';"), 'types executions from the shared trade-detail types');
}

// ────────────────────────────────────────────────────────────────────────
// Distinct visual treatment per event type — badge color + detail layout
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Event-type visual treatment');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Stop badge — amber (risk/attention hue per design-system --warning)
  assert(source.includes("'bg-warning/10 text-warning'"), 'stop events carry the amber warning badge (distinct color #1)');
  // Target badge — steel blue (informational hue per design-system --info)
  assert(source.includes("'bg-info/10 text-info'"), 'target events carry the steel-blue info badge (distinct color #2)');
  // Execution badge — action-colored via executionBadgeClass (distinct color #3)
  assert(source.includes('executionBadgeClass(event.action)'), 'execution events color by action via executionBadgeClass');
  assert(
    source.includes("if (action === 'buy' || action === 'add') return 'bg-positive/10 text-positive';"),
    'execution badge: buy/add read positive (mirrors Executions card)'
  );
  assert(
    source.includes("if (action === 'sell' || action === 'reduce' || action === 'sell_short')"),
    'execution badge: sell/reduce/sell_short read negative'
  );
  assert(
    source.includes("return 'bg-info/10 text-info';"),
    'execution badge: unknown/buy_to_cover actions fall back to info'
  );

  // Detail layout per type — level events show old → new with delta; executions show qty @ price
  assert(source.includes("'Stop adjusted:'"), 'stop row description starts with "Stop adjusted:"');
  assert(source.includes('adjusted:`'), 'target row description is "<Target N> adjusted:"');
  assert(source.includes('→'), 'level rows render an old → new arrow');
  assert(source.includes('formatPrice(event.oldValue)'), 'level rows render the previous level value');
  assert(source.includes('formatPrice(event.newValue)'), 'level rows render the new level value');
  assert(source.includes('event.quantity.toLocaleString()'), 'execution rows render the quantity');
  assert(source.includes('formatPrice(event.price)'), 'execution rows render the price');
  assert(source.includes('formatAction(event.action)'), 'execution rows label the action via formatAction');
  assert(source.includes('event.reason'), 'level rows render the adjustment reason when present');
  assert(source.includes('event.notes'), 'execution rows render notes when present');
  assert(source.includes('event.fees != null'), 'execution rows render fees when present');
  assert(source.includes("'Auto' : 'Manual'"), 'rule-based flag renders as Auto/Manual label');
}

// ────────────────────────────────────────────────────────────────────────
// Ordering — one unified most-recent-first feed
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Unified ordering');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('export function compareFeedEventsDesc('), 'exports compareFeedEventsDesc');
  assert(source.includes('export function buildFeedEvents('), 'exports buildFeedEvents');
  assert(source.includes('a.at < b.at ? 1 : -1'), 'primary sort is primary timestamp desc');
  assert(source.includes('a.createdAt < b.createdAt ? 1 : -1'), 'tiebreak is createdAt desc');
  assert(source.includes('a.id < b.id ? 1 : a.id > b.id ? -1 : 0'), 'final tiebreak is id desc (deterministic)');
  assert(
    source.includes("at: e.adjustedAt ?? e.createdAt ?? ''"),
    'level event primary timestamp resolves adjustedAt ?? createdAt'
  );
  assert(
    source.includes("at: e.executedAt ?? e.createdAt ?? ''"),
    'execution primary timestamp resolves executedAt ?? createdAt'
  );
  assert(
    source.includes('.sort(compareFeedEventsDesc)'),
    'feed is re-sorted defensively even if the API returns ascending order'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Empty state + card title
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Empty state and title');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('No history recorded yet.'), 'renders an empty state when no events exist');
  assert(source.includes('events.length === 0'), 'empty state is gated on zero normalized events');
  assert(source.includes('History'), 'card is titled "History"');
}

// ────────────────────────────────────────────────────────────────────────
// Functional checks on the exported pure helpers (module import must be
// tsx-safe: no server-only deps in the component's transitive imports)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Functional: buildFeedEvents ordering and mapping');

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../trade-history-feed') as typeof import('../trade-history-feed');
  const { buildFeedEvents, compareFeedEventsDesc, executionBadgeClass } = mod;

  const stopEvent = {
    type: 'stop' as const,
    id: 'stop-1',
    adjustedAt: '2026-08-01T10:00:00.000Z',
    oldValue: 11.8,
    newValue: 11.5,
    reason: 'Trailing stop',
    ruleBased: true,
    createdAt: '2026-08-01T10:00:00.000Z',
  };
  const targetEvent = {
    type: 'target' as const,
    id: 'tgt-1',
    adjustedAt: '2026-08-02T10:00:00.000Z',
    oldValue: 13.0,
    newValue: 13.25,
    reason: null,
    ruleBased: null,
    targetIndex: 1 as const,
    createdAt: '2026-08-02T10:00:00.000Z',
  };
  const execEvent = {
    id: 'exec-1',
    tradeId: 'trade-1',
    action: 'buy',
    quantity: 100,
    price: 12.4,
    fees: 1.5,
    executedAt: '2026-08-03T10:00:00.000Z',
    reasonId: null,
    notes: 'Scale in',
    createdAt: '2026-08-03T10:00:00.000Z',
  };

  // 1. Interleaved chronological order (most recent first) across all three kinds
  const interleaved = buildFeedEvents([targetEvent, stopEvent], [execEvent]);
  assertEqual(interleaved.length, 3, 'buildFeedEvents merges 2 level events + 1 execution into 3 feed rows');
  assertEqual(interleaved[0].kind, 'execution', 'most recent event (execution, Aug 3) sorts first');
  assertEqual(interleaved[1].kind, 'target', 'second event (target, Aug 2) sorts second');
  assertEqual(interleaved[2].kind, 'stop', 'oldest event (stop, Aug 1) sorts last');

  // 2. Defensive re-sort: ascending API input still yields descending output
  const ascending = buildFeedEvents(
    [stopEvent, targetEvent],
    [],
  );
  assertEqual(ascending[0].kind, 'target', 'level events are re-sorted desc even when the API returns ascending');

  // 3. Tiebreak: same primary timestamp → createdAt desc wins
  const tiebreak = buildFeedEvents(
    [
      { ...targetEvent, id: 'tgt-old', adjustedAt: '2026-08-02T10:00:00.000Z', createdAt: '2026-08-02T09:00:00.000Z' },
      { ...targetEvent, id: 'tgt-new', adjustedAt: '2026-08-02T10:00:00.000Z', createdAt: '2026-08-02T11:00:00.000Z' },
    ],
    [],
  );
  assertEqual(tiebreak[0].id, 'tgt-new', 'equal timestamps tiebreak on createdAt desc');

  // 4. Final tiebreak: same at + createdAt → id desc
  const idTiebreak = buildFeedEvents(
    [
      { ...stopEvent, id: 'b-id', createdAt: '2026-08-01T10:00:00.000Z' },
      { ...stopEvent, id: 'a-id', createdAt: '2026-08-01T10:00:00.000Z' },
    ],
    [],
  );
  assertEqual(idTiebreak[0].id, 'b-id', 'equal at + createdAt tiebreak on id desc');

  // 5. Events without any timestamp sort to the bottom (at resolves to '')
  const noTimestamp = buildFeedEvents(
    [{ ...stopEvent, id: 'no-ts', adjustedAt: null, createdAt: null }],
    [execEvent],
  );
  assertEqual(noTimestamp[noTimestamp.length - 1].id, 'no-ts', 'events with no timestamp sort last');
  assertEqual(noTimestamp[noTimestamp.length - 1].at, '', 'null timestamps resolve to empty string, not undefined');

  // 6. Field mapping is preserved through normalization
  const mapped = buildFeedEvents([stopEvent, targetEvent], [execEvent]);
  const stopRow = mapped.find((e) => e.kind === 'stop')!;
  const targetRow = mapped.find((e) => e.kind === 'target')!;
  const execRow = mapped.find((e) => e.kind === 'execution')!;

  assertEqual(stopRow.kind, 'stop', 'stop event normalizes to kind "stop"');
  assertEqual(stopRow.oldValue, 11.8, 'stop row keeps oldValue');
  assertEqual(stopRow.newValue, 11.5, 'stop row keeps newValue');
  assertEqual(stopRow.reason, 'Trailing stop', 'stop row keeps reason');
  assertEqual(stopRow.ruleBased, true, 'stop row keeps ruleBased');
  assertEqual(stopRow.at, '2026-08-01T10:00:00.000Z', 'stop row at = adjustedAt');

  assertEqual(targetRow.kind, 'target', 'target event normalizes to kind "target"');
  assertEqual(targetRow.targetIndex, 1, 'target row keeps targetIndex');
  assertEqual(targetRow.oldValue, 13.0, 'target row keeps oldValue');
  assertEqual(targetRow.newValue, 13.25, 'target row keeps newValue');

  assertEqual(execRow.kind, 'execution', 'execution normalizes to kind "execution"');
  assertEqual(execRow.action, 'buy', 'execution row keeps action');
  assertEqual(execRow.quantity, 100, 'execution row keeps quantity');
  assertEqual(execRow.price, 12.4, 'execution row keeps price');
  assertEqual(execRow.fees, 1.5, 'execution row keeps fees');
  assertEqual(execRow.notes, 'Scale in', 'execution row keeps notes');
  assertEqual(execRow.at, '2026-08-03T10:00:00.000Z', 'execution row at = executedAt');

  // 7. Fallback timestamp resolution
  const fallbackAt = buildFeedEvents(
    [{ ...stopEvent, id: 'fb', adjustedAt: null, createdAt: '2026-08-01T12:00:00.000Z' }],
    [{ ...execEvent, id: 'fb-exec', executedAt: null }],
  );
  const fbLevel = fallbackAt.find((e) => e.kind === 'stop')!;
  const fbExec = fallbackAt.find((e) => e.kind === 'execution')!;
  assertEqual(fbLevel.at, '2026-08-01T12:00:00.000Z', 'level at falls back to createdAt when adjustedAt is null');
  assertEqual(fbExec.at, '2026-08-03T10:00:00.000Z', 'execution at falls back to createdAt when executedAt is null');

  // 8. compareFeedEventsDesc contract
  assertEqual(compareFeedEventsDesc(execRow, stopRow), -1, 'compareFeedEventsDesc: newer event sorts before older (returns -1)');
  assertEqual(compareFeedEventsDesc(stopRow, execRow), 1, 'compareFeedEventsDesc: older event sorts after newer (returns 1)');
  assertEqual(compareFeedEventsDesc(stopRow, stopRow), 0, 'compareFeedEventsDesc: identical rows compare equal');

  // 9. executionBadgeClass contract
  assertEqual(executionBadgeClass('buy'), 'bg-positive/10 text-positive', 'executionBadgeClass: buy → positive');
  assertEqual(executionBadgeClass('add'), 'bg-positive/10 text-positive', 'executionBadgeClass: add → positive');
  assertEqual(executionBadgeClass('sell'), 'bg-negative/10 text-negative', 'executionBadgeClass: sell → negative');
  assertEqual(executionBadgeClass('reduce'), 'bg-negative/10 text-negative', 'executionBadgeClass: reduce → negative');
  assertEqual(executionBadgeClass('sell_short'), 'bg-negative/10 text-negative', 'executionBadgeClass: sell_short → negative');
  assertEqual(executionBadgeClass('buy_to_cover'), 'bg-info/10 text-info', 'executionBadgeClass: buy_to_cover → info');
  assertEqual(executionBadgeClass('unknown'), 'bg-info/10 text-info', 'executionBadgeClass: unknown action → info fallback');
}

// ────────────────────────────────────────────────────────────────────────
// T02 wiring — page fetches the S01 level-history API in parallel and
// passes events to both phase views; the feed renders between the lifecycle
// summary and the checklist card in each view (S05 removed the standalone
// Executions/Stop Adjustments cards, leaving the feed as the last timeline card)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## T02 wiring (page + phase views)');

  const pageSource = fs.readFileSync(pageSourcePath, 'utf-8');
  const activeSource = fs.readFileSync(activeViewPath, 'utf-8');
  const closedSource = fs.readFileSync(closedViewPath, 'utf-8');
  const runAllSource = fs.readFileSync(runAllTestsPath, 'utf-8');

  // Page: fetches level-history in the same parallel batch as the other data
  assert(
    pageSource.includes('levelHistoryRes') &&
      pageSource.includes('fetch(`/api/trades/${id}/level-history`)'),
    'page fetches GET /api/trades/[id]/level-history as levelHistoryRes'
  );
  assert(
    pageSource.includes('setLevelHistory(await levelHistoryRes.json())'),
    'page stores a non-ok level-history response safely (ok-gated setState)'
  );
  assert(
    pageSource.includes('if (levelHistoryRes.ok) setLevelHistory(await levelHistoryRes.json());'),
    'page only sets levelHistory when the level-history response is ok (graceful degradation)'
  );
  assert(
    pageSource.includes('const [levelHistory, setLevelHistory] = useState<LevelHistoryEvent[]>([]);'),
    'page holds levelHistory state as LevelHistoryEvent[] (starts empty — no events is a valid state)'
  );
  assert(
    pageSource.includes("import type { LevelHistoryEvent } from '@/components/trade-detail/trade-history-feed';"),
    'page types LevelHistoryEvent via the client component export (not the server-only API route)'
  );

  // Page: passes events to both phase views
  assert(
    pageSource.includes('levelHistoryEvents={levelHistory}'),
    'page passes levelHistoryEvents to the phase views'
  );
  const activePassCount = pageSource.split('levelHistoryEvents={levelHistory}').length - 1;
  assertEqual(activePassCount, 2, 'levelHistoryEvents is passed to BOTH ActivePhaseView and ClosedPhaseView');

  // Page: keeps the feed fresh after any adjustment edit (refetch joins the
  // existing stop+target chain refetch)
  assert(
    pageSource.includes('fetch(`/api/trades/${id}/level-history`)') &&
      pageSource.includes('if (lRes.ok) setLevelHistory(await lRes.json());'),
    'handleAdjustmentAdded refetches level-history alongside both chains (feed stays current after edits)'
  );

  // ActivePhaseView: accepts the prop, imports the feed, renders it between
  // the lifecycle summary and the checklist card
  assert(
    activeSource.includes('levelHistoryEvents: LevelHistoryEvent[]'),
    'ActivePhaseView accepts levelHistoryEvents: LevelHistoryEvent[]'
  );
  assert(
    activeSource.includes("import TradeHistoryFeed, { type LevelHistoryEvent } from './trade-history-feed';"),
    'ActivePhaseView imports TradeHistoryFeed (default) + LevelHistoryEvent type'
  );
  assert(
    activeSource.includes('<TradeHistoryFeed') &&
      activeSource.includes('levelHistoryEvents={levelHistoryEvents}') &&
      activeSource.includes('executions={executions}'),
    'ActivePhaseView renders TradeHistoryFeed with levelHistoryEvents + executions'
  );
  const activeLifecycle = activeSource.indexOf('<TradeLifecycleSummaryCard');
  const activeFeed = activeSource.indexOf('<TradeHistoryFeed');
  const activeChecklist = activeSource.indexOf('<TradeCheckResultsCard');
  assert(
    activeLifecycle !== -1 && activeFeed !== -1 && activeChecklist !== -1 &&
      activeLifecycle < activeFeed && activeFeed < activeChecklist,
    'ActivePhaseView places the feed between the lifecycle summary and the checklist card (last timeline card)'
  );
  assert(
    !activeSource.includes('TradeExecutionsCard') &&
      !activeSource.includes('TradeStopAdjustmentsCard'),
    'ActivePhaseView no longer imports or renders TradeExecutionsCard/TradeStopAdjustmentsCard (S05 removal)'
  );

  // ClosedPhaseView: same contract
  assert(
    closedSource.includes('levelHistoryEvents: LevelHistoryEvent[]'),
    'ClosedPhaseView accepts levelHistoryEvents: LevelHistoryEvent[]'
  );
  assert(
    closedSource.includes("import TradeHistoryFeed, { type LevelHistoryEvent } from './trade-history-feed';"),
    'ClosedPhaseView imports TradeHistoryFeed (default) + LevelHistoryEvent type'
  );
  assert(
    closedSource.includes('<TradeHistoryFeed') &&
      closedSource.includes('levelHistoryEvents={levelHistoryEvents}') &&
      closedSource.includes('executions={executions}'),
    'ClosedPhaseView renders TradeHistoryFeed with levelHistoryEvents + executions'
  );
  const closedLifecycle = closedSource.indexOf('<TradeLifecycleSummaryCard');
  const closedFeed = closedSource.indexOf('<TradeHistoryFeed');
  const closedChecklist = closedSource.indexOf('<TradeCheckResultsCard');
  assert(
    closedLifecycle !== -1 && closedFeed !== -1 && closedChecklist !== -1 &&
      closedLifecycle < closedFeed && closedFeed < closedChecklist,
    'ClosedPhaseView places the feed between the lifecycle summary and the checklist card (last timeline card)'
  );
  assert(
    !closedSource.includes('TradeExecutionsCard') &&
      !closedSource.includes('TradeStopAdjustmentsCard'),
    'ClosedPhaseView no longer imports or renders TradeExecutionsCard/TradeStopAdjustmentsCard (S05 removal)'
  );

  // Orchestration: the source-contract test is registered in run-all-tests.ts
  assert(
    runAllSource.includes("'src/components/trade-detail/__tests__/trade-history-feed.test.ts'"),
    'run-all-tests.ts registers the trade-history-feed source-contract test'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
