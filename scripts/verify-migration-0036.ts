/**
 * Runtime verification for migration 0036 (T01, M002/S02).
 *
 * Verifies:
 *  1. The full migration chain (journal-tag -> SQL file) applies cleanly to a
 *     fresh temp DB — validating journal registration and SQL syntax.
 *  2. Migration 0036 applies to a snapshot of the real dev DB (which contains
 *     existing checklist rows) — validating backward compat: existing rows
 *     receive is_required = 1, and the new columns are queryable/writable.
 *
 * Uses only the OS temp dir (repo-hygiene rule: no disposable DBs in the
 * repo root) and cleans up after itself.
 *
 * Usage: npx tsx scripts/verify-migration-0036.ts
 */
import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MIGRATIONS_DIR = join(process.cwd(), 'src/db/migrations');
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

function applyChain(db: Database.Database, entries: { tag: string }[]): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS __drizzle_migrations (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at TEXT)'
  );
  const insert = db.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, datetime('now'))"
  );
  for (const entry of entries) {
    const tag = entry.tag;
    const existing = db.prepare('SELECT id FROM __drizzle_migrations WHERE hash = ?').get(tag);
    if (existing) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, tag + '.sql'), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      insert.run(tag);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}

async function main(): Promise<void> {
  let failures = 0;
  function check(label: string, ok: boolean): void {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures += 1;
  }

  const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8'));
  check('journal top-level version is 7', journal.version === '7');
  check(
    'journal has 37 entries ending with 0036',
    journal.entries.length === 37 && journal.entries[36].tag === '0036_checklist_and_risk_contracts'
  );
  check(
    'entry 36 has idx 36 / version 7',
    journal.entries[36].idx === 36 && journal.entries[36].version === '7'
  );

  // ── Part 1: full chain on fresh temp DB ──────────────────────────────────
  const tmpDir = mkdtempSync(join(tmpdir(), 'tradingjournal-test-t01-chain-'));
  const freshPath = join(tmpDir, 'test.db');
  const fresh = new Database(freshPath);
  try {
    applyChain(fresh, journal.entries);
    check('fresh: checklist_definitions.is_required exists', columnNames(fresh, 'checklist_definitions').includes('is_required'));
    check('fresh: trade_check_results.item_text exists', columnNames(fresh, 'trade_check_results').includes('item_text'));
    check('fresh: trades.risk_override_reason exists', columnNames(fresh, 'trades').includes('risk_override_reason'));

    // Drizzle-shaped insert: is_required has DEFAULT 1
    const now = new Date().toISOString();
    fresh
      .prepare(
        'INSERT INTO checklist_definitions (id, description, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run('cd-1', 'Pre-market check', 1, 1, now, now);
    const row = fresh.prepare("SELECT is_required FROM checklist_definitions WHERE id = 'cd-1'").get() as { is_required: number };
    check('fresh: is_required defaults to 1', row.is_required === 1);

    // item_text / risk_override_reason are nullable text
    const notnull = (table: string, col: string) => {
      const r = (fresh.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[]).find(
        (x) => x.name === col
      );
      return r?.notnull ?? -1;
    };
    check('fresh: item_text nullable', notnull('trade_check_results', 'item_text') === 0);
    check('fresh: risk_override_reason nullable', notnull('trades', 'risk_override_reason') === 0);
  } finally {
    fresh.close();
  }

  // ── Part 2: 0036 applied to a snapshot of the real dev DB ────────────────
  let snapDir: string | undefined;
  const devDbPath = join(process.cwd(), '.trading-journal/journal.db');
  if (process.env.SKIP_DEV_SNAPSHOT === '1') {
    console.log('SKIP  dev-db snapshot test (SKIP_DEV_SNAPSHOT=1)');
  } else if (existsSync(devDbPath)) {
    snapDir = mkdtempSync(join(tmpdir(), 'tradingjournal-test-t01-dev-'));
    const snapPath = join(snapDir, 'dev-snapshot.db');
    const dev = new Database(devDbPath, { readonly: true });
    try {
      // Consistent snapshot while the dev server holds the DB (WAL-safe)
      await dev.backup(snapPath);
      const snap = new Database(snapPath);
      try {
        const before = snap.prepare('SELECT count(*) AS c FROM checklist_definitions').get() as { c: number };
        check(`dev-snapshot: ${before.c} existing checklist rows before 0036`, before.c >= 0);
        applyChain(snap, journal.entries);
        check('dev-snapshot: is_required exists', columnNames(snap, 'checklist_definitions').includes('is_required'));
        check('dev-snapshot: item_text exists', columnNames(snap, 'trade_check_results').includes('item_text'));
        check('dev-snapshot: risk_override_reason exists', columnNames(snap, 'trades').includes('risk_override_reason'));
        const after = snap.prepare('SELECT count(*) AS c, sum(is_required) AS s FROM checklist_definitions').get() as {
          c: number;
          s: number | null;
        };
        check(
          `dev-snapshot: existing rows backfilled is_required=1 (sum=${after.s} of ${after.c})`,
          after.c === 0 || after.s === after.c
        );
        // Writable end-to-end: full trade row with risk_override_reason
        const acct = snap.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: string } | undefined;
        if (acct) {
          snap
            .prepare(
              `INSERT INTO trades (id, trade_code, account_id, symbol, direction, status, risk_override_reason)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(randomUUID(), 'TC-T01-VERIFY', acct.id, 'VERIFY', 'long', 'planned', 'manual override test');
          const stored = snap.prepare("SELECT risk_override_reason FROM trades WHERE trade_code = 'TC-T01-VERIFY'").get() as {
            risk_override_reason: string;
          };
          check('dev-snapshot: trade insert with risk_override_reason works', stored.risk_override_reason === 'manual override test');
        } else {
          console.log('SKIP  trade insert (no accounts in dev snapshot)');
        }
      } finally {
        snap.close();
      }
    } finally {
      dev.close();
    }
  } else {
    console.log('SKIP  dev-db snapshot test (no .trading-journal/journal.db)');
  }

  // ── cleanup ──────────────────────────────────────────────────────────────
  rmSync(tmpDir, { recursive: true, force: true });
  if (snapDir) rmSync(snapDir, { recursive: true, force: true });

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Verification script failed:', err);
  process.exit(1);
});
