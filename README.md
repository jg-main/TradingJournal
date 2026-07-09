# Trading Journal

A local-first trading journal for tracking trade ideas, plans, executions,
risk, reviews, account activity, watchlists, and performance dashboards.

## Table of Contents

- [Features](#features)
- [Quickstart](#quickstart)
- [Stack](#stack)
- [Setup](#setup)
- [Common Commands](#common-commands)
- [In-App Help](#in-app-help)
- [Database](#database)
- [Project Layout](#project-layout)
- [Notes](#notes)

## Features

- **Trade Planning** — Plan trades with setup selection, direction (long/short),
  position sizing calculator, and entry/exit criteria.
- **Execution Tracking** — Record fill details with support for partial fills
  and multiple executions per trade.
- **Risk Management** — Log risk snapshots, stop adjustments, and track
  position-level P&L while trades are open.
- **Trade Grading** — Grade every closed trade (A–F) on process quality
  covering entries, exits, risk management, and emotional discipline.
- **Mistake Tracking** — Tag mistakes during grading (minor/moderate/major/
  critical) and review patterns over time.
- **Weekly Reviews** — Auto-aggregate weekly metrics including win rate,
  average R-multiple, net P&L, and process scores with action items.
- **AI Assessment** — Optional AI-powered feedback on trade execution quality
  through OpenAI or Anthropic.
- **Dashboard** — KPI cards, charts, and performance visualization with
  date-range filtering.
- **Accounts** — Multi-account support with deposits, withdrawals, and
  balance roll-forward.
- **Watchlist** — Track instruments across accounts with price-based
  promotion to active trading.
- **Backup & Restore** — Export full journal data as ZIP and restore from
  previous backups with preview and confirmation.
- **In-App Help** — A dedicated `/help` page with quickstart guide and
  documentation for all core workflows.

## Quickstart

1. Set up your profile and risk settings under **Settings > App Profile** and
   **Settings > Risk Settings**.
2. Add a brokerage account under **Settings > Accounts** — at least one active
   account is required to log trades.
3. Create trading setups under **Settings > Plays** (these drive the Plan Trade
   dropdown).
4. Start logging trades from the **Trade Log** page using the "Plan Trade"
   button.
5. Grade closed trades and run weekly reviews from the **Reviews** page.

For detailed walkthroughs of each workflow, open the **Help** page from the
sidebar navigation or visit `/help`.

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

## In-App Help

The app includes a built-in `/help` page accessible from the sidebar (Help
icon) or by navigating directly to `http://localhost:3000/help`. It covers:

- **Quickstart Guide** — Get up and running in a few minutes.
- **Trade Lifecycle** — How trades flow from planning through grading.
- **Accounts** — Manage brokerage accounts, deposits, and withdrawals.
- **Weekly Reviews** — Aggregate your trading performance week by week.
- **AI Assessment** — Get AI-powered feedback on your trade execution quality.
- **Settings Reference** — Understand each settings section at a glance.
- **Backup & Restore** — Protect your data and recover from failures.

Contextual help tooltips are available on the Plan Trade form and AI Settings
form — hover the info icon next to any field label for inline guidance.

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
