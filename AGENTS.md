# Trading Journal Agent Guide

## Project Shape

- This is a local-first trading journal app built with Next.js App Router under
  `src/app`, React client pages/components, API route handlers, Drizzle ORM, and
  SQLite via `better-sqlite3`.
- Main product areas are trades, executions, risk snapshots, stop adjustments,
  mistakes, assets, grading, watchlist promotion, accounts, app/risk settings,
  setup definitions, lookup values, dashboard metrics, weekly reviews, and
  backup/export flows.
- Shared business logic lives in `src/lib/*.ts`; keep calculations and
  aggregation logic there when it needs unit coverage or reuse.
- Database access is centralized through `src/db/index.ts` and schema lives in
  `src/db/schema.ts`. Migrations are committed in `src/db/migrations`.

## Commands

- Install/bootstrap: `make setup`
- Dev server: `make dev` or `npm run dev -- -p 3000`
- Lint: `make lint`
- Typecheck: `make typecheck`
- Unit tests: `make test`
- E2E tests: `make playwright`
- Production build: `make build`
- Run migrations: `make db-migrate`
- Generate migrations after schema edits: `make db-generate`
- Seed reference lookup data: `make seed`

For small changes, run the narrowest relevant command first, then broaden when
the change touches shared contracts, database schema, or cross-page workflows.

## Database And Data Rules

- The default runtime database is `./.trading-journal/journal.db`; tests may use
  `.test*db` files. Do not commit local database files, WAL/SHM files, reports,
  or generated backups.
- `src/db/index.ts` auto-applies pending migrations at startup. Schema changes
  should update `src/db/schema.ts`, generate a migration, and include focused API
  or library tests for the affected behavior.
- API routes should validate request bodies with `zod`, return JSON through
  `NextResponse`, and preserve existing error payload shapes unless a task
  explicitly changes the contract.
- Keep lookup/setup behavior consistent with `src/lib/setup-resolver.ts`; trades
  accept setup names at the UI/API edge but store resolved setup ids.

## Frontend Conventions

- Use the existing shadcn/radix-style components in `src/components/ui` before
  adding new component primitives.
- Use `lucide-react` icons for icon buttons and actions where an icon exists.
- The app is an operational journal, so prefer dense, scannable interfaces over
  marketing-style layouts. Keep tables, forms, dialogs, filters, and dashboards
  predictable.
- Match existing Tailwind v4/global token usage in `src/app/globals.css`.
  Avoid one-off color systems unless the design task requires it.
- Many pages are client components because they manage forms and fetch API data.
  Add `'use client'` only where browser state/effects/events require it.

## Testing Expectations

- Add or update Vitest tests beside shared logic and API routes using the
  existing `*.test.ts` patterns.
- Add or update Playwright specs in `e2e/` for user-facing flows that span pages,
  dialogs, navigation, or persisted browser behavior.
- For database-affecting work, verify migrations and at least one runtime path
  that exercises the new schema.
- For UI-only work, verify with lint/typecheck and a targeted Playwright test or
  manual dev-server inspection when a browser behavior could regress.

## Repo Hygiene

- Keep edits scoped to the requested feature or fix. Do not rewrite generated
  migration history or clean unrelated files.
- Do not commit or rely on generated artifacts from `playwright-report/`,
  `test-results/`, `.next/`, `.trading-journal/`, `.test*db`, or `.gsd-*`.
- `npm run clean:artifacts` removes `docs` in this repo. Do not place durable
  project documentation under `docs/` unless you also update that cleanup
  behavior intentionally.
- `CLAUDE.md` is only a pointer to this file; keep operational agent guidance
  here.
