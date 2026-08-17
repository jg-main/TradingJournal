/** Closed trades preserve review tooling in the same operational grid. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.resolve(here, '../trade-detail-grid.css'), 'utf-8');
const source = fs.readFileSync(path.resolve(here, '../closed-phase-view.tsx'), 'utf-8');
const failures: string[] = [];
const assert = (value: boolean, message: string) => value ? console.log(`  ✅ ${message}`) : (failures.push(message), console.error(`  ❌ ${message}`));

console.log('\n## Closed trade operational grid');
assert(source.includes('<TradeDetailGrid variant="closed">'), 'closed phase uses the closed grid variant');
assert(source.includes('<TradeDetailPanel area="details" title="Trade Details">'), 'closed phase separates position facts from risk');
assert(source.includes('<TradeDetailMain>') && source.includes('<TradeDetailPanel area="assets">'), 'closed assets belong to the primary two-column workspace');
assert(!source.includes('onEdit?.()') && !source.includes('<Pencil'), 'closed cockpit no longer exposes the broad Edit action');
assert(source.includes('<TradeCollapsibleReviewSection') && source.includes('<TradeCheckResultsCard checkResults={checkResults} />'), 'review retains checklist and progressive disclosure');
assert(css.includes(".td-grid--closed") && css.includes("'main main right'") && css.includes("'left details'\n      'assets assets'"), 'closed wide layout keeps Assets beneath the primary columns');
assert(source.includes('<TradeDetailColumn area="left">') && source.includes('<TradeDetailColumn area="details">') && source.includes('<TradeDetailColumn area="right">'), 'closed phase keeps panel flows vertically continuous');
if (failures.length) process.exit(1);
console.log('\nAll closed-grid assertions passed.');
