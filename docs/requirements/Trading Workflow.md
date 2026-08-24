# Milestone — Trading Workflow

## Plan → Execute → Manage → Close → Review

Base repository state:

    13e73a63f59859846bcdda9f1a8a4687221852c0

The M006 Account Workflow milestone and its A1–A8 + H1 post-milestone
corrections are CLOSED and FROZEN.

Do not reopen Account Workflow unless a Trading Workflow change exposes a
direct regression that cannot be fixed at the trading boundary.

---

# 1. Milestone Objective

Turn TradingJournal's existing trade, execution, position, risk, and review
features into one coherent trading lifecycle:

    PLAN
      ↓
    EXECUTE
      ↓
    OPEN
      ↓
    MANAGE
      ↓
    CLOSE
      ↓
    REVIEW

The product must behave as a trading workstation rather than a collection of
loosely connected CRUD endpoints.

The central product invariant is:

> A trade's journal state, immutable executions, accounting ledger, FIFO
> position, account NAV, risk state, and review state must never disagree
> after a successful user operation.

TradingJournal remains:

    local-first
    single-user
    deterministic
    self-hosted
    journal/workstation

It does NOT become:

    a broker order-entry system
    an algo execution engine
    a portfolio OMS
    a Bloomberg replacement
    a generic BI platform

---

# 2. Product Lifecycle

The user-facing workflow is:

    Planned
        ↓ first fill
    Open
        ↓ management activity
    Managed
        ↓ final closing fill
    Closed
        ↓ explicit review completion
    Reviewed

Important distinction:

## Economic position status

Keep the existing canonical economic status concept:

    planned
    open
    closed
    deleted

This status must continue to be derived from the effective execution stream.

Do NOT store `managed` as an alternative financial position status.

## Workflow phase

Expose a derived workflow phase:

    planned
    open
    managed
    closed
    reviewed

Recommended semantics:

    planned
        status = planned

    open
        status = open
        and no meaningful management activity yet

    managed
        status = open
        and trade has management activity

    closed
        status = closed
        and reviewedAt = null

    reviewed
        status = closed
        and reviewedAt != null

Management activity may include:

    add / scale execution
    partial reduction
    stop adjustment
    target adjustment

Review completion should be explicitly persisted.

Add a minimal durable marker such as:

    reviewedAt

rather than inferring review completion merely from the presence of a note or
grade.

---

# 3. Core Domain Principle

A trade is the journal/workflow container.

An execution is an immutable economic fact.

Accounting/FIFO state is derived from the immutable effective execution
stream.

Therefore:

    trade status
    open quantity
    average entry
    realized P&L
    unrealized P&L
    fees
    FIFO lots
    account position
    account NAV
    risk

must ultimately reconcile to the same execution history.

Do not allow parallel economic truths.

---

# 4. Current Architecture Problem to Eliminate

The current architecture contains:

    trade_executions
        ↓ best-effort mirror
    accounting_executions
        ↓
    financial event
        ↓
    ledger
        ↓
    FIFO rebuild
        ↓
    account performance

and the sync can fail without failing the original trade execution request.

This is no longer acceptable.

After this milestone:

> No successful trade execution request may leave a journal execution without
> its corresponding canonical accounting/FIFO/account state.

Remove the concept of:

    execution committed
    accounting sync failed but request still succeeds

from the product workflow.

---

# 5. Canonical Execution Mutation Boundary

Create one authoritative domain service for recording a trade-linked
execution.

Conceptually:

    recordTradeExecution(...)

or an equivalent repository-appropriate name.

It should own the entire mutation.

For a successful execution:

    validate trade/account
    validate lifecycle/action/quantity
    validate first-entry checklist when applicable
    create journal-linked execution
    create/link canonical accounting execution
    create trade_execution financial event
    create balanced ledger posting
    rebuild FIFO lots/matches
    rebuild account position
    derive trade economic status/timestamps
    create initial risk snapshot when applicable
    rebuild account performance
    return coherent result

These operations must form one authoritative transaction wherever technically
possible.

If any required component fails:

    rollback

Do not return success with partial state.

---

# 6. Canonical Execution Linkage

The repository currently has both:

    trade_executions

and:

    accounting_executions

Do NOT blindly delete either table during this milestone.

First audit all consumers.

Then establish one explicit authoritative relationship.

Acceptable designs include:

    trade execution row
        ↔ stable accounting execution ID

or:

    stable shared idempotency/linkage identity

or another deterministic one-to-one mapping.

Required invariant:

> For every effective journal trade fill there is exactly one corresponding
> canonical accounting execution.

The relation must be queryable and testable.

Do not depend indefinitely on a best-effort post-commit mirror.

---

# 7. Existing Sync Layer

Audit:

    src/lib/positions/trade-execution-sync.ts

The current non-fatal semantics must not remain in normal user execution
workflows.

Options:

1. retire it in favor of the new canonical service; or
2. refactor it into a strict internal helper that throws and participates in
   the caller's authoritative transaction.

Do not leave:

    catch → log → return { error } → user still gets 201

for financially meaningful execution posting.

---

# 8. Existing Execution Endpoints

Audit both:

    POST /api/trades/:id/execute

and:

    POST /api/trades/:id/executions

They currently duplicate substantial business logic.

After the milestone there must be ONE business/domain implementation.

Preferred product API:

    POST /api/trades/:id/executions

for individual fills.

The UI should record fills individually.

The existing `/execute` endpoint may:

    be removed if unused

or:

    remain temporarily as a compatibility adapter

but if retained it must delegate to the same canonical execution service.

It must NOT own independent logic for:

    risk
    status
    accounting
    FIFO
    performance
    checklist

Do not maintain two execution engines.

---

# 9. Remove Bulk Entry+Exit Semantics From Normal UX

The current `/execute` flow can record:

    entry
    optional exit 1
    optional exit 2

in one request.

That is not the preferred workstation workflow.

Normal UX should instead record actual fills as they happen:

    Record Entry
    Add
    Reduce
    Close

Each fill is an immutable execution.

Do not model anticipated exits as already executed trades.

Planned targets remain planning/management data, not executions.

---

# 10. Execution Idempotency

Execution creation must be replay-safe.

Every user-originated execution mutation must support an idempotency identity.

The UI should generate the key once when the user initiates submission and
reuse that same key if the request is retried.

Required:

    first request succeeds
        → one execution

    network retry with same key
        → no duplicate execution

    failed atomic transaction
        → key not consumed

    retry after failure with same key
        → succeeds once

Do not generate a new idempotency key automatically on every HTTP retry.

---

# 11. Account Eligibility for Planning

Separate:

    planning eligibility

from:

    execution readiness

A user should be able to create a planned trade for an account that:

    exists
    is active
    uses supported currency

Current supported currency:

    USD

Do not require the account to have every trading parameter populated merely
to save an idea/plan.

If risk information is unavailable:

    planned-risk metrics should show unavailable

rather than preventing all journaling.

---

# 12. Account Readiness for Execution

Actual execution is stricter.

Before the first economic fill, verify:

    account exists
    account active
    supported currency
    effective risk configuration resolvable when required
    effective commission configuration resolvable
    account equity available for risk calculation
    trade lifecycle permits execution

Do not check readiness by merely asking whether an:

    opening_balance
    or deposit

event exists.

Use canonical current financial state.

For example:

    account with opening balance 10,000
    then withdrawal 10,000

is not economically equivalent to a funded $10,000 account.

---

# 13. Effective Account Defaults

Use the existing account/global default resolution semantics.

Do NOT require:

    account.maxRiskPerTradePct != null
    account.defaultCommission != null

when valid global defaults are inherited.

Use the established:

    account override
        ↓
    global default
        ↓
    unavailable

cascade.

Do not create a second readiness implementation.

---

# 14. Canonical Equity-at-Open

The current execution routes still calculate risk snapshot equity from legacy:

    accounts.startingBalance
    accountTransactions

That must be removed.

No new Trading Workflow calculation may depend on those legacy sources.

Create/reuse a canonical helper for:

    accountEquityAtOpen

using current accounting/trade sources.

The result must be deterministic for the execution timestamp.

Use available canonical sources such as:

    immutable financial events
    account projections / rollforwards
    prior realized trade P&L
    available mark/equity snapshots

Do not silently fabricate historical marked equity when the data does not
exist.

If exact historical equity is unavailable:

    return a clearly-defined fallback/source

or:

    null

rather than false precision.

---

# 15. Equity-at-Open Provenance

Risk snapshots are important historical evidence.

If practical without excessive schema churn, record the source/provenance of
the equity value used at entry.

Conceptually:

    accountEquityAtOpen
    accountEquitySource
    accountEquityAsOf

Examples of source semantics:

    canonical_projection
    rollforward
    reconstructed_cash_realized
    unavailable

Do not store a misleading number without knowing where it came from.

---

# 16. Initial Risk Snapshot

The first effective opening fill creates the initial trade risk snapshot.

The snapshot must capture the actual initial state:

    actual initial entry price
    actual initial quantity
    initial stop
    risk per share
    initial risk amount
    account equity at open
    account risk %

Use the existing canonical risk library.

Do not duplicate formulas in API routes or React components.

The initial risk snapshot must NOT be rewritten merely because the trader later:

    adds
    reduces
    changes stop
    changes target

It represents initial trade risk.

Execution correction of the first entry is different and may require the
snapshot to be deterministically rebuilt from corrected facts.

---

# 17. Initial Stop

First execution should have a usable initial stop.

Prefer:

    explicit actual stop in the entry flow

with fallback to:

    plannedStop

when appropriate.

For risk-controlled execution:

    long initial stop < entry price
    short initial stop > entry price

Invalid stop geometry should be rejected with an actionable message.

Do not silently calculate zero risk.

If no valid stop is available:

    risk metrics = unavailable

and follow the explicit execution policy established during S01.

Do not silently treat missing risk as $0.

---

# 18. Planned Risk Preview

Before execution, the trade plan should expose existing deterministic risk
metrics when sufficient inputs exist.

Examples:

    planned entry
    planned stop
    planned quantity
    planned risk $
    planned risk %
    planned reward/risk
    effective max-risk limit

Reuse:

    position-sizing
    planned-risk
    risk-snapshot
    trade-metrics

where applicable.

Do not create another position-sizing formula inside the page.

This is a decision-support calculation.

TradingJournal still does NOT place orders.

---

# 19. Risk Limit UX

When the proposed initial trade risk exceeds the effective configured max-risk
threshold:

surface it prominently before execution.

Do not hide it in secondary text.

If the product currently treats max risk as a hard rule, block execution.

If an override capability already exists or is deliberately introduced, it
must require:

    explicit acknowledgement
    reason

and preserve that reason as journal evidence.

Do not create a silent override.

Determine the exact current policy during S01 and document it before coding.

---

# 20. Pre-Trade Checklist

The first opening fill is the execution gate.

If the account/setup has required checklist items:

    all required items must have explicit results

and according to current policy:

    must pass before first execution

No alternate endpoint may bypass this gate.

This currently needs special attention because duplicate execution routes have
different logic.

After the first fill:

    management executions

must not rerun the pre-trade checklist.

---

# 21. Checklist Historical Integrity

Checklist definitions may later be:

    edited
    reordered
    disabled
    deleted

A historical trade must still show what the trader actually checked at entry.

Audit current `tradeCheckResults`.

If they rely entirely on mutable checklist-definition text, persist enough
snapshot information to keep historical results intelligible.

Conceptually preserve:

    checklist item text at entry
    pass/fail
    comment
    checkedAt

Do not rewrite historical check evidence when the template changes.

---

# 22. Planned Trade Editing

While:

    trade.status = planned
    and no effective execution exists

allow editing planning fields:

    account
    setup
    symbol where safe
    direction
    thesis
    invalidation
    planned entry
    planned stop
    planned targets
    planned quantity
    market context
    pre-trade plan

Once the first execution is posted:

freeze the original pre-trade decision context.

Do not let later management silently rewrite:

    the original plan

to make the journal look better in hindsight.

---

# 23. Post-Entry Plan Integrity

After first fill:

planning fields that represent pre-trade intent should become read-only.

Management changes must use their actual history structures:

    stop adjustments
    target adjustments
    executions
    management notes/assets

Do not modify `plannedStop` each time the stop moves.

Do not modify `plannedTarget` each time the target moves.

The difference between:

    plan
    and actual management

is analytically valuable.

---

# 24. Action Semantics — Long Trades

For a long trade:

Opening:

    Buy

Scaling:

    Add

Reduction:

    Reduce

Final closing fill:

    Sell / Close

The UI may use trader-friendly labels.

The domain must prevent an execution sequence from accidentally crossing
through zero into a short position.

A long trade is never transformed into a short trade by over-selling.

---

# 25. Action Semantics — Short Trades

For a short trade:

Opening / scaling:

    Sell Short

Reduction / closing:

    Buy to Cover

The domain must prevent an execution from crossing through zero into a long
position.

Do not infer a new opposite-direction trade from an excessive closing fill.

Reject it.

---

# 26. Quantity Invariants

At every execution:

    quantity > 0

Closing/reducing quantity must satisfy:

    quantity <= current open quantity

For:

    quantity < open quantity
        → partial reduction

For:

    quantity = open quantity
        → full close

For:

    quantity > open quantity
        → reject

Do not allow negative positions through malformed journal fills.

FIFO rejection must roll back the entire operation.

---

# 27. First Fill

The first valid opening execution transitions:

    planned
        ↓
    open

Persist:

    openedAt

from the actual first effective opening execution timestamp.

Do not use:

    request-processing time

when the user supplies a valid execution timestamp.

---

# 28. Backdated Execution Ordering

Backdated fills are supported.

Canonical ordering must be deterministic.

At minimum use:

    executedAt
    then stable tie-breaker

such as:

    createdAt
    id / sequence

A backdated fill must rebuild:

    FIFO
    trade status
    open/close timestamps
    account performance

correctly.

No state should depend on insertion order alone.

---

# 29. Open Trade Management

When a trade is open, primary actions should be contextual:

    Add
    Reduce
    Close
    Adjust Stop
    Adjust Target
    Update Mark / refresh market price where currently supported

Do not expose a generic arbitrary CRUD form as the primary workflow.

The user should immediately understand:

    what position exists
    what risk exists
    what actions are valid

---

# 30. Management Phase

A user-facing trade may display:

    Managed

while economic status remains:

    open

when meaningful management activity exists.

Management activity may include:

    scale-in/add
    partial exit
    stop change
    target change

This phase can be derived.

Do not add a stored economic `managed` status unless a clear architectural
reason emerges during S01.

---

# 31. Stop Adjustments

Stop changes must remain historical.

Each adjustment records:

    adjustedAt
    previous stop
    new stop
    reason
    rule-based flag
    notes

Current stop is derived from:

    latest valid adjustment

falling back to:

    initial stop

Do not overwrite the initial risk snapshot.

---

# 32. Stop/Risk Propagation

After a stop adjustment:

    open risk $
    open risk %
    portfolio heat
    trade detail
    Risk & Positions dashboard

must observe the new current stop after normal refresh.

If no valid stop exists:

    open risk = unavailable

not:

    0

Do not present unknown risk as zero risk.

---

# 33. Target Adjustments

Target adjustments remain append-only management history.

Record:

    target index
    previous target
    new target
    reason
    rule-based flag
    notes
    adjustedAt

Do not rewrite the original planned target.

Target adjustments do not themselves represent fills.

---

# 34. Partial Exit

A partial exit is an execution.

Example:

    long 100 shares
    sell/reduce 40

Result:

    open quantity = 60
    trade remains open
    realized P&L exists on 40
    unrealized P&L remains on 60
    current open risk recalculates on 60
    account position = 60

All surfaces must agree.

---

# 35. Scale-In

An add/scale execution:

    increases open quantity
    updates average cost according to canonical position logic
    leaves initial risk snapshot unchanged
    updates current open risk
    updates portfolio heat
    updates account NAV/projections

Do not reinterpret a scale-in as the original planned quantity.

---

# 36. Full Close

A trade becomes economically closed ONLY when its effective execution stream
produces:

    open quantity = 0

The final closing execution determines:

    closedAt

Do not provide a normal user action that merely changes:

    status = closed

without an economic closing fill.

If such direct status mutation exists today:

    audit and remove/block it

for trades with positions.

---

# 37. Close-Date Attribution

Preserve the Performance Dashboard contract:

    realized trade performance is attributed by close date.

Therefore:

    trade.closedAt

must reflect the effective fill that flattens the trade.

Execution correction may change this date.

Performance must follow the corrected close date after rebuild.

---

# 38. Closed Trade Mutation Rules

A closed trade cannot accept a new ordinary execution.

Normal user action:

    closed → new add/buy

must be rejected.

To alter a factual historical execution:

    use correction

Do not silently reopen closed trades through ordinary fill creation.

---

# 39. Planned Trade Scratch/Delete

`deleted` remains a journal/scratch concept.

A planned trade with no economic executions may be scratched/soft-deleted.

Do not allow ordinary deletion to erase a trade that has posted economic
executions.

Once economic history exists:

    correction
    close
    review

are the appropriate mechanisms.

Do not hard-delete financial history.

---

# 40. Immutable Execution History

Posted executions are immutable economic records.

Do NOT implement:

    UPDATE execution price
    UPDATE execution quantity
    DELETE execution

for corrections.

Use the existing:

    original
    + reversal
    + replacement
    + lineage

model.

---

# 41. Trade-Linked Execution Correction

This milestone must audit and repair the boundary between:

    journal trade execution

and:

    accounting execution correction

Current correction architecture is accounting-centric.

After correction of a trade-linked execution:

    journal trade metrics
    FIFO position
    account position
    ledger
    NAV
    realized P&L
    trade status
    openedAt
    closedAt
    risk snapshot when affected

must all reflect the corrected effective execution stream.

There must not be:

    accounting corrected
    journal trade still showing old fill

or vice versa.

---

# 42. Correction Linkage

Reversal/replacement executions associated with a journal trade must preserve
enough linkage to rebuild the trade deterministically.

Do not create correction rows that lose the original:

    trade association

unless another canonical linkage mechanism replaces it.

Audit current:

    journalTradeId

behavior carefully.

---

# 43. Correcting First Entry

If the first opening execution is corrected:

    price
    quantity
    fees
    timestamp

the initial risk snapshot must remain internally correct.

Recompute any derived fields affected by the corrected factual fill.

The correction is not normal management.

Do not preserve an initial-risk snapshot that references an execution which is
no longer economically effective.

---

# 44. Correction Can Change Lifecycle

Execution correction may change:

    openedAt
    closedAt
    status

Example:

An incorrect final exit quantity originally closed the trade.

Correction reduces the exit quantity.

The corrected trade is now:

    open

Required:

    trade status → open
    closedAt → null
    account position → open
    live risk → active again

Likewise a correction may newly flatten an open trade.

Lifecycle is derived from effective economic truth.

---

# 45. Correction and Review

If a reviewed trade receives an economic execution correction:

    reviewedAt must be cleared

because the economics reviewed are no longer identical.

The trade then returns conceptually to:

    Closed — Needs Review

if it remains flat.

If correction reopens the trade:

    workflow phase → Open/Managed

The previous grade/notes may remain historical/editable as appropriate, but
the explicit "review complete" marker must not falsely remain valid.

---

# 46. Execution Atomicity

A successful execution request must atomically/coherently include:

    journal execution record
    accounting execution
    trade_execution financial event
    balanced ledger postings
    FIFO lots/matches
    account position
    trade status/timestamps
    first-entry risk snapshot when applicable
    checklist evidence when applicable
    account-performance projection

Failure of any required persistence/rebuild must fail the request.

Do not preserve the current non-fatal sync behavior.

---

# 47. Projection Failure

Force deterministic failures in:

    FIFO rebuild
    account position persistence
    account performance persistence
    financial event/ledger posting
    trade status update

For every failure:

    HTTP request fails
    no partial execution remains
    previous coherent state remains
    idempotency key remains retryable

Prove using real SQLite failure fixtures/triggers where appropriate.

---

# 48. Account Lifecycle Guard

Preserve A6:

Inactive account:

    cannot originate new execution.

The guard must run before:

    instrument creation
    journal execution
    accounting execution
    financial event
    FIFO mutation

Historical correction remains distinct from new activity.

---

# 49. Currency Guard

Preserve A1:

    USD-only

Legacy non-USD accounts remain readable but cannot originate new economic
activity.

No FX work belongs here.

---

# 50. Account Default Behavior

Preserve A8.

Automatic account selection may use:

    eligible saved default
    fallback active supported account

but an explicit user-selected account must never be silently replaced.

Full execution readiness is checked after account selection.

Do not change the meaning of:

    defaultAccountId

into "guaranteed execution-ready account."

---

# 51. Trade Metrics

Continue using the canonical trade-metrics implementation for:

    quantities
    average prices
    realized P&L
    unrealized P&L
    fees
    duration
    R metrics
    status derivation

Do not create alternate formulas in:

    routes
    tables
    dialogs
    dashboard components

If the effective corrected execution stream changes, feed that stream into the
existing metrics engine.

---

# 52. Exact Financial Arithmetic

Economic posting/accounting remains on canonical decimal/micros infrastructure.

Avoid adding new floating-point aggregation to:

    accounting
    cash
    FIFO
    realized P&L
    risk amount

Legacy UI storage using REAL may remain where changing it is unnecessarily
large, but canonical accounting truth must not be downgraded to float math.

Document the source of truth.

---

# 53. Current Price / Mark State

Open-trade current price remains market-mark information, not an execution.

Do not create executions from market marks.

If an open position lacks a mark:

    unrealized P&L = unavailable

rather than zero.

Preserve existing missing-data semantics.

---

# 54. Risk & Positions Dashboard Propagation

The root:

    /

remains the live operational Risk & Positions workstation.

Do not replace or redirect it.

After:

    first entry
    add
    reduce
    close
    stop adjustment
    execution correction

the root dashboard must reflect the canonical state after normal refresh.

Examples:

    position quantity
    average cost
    current stop
    open risk
    portfolio heat
    P&L

No separate manual rebuild operation should be required.

---

# 55. Performance Dashboard Propagation

The:

    /performance

dashboard remains retrospective analytics.

Do not redesign it.

Trading Workflow must ensure its underlying data remains correct after:

    closing fills
    backdated fills
    execution corrections
    changed close dates

Preserve:

    close-date attribution
    $ / % / R semantics
    existing filters/widgets

---

# 56. Trades Workspace Information Architecture

The `/trades` surface should make the lifecycle obvious.

Recommended primary workflow filters/tabs:

    Planned
    Open
    Closed
    Reviewed

`Deleted/Scratched` may remain secondary.

Managed trades remain part of:

    Open

with a visible:

    Managed

phase indicator.

Do not create a separate database economic status merely to support the tab.

---

# 57. Planned List

Planned trades should emphasize:

    symbol
    direction
    setup
    account
    planned entry
    planned stop
    planned quantity
    planned risk $
    planned risk %
    reward/risk
    age / planned date

Primary action:

    Record Entry

Do not overload the row with post-trade analytics.

---

# 58. Open List

Open trades should emphasize:

    symbol
    direction
    quantity
    average entry
    current mark
    unrealized P&L
    realized P&L if partially exited
    current stop
    open risk $
    open risk %
    R state where meaningful
    workflow phase
    age

Primary action should take the user into management.

---

# 59. Closed List

Closed / Needs Review should emphasize:

    symbol
    direction
    setup
    realized P&L
    R
    fees
    duration
    closedAt
    review status

Primary action:

    Review Trade

---

# 60. Reviewed List

Reviewed trades should surface:

    realized P&L
    R
    grade
    followed-plan status
    lesson
    key mistakes where available
    reviewedAt

Primary action:

    View Review

Do not mix reviewed completion into financial P&L calculations.

---

# 61. Trade Detail — Planned State

Planned trade detail should clearly separate:

    Plan
    Risk
    Checklist
    Evidence / screenshots

Show original intent:

    thesis
    invalidation
    entry
    stop
    targets
    quantity
    setup
    context
    pre-trade notes

Primary action:

    Record Entry

---

# 62. Trade Detail — Open/Managed State

Open trade detail should become an operational management surface.

Prioritize:

    position
    current mark
    unrealized P&L
    realized P&L
    current stop
    open risk
    initial risk
    current R / R-state where supported
    executions
    stop history
    target history

Primary actions:

    Add
    Reduce
    Close
    Adjust Stop
    Adjust Target

Pre-trade plan remains visible but read-only.

---

# 63. Trade Detail — Closed State

Closed trade detail should prioritize:

    final result
    execution history
    realized P&L
    fees
    R result
    duration
    plan vs actual
    management timeline

Then guide into:

    Review

Do not allow ordinary new execution controls.

---

# 64. Review Workflow

A closed trade can be explicitly reviewed.

Add:

    reviewedAt

or equivalent explicit durable completion state.

The review surface should reuse existing:

    trade grade
    lesson
    mistakes
    assessments
    screenshots/assets
    followed-plan / rule-violation fields

Do not build another parallel review subsystem.

---

# 65. Minimum Review Completion Contract

To mark:

    Reviewed

require meaningful review evidence.

Recommended minimum:

    lesson is non-empty
    and
    trade grade exists

Mistakes are optional because a good trade may genuinely have none.

Assets/screenshots are optional.

If the existing product has a stronger documented review contract, preserve it.

Do not make "Reviewed" a button that records nothing except a timestamp.

---

# 66. Review Reopen

Allow:

    Reopen Review

or equivalent if the user wants to revise the review.

This clears:

    reviewedAt

but does NOT alter:

    economic status
    executions
    P&L
    close date

Then the trade returns to:

    Closed / Needs Review.

---

# 67. Grade and Review Separation

Grade evaluates process quality.

P&L evaluates economic outcome.

Do not derive grade from profit/loss.

Do not automatically make:

    profitable = good trade
    losing = bad trade

Preserve the existing process-oriented grading model.

---

# 68. Management Timeline

Where practical, present a coherent chronological history combining:

    executions
    stop adjustments
    target adjustments
    relevant notes/assets

This is primarily a view model.

Do not create duplicate economic events simply to render a timeline.

Ordering must be deterministic.

---

# 69. Execution Reason

Preserve/use existing:

    execution_reason

lookup where relevant.

Management fills should support:

    reason
    notes

Examples:

    breakout entry
    scale-in
    partial profit
    stop-out
    target hit
    discretionary exit

Do not hard-code one strategy's terminology globally.

---

# 70. Fees

Fees must follow actual executions.

They contribute to canonical realized/net P&L according to existing metrics.

Do not attach arbitrary estimated commissions after the fact if actual fees
were recorded.

The configured default commission may prefill the execution form, but the
actual execution fee remains editable before posting.

---

# 71. Short Workflow

Full deterministic UAT must include a short trade.

Example:

    plan short
    sell short
    partial cover
    final cover
    closed
    reviewed

All:

    quantities
    realized P&L
    FIFO
    cash effects
    status
    review

must work symmetrically.

Do not validate only long workflows.

---

# 72. Position Integrity

For every effective execution stream:

    account_positions

must reconcile to:

    FIFO lots/matches

and to:

    trade open quantity

No successful user mutation may leave:

    trade says open 100
    account position says 60

or similar divergence.

---

# 73. Multi-Trade Same Symbol

Support multiple journal trades in the same:

    account
    symbol

without corrupting account-level FIFO.

Account FIFO is account/instrument economic truth.

Journal trades remain strategy/journal attribution.

Audit carefully how executions from two journal trades in the same symbol
interact with FIFO.

Do not assume one journal trade equals one brokerage tax lot.

Document the supported attribution model.

---

# 74. FIFO Scope

Continue using FIFO as the canonical account-position allocation policy.

Do NOT introduce:

    LIFO
    specific-lot election
    tax optimization

in this milestone.

If journal-trade attribution and account FIFO cannot be made identical in a
specific multi-trade case, make the distinction explicit rather than hiding
it.

---

# 75. Historical Readability

Existing trades must remain readable.

Do not require destructive migrations that rewrite all historical economic
data.

If historical rows need backfilled linkage:

    use deterministic migration/rebuild logic

and preserve originals.

No silent deletion.

---

# 76. Migration Safety

Any schema migrations must be:

    additive where practical
    deterministic
    replay-safe
    committed through normal migration infrastructure

Possible additions include:

    reviewed_at
    execution linkage/idempotency
    checklist snapshot fields
    risk snapshot provenance

only where justified by the chosen architecture.

Do not rewrite prior migrations.

---

# 77. Existing Execution Correction

Audit both:

    account-scoped execution correction
    trade-scoped correction routes/services

Define one consistent ownership model.

A trade-linked execution correction must not bypass journal lifecycle rebuild.

An accounting-only execution that is not associated with a journal trade may
continue using accounting correction semantics without inventing a trade.

---

# 78. Failure Semantics

Expected HTTP classes:

    400
        malformed/invalid input

    404
        missing trade/account/execution

    409
        lifecycle/idempotency conflict

    422
        valid request that violates FIFO/position allocation constraints

    500
        unexpected persistence/projection failure

Use typed domain errors.

Do not collapse everything into generic 500.

---

# 79. No Silent Error Swallowing

Financially meaningful domain operations must not contain:

    try {
        criticalSync()
    } catch {
        ignore
    }

Critical operations either:

    succeed coherently

or:

    fail the request coherently.

Logging is supplemental, not a substitute for correctness.

---

# 80. UI Error Recovery

On failed execution:

    form remains open
    user's input remains present
    actionable error shown
    no success toast
    no optimistic position update

If the server transaction rolled back:

    retry is safe

Use the same idempotency identity on retry.

---

# 81. UI Success

After successful execution:

    composer closes
    trade detail refreshes
    list refreshes
    account/risk state refreshes as currently appropriate

The user should immediately see the newly coherent state.

No second manual refresh should be required.

---

# 82. Design System

All Trading Workflow UI must follow the existing:

    Graphite + Steel Blue

design system.

Principles:

    Industrial
    Precise
    Restrained
    Analytical
    Fast
    Consistent

Use project-local:

    trading-product-ux

for substantial user-facing changes.

Do not create generic SaaS card layouts.

Financial numbers use:

    tabular numerals
    appropriate right alignment
    semantic Profit/Loss/Warning/Missing colors

---

# 83. Risk-First Visual Hierarchy

Open-trade screens should prioritize:

    position
    stop
    risk
    P&L
    management action

before:

    metadata
    tags
    long prose

Planned screens prioritize:

    plan
    risk
    checklist

Closed/reviewed screens prioritize:

    result
    process
    lessons

---

# 84. Accessibility

Maintain:

    keyboard access
    clear focus
    semantic labels
    screen-reader action names
    no color-only state meaning

Dialogs/forms must expose validation errors appropriately.

---

# 85. Responsive Behavior

The workstation is desktop-first.

Still verify:

    standard desktop
    narrower laptop viewport

No horizontal clipping of critical execution/risk controls.

Do not spend milestone scope building a native mobile experience.

---

# 86. Cross-System Integrity

After each relevant operation, verify consistency among:

    trade
    journal execution history
    accounting execution history
    financial events
    ledger
    FIFO lots
    account positions
    account performance
    root Risk dashboard
    /trades
    /performance where applicable

This is a first-class milestone requirement, not optional polish.

---

# 87. Deterministic Scenario A — Plan Only

Create:

    active USD account
    funded
    effective defaults available

Create planned long trade:

    entry 50
    stop 48
    target 56
    qty 100

Expected:

    status = planned
    workflow phase = planned
    no execution
    no ledger event
    no FIFO lot
    no position
    planned risk displayed

Editing plan remains allowed.

---

# 88. Scenario B — Long Entry

Record:

    buy 100 @ 50
    fee 1
    stop 48

Expected:

    status = open
    openedAt = fill timestamp
    journal execution = 1
    accounting execution = 1 effective fill
    financial event posted
    ledger balanced
    FIFO open qty = 100
    account position qty = 100
    initial risk snapshot exists
    account performance coherent
    checklist evidence persisted

---

# 89. Scenario C — Scale In

Existing:

    100 @ 50

Add:

    50 @ 52

Expected:

    open qty = 150
    average cost from canonical engine
    initial risk snapshot unchanged
    current risk recomputed
    workflow phase = managed
    account position = 150

---

# 90. Scenario D — Partial Exit

From:

    150 open

Reduce:

    50 @ 55

Expected:

    open qty = 100
    realized P&L on closed quantity
    unrealized P&L on remaining quantity
    FIFO matches correct
    current risk recomputed on 100
    status remains open
    workflow phase = managed

---

# 91. Scenario E — Stop Adjustment

Change:

    stop 48 → 51

Expected:

    initial stop remains historically 48
    adjustment row exists
    current stop = 51
    open risk updates
    portfolio heat updates
    root dashboard reflects new risk

---

# 92. Scenario F — Full Close

Sell remaining:

    100 @ 57

Expected:

    open qty = 0
    status = closed
    workflow phase = closed
    closedAt = final fill timestamp
    account position flat
    FIFO lots fully allocated
    realized P&L correct
    fees correct
    account performance correct
    Performance attribution uses closedAt
    normal execution controls removed

---

# 93. Scenario G — Review

Closed trade.

Add:

    grade
    lesson

Mark:

    Reviewed

Expected:

    reviewedAt populated
    workflow phase = reviewed
    financial status remains closed
    financial metrics unchanged
    Reviewed filter/list contains trade

---

# 94. Scenario H — Short Trade

Plan:

    short

Execute:

    sell short 100
    cover 40
    cover 60

Expected:

    correct short FIFO
    correct P&L signs
    correct cash/account state
    closed
    reviewable

No direction inversion.

---

# 95. Scenario I — Over-Close Rejection

Long open quantity:

    100

Attempt:

    sell/reduce 120

Expected:

    422 or repository-standard domain rejection

After failure:

    executions unchanged
    FIFO unchanged
    ledger unchanged
    position remains 100
    account performance unchanged
    idempotency key retryable

---

# 96. Scenario J — Projection Failure Rollback

Force:

    account performance persistence failure

while recording valid execution.

Expected:

    request = 500
    no journal execution committed
    no accounting execution committed
    no financial event
    no ledger posting
    no FIFO mutation
    no trade-status mutation
    previous account state intact

Remove failure.

Retry same idempotency key.

Expected:

    success exactly once.

---

# 97. Scenario K — Backdated Entry

Create planned trade today.

Record an entry with historical timestamp.

Expected:

    openedAt = historical fill timestamp
    position/FIFO ordering deterministic
    risk snapshot as-of semantics deterministic
    account projection rebuilt
    no insertion-order artifact

---

# 98. Scenario L — Correct Final Exit

Trade originally closed.

Correct final exit so position is only partially closed.

Expected:

    correction lineage exists
    original immutable
    effective open quantity > 0
    trade status returns to open
    closedAt cleared
    account position open
    risk dashboard includes position again
    reviewedAt cleared if previously reviewed

---

# 99. Scenario M — Correct First Entry

Trade first entry originally:

    100 @ 50

Correct to:

    80 @ 49.50

Expected:

    effective execution stream corrected
    position rebuilt
    initial risk snapshot rebuilt coherently
    P&L/risk use corrected factual entry
    journal and accounting agree

---

# 100. Scenario N — Inactive Account

Deactivate account.

Attempt new execution.

Expected:

    409 ACCOUNT_INACTIVE

Zero mutations.

Historical trade remains readable.

Historical correction policy remains explicit and does not silently reactivate.

---

# 101. Scenario O — Idempotent Retry

Submit execution with:

    key X

Simulate client retry.

Expected:

    one economic fill only

No duplicate:

    journal execution
    accounting execution
    ledger posting
    FIFO lot

---

# 102. Scenario P — Two Trades Same Symbol

Same account:

    Trade A = AAPL long
    Trade B = AAPL long

Record fills in both.

Verify:

    journal attribution remains correct
    account-level AAPL FIFO remains canonical
    account position equals economic sum
    closing one journal trade cannot corrupt remaining account position

Document expected FIFO attribution behavior.

---

# 103. Scenario Q — Checklist Template Changes

Execute trade with checklist.

Later edit/deactivate checklist definition.

Historical trade review still shows:

    what was checked
    pass/fail
    comment

Do not lose historical process evidence.

---

# 104. Scenario R — Review Invalidated by Correction

Reviewed closed trade.

Correct an execution.

Expected:

    reviewedAt cleared

If still closed:

    Closed / Needs Review

If reopened economically:

    Open/Managed

No stale reviewed badge.

---

# 105. API Contract Tests

Required route/domain coverage should include:

    trade create
    trade update
    first execution
    add
    reduce
    close
    invalid action
    over-close
    inactive account
    unsupported currency
    idempotent retry
    projection rollback
    checklist gate
    stop adjustment
    target adjustment
    execution correction
    reviewed completion
    correction invalidating review

Use real SQLite for transaction/rollback assertions.

---

# 106. Domain-Level Tests

Test the canonical execution service directly.

Verify row counts across:

    trade_executions
    accounting_executions
    financial_events
    ledger_entries
    ledger_postings
    FIFO lots
    FIFO matches
    account_positions
    account_performance
    risk snapshots

Do not prove atomicity only through mocks.

---

# 107. Browser UAT

At minimum automate real browser workflows for:

    Plan → Entry
    Entry → Add → Partial Reduce
    Final Close
    Closed → Review
    Inactive-account rejection
    Execution error/retry
    Stop adjustment
    Corrected execution changing lifecycle

Use the actual `/trades` UI.

---

# 108. Cross-Surface Browser Check

After an open execution:

verify:

    /trades
    /
    account Overview / Positions

show coherent state.

After final close:

verify:

    /trades
    /
    /performance

observe the closed state appropriately.

Do not require visual redesign of unrelated dashboards.

---

# 109. Data Migration / Legacy Compatibility

Existing trade records may predate canonical linkage.

Audit and classify them.

Where deterministic linkage can be reconstructed:

    backfill safely.

Where it cannot:

    preserve readability
    expose clear legacy limitation
    do not invent economic history.

Do not silently duplicate executions during migration.

---

# 110. Existing `startingBalance` / `accountTransactions`

Trading Workflow must not add any new dependency on:

    accounts.startingBalance
    accountTransactions

for current economic truth.

Execution risk/equity calculations must use the canonical Account Workflow
model established by M006.

Existing legacy schema may remain for compatibility.

Do not delete it unless separately justified.

---

# 111. Account Workflow Regression Boundary

The following M006 invariants are frozen and must remain green:

    USD-only account accounting
    atomic initialization
    canonical account closure
    immutable opening-balance correction
    atomic financial-event corrections
    inactive-account new-activity guard
    atomic normal financial-event posting
    eligible active default account
    root test-artifact hygiene

Do not weaken them for convenience.

---

# 112. Test Artifact Hygiene

H1 is now a permanent invariant.

All new SQLite tests must use:

    src/lib/testing/test-db.ts

or another explicitly safe OS-temp fixture.

Do not create:

    .test-*.db

in repository root.

`make test-all` root hygiene guard must remain green.

---

# 113. Out of Scope — Broker Execution

Do NOT implement:

    Schwab OAuth
    broker login
    Interactive Brokers integration
    actual order placement
    order cancellation
    order modification
    live brokerage reconciliation

TradingJournal records fills.

It does not send orders in this milestone.

---

# 114. Out of Scope — Market Data Expansion

Do NOT build:

    real-time quote infrastructure
    websockets
    full market-data ingestion
    Level 2
    options chains

Reuse current mark mechanisms.

---

# 115. Out of Scope — Multi-Currency

Do NOT implement:

    FX conversion
    non-USD ledger
    multi-currency portfolio aggregation

A1 remains:

    USD-only accounting.

---

# 116. Out of Scope — Advanced Instruments

Do NOT expand into:

    options multi-leg accounting
    futures margin
    crypto
    forex
    bonds
    short borrow fees
    corporate action engine redesign

Focus on the currently supported equity-style trade lifecycle.

---

# 117. Out of Scope — Tax Accounting

Do NOT implement:

    specific-lot tax selection
    wash-sale rules
    tax reporting
    capital-gains optimization

FIFO remains the canonical allocation model.

---

# 118. Out of Scope — Analytics Redesign

Do NOT redesign:

    Performance dashboard
    Process Review analytics
    setup analytics
    dashboard widget system

This milestone produces correct canonical trading data those surfaces consume.

---

# 119. Out of Scope — AI Coaching

Do NOT add:

    LLM trade review
    AI suggestions
    automatic strategy scoring
    auto-generated lessons

Review remains user-authored/deterministic.

---

# 120. S01 — Trading Workflow Audit and Binding Contract

Before substantive implementation:

Audit all current surfaces for:

    trade creation
    trade update/status mutation
    bulk execute
    individual executions
    risk snapshot creation
    stop adjustments
    target adjustments
    account execution posting
    FIFO rebuild
    position rebuild
    execution correction
    trade correction
    trade metrics
    review/grade/mistakes/assets
    /trades UI
    root Risk dashboard consumers

Produce:

    docs/trading-workflow-audit-matrix.md

The matrix should classify each concern:

    Current
    Reuse
    Refine
    Replace
    Missing
    Deferred

This document becomes binding guidance for S02–S08.

Explicitly identify every duplicated or non-atomic execution path.

---

# 121. S02 — Plan and Execution Readiness

Implement/refine:

    planned trade lifecycle
    account resolution
    planning vs execution readiness
    planned risk preview
    first-entry checklist contract
    plan editing/freeze semantics
    entry UX

Acceptance:

    planned trade can be created coherently
    planned risk is deterministic
    first fill cannot bypass readiness/checklist rules

---

# 122. S03 — Canonical Atomic Execution Engine

Build the single canonical execution service.

Unify:

    journal execution
    accounting execution
    financial event
    ledger
    FIFO
    account position
    trade state
    risk snapshot
    account performance

under one authoritative mutation boundary.

Remove/non-fatally-sync semantics from normal workflow.

Implement:

    idempotency
    action rules
    quantity guards
    long/short symmetry
    backdated deterministic ordering

This is the highest-risk slice.

---

# 123. S04 — Open Trade Management

Implement/refine:

    Add
    Reduce
    Close
    Adjust Stop
    Adjust Target
    management phase
    live risk propagation
    management timeline

Verify:

    partial exits
    scale-ins
    current stop
    portfolio heat
    root dashboard propagation

---

# 124. S05 — Close and Execution Correction Integrity

Complete:

    final-fill closure
    close-date attribution
    immutable execution correction
    journal/accounting correction coherence
    lifecycle rebuild after correction
    risk-snapshot correction behavior
    multi-trade same-symbol integrity

No direct manual economic close.

---

# 125. S06 — Review Workflow

Add/refine:

    reviewedAt
    Closed / Needs Review
    Reviewed phase
    review completion guard
    lesson
    grading
    mistakes
    assets
    review reopening
    correction invalidates review

Reuse current review primitives.

Do not build a parallel review subsystem.

---

# 126. S07 — Cross-System Integrity

Run deterministic cross-surface scenarios and repair:

    Trades
    Risk & Positions
    Account Overview
    Account Positions
    Ledger
    Performance

for:

    entry
    add
    reduce
    close
    backdated fill
    correction
    review

No cross-surface divergence accepted.

---

# 127. S08 — Full UAT and Hardening

Run complete lifecycle UAT:

    Plan
    → Entry
    → Manage
    → Partial Exit
    → Close
    → Review

for:

    long
    short

Also run:

    failure rollback
    idempotency
    correction
    inactive account
    multi-trade same symbol
    laptop viewport
    light/dark theme where supported

Fix only concrete milestone defects.

Do not start the next milestone.

---

# 128. Quality Gates

At EACH slice completion run separately:

    make lint

    make typecheck

    make build

    make test-all

Run targeted Playwright for changed workflows.

At milestone boundary run the appropriate full browser matrix / UAT suite.

Use the repository's established Playwright server conventions.

Do not weaken tests to obtain green results.

---

# 129. Root Hygiene Gate

After all test/UAT work:

    git status --short

and:

    root test-artifact hygiene guard

must be clean.

No `.test-*.db`, WAL, or SHM debris.

H1 remains binding.

---

# 130. Milestone Acceptance Criteria

The milestone is complete only when ALL are true:

- [ ] There is one authoritative trade execution domain path.
- [ ] Normal UI execution does not rely on non-fatal post-commit sync.
- [ ] Journal execution and accounting execution cannot diverge after success.
- [ ] Every successful execution produces coherent ledger/FIFO/position/account state.
- [ ] Failed downstream projection/rebuild rolls back the execution.
- [ ] Execution requests are idempotent and safely retryable.
- [ ] Planning eligibility and execution readiness are distinct.
- [ ] Execution readiness uses canonical Account Workflow state.
- [ ] No Trading Workflow logic depends on legacy startingBalance/accountTransactions.
- [ ] First fill transitions planned → open.
- [ ] `openedAt` comes from effective first fill.
- [ ] Add/scale works correctly.
- [ ] Partial reduction works correctly.
- [ ] Over-close/inversion is impossible.
- [ ] Final fill automatically closes the trade.
- [ ] `closedAt` comes from effective flattening fill.
- [ ] Close-date Performance attribution remains correct.
- [ ] Initial risk snapshot is deterministic and preserved through management.
- [ ] Stop adjustments update current open risk without rewriting initial risk.
- [ ] Target adjustments preserve original plan.
- [ ] Open-risk/portfolio-heat surfaces update after management.
- [ ] Pre-trade checklist cannot be bypassed through an alternate execution route.
- [ ] Historical checklist evidence remains intelligible after template changes.
- [ ] Pre-trade plan is frozen after first execution.
- [ ] Posted executions are immutable.
- [ ] Trade-linked execution correction updates both journal and accounting truth.
- [ ] Execution correction can deterministically reopen/reclose a trade.
- [ ] Correction of a reviewed trade invalidates review completion.
- [ ] Closed trades cannot receive normal new fills.
- [ ] Planned no-execution trades may still be scratched/deleted.
- [ ] Trades with economic history cannot be casually deleted.
- [ ] Reviewed state is explicit and durable.
- [ ] Reviewed requires meaningful review evidence.
- [ ] Review state does not alter financial P&L.
- [ ] Long lifecycle passes.
- [ ] Short lifecycle passes.
- [ ] Multi-trade same-symbol account FIFO remains coherent.
- [ ] Root Risk dashboard remains coherent with trade state.
- [ ] Account Overview/Positions remain coherent with trade state.
- [ ] Performance remains coherent with corrected close dates.
- [ ] A1–A8 Account Workflow regressions remain green.
- [ ] H1 repository hygiene remains green.
- [ ] lint passes.
- [ ] typecheck passes.
- [ ] build passes.
- [ ] make test-all passes.
- [ ] milestone UAT passes.

---

# 131. GSD Execution Rules

Use normal GSD:

    milestone
        → slices
            → reviewable vertical tasks

Do not create vague tasks such as:

    improve trading
    refactor executions
    polish trades page

Every task should have:

    a concrete user/domain outcome
    a bounded implementation surface
    deterministic acceptance criteria
    verification

Use the project-local `trading-product-ux` guidance for meaningful UI work.

Correctness takes priority over visual polish.

---

# 132. Required Milestone Deliverable

When GSD finishes the milestone, return ONE consolidated report containing:

1. milestone ID;
2. base commit;
3. final head commit;
4. total commits;
5. slices and task counts;
6. changed architectural boundaries;
7. final lifecycle/state model;
8. canonical execution ownership;
9. journal ↔ accounting execution linkage model;
10. execution atomicity semantics;
11. idempotency semantics;
12. planning vs execution readiness rules;
13. account-equity-at-open source;
14. initial risk-snapshot semantics;
15. management/stop/target semantics;
16. close semantics;
17. execution-correction semantics;
18. reviewed-state semantics;
19. migrations added;
20. legacy compatibility decisions;
21. deterministic scenario results;
22. cross-surface integrity results;
23. long workflow UAT;
24. short workflow UAT;
25. failure/rollback UAT;
26. quality-gate results;
27. root hygiene result;
28. known explicitly deferred issues.

Provide screenshots for the principal user-facing states:

    Planned trade
    Entry execution
    Open/Managed trade
    Partial reduction
    Closed trade
    Review form
    Reviewed trade

Then STOP.

Do not begin the next milestone.

---

# 133. Post-Milestone Workflow

After GSD reports the milestone complete:

DO NOT ask GSD to keep improving it.

The workflow becomes:

    1. Freeze the GSD milestone implementation.
    2. Independently audit the full completed commit range.
    3. Identify the highest-impact concrete defect.
    4. Issue ONE surgical corrective task.
    5. Implement and commit that single fix.
    6. Independently review it.
    7. Accept/freeze it or correct it.
    8. Move to the next defect only after acceptance.
    9. Finish substantive defects before hygiene-only refinements.
    10. Close the post-milestone audit once no substantive defect remains.

This is the same workflow used successfully for Account Workflow M006.

Do not bundle multiple post-milestone defects into one correction unless they
are inseparable parts of one invariant.
