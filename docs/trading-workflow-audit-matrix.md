# Trading Workflow Audit Matrix (M002/S01)

Binding contract for slices S02–S09. Produced by M002-S01-T01..T07 from
`docs/requirements/Trading Workflow.md` §120 against base commit `44eb4f6`.

## Classification scheme

| Class | Meaning |
|---|---|
| **Current** | Already satisfies the requirement; reuse as-is. |
| **Reuse** | Sound foundation; reuse with no or trivial changes. |
| **Refine** | Exists but needs behavioral/conceptual correction to meet the contract. |
| **Replace** | Exists but violates the contract's core invariant; must be rebuilt. |
| **Missing** | Does not exist; must be created. |
| **Deferred** | Explicitly out of scope for M002. |

---

## 1. Duplicated / non-atomic execution paths (binding findings)

The requirements doc's core defect (§4, §7, §46–47) is confirmed verbatim in the
code. There are **four** posting surfaces (T02: audited and named), **two** trade-side
execution engines with divergent logic (P1/P2), one best-effort mirror (P3), and
one canonical economic posting path that the trade routes do **not** use (P5),
built on the M006 kernel (P4):

| # | Path | Lines | Nature | Verdict |
|---|---|---|---|---|
| P1 | `POST /api/trades/[id]/execute` (`src/app/api/trades/[id]/execute/route.ts`) | 558 | Bulk entry + exit1 + exit2 in one request (§9 anti-pattern). Inserts journal executions in its own transaction, then calls `syncAndRebuildPositions` inside `try { … } catch (_syncErr) {}` at L546 — **non-fatal: the request returns 201 even when accounting/FIFO sync fails** (§7/§46 anti-pattern). No journal-side idempotency key. Computes risk snapshot with **legacy** `computeEquityAtOpen(startingBalance, accountTransactions)` (§14/§110 violation). **Checklist gate: enforces ALL merged account+setup items (400 on missing or not-passed) — a hard gate with no required/optional distinction (schema has no `required` flag).** | **Replace** |
| P2 | `POST /api/trades/[id]/executions` (`src/app/api/trades/[id]/executions/route.ts`) | 353 | Individual fill (preferred §9 shape). Action-direction validation, canonical `computeTradeMetrics` status derivation, risk snapshot on first entry, **but** the same non-fatal sync catch at L335 (201 on sync failure), **legacy** equity-at-open, and **no journal-side over-close/quantity guard** (§26 not enforced on the journal path — an over-close leaves a committed journal execution while accounting rejects). No idempotency key on the journal side. **No checklist handling at all** (does not import checklist tables). | **Replace** |
| P3 | `src/lib/positions/trade-execution-sync.ts` (`syncAndRebuildPositions`) | 264 | Best-effort mirror: `trade_executions` → `accounting_executions` (idempotency-protected) → FIFO rebuild → performance rebuild → financial event. **Non-fatal by design**: "sync failures do NOT throw … so the caller can continue without rolling back the trade execution itself" (catch at L249) — exactly the doc's "catch → log → return { error } → user still gets 201" defect. | **Replace** (retire from normal workflow; fold into the canonical service) |
| P4 | M006 kernel: `postFinancialEvent` (`src/lib/accounting/posting.ts` L268) is the low-level **atomic** kernel (event + ledger_entry + balanced postings in one transaction); `src/lib/accounting/event-posting.ts` (`postEventWithEffect`) is the service-level entry adding the account-projection rebuild. | 243 (+kernel) | The canonical atomic posting foundation (A7) with typed failure. **Used by the account-scoped path (P5) via `postExecutionFill`, never by P1/P2/P3 trade paths.** | **Reuse** — S03's canonical execution engine must build on this kernel. |
| P5 | `POST /api/accounts/[id]/executions` (`src/app/api/accounts/[id]/executions/route.ts`) → `src/lib/accounting/execution-posting.ts` (`postExecutionFill`) | 515 (+314) | Canonical **economic** posting path. Pre-flight before any write: account exists (404), A6 active guard (409), idempotency key (409), **speculative FIFO allocation → 422 on over-close/flip**. Then `postExecutionFill` atomically: activity + USD-currency guard → instrument resolve → idempotency check → one transaction (insert `accounting_executions` + kernel ledger effects) → route rebuilds positions + account performance. Optional `journalTradeId` attribution only — **never touches `trade_executions`, `trades.status`/`openedAt`/`closedAt`, or journal risk snapshots.** | **Reuse** — the canonical execution service (S03) must route trade fills here (with journal linkage), not through P3. |

**Consequence:** journal executions commit independently of accounting/FIFO state.
The doc's central invariant ("must never disagree after a successful operation")
is violated by design today — and the two trade engines disagree with **each other**
(see §1a), while the only atomic economic path (P5) is unaware of the journal.

### 1a. Divergence ledger: P1 vs P2 (binding findings)

Both trade endpoints derive status from the canonical `computeTradeMetrics` and
share the same legacy equity-at-open computation and non-fatal sync pattern, but
diverge on every other dimension:

| Dimension | P1 `/execute` (bulk) | P2 `/executions` (single fill) | Divergence consequence |
|---|---|---|---|
| Fill shape | entry + exit1 + exit2, one request, one shared `executedAt` timestamp | one fill per request | Same-fill entry+exit is impossible via P2 (separate timestamps); P1 forces the anti-pattern of opening and closing in one POST (§9) |
| Status guard | **Requires `trade.status === 'planned'`** (400 otherwise) | Rejects only `deleted`; open **and closed** trades accept fills (a closed trade can be re-opened by a new fill; an open trade can be over-filled) | P2 has no lifecycle gate — fills after close silently re-open the trade; P1 cannot express management fills at all |
| Over-close / quantity guard | Only `exitQty1 + exitQty2 ≤ entryQuantity` in the **same request** (409); no check against the open position | **None** | Neither enforces §26 against committed position state — an over-close commits to the journal while P5's FIFO pre-flight rejects it (422) |
| Action handling | Action derived from `trade.direction` (entry=buy/sell_short, exit=sell/buy_to_cover) | Client-supplied `action` enum validated against the same direction map | Same map duplicated; P1 cannot express `add`/`reduce` management fills (they are rejected because status ≠ planned) |
| Checklist gate (§20) | **Enforces ALL** merged account+setup items before any mutation: missing → 400, not passed → 400 | **No checklist handling at all** | P2 bypasses the gate entirely — a trader can open via P2 without any checklist evidence; P1 over-enforces (treats every item as required; schema has no `required`/optional flag) |
| Risk snapshot stop source | `stopPrice ?? trade.plannedStop` (request can override planned stop) | `trade.plannedStop` only (no request stop) | The **same trade** can get a different `initialStopPrice`/`initialRiskAmount`/`accountRiskPct` depending on which endpoint created the first-entry snapshot — snapshot divergence by route, not by trade intent |
| Fees | Applied to entry only; exits hardcoded `fees: 0` | Per-fill fees | Same trade posted through P1 vs P2 accrues different fee totals → different realized P&L |
| Notes / reason | None | `reasonId` + `notes` accepted | P1 drops management rationale entirely |
| Atomicity | One `db.transaction` covering journal inserts + status update + snapshot + check results | Separate auto-commit statements (insert → reload → status update → snapshot upsert → sync) | P1 journal-side is atomic; P2 can leave partial state (execution committed, status/stale snapshot) on mid-flight failure |
| Idempotency | None journal-side | None journal-side | A retried POST duplicates the journal row; only P3's derived `trade-execution-{id}` key protects the accounting side (§10) |
| Sync invocation | Loops `syncAndRebuildPositions` per created execution, non-fatal catch L546 | Single call, non-fatal catch L335 | Both return 201 when accounting/FIFO/performance rebuild fails |
| Equity-at-open | Legacy: `accounts.startingBalance` + `accountTransactions` + prior closed trades | Same legacy inputs | Both violate §14/§110 (see §2 legacy equity rows) |

**Non-atomicity summary (T02):** every trade-side write path (P1, P2, P3) commits
journal state before accounting accepts it, and P3 swallows failures by design
(catch L249, "sync failures do NOT throw"). The only atomic path (P5) is not
journal-aware. There is no single all-or-nothing execution transaction anywhere
on the trade side — this is the #1 defect S03 must retire.

---

## 2. Concern-by-concern matrix

| Concern (doc §120) | Current behavior | Class | Notes / binding direction |
|---|---|---|---|
| Trade creation | `POST /api/trades` — validates planned-stop geometry via canonical `computePlannedRiskAmount` (R025, only when both entry+stop supplied; partial combos skip); account resolution via A8 eligible-default chain → first **trading-ready** active USD account (effective risk params + effective commission + opening cash, each account override → global default → unavailable per M002-A1) → first active USD fallback; 409 readiness guard; `tradeCode` `T-XXXX` generated with 3-attempt UNIQUE retry; **status hardcoded `'planned'`** at insert (no client-supplied status; schema has no DB default). | **Refine** | Planning eligibility (§11) should be lighter (exists/active/USD); the ready-account fallback conflates planning with execution readiness. Keep the canonical stop-geometry validation. M002-A1: execution readiness resolves effective risk/commission through account override → global default → unavailable; account-level null does not by itself mean not trading-ready. |
| Trade update / status mutation | `PUT /api/trades/[id]` — **no `status` field in the update schema, so PUT cannot mutate status (good)**. Direct vs derived split: the **only direct `trades.status` write in `src/`** is the scratch `DELETE` (`status='deleted'`, planned-only); every open/closed transition is **derived** — both execution routes reload the execution stream and write `metrics.position.status`/`openedAt`/`closedAt` from canonical `computeTradeMetrics`. **M002-A4 final invariant: the COMPLETE pre-trade context (geometry + classification + thesis + invalidationCondition + preTradePlan — one canonical `PRE_TRADE_CONTEXT_FIELDS` list) is editable ONLY before the first accepted execution.** The freeze is keyed on execution history (`hasTradeExecutionHistory`: `trade_executions` row or `accounting_executions.journal_trade_id` — never derived status, so a correction-reopened or legacy-inconsistent-status trade stays frozen), the whole request is rejected atomically with `PRE_TRADE_CONTEXT_FROZEN` + the offending field list, and the GET response exposes `preTradeFrozen` so clients render the context read-only (EditTradeDialog omits all pre-trade fields for executed trades). Post-entry changes are recorded through management/review evidence (executions, stop/target adjustments, exit notes, lesson, review, mistakes, grade) rather than rewriting the plan. | **Current** (A4) | §23 contract: complete pre-trade intent frozen once an effective execution exists; the sole direct status write (scratch) stays as-is. |
| Scratch / delete (planned-only soft-delete) | `DELETE /api/trades/[id]` — **soft-delete only; no hard delete exists anywhere**. Guarded to `planned` status (already-scratched → idempotent 400 "Trade is already scratched."; open/closed → 400 naming current status). Writes `status='deleted'` + `updatedAt` stamp (auditable scratch time); row and FK children preserved; `watchlist_items.promotedTradeId` intentionally **not** nullified so the promotion audit trail survives the scratch (D057/R027). List GET excludes deleted unless `?status=deleted` (Deleted tab). | **Current** | Matches R027/D057; keep as-is. |
| Bulk execute | P1 (`/execute`). | **Replace** | Retire from normal UX (§9). May remain as a compatibility adapter only if it delegates to the canonical service (S03). |
| Individual executions | P2 (`/executions`). | **Replace** | Becomes the single execution route over the canonical service (S03). |
| Risk snapshot creation | First-entry upsert inside both execution routes (T03-verified): guarded by `if (!existingSnapshot)` + schema **UNIQUE on `trade_risk_snapshots.trade_id`** (one row per trade) → **deterministic on first entry, preserved through management** (later fills never rewrite). First-entry fields: `initialEntryPrice = avgEntryPrice`, `initialQuantity`, `initialStopPrice` (P1: `stopPrice ?? trade.plannedStop` — request can override; P2: `plannedStop` only → route-divergent snapshot, §1a), `accountEquityAtOpen` from **legacy** `computeEquityAtOpen` (§2b L2), derived `riskPerShare`/`initialRiskAmount`/`accountRiskPct` via canonical `computeRiskSnapshotValues`. | **Replace/Refine** | §16: initial snapshot must be created deterministically by the canonical first-entry path and never rewritten by management. The manual PUT surface must go (or be restricted to correction-driven rebuild). |
| Manual risk-snapshot PUT surface | ~~`PUT /api/trades/[id]/risk-snapshot`~~ **Retired (M002-A3)**: route now returns **405 `{ error: 'Risk snapshot is immutable', code: 'RISK_SNAPSHOT_IMMUTABLE' }`** with `Allow: GET` — cannot create, edit, patch, or delete. Previous surface accepted **client-supplied** `accountEquityAtOpen`, `initialEntryPrice`, `initialStopPrice`, `initialRiskAmount`, etc. (upsert-or-patch). T03-verified: **no active UI consumer** — `handleRiskSnapshotSave` in `src/app/(legacy)/trades/[id]/page.tsx` was dead code (never threaded to a component; `RiskSnapshotCard` is read-only) and has been removed. | **Retired / immutable read surface** | Ownership invariant (M002-A3): **Creation** — canonical first-fill engine only (`executeTradeFill`); **Repair** — deterministic trade execution correction only (`repairRiskSnapshot`, inside the correction transaction; rolls back atomically with it); **Client** — GET only. `GET` stays 200+row (incl. A2 provenance) / 404 missing. No alternate PATCH/POST/DELETE mutation path exists; `PUT /api/trades/[id]` schema never accepted snapshot fields. |
| Canonical risk computation libraries | T03-audited: `src/lib/trade-metrics.ts` `computeTradeMetrics` (FIFO metrics + `risk.activeStop`/`initialRiskPct`/`initialStop` — 312 tests), `src/lib/risk-snapshot.ts` (`computeEquityAtOpen`, `deriveInitialRiskAmount`, `computeRiskSnapshotValues` — 75 tests), `src/lib/position-sizing.ts` (`calculatePositionSize`/`calculatePlanRiskRewardPreview`, typed `Position sizing error:` validation — 82 tests), `src/lib/mark-to-market.ts` (`computeMarkToMarketSummary` on canonical FIFO net unrealized P&L — 74 tests), `src/lib/trade-levels.ts` (`deriveCurrentStop`/`deriveCurrentTarget`, M019 chain derivation). All pure modules, no db/NextResponse imports. | **Reuse** | Solid foundation. One caveat: `risk-snapshot.ts` `computeEquityAtOpen` is pure but **built on the legacy model** (startingBalance+deposits−withdrawals+realizedPnL) — S03 must feed it canonical equity (rollforward `endingEquity` / projections) instead of the legacy aggregates (see Legacy equity sources row). |
| Current-stop / current-target derivation | T03-confirmed: current stop = **latest valid stop adjustment → initial stop from snapshot → planned stop** (both `deriveCurrentStop` in `trade-levels.ts` and `computeTradeMetrics` `risk.activeStop` implement this chain; `computeTradeMetrics` additionally keeps a backward-compat derive-from-`initialRiskAmount` branch when `initialStopPrice` is null). Current target per index = latest adjustment `newTarget` → planned target (`deriveCurrentTarget`). Ordering tiebreakers: `adjustedAt desc, createdAt desc, id desc` (deterministic). | **Current** | Matches §31/§33 and M019. Reuse as-is; S05 wires this to live risk propagation. |
| Legacy equity sources | T03-verified: **both** execution routes compute equity-at-open from legacy `accounts.startingBalance` + `accountTransactions` (deposits/withdrawals ≤ execution date) + realized P&L of prior closed trades (P1 L454–463, P2 L278–287), with `settings.startingAccountValue` fallback — **not** the M006 canonical accounting model. The "canonical" `risk-snapshot.ts` `computeEquityAtOpen` wraps the **same legacy model**. `account-summary.ts` balance rollforward also rolls from legacy `startingBalance`. Meanwhile the canonical cascade **exists and is unused by trade execution**: `src/lib/accounting/dashboard-v2.ts` L1036–1052 resolves equity as `account_performance.nav → account_rollforward.ending_equity → account.startingBalance → settings.starting_account_value` (used only for journal risk/position-weight). | **Replace** | §14/§110: S03 must use canonical Account Workflow state (financial events → projections → `account_rollforward.ending_equity`) with provenance as the equity-at-open source; legacy `startingBalance`/`accountTransactions` may remain only as a compatibility fallback, never as primary truth. |
| Max-risk limit (§19) | T03 re-confirmed: **no max-risk enforcement anywhere** in execution paths; `accountRiskPct`/`initialRiskPct` are computed for display only. `position-sizing.ts` already provides the preview math S02 needs. | **Missing** | Binds to D2 below: hard block + explicit override with reason preserved as journal evidence. Implemented in S02 (preview) + S03 (canonical execution boundary). |
| Stop adjustments | `POST /api/trades/[id]/stop-adjustments` — M019: server-derived `previousStop`, append-only rows, current stop = latest adjustment else initial stop else planned stop. | **Current** | Matches §31. Reuse. |
| Target adjustments | `POST /api/trades/[id]/target-adjustments` — M019 server-derived `previousTarget`, append-only. | **Current** | Matches §33. Reuse. |
| Account execution posting | P5 `POST /api/accounts/[id]/executions` → `postExecutionFill` → M006 kernel (`postFinancialEvent`; `event-posting.ts` `postEventWithEffect` for the API surface) — atomic, idempotency-keyed, pre-flight FIFO, USD + A6 guards; **trade executions bypass it** via P3 (T02 verified: no trade path calls it). | **Reuse** | S03 must route trade executions through this path (with journal linkage), not through P3. |
| FIFO rebuild | `src/lib/positions/rebuild.ts` (`rebuildPositions`) — canonical, used by sync layer and corrections. | **Reuse** | Deterministic FIFO allocation. S03 embeds it in the execution transaction; rejection must roll back the whole operation (§26/§47). |
| Position rebuild | `account_positions` maintained by `rebuildPositions`; reconciled to FIFO. | **Reuse** | §72 invariant; S08 verifies reconciliation. |
| Execution correction (account-scoped) | `POST /api/accounts/[id]/executions/[executionId]/correct` → `correctExecution` (reversal + replacement + lineage; FIFO + performance rebuild). T04: **no `journal_trade_id` guard** — can correct a trade-linked execution directly, silently unlinking it (F3, §2c). | **Reuse** | Accounting-only corrections keep this path (§77). Add a trade-linkage guard or delegate trade-linked corrections to the trade-scoped path (S06, F3). |
| Execution correction (trade-scoped) | `POST /api/trades/[id]/executions/[execId]/correct` → **same** `correctExecution`; **never touches the `trades` table** (journal status/openedAt/closedAt/reviewedAt are not rebuilt — test-verified `trade status unchanged after correction`); reversal/replacement rows are inserted with `journal_trade_id: null`, so the corrected stream **never re-attaches to the journal** (F1/F2, §2c). | **Replace/Refine** | §41/§44: trade-linked corrections must rebuild journal lifecycle **and preserve linkage**. `correctExecution` must become journal-aware (or the trade route must orchestrate the rebuild) in S06. |
| Trade correction (journal) | No journal-lifecycle rebuild on correction (F1) and no linkage re-attachment of corrected fills (F2). | **Missing** | S06. |
| Trade metrics | `src/lib/trade-metrics.ts` (`computeTradeMetrics`) — canonical, consumed by routes/UI. | **Current** | Reuse (§51). |
| Review / grade / mistakes / assets | T05-verified (§2d R1a–R1g): grade route upserts `trade_grades` only — **never writes `trades`**; **`trades.lesson`/`exitNotes` are write-orphaned** (PUT schema ends at `preTradePlan`; `TradeExitNotesCard` is read-only display); mistakes/assets/assessments are self-contained evidence tables; **no `reviewedAt` anywhere in `src/`**; review completion is inferred from evidence presence. | **Missing/Refine** | §64/§65: add explicit `reviewedAt` with a meaningful-evidence contract (lesson non-empty + grade exists) **and a lesson/exitNotes write surface** (F6). S07. |
| Checklist (`trade_check_results`) | FK to mutable `checklistDefinitions`; **no item-text snapshot** (schema: only `checklist_definition_id`, `passed`, `comment`, `checkedAt`); **no `required`/optional flag on items**. Enforcement diverges by route (T02-verified): `/execute` **enforces ALL merged items** (400 on missing/not-passed, before mutation); `/executions` **no checklist handling at all** — a fill can open a trade with zero checklist evidence. T05-verified (§2d R2a–R2e): evidence rows store only the definition FK, GET joins the **live mutable description** (F7), creation is **P1-only with no backfill** (F8), and re-runs append duplicate rows (R2d). | **Refine** | §20 gate (required items must pass before first fill, enforced on every path — with an explicit required/optional distinction) + §21 historical snapshot (item text at entry) + idempotent evidence upsert + backfill surface. S02/S03. |
| `/trades` UI | Workspace list (`src/app/(trades)/trades/page.tsx`): planned/open/closed/deleted filters, scratch (DELETE), export, mtm refresh. (T06 §2e U1) | **Reuse** | §56–60 phase tabs largely present; add `Managed` phase indicator + Reviewed tab in S05/S07 (F10 phase-visibility gap, U1/U3). |
| Trade detail UI | Legacy `src/app/(legacy)/trades/[id]/page.tsx` mounts **both** `execute-dialog` (bulk → `/execute`) and `add-fill-dialog` (individual → `/executions`). (T06 §2e U2 — the **sole live execution-posting UI**; F9) | **Replace/Reuse** | §9: remove the bulk dialog from normal UX; individual-fill composer is the primary path. S02. Rewire both dialogs to the canonical service in S03 (F9 — no other surface posts executions). |
| Root Risk dashboard consumers | `src/app/(legacy)/page.tsx` = WorkstationShell `liveMode`; consumes dashboard API built on canonical libs; M013/S01 already treats unpriced/unavailable risk as `null` (never fabricated 0). (T06 §2e U3 — V1+V2 + watchlist via `workstation-live-adapter.ts`; never posts executions; F10 zero phase awareness) | **Reuse** | §54/§32: propagation after refresh already expected; S08 verifies. |
| Idempotency | `accounting_executions` has a unique idempotency key (M006); journal-side execution creation is **not** idempotent; sync derives a key but a retried journal POST duplicates the journal row. | **Missing** | §10: canonical service must accept a client-generated key, reuse on retry, not consume on failed transaction. S03. |
| Backdated fills | Ordering is `executedAt, createdAt` in reads; no full deterministic rebuild on backdate (sync/FIFO rebuild runs, journal status derives from ordered stream — partially OK). | **Refine** | §28: S03/S04 formalize deterministic ordering + rebuild semantics. |
| Action semantics | Direction-action map **duplicated** in both `/execute` and `/executions` (identical `DIRECTION_ACTIONS` constant); no over-close guard on journal path; long/short inversion not explicitly blocked (P2 can re-open a closed trade via `buy`/`sell` on the opposite side). | **Replace** | §24–27: canonical action rules + quantity guards in S04. |
| Review completion contract | None — T05-verified: no `reviewedAt` marker, no 'reviewed' status, no completion gate anywhere in `src/`; stepper infers review from evidence presence. | **Missing** | S07 (§64–67) with F5 (durable marker) + F6 (lesson/exitNotes write surface). |
| Multi-trade same-symbol | Account FIFO is account/instrument-level; journal attribution not audited. | **Missing** | S06 (§73–74) + S08. |

---

### 2b. Risk surface ledger (T03, verified 2026-08-24)

T03 confirmed the risk surface is a **reuse layer over a legacy equity foundation**: every pure risk computation is canonical and tested, but the equity-at-open feeding the first-entry snapshot comes from the legacy account model on both trade routes, and a manual snapshot-rewrite API exists with no UI consumer.

| # | Surface | Verified finding | Class |
|---|---|---|---|
| L1 | First-entry risk snapshot | Both routes guard with `if (!existingSnapshot)`; schema enforces UNIQUE `trade_id` → created once on first entry, **deterministic** (avg entry price, entry qty, stop source per route), **preserved through management** (never rewritten by later fills). | **Current** (semantics) |
| L2 | Equity-at-open source | P1/P2 compute it from legacy `startingBalance` + `accountTransactions` + prior closed P&L + settings fallback. `risk-snapshot.ts` `computeEquityAtOpen` is the same legacy model in pure form. Canonical cascade (`nav → rollforward.ending_equity → startingBalance → settings`) exists in dashboard-v2 but is **not** used by execution. | **Replace** (§14/§110) |
| L3 | Manual snapshot PUT | ~~`PUT /api/trades/[id]/risk-snapshot`~~ **Retired (M002-A3)**: 405 `RISK_SNAPSHOT_IMMUTABLE`; server-owned derived historical evidence — creation by first-fill engine only, repair by deterministic execution correction only, client GET only. Former dead UI code (`handleRiskSnapshotSave`) removed. | **Retired / immutable read surface** |
| L4 | Stop adjustment chain | `POST stop-adjustments`: R020 open-only 409 guard, M019 server-derived `previousStop` (client value stripped), append-only, `deriveCurrentStop` chain = latest adjustment → initial stop → planned stop. | **Current** |
| L5 | Target adjustment chain | `POST target-adjustments`: same pattern per `targetIndex` 1|2, `deriveCurrentTarget` = latest `newTarget` for index → planned target. | **Current** |
| L6 | Level-history feed | `GET /api/trades/[id]/level-history` merges stop+target chains (M019 UI feed). | **Current** |
| L7 | Canonical libs | `trade-metrics.ts` (312 tests), `risk-snapshot.ts` (75), `position-sizing.ts` (82), `mark-to-market.ts` (74), `trade-levels.ts` — all pure, all passing; consumed by dashboard/UI. | **Reuse** |
| L8 | Current-stop derivation | `computeTradeMetrics.risk.activeStop` and `deriveCurrentStop` agree: latest valid adjustment → stored `initialStopPrice` (never reconstructed from risk amount) → backward-compat derive-from-risk-amount. | **Current** |
| L9 | Max-risk limit | No enforcement anywhere; display-only risk-to-account. | **Missing** → D2 |

### 2c. Correction surface ledger (T04, verified 2026-08-24)

T04 confirmed a **three-surface correction model** built on a **single immutable
reversal+replacement engine**: both execution-correction routes (C1, C2) share
`correctExecution` (`src/lib/accounting/correction.ts`), cash events use a
separate cash-only kernel (C3), and planned-trade fills alone are mutable on the
journal side (C4). **No real-fill correction surface rebuilds the journal trade
lifecycle, and reversal/replacement rows drop `journal_trade_id` linkage.**

| # | Surface | Route / kernel | Ownership model | Journal lifecycle rebuild (openedAt/closedAt/status/reviewedAt) | journalTradeId linkage preservation | Class |
|---|---|---|---|---|---|---|
| C1 | Trade-scoped execution correction | `POST /api/trades/[id]/executions/[execId]/correct` → `correctExecution` (`src/lib/accounting/correction.ts`) | Trade-side bridge: resolves trade → accountId; 422 `NO_ACCOUNTING_RECORD` when trade has no account; finds the accounting mirror by idempotency key `trade-execution-<execId>` (builder **shared** with the sync layer — must not diverge); 404 if the mirror is missing; 404 if mirror `journal_trade_id` is set to a **different** trade; delegates to `correctExecution`. | **NO** — `trades.status/openedAt/closedAt/reviewedAt` untouched (test-verified: `trade status unchanged after correction`); legacy `trade_executions` row immutable (test-verified: quantity/price unchanged). | **NO** — reversal + replacement inserted with `journal_trade_id: null` (correction.ts 7a/7b). Original mirror keeps linkage (sync sets it at L142), the corrected stream does not re-attach. | **Replace/Refine** (§41/§44) |
| C2 | Account-scoped execution correction | `POST /api/accounts/[id]/executions/[executionId]/correct` → same `correctExecution` | Account-ownership pre-flight only (404 cross-account). **No `journal_trade_id` guard** — can correct a trade-linked execution directly, bypassing C1's linkage check. | **NO** (same kernel) | **NO** (same kernel) | **Reuse** for accounting-only (§77); add linkage guard or delegate when `journal_trade_id` set (S06, F3). |
| C3 | Financial-event (cash) correction | `POST /api/accounts/[id]/financial-events/[eventId]/correct` → `correctFinancialEvent` (`src/lib/accounting/financial-event-correction.ts`) | Cash events only — `CORRECTABLE_EVENT_TYPES` **explicitly excludes** `trade_execution` (deposit/withdrawal/dividend/interest/fee/tax/manual_adjustment/opening_balance). | n/a (no trade linkage) | n/a | **Reuse** — clean separation; no double correction surface for executions. |
| C4 | Planned-trade fill mutation | `PUT`/`DELETE /api/trades/[id]/executions/[execId]` | Guarded to `trade.status === 'planned'` (422 `Execution changes are only allowed for planned trades` otherwise). Directly mutates the legacy journal row **and rebuilds** status/openedAt/closedAt via `computeTradeMetrics` (both PUT and DELETE). UI: `CorrectionDialog` (trade-detail) routes planned → here, non-planned → C1. | **YES** (planned-only; journal rebuilt after mutation) | n/a (journal-side row; no accounting mirror) | **Current** for planned; real fills must use C1 (this path locks after first fill). |

**Binding findings (T04):**

- **F1 — Journal lifecycle never rebuilt on real-fill correction (Replace/Refine).**
  `correctExecution` rebuilds FIFO positions + account performance only; the
  `trades` row (status/openedAt/closedAt) and legacy `trade_executions` are
  untouched (test-verified C1). A correction that changes a closing fill's
  price/quantity leaves the trade's P&L, status, and close timestamps stale →
  **journal/accounting divergence after every trade-linked correction** — the
  same §7/§46 invariant violation as posting, in the correction direction.
  S06 must rebuild journal lifecycle from the corrected stream (mirror the
  planned-PUT path's `computeTradeMetrics` orchestration).
- **F2 — Correction drops trade linkage (Replace).** Reversal + replacement are
  inserted with `journal_trade_id: null` (correction.ts 7a/7b).
  `correction_lineage.original_execution_id` preserves a traceable chain back
  to the trade, but the corrected stream (replacement) is not directly
  trade-linked; multi-fill trades and journal attribution lose the corrected
  fills. S06 must carry `journalTradeId` from the original into reversal +
  replacement (and the correction financial-event payloads).
- **F3 — Account-scoped route has no trade-linkage guard (Refine).** C2 can
  correct a trade-linked execution directly with no `journal_trade_id`
  consistency check (unlike C1), producing a corrected accounting stream the
  trade journal never sees. Either 4xx trade-linked corrections on the account
  route (directing to C1) or handle linkage uniformly in the kernel.
- **F4 — Missing mirror blocks correction (Refine).** C1 404s `Execution not
  found` when the mirror is absent — exactly when P3 sync failed (non-fatal by
  design, §1) or the fill predates M006. Unsynced fills cannot be corrected at
  all (UI renders the `No accounting record` state; M019/S04 must-have #5).
  S06 must repair/backfill the mirror or provide an audited journal-side
  correction for that case.

**Ownership model summary (T04):** corrections are **accounting-owned** — all
real-fill corrections run in the M006 accounting layer through one shared
immutable engine (C1+C2), cash events through a separate cash kernel (C3), and
only planned-trade fills are mutable on the journal side (C4). Trade linkage is
**attribution-only** (never enforced by the kernel) and is **lost on
correction** (F2); journal lifecycle is **never rebuilt** by any real-fill
correction path (F1).

### 2d. Review and checklist surface ledger (T05, verified 2026-08-24)

T05 audited every trade review surface (grade, lesson, mistakes, assessments,
assets, check-results) and the checklist evidence model. **Review completion
is inferred, never durable** — no `reviewedAt` marker, no 'reviewed' status,
and the review-narrative columns (`trades.lesson`, `trades.exitNotes`) have
**no write path in the API at all**. Historical checklist evidence is
**re-interpreted by mutable definition text** — `trade_check_results` stores
only the definition FK, and the read route joins the live
`checklist_definitions.description`.

#### R1. Review completion state

| # | Surface | Verified finding | Class |
|---|---|---|---|
| R1a | Trade review completion marker | **None exists.** `trades.status` enum is `planned/open/closed/deleted`; no `reviewedAt` column; `rg 'reviewedAt|reviewed' src/` → **zero matches**. Nothing durably records "review done" vs "in progress". `review_action_items.source_type` accepts `'trade_review'` (action items can be trade-linked) but no table/column marks review completion itself. | **Missing** (§64/§65) → S07 |
| R1b | Grade | `PUT/GET /api/trades/[id]/grade` → upsert `trade_grades` (UNIQUE `trade_id`; idempotent overwrite; auto `calculateGrade` totalScore/gradeLabel; zod-validated scores 1–10). **Does not touch `trades`** — no lesson write, no status/review marker. A grade can be saved and later overwritten with no completion implication. | **Refine** (per-trade durable; must link to the completion contract) |
| R1c | Lesson / exit notes | `trades.lesson` and `trades.exitNotes` are **write-orphaned**: `PUT /api/trades/[id]` schema ends at `preTradePlan` (no lesson/exitNotes fields, verified in the set-block); **no route in `src/` writes them** (only seed/prompt-preview fixture/tests); `TradeExitNotesCard` is read-only display. The §64/§65 "lesson non-empty" evidence contract is **unattainable via the API today**. | **Missing** → S07 |
| R1d | Mistakes | `GET/POST/PUT/DELETE /api/trades/[id]/mistakes` → `trade_mistakes` (mistakeTypeId → lookupValues `mistake_type`; phase/severity enums; status lifecycle `open→addressed→improved→resolved`; PUT partial update). | **Current** |
| R1e | Assessments | `POST/GET /api/trades/[id]/assessments` → versioned `trade_assessment_snapshots` via `performAssessment` (`ai_quality`/`ai_review`; AssessmentError→HTTP mapping; secret-safe responses; snapshot written in engine tx; version = 1-based history index). | **Current** |
| R1f | Assets | `GET/POST/DELETE /api/trades/[id]/assets` → `trade_assets`; multipart upload to `public/uploads/trades` (5MB cap, 5-screenshot cap, MIME allowlist) + JSON link path; DELETE unlinks file fire-and-forget. | **Current** |
| R1g | Phase inference | `lifecycle-stepper.ts` derives step 7 from `exitNotes \|\| lesson \|\| hasGrade \|\| hasMistakes` — a **presence heuristic**, not a completion flag; nothing distinguishes "review in progress" from "review done". | **Missing/Refine** (S07 replaces with durable marker) |

#### R2. Checklist evidence model

| # | Surface | Verified finding | Class |
|---|---|---|---|
| R2a | `trade_check_results` schema | Columns: `tradeId`, `checklistDefinitionId` (FK → `checklist_definitions`), `passed`, `comment`, `checkedAt`, `createdAt`. **No item-text snapshot** (description never copied), **no `required`/optional flag**, no `isActive`/`deletedAt` snapshot. | **Refine** (§20/§21) |
| R2b | Creation path | **Single path: P1 `/execute` only** (insert in-tx, L497–501). Gate: merged active checklist (account OR resolved setup, `isNull(deletedAt)`) → 400 blocks execution when any item missing/not-passed. **P2 `/executions` has zero checklist handling** (T02-verified; does not import checklist tables) — a fill can open a trade with no checklist evidence; the `check-results` route is **GET-only**, so evidence can never be backfilled. | **Replace/Refine** (§20 gate on every path + backfill surface, S02/S03) |
| R2c | Historical integrity | Read route inner-joins **live** `checklist_definitions.description` (test `check-results.test.ts` codifies this join contract). Editing an item's text rewrites what past fills "checked"; soft-delete (`deletedAt`) removes it from display/future gates; no versioning. | **Refine** (§21 item-text snapshot at entry) |
| R2d | Duplicate evidence | Re-running `/execute` with the same `checkResults` appends duplicate rows — no UNIQUE on `(tradeId, checklistDefinitionId)`. | **Refine** (idempotent upsert in S03) |
| R2e | Checklist definition CRUD | `accounts/[id]/checks`, `setups/[id]/checks`, `checks/merged`, `checks/reorder` — fully mutable definitions (description/sortOrder/isActive/deletedAt). | **Current** (management surface; feeds R2c gap) |

**Binding findings (T05):**

- **F5 — Review completion is not durable (Missing).** No `reviewedAt`-style
  marker and no 'reviewed' status exist anywhere in `src/`; review completion
  is inferred from evidence presence (`lifecycle-stepper`). S07 must add an
  explicit completion marker (reviewedAt + reviewed status or equivalent) with
  the §64/§65 meaningful-evidence contract enforced at the write boundary.
- **F6 — Lesson/exitNotes have no write path (Missing).** The trade update
  schema excludes them; no route writes them; the UI only displays them. S07
  must add a review-write surface (lesson + exitNotes) so the
  meaningful-evidence contract is satisfiable.
- **F7 — Historical checklist evidence is mutable-text-dependent (Refine).**
  `trade_check_results` stores only the definition FK; display joins the live
  mutable description. S02/S03 must snapshot the item text (and required flag)
  at check time per §21.
- **F8 — Checklist evidence can be zero (Replace).** P2 opens trades with no
  checklist handling and no backfill exists (GET-only route). The §20 gate
  must be enforced on every execution path (S03) with a backfill/evidence
  surface for pre-existing fills.

**Correction to §2 (T05-verified):** the earlier "Review / grade / mistakes /
assets" row claimed "Grade + lesson upsert on `trades`" — **wrong**: the grade
route upserts `trade_grades` only and never writes `trades.lesson` (the
lesson/exitNotes columns are write-orphaned, F6). Rows above now reflect the
verified behavior.

### 2e. UI consumer ledger (T06, verified 2026-08-24)

T06 audited every user-facing consumer of execution and risk data. **The only
live execution-posting UI is the legacy trade detail (U2), and it posts
exclusively to the two Replace-class trade endpoints (P1/P2).** The canonical
account-scoped posting route (P5) has **no live UI consumer** — its only client
component (`AccountExecutionForm`) is dead code with no mount site. The root
dashboard reads position/risk entirely through the canonical V1+V2 dashboard
APIs and never posts executions.

| # | UI surface | Endpoints it calls | Posts executions? | Position/risk reads | Phase visibility | Class |
|---|---|---|---|---|---|---|
| U1 | `/trades` workspace list (`src/app/(trades)/trades/page.tsx`, 1964 lines) | GET `/api/accounts` (filter); GET `/api/trades?status=&page=&limit=&from=&to=&accountId=&direction=` (per-tab list, `result.totals` + `plannedTotals`); GET `/api/trades/export?…`; DELETE `/api/trades/[id]` (scratch, R027/D057); POST `/api/trades/mtm/refresh` | **No** | Open-tab rows carry `row.metrics` (canonical `computeTradeMetrics`: open risk, avg cost, unrealized P&L) and planned-tab totals show `plannedRiskToAccount` | Tabs: planned / open / closed / deleted; **no Managed indicator, no Reviewed tab** (row link → `/trades/[id]` legacy detail U2) | **Reuse** (add Managed + Reviewed surfacing in S05/S07) |
| U2 | Legacy trade detail (`src/app/(legacy)/trades/[id]/page.tsx`) — **the only live execution-posting UI** | POST `/api/trades/[id]/execute` (**P1**) via `ExecuteDialog` (bulk entry+exit1+exit2, merged checklist → `checkResults` all-passed — the §20 hard gate, optional stop override); POST `/api/trades/[id]/executions` (**P2**) via `AddFillDialog` (single fill + reasonId/notes, **no checklist**); `CorrectionDialog`: planned → **C4** PUT/DELETE `/api/trades/[id]/executions/[execId]`, non-planned → **C1** POST `/api/trades/[id]/executions/[execId]/correct`; `TradeExecutionsCard` planned PUT/DELETE (C4). Reads: GET trade, executions, risk-snapshot, level-history, stop/target-adjustments, grade, mistakes, check-results, assets, lookups; POST `/api/trades/[id]/mtm` + `/api/trades/mtm/refresh`. **Dead code:** `handleRiskSnapshotSave` PUT `/api/trades/[id]/risk-snapshot` (L3; never wired, `RiskSnapshotCard` read-only) | **Yes — P1 + P2 only** (both **Replace**); corrections C1/C4 | Risk snapshot card (first-entry), P&L card, level-history feed, check-results card | `LifecycleStepper` 6 steps (Plan/Size/Execute/Manage/Exit/Grade) + **inferred** 7th (F5/R1g — evidence-presence heuristic, not a durable marker); phase views: planned/active/closed/deleted — **no managed phase view** (open is used for both managing and managed) | **Replace/Reuse** (retire bulk dialog → S02; rewire dialogs to canonical service → S03; managed phase + durable reviewed → S05/S07) |
| U3 | Root Risk & Positions dashboard (`src/app/(legacy)/page.tsx` → `WorkstationShell` `liveMode=true`) | `fetchAllLiveDashboardData` (`src/lib/workstation-live-adapter.ts`): GET `/api/dashboard` (V1), GET `/api/dashboard/v2` (V2), GET `/api/watchlist`, GET `/api/accounts`; best-effort live prices; POST `/api/trades/mtm/refresh` | **No** | RiskPanel: `riskSummary.openRisk` = Σ `initialRiskAmount` of open journal risk snapshots (R032) + `openRiskToStop` vs nav; TradesWorkspacePanel: open tab = V2 `valuation.positions` (**account_positions**, FIFO), closed tab = GET `/api/trades?status=closed&accountId=`; AccountStatePanel: V2 metrics + valuation completeness; RiskPositionsTable; EquityChart; WatchlistPanel | **No workflow phase model** — open positions + closed trades only; no planned/managed/reviewed surfaces (gap vs §56–60) | **Reuse** (canonical APIs, M013 null semantics; phase surfacing deferred to S05/S07) |
| U4 | Account Overview (`src/app/(legacy)/settings/accounts/[id]/page.tsx` → `AccountOverview`) | GET `/api/accounts/[id]/overview` (snapshot: nav, netCash, realized/unrealized P&L, exposure + positions + recent financial events); POST `/api/accounts/[id]/financial-events` via `FinancialTransactionComposer` (**cash events only**, not executions) | **No** (financial events only) | Overview snapshot + positions rows (mark status fresh/stale/missing/pending) | n/a (account workspace) | **Reuse** |
| U5 | Account Positions (`/settings/accounts/[id]/positions` → `AccountPositions`) | GET `/api/accounts/[id]/positions` | No | FIFO lots with expandable open-lot detail, missing-price/null-mark states | n/a | **Reuse** |
| U6 | Account Ledger (`/settings/accounts/[id]/ledger` → `AccountLedger`) | GET `/api/accounts/[id]/ledger` (financial events + correction lineage) | No | — | n/a | **Reuse** |
| U7 | **Orphaned account-execution UI — dead code, zero mount sites** | `AccountExecutionForm` → **POST `/api/accounts/[id]/executions` (P5)** with client-generated `idempotencyKey` + optional `journalTradeId` — **the canonical economic path's only UI consumer, never mounted**; `AccountExecutionsActivity` → GET `/api/accounts/[id]/executions` (never mounted); `AccountCorrectionForm` (**C2** account-scoped correct) mounted only inside the orphaned `AccountExecutionsActivity`; `AccountActivity` (financial-events composer, superseded by `FinancialTransactionComposer`); `CurrentRiskPanel` (9-metric dashboard grid) referenced only by its own test — the workstation uses its own `RiskPanel`; `AddExitDialog` (exit fill → P2) referenced only by a comment in `add-fill-dialog.tsx` | Would (P5/P2) but never mounted | Would but never mounted | n/a | **Replace/Reuse** (S03 must wire the canonical execution surface through U2's dialogs, not resurrect U7 as-is; decide component fate in S03) |
| U8 | Planning / creation surfaces | `PlanTradeForm` (mounted in `/trades/new`) → **POST `/api/trades`** (Refine creation route, T01); sizing calculator (`src/app/(legacy)/sizing/page.tsx`) → GET `/api/settings` + `/api/accounts` + **POST `/api/trades`** (creates a planned trade from the calculator), preview math via canonical `calculatePositionSize`/`calculatePlanRiskRewardPreview` (`position-sizing.ts`) | **No** (creates planned trades only) | Sizing preview only (no live position/risk state) | planned-only by construction | **Reuse** — the sizing preview is the D2 max-risk preview foundation S02 must surface |

**Binding findings (T06):**

- **F9 — Sole live execution-posting UI is U2, and it posts exclusively to the
  Replace-class endpoints (P1/P2).** No live UI calls the canonical P5 account
  route; its only client (`AccountExecutionForm`, U7) is dead code. The S03
  canonical-service swap must rewire **exactly two posting dialogs**
  (ExecuteDialog → retire; AddFillDialog → canonical service) plus the
  CorrectionDialog C1 routing (S06) — no other surface posts executions, so the
  swap's UI blast radius is confined to the legacy trade detail.
- **F10 — Root dashboard has zero workflow-phase awareness.** U3 reads
  position/risk exclusively through canonical V1+V2 APIs (open positions =
  `account_positions`; closed trades = `GET /api/trades?status=closed`; open
  risk = journal risk snapshots) but surfaces **no planned/managed/reviewed
  state** — the phase model lives only in U2's legacy stepper, and even there
  Managed is collapsed into `open` and Reviewed is an evidence-presence
  heuristic (F5). S05/S07 must add phase surfacing to the dashboard and
  workspace without changing the canonical data contract.
- **F11 — MTM refresh is a shared write path, not a duplication.** Both U1 and
  U2 POST `/api/trades/mtm/refresh` (one route); the workstation (U3) also
  triggers it. Single route, multiple consumers — no divergence.

**Plan mismatch (T06, adapted):** the plan listed `src/app/(legacy)/trades/page.tsx`
as a legacy trades list — **that file no longer exists**; the legacy trades list
was replaced by the workspace list U1 (`(trades)/trades/page.tsx`). Only
`/trades/new` and `/trades/[id]` remain in the legacy group. The audit covered
the actual list surface (U1) instead.

---

## 3. S01 binding policy decisions

These are the decisions the requirements doc explicitly defers to S01
(§17, §19, §20). They bind S02–S09.

### D1 — Missing/zero-risk execution policy (§17)

- **Decision:** An opening fill without a valid stop is **permitted**, but its
  risk metrics must render as **unavailable** (`null`), never as `0`.
- Current state supports this direction: M013/S01 already preserves
  `null`/unavailable semantics across the dashboard and trade metrics; both
  execution routes create a first-entry snapshot without `initialStopPrice`
  when no valid stop exists.
- S03 must reject **invalid stop geometry** (long stop ≥ entry, short stop ≤
  entry) with an actionable 400/422, and must never write a fabricated
  `initialRiskAmount` of 0 when risk cannot be determined.

### D2 — Max-risk-limit policy (§19)

- **Current state found:** there is **no** max-risk enforcement anywhere in the
  execution paths — risk-to-account is computed for display only.
- **Decision:** the product introduces a **hard block**: when the proposed
  initial trade risk (from the first-entry snapshot) exceeds the effective
  configured max-risk threshold (account override → global default cascade),
  execution is **blocked with a prominent pre-execution warning** (not buried
  in secondary text).
- **Override:** a deliberate override is allowed **only** with explicit
  acknowledgement plus a required reason, and the reason is preserved as
  journal evidence on the trade (plan/management history). No silent override.
- Implemented in S02 (planned-risk preview shows the limit) and S03 (enforced
  at the canonical execution boundary).
- **M002-A1 (effective execution configuration):** execution readiness
  resolves risk and commission through the shared `resolveEffectiveExecutionConfig`
  — **account override → global default → unavailable**. An account-level null
  does NOT by itself mean not-trading-ready when a valid global default
  exists; explicit zero commission is a valid configured value. Readiness and
  the max-risk threshold use the SAME effective max-risk value, and the
  planned-risk preview resolves it through the same resolver so preview and
  execution agree. Planning eligibility (exists/active/USD) stays strictly
  lighter than execution readiness; management fills never re-run the
  first-fill readiness gate.
- **M002-A2 (canonical execution equity):** execution equity (the denominator
  of max-risk and account-risk) resolves through the shared
  `resolveExecutionEquityContext` — **current canonical projection
  (account_performance.nav, pre-fill) → safe historical canonical source
  (account_rollforward bounded by asOf) → explicit canonical reconstruction
  (canonical net cash at asOf, only when no prior canonical trade-execution
  activity exists) → explicit legacy compatibility
  (startingBalance/accountTransactions, only for accounts with no canonical
  funding history) → unavailable**. Key rules:
  - Canonical zero never falls through to a global starting value;
    `settings.startingAccountValue` cannot fabricate funding for a canonical
    account.
  - Current NAV is not used for a backdated timestamp when it includes future
    state — backdated fills resolve bounded historical equity or
    `unavailable`.
  - Preview / readiness / max-risk / persisted risk snapshot share ONE
    resolver; the snapshot stores explicit equity provenance
    (`account_equity_source`, `account_equity_as_of`).
  - Legacy compatibility is explicit, last, and cannot override canonical
    zero. Trade-funded `account_performance` rows alone are NOT canonical
    funding evidence (a legacy account's rebuild produces a misleading zero
    NAV).
- **M002-A2.1 (no double-counted trading P&L in historical reconstruction):**
  `reconstructed_canonical` means **canonical cash-only reconstruction, and
  ONLY when no canonical trade-execution activity exists at/before asOf**
  (financial_event `event_type = 'trade_execution'`, `posted_at <= asOf`;
  journal trades/executions are attribution records, never the economic
  criterion). Rationale and rules:
  - Canonical execution financial events already embed the full economic
    consideration of every fill (cash in for sells/shorts, cash out for
    buys/covers), so a flat account's equity equals its net cash exactly.
    **Realized P&L is never added separately to cash** — execution cash flows
    already encode the economic proceeds. `netCash + journalRealizedPnl` was
    the A2 defect (e.g. long 10,000 → buy 1@100 → sell 1@350 returned
    10,500 instead of 10,250).
  - With prior trade activity and no trusted as-of rollforward/projection,
    historical marked equity (cash + open positions) is not provable from
    canonical state → **`unavailable`** (false precision is worse than
    unavailable risk). A backdated first fill then blocks through the normal
    account-not-trading-ready / unavailable-equity contract: no execution, no
    risk snapshot.
  - The correction kernel's reversal/replacement events are also
    `trade_execution` events, so corrected executions count as activity at
    their effective timestamps — historical resolution never uses stale
    pre-correction journal P&L.
  - The legacy compatibility path alone retains the pre-M006 journal-P&L
    contract (unchanged from A2; hybrid/legacy classification is audited
    separately).
- **M002-A5 (economic-side normalization — short Add/Reduce cash direction):**
  journal `add`/`reduce` are **workflow aliases** (management phase, timeline,
  trader UX, analytics); canonical accounting actions are **concrete economic
  sides** and financially unambiguous. ONE shared resolver
  (`resolveEconomicExecutionAction` in `src/lib/accounting/economic-action.ts`)
  maps workflow action + position direction to the economic side:

  | journal | long | short |
  |---|---|---|
  | buy | buy | (rejected) |
  | add | buy | **sell_short** |
  | sell | sell | (rejected) |
  | reduce | sell | **buy_to_cover** |
  | sell_short | (rejected) | sell_short |
  | buy_to_cover | (rejected) | buy_to_cover |

  Cash direction derives from the economic side only: sell/sell_short →
  increase; buy/buy_to_cover → decrease. The engine resolves the economic
  action before `postExecutionFill`; the direct account route resolves
  add/reduce from the current canonical position direction (rejects with
  `AMBIGUOUS_EXECUTION_ACTION` when no position exists — never guesses); the
  legacy sync helper resolves via the linked trade; the financial-event
  builder throws on an unresolved add/reduce. Journal `trade_executions` keep
  the alias; `accounting_executions`/financial-event payloads carry the
  concrete action (short add 20@45 → cash +900, not -900; short reduce 20@40
  → cash -800, not +800). Correction reversal/replacement use the concrete
  opposites (sell_short ↔ buy_to_cover).

  **Historical compatibility:** pre-A5 short add/reduce rows whose financial
  event recorded the inverted cash side are repaired by an auditable,
  idempotent compensating event (`cash-direction-repair` service: typed
  `manual_adjustment` with deterministic key
  `cash-direction-repair:<executionId>:v1`, delta = ±2× consideration, atomic
  with the account-performance rebuild). Immutable originals are never
  rewritten; long aliases and concrete actions are never touched; a re-run
  adds zero economic effect. Execution fees are deliberately NOT bundled into
  A5 (separate audit follows).
- **M002-A6 (execution fees: exactly once in cash, FIFO P&L, and NAV):**
  `execution.fees` is the factual fee truth; the fee is a real cash expense
  at execution time regardless of economic side. Final economic contract:
  - **Cash:** the gross trade event stays quantity × price (never netted); a
    separate deterministic execution-fee event (`eventType fee`, direction
    decrease, key `accounting-execution-fee:<executionId>:v1`) posts the fee.
    Zero fee → no meaningless $0 event. `postExecutionFill` creates both
    atomically (result gains `feeEventWithPostings`); the legacy sync ensures
    both; failure of either rolls the whole execution back.
  - **FIFO:** opening fees travel with their FIFO lots. A closing match
    realizes a proportional share of the lot's REMAINING opening fee (exact
    integer micros; a full close absorbs the remainder) plus its proportional
    share of the closing fee — `match.allocatedFees = entry share + exit
    share`, `realizedNetPnl = realizedGrossPnl − allocatedFees`. Partial
    closes reduce the lot's remaining quantity AND remaining fee; a fully
    closed lot retains no open fee. Exact preservation: sum(entry fees
    realized) + remaining entry fee == original opening fee (no cent lost,
    no double allocation).
  - **Valuation:** open fees (sum of open `fifo_lots.allocated_fees`) reduce
    net unrealized P&L (`netUnrealizedPnl = grossUnrealizedPnl − openFees`,
    exposed alongside `openFees`/`grossUnrealizedPnl` on ValuationPosition;
    `unrealized_pnl` is the net figure). NAV = cash + marked positions only —
    fees hit NAV through cash, never as a second subtraction.
  - **Corrections:** reversal executions are accounting machinery — never
    charged an execution fee. A correction refunds the original's posted fee
    exactly once (typed `manual_adjustment` increase, key
    `correction-execution-fee-refund:<originalExecutionId>:v1`, only when the
    original fee cash event exists — pre-A6 originals that never posted a fee
    get no fictitious refund) and posts the replacement's fee event once.
  - **Historical repair:** `fee-repair` appends missing fee cash events for
    EFFECTIVE executions only (uncorrected + correction replacements;
    lineage originals/reversals excluded), rebuilds positions under the
    corrected allocator and the account projection atomically, and is fully
    idempotent (second run changes nothing). A5 cash-direction repair and A6
    fee repair use disjoint keys — order-independent.
  - **Scope:** default-commission resolution, risk, equity, A5 economic-side
    mapping, and standalone account fee events are untouched.
- **M002-A7 (direct account execution is atomic with FIFO and account
  performance):** `POST /api/accounts/:id/executions` previously committed
  the accounting execution + cash/fee events inside `postExecutionFill` and
  then rebuilt FIFO + account performance OUTSIDE that transaction — a
  projection failure could leave committed execution economics with a stale
  projection (and the performance rebuild result was ignored). Now the route
  delegates to `postAccountExecutionWithProjections` (same posting service),
  which owns ONE outer transaction:

  BEGIN
    postExecutionFill (nested savepoint: immutable execution + gross event
                       + fee event + ledger)
    rebuildPositionsWithinTransaction (FIFO lots / matches / position)
    rebuildAccountPerformance (explicit success enforcement)
    if !performance.success → throw AccountExecutionProjectionError
  COMMIT

  Any failure — FIFO replay rejection or a `{ success: false }` performance
  rebuild — throws inside the transaction, so the source execution, all
  cash/fee effects, ledger rows, FIFO lots/matches, account position, and
  projection changes roll back together. HTTP 201 therefore guarantees every
  projection succeeded; a rolled-back failure leaves the idempotency key
  unused and the request retryable (500
  ACCOUNT_EXECUTION_PROJECTION_FAILED, never a user-domain 4xx). Preflight
  (account active, USD-only, idempotency, action normalization, FIFO
  validation) stays before mutation; 4xx semantics are unchanged; the engine
  (executeTradeFill) already owns its own larger transaction and is
  untouched; no duplicate position/performance rebuild (the authoritative
  mutation path rebuilds exactly once).
- **M002-A8 (execution correction is atomic with FIFO, performance, and the
  trade lifecycle):** `correctExecution` previously committed reversal +
  replacement + fee economics + lineage and THEN rebuilt FIFO + account
  performance OUTSIDE the transaction (best-effort, success not enforced).
  Now `correctExecution` owns ONE correction transaction:

  BEGIN
    reversal execution + gross event
    replacement execution + gross event
    A6 replacement fee event / original fee refund (when the deterministic
      original fee event exists)
    correction lineage
    rebuildPositionsWithinTransaction (original + replacement instrument,
      fail closed on replay rejection)
    rebuildAccountPerformance (explicit success enforcement)
    if !success → throw ExecutionCorrectionProjectionError
  COMMIT

  A failed projection (real SQLite-trigger RAISE(ABORT) verified) rolls back
  reversal/replacement executions, all cash/fee/refund effects, ledger rows,
  lineage, FIFO lots/matches, account position, and projection changes
  together — the original execution stays immutable, is NOT marked
  already-corrected, and the correction idempotency key remains retryable
  (500 EXECUTION_CORRECTION_PROJECTION_FAILED, never a user-domain 4xx).
  `findOrCreateInstrument` for a new replacement symbol moved inside the
  transaction (no orphan instrument on failure). Both correction routes map
  the error to 500; the trade-scoped route keeps its outer transaction
  (lifecycle, risk-snapshot repair, reviewedAt invalidation) so a projection
  failure there rolls back the accounting correction AND the trade state —
  verified end-to-end. No duplicate post-transaction projection rebuilds
  remain; the correction response is built from in-transaction state.

  Final contract: ACCOUNT correction (reversal, replacement, fee correction,
  lineage, FIFO, account performance) is one atomic boundary; TRADE-LINKED
  correction additionally wraps lifecycle, risk-snapshot repair, and review
  invalidation in the caller's larger transaction. Projection failure → full
  rollback, idempotency retryable.

### D3 — Pre-trade checklist gate policy (§20)

- **Current state found (T02-verified):** the schema has **no `required` flag**
  on checklist items, so no route can distinguish required from informational
  items. `/execute` **enforces ALL** merged account+setup items (missing or
  not-passed → 400 before any mutation); `/executions` has **no checklist
  handling at all** and can open a trade with zero checklist evidence.
- **Decision:** on the **first opening fill**, all required checklist items
  (per account/setup, with an explicit required/optional distinction added to
  the schema) must have explicit results and **must pass** before the
  execution is accepted. Management executions after the first fill never
  re-run the gate. The gate lives in the canonical service (S03) so no
  alternate route can bypass it; both current execution endpoints route through
  it.
- §21 (historical integrity): `trade_check_results` gains a snapshot of the
  checklist item text at entry so later template edits/reorders/deletions never
  rewrite historical evidence. Implemented in S02/S03.

---

## 4. What S02–S09 consume from this matrix

- **S02** — plan freeze scope (all planning fields, not just `plannedStop`),
  lighter planning eligibility, planned-risk preview incl. max-risk limit (D2),
  checklist gate contract (D3).
- **S03** — single canonical execution service built on the M006 kernel (P4)
  reusing the P5 account-scoped posting path (`postExecutionFill`) with journal
  linkage, embeds FIFO/position/performance rebuilds, idempotency key, legacy
  equity replacement (canonical equity-at-open with provenance), checklist
  gate (D3) with a required/optional flag, max-risk block (D2); retires
  P1/P2/P3 from normal workflow.
- **S04** — action rules, quantity guards, backdated deterministic ordering.
- **S05** — management actions over the canonical service; stop/target history
  (already Current) wired to live risk propagation.
- **S06** — journal-aware correction (fix the `correctExecution` gap: F1 lifecycle
  rebuild on trade-linked corrections, F2 `journalTradeId` re-attachment of
  reversal/replacement rows, F3 account-route linkage guard, F4 missing-mirror
  repair), multi-trade FIFO attribution.
- **S07** — `reviewedAt` + review-evidence contract (F5 durable completion marker) + `lesson`/`exitNotes` write surface (F6) + correction invalidation.
- **S08** — cross-surface verification against §2 rows; S09 — UAT.

---

## 5. Explicitly deferred (M002 out of scope)

Broker execution, real-time market data, multi-currency, advanced instruments,
tax accounting, analytics redesign, AI coaching (§113–§119). Legacy
`startingBalance`/`accountTransactions` schema may remain for compatibility
but must not be a source of new economic truth (§110).
