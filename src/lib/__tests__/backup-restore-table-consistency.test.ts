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
import { BACKUP_TABLES, BACKUP_TABLE_LABELS } from '../backup-tables';

function parseSchemaTableNames(path: string): string[] {
  const src = readFileSync(path, 'utf-8');
  return [...src.matchAll(/sqliteTable\('([^']+)'/g)].map((m) => m[1]);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('Backup/Restore Table Consistency', () => {
  const registryNames = BACKUP_TABLES.map(({ name }) => name);
  const insertOrder: string[] = [...BACKUP_TABLES]
    .sort((a, b) => a.restoreOrder - b.restoreOrder)
    .map(({ name }) => String(name));
  const schemaTableNames = parseSchemaTableNames(
    resolve(ROOT, 'src/db/schema.ts'),
  );

  it('TABLE_REGISTRY covers every Drizzle schema table', () => {
    const registrySet = new Set<string>(registryNames);
    const schemaSet = new Set<string>(schemaTableNames);

    const missing = [...schemaSet].filter((name) => !registrySet.has(name));
    const stale = [...registrySet].filter((name) => !schemaSet.has(name));

    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('INSERT_ORDER covers all TABLE_REGISTRY entries', () => {
    const registrySet = new Set<string>(registryNames);
    const orderSet = new Set<string>(insertOrder);

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
    const labelKeys = new Set<string>(Object.keys(BACKUP_TABLE_LABELS));
    const missing = insertOrder.filter((t) => !labelKeys.has(t));
    const extra = [...labelKeys].filter(
      (t) => !insertOrder.includes(t),
    );

    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it('server consumers derive registry and restore order from shared metadata', () => {
    const serializerSource = readFileSync(resolve(ROOT, 'src/lib/backup-serializer.ts'), 'utf-8');
    const restoreSource = readFileSync(resolve(ROOT, 'src/lib/restore.ts'), 'utf-8');
    expect(serializerSource).toContain('BACKUP_TABLES.map');
    expect(restoreSource).toContain('...BACKUP_TABLES');
  });

  it('TABLE_REGISTRY has no duplicates', () => {
    expect(registryNames.length).toBe(new Set(registryNames).size);
  });

  it('INSERT_ORDER has no duplicates', () => {
    expect(insertOrder.length).toBe(new Set(insertOrder).size);
  });
});
