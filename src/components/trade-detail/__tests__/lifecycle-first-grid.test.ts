/**
 * Lifecycle-first trade detail layout contract.
 *
 * The wide monitoring layout follows the approved operational hierarchy:
 * a full-width lifecycle band above independent cockpit/history and
 * context/review stacks around the central risk surface. This prevents a
 * short Context panel from inheriting Cockpit's row height.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/lifecycle-first-grid.test.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gridSource = fs.readFileSync(path.resolve(__dirname, '../trade-detail-grid.tsx'), 'utf-8');
const gridCss = fs.readFileSync(path.resolve(__dirname, '../trade-detail-grid.css'), 'utf-8');
const activeView = fs.readFileSync(path.resolve(__dirname, '../active-phase-view.tsx'), 'utf-8');
const closedView = fs.readFileSync(path.resolve(__dirname, '../closed-phase-view.tsx'), 'utf-8');
const plannedView = fs.readFileSync(path.resolve(__dirname, '../planned-phase-view.tsx'), 'utf-8');

const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ❌ ${message}`);
  }
}

console.log('\n## Lifecycle-first grid contract');

assert(gridSource.includes("| 'lifecycle'"), 'grid exposes a lifecycle area');
assert(
  gridSource.includes("export type TradeDetailStackArea = 'left' | 'right';") &&
    gridSource.includes('export function TradeDetailStack'),
  'grid exposes independent left and right side stacks',
);
assert(
  gridCss.includes('@media (min-width: 1600px)'),
  'three-column operational hierarchy activates at the 1600px workstation breakpoint',
);
assert(
  gridCss.includes("'lifecycle lifecycle lifecycle'\n      'left risk right'") &&
    gridCss.includes('.td-grid-stack {\n  display: contents;'),
  'wide monitoring grid uses independent side stacks around risk',
);
assert(
  gridCss.includes("grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.2fr) minmax(0, 0.9fr);"),
  'wide monitoring grid gives risk a wider central column',
);
assert(
  gridCss.includes(".td-panel[data-area='lifecycle']") && gridCss.includes('grid-area: lifecycle;'),
  'lifecycle panel maps to its named grid area',
);

for (const [name, source] of [
  ['active', activeView],
  ['closed', closedView],
  ['planned', plannedView],
] as const) {
  const gridStart = source.indexOf('<TradeDetailGrid');
  const lifecycle = source.indexOf('<TradeDetailPanel area="lifecycle" title="Lifecycle">');
  const gridClose = source.indexOf('</TradeDetailGrid>');
  assert(
    gridStart !== -1 && lifecycle > gridStart && lifecycle < gridClose,
    `${name} phase renders LifecycleStepper in the top grid band`,
  );
}

for (const [name, source] of [
  ['active', activeView],
  ['closed', closedView],
] as const) {
  assert(
    source.includes('<TradeDetailStack area="left">') &&
      source.includes('<TradeDetailStack area="right">'),
    `${name} phase groups the side panels into independent wide stacks`,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} lifecycle-first layout assertions failed.`);
  process.exit(1);
}

console.log('\nAll lifecycle-first layout assertions passed.');
