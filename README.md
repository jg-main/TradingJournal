# Trading Journal

A local-first trading journal for tracking trade ideas, plans, executions,
risk, reviews, account activity, watchlists, and performance dashboards.

## Stack

- Next.js 16 + React 19
- TypeScript
- Drizzle ORM
- SQLite through `better-sqlite3`
- Tailwind CSS + shadcn/radix-style UI components
- Vitest for unit tests
- Playwright for end-to-end tests

## Setup

```bash
make setup
make dev
```

Open `http://localhost:3000`.

`make setup` installs dependencies, runs Drizzle migrations, and seeds reference
lookup data.

## Common Commands

```bash
make dev          # start the app on port 3000
make lint         # run ESLint
make typecheck    # run TypeScript checks
make test         # run Vitest unit tests
make playwright   # run Playwright e2e tests
make build        # production build
```

Run `make help` for the full command list.

## Database

The default database is:

```text
.trading-journal/journal.db
```

Useful database commands:

```bash
make db-migrate   # apply migrations
make db-generate  # generate a migration after schema changes
make db-reset     # recreate local database and seed lookup data
make db-studio    # open Drizzle Studio
```

Schema lives in `src/db/schema.ts`; migrations live in `src/db/migrations/`.

## Project Layout

```text
src/app/          Next.js pages and API routes
src/components/   shared UI components
src/lib/          shared business logic and calculations
src/db/           Drizzle schema, migrations, seed, benchmark scripts
e2e/              Playwright specs
```

## Notes

- Local databases, Playwright output, build output, and test databases are
  generated artifacts and should not be committed.
- Agent/developer workflow notes live in `AGENTS.md`.
