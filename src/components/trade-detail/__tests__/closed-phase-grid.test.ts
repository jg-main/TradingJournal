/**
 * closed-phase-grid.test.ts
 *
 * Source-contract tests for the M020/S04 closed-phase grid (T01): closed
 * trades render in the full-bleed .td grid shell with a frozen snapshot
 * (cockpit | risk | history) and a review column containing the checklist
 * plus collapsible review sections (grade, mistakes, AI assessment, exit
 * notes) — four equal columns at >=2560px, the 2x2 fold at 1440-2048px,
 * a single column below that, and no context/assets bands (assets render
 * below the grid in document flow).
 *
 * Guards the T01 must-haves at the source level: the TradeDetailGrid
 * closed variant wiring, the closed grid template at all three
 * breakpoints, the reusable TradeCollapsibleReviewSection component
 * contract (Radix Collapsible primitive, collapsed by default, chevron
 * state rotation, accessible trigger), the shared card-strip chrome rule
 * for section content, and the no-nested-scrollbar document-scroll model.
 * ClosedPhaseView composition and the page-wrapper .td scope extension
 * are guarded by T02's additions to this file.
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

  // 1-column default (<1440px): cockpit, risk, history, review stack.
  assert(
    closedBlock.includes(".td-grid--closed") &&
      closedBlock.includes("'cockpit'") &&
      closedBlock.includes("'risk'") &&
      closedBlock.includes("'history'") &&
      closedBlock.includes("'review'"),
    'default closed template stacks cockpit, risk, history, review rows',
  );

  // 1440-2048px: 2 columns — cockpit+risk above history+review (2x2 fold).
  assert(
    closedBlock.includes("'cockpit risk'") &&
      closedBlock.includes("'history review'"),
    '1440px closed template folds the snapshot into a 2x2',
  );

  // >=2560px: 4 equal columns — cockpit | risk | history | review.
  assert(
    closedBlock.includes("'cockpit risk history review'"),
    '2560px closed template places the frozen snapshot beside the review column',
  );

  // No context/assets bands in the closed arrangement — assets render
  // below the grid in document flow (must-have).
  assert(
    closedBlock.includes('grid-template-areas') &&
      !closedBlock.includes("'context'") &&
      !closedBlock.includes("'assets'"),
    'closed template has no context/assets band areas',
  );

  // The monitoring and planned arrangements are untouched (no S01/S03
  // regression): the monitoring 2560px template and the planned 2560px
  // template both still exist verbatim.
  assert(
    css.includes("'cockpit risk history review'") &&
      css.includes("'context context assets assets'"),
    'monitoring 2560px template unchanged',
  );
  assert(
    css.includes("'plan plan assets assets'"),
    'planned 2560px template unchanged',
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
