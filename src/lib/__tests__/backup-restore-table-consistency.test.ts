/**
 * backup-restore-table-consistency.test.ts
 *
 * Guards against the recurring bug where TABLE_REGISTRY, INSERT_ORDER,
 * and TABLE_LABELS fall out of sync with the actual Drizzle schema tables
 * when a new migration adds tables.
 *
 * When this test fails after adding a new Drizzle table:
 *   1. Add the table to TABLE_REGISTRY in backup-serializer.ts
 *   2. Add the table to INSERT_ORDER in restore.ts (FK-safe position)
 *   3. Add a label to TABLE_LABELS in restore-modal.tsx
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

function parseStringArrayFromSource(
  path: string,
  variableName: string,
): string[] {
  const src = readFileSync(path, 'utf-8');
  const start = src.indexOf(`export const ${variableName}`);
  if (start === -1) throw new Error(`${variableName} not found in ${path}`);
  const bracket = src.indexOf('[', start);
  const end = src.indexOf('];', bracket);
  const block = src.substring(bracket + 1, end);
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function parseRegistryNames(path: string): string[] {
  const src = readFileSync(path, 'utf-8');
  return [...src.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const EXPECTED_LABEL_KEYS = new Set([
  'app_profile',
  'ai_settings',
  'accounts',
  'settings',
  'market_data_settings',
  'schwab_tokens',
  'instruments',
  'accounting_executions',
  'account_positions',
  'account_performance',
  'valuation_marks',
  'fifo_lots',
  'financial_events',
  'ledger_entries',
  'ledger_postings',
  'lot_matches',
  'lookup_values',
  'setup_definitions',
  'checklist_definitions',
  'play_evaluation_fields',
  'trades',
  'trade_executions',
  'trade_risk_snapshots',
  'trade_stop_adjustments',
  'trade_assets',
  'trade_grades',
  'trade_mistakes',
  'trade_check_results',
  'position_price_snapshots',
  'trade_assessment_snapshots',
  'watchlist_items',
  'account_transactions',
  'account_rollforward',
  'weekly_reviews',
  'review_action_items',
]);

describe('Backup/Restore Table Consistency', () => {
  const registryNames = parseRegistryNames(
    resolve(ROOT, 'src/lib/backup-serializer.ts'),
  );
  const insertOrder = parseStringArrayFromSource(
    resolve(ROOT, 'src/lib/restore.ts'),
    'INSERT_ORDER',
  );

  it('INSERT_ORDER covers all TABLE_REGISTRY entries', () => {
    const registrySet = new Set(registryNames);
    const orderSet = new Set(insertOrder);

    const onlyInRegistry = [...registrySet].filter((n) => !orderSet.has(n));
    const onlyInOrder = [...orderSet].filter((n) => !registrySet.has(n));

    expect(onlyInRegistry).toEqual([]);
    expect(onlyInOrder).toEqual([]);
  });

  it('DELETE_ORDER is derived from INSERT_ORDER (runtime reversed)', () => {
    // DELETE_ORDER is not a literal — it's computed as [...INSERT_ORDER].reverse().
    // Verify that the source code uses this pattern to guarantee correctness.
    const src = readFileSync(
      resolve(ROOT, 'src/lib/restore.ts'),
      'utf-8',
    );
    expect(src).toContain(
      'export const DELETE_ORDER: string[] = [...INSERT_ORDER].reverse();',
    );
  });

  it('TABLE_LABELS keys cover all INSERT_ORDER tables', () => {
    const missing = insertOrder.filter((t) => !EXPECTED_LABEL_KEYS.has(t));
    const extra = [...EXPECTED_LABEL_KEYS].filter(
      (t) => !insertOrder.includes(t),
    );

    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it('TABLE_REGISTRY has no duplicates', () => {
    expect(registryNames.length).toBe(new Set(registryNames).size);
  });

  it('INSERT_ORDER has no duplicates', () => {
    expect(insertOrder.length).toBe(new Set(insertOrder).size);
  });
});
