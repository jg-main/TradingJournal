/**
 * closed-phase-grid.test.ts
 *
 * Source-contract tests for the M020/S04 closed-phase grid (T01): closed
 * trades render in the full-bleed .td grid shell with a frozen snapshot
 * (cockpit | risk | history) and a review column containing the checklist
 * plus collapsible review sections (grade, mistakes, AI assessment, exit
 * notes) — a lifecycle-first three-column workstation hierarchy at >=1600px,
 * a 2x2 fold from 1440px, and a single column below that. Assets render
 * below the grid in document flow.
 *
 * Guards the T01 must-haves at the source level: the TradeDetailGrid
 * closed variant wiring, the closed grid template at all three
 * breakpoints, the reusable TradeCollapsibleReviewSection component
 * contract (Radix Collapsible primitive, collapsed by default, chevron
 * state rotation, accessible trigger), the shared card-strip chrome rule
 * for section content, and the no-nested-scrollbar document-scroll model.
 * T02 additions: ClosedPhaseView composition (panel-to-card mapping,
 * collapsible sections, actions preserved, assets below the grid) and the
 * page-wrapper .td scope extension for closed trades.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/closed-phase-grid.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gridSourcePath = path.resolve(__dirname, '../trade-detail-grid.tsx');
const gridCssPath = path.resolve(__dirname, '../trade-detail-grid.css');
const collapsibleSectionPath = path.resolve(
  __dirname,
  '../trade-collapsible-review-section.tsx',
);
const runAllTestsPath = path.resolve(
  __dirname,
  '../../../../scripts/run-all-tests.ts',
);
const closedPhaseViewPath = path.resolve(
  __dirname,
  '../closed-phase-view.tsx',
);
const pagePath = path.resolve(
  __dirname,
  '../../../app/(legacy)/trades/[id]/page.tsx',
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
// Closed grid variant — TradeDetailGrid supports a closed arrangement
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## TradeDetailGrid closed variant');

  const source = fs.readFileSync(gridSourcePath, 'utf-8');

  assert(
    source.includes("export type TradeDetailGridVariant = 'monitoring' | 'planned' | 'closed';"),
    'TradeDetailGridVariant includes the closed variant',
  );
  assert(
    source.includes("variant = 'monitoring'"),
    'closed trades still default to monitoring when no variant is passed',
  );
  assert(
    source.includes("variant === 'closed'") &&
      source.includes("'td-grid--closed'"),
    'closed variant applies the td-grid--closed class to the grid',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Closed grid template areas — snapshot columns at all three breakpoints
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Closed grid template areas at 3 breakpoints');

  const css = fs.readFileSync(gridCssPath, 'utf-8');

  // The variant block runs from the closed rule to the review-column rules.
  const reviewColumnSection = css.indexOf('/* ── Closed-phase review column');
  const closedBlock = css.slice(
    css.indexOf('.td-grid--closed {'),
    reviewColumnSection !== -1 ? reviewColumnSection : undefined,
  );

  // 1-column default (<1440px): lifecycle leads the stacked decision flow.
  assert(
    closedBlock.includes(".td-grid--closed") &&
      closedBlock.includes("'lifecycle'") &&
      closedBlock.includes("'cockpit'") &&
      closedBlock.includes("'risk'") &&
      closedBlock.includes("'history'") &&
      closedBlock.includes("'context'") &&
      closedBlock.includes("'review'"),
    'default closed template stacks lifecycle, cockpit, risk, history, context, review',
  );

  // 1440-1599px: lifecycle spans above the compact monitoring fold.
  assert(
    closedBlock.includes("'lifecycle lifecycle'") &&
      closedBlock.includes("'cockpit risk'") &&
      closedBlock.includes("'history review'") &&
      closedBlock.includes("'context context'"),
    '1440px closed template keeps lifecycle first and context below the fold',
  );

  // >=1600px: lifecycle spans above the independent left/risk/right columns.
  assert(
    closedBlock.includes("'lifecycle lifecycle lifecycle'") &&
      closedBlock.includes("'left risk right'"),
    '1600px closed template uses independent side stacks around risk',
  );

  // Context is optional inside the grid; assets remain below it in document flow.
  assert(
    closedBlock.includes('grid-template-areas') &&
      !closedBlock.includes("'assets'"),
    'closed template keeps assets out of named grid areas',
  );

  // Monitoring and planned variants retain their intended wide arrangements.
  assert(
    css.includes("'lifecycle lifecycle lifecycle'\n      'left risk right'"),
    'monitoring 1600px template preserves independent side stacks around risk',
  );
  assert(
    css.includes("'lifecycle lifecycle lifecycle'") && css.includes("'plan plan plan'"),
    'planned 1600px template preserves the lifecycle-first hierarchy',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Area assignment — the review panel lands in the review grid area
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Area assignment');

  const css = fs.readFileSync(gridCssPath, 'utf-8');

  assert(
    css.includes(".td-panel[data-area='review']") && css.includes('grid-area: review;'),
    'review panel maps to the review grid area',
  );
  assert(
    css.includes(".td-panel[data-area='cockpit']") && css.includes('grid-area: cockpit;'),
    'cockpit panel maps to the cockpit grid area (frozen header + price)',
  );
  assert(
    css.includes(".td-panel[data-area='risk']") && css.includes('grid-area: risk;'),
    'risk panel maps to the risk grid area (P&L + plan-vs-actual + levels)',
  );
  assert(
    css.includes(".td-panel[data-area='history']") && css.includes('grid-area: history;'),
    'history panel maps to the history grid area (unified feed)',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Collapsible review section — reusable component contract
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## TradeCollapsibleReviewSection contract');

  const source = fs.readFileSync(collapsibleSectionPath, 'utf-8');

  assert(
    source.includes("'use client';"),
    'component is client-side (Radix Collapsible needs browser state)',
  );
  assert(
    source.includes('export function TradeCollapsibleReviewSection'),
    'exports TradeCollapsibleReviewSection',
  );
  assert(
    source.includes('export interface TradeCollapsibleReviewSectionProps'),
    'exports the props interface',
  );

  // Wraps the shadcn/Radix Collapsible primitive (data-slot + data-state).
  assert(
    source.includes("from '@/components/ui/collapsible'") &&
      source.includes('Collapsible,') &&
      source.includes('CollapsibleContent,') &&
      source.includes('CollapsibleTrigger,'),
    'built on the shared shadcn Collapsible primitive',
  );

  // Header is a trigger button with title + optional meta + chevron.
  assert(
    source.includes('<CollapsibleTrigger') &&
      source.includes('td-review-section-trigger'),
    'section header is a CollapsibleTrigger (clickable, aria-expanded wired)',
  );
  assert(
    source.includes('td-review-section-title'),
    'trigger renders the title as its accessible name',
  );
  assert(
    source.includes('td-review-section-meta') &&
      source.includes('meta != null'),
    'trigger renders optional right-aligned meta',
  );
  assert(
    source.includes('<ChevronDown') && source.includes('aria-hidden="true"'),
    'chevron indicator is decorative (aria-hidden)',
  );

  // Body is the collapsible content wrapping children.
  assert(
    source.includes('<CollapsibleContent') &&
      source.includes('td-review-section-content') &&
      source.includes('{children}'),
    'content renders children inside the collapsible body',
  );

  // Collapsed by default — sections start closed, headers stay visible.
  assert(
    source.includes('defaultOpen = false'),
    'review sections default to collapsed (design-system progressive disclosure)',
  );
  assert(
    source.includes('defaultOpen={defaultOpen}'),
    'sections accept a defaultOpen override',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Collapsible review section chrome — state-driven chevron, card strip
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Review section chrome');

  const css = fs.readFileSync(gridCssPath, 'utf-8');

  // Each section is its own bordered chrome unit on the design tokens.
  assert(
    css.includes('.td-review-section {') &&
      css.includes('border: var(--td-border)') &&
      css.includes('background: var(--card)'),
    'section renders as a bordered unit with design-system tokens',
  );

  // The trigger is full-width with the panel-header rhythm.
  assert(
    css.includes('.td-review-section-trigger') &&
      css.includes('width: 100%') &&
      css.includes('min-height: var(--td-panel-header-h)'),
    'trigger spans the section with the panel-header rhythm',
  );

  // Chevron rotates with the Radix data-state attribute.
  assert(
    css.includes(".td-review-section-trigger[data-state='open'] .td-review-section-chevron") &&
      css.includes('rotate(180deg)'),
    'chevron rotation is driven by the collapsible data-state attribute',
  );

  // Legacy cards inside section content drop their chrome (shared strip).
  assert(
    css.includes(".td-review-section-content [data-slot='card']") &&
      css.includes('border: none'),
    'section content reuses the card-strip rule (one chrome unit per section)',
  );
}

// ────────────────────────────────────────────────────────────────────────
// ClosedPhaseView composition (T02) — the closed grid renders the frozen
// snapshot (cockpit | risk | history) beside the review column with
// collapsible grade / mistakes / AI assessment / exit-notes sections, and
// assets render below the grid in document flow
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## ClosedPhaseView grid composition');

  const source = fs.readFileSync(closedPhaseViewPath, 'utf-8');

  // The view renders the grid shell with the closed variant.
  assert(
    source.includes('<TradeDetailGrid variant="closed" hasContextContent={hasContextContent}>'),
    'ClosedPhaseView renders the grid with the closed variant',
  );
  assert(
    source.includes("import { TradeDetailGrid, TradeDetailPanel, TradeDetailStack } from './trade-detail-grid';") &&
      source.includes("import { TradeCollapsibleReviewSection } from './trade-collapsible-review-section';"),
    'composition imports the grid shell and the collapsible section',
  );

  // Cockpit panel: identity header + actions + frozen price + lifecycle summary.
  assert(
    source.includes('<TradeDetailPanel area="cockpit" title="Cockpit">') &&
      source.includes('<TradeDetailHeader') &&
      source.includes('<PriceWidget mtmData={mtmData} onRefreshPrice={onRefreshPrice} frozen />') &&
      source.includes('<TradeLifecycleSummaryCard'),
    'cockpit panel holds identity header, frozen price, and lifecycle summary',
  );

  // Risk panel: P&L / R + plan vs actual + levels.
  assert(
    source.includes('<TradeDetailPanel area="risk" title="Risk">') &&
      source.includes('<TradePnlCard') &&
      source.includes('<RiskSnapshotCard'),
    'risk panel holds P&L and plan-vs-actual + levels',
  );

  // History panel: unified feed (owns its own title).
  assert(
    source.includes('<TradeDetailPanel area="history">') &&
      source.includes('<TradeHistoryFeed'),
    'history panel holds the unified feed (own title)',
  );
  assert(
    source.includes('<TradeDetailStack area="left">') &&
      source.includes('<TradeDetailStack area="right">'),
    'closed side panels render in independent wide stacks',
  );

  // Review panel: checklist stays visible above the collapsible sections.
  assert(
    source.includes('<TradeDetailPanel area="review" title="Review">') &&
      source.includes('<TradeCheckResultsCard checkResults={checkResults} />'),
    'review panel keeps the checklist visible (critical evidence never hides)',
  );
  assert(
    source.includes('title="Grade"') &&
      source.includes('<TradeGradeCard grade={grade} tradeStatus={trade.status} onSave={onGradeSave} />'),
    'grade renders inside a collapsible review section with the grade-label meta',
  );
  assert(
    source.includes('title="Mistakes"') &&
      source.includes('<TradeMistakesCard') &&
      source.includes('meta={mistakes.length > 0'),
    'mistakes render inside a collapsible review section with the count meta',
  );
  assert(
    source.includes('title="AI Assessment"') &&
      source.includes('<AssessmentCard') &&
      source.includes('<AssessmentHistory'),
    'AI assessment (card + history) renders inside a collapsible review section',
  );
  assert(
    source.includes('title="Exit Notes"') &&
      source.includes('<TradeExitNotesCard'),
    'exit notes render inside a collapsible review section',
  );
  assert(
    source.includes('(trade.exitNotes || trade.lesson) &&'),
    'exit notes section is omitted when the trade has no notes (no empty titled section)',
  );
  assert(
    !/defaultOpen/.test(source),
    'review sections use the component default (collapsed) — no override in composition',
  );

  // All existing closed-trade actions preserved.
  assert(
    source.includes('<DropdownMenuItem onClick={() => onEdit?.()}') &&
      source.includes('<Pencil'),
    'Edit action preserved in the cockpit header menu',
  );
  assert(
    source.includes('handleRequestAssessment') &&
      source.includes('<Brain'),
    'Assess action preserved in the cockpit header menu',
  );
  assert(
    source.includes('onGradeSave'),
    'grade save action wired (TradeGradeCard onSave)',
  );
  assert(
    source.includes('onMistakesChanged'),
    'mistake add/edit action wired',
  );
  assert(
    source.includes('onAssetsChanged'),
    'assets action wired',
  );
  assert(
    source.includes('onAddFill'),
    'add fill action wired (RiskSnapshotCard level editing)',
  );
  assert(
    source.includes('onCorrectExecution'),
    'correct execution action wired (history feed)',
  );
  assert(
    source.includes('onExecutionAdded'),
    'execution-added refetch hook preserved',
  );

  // Lifecycle renders in the grid; assets render below it in document flow.
  assert(
    source.indexOf('<TradeAssetsCard') > source.indexOf('</TradeDetailGrid>'),
    'assets render below the grid in document flow (must-have)',
  );
  assert(
    source.includes('defaultPhase="review"'),
    'assets band keeps the review phase default',
  );
  assert(
    source.indexOf('<TradeDetailPanel area="lifecycle"') > source.indexOf('<TradeDetailGrid') &&
      source.indexOf('<LifecycleStepper') < source.indexOf('<TradeDetailPanel area="cockpit"'),
    'lifecycle stepper renders in the leading grid panel',
  );
  assert(
    source.includes('hasGrade={!!grade}') && source.includes('hasMistakes={mistakes.length > 0}'),
    'stepper still reflects grade/mistake state',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Page wrapper (T02) — the .td scope extends to closed trades
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Page wrapper .td scope');

  const source = fs.readFileSync(pagePath, 'utf-8');

  assert(
    source.includes("trade.status === 'open' || trade.status === 'planned' || trade.status === 'closed'") &&
      source.includes("'td px-8 py-10'"),
    'page wrapper extends the .td scope to closed trades (same condition pattern as S03 planned)',
  );
  assert(
    source.includes("trade.status === 'closed' &&") &&
      source.includes('<ClosedPhaseView'),
    'closed status still routes to ClosedPhaseView',
  );
  assert(
    !source.includes("trade.status === 'closed' ? 'mx-auto max-w-4xl"),
    'closed trades no longer render in the max-w-4xl legacy shell',
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
    runAllSource.includes("'src/components/trade-detail/__tests__/closed-phase-grid.test.ts'"),
    'run-all-tests.ts registers the closed-phase-grid source-contract test',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
