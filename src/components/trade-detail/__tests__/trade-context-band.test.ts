/** Context fields are edited where they are read. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '../trade-context-band.tsx'), 'utf-8');
const active = fs.readFileSync(path.resolve(here, '../active-phase-view.tsx'), 'utf-8');
const failures: string[] = [];
const assert = (value: boolean, message: string) => value ? console.log(`  ✅ ${message}`) : (failures.push(message), console.error(`  ❌ ${message}`));

console.log('\n## Context field editing');
assert(source.includes("type ContextField = 'thesis' | 'invalidationCondition' | 'preTradePlan';"), 'defines the three persisted narrative fields');
assert(source.includes("label: 'Thesis'") && source.includes("label: 'Invalidation'") && source.includes("label: 'Pre-Trade Plan'"), 'renders all Context fields with their labels');
assert(source.includes('tradeId?: string;') && source.includes('onTradeChanged?: () => Promise<void>;'), 'accepts a section-owned update contract');
assert(source.includes('body: JSON.stringify({ [editingField]: draft.trim() || null })'), 'saves only the field being edited');
assert(source.includes('aria-label={`${value ? \'Edit\' : \'Add\'} ${field.label}`}'), 'each context field has an accessible local edit or add control');
assert(source.includes('Save') && source.includes('Cancel') && source.includes('role="alert"'), 'inline editor exposes save, cancel, and error recovery');
assert(source.includes('preTradeFrozen = false') && source.includes('!preTradeFrozen'), 'M002-A4: the edit affordance is disabled once pre-trade context is frozen (execution history)');
assert(active.includes('tradeId={trade.id}') && active.includes('onTradeChanged={onTradeChanged}'), 'active trade wires the Context editor to the page refresh owner');
assert(active.includes('preTradeFrozen={trade.preTradeFrozen}'), 'M002-A4: active trade passes the execution-history freeze signal to the band');

if (failures.length) process.exit(1);
console.log('\nAll Context field-editing assertions passed.');
