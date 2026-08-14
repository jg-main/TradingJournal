/**
 * add-fill-dialog.test.ts
 *
 * Source-contract tests for the M019/S04/T01 AddFillDialog: the dialog that
 * creates new entry/exit executions for a trade from the Trade Details
 * surface. Covers the module contract, the direction-filtered action catalog
 * (must mirror the server's DIRECTION_ACTIONS table in the executions route
 * so the client never offers an action the API would reject), the entry/exit
 * classification helpers, the POST /api/trades/[id]/executions API contract,
 * validation messages, reset-on-close, and registration in run-all-tests.ts.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/add-fill-dialog.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compSourcePath = path.resolve(__dirname, '../add-fill-dialog.tsx');
const routeSourcePath = path.resolve(
  __dirname,
  '../../../app/api/trades/[id]/executions/route.ts',
);
const runAllTestsPath = path.resolve(
  __dirname,
  '../../../../scripts/run-all-tests.ts',
);

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

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED) — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// AddFillDialog module contract
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## AddFillDialog module contract');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('export function AddFillDialog'), 'exports AddFillDialog as a named export');
  assert(source.includes('interface AddFillDialogProps'), 'defines AddFillDialogProps interface');
  assert(source.includes('export interface AddFillTradeData'), 'exports the AddFillTradeData interface');
  assert(source.includes('trade: AddFillTradeData'), 'accepts trade: AddFillTradeData');
  assert(source.includes('open: boolean'), 'accepts open: boolean (controlled dialog)');
  assert(source.includes('onOpenChange: (open: boolean) => void'), 'accepts onOpenChange: (open: boolean) => void');
  assert(source.includes('onComplete: () => void'), 'accepts onComplete: () => void');
  assert(source.includes("'use client'") || source.includes('"use client"'), 'has use client directive');
  assert(
    source.includes("import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';"),
    'renders inside a Dialog (header/content/footer/close pattern)',
  );
  assert(source.includes("from '@/lib/timezone-context'"), 'uses the app timezone for the default executedAt value');
  assert(
    !source.includes("from '@/app/api") && !source.includes("from '../app/api"),
    'does not import from an API route module (client component stays server-only free)'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Direction-filtered action catalog — must mirror the server contract
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Direction-filtered action catalog');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('FILL_ACTIONS_BY_DIRECTION'), 'exports FILL_ACTIONS_BY_DIRECTION');
  assert(source.includes("long: ['buy', 'add', 'sell', 'reduce']"), 'long trade offers buy/add/sell/reduce');
  assert(source.includes("short: ['sell_short', 'buy_to_cover']"), 'short trade offers sell_short/buy_to_cover');
  assert(source.includes('FILL_ACTION_LABELS'), 'exports FILL_ACTION_LABELS');
  assert(source.includes('getFillActions'), 'exports getFillActions helper');
  assert(source.includes('isEntryAction'), 'exports isEntryAction helper');
  assert(source.includes('isExitAction'), 'exports isExitAction helper');

  // The select options must come from the direction-filtered catalog, never a
  // hardcoded all-actions list (would violate the per-direction API contract).
  const catalogRef = source.indexOf('FILL_ACTIONS_BY_DIRECTION');
  const selectRef = source.indexOf('fillActions.map');
  assert(catalogRef !== -1 && selectRef !== -1 && catalogRef < selectRef, 'the action select maps over the direction-filtered catalog');
  assert(
    source.includes('const fillActions = getFillActions(trade.direction);'),
    'fill actions are derived from the trade direction at render time'
  );
  assert(
    !source.includes("['buy', 'add', 'sell', 'reduce', 'sell_short', 'buy_to_cover']"),
    'no hardcoded all-actions list is rendered (direction filter is the only source)'
  );
}

// ────────────────────────────────────────────────────────────────────────
// POST API contract — the endpoint AddExitDialog / ExecuteDialog use
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## POST /api/trades/[id]/executions contract');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('fetch(`/api/trades/${trade.id}/executions`, {'),
    'posts to POST /api/trades/[id]/executions with the trade id interpolated',
  );
  assert(
    source.includes("method: 'POST'") && source.includes("headers: { 'Content-Type': 'application/json' }"),
    'uses POST with a JSON content type',
  );
  assert(
    source.includes('body: JSON.stringify(body)'),
    'serializes the request body as JSON',
  );
  assert(
    source.includes('action: form.action') &&
      source.includes('quantity: parseFloat(form.quantity)') &&
      source.includes('price: parseFloat(form.price)') &&
      source.includes('fees: parseFloat(form.fees)'),
    'body carries action, quantity, price, and fees (matching createExecutionSchema)',
  );
  assert(
    source.includes('body.executedAt = form.executedAt') && source.includes('if (form.executedAt.trim())'),
    'executedAt is sent only when the user supplied one (schema: optional)',
  );
  assert(
    source.includes('body.notes = form.notes') && source.includes('if (form.notes.trim())'),
    'notes are sent only when the user supplied them (schema: nullable optional)',
  );
  assert(
    source.includes('onComplete();'),
    'calls onComplete() after a successful POST so the page can refetch executions + history feed',
  );
  assert(
    source.includes('onOpenChange(false);'),
    'closes the dialog after a successful POST',
  );

  // Client-side validation mirrors the server's zod rules (quantity/price
  // positive, fees non-negative) so bad input fails fast before the request.
  assert(source.includes("errors.action = 'Action must be selected.'"), 'action validation: must be selected');
  assert(source.includes("errors.quantity = 'Quantity must be greater than 0.'"), 'quantity validation: must be > 0');
  assert(source.includes("errors.price = 'Price must be greater than 0.'"), 'price validation: must be > 0');
  assert(source.includes("errors.fees = 'Fees must be 0 or greater.'"), 'fees validation: must be >= 0');
  assert(source.includes('aria-invalid'), 'invalid fields surface aria-invalid for assistive tech');

  // Network failure path: a thrown fetch surfaces an inline server error.
  assert(source.includes("setServerError('Failed to add fill. Please check your connection.')"), 'network failure surfaces an inline error message');
}

// ────────────────────────────────────────────────────────────────────────
// Reset-on-close: a dismissed dialog must not leak the previous fill
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Reset on dialog close');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('const handleOpenChange = (open: boolean) =>') &&
      source.includes('if (!open) {') &&
      source.includes("action: '',") &&
      source.includes("setFieldErrors({});") &&
      source.includes('setServerError(null);'),
    'closing the dialog resets form, field errors, and server error',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Functional checks on the exported pure helpers (module import must be
// tsx-safe: no server-only deps in the component's transitive imports)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Functional: action catalog, classification, and API parity');

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../add-fill-dialog') as typeof import('../add-fill-dialog');
  const { FILL_ACTIONS_BY_DIRECTION, FILL_ACTION_LABELS, getFillActions, isEntryAction, isExitAction } = mod;

  // 1. Direction subsets in API order
  assertEqual(getFillActions('long').length, 4, 'long trades have exactly 4 fill actions');
  assertEqual(getFillActions('long')[0], 'buy', 'long action #1 is buy (open)');
  assertEqual(getFillActions('long')[1], 'add', 'long action #2 is add (scale in)');
  assertEqual(getFillActions('long')[2], 'sell', 'long action #3 is sell (close)');
  assertEqual(getFillActions('long')[3], 'reduce', 'long action #4 is reduce (scale out)');
  assertEqual(getFillActions('short').length, 2, 'short trades have exactly 2 fill actions');
  assertEqual(getFillActions('short')[0], 'sell_short', 'short action #1 is sell_short (open)');
  assertEqual(getFillActions('short')[1], 'buy_to_cover', 'short action #2 is buy_to_cover (close)');

  // 2. Entry/exit classification
  assertEqual(isEntryAction('buy'), true, 'buy is an entry action');
  assertEqual(isEntryAction('add'), true, 'add is an entry action');
  assertEqual(isEntryAction('sell_short'), true, 'sell_short is an entry action');
  assertEqual(isEntryAction('sell'), false, 'sell is an exit action');
  assertEqual(isEntryAction('reduce'), false, 'reduce is an exit action');
  assertEqual(isEntryAction('buy_to_cover'), false, 'buy_to_cover is an exit action');
  assertEqual(isExitAction('buy'), false, 'buy is not an exit action');
  assertEqual(isExitAction('sell'), true, 'sell is an exit action');
  assertEqual(isExitAction('buy_to_cover'), true, 'buy_to_cover is an exit action');

  // 3. Every fill action has a display label (no undefined labels in the select)
  const allActions = [...getFillActions('long'), ...getFillActions('short')];
  for (const action of allActions) {
    assertEqual(typeof FILL_ACTION_LABELS[action], 'string', `FILL_ACTION_LABELS has a label for "${action}"`);
  }

  // 4. Cross-contract parity: the client catalog MUST equal the server's
  //    DIRECTION_ACTIONS table, or the API would 400 actions we render.
  const routeSource = fs.readFileSync(routeSourcePath, 'utf-8');
  const serverLongMatch = routeSource.match(/long:\s*\[([^\]]+)\]/);
  const serverShortMatch = routeSource.match(/short:\s*\[([^\]]+)\]/);
  assert(serverLongMatch !== null, 'server route declares a long DIRECTION_ACTIONS array');
  assert(serverShortMatch !== null, 'server route declares a short DIRECTION_ACTIONS array');
  if (serverLongMatch && serverShortMatch) {
    const serverLong = serverLongMatch[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    const serverShort = serverShortMatch[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    assertEqual(JSON.stringify(FILL_ACTIONS_BY_DIRECTION.long), JSON.stringify(serverLong), 'client long actions equal server DIRECTION_ACTIONS.long');
    assertEqual(JSON.stringify(FILL_ACTIONS_BY_DIRECTION.short), JSON.stringify(serverShort), 'client short actions equal server DIRECTION_ACTIONS.short');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Orchestration: registered in run-all-tests.ts
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Orchestration registration');

  const runAllSource = fs.readFileSync(runAllTestsPath, 'utf-8');

  assert(
    runAllSource.includes("'src/components/trade-detail/__tests__/add-fill-dialog.test.ts'"),
    'run-all-tests.ts registers the add-fill-dialog source-contract test',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
