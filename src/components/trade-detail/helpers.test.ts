/**
 * helpers.test.ts
 *
 * Tests for the Trade Detail helper functions.
 * Verifies all pure utility functions work correctly with their original logic.
 *
 * Run: npx vitest run src/components/trade-detail/helpers.test.ts
 */

import {
  statusBadgeVariant,
  formatPrice,
  formatCurrency,
  formatDate,
  formatAction,
  toExecutionData,
  statusLabel,
} from './helpers';

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

// ────────────────────────────────────────────────────────────────────────
// statusBadgeVariant
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## statusBadgeVariant');

  const planned = statusBadgeVariant('planned');
  assert(planned.variant === 'secondary', 'planned status returns variant secondary');
  assert(planned.className.includes('bg-blue-100'), 'planned status has blue bg class');

  const open = statusBadgeVariant('open');
  assert(open.variant === 'default', 'open status returns variant default');
  assert(open.className.includes('bg-emerald-100'), 'open status has emerald bg class');

  const closed = statusBadgeVariant('closed');
  assert(closed.variant === 'outline', 'closed status returns variant outline');
  assert(closed.className.includes('text-zinc-500'), 'closed status has zinc text class');

  const deleted = statusBadgeVariant('deleted');
  assert(deleted.variant === 'outline', 'deleted status returns variant outline');
  assert(deleted.className.includes('line-through'), 'deleted status has line-through class');
}

// ────────────────────────────────────────────────────────────────────────
// formatPrice
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## formatPrice');

  assert(formatPrice(null) === '-', 'null returns dash');
  assert(formatPrice(undefined) === '-', 'undefined returns dash');
  assert(formatPrice(0) === '0.00', 'zero formats as 0.00');
  assert(formatPrice(123.4) === '123.40', 'single decimal formats with trailing zero');
  assert(formatPrice(123.456) === '123.46', 'three decimals rounds correctly');
  assert(formatPrice(-50.5) === '-50.50', 'negative values show minus sign');
  assert(formatPrice(1000000.5) === '1,000,000.50', 'large numbers use locale separators');
}

// ────────────────────────────────────────────────────────────────────────
// formatCurrency
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## formatCurrency');

  assert(formatCurrency(null) === '-', 'null returns dash');
  assert(formatCurrency(undefined) === '-', 'undefined returns dash');
  assert(formatCurrency(0) === '$0.00', 'zero formats as $0.00');
  assert(formatCurrency(123.4) === '$123.40', 'positive value formats with dollar sign');
  assert(formatCurrency(-123.4) === '-$123.40', 'negative value shows minus before dollar');
  assert(formatCurrency(-0.5) === '-$0.50', 'negative fractional value');
  assert(formatCurrency(1000) === '$1,000.00', 'large numbers use locale separators');
}

// ────────────────────────────────────────────────────────────────────────
// formatDate
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## formatDate');

  assert(formatDate(null) === '-', 'null returns dash');
  assert(formatDate('') === '-', 'empty string returns dash');

  // Valid ISO date — should produce a locale-formatted string
  const formatted = formatDate('2025-06-15T14:30:00Z');
  assert(formatted !== '-', 'valid date does not return dash');
  assert(formatted.includes('2025') || formatted.includes('25'), 'valid date includes year');
  assert(formatted.includes('Jun') || formatted.includes('06'), 'valid date includes month');
  assert(formatted !== '2025-06-15T14:30:00Z', 'valid date is formatted, not raw');

  // Invalid date does not throw; Date constructor returns Invalid Date
  // which toLocaleDateString renders as a locale-specific 'Invalid Date' string
  const invalid = formatDate('not-a-date');
  assert(typeof invalid === 'string' && invalid.length > 0, 'invalid date returns a non-empty string');
  assert(invalid !== '-', 'invalid date does not return dash');
}

// ────────────────────────────────────────────────────────────────────────
// formatAction
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## formatAction');

  assert(formatAction('buy') === 'Buy', 'buy maps to Buy');
  assert(formatAction('sell') === 'Sell', 'sell maps to Sell');
  assert(formatAction('buy_to_cover') === 'Buy to Cover', 'buy_to_cover maps to Buy to Cover');
  assert(formatAction('sell_short') === 'Sell Short', 'sell_short maps to Sell Short');
  assert(formatAction('add') === 'Add', 'add maps to Add');
  assert(formatAction('reduce') === 'Reduce', 'reduce maps to Reduce');
  assert(formatAction('unknown_action') === 'unknown_action', 'unknown action returns raw value');
}

// ────────────────────────────────────────────────────────────────────────
// toExecutionData
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## toExecutionData');

  const executions = [
    {
      id: 'e1',
      tradeId: 't1',
      action: 'buy',
      quantity: 100,
      price: 50.25,
      fees: 1.5,
      executedAt: '2025-06-15T10:00:00Z',
      reasonId: null,
      notes: null,
      createdAt: '2025-06-15T10:00:00Z',
    },
    {
      id: 'e2',
      tradeId: 't1',
      action: 'sell',
      quantity: 100,
      price: 52.0,
      fees: null,
      executedAt: null,
      reasonId: null,
      notes: null,
      createdAt: '2025-06-16T10:00:00Z',
    },
  ];

  const result = toExecutionData(executions);

  assert(result.length === 2, 'returns same number of items');
  assert(result[0].action === 'buy', 'first item action preserved');
  assert(result[0].price === 50.25, 'first item price preserved');
  assert(result[0].fees === 1.5, 'first item fees preserved');
  assert(result[0].executedAt === '2025-06-15T10:00:00Z', 'first item executedAt preserved');
  assert(result[1].action === 'sell', 'second item action preserved');
  assert(result[1].fees === 0, 'null fees default to 0');
  assert(result[1].executedAt === '2025-06-16T10:00:00Z', 'null executedAt falls back to createdAt');
}

// ────────────────────────────────────────────────────────────────────────
// statusLabel
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## statusLabel');

  assert(statusLabel('planned') === 'Planned', 'planned capitalizes to Planned');
  assert(statusLabel('open') === 'Open', 'open capitalizes to Open');
  assert(statusLabel('closed') === 'Closed', 'closed capitalizes to Closed');
  assert(statusLabel('deleted') === 'Deleted', 'deleted capitalizes to Deleted');
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`
## Results: ${passed}/${total} passed, ${failed}/${total} failed
`);
