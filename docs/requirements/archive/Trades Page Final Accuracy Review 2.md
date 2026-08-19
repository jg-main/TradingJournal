# Trades Page Final Accuracy Review

## Post-Completion and Production-Readiness Audit

**Repository:** `jg-main/TradingJournal`
**Audited head:** `5f5051386279e11d7de2897d8bb8a94129b77354`
**Milestone:** M012 — Trades Page Final Accuracy Remediation
**Audit date:** August 1, 2026

## Executive verdict

| Assessment                                      | Status                                                        |
| ----------------------------------------------- | ------------------------------------------------------------- |
| M012 stated remediation requirements            | **Complete**                                                  |
| Core trade calculations                         | **Approved**                                                  |
| Footer presentation                             | **Approved**                                                  |
| Stop lifecycle integrity                        | **Approved**                                                  |
| Direction-aware planned-risk display and totals | **Approved**                                                  |
| Signed stop/trigger distances                   | **Approved**                                                  |
| Production release evidence                     | **Not independently verified**                                |
| Overall production readiness                    | **Conditional — one financial display issue should be fixed** |

The development team correctly implemented the six remediation items from the previous audit. The latest source is materially better and the original Trades Page findings can be considered resolved.

However, I would **not yet give an unconditional production sign-off** because the restored aggregate Unrealized P&L can display a partial value as though it were complete when an open position lacks a market mark.

---

# 1. Requirement-completion review

## R019 — Historical Planned Stop immutability

**Status: Passed**

The backend now permits `plannedStop` changes only while a trade remains Planned. Open, Closed and Deleted trades reject changes, including attempts to clear the value with `null`.

The Edit Trade dialog mirrors that rule:

* Planned: editable `Stop Loss`
* Open: read-only `Original Planned Stop`
* Closed: read-only `Original Planned Stop`
* Deleted: read-only `Original Planned Stop`

The client also omits `plannedStop` from the PUT payload for all non-Planned trades.

Focused component and API tests cover Open, Closed and Deleted states.

**Decision:** Approved.

---

## R020 — Stop adjustments restricted to Open trades

**Status: Passed**

`POST /api/trades/:id/stop-adjustments` now returns `409` unless the trade status is Open. Planned, Closed and Deleted trades cannot receive new adjustment records.

Tests assert:

* Planned → rejected, no database mutation
* Closed → rejected, no database mutation
* Deleted → rejected, no database mutation
* Open → accepted

**Decision:** Approved.

### Test-quality caveat

This particular route suite reproduces the route logic in a local `doPostStopAdjustment()` function rather than invoking the actual Next.js handler.

The source implementation is correct, but a regression could theoretically affect the real handler without breaking the mirror test. A direct route-handler test should eventually replace or supplement this simulated test.

---

## R021 — Direction-aware Planned Risk

**Status: Passed for calculation and display**

The shared helper now enforces:

```text
Long:  entry > stop
Short: stop > entry
```

Invalid stop placement returns `null` instead of being converted into a misleading positive risk through `Math.abs`.

The API uses the helper for:

* Planned Risk to Account

* Planned aggregate risk

The Planned Risk table column delegates to the same helper.

The helper has coverage for Long, Short, wrong-side stops, equal prices, null values, zero values, negative quantities and decimal inputs.

**Decision:** Calculation requirement approved.

### Remaining validation weakness

An invalid trade can still be saved.

The Plan Trade form suppresses the invalid risk preview but does not block submission. It still sends the entry and wrong-side stop to `/api/trades`.

The API creation schema only validates the fields as numbers; it does not validate positivity or the relationship between direction, entry and stop.

Recommended rule:

```text
When both Planned Entry and Planned Stop are supplied:

Long stop >= entry  → reject
Short stop <= entry → reject
```

This is a **P1 data-quality hardening item**, not a failure of the M012 displayed-risk requirement.

---

## R022 — Open Positions Total

**Status: Passed**

The Open footer now correctly displays:

```text
OPEN POSITIONS TOTAL

Unrealized P&L
Portfolio Heat $
Portfolio Heat %
Open Positions
```

It no longer displays the duplicate By Currency section.

Component tests verify:

* Net Unrealized P&L
* Portfolio Heat amount
* Decimal-fraction percentage formatting
* Open-position count
* Absence of By Currency and USD labels

**Decision:** UI requirement approved.

---

## R023 — Closed Trades Total

**Status: Passed**

The Closed footer now contains one section:

```text
CLOSED TRADES TOTAL

Gross P&L
Fees
Net P&L
Trades
```

The visible By Currency breakdown has been removed.

The component test explicitly asserts that `By Currency`, `USD` and `EUR` are absent.

**Decision:** UI requirement approved.

### Internal cleanup remains

Although no longer rendered, the API continues calculating `totalsByCurrency`, and the page still stores and passes that response data.

That is not a visible defect or production blocker, but it is unnecessary complexity for a USD-only application. Remove it in a cleanup task unless multi-currency support is planned.

---

## R024 — Signed distance semantics

**Status: Passed**

Distance to Stop now uses:

```text
Long:  (market − stop) ÷ market
Short: (stop − market) ÷ market
```

Distance to Trigger now uses positive as distance remaining:

```text
Long:  (trigger − market) ÷ trigger
Short: (market − trigger) ÷ trigger
```

The result is:

* Positive when the level has not been reached
* Zero at the level
* Negative after the level has been crossed

The table passes trade direction into both helpers, and the tests cover Long, Short, crossed levels, zero guards, null values and the percentage display contract.

**Decision:** Approved.

---

# 2. Newly identified production issue

## P0 — Aggregate Unrealized P&L treats missing marks as zero

Individual trades correctly return `null` Unrealized P&L when no market mark is available. The cross-surface suite verifies that row and detail behavior.

However, the aggregate route currently converts every missing unrealized value to zero:

```ts
const gUP = new Decimal(
  metrics.unrealizedPnl.grossUnrealizedPnl ?? 0
);

const nUP = new Decimal(
  metrics.unrealizedPnl.netUnrealizedPnl ?? 0
);
```

This produces a misleading footer.

### Example

```text
Position A: +$500 unrealized
Position B: no market price
```

Current footer:

```text
Unrealized P&L: $500.00
```

That looks complete, but it is only the known portion.

If every position lacks a mark, the footer displays `$0.00`, even though the correct state is unknown.

### Required correction

Return aggregate completeness metadata:

```ts
interface TradeTotals {
  netUnrealizedPnl: number | null;
  grossUnrealizedPnl: number | null;
  unpricedOpenPositions: number;
}
```

Recommended behavior:

| State                       | Footer                               |
| --------------------------- | ------------------------------------ |
| All open positions priced   | `$500.00`                            |
| Some positions unpriced     | `$500.00 partial — 1 awaiting price` |
| All open positions unpriced | `— Awaiting market prices`           |

At minimum, set aggregate Unrealized P&L to `null` when any included open position lacks a mark.

### Acceptance tests

```text
One priced + one unpriced:
- unpricedOpenPositions = 1
- footer does not present $500 as a complete aggregate

All unpriced:
- netUnrealizedPnl = null
- footer displays Awaiting market prices

All priced:
- numeric aggregate displays normally
```

**Release significance:** This should be corrected before claiming full financial-display accuracy.

---

# 3. GSD model and escalation assessment

The supplied GSD profile uses appropriate model-family separation:

| Role             | Model             |
| ---------------- | ----------------- |
| Research         | Qwen 3.7 Plus     |
| Planning         | Qwen 3.7 Plus     |
| Execution        | DeepSeek V4 Flash |
| Completion       | MiniMax M3        |
| UAT              | GLM-5             |
| Heavy escalation | Kimi K2.7 Code    |

It also enables cross-provider failure escalation and requires lint, type checking and the full test orchestrator.

This is materially better than the previous arrangement because execution, completion and UAT no longer use the same model family.

## Routing configuration discrepancy

The YAML currently contains:

```yaml
capability_routing: false
```

while its documentation says capability-based routing is enabled.

Therefore Kimi is available for failure escalation, but the profile does **not** currently guarantee automatic escalation merely because a task is classified as high-risk.

Set:

```yaml
capability_routing: true
```

only when the intended behavior is automatic model selection based on task complexity or domain risk.

## Model-use verification limitation

Git commits include GSD milestone, slice and task metadata, but do not record the model used by each phase. GSD working files are also excluded from Git.

Consequently:

* The configured routing policy is known.
* The resulting implementation can be inspected.
* The exact model selected for each M012 phase cannot be independently verified from the repository.

That does not affect code correctness, but it limits orchestration auditing.

---

# 4. Production quality-gate evidence

The repository’s authoritative quality gate is:

```bash
make lint
make typecheck
make build
make test-all
```

User-facing changes additionally require targeted Playwright or browser verification with realistic data.

The GSD profile similarly requires lint, type checking, full tests and browser evidence before user-facing completion.

The test orchestrator includes the new planned-risk and stop-adjustment suites, as well as the real cross-surface integration suite.

However, at the audited head:

* GitHub reports no associated CI status checks.
* GitHub reports no associated workflow runs.
* No production-build artifact is present.
* No browser screenshot, Playwright report or final UAT evidence is committed.
* The latest commit is an implementation/test task, not a repository-visible release-gate result.

Generated GSD and test artifacts are intentionally ignored, so their absence from Git is understandable. Nevertheless, production readiness cannot be independently proven solely from the pushed repository.

---

# 5. Final status matrix

| Area                                | Status                         |
| ----------------------------------- | ------------------------------ |
| FIFO matching                       | Approved                       |
| Realized P&L and fees               | Approved                       |
| Trade-level Unrealized P&L          | Approved                       |
| Open Risk                           | Approved                       |
| Risk to Account                     | Approved                       |
| Portfolio Heat amount               | Approved                       |
| Portfolio Heat percentage           | Approved                       |
| NAV pagination independence         | Approved                       |
| Stop chronology                     | Approved                       |
| Stop lifecycle protections          | Approved                       |
| Historical Planned Stop integrity   | Approved                       |
| Planned Risk direction semantics    | Approved                       |
| Signed stop/trigger distances       | Approved                       |
| Open footer                         | Approved                       |
| Closed footer                       | Approved                       |
| Aggregate missing-mark handling     | **Needs correction**           |
| Planned-trade submission validation | **Recommended hardening**      |
| Lint/type/build/full-test evidence  | **Not independently verified** |
| Browser/Playwright evidence         | **Not independently verified** |
| GitHub CI protection                | **Absent or not reported**     |

# Release decision

## Requirement completion

**M012 may be marked functionally complete.**

All six remediation requirements from the prior Trades Page audit are implemented in the latest code.

## Production readiness

**Conditional approval only.**

Before final production sign-off:

1. Correct aggregate Unrealized P&L when one or more open positions lack a market mark.
2. Run and retain evidence for:

```bash
make lint
make typecheck
make build
make test-all
make playwright
```

3. Perform browser verification of:

   * Open Positions Total
   * Closed Trades Total
   * Planned/Open/Closed stop behavior
   * Long and Short invalid stop placement
   * Crossed stop and trigger percentages
   * One open position without a current market price

4. Recommended: reject wrong-side Planned Stops at both the form and API boundaries.

5. Recommended: remove the unused currency-total API and frontend state while the application remains USD-only.

**Current grade: B+ / release candidate.**

With aggregate missing-mark handling corrected and the mechanical release gate documented as passing, the Trades Page can receive full production approval.
