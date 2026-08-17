/**
 * Active-trade operational grid contract.
 *
 * The approved workstation layout is a lifecycle band above three independent
 * vertical columns: Cockpit → Context, Trade Details → History, and Risk →
 * Review; Assets span the Cockpit/Context and Trade Details/History workspace
 * beneath those columns. It intentionally avoids grid rows that make shorter
 * panels wait for a taller neighbouring panel.
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
assert(gridSource.includes('TradeDetailColumn') && gridSource.includes('TradeDetailMain'), 'grid exposes independent vertical columns and a primary workspace');

assert(
  gridCss.includes("'lifecycle lifecycle lifecycle'\n      'main main right'") &&
    gridCss.includes("'left details'\n      'assets assets'"),
  'wide grid keeps Assets beneath the left two continuous columns',
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
  gridCss.includes('.td-grid-main') && gridCss.includes('grid-area: main;') &&
    gridCss.includes(".td-panel[data-area='assets']") && gridCss.includes('grid-area: assets;'),
  'Assets panel maps to the primary two-column grid area',
);
assert(
  gridCss.includes('.td-grid-column > .td-panel') && gridCss.includes('width: 100%;'),
  'each panel fills the width of its equal-width continuous column',
);

const gridOpen = activeView.indexOf('<TradeDetailGrid');
const gridClose = activeView.indexOf('</TradeDetailGrid>');
const lifecycle = activeView.indexOf('<TradeDetailPanel area="lifecycle"');
const primaryWorkspace = activeView.indexOf('<TradeDetailMain>');
const leftColumn = activeView.indexOf('<TradeDetailColumn area="left">');
const detailsColumn = activeView.indexOf('<TradeDetailColumn area="details">');
const rightColumn = activeView.indexOf('<TradeDetailColumn area="right">');
const assets = activeView.indexOf('<TradeDetailPanel area="assets"');

assert(
  gridOpen !== -1 && lifecycle > gridOpen && lifecycle < primaryWorkspace && primaryWorkspace < leftColumn &&
    leftColumn < detailsColumn && detailsColumn < assets && assets < rightColumn && rightColumn < gridClose,
  'ActivePhaseView composes Assets beneath the primary two-column workspace before Risk/Review',
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
