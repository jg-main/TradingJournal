/**
 * POST /api/reset
 *
 * Factory reset: deletes ALL user data from every journal table.
 *
 * This is a transactional DELETE-all using FK-safe ordering (children-first)
 * from the proven DELETE_ORDER in restore.ts. __drizzle_migrations is
 * intentionally omitted from the delete set so migration tracking survives
 * the reset.
 *
 * After a successful reset, all user-data tables are empty, which causes
 * checkReadiness() to return ready: false — the first-run setup wizard
 * re-triggers on the next page load.
 *
 * On success: 200 { success: true }
 * On failure: 500 { error: 'Reset failed', details }
 */

import { NextResponse } from 'next/server';
import { getSqliteHandle } from '@/db/index';
import { DELETE_ORDER } from '@/lib/restore';

export async function POST() {
  try {
    const sqlite = getSqliteHandle();

    sqlite.transaction(() => {
      sqlite.exec('PRAGMA defer_foreign_keys = ON');

      for (const tableName of DELETE_ORDER) {
        sqlite.exec(`DELETE FROM "${tableName}"`);
      }
    })();

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Reset failed', details: String(error) },
      { status: 500 },
    );
  }
}
