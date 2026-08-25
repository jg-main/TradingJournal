/** Add Fill is the one active-trade execution entry point. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const details = fs.readFileSync(path.resolve(here, '../trade-details-card.tsx'), 'utf-8');
const active = fs.readFileSync(path.resolve(here, '../active-phase-view.tsx'), 'utf-8');
const page = fs.readFileSync(path.resolve(here, '../../../app/(legacy)/trades/[id]/page.tsx'), 'utf-8');
const dialog = fs.readFileSync(path.resolve(here, '../add-fill-dialog.tsx'), 'utf-8');
const failures: string[] = [];
const assert = (value: boolean, message: string) => value ? console.log(`  ✅ ${message}`) : (failures.push(message), console.error(`  ❌ ${message}`));

console.log('\n## Add Fill ownership');
assert(details.includes('const canAddFill = tradeStatus === \'open\' && !!onAddFill;'), 'only open Trade Details exposes Add Fill');
assert(details.includes('onClick={onAddFill}') && details.includes('>\n            Add Fill'), 'Trade Details owns the visible execution button');
assert(active.includes('onAddFill={onAddFill}') && !active.includes('AddExitDialog'), 'active view forwards only the canonical fill action');
assert(page.includes('<AddFillDialog') && page.includes('onComplete={handleExecutionAdded}'), 'page owns completion and refetch after a fill');
assert(dialog.includes("| 'buy'") && dialog.includes("| 'sell'") && dialog.includes("| 'reduce'"), 'single dialog still supports entry, exit, and reduction actions');
assert(
  dialog.includes('if (!submissionKeyRef.current)') && dialog.includes('body.idempotencyKey = submissionKeyRef.current'),
  'one stable idempotency key is minted per logical submission and reused across retries (M002-A13)',
);
if (failures.length) process.exit(1);
console.log('\nAll Add Fill ownership assertions passed.');
