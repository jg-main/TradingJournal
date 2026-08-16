/**
 * Source contract for M020's manual browser-evidence helpers.
 *
 * The helpers must require an explicitly supplied disposable database and
 * pass the API-created fixture ID to the browser check. They must never
 * default to the user's local journal database.
 *
 * Run: npx tsx scripts/__tests__/m020-evidence-isolation.test.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedSource = fs.readFileSync(path.resolve(__dirname, '../seed-s04-evidence.mts'), 'utf-8');
const browserSource = fs.readFileSync(path.resolve(__dirname, '../s04-t02-browser-evidence.mts'), 'utf-8');

const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ❌ ${message}`);
  }
}

console.log('\n## M020 evidence isolation');

assert(!seedSource.includes("'./.trading-journal/journal.db'"), 'seed helper has no production journal default');
assert(seedSource.includes('M020_EVIDENCE_DB_PATH'), 'seed helper requires an explicit evidence database');
assert(seedSource.includes('M020_EVIDENCE_FIXTURE_PATH'), 'seed helper writes the created fixture identity');
assert(!browserSource.includes("'224c4246-7747-46db-8778-c6e390e2b526'"), 'browser helper has no hard-coded trade ID');
assert(browserSource.includes('M020_EVIDENCE_FIXTURE_PATH'), 'browser helper reads the seeded fixture identity');
assert(browserSource.includes('M020_EVIDENCE_BASE_URL'), 'browser helper requires an explicit isolated server URL');
assert(
  seedSource.includes('thesis:') && seedSource.includes('invalidationCondition:'),
  'evidence fixture includes narrative context for the wide layout',
);
assert(
  !seedSource.includes('733a4e22-5710-44ec-a134-f2a25c7e8358'),
  'seed helper has no pre-existing checklist-definition ID dependency',
);
assert(
  seedSource.includes('INSERT INTO checklist_definitions'),
  'seed helper creates its checklist prerequisite in the evidence database',
);
assert(
  seedSource.includes('fs.accessSync(DB_PATH, fs.constants.W_OK)'),
  'seed helper checks evidence database write access before issuing API writes',
);
assert(
  browserSource.includes('lifecycle lifecycle lifecycle') &&
    browserSource.includes('left details right'),
  'browser helper asserts the lifecycle-first continuous-column hierarchy',
);
assert(
  !browserSource.includes('cockpit details risk') &&
    !browserSource.includes('context history review') &&
    !browserSource.includes('td-grid-stack'),
  'browser helper no longer expects row-aligned or retired-stack layouts',
);

if (failures.length > 0) {
  console.error(`\n${failures.length} evidence-isolation assertions failed.`);
  process.exit(1);
}

console.log('\nAll M020 evidence-isolation assertions passed.');
