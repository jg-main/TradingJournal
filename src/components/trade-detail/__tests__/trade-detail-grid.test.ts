/**
 * trade-detail-grid.test.ts
 *
 * Source-contract tests for the M020/S02/T02 band integration: the trade
 * detail grid gains two band areas below the monitoring grid — context
 * (thesis / invalidation / pre-trade plan, cols 1-2 at >=2560px) and
 * assets (stage screenshots, cols 3-4 at >=2560px) — with both bands
 * stacking full-width at <1440px and 1440-2048px. Guards the S02
 * must-haves at the source level: band grid areas at all three
 * breakpoints, TradeAssetsCard moved out of below-grid document flow
 * into the assets grid area, the lifecycle stepper still below the grid,
 * and the no-nested-scrollbar document-scroll model preserved.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/trade-detail-grid.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gridSourcePath = path.resolve(__dirname, '../trade-detail-grid.tsx');
const gridCssPath = path.resolve(__dirname, '../trade-detail-grid.css');
const activeViewPath = path.resolve(__dirname, '../active-phase-view.tsx');
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
// Grid area type — the shell knows the two new band areas
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Grid area type');

  const source = fs.readFileSync(gridSourcePath, 'utf-8');

  assert(source.includes("'cockpit'") && source.includes("'risk'"), 'TradeDetailArea keeps cockpit and risk');
  assert(source.includes("'history'") && source.includes("'review'"), 'TradeDetailArea keeps history and review');
  assert(source.includes("'context'"), 'TradeDetailArea includes the context band area');
  assert(source.includes("'assets'"), 'TradeDetailArea includes the assets band area');
}

// ────────────────────────────────────────────────────────────────────────
// Grid template areas — bands at all three breakpoints
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Grid template areas at 3 breakpoints');

  const css = fs.readFileSync(gridCssPath, 'utf-8');

  // 1-column default (<1440px): bands stack full-width after review.
  assert(
    css.includes("'review'") && css.includes("'context'") && css.includes("'assets'"),
    'default template lists review, context, assets rows',
  );

  // 1440-2048px: 2 columns, bands span both columns (full-width stacked).
  assert(
    css.includes("'cockpit risk'") &&
      css.includes("'history review'") &&
      css.includes("'context context'") &&
      css.includes("'assets assets'"),
    '1440px template stacks both bands full-width (context context / assets assets)',
  );

  // >=2560px: 4 columns, context spans cols 1-2, assets spans cols 3-4.
  assert(
    css.includes("'cockpit risk history review'") &&
      css.includes("'context context assets assets'"),
    '2560px template places context (cols 1-2) beside assets (cols 3-4)',
  );

  // History keeps its own column in every arrangement (no S01 regression).
  assert(
    css.includes("'cockpit risk'") && css.includes("'history review'"),
    'history remains a named column in the 2-col template',
  );
  assert(
    css.includes("'cockpit risk history review'"),
    'history remains a named column in the 4-col template',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Area assignment — panels land in the band areas
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Area assignment');

  const css = fs.readFileSync(gridCssPath, 'utf-8');

  assert(
    css.includes(".td-panel[data-area='context']") && css.includes('grid-area: context;'),
    'context panel maps to the context grid area',
  );
  assert(
    css.includes(".td-panel[data-area='assets']") && css.includes('grid-area: assets;'),
    'assets panel maps to the assets grid area',
  );
}

// ────────────────────────────────────────────────────────────────────────
// ActivePhaseView wiring — bands inside the grid, stepper below it
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## ActivePhaseView wiring');

  const activeSource = fs.readFileSync(activeViewPath, 'utf-8');

  // Context band renders inside the context grid area, gated on narrative
  // content so a narrative-less trade never shows an empty titled band.
  assert(
    activeSource.includes('<TradeDetailPanel area="context" title="Context">'),
    'ActivePhaseView renders the context panel with its title',
  );
  assert(
    activeSource.includes('<TradeContextBand'),
    'ActivePhaseView renders TradeContextBand inside the context panel',
  );
  assert(
    activeSource.includes('(trade.thesis || trade.invalidationCondition || trade.preTradePlan)'),
    'context panel is gated on narrative content (no empty band)',
  );

  // Assets band renders inside the grid, not in below-grid document flow.
  assert(
    activeSource.includes('<TradeDetailPanel area="assets" title="Assets">'),
    'ActivePhaseView renders the assets panel with its title',
  );
  assert(
    activeSource.includes('<TradeAssetsCard'),
    'ActivePhaseView renders TradeAssetsCard inside the assets panel',
  );

  // The assets card no longer lives in its own below-grid div (the old
  // document-flow placement is gone).
  const assetsCardInGrid =
    activeSource.indexOf('<TradeDetailPanel area="assets"') !== -1 &&
    activeSource.indexOf('<TradeDetailPanel area="assets"') <
      activeSource.indexOf('<TradeAssetsCard');
  assert(assetsCardInGrid, 'TradeAssetsCard sits inside the assets grid panel');

  // LifecycleStepper stays accessible below the grid (outside the bands).
  const gridClose = activeSource.indexOf('</TradeDetailGrid>');
  const stepper = activeSource.indexOf('<LifecycleStepper');
  assert(
    gridClose !== -1 && stepper !== -1 && gridClose < stepper,
    'LifecycleStepper renders below the grid (document flow preserved)',
  );

  // Both band panels render between the review panel and the grid close.
  const reviewPanel = activeSource.indexOf('<TradeDetailPanel area="review"');
  const contextPanel = activeSource.indexOf('<TradeDetailPanel area="context"');
  const assetsPanel = activeSource.indexOf('<TradeDetailPanel area="assets"');
  assert(
    reviewPanel !== -1 && contextPanel !== -1 && assetsPanel !== -1 &&
      reviewPanel < contextPanel && contextPanel < assetsPanel && assetsPanel < gridClose,
    'band panels are ordered review → context → assets inside the grid',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Document scroll model — no nested scrollbars introduced
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Document scroll model');

  const css = fs.readFileSync(gridCssPath, 'utf-8');

  assert(css.includes('overflow: visible'), 'panels keep overflow visible (no inner scrolling)');
  assert(!css.includes('overflow-y: auto') && !css.includes('overflow-y: scroll'), 'no panel scrolls vertically');
  assert(!css.includes('overflow-x: auto') && !css.includes('overflow-x: scroll'), 'no panel scrolls horizontally');
  assert(
    !/[a-z-]+\s*:\s*100d?vh/.test(css),
    'no viewport containment — document-level scroll only',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Orchestration — registered in run-all-tests.ts
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Orchestration');

  const runAllSource = fs.readFileSync(runAllTestsPath, 'utf-8');
  assert(
    runAllSource.includes("'src/components/trade-detail/__tests__/trade-detail-grid.test.ts'"),
    'run-all-tests.ts registers the trade-detail-grid source-contract test',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
