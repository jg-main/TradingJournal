# Production Hardening Gate

**Status:** Frozen — M007 Correctness closure audit passed (single-user economic correctness proven; browser-harness-only findings deferred to test infrastructure / Release Readiness)  
**Must complete before:** M003  
**Baseline commit:** `beb434f9e8c36085fc222722c8cd2b332d41a078`  
**Purpose:** Make TradingJournal safe for real single-user operational use in the existing private homelab deployment before resuming feature development.

> This document intentionally does **not** assign a milestone number. Let GSD assign the milestone identifier.

---

## 1. Goal

Close the remaining correctness and production-control gaps that can:

- silently corrupt cash or NAV;
- cause journal and canonical accounting to diverge;
- make reconciliation report false results or hide failures;
- allow obsolete write paths to bypass the canonical ledger;
- allow the application to start against an unsuccessfully migrated database;
- produce false-green test results because test files are not executed;
- leave the exact release SHA red in CI;
- leave recovery unproven.

The target is **operational production readiness**, not product completeness.

The application does **not** need perfect UX, every possible metric, enterprise observability, HA, multi-user support, or a database redesign before this gate closes.

---

## 2. Production Contract

TradingJournal is currently intended to run as:

- a **single-user** application;
- a **single application instance**;
- SQLite in WAL mode;
- Docker in the existing homelab;
- behind Caddy;
- reachable only from the trusted LAN/VPN;
- with persistent application data and backups mounted from the host.

Production readiness for this gate means the application is safe under that deployment contract.

Public internet exposure, multi-user authorization, horizontal scaling, PostgreSQL, HA, and distributed locking are explicitly outside this milestone.

---

## 3. Canonical Accounting Invariant

This milestone must establish one economic-action boundary everywhere.

### Journal/workflow vocabulary

The journal may store and display:

```text
buy
sell
sell_short
buy_to_cover
add
reduce
```

`add` and `reduce` are direction-independent **workflow actions**.

### Canonical accounting vocabulary

Canonical accounting must store only:

```text
buy
sell
sell_short
buy_to_cover
```

### Required resolution

Every accounting-sensitive path must follow:

```text
workflow action
      +
trade direction
      ↓
resolveEconomicExecutionAction(...)
      ↓
concrete economic action
      ↓
cash direction
FIFO
ledger
performance
reconciliation
```

### Hard invariant

> `accounting_executions.action` must never persist `add` or `reduce`.

No accounting implementation may determine economic cash direction directly from a workflow alias with local action lists such as:

```ts
['sell', 'reduce', 'sell_short'].includes(action)
```

The economic action resolver must be the canonical boundary.

---

# 4. Required Workstreams

## A. Fix all economic-action boundary violations

### A1. Execution correction path — CRITICAL

**Affected areas**

- `src/lib/accounting/correction.ts`
- `src/lib/accounting/correction-contracts.ts`
- `src/app/api/accounts/[id]/executions/[executionId]/correct/route.ts`
- `src/app/api/trades/[id]/executions/[execId]/correct/route.ts`
- correction UI action paths

### Current failure

Short corrections can post cash in the wrong direction when the replacement action is `add` or `reduce`.

For a short:

```text
add    -> sell_short    -> cash increase
reduce -> buy_to_cover  -> cash decrease
```

The current correction path can preserve the correct position quantity while posting the wrong cash event.

This creates the dangerous state:

```text
position = correct
cash     = wrong
NAV      = wrong
```

### Required implementation

- Resolve the correction action against trade direction before canonical insertion.
- Store the concrete economic action in `accounting_executions`.
- Derive financial-event cash direction from the concrete action.
- Preserve journal-facing `add` / `reduce` semantics where appropriate.
- Keep correction reversal + replacement atomic.
- Preserve fee correction behavior.
- Ensure reversal logic is also economically concrete.
- Do not duplicate the action-direction mapping locally.

### Required regression coverage

At minimum:

```text
LONG
buy -> correction buy
buy -> correction add
sell -> correction reduce
full close correction

SHORT
sell_short -> correction sell_short
sell_short -> correction add
buy_to_cover -> correction reduce
full close correction
```

For every case assert:

- stored journal action;
- stored canonical accounting action;
- cash direction;
- cash amount;
- FIFO quantity;
- trade status;
- account position;
- ledger balance;
- performance rebuild;
- no mutation on invalid/over-close correction.

---

## B. Fix or retire the legacy accounting migration writer — CRITICAL

**Affected areas**

- `src/lib/accounting/legacy-migration-runner.ts`
- account reconciliation/migration UI
- migration API
- accounting migration CLI

### Current failure

Legacy `trade_executions.action` legitimately contains `add` and `reduce`.

The migration currently copies those aliases into canonical accounting and derives cash direction from the raw action.

This can recreate the exact short cash-direction defect the A5 repair was intended to eliminate.

### Required implementation

For every migrated execution:

1. load trade direction;
2. resolve the journal action to the concrete economic action;
3. persist only the concrete action in `accounting_executions`;
4. derive cash effects only from the concrete action;
5. preserve migration idempotency.

### Operational decision

After production data is verified:

- if legacy migration remains genuinely required, keep it and make it correct;
- if cutover is finished and the surface is no longer needed, retire the writable migration path rather than maintain a permanent legacy writer.

### Required tests

Cover at least:

```text
long buy/add/reduce/sell migration
short sell_short/add/reduce/buy_to_cover migration
migration re-run
existing migrated rows skipped correctly
cash totals
FIFO totals
ledger totals
canonical action invariant
```

---

## C. Fix reconciliation semantics — HIGH / PRODUCTION BLOCKER

**Affected area**

- `src/lib/accounting/reconciliation.ts`

### Current failure

Legacy-side reconciliation interprets `add` and `reduce` without trade direction.

That makes short management actions wrong for:

- execution cash;
- signed position quantity;
- open-position count;
- potentially any downstream comparison based on those values.

A fully closed short can therefore be reported as still open.

### Required implementation

- Include trade direction in all legacy execution reconciliation queries.
- Resolve workflow actions economically before applying cash or quantity signs.
- Centralize the action interpretation; do not create another local mapping.
- Ensure reconciliation correctly handles:
  - long open;
  - long add;
  - long reduce;
  - long full close;
  - short open;
  - short add;
  - short reduce;
  - short full close;
  - migrated executions;
  - corrected executions.

### Required acceptance

A journal/account pair that is economically identical must reconcile regardless of whether journal actions are concrete or expressed as `add` / `reduce`.

A fully closed short must have:

```text
legacy open-position count = 0
canonical open-position count = 0
```

---

## D. Fix account activity economic direction — MEDIUM, BUNDLE WITH A-C

**Affected areas**

- `src/lib/accounting/activity.ts`
- `src/components/accounting/account-activity.tsx`

### Current failure

Activity reconstruction can display:

```text
short add    -> cash decrease
short reduce -> cash increase
```

even when the ledger itself is correct.

### Required implementation

- Reconstruct execution effects using the same canonical economic-action resolver.
- Do not infer economic side from raw `add` / `reduce`.
- Activity running cash must agree with the canonical ledger.

### Required acceptance

For all four economic execution actions:

```text
buy          -> decrease
sell         -> increase
sell_short   -> increase
buy_to_cover -> decrease
```

Journal aliases must first resolve through direction.

---

## E. Establish a cross-cutting accounting invariant test matrix

The previous defects escaped because the main execution writers were fixed while secondary writers/readers retained the old mapping.

Add a cross-cutting test that protects the semantic boundary.

### Matrix

Exercise each public/operational path that can create or reinterpret execution economics:

```text
normal execution
add
reduce
execution correction
legacy migration
reconciliation
activity projection
```

for:

```text
long
short
```

### Assertions

For every applicable path:

```text
journal may contain add/reduce
accounting_executions may NOT contain add/reduce
canonical action is correct
cash direction is correct
FIFO quantity is correct
position direction/quantity is correct
ledger remains balanced
account performance is correct
reconciliation is clean
```

Add a direct invariant test:

```sql
SELECT COUNT(*)
FROM accounting_executions
WHERE action IN ('add', 'reduce');
```

Expected production result:

```text
0
```

---

## F. Audit and repair existing canonical accounting data

Fixing new writes is insufficient if prior affected rows exist.

### Required audit

Inspect the production/restored database for:

```text
accounting_executions.action = add
accounting_executions.action = reduce
```

Also inspect short-trade financial events produced by:

- corrections;
- legacy migration;
- prior known A5 defects.

### Required outcome

- Determine whether production data is affected.
- Reuse or extend the existing cash-direction repair logic where appropriate.
- Repair affected canonical actions/effects deterministically.
- Rebuild downstream:
  - FIFO;
  - positions;
  - account performance;
  - reconciliation.
- Repair operation must be idempotent.
- Produce before/after evidence.

No manual undocumented SQL patch is acceptable as the final remediation.

---

# 5. Remove obsolete monetary write surface

## G. Retire `POST /api/accounts/:id/transactions` — MEDIUM / REQUIRED

**Affected area**

- `src/app/api/accounts/[id]/transactions/route.ts`

### Current problem

The legacy POST:

- writes directly to `account_transactions`;
- bypasses `financial_events`;
- bypasses the canonical ledger;
- has no idempotency key;
- performs read-then-write balance validation outside a transaction;
- accepts JS numeric money;
- can create permanent reconciliation drift.

The current UI already uses the canonical financial-events route.

### Required decision

Preferred:

> Remove/disable the legacy POST handler.

Do **not** spend effort modernizing a superseded monetary writer unless a real consumer is proven.

### Acceptance

- No production UI or internal caller depends on the POST route.
- POST returns a deliberate retired/not-supported response or the handler no longer exists.
- Canonical deposits/withdrawals use only the financial-events surface.
- Regression test proves obsolete writes cannot mutate cash.

GET may remain only if it is still required for legacy read compatibility.

---

# 6. Make reconciliation failure explicit

## H. Stop rendering reconciliation failure as a healthy/null state

**Affected area**

- `src/app/api/accounts/[id]/overview/route.ts`
- review other accounting routes with silent reconciliation catches while touching this code

### Current problem

A reconciliation exception is swallowed with no logging and can appear identical to "nothing to reconcile".

### Required behavior

Expose three semantically distinct states:

```text
clean / available
mismatch
unavailable / error
```

At minimum:

- log the reconciliation exception;
- do not silently represent an exception as a clean/null account;
- preserve account overview availability if reconciliation is intentionally best-effort.

This does **not** require an observability platform.

### Acceptance

A forced reconciliation exception must be visible:

- in server logs;
- in the API response/state consumed by the UI.

---

# 7. Fix the quality gate itself

## I. Exact release SHA must pass CI

Current baseline:

```text
beb434f9e8c36085fc222722c8cd2b332d41a078
```

has a failed GitHub Quality Gate because `npm ci` fails before lint/typecheck/build/tests.

### Required outcome

The final hardening SHA must have a green GitHub Actions run executing:

```text
npm ci
lint
typecheck
build
test-all
Playwright Chromium
Playwright Firefox
Playwright WebKit
```

No skipped downstream stages caused by setup failure.

---

## J. Align CI and production runtime

Current mismatch:

```text
CI      -> Node 20
Docker  -> Node 22
```

### Required outcome

Use one supported Node major across:

- CI;
- local documented production baseline;
- Docker builder;
- Docker runner.

Preferred for current project:

```text
Node 22
```

### Docker dependency installation

Once lockfile/CI installation is healthy, production Docker builds should use deterministic lockfile installation:

```text
npm ci
```

instead of unconstrained:

```text
npm install
```

unless a documented technical reason prevents it.

---

# 8. Fix test ownership and false-green discovery

## K. Every repository test file must belong to a runner

External audit baseline:

- 313 test files found;
- 49 appear in neither current runner;
- 28 of those execute successfully when invoked independently;
- 21 are stale/broken;
- some backup/restore tests are currently unwired;
- some explicit Vitest include entries point to paths that no longer exist.

The exact inventory must be reproduced by implementation rather than blindly trusting the audit count.

### Required work

1. Build a deterministic inventory of test files.
2. Determine the owner/runner for every test file.
3. Wire healthy but omitted tests into the normal quality gate.
4. Repair stale tests that still protect current behavior.
5. Delete/replace tests only when they test a retired contract.
6. Correct stale include paths.
7. Add a guard that fails CI if a test file is not owned by any runner.

### Preferred direction

Avoid permanently maintaining two giant filename allowlists.

Move toward convention-based discovery where technically possible.

If some standalone TSX harnesses genuinely cannot run under Vitest, keep an explicit small exception list and automatically validate that every test is either:

```text
Vitest-discovered
OR
explicitly registered standalone
```

Never neither.

### Acceptance

The test inventory guard reports:

```text
unowned test files = 0
missing registered test paths = 0
```

and CI executes all intended current tests.

---

# 9. Fail closed on database migration failure

## L. Startup migration errors must be fatal — PRODUCTION BLOCKER

**Affected area**

- `src/db/index.ts`

### Current behavior

Migration errors are logged and startup continues.

That permits the application to serve against a schema that may not match the code.

### Required behavior

If any required migration fails:

```text
migration rollback
        ↓
error logged
        ↓
database initialization throws
        ↓
application/container fails startup
```

The app must not continue to seed data or serve requests after a failed required migration.

### Requirements

- Keep per-migration transaction safety.
- Make migration failure fatal.
- Test a deliberately failing migration/startup condition.
- Docker health must remain unhealthy because the application never becomes ready.
- Successful migrations remain idempotent.

---

# 10. Operational recovery gate

## M. Perform a real backup → restore drill

The backup/restore implementation is substantial, but production readiness requires recovery evidence, not only implementation.

### Required drill

Using realistic data:

1. create a production-format backup;
2. copy it outside the live data location;
3. restore it into a disposable instance/database;
4. start the application against the restored state;
5. verify:
   - accounts;
   - journal trades;
   - executions;
   - long positions;
   - short positions;
   - add/reduce history;
   - corrected executions;
   - cash;
   - NAV/account performance;
   - FIFO positions;
   - screenshots/uploads;
   - settings required for normal operation;
   - reconciliation;
6. record the result.

### Storage requirement

At least one recoverable backup copy must not depend exclusively on the same underlying live storage as the database.

The milestone does not mandate a specific cloud/provider. It requires an actual independent recovery copy.

---

# 11. Deployment boundary confirmation

## N. Keep current deployment private

The application has destructive and monetary APIs and does not currently implement application-level authentication.

For this milestone that is acceptable **only** under the existing single-user trusted-network contract.

### Required confirmation

Document and verify:

- no direct public port for TradingJournal;
- Caddy remains the only ingress;
- `journal.homelab` is reachable only from trusted LAN/VPN;
- no public DNS/port-forward path exposes it to the internet.

If public access is introduced, authentication becomes a separate production blocker.

Do not build a full auth subsystem in this milestone unless the deployment boundary cannot be guaranteed.

---

# 12. Deferred Findings / Explicit Non-Goals

These findings are valid but do **not** block the operational production target for this milestone unless implementation discovers a stronger dependency.

## Deferred D6 — Dead fail-open mirror module

`src/lib/positions/trade-execution-sync.ts` has no current production callers.

Action:

- update misleading comments/documentation;
- optionally deprecate/remove the export if cheap;
- do not let this expand the milestone.

The live execution engine already fails closed.

---

## Deferred D8 — User timezone vs UTC period bucketing

Known accuracy issue:

- calendar heatmap;
- weekly review periods;
- period matrix;
- other day/week analytics may bucket by UTC rather than `app_profile.timezone`.

This can shift evening trades into the next day/week for users west of UTC.

It does **not** corrupt:

- executions;
- canonical cash;
- ledger;
- positions;
- NAV.

Track for a later analytics/calendar correctness milestone unless touched directly by this work.

---

## Deferred structural risk — two P&L engines on one workstation row

The workstation currently combines values from journal-derived V1 and ledger-derived V2 projections.

This is not independently proven as a defect.

Recommended future protection:

- add a cross-system comparison/invariant;
- continue convergence toward one authoritative accounting projection.

Do not redesign the dashboard architecture in this milestone.

---

## Deferred secret hardening — AI provider API key at rest

Schwab OAuth tokens already use AES-256-GCM encryption.

AI settings currently strip API keys from GET responses but may store provider keys plaintext in SQLite.

For the current private single-user deployment, this is hardening rather than a release blocker.

Future work may reuse the existing token-encryption utility for AI provider credentials.

---

## Explicitly out of scope

Do not add:

- new trading metrics;
- new dashboard widgets;
- UX redesign;
- broad styling cleanup;
- new AI features;
- performance optimization without demonstrated production failure;
- PostgreSQL;
- Redis;
- queues;
- distributed locks;
- HA;
- horizontal scaling;
- multi-user RBAC;
- public SaaS deployment;
- M003 functionality.

---

# 13. Required Test Plan

The milestone is not complete with unit patches alone.

## Accounting regression matrix

### Long

```text
buy
add
reduce
sell
full close
over-close rejection
correction
migration
reload
```

### Short

```text
sell_short
add
reduce
buy_to_cover
full close
over-close rejection
correction
migration
reload
```

For both directions verify:

```text
journal action
canonical economic action
accounting_executions action
cash consideration
fee cash
FIFO quantity
realized P&L
position quantity
position direction
trade status
workflow phase
account performance
reconciliation
```

---

## Cross-path consistency

For equivalent economic events created through different allowed paths:

```text
normal execution
correction replacement
legacy migration
```

the final canonical accounting result must be equivalent.

---

## Accounting invariant

Automated test:

```text
accounting_executions action ∈
{buy, sell, sell_short, buy_to_cover}
```

Never:

```text
add
reduce
```

---

## Obsolete route test

Prove the retired `/transactions` POST cannot mutate monetary state.

---

## Migration fail-closed test

Force migration failure and prove:

```text
startup fails
application does not become healthy
no post-failure seeding/request serving occurs
```

---

## Backup/restore regression

Ensure all current backup/restore tests are actually owned by a runner and executed by CI.

---

## Browser acceptance

At minimum Chromium real UI + server + DB proof for:

### Long

```text
open
add
reduce
close
reload
```

### Short

```text
open
add
reduce
close
reload
```

### Correction

At least one long and one short correction through the real UI.

Verify canonical API/DB state after browser actions.

---

# 14. Sequencing

Recommended implementation order:

```text
1. Reproduce and lock D1 regression
2. Centralize/fix economic-action use in correction
3. Fix legacy migration
4. Fix reconciliation
5. Fix activity projection
6. Add cross-cutting invariant matrix
7. Audit/repair existing canonical data
8. Retire legacy transactions POST
9. Make reconciliation errors explicit
10. Make DB migrations fail closed
11. Repair test discovery/ownership
12. Align Node/runtime + fix npm ci
13. Full local gate
14. Full GitHub CI gate
15. Backup/restore drill
16. Production deployment smoke test
17. Freeze final SHA
```

Do not interleave M003 feature development.

---

# 15. Exit Criteria

This milestone may be marked complete only when **all** of the following are true.

## Accounting

- [ ] Short `add` posts economically as `sell_short`.
- [ ] Short `reduce` posts economically as `buy_to_cover`.
- [ ] Execution correction uses concrete economic actions.
- [ ] Legacy migration uses concrete economic actions or is retired.
- [ ] Reconciliation resolves journal aliases using trade direction.
- [ ] Activity display resolves journal aliases using trade direction.
- [ ] `accounting_executions` contains no `add` / `reduce`.
- [ ] Existing affected data has been audited.
- [ ] Any affected data has been repaired and downstream projections rebuilt.
- [ ] Long accounting regression matrix is green.
- [ ] Short accounting regression matrix is green.
- [ ] Cross-system integrity/reconciliation tests are green.

## Monetary write surfaces

- [ ] Legacy `/api/accounts/:id/transactions` POST is retired/disabled or proven necessary and converted to the canonical ledger architecture.
- [ ] No known production monetary writer bypasses the canonical financial-event/ledger boundary.

## Startup safety

- [ ] Required database migration failure is fatal.
- [ ] App does not become healthy after migration failure.
- [ ] Successful migration remains idempotent.

## Tests / CI

- [ ] Test inventory reproduced.
- [ ] Every active test file belongs to a runner.
- [ ] Unowned test count = 0.
- [ ] Missing registered test paths = 0.
- [ ] Healthy previously unwired tests are executed normally.
- [ ] Stale tests are repaired or intentionally retired with rationale.
- [ ] CI and Docker use the same Node major.
- [ ] Production dependency installation is deterministic.
- [ ] Exact final SHA passes `npm ci`.
- [ ] Exact final SHA passes lint.
- [ ] Exact final SHA passes typecheck.
- [ ] Exact final SHA passes production build.
- [ ] Exact final SHA passes complete test-all.
- [ ] Exact final SHA passes Playwright Chromium.
- [ ] Exact final SHA passes Playwright Firefox.
- [ ] Exact final SHA passes Playwright WebKit.
- [ ] GitHub Quality Gate is green.

## Recovery / deployment

- [ ] Real backup created successfully.
- [ ] Backup copied to independent storage/location.
- [ ] Disposable restore completed successfully.
- [ ] Restored trades/accounts/cash/positions/reconciliation verified.
- [ ] Uploads/screenshots verified after restore.
- [ ] Production homelab deployment starts healthy from final SHA.
- [ ] TradingJournal remains private LAN/VPN-only.
- [ ] No public ingress to destructive APIs.

---

# 16. Evidence Required at Close

GSD closeout should record:

```text
final commit SHA
GitHub Actions run URL / run number
Node version used in CI and Docker
test file inventory count
executed Vitest file/test count
executed standalone test count
Playwright results by browser
accounting invariant query result
before/after repair counts, if any
reconciliation result
backup filename/timestamp
restore target
restore verification result
Docker health result
working tree status
```

Also include explicit proof for a short lifecycle:

```text
sell_short
→ add
→ reduce
→ correction
→ full close
```

showing:

```text
journal actions
canonical accounting actions
cash
FIFO
position
performance
reconciliation
```

---

# 17. Definition of Done

The milestone is done when:

> TradingJournal can be used with real single-user journal/account data in the private homelab without any known path that silently corrupts canonical accounting, without obsolete writers bypassing the ledger, with fail-closed schema startup, with an authoritative green quality gate, and with a successfully demonstrated recovery procedure.

Only after that checkpoint should M003 begin.
