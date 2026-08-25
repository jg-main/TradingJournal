# Functional Defect Audit — TradingJournal

Scope: workflow correctness, accounting/ledger accuracy, production readiness.
Excluded by request: UX improvements, new metrics.

Baseline evidence (2026-08-25, commit `beb434f`):
- `npx tsc --noEmit` → clean.
- `npx vitest run` (repo config) → 230 files / 4826 tests, all pass.
- 313 test files exist; **49 are in no runner** — 28 pass when invoked directly,
  **21 no longer run at all** (see D5).

## Summary

| # | Severity | Area | Defect |
|---|---|---|---|
| D1 | **Critical** | Accounting | Correcting a short position posts cash in the wrong direction (reproduced) |
| D2 | **Critical** | Accounting | Legacy migration re-creates the bug `cash-direction-repair.ts` exists to fix |
| D3 | High | Accounting | Reconciliation computes short cash and position counts with the un-fixed mapping |
| D4 | Medium | Accounting | Account activity display inverts cash direction for short management fills |
| D5 | High | Prod readiness | 49 test files wired into no runner; 21 no longer run at all |
| D6 | Low | Accounting | Dead fail-open mirror module still documented as the live path |
| D7 | Medium | Workflow | Superseded cash endpoint still mounted, bypasses ledger, no idempotency or transaction |
| D8 | Medium | Accuracy | Server-side period bucketing uses UTC while the user timezone is display-only |
| D9 | Low | Observability | Reconciliation failure is swallowed and renders as a healthy account |

D1–D4 are one root cause: the M002-A5 economic-action boundary was applied to
the two execution write paths but not to the other six call sites that map a
raw action to a cash direction.

---
## D1 — CRITICAL: Correcting a short position posts cash in the wrong direction

**Files**
- `src/lib/accounting/correction.ts:376`, `src/lib/accounting/correction.ts:424`
- `src/lib/accounting/correction-contracts.ts:96` (`correctionInputSchema.action` accepts `add`/`reduce`)
- `src/app/api/accounts/[id]/executions/[executionId]/correct/route.ts:77,126` (passes `action` through unresolved)
- `src/app/api/trades/[id]/executions/[execId]/correct/route.ts:107,186` (same — and it already holds `trade.direction`, used at `:180`)
- `src/components/trade-detail/correction-dialog.tsx:453` + `src/components/trade-detail/add-fill-dialog.tsx:99` (`getFillActions('short')` offers **Add** and **Reduce** in the correction dropdown)

**Description**
M002-A5 established that canonical accounting must never derive cash direction
from the generic workflow aliases `add`/`reduce`; `execution-posting.ts` correctly
calls `cashDirectionForEconomicAction(resolveEconomicExecutionAction(...))`.
The correction service never adopted that boundary. It still uses the pre-A5
literal:

```ts
direction: ['sell', 'reduce', 'sell_short'].includes(replacementAction) ? 'increase' : 'decrease'
```

`correctionInputSchema` accepts `add` and `reduce`, and the route forwards the
action verbatim, so a correction is a **live write path that stores a generic
alias in `accounting_executions.action`** and posts cash off the raw mapping.
For a short position both aliases are inverted (`short add` = sell_short =
increase; `short reduce` = buy_to_cover = decrease).

**Failure scenario (reproduced)**
Short 100 AAPL @ 200, then `buy_to_cover` 20 @ 180 (cash −3,600, posted
correctly). `POST /api/accounts/{id}/executions/{execId}/correct` with
`{action:"reduce", quantity:"20.00", price:"180.00"}`:
- reversal posts `increase` 3,600 (correct)
- replacement posts **`increase` 3,600 — should be `decrease`**

The three events net: original −3,600, reversal +3,600, replacement +3,600.
Net cash ends **+3,600 where it should be −3,600** — a 7,200 swing on a 3,600
correction.
FIFO quantities stay correct (it resolves aliases against position direction),
so positions look right while cash/NAV is wrong — the drift is silent.

Verified with a reproduction test against real migrations:
`expected 'increase' to be 'decrease'`.

**Reachable from the UI, not just the API.** `correction-dialog.tsx` populates
its action select from `getFillActions(trade.direction)`, and commit `beb434f`
("expose short add and reduce management actions") added `add`/`reduce` to the
short list. A trader correcting a short fill and picking "Reduce" from the
dropdown corrupts account cash with no error.

**Note:** the same statement means the replacement row is persisted with
`action = 'reduce'` in `accounting_executions`, violating the A5 invariant that
the canonical table holds concrete economic actions only. Neither correction
route resolves the economic action first, though both have the trade direction
in hand.

**Reproduction** — kept at
`/tmp/claude-1000/-home-javier-Projects-TradingJournal/94ee70c7-00c4-4939-9559-6b25860facbf/scratchpad/correction-short-repro.test.ts`
(not added to the repo). It asserts position quantity `80.00` / direction
`short` (both pass — quantities are correct) before asserting the cash
direction, which fails.

---

## D2 — CRITICAL: Legacy migration re-creates the exact bug `cash-direction-repair.ts` exists to fix

**File** `src/lib/accounting/legacy-migration-runner.ts:551`

**Description**
`cash-direction-repair.ts` documents that pre-A5 writes inverted cash for short
`add`/`reduce` and states "A5 fixes all NEW writes (engine + direct account
route)". The legacy migration runner was not included. It copies
`trade_executions.action` verbatim — a column whose enum legitimately contains
`add`/`reduce` (`src/db/schema.ts:123`) — into `accounting_executions` and
derives the cash effect from the same pre-A5 literal.

**Reachable from the UI.** `src/components/accounting/account-reconciliation-summary.tsx:245`
POSTs to `/api/accounts/{id}/migration`, so this runs from a button in the
account reconciliation view — not only from the CLI. The route documents itself
as safe to re-run ("previously imported records are detected and skipped"),
which makes it a *repeatable* corruption rather than a one-shot cutover.

**Failure scenario**
A journal containing a short trade with an `add` fill is migrated via that
button (or `npm run accounting:migrate`). The migration posts that fill as a cash
*decrease* when it is economically a `sell_short` (increase). The account is
corrupted **by the migration itself**, and the operator must then run
`accounting:repair` to undo damage the tool just created. The writer was never
fixed — only the data was patched.

---

## D3 — HIGH: Reconciliation, the safety net, computes short cash and position counts with the un-fixed mapping

**File** `src/lib/accounting/reconciliation.ts:210`, `src/lib/accounting/reconciliation.ts:642`

**Description**
Both legacy-side queries read `trade_executions.action` — where `add`/`reduce`
are the normal stored values — and apply the raw mapping.

- `:210` legacy net cash. For a **long** position the raw mapping is correct
  (`add` = buy = decrease, `reduce` = sell = increase). For a **short** it is
  inverted on both sides: `add` is economically `sell_short` (cash increase)
  but maps to decrease, and `reduce` is `buy_to_cover` (cash decrease) but
  maps to increase.
- `:642` `queryLegacyPositionCount`: `sign = ['sell','reduce','sell_short'].includes(action) ? -1 : 1`.
  For a short, `add` gets `+1` and `reduce` gets `-1` — both inverted.

**Failure scenario**
Short 100, add 50, reduce 150 (fully closed). Signed quantity computes
−100 +50 −150 = **−200**, so the symbol is counted as an open position and the
account reports a position-count mismatch forever, even though it is flat.
Correspondingly the cash comparison reports a mismatch against a correctly
posted ledger. The check meant to *detect* drift manufactures false drift for
every short trade — and can equally mask genuine drift that happens to cancel.

---

## D4 — MEDIUM: Account activity display inverts cash direction for short management fills

**Files** `src/lib/accounting/activity.ts:181`, `src/components/accounting/account-activity.tsx:69`

**Description**
Same un-fixed literal, applied to the payload action when rendering the
activity/ledger feed. Even where the posted event is correct, the activity view
labels a short `add` as a cash decrease and a short `reduce` as an increase, so
the displayed running cash disagrees with the ledger it is reporting on.

---
## D5 — HIGH: 49 test files are wired into no runner; 21 of them no longer run at all

**Files**
- `vitest.config.ts:26-233` (explicit 234-entry `include` allowlist — no globs)
- `scripts/run-all-tests.ts:23-58` (`TSX_TESTS`, 35 entries — the CI gate via `make test-all`)
- `.github/workflows/quality-gate.yml:27`

**Description**
Test discovery is two hand-maintained allowlists with no glob fallback. 313
test files exist under `src/` and `scripts/`; 49 appear in **neither** list, so
`make test-all` never executes them and nothing reports them as missing.

Classified by running each one through its own documented `npx tsx` path:

- **28 are healthy but unwired** — they pass today and silently protect nothing.
  Includes the entire backup/restore surface
  (`src/app/api/backup/__tests__/{route,files,status,server-restore}.test.ts`,
  `src/app/api/restore/__tests__/route.test.ts`, `src/lib/__tests__/backup.test.ts`,
  `src/lib/backup-serializer.test.ts`, `src/app/api/roundtrip/__tests__/route.test.ts`),
  plus `src/lib/grading.test.ts`, `src/lib/equity.test.ts`,
  `src/lib/export-csv.test.ts`, `src/lib/period-matrix.test.ts`,
  `src/lib/trade-metrics.test.ts`, `src/lib/calendar-heatmap.test.ts`,
  `src/app/api/reset/__tests__/route.test.ts`,
  `src/app/api/dashboard/__tests__/route.test.ts`.
- **21 no longer run at all.** Dominant cause is hand-maintained `CREATE TABLE`
  DDL inside each test file that has drifted from `src/db/schema.ts`:
  `table trades has no column named current_price` (grade, mistakes, assets,
  weekly reviews, reviews dashboard), `setup_definitions has no column named
  analysis_config` (checks/merged, setups/checks, evaluation-fields),
  `position_price_snapshots has no column named short_name` (trade mtm).

**Failure scenario**
A change to grading, mistake tracking, weekly-review aggregation, setup checks,
or backup/restore ships with a green `make test-all`, because every test file
covering it is either absent from both allowlists or dies during setup before
its first assertion.

**Also:** two `include` entries point at paths that do not exist —
`src/app/settings/risk-defaults/__tests__/page.test.tsx` and
`src/app/settings/workspace/__tests__/page.test.tsx` (the real files are under
`src/app/(legacy)/settings/...`). Vitest passes silently on a missing include,
so the allowlist reports success for two suites it is not running.

**Triaged and explicitly NOT defects** (checked against current source — the
tests are stale, the product is correct): `secret-leak.test.ts` asserts the
literal source text `apiKey: _, ...safeRow` while `src/app/api/ai-settings/route.ts:31`
strips the key with `const { apiKey, ...safeRow }`; `server-computed-columns.test.ts`
expects `returnPct` in percent units while the current contract is a fraction,
consistently multiplied by 100 in `src/lib/trade-formatters.tsx:50` and
`src/components/dashboard/formatting.ts:35`; `create-backup.test.ts` builds its
fixture in a temp dir but `getUploadsDir()` (`src/lib/create-backup.ts:41`)
resolves from `process.cwd()`, which the test never changes.

---

## D6 — LOW: dead fail-open mirror module still documented as the live accounting path

**File** `src/lib/positions/trade-execution-sync.ts:186-193`

**Description**
`syncAndRebuildPositions` is documented as "Non-fatal: if the sync or rebuild
fails, the error is logged … and the function returns `{ error }` … The caller
is expected to continue its normal response flow **without rolling back the
trade**." That fail-open contract is the shape that produced the July 2026
journal-sync gap `scripts/backfill-missing-execution-ledger-effects.ts` repairs.

It has **no production callers** — the live path is
`src/lib/trade-execution-engine.ts:980-1030`, which resolves the economic action
and rethrows on posting, FIFO, and performance-rebuild failure (fail-closed).
The writer *was* fixed here. But the module is still exported, and
`src/app/api/trades/[id]/executions/[execId]/correct/route.ts:16,142` still
refers to it in comments as the mirror path, so the next caller to wire it up
reintroduces silent cash omission.

---
## D7 — MEDIUM: superseded cash endpoint still mounted, bypasses the ledger and has no idempotency or transaction

**File** `src/app/api/accounts/[id]/transactions/route.ts:67-155`

**Description**
`POST /api/accounts/:id/transactions` writes deposits and withdrawals directly
into the legacy `account_transactions` table. It never calls
`postFinancialEvent` (zero references to `financial_events` in the file). The
UI has migrated to the canonical surface — `financial-transaction-composer.tsx:359`
and `account-activity.tsx:264` POST to `/api/accounts/:id/financial-events` —
and nothing in `src/` calls `/transactions` any more. The route is still
mounted and writable.

Four compounding problems in the handler:

1. **No ledger posting.** Cash written here never reaches `financial_events`,
   so NAV and the double-entry ledger never see it — while
   `reconciliation.ts:186-192` reads `account_transactions` as the *legacy source
   of truth* for deposits/withdrawals. Any write here becomes a permanent,
   unexplainable reconciliation mismatch.
2. **No idempotency key** (unlike every other cash-mutating route —
   `financial-events`, `executions`, `valuations`, `initialize`, `execute` all
   have one). A retried request duplicates the deposit.
3. **Read-then-write with no transaction.** Balance is aggregated (`:93-101`),
   the withdrawal check runs (`:106`), then the row is inserted (`:129`) —
   all on separate statements. Two concurrent withdrawals can both pass the
   balance check and both commit, overdrawing the account.
4. **`balanceAfter` ignores `date`.** The stored roll-forward is computed from
   an unordered `SUM` over all rows, but `date` is caller-supplied and optional.
   A back-dated transaction gets a `balanceAfter` reflecting transactions that
   occur after it, corrupting the roll-forward column for every out-of-order entry.

Also `amount: z.number()` (`:9`) accepts binary floating point, where the
canonical accounting boundary requires 2-dp decimal strings
(`src/lib/accounting/decimal.ts`).

**Failure scenario**
`curl -X POST /api/accounts/{id}/transactions -d '{"type":"deposit","amount":5000}'`
returns 201 and adds 5,000 to the legacy balance. The dashboard NAV (ledger-derived)
is unchanged; `computeReconciliation` now reports a permanent 5,000 legacy-vs-accounting
cash gap that no repair script covers.

---

## D8 — MEDIUM: server-side period bucketing uses UTC while the product has a user timezone used only for display

**Files**
- `src/lib/calendar-heatmap.ts:100` (`trade.closedAt.slice(0, 10)`)
- `src/app/api/reviews/weekly/route.ts:59-70` (`setUTCHours` / `getUTCDate` window vs `trades.closedAt`)
- `src/lib/period-matrix.ts:157,172,188` (mixes local `getDay()` / `new Date(str+'T00:00:00')` with `Date.UTC`)
- `src/db/schema.ts:9` (`app_profile.timezone`, default `America/Bogota`)
- `src/lib/timezone-context.tsx:26-107` (client-only consumer)

**Description**
`closedAt` is stored as a full UTC ISO timestamp. Every server-side aggregation
derives its day/week bucket from UTC — `calendar-heatmap` by slicing the first
10 characters, the weekly-review route by building the window with
`setUTCHours`/`getUTCDate`. The configured `app_profile.timezone` is read only
by `TimezoneProvider`, which formats timestamps in the browser. So the date a
trader sees on a trade and the bucket that trade is counted in are computed in
two different time zones.

**Failure scenario (demonstrated)**
Trade closed `2026-03-10T00:30:00.000Z` with the default `America/Bogota` profile:

```
user sees (America/Bogota): 2026-03-09, 7:30 p.m.
calendar-heatmap bucket   : 2026-03-10
```

The trade is displayed as Monday's and counted as Tuesday's. Any close after
19:00 local (UTC-5) shifts a day, which also moves it across a week boundary
when it happens on a Sunday evening — putting realized P&L in the wrong weekly
review. `period-matrix.ts` compounds this by mixing conventions inside one
module: `:172` builds keys with `Date.UTC` while `:157` uses local `getDay()`
and `:188` parses `YYYY-MM-DD` as local midnight.

---
## D9 — LOW: reconciliation failure is swallowed and renders as a healthy account

**File** `src/app/api/accounts/[id]/overview/route.ts:124-139`

**Description**
```ts
try {
  const report = computeReconciliation(sqlite, accountId);
  ...
} catch {
  // Reconciliation fetch is best-effort for the overview
}
```
The catch is empty and the file contains **zero** logging calls. A throw inside
`computeReconciliation` leaves `reconciliation = null`, which is the same value
the route returns when there is nothing to reconcile — so a crashing integrity
check is indistinguishable from a clean account, both in the response and in
the logs.

This pattern (`} catch {` with a comment and no logging) appears in 10 API route
files, including `financial-events`, `financial-events/.../correct`,
`executions`, `executions/.../correct`, `ledger`, `migration`, `valuations`,
and `initialize`.

**Failure scenario**
If any query inside `computeReconciliation` throws (schema drift, a null
instrument), the account overview shows no reconciliation banner at all —
identical to a clean account — and nothing is written to the log to say the
check never ran.

Scope note: this is the overview route only. The workstation alert strip
(`data-quality-alert-strip.tsx:124`) is driven by
`journalLinked.provenance.status` from `dashboard-v2.ts`, which does not call
`computeReconciliation`; it is unaffected.

---

## Verified as NOT defects

Checked against current source and deliberately excluded:

- **`src/lib/accounting/decimal.ts`** — exact integer-micros arithmetic,
  canonical 2-dp strings, overflow guards on both `toMicros` and `fromMicros`.
  The `Number(...)` calls throughout `accounting/`, `positions/` and
  `performance/` convert *exact BigInt results* back to number and stay well
  inside 2^53. No float money in the accounting path.
- **`src/lib/accounting/economic-action.ts`** — the resolver itself is correct
  for both directions; the defects above are all callers that bypass it.
- **`src/lib/trade-execution-engine.ts:980-1030`** — the live execution write
  path resolves the concrete economic action and is fail-closed (rethrows on
  posting, FIFO rebuild, and performance rebuild failure).
- **Idempotency coverage** — every cash-mutating route carries an idempotency
  key except `accounts/[id]/transactions` (D7).
- **`src/lib/positions/fifo.ts`** — resolves `add`/`reduce` against position
  direction, so quantities and realized P&L stay correct even when the cash
  side is wrong.

---

## Structural risk (not a numbered defect — no independent failure case)

**Two P&L engines feed one workstation row.** `src/lib/workstation-live-adapter.ts:309-334`
builds the PTD block from both dashboards at once:

```ts
realizedPnl:  String(dashboard.kpis.netPnl),      // V1 — journal path
realizedFees: v2.metrics.realizedFees ?? '0.00',  // V2 — ledger path
```

V1 (`src/lib/dashboard.ts:177`) sums `computeTradeMetrics().realizedPnl.netRealizedPnl`
over journal `trades`/`trade_executions`; V2 (`dashboard-v2.ts:1915`) reads
`account_performance.realized_fees` from the ledger/FIFO projection. Both are
fetched on every refresh (`:160`, `:173`) and rendered together, and nothing
compares them.

Listed separately because it has no failure mode of its own — it is the
amplifier for D1–D3, which corrupt the ledger side while leaving the journal
side intact. Worth a cross-check assertion; not itself a defect. `/api/dashboard`
has no consumer in `src/` besides this adapter and `src/db/benchmark.ts`.
