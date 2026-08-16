/** Execution corrections retain their accounting-true page-owned flow. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const active = fs.readFileSync(path.resolve(here, '../active-phase-view.tsx'), 'utf-8');
const page = fs.readFileSync(path.resolve(here, '../../../app/(legacy)/trades/[id]/page.tsx'), 'utf-8');
const failures: string[] = [];
const assert = (value: boolean, message: string) => value ? console.log(`  ✅ ${message}`) : (failures.push(message), console.error(`  ❌ ${message}`));

console.log('\n## Correction flow');
assert(active.includes('onCorrectExecution?: (execution: Execution) => void;') && active.includes('onCorrectExecution={onCorrectExecution}'), 'History receives the page-owned correction action');
assert(page.includes('const openCorrectExecution') && page.includes('<CorrectionDialog'), 'page owns correction selection and dialog state');
assert(page.includes('onComplete={handleExecutionAdded}'), 'successful correction refreshes executions and the derived detail view');
if (failures.length) process.exit(1);
console.log('\nAll correction-flow assertions passed.');
