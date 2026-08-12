# TradingJournal Agent Guide

## Authority and Operating Model

- This guide applies to every coding agent, model family, provider, and harness
  used in the repository.
- `AGENTS.md` is the authoritative repository engineering and product guide.
  Runtime-specific files such as `CLAUDE.md` may point here but must not contain
  conflicting durable instructions.
- GSD-Pi selects models through the active session, global preferences, and
  routing policy. Do not introduce provider-specific prompts, architectural
  conventions, or workarounds unless a task explicitly documents a real
  compatibility requirement.
- Before planned work, read the active GSD milestone, slice, task context,
  decisions, and prior verification evidence.
- When instructions conflict, follow this order:
  1. Safety and data integrity.
  2. Explicit user requirements.
  3. Active GSD milestone, slice, and task context.
  4. This file and documented domain invariants.
  5. Applicable project skills, such as `trading-product-ux`.
  6. Shared engineering skills installed in `~/.agents/skills`.
  7. General framework or design conventions.

## Project Shape

- This is a local-first trading journal built with Next.js App Router under
  `src/app`, React client pages and components, API route handlers, Drizzle ORM,
  and SQLite via `better-sqlite3`.
- Main product areas include trades, executions, risk snapshots, stop
  adjustments, mistakes, assets, grading, watchlist promotion, accounts,
  ledger and cash activity, app/risk settings, setup definitions, lookup
  values, dashboard metrics, weekly reviews, and backup/export flows.
- Shared business logic belongs in `src/lib/*.ts` when it requires unit coverage
  or reuse.
- Database access is centralized through `src/db/index.ts`; schema lives in
  `src/db/schema.ts`; migrations are committed in `src/db/migrations`.

## GSD Delivery Discipline

- Use the GSD hierarchy: milestone → slice → task.
- Prefer reviewable vertical slices that deliver a complete user-visible or
  domain outcome.
- Do not create vague slices such as “improve styling,” “build components,” or
  “refactor UI.” Tie the slice to a route, workflow, domain contract, or
  verifiable behavior.
- Reassess the remaining roadmap after each slice when evidence invalidates
  earlier assumptions.
- Keep changes scoped to the active slice. Broad refactors are permitted only
  when the approved milestone or slice requires them.
- Record unmet acceptance criteria rather than silently weakening them.

## Skill Usage

Shared engineering skills are installed for every harness and resolve from
`~/.agents/skills`. Project-local skills under `.agents/skills` take precedence
over them on name collision.

GSD-Pi also reads machine-readable routing rules from the `skill_rules` block in
`.gsd/PREFERENCES.md`. Other harnesses do not read that file, so the same
expectations are restated here in prose. When you change one, change the other.

Select the narrowest applicable skill and load only the references the active
task needs. A skill supplies technique; it does not override this file,
`docs/design-system.md`, or a documented domain invariant.

| Situation | Use | Also consider |
|---|---|---|
| Substantial UX work on navigation, dashboards, tables, forms, dialogs, or cross-page journeys | `trading-product-ux` — use `dashboard-workstation` for dashboard direction and `visual-critique` before changing an existing dashboard | `accessibility`, `web-design-guidelines` |
| React components, Next.js routes, client fetching, charts, or UI-affecting handlers | `react-best-practices` | `accessibility`, `lint` |
| Implementing an approved visual direction or focused visual refinement | `frontend-design` | `make-interfaces-feel-better`, `accessibility` |
| API route handlers, Drizzle schema, migrations, backup/export, import normalization, persisted contracts | `api-design` | `tdd`, `test`, `review` |
| Auth, secrets, filesystem access, database writes from untrusted input, export surfaces | `security-review` | `api-design`, `test` |
| Tests fail, builds fail, runtime behavior is unexpected, or a prior fix did not hold | `systematic-debugging` | `debug-like-expert`, `test` |
| Slow rendering, large trade datasets, bundle growth, or query cost | `code-optimizer` | `react-best-practices`, `core-web-vitals` |
| Planning a milestone or slice | `decompose-into-slices` | `grill-me`, `codebase-recon` |
| Upgrading dependencies | `dependency-upgrade` | `test`, `review` |
| Writing or restructuring durable documentation | `write-docs` | — |
| Before claiming a task, slice, or milestone complete | `verify-before-complete` | `test`, `lint` |

Some names resolve differently per harness. Treat the *Situation* column as the
instruction and the skill name as a hint:

- Browser verification is harness-specific. Use the browser automation the
  active harness provides, and fall back to the repository's Playwright specs
  in `e2e/`. The evidence requirement in *Testing and Evidence* is identical
  either way.
- `review` and `security-review` resolve to built-in equivalents in some
  harnesses. In Claude Code, use `/code-review` for the working diff and
  `/security-review` for pending changes; the built-in `review` targets a
  GitHub pull request rather than local changes.

## UX Design Policy

For substantial user-facing work—navigation, dashboards, tables, forms,
dialogs, workflows, or cross-page journeys—use the project-local
`trading-product-ux` skill. Select the narrowest applicable mode and
load only its needed references.

`trading-product-ux` owns workflow structure, information architecture, and
visual acceptance for this product. The general frontend skills above supply
implementation technique only; where they disagree with `trading-product-ux` or
`docs/design-system.md`, this repository's guidance wins.

`docs/design-system.md` is the authoritative visual reference for product
identity, tokens, density, primitives, chart semantics, and prohibited
patterns. `src/app/globals.css` and `src/lib/chart-palette.ts` are the
authoritative token implementations. Do not create a competing design guide.

For dashboard work, `PRODUCT.md` defines the risk-first product role and
`docs/design-system.md` defines the workstation readability and data-state
rules. General visual skills can improve implementation craft, but must not
replace these priorities or invent a separate dashboard direction.

The current application design is established. Treat `implementation` as the
normal mode; use redesign modes only when a task explicitly changes workflow
structure or information architecture. Any future parallel replacement needs
an explicit coexistence and cutover decision.

### Dashboard layout and data-display policy

The risk-first dashboard is a dense operational workstation, not a set of
independently expanding cards. Its curated default dedicates full width to the
main risk summary and the trade table; Account State, Performance, and Review
Metrics share one compact equal-width summary row between them. Analytical
charts belong below the trade workflow, not inside a summary widget or in a
large empty placeholder.

Within a metric group, labels occupy the start edge and all financial,
percentage, ratio, quantity, and count values occupy a common end-aligned
numeric edge with tabular numerals. Supporting scope, source, and timestamp
text is subordinate to its label or value; it must not create a third
widely-spaced data column. Wide space is reserved for comparison tables and
charts, never for a scalar value.

Saved views may support drag and resize only in an explicit arrangement mode.
Keep the alert strip, main risk metrics, and trade workflow protected in the
curated default; expose a visible drag handle and constrained resize control
only while arranging a user-owned view. Reuse the installed
`react-grid-layout` package for this interaction unless an implementation
review documents a concrete gap. Persist only validated, versioned layout
data, preserve user-owned views during a layout migration, and never make
ordinary reading depend on nested panel scrollbars.

## Commands

- Install/bootstrap: `make setup`
- Dev server: `make dev` or `npm run dev -- -p 3000`
- Lint: `make lint`
- Typecheck: `make typecheck`
- Unit tests: `make test`
- Complete test orchestrator: `make test-all`
- E2E tests: `make playwright`
- Production build: `make build`
- Run migrations: `make db-migrate`
- Generate migrations after schema edits: `make db-generate`
- Seed reference lookup data: `make seed`

For small changes, run the narrowest relevant command first, then broaden when
the change touches shared contracts, database schema, or cross-page workflows.

### GSD verification time budget

- GSD host verification has a per-command time limit. Run browser verification,
  lint, typecheck, build, and test orchestration as separate commands; do not
  join them into one long `&&` chain.
- Use a targeted Playwright spec for the active workflow during task execution.
  Run the full browser matrix separately at the slice/milestone boundary or in
  CI, where its longer runtime is explicitly budgeted.
- `make playwright` runs the entire suite once per configured browser. It is a
  full-matrix command, not an appropriate default for a single GSD task.

The slice-completion quality gate is:

```bash
make lint
make typecheck
make build
make test-all
```

Run targeted Playwright or browser verification for every changed user-facing
workflow.

### Browser test runtime and generated artifacts

- Playwright's configured web server must launch Next with `--webpack`. This is
  the stable development path for this workspace; do not switch the browser
  server to the default Turbopack path without investigating `.next` ownership
  and cache behavior first.
- Local Playwright reports and test results are written to a per-run directory
  under `/tmp` (or to `PLAYWRIGHT_ARTIFACT_DIR` when explicitly set). CI keeps
  its report directories in the repository so workflow artifact upload can
  collect them. These outputs are never source files and must not be committed.
- When running Playwright or Next in Docker with the repository bind-mounted,
  run the container as the host user and group, for example
  `--user "$(id -u):$(id -g)"`. This prevents root-owned `.next`, report, and
  test-result files that later cause local development and cleanup failures.
- If a browser run reports a Turbopack panic or permission error, inspect the
  configured web-server command and ownership of ignored generated artifacts
  before changing product code. Repair only those generated artifacts; do not
  broaden cleanup to tracked source files.

## Database and Data Rules

- The default runtime database is `./.trading-journal/journal.db`; tests may use
  `.test*db` files.
- Do not commit local database files, WAL/SHM files, reports, or generated
  backups.
- `src/db/index.ts` auto-applies pending migrations at startup.
- Schema changes must update `src/db/schema.ts`, generate a migration, and
  include focused API or library tests for the affected behavior.
- API routes must validate request bodies with `zod`, return JSON through
  `NextResponse`, and preserve existing error payload shapes unless an approved
  task changes the contract.
- Keep lookup/setup behavior consistent with `src/lib/setup-resolver.ts`;
  trades accept setup names at the UI/API edge but store resolved setup IDs.
- Treat database and API contracts as authoritative domain interfaces, not as
  instructions for screen layout. New UX surfaces may use typed adapters.

## State and Data-Fetching Rules

- Give shared state one clear owner.
- Avoid duplicate account selectors, filters, P&L calculations, position state,
  review state, and validation rules.
- Do not let multiple widgets or panels independently fetch the same shared
  domain data.
- Separate live market-state refresh from historical analytics.
- Keep business calculations outside visual components.
- Validate persisted user configuration and saved layouts with explicit schemas.
- Namespace replacement state only when an explicitly approved coexistence
  strategy requires it.

## Frontend Conventions

- Follow `docs/design-system.md` for visual and interaction conventions; reuse
  the normalized primitives in `src/components/ui` before adding a new one.
- Use semantic Tailwind utilities backed by `globals.css`; do not introduce
  arbitrary colors, spacing systems, or competing visual tokens.
- Use `lucide-react` only when an icon adds action meaning. The product remains
  a dense, scannable operational journal, not a marketing or executive surface.
- Add `'use client'` only where browser state, effects, or events require it.
- Preserve keyboard access, visible focus, semantic controls, and accessible
  labels.

## Computation Ownership

Milestone M026 (`vfox76`) consolidated six pure computation libraries under
`src/lib/`. These libraries are canonical domain logic. They use plain
arguments and must not import database access or `NextResponse`.

### Library Map

| Library | Responsibility | Depends On | API Callers |
|---|---|---|---|
| `trade-calc.ts` | P&L, R-multiple, trade status derivation, average cost, realized P&L | — | Downstream calculation libraries |
| `risk-snapshot.ts` | Equity-at-open computation, initial risk derivation, risk snapshot values | `trade-calc` | Execution creation routes |
| `account-summary.ts` | Account KPIs, balance rollforward, dates active | `trade-calc` | Account detail and close routes |
| `metrics.ts` | Win-rate policies, averages, process scores | — | Dashboard and review routes |
| `mark-to-market.ts` | Open positions, unrealized P&L, aggregate MTM with `FeePolicy` | `trade-calc` | Dashboard and trade-detail routes |
| `position-sizing.ts` | Position size and risk/reward preview | — | Plan Trade workflow |

### Naming Convention

- Files use kebab-case domain names, such as `risk-snapshot.ts`.
- Exported types use PascalCase.
- Exported functions use camelCase verbs prefixed with `compute`, `calculate`,
  `derive`, or `classify`.
- Tests live beside the library using existing Vitest or standalone TSX
  patterns.
- Pure libraries declare their own input/output types instead of importing
  Drizzle schema types.

### Domain Invariants

1. **Fee-policy divergence:** `mark-to-market.ts` exposes
   `include_entry_fees` and `exclude_entry_fees`, preserving the established
   dashboard/trade-detail behavior until an approved domain change reconciles
   it.
2. **Win-rate policy:** `metrics.ts` defines `includeZeroAsLoss`,
   `excludeScratches`, and `allDecisions`; each caller must use its intended
   denominator semantics.
3. **Account-equity cascade:** `computeEquityAtOpen` uses effective equity above
   zero, then the global fallback setting, then `null`.
4. **R-multiple guard:** R calculations return `null` when
   `initialRiskAmount <= 0`.
5. **Position-sizing validation:** invalid numeric inputs throw descriptive
   `Position sizing error:` messages.

Do not duplicate or reinterpret these calculations inside UI components or API
routes. Change an invariant only through an explicit domain task with tests and
contract review.

## Testing and Evidence

- Add or update Vitest tests beside shared logic and API routes using existing
  `*.test.ts` patterns.
- Standalone TSX tests run through `make test-all` and
  `scripts/run-all-tests.ts`.
- Cross-library consistency is covered by
  `src/lib/__fixtures__/golden-scenarios.test.tsx`.
- API response-shape regression is covered by
  `src/lib/__fixtures__/response-contracts.test.ts`.
- Add or update Playwright specs in `e2e/` for workflows spanning pages,
  dialogs, navigation, persistence, keyboard behavior, or saved browser state.
- For database-affecting work, verify migrations and at least one runtime path
  exercising the new schema.
- For user-facing work, use realistic populated data and inspect the rendered
  result at the target viewport.
- Preserve screenshots or equivalent browser evidence when the active
  milestone requires visual acceptance.
- Report tests not run, evidence not captured, and acceptance criteria not met.
- When a feature has a clear observable contract, drive it with `tdd` rather
  than writing tests after the fact.
- Apply `verify-before-complete` before claiming a task, slice, or milestone is
  done. Evidence must be produced in the current message, not recalled from
  earlier in the session. Passing tests are not visual acceptance.

## Documentation

Update durable documentation when a change affects:

- Architecture.
- Domain contracts.
- User workflows.
- Setup or operational commands.
- Migration or cutover behavior.
- New project-local skills.

Place durable project documentation under `docs/`. Keep GSD milestone and slice
artifacts aligned with the implementation. Use `write-docs` for proposals,
specs, ADRs, and any document that must be readable without the authoring
session's context.

When a change adds, removes, or repurposes a skill, update both the *Skill
Usage* table in this file and the `skill_rules` block in `.gsd/PREFERENCES.md`
so every harness sees the same policy.

## Repository Hygiene

- Do not rewrite generated migration history.
- Do not clean or reformat unrelated files.
- Do not commit or rely on generated artifacts from `playwright-report/`,
  `test-results/`, `.next/`, `.trading-journal/`, `.test*db`, or `.gsd-*`.
- Do not modify a preserved legacy surface during a parallel greenfield slice
  unless the slice explicitly includes compatibility work.
- The `docs/` directory is preserved by `npm run clean:artifacts`.
