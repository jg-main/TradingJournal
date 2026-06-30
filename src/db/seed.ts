/**
 * Seed script - populates lookup_values with initial reference data.
 *
 * Run with: npx tsx src/db/seed.ts
 *
 * Categories seeded:
 *   - setup (10)        - trade setups
 *   - sector (15)       - market sectors
 *   - market_condition (6)
 *   - mistake_type (10)
 *   - phase (6)         - trade lifecycle phases (extends schema inline enums)
 *   - execution_reason (9)
 *
 * NOT seeded (no matching lookup_values type in schema):
 *   - grade_labels       → stored inline on trade_grades.gradeLabel
 *   - watchlist_statuses → stored inline on watchlist_items.status
 *   - exit_reasons       → stored inline on trades.exitNotes
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { count } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

const DB_FILE = process.env.DB_FILE_NAME || './.trading-journal/journal.db';

mkdirSync(dirname(DB_FILE), { recursive: true });
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// ── Seed data ───────────────────────────────────────────────────────────

interface SeedEntry {
  type: (typeof schema.lookupValues.$inferInsert)['type'];
  value: string;
  description?: string;
}

const seedData: SeedEntry[] = [
  // Setups
  ...[
    'momentum', 'breakout', 'pullback', 'reversal', 'range',
    'gap', 'scalp', 'swing', 'pattern', 'news',
  ].map((v) => ({ type: 'setup' as const, value: v })),

  // Sectors
  ...[
    'technology', 'semiconductors', 'software', 'biotech', 'pharma',
    'energy', 'financials', 'consumer_cyclical', 'consumer_defensive',
    'healthcare', 'industrials', 'materials', 'real_estate',
    'utilities', 'communication',
  ].map((v) => ({ type: 'sector' as const, value: v })),

  // Market conditions
  ...[
    'trending_up', 'trending_down', 'ranging', 'volatile',
    'low_volume', 'high_volume',
  ].map((v) => ({ type: 'market_condition' as const, value: v })),

  // Mistake types
  ...[
    { v: 'fv_setup_selection', d: 'Setup selection failure' },
    { v: 'fv_risk_assessment', d: 'Risk assessment failure' },
    { v: 'fv_entry_timing', d: 'Entry timing failure' },
    { v: 'fv_position_sizing', d: 'Position sizing failure' },
    { v: 'fv_stop_placement', d: 'Stop placement failure' },
    { v: 'fv_target_setting', d: 'Target setting failure' },
    { v: 'fv_patience', d: 'Patience failure' },
    { v: 'fv_management', d: 'Trade management failure' },
    { v: 'fv_exit_discipline', d: 'Exit discipline failure' },
    { v: 'fv_psychology', d: 'Psychology failure' },
  ].map(({ v, d }) => ({ type: 'mistake_type' as const, value: v, description: d })),

  // Phases
  ...[
    'pre_trade', 'entry', 'risk', 'management', 'exit', 'psychology',
  ].map((v) => ({ type: 'phase' as const, value: v })),

  // Execution reasons
  ...[
    'manual_entry', 'limit_order', 'stop_order', 'scalp', 'scale_in',
    'partial_exit', 'full_exit', 'stop_loss', 'take_profit',
  ].map((v) => ({
    type: 'execution_reason' as const,
    value: v,
    description: v
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  })),
];

function seed() {
  // Idempotent — skip if already seeded
  const existingCount = db.select({ c: count() }).from(schema.lookupValues).get();
  if (existingCount && existingCount.c > 0) {
    console.log(`  lookup_values already has ${existingCount.c} rows — skipping.`);
    return;
  }

  const rows = seedData.map((entry, i) => ({
    id: crypto.randomUUID(),
    type: entry.type,
    value: entry.value,
    description: entry.description ?? null,
    sortOrder: i,
    isActive: true as const,
  }));

  db.insert(schema.lookupValues).values(rows).run();
  console.log(`  Seeded ${rows.length} lookup values.`);
}

seed();
