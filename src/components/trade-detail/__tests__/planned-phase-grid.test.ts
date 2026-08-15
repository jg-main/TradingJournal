/**
 * planned-phase-grid.test.ts
 *
 * Source-contract tests for the M020/S03 planned-phase grid: planned trades
 * render in the full-bleed .td grid shell with a plan panel (header + trade
 * definition + narrative context + AI assessment) spanning cols 1-2 and an
 * assets panel (pre-trade screenshots) spanning cols 3-4 at >=2560px, with
 * Execute and Scratch actions preserved and LifecycleStepper below the grid
 * in document flow. No price/risk/history/review columns exist in this
 * phase.
 *
 * Guards the S03 must-haves at the source level: the plan grid area and
 * template at all three breakpoints, the TradeDetailGrid planned variant
 * wiring, the panel composition inside PlannedPhaseView, narrative
 * single-ownership (TradePlanCard no longer duplicates thesis /
 * invalidation / pre-trade plan), the page wrapper extending .td to planned
 * status, and the no-nested-scrollbar document-scroll model preserved.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/planned-phase-grid.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gridSourcePath = path.resolve(__dirname, '../trade-detail-grid.tsx');
const gridCssPath = path.resolve(__dirname, '../trade-detail-grid.css');
const plannedViewPath = path.resolve(__dirname, '../planned-phase-view.tsx');
const planCardPath = path.resolve(__dirname, '../trade-plan-card.tsx');
const pagePath = path.resolve(
  __dirname,
  '../../../../src/app/(legacy)/trades/[id]/page.tsx',
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
// Grid area type — the shell knows the planned-phase plan area
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Grid area type');

  const source = fs.readFileSync(gridSourcePath, 'utf-8');

  assert(source.includes("'plan'"), 'TradeDetailArea includes the plan area');
  assert(source.includes("'assets'"), 'TradeDetailArea keeps the assets area');
  assert(source.includes("'context'"), 'TradeDetailArea keeps the context area');
}

// ────────────────────────────────────────────────────────────────────────
// Planned grid variant — TradeDetailGrid supports a planned arrangement
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## TradeDetailGrid planned variant');

  const source = fs.readFileSync(gridSourcePath, 'utf-8');

  assert(
    source.includes("variant?: TradeDetailGridVariant") &&
      source.includes("variant = 'monitoring'"),
    'TradeDetailGrid exposes a variant prop defaulting to monitoring',
  );
  assert(
    source.includes("variant === 'planned'") &&
      source.includes("'td-grid--planned'"),
    'planned variant applies the td-grid--planned class to the grid',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Planned grid template areas — plan and assets at all three breakpoints
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Planned grid template areas at 3 breakpoints');

  const css = fs.readFileSync(gridCssPath, 'utf-8');

  // 1-column default (<1440px): plan then assets stack full-width.
  assert(
    css.includes(".td-grid--planned") &&
      css.includes("'plan'") &&
      css.includes("'assets'"),
    'default planned template stacks plan and assets rows',
  );

  // 1440-2048px: 2 columns, both panels span both columns (full-width).
  assert(
    css.includes("'plan plan'") && css.includes("'assets assets'"),
    '1440px planned template stacks plan and assets full-width',
  );

  // >=2560px: 4 columns, plan spans cols 1-2, assets spans cols 3-4.
  assert(
    css.includes("'plan plan assets assets'"),
    '2560px planned template places plan (cols 1-2) beside assets (cols 3-4)',
  );

  // No price/risk/history/review columns in the planned arrangement.
  // Bound the scan to the variant rule (anchored on the rule definition,
  // not the header-comment mention) so the later [data-area='cockpit']
  // selectors, the monitoring templates, and the M020/S04 closed variant
  // (which does use those areas) don't trip it.
  const panelsSection = css.indexOf('/* ── Panels');
  const closedVariantSection = css.indexOf('.td-grid--closed {');
  const plannedEnd =
    closedVariantSection !== -1
      ? closedVariantSection
      : panelsSection !== -1
        ? panelsSection
        : undefined;
  const plannedBlock = css.slice(css.indexOf('.td-grid--planned {'), plannedEnd);
  assert(
    plannedBlock.includes('grid-template-areas') &&
      !plannedBlock.includes("'cockpit'") &&
      !plannedBlock.includes("'risk'") &&
      !plannedBlock.includes("'history'") &&
      !plannedBlock.includes("'review'"),
    'planned template has no cockpit/risk/history/review areas',
  );

  // The monitoring grid keeps its own arrangement (no S01/S02 regression).
  assert(
    css.includes("'cockpit risk history review'") &&
      css.includes("'context context assets assets'"),
    'monitoring 2560px template unchanged',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Area assignment — the plan panel lands in the plan grid area
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Area assignment');

  const css = fs.readFileSync(gridCssPath, 'utf-8');

  assert(
    css.includes(".td-panel[data-area='plan']") && css.includes('grid-area: plan;'),
    'plan panel maps to the plan grid area',
  );
  assert(
    css.includes(".td-panel[data-area='assets']") && css.includes('grid-area: assets;'),
    'assets panel maps to the assets grid area',
  );
}

// ────────────────────────────────────────────────────────────────────────
// PlannedPhaseView wiring — panels inside the grid, stepper below it
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## PlannedPhaseView wiring');

  const viewSource = fs.readFileSync(plannedViewPath, 'utf-8');

  assert(
    viewSource.includes('<TradeDetailGrid variant="planned">'),
    'PlannedPhaseView renders the grid shell with the planned variant',
  );

  // Plan panel: header + trade definition + narrative context + AI assessment.
  assert(
    viewSource.includes('<TradeDetailPanel area="plan" title="Plan">'),
    'PlannedPhaseView renders the plan panel with its title',
  );
  assert(
    viewSource.includes('<TradeDetailHeader'),
    'plan panel renders TradeDetailHeader (identity + actions)',
  );
  assert(
    viewSource.includes('<TradePlanCard trade={trade} />'),
    'plan panel renders TradePlanCard (trade definition)',
  );
  assert(
    viewSource.includes('<TradeContextBand'),
    'plan panel renders TradeContextBand (narrative context)',
  );
  assert(
    viewSource.includes('(trade.thesis || trade.invalidationCondition || trade.preTradePlan)'),
    'TradeContextBand is gated on narrative content (no empty band)',
  );
  assert(
    viewSource.includes('<AssessmentCard'),
    'plan panel renders AssessmentCard (AI assessment)',
  );

  // Execute and Scratch actions preserved in the header.
  assert(
    viewSource.includes('onClick={onExecute}') && viewSource.includes('Execute'),
    'Execute action preserved in the plan panel header',
  );
  assert(
    viewSource.includes('Scratch') && viewSource.includes('onScratch'),
    'Scratch action preserved in the plan panel header',
  );

  // Assets panel: pre-trade screenshots.
  assert(
    viewSource.includes('<TradeDetailPanel area="assets" title="Assets">'),
    'PlannedPhaseView renders the assets panel with its title',
  );
  assert(
    viewSource.includes('<TradeAssetsCard'),
    'PlannedPhaseView renders TradeAssetsCard inside the assets panel',
  );

  // Panel order: plan → assets inside the grid, then stepper below.
  const planPanel = viewSource.indexOf('<TradeDetailPanel area="plan"');
  const header = viewSource.indexOf('<TradeDetailHeader');
  const planCard = viewSource.indexOf('<TradePlanCard');
  const contextBand = viewSource.indexOf('<TradeContextBand');
  const assessment = viewSource.indexOf('<AssessmentCard');
  const planPanelClose = viewSource.indexOf('</TradeDetailPanel>');
  const assetsPanel = viewSource.indexOf('<TradeDetailPanel area="assets"');
  const gridClose = viewSource.indexOf('</TradeDetailGrid>');
  const stepper = viewSource.indexOf('<LifecycleStepper');

  assert(
    planPanel !== -1 && header !== -1 && planCard !== -1 &&
      contextBand !== -1 && assessment !== -1,
    'plan panel contains header, definition, narrative, and assessment',
  );
  assert(
    planPanel < header && header < planCard && planCard < contextBand &&
      contextBand < assessment && assessment < planPanelClose,
    'plan panel content is ordered header → definition → narrative → assessment',
  );
  assert(
    planPanelClose < assetsPanel && assetsPanel < gridClose,
    'assets panel renders after the plan panel and before the grid closes',
  );
  assert(
    gridClose !== -1 && stepper !== -1 && gridClose < stepper,
    'LifecycleStepper renders below the grid (document flow preserved)',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Narrative single-ownership — TradePlanCard no longer renders narrative
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Narrative single-ownership');

  const planCardSource = fs.readFileSync(planCardPath, 'utf-8');

  assert(
    !planCardSource.includes('thesis') &&
      !planCardSource.includes('invalidationCondition') &&
      !planCardSource.includes('preTradePlan'),
    'TradePlanCard no longer renders narrative fields (no double rendering with TradeContextBand)',
  );
  assert(
    planCardSource.includes('Trade Definition'),
    'TradePlanCard keeps the trade definition surface',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Page wrapper — planned status joins open in the .td scope
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Page wrapper');

  const pageSource = fs.readFileSync(pagePath, 'utf-8');

  assert(
    pageSource.includes("trade.status === 'open' || trade.status === 'planned'"),
    'page.tsx extends the .td wrapper to planned status',
  );
  assert(
    pageSource.includes('className={trade.status === \'open\' || trade.status === \'planned\' ? \'td px-8 py-10\''),
    'planned trades render in the full-bleed td scope (no max-w-4xl)',
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
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
