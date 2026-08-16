/**
 * Active-trade operational grid contract.
 *
 * The approved workstation layout is a lifecycle band above three independent
 * vertical columns: Cockpit → Context, Trade Details → History, and Risk →
 * Review; Assets span underneath. It intentionally avoids grid rows that
 * make shorter panels wait for a taller neighbouring panel.
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

const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ❌ ${message}`);
  }
}

console.log('\n## Active-trade operational grid contract');

assert(gridSource.includes("| 'lifecycle'"), 'grid exposes a lifecycle area');
assert(gridSource.includes("| 'details'"), 'grid exposes a standalone Trade Details area');
assert(gridSource.includes("| 'assets'"), 'grid exposes an Assets area');
assert(gridSource.includes('TradeDetailColumn'), 'grid exposes independent vertical columns');

assert(
  gridCss.includes("'lifecycle lifecycle lifecycle'\n      'left details right'\n      'assets assets assets'"),
  'wide grid keeps independent columns below Lifecycle and above Assets',
);
assert(
  gridCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'),
  'wide grid uses the approved equal-width operational columns',
);
assert(
  gridCss.includes(".td-panel[data-area='details']") && gridCss.includes('grid-area: details;'),
  'Trade Details panel maps to its named grid area',
);
assert(
  gridCss.includes(".td-panel[data-area='assets']") && gridCss.includes('grid-area: assets;'),
  'Assets panel maps to its full-width grid area',
);
assert(
  gridCss.includes('.td-grid-column > .td-panel') && gridCss.includes('width: 100%;'),
  'each panel fills the width of its equal-width continuous column',
);

const gridOpen = activeView.indexOf('<TradeDetailGrid');
const gridClose = activeView.indexOf('</TradeDetailGrid>');
const lifecycle = activeView.indexOf('<TradeDetailPanel area="lifecycle"');
const leftColumn = activeView.indexOf('<TradeDetailColumn area="left">');
const detailsColumn = activeView.indexOf('<TradeDetailColumn area="details">');
const rightColumn = activeView.indexOf('<TradeDetailColumn area="right">');
const assets = activeView.indexOf('<TradeDetailPanel area="assets"');

assert(
  gridOpen !== -1 && lifecycle > gridOpen && lifecycle < leftColumn && leftColumn < detailsColumn &&
    detailsColumn < rightColumn && rightColumn < assets && assets < gridClose,
  'ActivePhaseView composes Lifecycle, the three continuous columns, and Assets in scan order',
);
assert(
  activeView.includes('<TradeDetailPanel area="cockpit"') && activeView.includes('<TradeDetailPanel area="context"') &&
    activeView.includes('<TradeDetailPanel area="details"') && activeView.includes('<TradeDetailPanel area="history"') &&
    activeView.includes('<TradeDetailPanel area="risk"') && activeView.includes('<TradeDetailPanel area="review"'),
  'each continuous column keeps its two owning panels together',
);
assert(
  !activeView.includes('AddExitDialog') && !activeView.includes('MoreHorizontal') &&
    !activeView.includes('DropdownMenu'),
  'Cockpit has no duplicate Add Exit action or overflow menu',
);

if (failures.length > 0) {
  console.error(`\n${failures.length} active-trade operational grid assertions failed.`);
  process.exit(1);
}

console.log('\nAll active-trade operational grid assertions passed.');
