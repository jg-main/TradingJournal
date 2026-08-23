# Accounting Domain Audit Matrix — M006-t7xrwf / S01

**Status:** Reference document — the binding source of truth for slices S02–S07 of
milestone M006 (Account Workflow and Ledger Operations).
**Reader:** engineers implementing S02–S07. After reading this document you must be
able to decide, for any account feature you touch, what exists, what to reuse, what
to refine, what is missing, and what is explicitly deferred.
**Verification basis:** every fact below was produced by two automated audit scripts
(`scripts/audit-s01-ui-surface.mjs`, 102 checks / 7 sections, exit 0) and
(`scripts/audit-s01-backend.mjs`, 140 checks / 12 sections, exit 0), plus direct
source inspection and the kernel test suite (28 files / 726 tests, all passing).
Re-run either script any time to re-verify; they are read-only and deterministic.

---

## 1. Method

1. **T01** mapped and verified the account UI surface: pages, workspace shell,
   `AccountProvider`, 13 accounting components, 17 API route handlers under
   `/api/accounts`, page→component→API wiring, and test registration across the
   repo's two runners (`vitest.config.ts` include list and
   `scripts/run-all-tests.ts` TSX_TESTS).
2. **T02** mapped and verified the accounting kernel: 13 schema tables, 12 event
   types, the posting kernel, execution/event posting bridges, correction
   lineage, 6 rebuild paths, ledger/performance/positions projections, the
   legacy-migration runner, 15 DB-level immutability triggers, the accounting
   repository layer, and kernel test registration.
3. **This document** synthesizes both audits into the matrix and the eight
   determinations below. Each determination cites its evidence and the tests that
   ground it.

**Re-verification command:**

```bash
node scripts/audit-s01-ui-surface.mjs   # 102 checks, UI surface
node scripts/audit-s01-backend.mjs      # 140 checks, accounting kernel
npx vitest run src/lib/accounting src/lib/positions src/lib/performance
```

---

## 2. Audit Matrix

**Current product accounting currency: USD only.**
Non-USD account support is deferred until an explicit multi-currency
accounting/FX milestone. `accounts.currency`, `ledger_postings.currency`,
and the posting kernel all operate in USD; account creation/update accept
only USD, and the posting kernel blocks new financially meaningful activity
on legacy non-USD accounts (which remain preserved and historically readable).

Legend: **Current State** = what exists today (verified). **Reuse** = what later
slices should consume as-is. **Refine** = small, safe evolution. **Missing** = gap
that a planned slice must fill (or an explicit decision defers). **Deferred** = out
of scope for M006 unless an approved change rescopes it.

### A1 — Account creation/editing

| Column | Content |
|---|---|
| **Current State** | `accounts` table (id, name, broker, currency default `USD`, isActive default true, maxRiskPerTradePct, defaultCommission, startingBalance, createdAt/updatedAt). `POST /api/accounts` (create), `GET /api/accounts` (list), `GET/PUT/DELETE /api/accounts/[id]`. PUT schema accepts name, broker, currency, isActive, maxRiskPerTradePct, defaultCommission — and **rejects `startingBalance` with `z.never()`** (opening cash is a financial event, never an account property). Add-Account form on the settings/accounts page (name, broker, currency, default USD). Settings tab (account-settings component) edits name, risk %, commission, and drives close/reactivate/delete. |
| **Reuse** | `accounts` schema; POST/PUT routes; existing add form and settings tab as the interaction substrate. |
| **Refine** | S02: polished Add Account dialog (name, broker, base currency, optional “Make this my default account”) that transitions into the new account. S05: identity/broker editing refinement. |
| **Missing** | “Make this my default account” on the create form (default is currently set only via the separate settings-page draft selector). No empty-account initialization state (S02 delivers it). |
| **Deferred** | Multi-currency account setup (see D4). |

### A2 — Default account

| Column | Content |
|---|---|
| **Current State** | `settings.defaultAccountId` (nullable uuid) is the server-side default. Consumption chain verified in three places: trades `POST` (explicit `accountId` → `settings.defaultAccountId` → first active account), dashboard `GET` and dashboard/v2 `resolveAccountId` (settings → first active). UI: the settings/accounts page has a default-account draft selector persisted through `PUT /api/settings`. |
| **Reuse** | The resolution chain in the trades and dashboard routes; the settings-page selector. |
| **Refine** | S02: set default from the create dialog. S05: validate/clear a stale default when the account is deactivated. |
| **Missing** | No clearing or validation when the default account is deactivated — consumers silently fall back to the first active account while `settings.defaultAccountId` stays stale. The client `AccountProvider` selection (`app:account` localStorage) is **independent** of `settings.defaultAccountId` (two sources of truth; see D6). |
| **Deferred** | Per-context defaults (e.g. one default per market segment). |

### A3 — AccountProvider

| Column | Content |
|---|---|
| **Current State** | `AccountProvider` in the account-context module, mounted in both the `(legacy)` and `(trades)` root layouts. Single owner of global account selection (decision M007/D037). Fetches `/api/accounts` once per session mount; resolves selection from localStorage key `app:account` → first **active** account; persists every selection change; `useAccount()` hook for consumers. |
| **Reuse** | The provider, hook, and persistence contract as-is. |
| **Refine** | S02: after account creation, select the new account (the exposed `setAccountId` supports this). |
| **Missing** | Fetch-once-per-mount: no subscription to account creation/deletion within a session; selection never reads `settings.defaultAccountId` (deliberate client/server split, but the coherence rule in D6 must hold). |
| **Deferred** | Multi-account simultaneous selection. |

### A4 — Account workspace

| Column | Content |
|---|---|
| **Current State** | Settings/accounts list page; per-account `[id]/layout.tsx` workspace shell with `AccountDetailHeader` (name, broker, currency, status badge, back link) and `AccountDetailNav` tab navigation. Tab contract (verified by T01): **Overview, Ledger, Positions, Settings** are primary tabs; **Reconciliation is deep-linked only** (not a primary tab). |
| **Reuse** | Layout shell, header, nav, back link, loading/not-found/error states. |
| **Refine** | S07: visual/accessibility polish at 1440/1280/1024, light and dark. |
| **Missing** | Empty-account initialization state (S02: “Add opening balance” / “Start With Zero” paths). |
| **Deferred** | None. |

### A5 — Overview

| Column | Content |
|---|---|
| **Current State** | Overview route plus Overview tab. Account detail `GET` returns authoritative accounting-derived values from the performance projection (`findAccountPerformance`): nav, netCash, markedPositions, realized/unrealized/total P&L, realized fees, gross/net exposure. `kpis` is intentionally `null` — trade-level KPIs (counts, win rate, R-multiples) are not available post-cutover at the position level. |
| **Reuse** | The projection-backed detail response; the Overview tab. |
| **Refine** | S03/S06: immediate account-state refresh after event posting; S06 re-verifies Overview stays consistent with the ledger. |
| **Missing** | None blocking (kpis-null is a documented contract, not a defect). |
| **Deferred** | Trade-level KPI restoration from ledger data. |

### A6 — Ledger

| Column | Content |
|---|---|
| **Current State** | Ledger route backed by `buildLedgerProjection` with correction groups and pagination (default page limit 50, hard cap 200). Immutable ledger triad (`ledger_entries`, `ledger_postings`) with DB-enforced immutability. Ledger-route-helpers module. Rebuild paths: `rebuildAccountActivity`, `rebuildNetPosition`, `checkLedgerBalance`. |
| **Reuse** | The projection builder, pagination contract, correction-group rendering data, and ledger helpers. |
| **Refine** | S04: correction action on eligible events, understandable corrected-state presentation, detailed correction lineage. |
| **Missing** | No correction surface for financial events (only executions can be corrected today — see D3). Pagination cap 200 is a scale boundary; large journals cannot page past it. |
| **Deferred** | Paging past 200 entries / virtualized infinite scroll. |

### A7 — Positions

| Column | Content |
|---|---|
| **Current State** | Positions route backed by `account_positions` projection, `fifo_lots`, `lot_matches`. `allocateFifo`, `actionImpliedDirection`, position rebuilds (`rebuildPositions`, `rebuildPositionsWithinTransaction`), trade-execution sync (`syncTradeExecution`, `syncAndRebuildPositions`), direction/action constants. Unique constraint: one position row per (account, instrument). |
| **Reuse** | The FIFO allocation, position projection, and execution-sync machinery. |
| **Refine** | S06: cross-system consistency verification for corrected/backdated events. |
| **Missing** | None. |
| **Deferred** | None. |

### A8 — Reconciliation

| Column | Content |
|---|---|
| **Current State** | Reconciliation route backed by `computeReconciliation` with match/explained/unexplained classification and `rebuildOpeningCash` input. Freshness policy: default 1440-minute threshold for mark freshness. UI is deep-link only (no primary tab). |
| **Reuse** | `computeReconciliation`, the freshness policy module. |
| **Refine** | S07: surface reconciliation clearly from the ledger (keeps the deep-link contract). |
| **Missing** | No primary-tab entry point (by design today). |
| **Deferred** | Scheduled/automatic reconciliation runs. |

### A9 — Financial-event APIs

| Column | Content |
|---|---|
| **Current State** | 17 route handlers under `/api/accounts`: GET/POST list+create, GET/PUT/DELETE detail, overview, ledger, positions, reconciliation, financial-events, transactions, valuations, executions, execution-correct, checks (+checkId), close, migration, performance, summary. `POST /financial-events` validates via the 9-type discriminated union and posts atomically through the event-posting bridge; `GET /financial-events` lists events with posting status. |
| **Reuse** | All 17 handlers and their Zod contracts; the error-shape conventions (400/404/409/500). |
| **Refine** | S03: the composer drives the existing `POST /financial-events`; S04 adds correction endpoints (see D3). |
| **Missing** | A transfer posting endpoint (transfer is defined-but-unposted — see D7). |
| **Deferred** | None. |

### A10 — Event-posting kernel

| Column | Content |
|---|---|
| **Current State** | `postFinancialEvent`, `postOpeningBalance`, `validatePostingAmount`, `validateNonNegativePostingAmount`. Strict positive-amount rule; relaxed zero-allowance only for `stock_split`; micros safe-integer bounds; pre-transaction idempotency via the event idempotency key unique constraint; account-existence check; atomic `better-sqlite3` transaction; balanced debit/credit pair with stable sequence. Posting currency hardcoded `USD` in `toPostingRecord`. Event-posting bridge (`computePayload`/`computeEffect`/`getPostingAmount`/`postEventWithEffect`); execution-posting bridge with idempotency key `accounting-execution-<id>`. |
| **Reuse** | The whole kernel — no second ledger, no React-local calculation (per AGENTS.md computation-ownership policy). |
| **Refine** | S05: parameterize currency at the posting layer only if an approved currency decision requires it (see D4). |
| **Missing** | Multi-currency posting; transfer posting path. |
| **Deferred** | Multi-currency ledger. |

### A11 — Correction infrastructure

| Column | Content |
|---|---|
| **Current State** | `correctExecution` reversal-and-replacement pattern; `correction_lineage` links original/reversal/replacement; positions + performance rebuilt after correction; guard errors `ExecutionAlreadyCorrectedError`, `ExecutionNotMutableError`, `DuplicateCorrectionIdempotencyError`; reverse-action mapping; correction contracts; `POST /executions/[executionId]/correct` with required correction reason. Immutability is enforced at the DB layer by **15 `RAISE(ABORT)` triggers** across migrations 0024/0025/0026/0027/0028/0029 — not just in service code. |
| **Reuse** | The reversal-and-replacement pattern, lineage table, guard errors, and trigger-enforced immutability. |
| **Refine** | S04: extend the pattern to financial events; required correction reason; corrected-state presentation. |
| **Missing** | Financial-event correction (deposits, withdrawals, fees, taxes, dividends, interest, adjustments cannot be corrected today — only executions). |
| **Deferred** | None. |

### A12 — Rebuild paths

| Column | Content |
|---|---|
| **Current State** | `rebuildOpeningCash` (sum of debit opening-balance postings), `rebuildAccountActivity` (raw event projection), `rebuildNetPosition` (debit − credit), `checkLedgerBalance` (global debit == credit), `rebuildPositions`/`rebuildPositionsWithinTransaction`, `rebuildAccountPerformance` (NAV / TWR / HWM / drawdown). CLI `scripts/accounting-migrate.ts` (`migrate|reconcile|cutover-check|rebuild`) with exit-code contract 0/1/2. Migration route wiring. |
| **Reuse** | All six rebuild functions and the CLI. |
| **Refine** | S06: run rebuilds as the verification vehicle for backdated/corrected events. |
| **Missing** | No scheduled/periodic maintenance rebuild (manual only). |
| **Deferred** | Periodic automatic rebuild. |

### A13 — Event-type schemas

| Column | Content |
|---|---|
| **Current State** | `EVENT_TYPES` = 12; `CASH_EVENT_TYPES` = 8; `CORPORATE_ACTION_EVENT_TYPES` = `[stock_split]`; effect union = cash/none/market. Manual-entry API union exposes **exactly 9 types**: opening_balance, deposit, withdrawal, dividend, interest, fee, tax, stock_split, manual_adjustment. `trade_execution` is internal-only (execution-posting, correction reversal/replacement, legacy-migration runner). `transfer` and plain `adjustment` are defined in `EVENT_TYPES`/schema enum but have **no posting path** (see D7). |
| **Reuse** | The 9-type union as the canonical manual-entry contract. |
| **Refine** | S03: the event-type selector derives from this union. |
| **Missing** | Transfer posting; a public plain-adjustment posting name (API uses `manual_adjustment`). |
| **Deferred** | New corporate-action types (see D8). |

### A14 — Currency behavior

| Column | Content |
|---|---|
| **Current State** | **USD-only account currency contract (enforced, A1).** `accounts.currency` defaults `USD`; `ledger_postings.currency` is `USD` NOT NULL; posting kernel hardcodes `'USD'` in `toPostingRecord`. The shared contract lives in `src/lib/accounting/currency-contract.ts` (`SUPPORTED_ACCOUNT_CURRENCIES = ['USD']`, `DEFAULT_ACCOUNT_CURRENCY = 'USD'`, `accountCurrencySchema`). Account creation (`POST /api/accounts`) and update (`PUT /api/accounts/[id]`) validate currency through `accountCurrencySchema` (literal USD, default USD); non-USD → 400 Validation failed, never silently coerced. The posting kernel enforces the boundary centrally via `assertSupportedAccountCurrency` in `postFinancialEvent`/`postOpeningBalance` (called before any ledger mutation, so rejection leaves zero partial rows), and the execution path enforces it in `postExecutionFill` and `syncTradeExecution` before any execution-row/instrument/ledger write. Financial-event and execution API routes map `UnsupportedAccountCurrencyError` to a clear 400. Legacy non-USD accounts are preserved as-is and remain historically readable; they block ALL new financially meaningful activity (opening balance, events, executions) and are never auto-selected as the effective account by the trade-creation or dashboard-v2 resolution chains. |
| **Reuse** | USD-only kernel as-is; the centralized contract is the single source consumed by UI and API. |
| **Refine** | S05+ guardrails: currency mutation to a non-USD value is rejected even without financial history; legacy non-USD rows are never rewritten. |
| **Missing** | Multi-currency posting (explicitly deferred). |
| **Deferred** | Multi-currency accounting / FX (requires an approved domain change and an explicit milestone). |

### A15 — Deactivation

| Column | Content |
|---|---|
| **Current State** | Soft deactivation via `isActive=false`; hard delete is guarded. **Two deactivation paths:** (a) `POST /api/accounts/[id]/close` computes a closure summary (KPIs; ledger-derived realized P&L/NAV when available) then deactivates — **no open-trade guard**; (b) `PUT /api/accounts/[id] {isActive:false}` is guarded by `canDeactivateAccount` (409 “Cannot deactivate account with open trades”). Reactivation via PUT guarded by `canReactivateAccount` (no open trades). DELETE guarded by `canDeleteAccount` (409 if any trade history). Lifecycle helpers in the account-lifecycle module (`classifyAccountLifecycle`). UI: close/reactivate/delete dialogs in the account-settings component. |
| **Reuse** | Lifecycle library, both deactivation paths, and the dialogs. |
| **Refine** | S05: guardrails around accounts containing financial history; S06: safe handling of an inactive default account. |
| **Missing** | Open-trade guard on the close route (divergence from the PUT path); clearing/validating `settings.defaultAccountId` on deactivation. |
| **Deferred** | None. |

### A16 — Account initialization lifecycle (opening balance completes initialization)

| Column | Content |
|---|---|
| **Current State** | **Initialization is one authoritative server-side transaction (enforced, A2).** `POST /api/accounts/[id]/initialize` completes new-account initialization with `mode: 'opening_balance'` (posts the immutable `opening_balance` financial event + ledger entry + balanced postings AND activates the account inside a single SQLite transaction) or `mode: 'zero'` (activation only, no fabricated event). The service lives in `src/lib/accounting/account-initialization.ts` (`initializeAccount` + `assertPristineDraft`); the posting reuses the canonical posting kernel with the same payload/effect the generic event route produces, so ledger/activity cash-impact projections are identical. Eligibility is restricted to pristine drafts (inactive, no financial events, no executions, no positions, no trades) — a second initialization returns 409 `Account already initialized`, and deactivated historical accounts are never accidentally reactivated through this path (the established lifecycle PUT reactivation remains the sanctioned path). The generic `POST /api/accounts/[id]/financial-events` route rejects `eventType: 'opening_balance'` with 409 so the UI cannot bypass initialization semantics. Idempotency keys are honored (replays never duplicate state; a failed attempt does not consume the key). After commit, the route rebuilds the account performance projection so NAV/Cash are immediately coherent. |
| **Reuse** | Posting kernel, `assertSupportedAccountCurrency` (A1), `rebuildAccountPerformance`, idempotency convention, financial-event schema primitives. |
| **Refine** | None needed for this lifecycle boundary; keep both initialization modes behind the initialize endpoint. |
| **Missing** | Correction support for an incorrectly-entered opening balance (the reversal → replacement workflow exists for correctable event types; opening_balance is intentionally excluded from `CORRECTABLE_EVENT_TYPES` today — see D4/A11). When that is extended, corrections must not deactivate or reinitialize the account. |
| **Deferred** | Multi-currency initialization (with FX milestone). |

### A17 — Canonical account closure (A3)

| Column | Content |
|---|---|
| **Current State** | **Close uses only canonical sources (enforced, A3).** `POST /api/accounts/[id]/close` derives opening capital, deposits, withdrawals, and activity dates from `financial_events` + canonical effects (`computeAccountActivity` + `deriveAccountClosureCapital` in `src/lib/accounting/account-closure.ts`), and final balance / realized P&L from a FRESH required `account_performance` rebuild (`computeAccountClosureFinancials` enforces `success === true`; failure → 500 with the account still active and retryable). Deposit/withdrawal totals are correction-aware by construction (effect-direction netting in integer micros: reversal/replacement events net out, dividends/interest/fees/taxes/trades are never classified as deposits). `netReturn = realizedPnl / (effectiveOpeningBalance + effectiveDeposits) * 100` (simple realized return on contributed capital; null when the denominator ≤ 0). `datesActive.from` = earliest of account createdAt and canonical event timestamps; `to` = the single captured `closedAt`. Legacy inputs (`accounts.startingBalance`, `accountTransactions`, `computeAccountBalance`, `computeDatesActive`) are NOT used; contradictory legacy rows have zero influence. Open-trade guard (409) and default-account clearing (D6) are preserved. The response keeps the compatible shape (`startingBalance` retained and now meaning the effective canonical opening balance; `openingBalance` added for clarity). |
| **Reuse** | `computeAccountActivity`, posting-kernel effect metadata, `rebuildAccountPerformance`, `findAccountPerformance`, canonical decimal/micros helpers, `computeAccountKPIs`. |
| **Refine** | None needed. |
| **Missing** | None for the closure path. |
| **Deferred** | Legacy `account_transactions` schema retirement (separate concern; current closure does not depend on it). |

---

## 3. Explicit Determinations

Each determination is binding for S02–S07 unless an approved task explicitly
changes it. All were recorded as GSD decisions for traceability.

### D1 — Manual-entry-safe events

**Determination:** Exactly **9 event types are safe for manual entry** through
`POST /api/accounts/:id/financial-events`: `opening_balance`, `deposit`,
`withdrawal`, `dividend`, `interest`, `fee`, `tax`, `stock_split`,
`manual_adjustment`. This is enforced by the `postFinancialEventSchema`
discriminated union. `trade_execution` is **internal-only** — it must never be
manually posted; it is created by execution-posting, correction
reversal/replacement, and the legacy-migration runner. `transfer` and plain
`adjustment` must **not** be offered for manual entry: transfer has no posting path
and adjustment's public name is `manual_adjustment`.

- **Evidence:** `src/lib/accounting/api-contracts.ts` (9-member union,
  per-type payload schemas); `src/lib/accounting/posting.ts`; event-posting and
  execution-posting bridges; `src/app/api/accounts/[id]/financial-events/route.ts`.
- **Test coverage:** `src/lib/accounting/posting.test.ts`,
  `src/lib/accounting/__tests__/financial-event-contracts.test.ts`,
  `src/lib/accounting/__tests__/financial-event-posting.test.ts`,
  `src/lib/accounting/__tests__/financial-events-integration.test.ts`,
  financial-events route `__tests__`.
- **Consumed by:** S03 composer event-type selector (9 entries, no more).

### D2 — Opening-balance rules

**Determination:** Opening balance is a **financial event**, never an editable
account property. The account PUT schema rejects `startingBalance`
(`z.never()`), and the account form does not expose it. The opening-balance event
requires a **positive** canonical decimal amount (schema refines out negative
values; kernel enforces positive amounts, with zero allowed only for
`stock_split`). Opening cash is rebuilt by summing **debit** opening-balance
postings (`rebuildOpeningCash`). The trades route requires an
`opening_balance` or `deposit` event before trading is allowed (409 “Account
setup incomplete” otherwise).

**Updated by A2:** the opening balance is recorded **only** through account
initialization (`POST /api/accounts/[id]/initialize`, mode `opening_balance`),
which posts the event AND activates the account in one transaction. The generic
financial-event route rejects `opening_balance` with 409. A successful
initialization ends in exactly one of: (a) active account with exactly one
`opening_balance` event; (b) active account with zero events (`mode: 'zero'`).
There is no successful path ending in financial history + draft.
**Updated by A4:** an incorrect opening balance may be corrected only through
the immutable reversal + replacement flow (`POST
/api/accounts/[id]/financial-events/:eventId/correct`), which is the ONLY
post-initialization opening-balance mutation path. The original event remains
unchanged; a reversal (opposite cash-effect direction) and a replacement
(positive amount, `effect.direction = increase`) are posted and linked through
`financial_event_correction_lineage`. Correction does not reinitialize,
deactivate, reactivate, or touch `accounts.startingBalance` — the account stays
active. Replacement opening balances must be POSITIVE (0 / negative rejected).
`rebuildOpeningCash` is correction-aware: current canonical opening-balance
events net through their recorded cash-effect direction (increase
`+amountMicros`, reversal `-amountMicros`), with a debit-posting fallback
(positive) for legacy rows lacking effect metadata — a $10,000 opening
corrected to $9,000 nets to $9,000 (not the naive $29,000 debit sum). Legacy
opening-balance events without effect metadata remain readable via the
fallback but cannot be corrected (no economic effect to reverse — clear domain
error, documented legacy limitation).

- **Evidence:** `src/lib/accounting/account-initialization.ts`
  (`initializeAccount`, `assertPristineDraft`),
  `src/app/api/accounts/[id]/initialize/route.ts`,
  `src/app/api/accounts/[id]/financial-events/route.ts` (409 guard),
  `src/lib/accounting/api-contracts.ts` (openingBalanceSchema,
  initializeAccountRequestSchema), `src/app/api/accounts/[id]/route.ts`
  (updateAccountSchema), `src/app/api/trades/route.ts` (`has_cash` check),
  `src/lib/accounting/rebuild.ts` (`rebuildOpeningCash`).
- **Test coverage:** `src/lib/accounting/__tests__/account-initialization.test.ts`,
  `src/app/api/accounts/[id]/initialize/__tests__/route.test.ts`,
  `src/lib/accounting/rebuild.test.ts`,
  `src/lib/accounting/__tests__/opening-balance-flow.test.ts`,
  `src/lib/accounting/posting.test.ts`.
- **Consumed by:** S02 (Add opening balance path), S03 (Opening Balance entry
  where domain rules permit).

### D3 — Correction capabilities

**Determination:** Correction today exists **only for trade executions**:
reversal-and-replacement, `correction_lineage` linking
original/reversal/replacement, positions + performance rebuild, guard errors for
already-corrected / not-mutable / duplicate-idempotency, and a **required
correction reason**. Financial events (deposits, withdrawals, fees, taxes,
dividends, interest, manual adjustments) have **no correction path** today — no
endpoint, no reversal service. Ledger immutability is enforced at the DB layer by
**15 `RAISE(ABORT)` triggers** (migrations 0024–0029), so correction can only
ever be append-style reversal + replacement, never in-place mutation. S04 extends
the execution pattern to eligible financial events.

- **Evidence:** `src/lib/accounting/correction.ts`,
  `src/lib/accounting/correction-contracts.ts`,
  `src/app/api/accounts/[id]/executions/[executionId]/correct/route.ts`,
  schema migrations 0024/0025/0026/0027/0028/0029.
- **Test coverage:** `src/lib/accounting/correction.test.ts`,
  `src/lib/accounting/__tests__/accounting-integration.test.ts`,
  correct-route `__tests__`.
- **Consumed by:** S04.

### D4 — Currency mutation rules

**Determination (updated by A1):** The product contract is **USD-only** for
accounts. The ledger is USD-only at the posting layer: the posting kernel
hardcodes `'USD'` in `toPostingRecord`, `ledger_postings.currency` is `USD`
NOT NULL, and no multi-currency logic exists in the accounting libs. The
account-level `currency` field is enforced through the centralized
`accountCurrencySchema` (`z.literal('USD').default('USD')`): account creation
and update accept only USD (non-USD → 400 Validation failed, never silently
coerced), and the posting kernel blocks all new financially meaningful
activity on legacy non-USD accounts via `assertSupportedAccountCurrency`.
**Rules:** (a) any account with ledger/financial history (financial events,
executions, positions, performance) cannot change base currency; (b) even a
brand-new account cannot be created or mutated to a non-USD currency — the
USD-only contract is unconditional; (c) legacy non-USD accounts are preserved
as-is and remain historically readable, but block new activity and are never
auto-selected as the effective account by consumer fallback chains; (d)
multi-currency posting / FX remains out of scope until an approved domain
change.

- **Evidence:** `src/lib/accounting/currency-contract.ts` (centralized
  contract), `src/lib/accounting/posting.ts` (`toPostingRecord`,
  `assertSupportedAccountCurrency`), `src/lib/accounting/execution-posting.ts`
  and `src/lib/positions/trade-execution-sync.ts` (execution guard),
  `src/db/schema.ts` (`ledger_postings.currency`),
  `src/app/api/accounts/route.ts` and `src/app/api/accounts/[id]/route.ts`
  (accountCurrencySchema in create/update).
- **Test coverage:** `src/lib/accounting/__tests__/usd-currency-contract.test.ts`
  (posting kernel + execution path + atomicity),
  `src/app/api/accounts/__tests__/route.test.ts` (create USD-only),
  `src/app/api/accounts/[id]/__tests__/route.test.ts` and
  `route.defaults.test.ts` (update USD-only),
  `src/app/api/accounts/[id]/financial-events/__tests__/route.test.ts` and
  `executions/__tests__/route.test.ts` (legacy non-USD rejection), plus
  `e2e/usd-currency-contract.spec.ts` (browser verification).
- **Consumed by:** S02 (base currency at creation), S05 (mutation guard), A1
  (USD-only enforcement).

### D5 — Deactivation rules

**Determination:** Deactivation is a **soft state transition** (`isActive=false`);
financial history is never deleted. Two verified paths: `POST /close` (closure
summary + deactivate, **no open-trade guard**) and
`PUT {isActive:false}` (guarded — 409 if open trades exist). Reactivation requires
no open trades. DELETE is a hard delete allowed **only when the account has no
trade history at all** (409 otherwise). Inactive accounts are excluded from
default selection: the trades/dashboard resolution chain and the AccountProvider
both fall back to the **first active** account. **Refinement for S05:** align the
close route with the open-trade guard, and handle the stale
`settings.defaultAccountId` on deactivation (see D6).

- **Evidence:** `src/lib/account-lifecycle.ts` (`canDeactivateAccount`,
  `canReactivateAccount`, `canDeleteAccount`),
  `src/app/api/accounts/[id]/close/route.ts`,
  `src/app/api/accounts/[id]/route.ts` (PUT/DELETE),
  account-settings component (close/reactivate/delete dialogs).
- **Test coverage:** close-route `__tests__` (58 assertions),
  `src/lib/accounting/legacy-migration.test.ts` and account-lifecycle coverage
  exercised via the route tests; T01 audit Tests section.
- **Consumed by:** S05, S06.

### D6 — Default-account propagation

**Determination:** There are **two independent default mechanisms**, and both must
stay coherent. (1) **Server:** `settings.defaultAccountId` drives the trades and
dashboard resolution chain (explicit `accountId` → settings default → first
active). (2) **Client:** `AccountProvider` persists a session selection in
localStorage `app:account` (persisted value → first active). They are **not
synchronized** by design, and deactivating the default account leaves
`settings.defaultAccountId` stale — consumers fall back silently. **Rules:**
S02 adds “Make this my default account” at creation and writes the settings row;
S05 must clear or validate the default when the account is deactivated; the
client selection and server default may differ per session but must never resolve
to an inactive account; the trades/dashboard fallback chain (explicit → default →
first active) is the canonical server-side contract and must not regress.

- **Evidence:** `src/app/api/settings/route.ts` (PUT schema),
  `src/app/api/trades/route.ts` (resolution),
  `src/app/api/dashboard/v2/route.ts` (`resolveAccountId`),
  `src/lib/account-context.tsx` (localStorage `app:account`, first-active
  fallback).
- **Test coverage:** settings-route `__tests__`, dashboard-route `__tests__`,
  trades-route `__tests__`, T01 audit AccountProvider section.
- **Consumed by:** S02, S05, S06.

### D7 — Transfer completeness

**Determination:** `transfer` is **MISSING from the pipeline** — a verified gap.
It is defined in `EVENT_TYPES` and the schema enum, but has no posting path:
absent from the 9-type manual API union, no kernel function, no route. Plain
`adjustment` is in the same state (the public name is `manual_adjustment`).
**Rules:** the S03 composer must **not** offer transfer; no M006 slice is
required to implement it. If a future approved change adds it, the shape is
prescribed by the existing kernel: one atomic balanced transaction posting a
debit to the source account and a credit to the target account, with its own
idempotency key, mirrored on the immutable ledger triad. Until then it is
recorded as **deferred**, not silently repurposed.

- **Evidence:** audit `scripts/audit-s01-backend.mjs` facts
  (`eventTypes.internalOnly.transfer`), `src/lib/accounting/api-contracts.ts`
  (union membership), `src/lib/accounting/posting.ts` (no transfer path),
  `src/db/schema.ts` (event-type enum includes `transfer`).
- **Test coverage:** the audit's EventTypes section asserts the union has exactly
  9 members and that transfer/adjustment have no posting export; negative
  evidence: `postFinancialEventSchema` rejects `transfer` payloads.
- **Consumed by:** S03 (exclusion), roadmap reassessment if scope changes.

### D8 — Corporate-action scope

**Determination:** For M006, corporate-action scope = **`stock_split` only**.
`CORPORATE_ACTION_EVENT_TYPES` is exactly `[stock_split]`; stock splits carry an
`oldShares`/`newShares` payload, a relaxed zero-allowance amount rule, a
market-effect classification, and a FIFO position rebuild. Dividends are **cash
events**, not corporate actions in the current taxonomy. **Rules:** S02–S07 do
not add new corporate-action types (splits other than stock splits, mergers,
spin-offs); the schema's effect union (cash/none/market) and the payload pattern
are the designated extension point for a future domain change.

- **Evidence:** `src/lib/accounting/api-contracts.ts`
  (`CORPORATE_ACTION_EVENT_TYPES`, effect union, stock_split schema),
  `src/lib/accounting/posting.ts` (zero-allowance path),
  `src/db/schema.ts` (event-type enum, effect columns).
- **Test coverage:** `src/lib/accounting/posting.test.ts` (stock_split cases),
  `src/lib/accounting/__tests__/financial-event-contracts.test.ts`.
- **Consumed by:** S03 (composer stock_split entry), S06 (consistency).

---

## 4. Consolidated Gap Register (what M006 must build vs. what is deferred)

| Gap | Where it lands | Determination |
|---|---|---|
| Add Account dialog with default-account option + empty-account init (Add opening balance / Start With Zero) | S02 | D2, D6 |
| Financial Transaction Composer (9-type selector, dynamic forms, effect preview) | S03 | D1, D7, D8 |
| Financial-event correction (reversal + replacement + required reason + lineage) | S04 | D3 |
| Currency-mutation guard on accounts with ledger history | S05 | D4 |
| Close-route open-trade guard alignment; stale-default clearing on deactivation | S05 | D5, D6 |
| Cross-system consistency verification (cash/NAV/P&L/ledger/projections/default/trades/backdating) | S06 | D1–D8 |
| Workflow UX refinement + full user-journey UAT at 1440/1280/1024 | S07 | all |
| **Deferred:** transfer posting, multi-currency ledger, plain `adjustment` alias, paging past 200 ledger rows, periodic rebuilds, new corporate-action types | out of scope | D7, D4, D1, A6, A12, D8 |

---

## 5. Invariants That Must Never Regress (verified facts with guardrails)

1. **No second ledger / no React-local calculations.** All accounting math lives in
   the pure libraries under the accounting domain; UI and API routes delegate.
2. **Ledger immutability is DB-enforced** (15 triggers) — corrections are always
   append-style reversal + replacement.
3. **Opening balance is a financial event**, not an account field.
4. **`trade_execution` is internal-only**; `transfer` is defined-but-unposted.
5. **Posting currency is USD** at the ledger layer; account-currency mutation is
   rejected (USD-only contract, A1) — non-USD accounts are preserved and
   readable but block all new financially meaningful activity.
6. **Server default chain** (explicit → `settings.defaultAccountId` → first
   active) and **client selection** (`app:account` → first active) must never
   resolve to an inactive account.
7. **Deactivation is soft; delete requires zero trade history.**
8. **Idempotency keys** are required for every posting path (event key,
   `accounting-execution-<id>`, correction idempotency) — duplicate posting
   returns 409, never a double entry.
