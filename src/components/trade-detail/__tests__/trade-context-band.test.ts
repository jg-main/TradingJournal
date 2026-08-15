/**
 * trade-context-band.test.ts
 *
 * Source-contract tests for the M020/S02/T01 extraction: the narrative
 * fields (thesis, invalidation condition, pre-trade plan) moved out of
 * RiskSnapshotCard into a standalone TradeContextBand so the monitoring
 * grid can place them in their own context band below the plan-vs-actual
 * surface. Guards the S02 must-have "Narrative fields removed from
 * RiskSnapshotCard body — no double rendering" at the source level.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/trade-context-band.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bandSourcePath = path.resolve(__dirname, '../trade-context-band.tsx');
const snapshotSourcePath = path.resolve(__dirname, '../risk-snapshot-card.tsx');
const activeViewPath = path.resolve(__dirname, '../active-phase-view.tsx');
const closedViewPath = path.resolve(__dirname, '../closed-phase-view.tsx');
const runAllTestsPath = path.resolve(
  __dirname,
  '../../../../scripts/run-all-tests.ts',
);

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
// TradeContextBand module contract
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## TradeContextBand module contract');

  const source = fs.readFileSync(bandSourcePath, 'utf-8');

  assert(source.includes('export default function TradeContextBand'), 'exports TradeContextBand as default');
  assert(source.includes('interface TradeContextBandProps'), 'defines TradeContextBandProps interface');
  assert(source.includes("'use client'") || source.includes('"use client"'), 'has use client directive');
  assert(
    !source.includes('@/components/ui/card'),
    'renders chrome-free (no Card import — the grid panel owns the chrome)'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Narrative fields — all three moved in with their exact labels
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Narrative fields');

  const source = fs.readFileSync(bandSourcePath, 'utf-8');

  assert(source.includes('thesis?: string | null;'), 'accepts thesis prop');
  assert(source.includes('invalidationCondition?: string | null;'), 'accepts invalidationCondition prop');
  assert(source.includes('preTradePlan?: string | null;'), 'accepts preTradePlan prop');
  assert(source.includes('>Thesis</div>'), 'renders the Thesis label');
  assert(source.includes('>Invalidation</div>'), 'renders the Invalidation label');
  assert(source.includes('>Pre-Trade Plan</div>'), 'renders the Pre-Trade Plan label');
  assert(source.includes('leading-relaxed text-foreground'), 'renders narrative paragraphs in the same readable style');
  assert(
    source.includes("if (!thesis && !invalidationCondition && !preTradePlan)") &&
      source.includes('return null;'),
    'returns null when every field is empty (no empty band)'
  );
}

// ────────────────────────────────────────────────────────────────────────
// No double rendering — RiskSnapshotCard drops the narrative entirely
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## No double rendering (RiskSnapshotCard)');

  const snapshotSource = fs.readFileSync(snapshotSourcePath, 'utf-8');

  assert(!snapshotSource.includes('thesis?: string | null;'), 'RiskSnapshotCard no longer accepts the thesis prop');
  assert(!snapshotSource.includes('invalidationCondition?: string | null;'), 'RiskSnapshotCard no longer accepts the invalidationCondition prop');
  assert(!snapshotSource.includes('preTradePlan?: string | null;'), 'RiskSnapshotCard no longer accepts the preTradePlan prop');
  assert(!snapshotSource.includes('>Thesis</div>'), 'RiskSnapshotCard no longer renders the Thesis label');
  assert(!snapshotSource.includes('>Invalidation</div>'), 'RiskSnapshotCard no longer renders the Invalidation label');
  assert(!snapshotSource.includes('>Pre-Trade Plan</div>'), 'RiskSnapshotCard no longer renders the Pre-Trade Plan label');
  assert(!snapshotSource.includes('Narrative fields'), 'RiskSnapshotCard no longer contains the narrative section');
  assert(!snapshotSource.includes('border-t border-border pt-4'), 'RiskSnapshotCard no longer contains the narrative separator block');
}

// ────────────────────────────────────────────────────────────────────────
// Call-site wiring — phase views no longer thread narrative props to
// RiskSnapshotCard (the band re-enters via ActivePhaseView in S02/T02)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Call-site wiring');

  const activeSource = fs.readFileSync(activeViewPath, 'utf-8');
  const closedSource = fs.readFileSync(closedViewPath, 'utf-8');

  assert(!activeSource.includes('thesis={trade.thesis}'), 'ActivePhaseView no longer passes thesis to RiskSnapshotCard');
  assert(!activeSource.includes('invalidationCondition={trade.invalidationCondition}'), 'ActivePhaseView no longer passes invalidationCondition to RiskSnapshotCard');
  assert(!activeSource.includes('preTradePlan={trade.preTradePlan}'), 'ActivePhaseView no longer passes preTradePlan to RiskSnapshotCard');

  assert(!closedSource.includes('thesis={trade.thesis}'), 'ClosedPhaseView no longer passes thesis to RiskSnapshotCard');
  assert(!closedSource.includes('invalidationCondition={trade.invalidationCondition}'), 'ClosedPhaseView no longer passes invalidationCondition to RiskSnapshotCard');
  assert(!closedSource.includes('preTradePlan={trade.preTradePlan}'), 'ClosedPhaseView no longer passes preTradePlan to RiskSnapshotCard');
}

// ────────────────────────────────────────────────────────────────────────
// Orchestration — registered in run-all-tests.ts
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Orchestration');

  const runAllSource = fs.readFileSync(runAllTestsPath, 'utf-8');
  assert(
    runAllSource.includes("'src/components/trade-detail/__tests__/trade-context-band.test.ts'"),
    'run-all-tests.ts registers the trade-context-band source-contract test'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
