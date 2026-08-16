/** Source contract for the approved fixed active-trade grid. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const grid = fs.readFileSync(path.resolve(here, '../trade-detail-grid.tsx'), 'utf-8');
const css = fs.readFileSync(path.resolve(here, '../trade-detail-grid.css'), 'utf-8');
const active = fs.readFileSync(path.resolve(here, '../active-phase-view.tsx'), 'utf-8');
const failures: string[] = [];
const assert = (value: boolean, message: string) => value ? console.log(`  ✅ ${message}`) : (failures.push(message), console.error(`  ❌ ${message}`));

console.log('\n## Trade detail grid');
assert(grid.includes("| 'details'") && grid.includes("| 'assets'"), 'declares standalone details and assets areas');
assert(grid.includes('TradeDetailColumn'), 'uses independent vertical-column primitives');
assert(css.includes("'lifecycle lifecycle lifecycle'\n      'left details right'\n      'assets assets assets'"), 'uses the approved continuous three-column hierarchy plus Assets');
assert(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'), 'uses equal desktop columns');
assert(css.includes('overflow: visible') && !css.includes('overflow-y: auto') && !css.includes('overflow-y: scroll'), 'preserves document-level scrolling without nested scrollbars');
assert(active.includes('<TradeDetailPanel area="details" title="Trade Details">'), 'active view gives Trade Details its own panel');
assert(active.includes('<TradeDetailPanel area="assets">') && active.indexOf('<TradeDetailPanel area="assets">') < active.indexOf('</TradeDetailGrid>'), 'assets occupy the final full-width grid area');
assert(!active.includes('AddExitDialog') && !active.includes('DropdownMenu'), 'active cockpit has one execution action and no overflow menu');

if (failures.length) process.exit(1);
console.log('\nAll trade-detail grid assertions passed.');
