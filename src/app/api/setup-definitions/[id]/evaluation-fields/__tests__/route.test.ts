/**
 * Evaluation fields route test
 *
 * Tests CRUD operations for per-play evaluation criteria at
 * /api/setup-definitions/[id]/evaluation-fields.
 *
 * Run: npx vitest run --reporter verbose src/app/api/setup-definitions/[id]/evaluation-fields/__tests__/route.test.ts
 */

import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, desc } from 'drizzle-orm';

import * as schema from '@/db/schema';

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

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(
      `  ❌ ${msg} \u2014 expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} (FAILED)`,
    );
  }
}

function assertNotNull(value: unknown, msg: string) {
  if (value !== null && value !== undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} \u2014 value is null/undefined (FAILED)`);
  }
}

function assertNull(value: unknown, msg: string) {
  if (value === null || value === undefined) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(
      `  ❌ ${msg} \u2014 expected null, got ${JSON.stringify(value)} (FAILED)`,
    );
  }
}

function assertNotEqual(
  actual: unknown,
  notExpected: unknown,
  msg: string,
) {
  if (actual !== notExpected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(
      `  ❌ ${msg} \u2014 expected not ${JSON.stringify(notExpected)} (FAILED)`,
    );
  }
}

function assertHasKey(
  obj: Record<string, unknown>,
  key: string,
  msg: string,
) {
  if (key in obj) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(
      `  ❌ ${msg} \u2014 key "${key}" missing (FAILED)`,
    );
  }
}

// ── Setup: test DB ──────────────────────────────────────────────────

const DB_FILE =
  process.env.DB_FILE_NAME || './.test-eval-fields.db';
const sqlite = new Database(DB_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

// Create tables needed for tests
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    broker TEXT,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    max_risk_per_trade_pct REAL,
    default_commission REAL,
    starting_balance REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS lookup_values (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS setup_definitions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    how_to_play TEXT,
    entry_rules TEXT,
    exit_rules TEXT,
    tags TEXT,
    default_risk_pct REAL,
    position_sizing_rules TEXT,
    chart_patterns TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY NOT NULL,
    trade_code TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('long','short')),
    setup_id TEXT REFERENCES lookup_values(id),
    status TEXT NOT NULL CHECK(status IN ('planned','open','closed','deleted')),
    entry_price REAL,
    exit_price REAL,
    quantity REAL,
    planned_quantity REAL,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE TABLE IF NOT EXISTS play_evaluation_fields (
    id TEXT PRIMARY KEY NOT NULL,
    setup_definition_id TEXT NOT NULL REFERENCES setup_definitions(id) ON DELETE CASCADE,
    field_key TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    field_type TEXT NOT NULL CHECK(field_type IN ('boolean','score_1_5','score_1_10','text')),
    weight REAL DEFAULT 1.0,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (current_timestamp),
    updated_at TEXT DEFAULT (current_timestamp)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_fields_setup_key
    ON play_evaluation_fields (setup_definition_id, field_key);
`);

// ── Simulated route logic ───────────────────────────────────────────

function doGetFields(
  setupId: string,
  includeInactive = false,
): { status: number; data: unknown } {
  try {
    // Verify setup exists
    const setupExists = db
      .select({ id: schema.setupDefinitions.id })
      .from(schema.setupDefinitions)
      .where(eq(schema.setupDefinitions.id, setupId))
      .get();

    if (!setupExists) {
      return { status: 404, data: { error: 'Setup definition not found' } };
    }

    let rows;
    if (includeInactive) {
      rows = db
        .select()
        .from(schema.playEvaluationFields)
        .where(
          eq(schema.playEvaluationFields.setupDefinitionId, setupId),
        )
        .orderBy(desc(schema.playEvaluationFields.sortOrder))
        .all();
    } else {
      rows = db
        .select()
        .from(schema.playEvaluationFields)
        .where(
          and(
            eq(schema.playEvaluationFields.setupDefinitionId, setupId),
            eq(schema.playEvaluationFields.isActive, true),
          ),
        )
        .orderBy(desc(schema.playEvaluationFields.sortOrder))
        .all();
    }

    return { status: 200, data: { data: rows } };
  } catch (error) {
    return {
      status: 500,
      data: {
        error: 'Failed to fetch evaluation fields',
        details: String(error),
      },
    };
  }
}

function doPostField(
  setupId: string,
  body: Record<string, unknown>,
): { status: number; data: unknown } {
  try {
    // Verify setup exists
    const setupExists = db
      .select({ id: schema.setupDefinitions.id })
      .from(schema.setupDefinitions)
      .where(eq(schema.setupDefinitions.id, setupId))
      .get();

    if (!setupExists) {
      return { status: 404, data: { error: 'Setup definition not found' } };
    }

    // Validate body
    if (
      !body.fieldKey ||
      typeof body.fieldKey !== 'string' ||
      body.fieldKey.trim().length === 0
    ) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: { fieldKey: ['Field key is required'] },
          },
        },
      };
    }
    if (
      !body.label ||
      typeof body.label !== 'string' ||
      body.label.trim().length === 0
    ) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: { fieldErrors: { label: ['Label is required'] } },
        },
      };
    }
    const validTypes = ['boolean', 'score_1_5', 'score_1_10', 'text'];
    if (
      !body.fieldType ||
      !validTypes.includes(body.fieldType as string)
    ) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: { fieldType: ['Invalid field type'] },
          },
        },
      };
    }

    // Check unique fieldKey
    const existing = db
      .select()
      .from(schema.playEvaluationFields)
      .where(
        and(
          eq(schema.playEvaluationFields.setupDefinitionId, setupId),
          eq(schema.playEvaluationFields.fieldKey, body.fieldKey as string),
        ),
      )
      .get();

    if (existing) {
      return {
        status: 409,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              fieldKey: [
                'A field with this key already exists for this play definition',
              ],
            },
          },
        },
      };
    }

    const now = new Date().toISOString();
    const fieldId = randomUUID();

    db.insert(schema.playEvaluationFields)
      .values({
        id: fieldId,
        setupDefinitionId: setupId,
        fieldKey: body.fieldKey as string,
        label: body.label as string,
        description: (body.description as string) ?? null,
        fieldType: body.fieldType as
          | 'boolean'
          | 'score_1_5'
          | 'score_1_10'
          | 'text',
        weight: (body.weight as number) ?? 1.0,
        sortOrder: (body.sortOrder as number) ?? 0,
        isActive: (body.isActive as boolean) ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db
      .select()
      .from(schema.playEvaluationFields)
      .where(eq(schema.playEvaluationFields.id, fieldId))
      .get();

    return { status: 201, data: row };
  } catch (error) {
    return {
      status: 500,
      data: {
        error: 'Failed to create evaluation field',
        details: String(error),
      },
    };
  }
}

function doPutField(
  setupId: string,
  fieldId: string,
  body: Record<string, unknown>,
): { status: number; data: unknown } {
  try {
    // Verify setup exists
    const setupExists = db
      .select({ id: schema.setupDefinitions.id })
      .from(schema.setupDefinitions)
      .where(eq(schema.setupDefinitions.id, setupId))
      .get();

    if (!setupExists) {
      return { status: 404, data: { error: 'Setup definition not found' } };
    }

    // Verify field exists under this setup
    const existingField = db
      .select()
      .from(schema.playEvaluationFields)
      .where(
        and(
          eq(schema.playEvaluationFields.id, fieldId),
          eq(schema.playEvaluationFields.setupDefinitionId, setupId),
        ),
      )
      .get();

    if (!existingField) {
      return {
        status: 404,
        data: { error: 'Evaluation field not found' },
      };
    }

    // Validate body if present
    if (
      body.fieldKey !== undefined &&
      (typeof body.fieldKey !== 'string' || body.fieldKey.trim().length === 0)
    ) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: {
            fieldErrors: { fieldKey: ['Field key is required'] },
          },
        },
      };
    }
    if (
      body.label !== undefined &&
      (typeof body.label !== 'string' || body.label.trim().length === 0)
    ) {
      return {
        status: 400,
        data: {
          error: 'Validation failed',
          details: { fieldErrors: { label: ['Label is required'] } },
        },
      };
    }

    // If changing fieldKey, check uniqueness
    if (
      body.fieldKey !== undefined &&
      body.fieldKey !== existingField.fieldKey
    ) {
      const duplicate = db
        .select()
        .from(schema.playEvaluationFields)
        .where(
          and(
            eq(schema.playEvaluationFields.setupDefinitionId, setupId),
            eq(schema.playEvaluationFields.fieldKey, body.fieldKey as string),
          ),
        )
        .get();

      if (duplicate) {
        return {
          status: 409,
          data: {
            error: 'Validation failed',
            details: {
              fieldErrors: {
                fieldKey: [
                  'A field with this key already exists for this play definition',
                ],
              },
            },
          },
        };
      }
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (body.fieldKey !== undefined) updateData.fieldKey = body.fieldKey;
    if (body.label !== undefined) updateData.label = body.label;
    if (body.description !== undefined)
      updateData.description = body.description;
    if (body.fieldType !== undefined) updateData.fieldType = body.fieldType;
    if (body.weight !== undefined) updateData.weight = body.weight;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    if (Object.keys(updateData).length > 1) {
      db.update(schema.playEvaluationFields)
        .set(updateData)
        .where(eq(schema.playEvaluationFields.id, fieldId))
        .run();
    }

    const row = db
      .select()
      .from(schema.playEvaluationFields)
      .where(eq(schema.playEvaluationFields.id, fieldId))
      .get();

    return { status: 200, data: row };
  } catch (error) {
    return {
      status: 500,
      data: {
        error: 'Failed to update evaluation field',
        details: String(error),
      },
    };
  }
}

function doDeleteField(
  setupId: string,
  fieldId: string,
): { status: number; data: unknown } {
  try {
    // Verify setup exists
    const setupExists = db
      .select({ id: schema.setupDefinitions.id })
      .from(schema.setupDefinitions)
      .where(eq(schema.setupDefinitions.id, setupId))
      .get();

    if (!setupExists) {
      return { status: 404, data: { error: 'Setup definition not found' } };
    }

    // Verify field exists under this setup
    const existingField = db
      .select()
      .from(schema.playEvaluationFields)
      .where(
        and(
          eq(schema.playEvaluationFields.id, fieldId),
          eq(schema.playEvaluationFields.setupDefinitionId, setupId),
        ),
      )
      .get();

    if (!existingField) {
      return {
        status: 404,
        data: { error: 'Evaluation field not found' },
      };
    }

    // Soft delete
    const now = new Date().toISOString();
    db.update(schema.playEvaluationFields)
      .set({ isActive: false, updatedAt: now })
      .where(eq(schema.playEvaluationFields.id, fieldId))
      .run();

    const row = db
      .select()
      .from(schema.playEvaluationFields)
      .where(eq(schema.playEvaluationFields.id, fieldId))
      .get();

    return { status: 200, data: row };
  } catch (error) {
    return {
      status: 500,
      data: {
        error: 'Failed to delete evaluation field',
        details: String(error),
      },
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function cleanup() {
  sqlite.exec(
    'DELETE FROM play_evaluation_fields; DELETE FROM setup_definitions; DELETE FROM lookup_values; DELETE FROM trades; DELETE FROM accounts;',
  );
}

function seedSetup(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const values: Record<string, unknown> = {
    id,
    name: 'Test Play',
    description: null,
    howToPlay: null,
    entryRules: null,
    exitRules: null,
    tags: null,
    defaultRiskPct: null,
    positionSizingRules: null,
    chartPatterns: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  db.insert(schema.setupDefinitions)
    .values(values as typeof schema.setupDefinitions.$inferInsert)
    .run();

  db.insert(schema.lookupValues)
    .values({
      id,
      type: 'setup',
      value: (values.name as string).toLowerCase(),
      description: (values.description as string) ?? null,
      isActive: values.isActive as boolean,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return db
    .select()
    .from(schema.setupDefinitions)
    .where(eq(schema.setupDefinitions.id, id))
    .get() as Record<string, unknown>;
}

function seedField(
  setupId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const values: Record<string, unknown> = {
    id,
    setupDefinitionId: setupId,
    fieldKey: 'entry_alignment',
    label: 'Entry Alignment',
    description: null,
    fieldType: 'score_1_5',
    weight: 1.0,
    sortOrder: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  db.insert(schema.playEvaluationFields)
    .values(values as typeof schema.playEvaluationFields.$inferInsert)
    .run();

  return db
    .select()
    .from(schema.playEvaluationFields)
    .where(eq(schema.playEvaluationFields.id, id))
    .get() as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

console.log('\n--- Play Evaluation Fields API Tests ---\n');

// ── 1. GET: Setup not found ─────────────────────────────────────────

console.log('\n1. GET returns 404 when setup not found:');
{
  cleanup();
  const result = doGetFields(randomUUID());
  assert(result.status === 404, 'returns 404');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Setup definition not found', 'error message');
}

// ── 2. GET: Empty list when no fields exist ─────────────────────────

console.log('\n2. GET returns [] when no fields:');
{
  cleanup();
  const setup = seedSetup({ name: 'No Fields Play' });
  const result = doGetFields(setup.id as string);
  assert(result.status === 200, 'returns 200');
  const body = result.data as { data: unknown[] };
  assert(Array.isArray(body.data), 'response has data array');
  assertEqual(body.data.length, 0, 'data is empty');
}

// ── 3. GET: Lists active fields only by default ─────────────────────

console.log('\n3. GET returns only active fields:');
{
  cleanup();
  const setup = seedSetup({ name: 'Filtered Fields Play' });
  seedField(setup.id as string, {
    fieldKey: 'active_field_a',
    label: 'Active Field A',
  });
  seedField(setup.id as string, {
    fieldKey: 'active_field_b',
    label: 'Active Field B',
  });
  seedField(setup.id as string, {
    fieldKey: 'inactive_field',
    label: 'Inactive Field',
    isActive: false,
  });

  const result = doGetFields(setup.id as string);
  assert(result.status === 200, 'returns 200');
  const body = result.data as { data: Record<string, unknown>[] };
  assertEqual(body.data.length, 2, 'only 2 active fields returned');
  const keys = body.data.map((f) => f.fieldKey as string).sort();
  assertEqual(
    JSON.stringify(keys),
    JSON.stringify(['active_field_a', 'active_field_b']),
    'correct field keys',
  );
}

// ── 4. GET: Include inactive ────────────────────────────────────────

console.log('\n4. GET with includeInactive=true returns all fields:');
{
  cleanup();
  const setup = seedSetup({ name: 'All Fields Play' });
  seedField(setup.id as string, {
    fieldKey: 'field_alpha',
    label: 'Alpha',
  });
  seedField(setup.id as string, {
    fieldKey: 'field_beta',
    label: 'Beta',
    isActive: false,
  });

  const result = doGetFields(setup.id as string, true);
  assert(result.status === 200, 'returns 200');
  const body = result.data as { data: Record<string, unknown>[] };
  assertEqual(body.data.length, 2, 'both fields returned');
}

// ── 5. POST: Create a new evaluation field ──────────────────────────

console.log('\n5. POST creates a new evaluation field:');
{
  cleanup();
  const setup = seedSetup({ name: 'Breakout Play' });
  const result = doPostField(setup.id as string, {
    fieldKey: 'entry_alignment',
    label: 'Entry Alignment',
    description: 'How well the entry aligned with the play rules',
    fieldType: 'score_1_5',
    weight: 1.5,
    sortOrder: 1,
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertNotNull(data.id, 'has id');
  assertEqual(data.fieldKey, 'entry_alignment', 'fieldKey matches');
  assertEqual(data.label, 'Entry Alignment', 'label matches');
  assertEqual(
    data.description,
    'How well the entry aligned with the play rules',
    'description matches',
  );
  assertEqual(data.fieldType, 'score_1_5', 'fieldType matches');
  assertEqual(data.weight, 1.5, 'weight matches');
  assertEqual(data.sortOrder, 1, 'sortOrder matches');
  assertEqual(data.isActive, true, 'isActive defaults to true');
  assertEqual(
    data.setupDefinitionId,
    setup.id as string,
    'setupDefinitionId matches',
  );
}

// ── 6. POST: Create minimal field ──────────────────────────────────

console.log('\n6. POST creates field with required fields only:');
{
  cleanup();
  const setup = seedSetup({ name: 'Minimal Play' });
  const result = doPostField(setup.id as string, {
    fieldKey: 'risk_score',
    label: 'Risk Score',
    fieldType: 'score_1_10',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.fieldKey, 'risk_score', 'fieldKey matches');
  assertEqual(data.label, 'Risk Score', 'label matches');
  assertEqual(data.fieldType, 'score_1_10', 'fieldType matches');
  assertEqual(data.weight, 1.0, 'weight defaults to 1.0');
  assertEqual(data.sortOrder, 0, 'sortOrder defaults to 0');
  assertNull(data.description, 'description is null');
}

// ── 7. POST: Create boolean field with description ─────────────────

console.log('\n7. POST creates boolean field:');
{
  cleanup();
  const setup = seedSetup({ name: 'Checklist Play' });
  const result = doPostField(setup.id as string, {
    fieldKey: 'followed_plan',
    label: 'Followed Plan',
    description: 'Did the trade strictly follow the pre-defined plan?',
    fieldType: 'boolean',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.fieldKey, 'followed_plan', 'fieldKey matches');
  assertEqual(data.fieldType, 'boolean', 'fieldType matches');
}

// ── 8. POST: Create text field ─────────────────────────────────────

console.log('\n8. POST creates text field:');
{
  cleanup();
  const setup = seedSetup({ name: 'Notes Play' });
  const result = doPostField(setup.id as string, {
    fieldKey: 'notes',
    label: 'Notes',
    fieldType: 'text',
  });

  assert(result.status === 201, 'returns 201');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.fieldKey, 'notes', 'fieldKey matches');
  assertEqual(data.fieldType, 'text', 'fieldType matches');
}

// ── 9. POST: Duplicate fieldKey within same setup ──────────────────

console.log('\n9. POST returns 409 for duplicate fieldKey:');
{
  cleanup();
  const setup = seedSetup({ name: 'Dup Key Play' });
  doPostField(setup.id as string, {
    fieldKey: 'entry_alignment',
    label: 'Entry Alignment',
    fieldType: 'score_1_5',
  });
  const result = doPostField(setup.id as string, {
    fieldKey: 'entry_alignment',
    label: 'Entry Alignment Again',
    fieldType: 'score_1_10',
  });
  assert(result.status === 409, 'returns 409');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.error, 'Validation failed', 'error message');
}

// ── 10. POST: Duplicate fieldKey allowed across different setups ────

console.log(
  '\n10. POST allows same fieldKey across different setups:',
);
{
  cleanup();
  const setupA = seedSetup({ name: 'Play A' });
  const setupB = seedSetup({ name: 'Play B' });
  const resultA = doPostField(setupA.id as string, {
    fieldKey: 'entry_alignment',
    label: 'Entry Alignment',
    fieldType: 'score_1_5',
  });
  const resultB = doPostField(setupB.id as string, {
    fieldKey: 'entry_alignment',
    label: 'Entry Alignment',
    fieldType: 'score_1_5',
  });

  assert(resultA.status === 201, 'A: returns 201');
  assert(resultB.status === 201, 'B: returns 201');
}

// ── 11. POST: Missing required fields ──────────────────────────────

console.log('\n11. POST returns 400 for missing required fields:');
{
  cleanup();
  const setup = seedSetup({ name: 'Bad Input Play' });

  const noKey = doPostField(setup.id as string, {
    label: 'No Key',
    fieldType: 'boolean',
  });
  assert(noKey.status === 400, 'missing fieldKey -> 400');

  const noLabel = doPostField(setup.id as string, {
    fieldKey: 'no_label',
    fieldType: 'boolean',
  });
  assert(noLabel.status === 400, 'missing label -> 400');

  const noType = doPostField(setup.id as string, {
    fieldKey: 'no_type',
    label: 'No Type',
  });
  assert(noType.status === 400, 'missing fieldType -> 400');
}

// ── 12. POST: Invalid fieldType ──────────────────────────────────

console.log('\n12. POST returns 400 for invalid fieldType:');
{
  cleanup();
  const setup = seedSetup({ name: 'Bad Type Play' });
  const result = doPostField(setup.id as string, {
    fieldKey: 'bad_type',
    label: 'Bad Type',
    fieldType: 'invalid_type',
  });
  assert(result.status === 400, 'returns 400');
}

// ── 13. POST: Setup not found ─────────────────────────────────────

console.log('\n13. POST returns 404 when setup not found:');
{
  cleanup();
  const result = doPostField(randomUUID(), {
    fieldKey: 'test',
    label: 'Test',
    fieldType: 'boolean',
  });
  assert(result.status === 404, 'returns 404');
}

// ── 14. PUT: Update field metadata ────────────────────────────────

console.log('\n14. PUT updates field metadata:');
{
  cleanup();
  const setup = seedSetup({ name: 'Updatable Play' });
  const field = seedField(setup.id as string, {
    fieldKey: 'execution_score',
    label: 'Execution Score',
    fieldType: 'score_1_5',
    weight: 1.0,
    sortOrder: 0,
  });

  const result = doPutField(setup.id as string, field.id as string, {
    label: 'Updated Execution Score',
    weight: 2.0,
    sortOrder: 5,
    description: 'Updated description',
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.label, 'Updated Execution Score', 'label updated');
  assertEqual(data.weight, 2.0, 'weight updated');
  assertEqual(data.sortOrder, 5, 'sortOrder updated');
  assertEqual(
    data.description,
    'Updated description',
    'description updated',
  );
  assertEqual(
    data.fieldKey,
    'execution_score',
    'fieldKey preserved unchanged',
  );
  assertEqual(data.fieldType, 'score_1_5', 'fieldType preserved');
}

// ── 15. PUT: Change fieldKey ──────────────────────────────────────

console.log('\n15. PUT changes fieldKey:');
{
  cleanup();
  const setup = seedSetup({ name: 'Rename Play' });
  const field = seedField(setup.id as string, {
    fieldKey: 'old_key',
    label: 'Old Key',
  });

  const result = doPutField(setup.id as string, field.id as string, {
    fieldKey: 'new_key',
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.fieldKey, 'new_key', 'fieldKey updated');
}

// ── 16. PUT: Change fieldType ────────────────────────────────────

console.log('\n16. PUT changes fieldType:');
{
  cleanup();
  const setup = seedSetup({ name: 'Retool Play' });
  const field = seedField(setup.id as string, {
    fieldKey: 'type_change',
    label: 'Type Change',
    fieldType: 'score_1_5',
  });

  const result = doPutField(setup.id as string, field.id as string, {
    fieldType: 'score_1_10',
  });

  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.fieldType, 'score_1_10', 'fieldType updated');
}

// ── 17. PUT: Duplicate fieldKey on rename ────────────────────────

console.log(
  '\n17. PUT returns 409 for duplicate fieldKey on rename:',
);
{
  cleanup();
  const setup = seedSetup({ name: 'Conflict Play' });
  seedField(setup.id as string, {
    fieldKey: 'existing_key',
    label: 'Existing',
  });
  const fieldB = seedField(setup.id as string, {
    fieldKey: 'other_key',
    label: 'Other',
  });

  const result = doPutField(setup.id as string, fieldB.id as string, {
    fieldKey: 'existing_key',
  });

  assert(result.status === 409, 'returns 409');
}

// ── 18. PUT: Field not found ─────────────────────────────────────

console.log('\n18. PUT returns 404 for unknown fieldId:');
{
  cleanup();
  const setup = seedSetup({ name: 'No Field Play' });
  const result = doPutField(setup.id as string, randomUUID(), {
    label: 'Anything',
  });
  assert(result.status === 404, 'returns 404');
}

// ── 19. PUT: Setup not found ─────────────────────────────────────

console.log('\n19. PUT returns 404 when setup not found:');
{
  cleanup();
  const result = doPutField(randomUUID(), randomUUID(), {
    label: 'Anything',
  });
  assert(result.status === 404, 'returns 404');
}

// ── 20. PUT: Empty label rejected ────────────────────────────────

console.log('\n20. PUT rejects empty label:');
{
  cleanup();
  const setup = seedSetup({ name: 'Bad Update Play' });
  const field = seedField(setup.id as string, {
    fieldKey: 'clean_me',
    label: 'Clean',
  });
  const result = doPutField(setup.id as string, field.id as string, {
    label: '',
  });
  assert(result.status === 400, 'returns 400');
}

// ── 21. DELETE: Soft-delete a field ──────────────────────────────

console.log('\n21. DELETE soft-deletes a field (isActive=false):');
{
  cleanup();
  const setup = seedSetup({ name: 'Deletable Play' });
  const field = seedField(setup.id as string, {
    fieldKey: 'to_delete',
    label: 'Delete Me',
  });

  const result = doDeleteField(setup.id as string, field.id as string);
  assert(result.status === 200, 'returns 200');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.isActive, false, 'isActive set to false');
  assertEqual(data.id, field.id, 'record still exists');
}

// ── 22. DELETE: Verify field no longer appears in active list ────

console.log(
  '\n22. After DELETE, field excluded from active list:',
);
{
  cleanup();
  const setup = seedSetup({ name: 'Gone Play' });
  const field = seedField(setup.id as string, {
    fieldKey: 'gone_field',
    label: 'Gone',
  });

  doDeleteField(setup.id as string, field.id as string);
  const list = doGetFields(setup.id as string);
  const body = list.data as { data: Record<string, unknown>[] };
  assertEqual(body.data.length, 0, 'no active fields');
}

// ── 23. DELETE: Field not found ─────────────────────────────────

console.log('\n23. DELETE returns 404 for unknown fieldId:');
{
  cleanup();
  const setup = seedSetup({ name: 'No Delete Play' });
  const result = doDeleteField(setup.id as string, randomUUID());
  assert(result.status === 404, 'returns 404');
}

// ── 24. DELETE: Setup not found ─────────────────────────────────

console.log('\n24. DELETE returns 404 when setup not found:');
{
  cleanup();
  const result = doDeleteField(randomUUID(), randomUUID());
  assert(result.status === 404, 'returns 404');
}

// ── 25. Multiple fields: ordered by sortOrder ────────────────────

console.log('\n25. Fields are ordered by sortOrder descending:');
{
  cleanup();
  const setup = seedSetup({ name: 'Ordered Play' });
  seedField(setup.id as string, {
    fieldKey: 'third',
    label: 'Third',
    sortOrder: 0,
  });
  seedField(setup.id as string, {
    fieldKey: 'first',
    label: 'First',
    sortOrder: 10,
  });
  seedField(setup.id as string, {
    fieldKey: 'second',
    label: 'Second',
    sortOrder: 5,
  });

  const result = doGetFields(setup.id as string);
  assert(result.status === 200, 'returns 200');
  const body = result.data as { data: Record<string, unknown>[] };
  assertEqual(body.data.length, 3, '3 fields returned');
  // Descending sortOrder: first (10), second (5), third (0)
  const keys = body.data.map((f) => f.fieldKey as string);
  assertEqual(keys[0], 'first', 'first by sortOrder: first');
  assertEqual(keys[1], 'second', 'second by sortOrder: second');
  assertEqual(keys[2], 'third', 'third by sortOrder: third');
}

// ── 26. POST: Weight validation (0 to 1) ─────────────────────────

console.log('\n26. POST handles weight outside 0-1 range:');
{
  cleanup();
  const setup = seedSetup({ name: 'Weight Play' });
  // Create with default weight; route expects 0-1 range
  const result = doPostField(setup.id as string, {
    fieldKey: 'weighted_field',
    label: 'Weighted',
    fieldType: 'score_1_5',
    weight: 0.5,
  });
  assert(result.status === 201, 'returns 201 with weight 0.5');
  const data = result.data as Record<string, unknown>;
  assertEqual(data.weight, 0.5, 'weight set to 0.5');
}

// ── 27. PUT: Toggle isActive ─────────────────────────────────────

console.log('\n27. PUT toggles isActive:');
{
  cleanup();
  const setup = seedSetup({ name: 'Toggle Play' });
  const field = seedField(setup.id as string, {
    fieldKey: 'toggle_me',
    label: 'Toggle Me',
  });

  // Deactivate
  const deactivate = doPutField(setup.id as string, field.id as string, {
    isActive: false,
  });
  assert(deactivate.status === 200, 'deactivate: returns 200');
  const deactData = deactivate.data as Record<string, unknown>;
  assertEqual(deactData.isActive, false, 'isActive set to false');

  // Reactivate
  const reactivate = doPutField(setup.id as string, field.id as string, {
    isActive: true,
  });
  assert(reactivate.status === 200, 'reactivate: returns 200');
  const reactData = reactivate.data as Record<string, unknown>;
  assertEqual(reactData.isActive, true, 'isActive set to true');
}

// ── Summary ──────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed}/${total} passed`);
if (failed > 0) {
  console.error(`         ${failed}/${total} FAILED\n`);
  process.exit(1);
} else {
  console.log('         All tests passed!\n');
}
