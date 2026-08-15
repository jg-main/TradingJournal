/**
 * Source-contract tests for M020's lifecycle-first monitoring layout.
 *
 * At wide viewports the grid is intentionally shaped as:
 * lifecycle (full width), then independent Cockpit/History and
 * Context/Review side stacks around Risk. Assets remain in document flow.
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

{
  console.log('\n## Grid contract');
  const source = fs.readFileSync(gridSourcePath, 'utf-8');
  const css = fs.readFileSync(gridCssPath, 'utf-8');

  assert(source.includes("'lifecycle'"), 'TradeDetailArea includes a lifecycle area');
  assert(source.includes("'context'"), 'TradeDetailArea includes a context area');
  assert(!source.includes("| 'assets'"), 'assets are not a grid area');
  assert(
    source.includes("export type TradeDetailStackArea = 'left' | 'right';") &&
      source.includes('export function TradeDetailStack') &&
      css.includes("'lifecycle lifecycle lifecycle'\n      'left risk right'") &&
      css.includes('.td-grid-stack {\n  display: contents;'),
    'wide grid uses independent side stacks around the central risk surface',
  );
  assert(
    css.includes('grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.2fr) minmax(0, 0.9fr);'),
    'risk receives the deliberate wider centre column',
  );
  assert(
    css.includes(".td-grid.td-grid--without-context") &&
      css.includes("'lifecycle lifecycle lifecycle'\n      'left risk right'"),
    'context-free trades preserve a complete right-side review column',
  );
  assert(
    css.includes(".td-panel[data-area='lifecycle']") && css.includes('grid-area: lifecycle;'),
    'lifecycle panel maps to its grid area',
  );
  assert(
    css.includes(".td-panel[data-area='context']") && css.includes('grid-area: context;'),
    'context panel maps to its grid area',
  );
}

{
  console.log('\n## Active-phase composition');
  const source = fs.readFileSync(activeViewPath, 'utf-8');
  const gridOpen = source.indexOf('<TradeDetailGrid');
  const gridClose = source.indexOf('</TradeDetailGrid>');
  const lifecycle = source.indexOf('<TradeDetailPanel area="lifecycle"');
  const leftStack = source.indexOf('<TradeDetailStack area="left">');
  const cockpit = source.indexOf('<TradeDetailPanel area="cockpit"');
  const history = source.indexOf('<TradeDetailPanel area="history">');
  const rightStack = source.indexOf('<TradeDetailStack area="right">');
  const context = source.indexOf('<TradeDetailPanel area="context"');
  const review = source.indexOf('<TradeDetailPanel area="review"');
  const assets = source.indexOf('<TradeAssetsCard');

  assert(source.includes('hasContextContent={hasContextContent}'), 'grid receives explicit context availability');
  assert(
    lifecycle > gridOpen && lifecycle < cockpit && cockpit < gridClose,
    'LifecycleStepper renders in the leading grid panel before cockpit',
  );
  assert(
    leftStack < cockpit && cockpit < history && history < rightStack &&
      rightStack < context && context < review && review < gridClose,
    'Cockpit/History and Context/Review render in their independent side stacks',
  );
  assert(
    source.includes('<LifecycleStepper') && source.includes('<TradeContextBand'),
    'active view retains lifecycle and narrative context content',
  );
  assert(
    !source.includes('<TradeDetailPanel area="assets"') && assets > gridClose,
    'assets render after the grid in document flow',
  );
}

{
  console.log('\n## Document scroll and orchestration');
  const css = fs.readFileSync(gridCssPath, 'utf-8');
  const runAllSource = fs.readFileSync(runAllTestsPath, 'utf-8');

  assert(css.includes('overflow: visible'), 'panels retain document-level scrolling');
  assert(!css.includes('overflow-y: auto') && !css.includes('overflow-y: scroll'), 'no vertical nested scrollbar');
  assert(
    runAllSource.includes("'src/components/trade-detail/__tests__/trade-detail-grid.test.ts'"),
    'test remains registered in the complete test runner',
  );
}

const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
