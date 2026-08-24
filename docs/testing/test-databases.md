# Test Database and Temporary-Artifact Strategy (H1)

## Invariant

> Tests and diagnostic scripts must not create disposable databases or
> temporary artifacts in the repository root.

The repository root must stay clean after any test/UAT workflow run. The
root-pollution regression guard (`scripts/check-root-test-artifacts.mjs`,
wired into `make test-all` via `scripts/run-all-tests.ts`) fails the suite
whenever a `.test-*.db`, `.test-*.db-wal`, or `.test-*.db-shm` appears at the
repository root.

## Temporary database location

All disposable SQLite test databases live under the **OS temporary directory**
(`os.tmpdir()`), never the repository root. Each suite gets a **unique** path
so parallel Vitest workers cannot collide:

- Single-file suites: `/tmp/tradingjournal-test-<name>-<pid>-<uuid>.db`
  (via `testDbPath(name)`).
- Multi-file suites (backup/restore, scratch): a dedicated
  `/tmp/tradingjournal-test-<name>-<uuid>/` directory
  (via `createTestTempDir(name)`).

Abrupt process death (SIGKILL / crash) may leave stale artifacts under `/tmp`
— acceptable. It can never dirty the repository source tree, which is the
structural guarantee H1 enforces.

## Shared helper

`src/lib/testing/test-db.ts` centralizes lifecycle:

- `testDbPath(name)` — unique OS-temp SQLite file path.
- `createTestTempDir(name)` / `disposeTempDir(dir)` — owned temp directory
  allocation/removal (ownership-checked: must be under `os.tmpdir()` with the
  `tradingjournal-test-` prefix).
- `disposeSqliteFile(sqlite, dbPath)` — closes the connection, then removes
  the DB, WAL, and SHM companions (existence-safe, idempotent).
- `applyAllMigrations(sqlite)` — applies every committed drizzle migration.
- `createTestDatabase({ migrations, bootstrap })` — full context
  `{ sqlite, dbPath, tempDir, dispose }` in a unique owned temp directory.

## How to add a new SQLite test

```ts
import { createTestDatabase } from '@/lib/testing/test-db';

let ctx: ReturnType<typeof createTestDatabase>;
beforeAll(() => { ctx = createTestDatabase({ migrations: true }); });
afterAll(() => { ctx.dispose(); });
```

For suites that must set `process.env.DB_FILE_NAME` before production DB
modules resolve it, call `testDbPath('name')` at exactly the point the old
root-relative literal was assigned (module top, or inside `vi.hoisted` for the
vitest case — where the path must be built inline from `process.env.TMPDIR`
because `vi.hoisted` callbacks cannot reference imports).

Cleanup runs via `afterAll`/`afterEach`/`finally`, so an ordinary failing
test still disposes its owned resources.

## Ownership and safety

- Cleanup helpers only ever delete paths they own (temp dir prefix + under
  `os.tmpdir()`). An unowned path fails the ownership assertion instead of
  being deleted.
- Never write a `*.db`/`*.sqlite*` deletion command that globs the repository.
  The real application database is `./.trading-journal/journal.db` and must
  never be touched by test cleanup; neither are backups, migrations, fixtures,
  or intentional `docs/uat/**` evidence.

## Intentional evidence

Task-requested UAT screenshots under `docs/uat/<task>/` are durable evidence
and are **not** deleted by any cleanup. Ordinary Playwright output stays in
its configured ephemeral locations (`/tmp/trading-journal-playwright-*/`,
`test-results/`, `playwright-report/`).
