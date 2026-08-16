/** Planned detail retains lifecycle and moves Assets into the shared grid. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.resolve(here, '../trade-detail-grid.css'), 'utf-8');
const source = fs.readFileSync(path.resolve(here, '../planned-phase-view.tsx'), 'utf-8');
const failures: string[] = [];
const assert = (value: boolean, message: string) => value ? console.log(`  ✅ ${message}`) : (failures.push(message), console.error(`  ❌ ${message}`));

console.log('\n## Planned grid');
assert(css.includes(".td-grid--planned") && css.includes("'plan plan plan'\n      'assets assets assets'"), 'planned wide grid gives Assets a full-width final row');
assert(source.includes('<TradeDetailPanel area="assets">') && source.indexOf('<TradeDetailPanel area="assets">') < source.indexOf('</TradeDetailGrid>'), 'planned assets are inside the grid, not an unrelated document-flow card');
assert(source.includes('<TradeDetailPanel area="lifecycle" title="Lifecycle">') && source.includes('<TradeDetailPanel area="plan" title="Plan">'), 'planned phase retains lifecycle and plan panels');
if (failures.length) process.exit(1);
console.log('\nAll planned-grid assertions passed.');
