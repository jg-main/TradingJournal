/**
 * planned-phase-grid.test.ts
 *
 * Source-contract tests for the M020/S03 planned-phase grid: planned trades
 * render in the full-bleed .td grid shell with a plan panel (header + trade
 * definition + narrative context + AI assessment) below a full-width
 * lifecycle band at >=1600px, with Execute and Scratch actions preserved and
 * LifecycleStepper in the leading grid panel. Pre-trade screenshots remain
 * below the grid in document flow. No price/risk/history/review columns
 * exist in this phase.
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

  assert(source.includes("'lifecycle'"), 'TradeDetailArea includes the lifecycle area');
  assert(source.includes("'plan'"), 'TradeDetailArea includes the plan area');
  assert(!source.includes("| 'assets'"), 'assets remain outside the named grid areas');
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
// Planned grid template areas — lifecycle followed by plan at all breakpoints
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Planned grid template areas at 3 breakpoints');

  const css = fs.readFileSync(gridCssPath, 'utf-8');

  // 1-column default (<1440px): lifecycle then plan.
  assert(
    css.includes(".td-grid--planned") &&
      css.includes("'lifecycle'") &&
      css.includes("'plan'"),
    'default planned template stacks lifecycle then plan',
  );

  // 1440-1599px: both panels span the grid width.
  assert(
    css.includes("'lifecycle lifecycle'") && css.includes("'plan plan'"),
    '1440px planned template keeps lifecycle and plan full-width',
  );

  // >=1600px: lifecycle and plan both span the operational width.
  assert(
    css.includes("'lifecycle lifecycle lifecycle'") && css.includes("'plan plan plan'"),
    '1600px planned template gives lifecycle and plan the full width',
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

  // The monitoring grid keeps its risk-first arrangement.
  assert(
    css.includes("'lifecycle lifecycle lifecycle'\n      'left risk right'"),
    'monitoring wide template preserves independent side stacks around risk',
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
    css.includes(".td-panel[data-area='lifecycle']") && css.includes('grid-area: lifecycle;'),
    'lifecycle panel maps to the lifecycle grid area',
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

  // Lifecycle leads the grid and pre-trade screenshots remain in document flow.
  assert(
    viewSource.includes('<TradeDetailPanel area="lifecycle" title="Lifecycle">'),
    'PlannedPhaseView renders the lifecycle panel first',
  );
  assert(
    viewSource.includes('<TradeAssetsCard'),
    'PlannedPhaseView renders TradeAssetsCard for pre-trade evidence',
  );

  // Panel order: lifecycle → plan inside the grid, then assets below it.
  const lifecyclePanel = viewSource.indexOf('<TradeDetailPanel area="lifecycle"');
  const planPanel = viewSource.indexOf('<TradeDetailPanel area="plan"');
  const header = viewSource.indexOf('<TradeDetailHeader');
  const planCard = viewSource.indexOf('<TradePlanCard');
  const contextBand = viewSource.indexOf('<TradeContextBand');
  const assessment = viewSource.indexOf('<AssessmentCard');
  const planPanelClose = viewSource.indexOf('</TradeDetailPanel>', planPanel);
  const gridClose = viewSource.indexOf('</TradeDetailGrid>');
  const assets = viewSource.indexOf('<TradeAssetsCard');
  const stepper = viewSource.indexOf('<LifecycleStepper');

  assert(
    planPanel !== -1 && header !== -1 && planCard !== -1 &&
      contextBand !== -1 && assessment !== -1,
    'plan panel contains header, definition, narrative, and assessment',
  );
  assert(
    lifecyclePanel < planPanel && planPanel < header && header < planCard && planCard < contextBand &&
      contextBand < assessment && assessment < planPanelClose,
    'lifecycle leads the plan panel content in operational order',
  );
  assert(
    planPanelClose < gridClose && gridClose < assets,
    'assets render after the plan grid in document flow',
  );
  assert(
    lifecyclePanel < stepper && stepper < planPanel,
    'LifecycleStepper renders in the leading lifecycle panel',
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
  // M020/S04 integration closure: the page wrapper condition extends to
  // closed (open+planned+closed); the planned assertion intent (planned
  // renders full-bleed, no max-w-4xl) is unchanged.
  assert(
    pageSource.includes('className={trade.status === \'open\' || trade.status === \'planned\' || trade.status === \'closed\' ? \'td px-8 py-10\''),
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
