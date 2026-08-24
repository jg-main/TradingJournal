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
code. There are **three** posting paths and **two** execution engines:

| # | Path | Lines | Nature | Verdict |
|---|---|---|---|---|
| P1 | `POST /api/trades/[id]/execute` (`src/app/api/trades/[id]/execute/route.ts`) | 558 | Bulk entry + exit1 + exit2 in one request (§9 anti-pattern). Inserts journal executions in its own transaction, then calls `syncAndRebuildPositions` inside `try { … } catch (_syncErr) {}` — **non-fatal: the request returns 201 even when accounting/FIFO sync fails** (§7/§46 anti-pattern). No journal-side idempotency key. Computes risk snapshot with **legacy** `computeEquityAtOpen(startingBalance, accountTransactions)` (§14/§110 violation). | **Replace** |
| P2 | `POST /api/trades/[id]/executions` (`src/app/api/trades/[id]/executions/route.ts`) | 353 | Individual fill (preferred §9 shape). Action-direction validation, canonical `computeTradeMetrics` status derivation, risk snapshot on first entry, **but** the same non-fatal sync catch (201 on sync failure), **legacy** equity-at-open, and **no journal-side over-close/quantity guard** (§26 not enforced on the journal path — an over-close leaves a committed journal execution while accounting rejects). No idempotency key on the journal side. | **Replace** |
| P3 | `src/lib/positions/trade-execution-sync.ts` (`syncAndRebuildPositions`) | 264 | Best-effort mirror: `trade_executions` → `accounting_executions` (idempotency-protected) → FIFO rebuild → performance rebuild → financial event. **Non-fatal by design**: "sync failures do NOT throw … so the caller can continue without rolling back the trade execution itself" — exactly the doc's "catch → log → return { error } → user still gets 201" defect. | **Replace** (retire from normal workflow; fold into the canonical service) |
| P4 | `src/lib/accounting/event-posting.ts` (`postEventWithEffect`) | — | M006 canonical **atomic** posting kernel (A7): event + balanced ledger + account projection in ONE transaction with typed failure. **Not used by any trade-execution path.** | **Reuse** — the canonical execution engine (S03) must build on this kernel. |

**Consequence:** journal executions commit independently of accounting/FIFO state.
The doc's central invariant ("must never disagree after a successful operation")
is violated by design today.

---

## 2. Concern-by-concern matrix

| Concern (doc §120) | Current behavior | Class | Notes / binding direction |
|---|---|---|---|
| Trade creation | `POST /api/trades` — validates planned-stop geometry via canonical `computePlannedRiskAmount` (R025, only when both entry+stop supplied; partial combos skip); account resolution via A8 eligible-default chain → first **trading-ready** active USD account (risk params + commission + opening cash) → first active USD fallback; 409 readiness guard; `tradeCode` `T-XXXX` generated with 3-attempt UNIQUE retry; **status hardcoded `'planned'`** at insert (no client-supplied status; schema has no DB default). | **Refine** | Planning eligibility (§11) should be lighter (exists/active/USD); the ready-account fallback conflates planning with execution readiness. Keep the canonical stop-geometry validation. |
| Trade update / status mutation | `PUT /api/trades/[id]` — **no `status` field in the update schema, so PUT cannot mutate status (good)**. Direct vs derived split: the **only direct `trades.status` write in `src/`** is the scratch `DELETE` (`status='deleted'`, planned-only); every open/closed transition is **derived** — both execution routes reload the execution stream and write `metrics.position.status`/`openedAt`/`closedAt` from canonical `computeTradeMetrics`. Guards `plannedStop` only after planned (R019); **planned-trade editing is currently unrestricted** (while planned, every field is editable with no lock/versioning/approval), and post-first-fill `plannedEntry`/`plannedQuantity`/targets/`symbol`/`direction` remain editable — a `direction` edit on an open trade silently rewrites P&L sign derivation. | **Refine** | §23 requires the full pre-trade intent frozen after first fill. Extend the freeze to **all** planning fields (incl. `direction`) once an effective execution exists; the sole direct status write (scratch) stays as-is. |
| Scratch / delete (planned-only soft-delete) | `DELETE /api/trades/[id]` — **soft-delete only; no hard delete exists anywhere**. Guarded to `planned` status (already-scratched → idempotent 400 "Trade is already scratched."; open/closed → 400 naming current status). Writes `status='deleted'` + `updatedAt` stamp (auditable scratch time); row and FK children preserved; `watchlist_items.promotedTradeId` intentionally **not** nullified so the promotion audit trail survives the scratch (D057/R027). List GET excludes deleted unless `?status=deleted` (Deleted tab). | **Current** | Matches R027/D057; keep as-is. |
| Bulk execute | P1 (`/execute`). | **Replace** | Retire from normal UX (§9). May remain as a compatibility adapter only if it delegates to the canonical service (S03). |
| Individual executions | P2 (`/executions`). | **Replace** | Becomes the single execution route over the canonical service (S03). |
| Risk snapshot creation | First-entry upsert inside both execution routes; `PUT /api/trades/[id]/risk-snapshot` allows a **manual upsert with client-supplied `accountEquityAtOpen`**. | **Replace/Refine** | §16: initial snapshot must be created deterministically by the canonical first-entry path and never rewritten by management. The manual PUT surface must go (or be restricted to correction-driven rebuild). |
| Stop adjustments | `POST /api/trades/[id]/stop-adjustments` — M019: server-derived `previousStop`, append-only rows, current stop = latest adjustment else initial stop else planned stop. | **Current** | Matches §31. Reuse. |
| Target adjustments | `POST /api/trades/[id]/target-adjustments` — M019 server-derived `previousTarget`, append-only. | **Current** | Matches §33. Reuse. |
| Account execution posting | M006 atomic event-posting kernel (`postEventWithEffect`) for financial events; **trade executions bypass it** via P3. | **Refine** | S03 must route trade executions through the kernel (P4 reuse). |
| FIFO rebuild | `src/lib/positions/rebuild.ts` (`rebuildPositions`) — canonical, used by sync layer and corrections. | **Reuse** | Deterministic FIFO allocation. S03 embeds it in the execution transaction; rejection must roll back the whole operation (§26/§47). |
| Position rebuild | `account_positions` maintained by `rebuildPositions`; reconciled to FIFO. | **Reuse** | §72 invariant; S08 verifies reconciliation. |
| Execution correction (account-scoped) | `POST /api/accounts/[id]/executions/[executionId]/correct` → `correctExecution` (reversal + replacement + lineage; FIFO + performance rebuild). | **Reuse** | Accounting-only corrections keep this path (§77). |
| Execution correction (trade-scoped) | `POST /api/trades/[id]/executions/[execId]/correct` → **same** `correctExecution`; **never touches the `trades` table** (journal status/openedAt/closedAt/reviewedAt are not rebuilt). | **Replace/Refine** | §41/§44: trade-linked corrections must rebuild journal lifecycle. `correctExecution` must become journal-aware (or the trade route must orchestrate the rebuild) in S06. |
| Trade correction (journal) | No journal-lifecycle rebuild on correction. | **Missing** | S06. |
| Trade metrics | `src/lib/trade-calc.ts` (`computeTradeMetrics`) — canonical, consumed by routes/UI. | **Current** | Reuse (§51). |
| Review / grade / mistakes / assets | Grade + lesson upsert on `trades`; mistakes/assets/assessments routes; **no `reviewedAt` anywhere in `src/`**; review completion is inferred from presence of evidence. | **Missing/Refine** | §64/§65: add explicit `reviewedAt` with a meaningful-evidence contract (lesson non-empty + grade exists). S07. |
| Checklist (`trade_check_results`) | FK to mutable `checklistDefinitions`; **no item-text snapshot**; `/execute` records check results but **never enforces required items**; `/executions` has **no checklist handling at all**. | **Refine** | §20 gate (required items must pass before first fill, enforced on every path) + §21 historical snapshot (item text at entry). S02/S03. |
| `/trades` UI | Workspace list (`src/app/(trades)/trades/page.tsx`): planned/open/closed/deleted filters, scratch (DELETE), export, mtm refresh. | **Reuse** | §56–60 phase tabs largely present; add `Managed` phase indicator + Reviewed tab in S05/S07. |
| Trade detail UI | Legacy `src/app/(legacy)/trades/[id]/page.tsx` mounts **both** `execute-dialog` (bulk → `/execute`) and `add-fill-dialog` (individual → `/executions`). | **Replace/Reuse** | §9: remove the bulk dialog from normal UX; individual-fill composer is the primary path. S02. |
| Root Risk dashboard consumers | `src/app/(legacy)/page.tsx` = WorkstationShell `liveMode`; consumes dashboard API built on canonical libs; M013/S01 already treats unpriced/unavailable risk as `null` (never fabricated 0). | **Reuse** | §54/§32: propagation after refresh already expected; S08 verifies. |
| Legacy equity sources | Both execution routes compute equity-at-open from `accounts.startingBalance` + `accountTransactions` (legacy), NOT the M006 canonical accounting model. | **Replace** | §14/§110: S03 must use canonical Account Workflow state (financial events / projections / rollforwards) with provenance. |
| Idempotency | `accounting_executions` has a unique idempotency key (M006); journal-side execution creation is **not** idempotent; sync derives a key but a retried journal POST duplicates the journal row. | **Missing** | §10: canonical service must accept a client-generated key, reuse on retry, not consume on failed transaction. S03. |
| Backdated fills | Ordering is `executedAt, createdAt` in reads; no full deterministic rebuild on backdate (sync/FIFO rebuild runs, journal status derives from ordered stream — partially OK). | **Refine** | §28: S03/S04 formalize deterministic ordering + rebuild semantics. |
| Action semantics | Direction-action map exists in `/executions` only; no over-close guard on journal path; long/short inversion not explicitly blocked. | **Replace** | §24–27: canonical action rules + quantity guards in S04. |
| Review completion contract | None. | **Missing** | S07 (§64–67). |
| Multi-trade same-symbol | Account FIFO is account/instrument-level; journal attribution not audited. | **Missing** | S06 (§73–74) + S08. |

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

### D3 — Pre-trade checklist gate policy (§20)

- **Current state found:** `/execute` records submitted check results but never
  enforces required items; `/executions` has no checklist handling.
- **Decision:** on the **first opening fill**, all required checklist items
  (per account/setup) must have explicit results and **must pass** before the
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
- **S03** — single canonical execution service built on `postEventWithEffect`
  (P4), embeds FIFO/position/performance rebuilds, idempotency key, legacy
  equity replacement (canonical equity-at-open with provenance), checklist
  gate (D3), max-risk block (D2); retires P1/P2/P3 from normal workflow.
- **S04** — action rules, quantity guards, backdated deterministic ordering.
- **S05** — management actions over the canonical service; stop/target history
  (already Current) wired to live risk propagation.
- **S06** — journal-aware correction (fix the `correctExecution` gap), lifecycle
  rebuild, multi-trade FIFO attribution.
- **S07** — `reviewedAt` + review-evidence contract + correction invalidation.
- **S08** — cross-surface verification against §2 rows; S09 — UAT.

---

## 5. Explicitly deferred (M002 out of scope)

Broker execution, real-time market data, multi-currency, advanced instruments,
tax accounting, analytics redesign, AI coaching (§113–§119). Legacy
`startingBalance`/`accountTransactions` schema may remain for compatibility
but must not be a source of new economic truth (§110).
