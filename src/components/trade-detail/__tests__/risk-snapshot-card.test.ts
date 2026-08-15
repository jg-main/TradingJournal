/**
 * risk-snapshot-card.test.ts
 *
 * Source-contract tests for the M019/S02 extraction: the inline Price Levels
 * table moved out of RiskSnapshotCard into a standalone TradeDetailsCard that
 * renders Plan / Current / Market columns with the current stop and targets
 * derived from the adjustment chains via trade-levels.ts (deriveCurrentStop /
 * deriveCurrentTarget). MTM stays gated to open trades.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/risk-snapshot-card.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compSourcePath = path.resolve(__dirname, '../risk-snapshot-card.tsx');
const detailsSourcePath = path.resolve(__dirname, '../trade-details-card.tsx');
const helpersSourcePath = path.resolve(__dirname, '../helpers.ts');
const levelsSourcePath = path.resolve(__dirname, '../../../lib/trade-levels.ts');
const activeViewPath = path.resolve(__dirname, '../active-phase-view.tsx');
const closedViewPath = path.resolve(__dirname, '../closed-phase-view.tsx');
const pagePath = path.resolve(__dirname, '../../../app/(legacy)/trades/[id]/page.tsx');

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

// ────────────────────────────────────────────────────────────────────────
// RiskSnapshotCard module contract
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## RiskSnapshotCard module contract');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('export default function RiskSnapshotCard'), 'exports RiskSnapshotCard as default');
  assert(source.includes('interface RiskSnapshotCardProps'), 'defines RiskSnapshotCardProps interface');
  assert(source.includes("'use client'") || source.includes('"use client"'), 'has use client directive');
  assert(source.includes("import TradeDetailsCard from './trade-details-card';"), 'imports TradeDetailsCard');
}

// ────────────────────────────────────────────────────────────────────────
// RiskSnapshotCard props interface
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## RiskSnapshotCard props interface');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('riskSnapshot: RiskSnapshot | null'), 'accepts riskSnapshot prop');
  assert(source.includes('plannedValues'), 'accepts plannedValues prop');
  assert(source.includes('actualValues'), 'accepts actualValues prop');
  assert(source.includes('mtmData?: MtmData'), 'accepts optional mtmData prop');
  assert(source.includes('onRefreshPrice?: () => void'), 'accepts optional onRefreshPrice callback');
  assert(source.includes('tradeStatus?: Trade'), 'accepts optional tradeStatus prop');
  assert(source.includes('stopAdjustments?: StopAdjustment[]'), 'accepts optional stopAdjustments prop');
  assert(source.includes('targetAdjustments?: TargetAdjustment[]'), 'accepts optional targetAdjustments prop');
}

// ────────────────────────────────────────────────────────────────────────
// Price Levels extraction — the inline table must be gone from
// RiskSnapshotCard and live in TradeDetailsCard
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Price Levels extraction');

  const snapshotSource = fs.readFileSync(compSourcePath, 'utf-8');
  const detailsSource = fs.readFileSync(detailsSourcePath, 'utf-8');

  assert(
    !snapshotSource.includes('Price Levels'),
    'RiskSnapshotCard no longer contains the inline "Price Levels" title'
  );
  assert(
    snapshotSource.includes('<TradeDetailsCard') || snapshotSource.includes('<TradeDetailsCard\n'),
    'RiskSnapshotCard renders TradeDetailsCard in the two-column grid'
  );
  assert(
    detailsSource.includes('Trade Details'),
    'TradeDetailsCard carries the "Trade Details" card title'
  );
  assert(
    detailsSource.includes('>Entry</td>') && detailsSource.includes('>Stop</td>'),
    'TradeDetailsCard renders Entry/Stop rows'
  );
  assert(
    detailsSource.includes('>Target 1</td>') && detailsSource.includes('>Target 2</td>'),
    'TradeDetailsCard renders Target 1 / Target 2 rows'
  );
  assert(detailsSource.includes('>Qty</td>'), 'TradeDetailsCard renders Qty row');
}

// ────────────────────────────────────────────────────────────────────────
// TradeDetailsCard module contract
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## TradeDetailsCard module contract');

  const source = fs.readFileSync(detailsSourcePath, 'utf-8');

  assert(source.includes('export default function TradeDetailsCard'), 'exports TradeDetailsCard as default');
  assert(source.includes('interface TradeDetailsCardProps'), 'defines TradeDetailsCardProps interface');
  assert(source.includes("'use client'") || source.includes('"use client"'), 'has use client directive');
}

// ────────────────────────────────────────────────────────────────────────
// Live value derivation — current stop/targets come from trade-levels.ts
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Live value derivation');

  const source = fs.readFileSync(detailsSourcePath, 'utf-8');
  const levelsSource = fs.readFileSync(levelsSourcePath, 'utf-8');

  assert(
    source.includes("import { deriveCurrentStop, deriveCurrentTarget } from '@/lib/trade-levels';"),
    'imports deriveCurrentStop and deriveCurrentTarget from trade-levels'
  );
  assert(
    source.includes('deriveCurrentStop(planStop ?? null, initialStopPrice'),
    'current stop derived via deriveCurrentStop(plannedStop, initialStopPrice, adjustments)'
  );
  assert(
    source.includes('deriveCurrentTarget(planTarget1, 1, targetAdjustments)'),
    'current target 1 derived via deriveCurrentTarget(plannedTarget1, index 1, adjustments)'
  );
  assert(
    source.includes('deriveCurrentTarget(planTarget2, 2, targetAdjustments)'),
    'current target 2 derived via deriveCurrentTarget(plannedTarget2, index 2, adjustments)'
  );

  // The derivation helpers themselves must exist in the pure lib (M019 canonical logic)
  assert(levelsSource.includes('export function deriveCurrentStop('), 'trade-levels exports deriveCurrentStop');
  assert(levelsSource.includes('export function deriveCurrentTarget('), 'trade-levels exports deriveCurrentTarget');
  assert(levelsSource.includes('export function compareLevelEventsDesc('), 'trade-levels exports compareLevelEventsDesc');
}

// ────────────────────────────────────────────────────────────────────────
// Plan / Current / Market column structure
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Plan / Current / Market columns');

  const source = fs.readFileSync(detailsSourcePath, 'utf-8');

  assert(source.includes('>Plan</th>'), 'renders Plan column header');
  assert(source.includes('>Current</th>'), 'renders Current column header');
  assert(source.includes('>Market</th>'), 'renders Market column header');
  assert(source.includes('const hasPlan = !!plannedValues;'), 'Plan column gated on plannedValues');
  assert(source.includes('const hasMtm = mtmData?.price != null && tradeStatus === \'open\''), 'Market column gated on open trade + MTM price');
}

// ────────────────────────────────────────────────────────────────────────
// MTM status gating — safe when mtmData present but tradeStatus non-open
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## MTM status gating (error resilience)');

  const snapshotSource = fs.readFileSync(compSourcePath, 'utf-8');
  const detailsSource = fs.readFileSync(detailsSourcePath, 'utf-8');

  assert(
    detailsSource.includes("tradeStatus === 'open'") || detailsSource.includes('tradeStatus === "open"'),
    'TradeDetailsCard MTM section gated on tradeStatus === "open"'
  );
  assert(
    detailsSource.includes('mtmData?.price != null'),
    'TradeDetailsCard MTM gated on mtmData?.price != null (optional chaining — no crash when mtmData absent)'
  );
  assert(
    snapshotSource.includes('mtmData?.price != null && tradeStatus'),
    'RiskSnapshotCard MTM uses safe conditional (&&) — no crash when mtmData present but tradeStatus non-open'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Zero-value handling — helpers.formatCurrency(0) must be $0.00, MTM color
// uses >= 0 so zero renders as non-negative
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Zero-value handling');

  const snapshotSource = fs.readFileSync(compSourcePath, 'utf-8');
  const helpersSource = fs.readFileSync(helpersSourcePath, 'utf-8');

  assert(snapshotSource.includes('formatCurrency'), 'RiskSnapshotCard uses formatCurrency utility');

  // MTM return color uses >= 0 (zero shows the positive/neutral class, not negative)
  assert(
    snapshotSource.includes('mtmReturnPct >= 0') || snapshotSource.includes('mtmReturnDollar >= 0'),
    'MTM color uses >= 0 comparison (zero shows neutral, not negative)'
  );

  // helpers.formatCurrency: negative branch uses -$, everything else uses plain $
  assert(
    helpersSource.includes("v < 0) return `-$${formatted}`") || helpersSource.includes("if (v < 0) return `-$${formatted}`"),
    'helpers.formatCurrency only signs negative values (zero renders as $0.00)'
  );
}

// ────────────────────────────────────────────────────────────────────────
// T02 edit affordances — open trades get inline stop/target editing that
// POSTs to the S01 adjustment APIs; closed/planned/deleted stay read-only
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## T02 Edit affordances (TradeDetailsCard)');

  const source = fs.readFileSync(detailsSourcePath, 'utf-8');

  assert(source.includes('tradeId?: string'), 'TradeDetailsCard accepts optional tradeId prop');
  assert(source.includes('onAdjustmentsChanged?: () => Promise<void>'), 'TradeDetailsCard accepts onAdjustmentsChanged refetch callback');
  assert(
    source.includes("const canEdit = tradeStatus === 'open' && !!tradeId;"),
    'edit affordances gated on open trade + tradeId (must-have #3/#5)'
  );
  assert(
    source.includes('/api/trades/${tradeId}/stop-adjustments') &&
      source.includes('/api/trades/${tradeId}/target-adjustments'),
    'edit form POSTs to the S01 stop-adjustments and target-adjustments endpoints'
  );
  assert(source.includes('newStop: value'), 'stop edits send newStop (previousStop server-derived, M019)');
  assert(source.includes('targetIndex: editingLevel === \'target1\' ? 1 : 2'), 'target edits send targetIndex 1/2');
  assert(source.includes('newTarget: value'), 'target edits send newTarget');
  assert(source.includes('onAdjustmentsChanged?.()'), 'refetches via onAdjustmentsChanged after successful edit');
  assert(
    source.includes("setMessage({ type: 'error'")
  , 'inline error message state (same pattern as TradeStopAdjustmentsCard)');
  assert(source.includes('New level must be a positive number.'), 'client-side validation rejects non-positive levels before POST');
  assert(source.includes('aria-label={`Adjust ${label}`}'), 'edit buttons carry accessible labels');
  assert(source.includes('role="alert"'), 'inline form errors are announced via role=alert');
}

// ────────────────────────────────────────────────────────────────────────
// T02 data wiring — chains flow page → phase views → RiskSnapshotCard →
// TradeDetailsCard; page fetches target-adjustments in parallel
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## T02 Data wiring');

  const snapshotSource = fs.readFileSync(compSourcePath, 'utf-8');
  const activeSource = fs.readFileSync(activeViewPath, 'utf-8');
  const closedSource = fs.readFileSync(closedViewPath, 'utf-8');
  const pageSource = fs.readFileSync(pagePath, 'utf-8');

  assert(snapshotSource.includes('tradeId?: string'), 'RiskSnapshotCard accepts optional tradeId prop');
  assert(snapshotSource.includes('onAdjustmentsChanged?: () => Promise<void>'), 'RiskSnapshotCard accepts onAdjustmentsChanged callback');
  assert(snapshotSource.includes('tradeId={tradeId}'), 'RiskSnapshotCard forwards tradeId to TradeDetailsCard');
  assert(snapshotSource.includes('onAdjustmentsChanged={onAdjustmentsChanged}'), 'RiskSnapshotCard forwards onAdjustmentsChanged to TradeDetailsCard');

  assert(activeSource.includes('targetAdjustments: TargetAdjustment[]'), 'ActivePhaseView accepts targetAdjustments');
  assert(activeSource.includes('onAdjustmentsChanged: () => Promise<void>'), 'ActivePhaseView accepts onAdjustmentsChanged');
  assert(activeSource.includes('targetAdjustments={targetAdjustments}'), 'ActivePhaseView passes targetAdjustments to RiskSnapshotCard');
  assert(activeSource.includes('onAdjustmentsChanged={onAdjustmentsChanged}'), 'ActivePhaseView passes onAdjustmentsChanged to RiskSnapshotCard');
  assert(activeSource.includes('tradeId={trade.id}'), 'ActivePhaseView passes trade.id for inline editing');

  assert(closedSource.includes('targetAdjustments: TargetAdjustment[]'), 'ClosedPhaseView accepts targetAdjustments (read-only Current values)');
  assert(closedSource.includes('targetAdjustments={targetAdjustments}'), 'ClosedPhaseView passes targetAdjustments to RiskSnapshotCard');
  assert(closedSource.includes('tradeId={trade.id}'), 'ClosedPhaseView passes trade.id');

  assert(pageSource.includes('target-adjustments'), 'page fetches /target-adjustments alongside stop-adjustments');
  assert(pageSource.includes('targetAdjustments, setTargetAdjustments'), 'page holds targetAdjustments state');
  assert(
    pageSource.includes('onAdjustmentsChanged={handleAdjustmentAdded}'),
    'page passes the same chain-refetch handler as onAdjustmentsChanged'
  );
  assert(
    pageSource.includes('fetch(`/api/trades/${id}/target-adjustments`)') &&
      pageSource.includes('if (tRes.ok) setTargetAdjustments(await tRes.json());'),
    'page refetch refreshes BOTH stop and target chains after an edit'
  );
}

// ────────────────────────────────────────────────────────────────────────
// M020/S02/T01 narrative extraction — thesis/invalidation/pre-trade plan
// moved to TradeContextBand; RiskSnapshotCard must not render them again
// (S02 must-have: no double rendering)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Narrative extraction (M020/S02)');

  const snapshotSource = fs.readFileSync(compSourcePath, 'utf-8');
  const bandSourcePath = path.resolve(__dirname, '../trade-context-band.tsx');
  const bandSource = fs.readFileSync(bandSourcePath, 'utf-8');

  assert(bandSource.includes('export default function TradeContextBand'), 'TradeContextBand extracted as a standalone component');
  assert(bandSource.includes('>Thesis</div>'), 'TradeContextBand renders the Thesis label');
  assert(bandSource.includes('>Invalidation</div>'), 'TradeContextBand renders the Invalidation label');
  assert(bandSource.includes('>Pre-Trade Plan</div>'), 'TradeContextBand renders the Pre-Trade Plan label');

  assert(!snapshotSource.includes('thesis?: string | null;'), 'RiskSnapshotCard no longer accepts the thesis prop');
  assert(!snapshotSource.includes('invalidationCondition?: string | null;'), 'RiskSnapshotCard no longer accepts the invalidationCondition prop');
  assert(!snapshotSource.includes('preTradePlan?: string | null;'), 'RiskSnapshotCard no longer accepts the preTradePlan prop');
  assert(!snapshotSource.includes('>Pre-Trade Plan</div>'), 'RiskSnapshotCard no longer renders the Pre-Trade Plan label');
  assert(!snapshotSource.includes('Narrative fields'), 'RiskSnapshotCard no longer contains the narrative section');
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
