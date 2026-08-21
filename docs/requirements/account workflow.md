# Milestone — Account Workflow & Ledger Operations

## Purpose

Turn the existing account/accounting infrastructure into a coherent end-to-end
user workflow for creating, initializing, funding, maintaining, correcting, and
deactivating brokerage accounts.

The completed workflow should make this sequence natural:

Create Account
↓
Initialize Account
↓
Opening Balance / Funding
↓
Trade + Cash Activity
↓
Account Overview / Ledger / Positions
↓
Corrections / Reconciliation
↓
Ongoing Account Management

This is primarily a workflow, UX, and integration milestone.

DO NOT rebuild the accounting engine, ledger model, account projections,
performance engine, or account workspace architecture unless S01 identifies a
specific correctness blocker.

The existing accounting domain is authoritative.

---

## Product Goal

A user should be able to create a brokerage account and manage its financial
lifecycle without needing API calls, database manipulation, or knowledge of
the underlying double-entry implementation.

The UI should expose domain concepts useful to a trader:

- Account
- Opening balance
- Deposit
- Withdrawal
- Dividend
- Interest
- Fee
- Tax
- Adjustment
- Activity
- Correction
- Current cash
- NAV
- Positions
- Reconciliation

The UI should NOT expose accounting implementation detail unnecessarily.

For example:

Good:
Deposit $5,000

Not primary workflow:
Create debit/credit posting pair

Double-entry details may remain available in expanded ledger/audit views.

---

# 1. Existing Architecture Is the Starting Point

Audit and reuse the existing:

- `/settings/accounts`
- `/settings/accounts/[id]`
- account workspace layout
- Overview
- Ledger
- Positions
- Reconciliation
- Settings
- `/api/accounts`
- `/api/accounts/[id]`
- financial-events APIs
- accounting event-posting service
- ledger projection
- correction/reversal infrastructure
- account overview projection
- performance rebuild
- AccountProvider / default-account behavior
- canonical account/performance calculation libraries

Do not create a parallel account-management system.

Do not create a second ledger.

Do not create React-local account calculations.

---

# 2. Core Account Lifecycle

The intended lifecycle is:

## A. Create account

Minimum required identity:

- Account name
- Broker
- Base currency

Optional:

- Make this my default account

Account creation must NOT treat starting cash as an editable account property.

Starting capital belongs in financial history.

After successful creation, take the user into the newly created account
workflow rather than leaving them without a clear next action.

Recommended flow:

    Add Account
        ↓
    Account created
        ↓
    Account Overview
        ↓
    "Add opening balance" / "Start with zero"

Avoid a large onboarding wizard unless S01 demonstrates that one is necessary.

A focused create dialog/form followed by first-run account setup is preferable.

---

## B. Initialize account

A newly created account must have a clear empty-state workflow.

If there is no financial activity, present a setup action such as:

    Account created

    Start this account by adding its opening cash balance.

    [Add opening balance] [Start with $0]

Opening balance is a financial event, not mutable account metadata.

The user must also be allowed to maintain a legitimate zero-balance account.

S01 must inspect existing opening-balance invariants before implementation.

If the domain allows only one canonical opening balance, preserve that rule.

If correction is required, use the correction mechanism rather than silently
posting a second opening balance.

---

# 3. Financial Transaction Workflow

Provide a clear first-party UI for posting supported account financial events.

Primary action:

    + Add transaction

Recommended primary transaction catalogue:

- Deposit
- Withdrawal
- Dividend
- Interest
- Fee
- Tax
- Manual Adjustment

Opening Balance should primarily appear during account initialization but may
remain accessible where domain rules permit.

S01 must classify every existing EVENT_TYPE into:

1. normal user-entered account transaction
2. trade/system generated
3. corporate action
4. cross-account operation
5. advanced/manual operation
6. currently unsupported/deferred

Do not expose an event simply because it exists in the enum.

In particular, do not implement a fake one-sided "Transfer" workflow if the
existing domain does not provide correct two-account transfer semantics.

Corporate actions such as stock splits may be placed under an Advanced action
if already safely supported.

---

# 4. Transaction Composer

Use one coherent transaction composer rather than separate unrelated forms for
each event.

The form changes according to transaction type.

Common fields where applicable:

- Transaction type
- Amount
- Effective/posting date
- Description / note
- Reason where required

Event-specific metadata should appear only when applicable.

Examples:

Deposit
Amount
Date
Description

Dividend
Amount
Date
Symbol if supported by canonical contract
Shares / per-share amount only if supported
Description

Fee
Amount
Date
Fee type if supported
Description

Manual adjustment
Signed economic effect or explicit Increase/Decrease control
Reason
Date

The UI must follow canonical backend sign semantics.

Do not ask users to understand internal signed amounts if the event type
already establishes direction.

Before submission, make the economic effect understandable where useful:

    Cash increases by $5,000.00

or

    Cash decreases by $125.00

No client-side duplicate financial calculation should become authoritative.

---

# 5. Ledger as Account Activity

The existing Ledger becomes the canonical detailed account activity history.

The primary presentation should answer:

- What happened?
- When?
- How much?
- What was the cash effect?
- Was it posted successfully?
- Was it corrected?

Keep detailed debit/credit posting information available through expansion or
audit detail.

Do not make double-entry bookkeeping the dominant default presentation.

Ledger rows should provide appropriate actions.

For user-entered mutable-by-correction financial events:

    [...] → Correct transaction

Do NOT provide destructive Edit or Delete actions for immutable financial
events.

Trade-generated/system events should not accidentally become manually
editable.

---

# 6. Corrections

Financial history is immutable.

Incorrect posted transactions must be corrected through the existing
correction/reversal/replacement model wherever that architecture already
exists.

Target UX:

    Original:
    Deposit       $5,000
    Aug 20 2026

    Correct transaction

    Correct amount: $4,500
    Reason: Incorrect deposit amount

    [Cancel] [Post correction]

After confirmation:

- original remains in audit history
- reversal exists
- replacement exists
- correction lineage is preserved
- effective account cash reflects $4,500
- derived account state is rebuilt
- ledger clearly communicates that the transaction was corrected

The normal activity view should remain understandable without requiring the
user to decode three accounting events.

Expanded/audit view can show full lineage.

Never implement correction as an UPDATE of the original financial event.

Never physically delete financial history to implement correction.

---

# 7. Account Overview

The Overview should function as the account's operational landing page.

Preserve canonical metrics such as:

- NAV
- Cash
- Position market value
- Open positions
- Realized P&L
- Unrealized P&L
- Total P&L
- Fees
- exposure where currently supported

Improve hierarchy and workflow where needed.

Important actions should be easy to find:

- Add transaction
- View ledger
- View positions
- Reconcile account

For an empty account, use an initialization state rather than presenting a
dashboard full of unexplained zeroes.

For an active account, show recent financial activity and current account
state.

Do not redesign the Overview into a second Performance dashboard.

---

# 8. Account Settings and Lifecycle

Account Settings should distinguish:

## Identity

- name
- broker

## Base currency

Currency is financially significant.

S01 must determine current behavior.

Preferred safety invariant:

- Currency may be changed freely before financial/trading history exists.
- Once financially meaningful history exists, currency should be locked
  unless there is an existing safe migration mechanism.

Do NOT reinterpret historical USD values as EUR/COP merely because a currency
field changed.

If locked, explain why.

## Status

Allow account deactivation/archive according to existing account semantics.

Deactivation must:

- preserve ledger/history
- preserve trades
- preserve reporting
- remove the account from inappropriate new-entry workflows
- not destroy historical analytics

Do not introduce permanent account deletion unless a proven domain-safe
implementation already exists and is explicitly justified.

---

# 9. Default Account Integration

Keep one authoritative default-account behavior.

Creating a new account may optionally make it default.

Changing the default account must propagate to workflows that currently use
the application default, particularly new-trade account selection.

Inactive accounts must not remain silently usable as defaults for new
transactions/trades.

Do not create a second "preferred account" concept.

---

# 10. Financial Semantics

These invariants are critical.

## Cash flows are not trading P&L

Opening balances, deposits, and withdrawals must change cash/NAV as
appropriate without being interpreted as trading profit or loss.

Examples:

Opening balance:
+$10,000 cash
P&L = $0

Deposit:
+$2,500 cash
trading P&L unchanged

Withdrawal:
-$1,000 cash
trading P&L unchanged

A backdated cash event must rebuild affected account/performance projections
according to the existing canonical engine.

## Fees / dividends / interest / taxes

Use existing canonical semantics.

Do not invent alternative formulas in UI components.

## Currency

Every financial event must respect account currency semantics.

No implicit FX conversion.

## Precision

Continue using canonical decimal/micros infrastructure.

Do not replace monetary computation with floating-point React calculations.

## Ledger integrity

All relevant events must preserve:

- atomic posting
- balanced postings
- idempotency
- deterministic replay/projection
- correction lineage

---

# 11. Cross-System Propagation

After posting or correcting a transaction, verify that all dependent surfaces
observe the updated canonical state where applicable:

- Account Overview
- Account Ledger
- account cash
- NAV
- performance projection
- Performance dashboard
- account selectors
- default-account workflows
- reconciliation

Do not simply update one React component optimistically while leaving
canonical projections stale.

Read-your-writes consistency should be explicit.

---

# 12. UX Direction

Apply the existing TradingJournal design system.

Use the project-local `trading-product-ux` guidance for substantive workflow
work.

Desired characteristics:

- compact
- professional
- financially precise
- low-friction
- strong hierarchy
- clear numeric alignment
- no generic SaaS-card proliferation
- clear empty states
- clear destructive/corrective semantics
- accessible dialogs/forms
- predictable keyboard navigation
- useful success/error feedback

Account management should feel like part of the same product as the new
Performance dashboard and workstation.

Do not recreate the design system.

---

# 13. GSD Vertical Slices

## S01 — Account Workflow & Domain Audit

Before implementation, inspect:

- account creation
- account editing
- default account
- AccountProvider
- account workspace
- account overview
- ledger
- positions
- reconciliation
- financial event APIs
- event-posting kernel
- correction infrastructure
- account/performance rebuild
- event-type schemas
- trade/account integration
- currency behavior
- account deactivation

Produce a compact matrix:

    Area | Current State | Reuse | Refine | Missing | Deferred

Explicitly determine:

- which financial events are safe for manual UI entry
- opening-balance rules
- correction capabilities
- currency mutation rules
- deactivation rules
- default-account propagation
- whether transfer semantics are actually complete
- whether corporate-action entry belongs in this milestone

Do not rewrite functioning infrastructure.

---

## S02 — Account Creation & Initialization

Deliver:

- polished Add Account workflow
- validation
- optional default-account selection
- immediate transition into new account
- empty-account initialization state
- Add Opening Balance workflow
- explicit Start With Zero path
- appropriate success/error/loading states

Acceptance:

A completely new user can create and initialize an account using only the UI.

---

## S03 — Financial Transaction Composer

Deliver:

- Add Transaction entry point
- curated transaction-type selector
- dynamic event-specific form
- correct date/amount/description semantics
- economic-effect preview where useful
- canonical API submission
- success/error handling
- immediate account-state refresh

Acceptance:

Deposit, withdrawal, and the other S01-approved transaction types can be
posted entirely through the UI.

---

## S04 — Ledger Actions & Corrections

Deliver:

- clear activity presentation
- correction action for eligible financial events
- immutable reversal/replacement workflow
- correction reason
- understandable corrected-state presentation
- detailed correction lineage available
- no destructive mutation

Acceptance:

A user can post an incorrect cash transaction and correct it without deleting
or modifying financial history.

---

## S05 — Account Settings & Lifecycle

Deliver/refine:

- identity editing
- broker editing
- safe base-currency behavior
- active/inactive state
- default-account integration
- guardrails around accounts containing financial history

Acceptance:

Account metadata can be maintained without compromising historical financial
integrity.

---

## S06 — Account State & Cross-System Integrity

Verify and fix only actual gaps in:

- cash
- NAV
- P&L
- fees
- account Overview
- ledger projection
- performance projection
- Performance dashboard
- default account
- trade workflow
- backdated cash events
- corrected events

This is an integration slice, NOT permission to redesign the analytics engine.

---

## S07 — Workflow UX Refinement & UAT

Run the complete real-user lifecycle:

    create
    → initialize
    → deposit
    → withdraw
    → trade/account usage where applicable
    → inspect overview
    → inspect ledger
    → correct event
    → reconcile
    → change settings
    → deactivate

Verify light/dark at:

- 1440
- 1280
- 1024

Check keyboard use, form labels, focus states, numeric alignment, loading,
errors, empty states, success feedback, and no horizontal overflow.

---

# 14. Deterministic Scenario Tests

At minimum implement/verify the following scenario.

## Scenario A — New account

Create:

    Name: Test Brokerage
    Broker: Test Broker
    Currency: USD

Expected:

- account active
- accessible from Accounts
- account workspace loads
- no fabricated financial history

---

## Scenario B — Opening balance

Post:

    Opening balance = $10,000

Expected:

    Cash = $10,000
    NAV = $10,000 assuming no positions
    Trading P&L = $0

Ledger contains the immutable opening event.

---

## Scenario C — Deposit

Post:

    Deposit = $2,500

Expected:

    Cash = $12,500
    NAV increases by $2,500 absent other changes
    Trading P&L remains unchanged

---

## Scenario D — Withdrawal

Post:

    Withdrawal = $1,000

Expected:

    Cash = $11,500
    Trading P&L remains unchanged

---

## Scenario E — Correction

Original:

    Deposit = $2,500

Correct to:

    Deposit = $2,000

Expected economic result relative to the opening balance and subsequent
withdrawal:

    Opening       +10,000
    Deposit        +2,000
    Withdrawal     -1,000
    ---------------------
    Cash           11,000

Expected audit behavior:

- original preserved
- reversal preserved
- replacement preserved
- correction lineage visible
- effective projection uses corrected value
- no duplicate P&L
- no orphan/unbalanced postings

---

## Scenario F — Idempotency

Retry an identical idempotent request.

Expected:

- no duplicate economic event
- no duplicate ledger posting
- appropriate existing domain response

---

## Scenario G — Backdated cash flow

Post a valid cash event with an earlier effective date.

Expected:

- account state rebuild succeeds
- historical performance projection reflects the event at the correct time
- no corruption of later state

---

## Scenario H — Currency safety

Attempt to change base currency after meaningful financial history exists.

Expected:

- safe behavior according to the S01 contract
- no silent reinterpretation of historical monetary values

---

## Scenario I — Deactivation

Deactivate an account with history.

Expected:

- historical ledger accessible
- analytics preserved
- account not offered where new activity requires an active account
- no data deletion

---

# 15. Regression Requirements

This milestone must not regress:

- `/`
- `/performance`
- current saved workstation views
- Performance dashboard filters
- canonical trade calculations
- FIFO/accounting calculations
- account risk
- account selectors
- market-data trust states
- trade entry/edit workflows
- reconciliation

Performance/dashboard code should only change where account-state integration
actually requires it.

---

# 16. Explicit Non-Goals

Do NOT implement as part of this milestone unless S01 identifies an existing
partially completed implementation that only needs finishing:

- broker OAuth onboarding
- new Schwab integration
- automated brokerage synchronization
- generic CSV import redesign
- historical brokerage migration wizard
- opening inventory / portfolio migration engine
- multi-currency FX accounting
- currency conversion
- arbitrary journal-entry editor
- user-defined accounting categories
- accounting-engine rewrite
- ledger-schema rewrite
- Performance dashboard redesign
- Trading Workflow redesign
- new analytics metrics
- generic transfer system without correct cross-account semantics
- permanent deletion of accounts with financial history

Avoid scope creep into the future Trading Workflow or Analytics milestones.

---

# 17. Verification

At the end of every implementation slice run separately:

make lint
make typecheck
make build
make test-all

Do not combine them into a single ambiguous quality-gate result.

For user-facing slices, perform targeted Playwright/browser verification.

At milestone completion, run the complete account lifecycle UAT.

Do not weaken tests to make the milestone pass.

Record any intentionally deferred behavior explicitly.

---

# 18. Definition of Done

The milestone is complete when:

- account creation is coherent and polished
- a new account has an understandable initialization path
- opening balance can be established correctly
- supported cash transactions can be posted through the UI
- account Overview updates from canonical state
- Ledger provides understandable financial history
- corrections preserve immutable accounting history
- corrected state propagates correctly
- cash flows do not become trading P&L
- account settings respect financial-history invariants
- default-account behavior remains coherent
- inactive accounts are handled safely
- backdated events rebuild correctly
- currency semantics remain safe
- the account lifecycle works at 1440/1280/1024
- light and dark themes work
- accessibility fundamentals pass
- existing workstation and Performance workflows do not regress
- lint passes
- typecheck passes
- build passes
- test-all passes
- milestone UAT passes

---

# 19. Final Orchestrator Directive

Evolve the existing TradingJournal account/accounting implementation into a
complete user-facing account lifecycle.

Prioritize:

existing accounting architecture > new accounting architecture

immutable correction > destructive editing

financial-event history > mutable balance fields

canonical calculations > UI-local calculations

clear trader workflow > exposing bookkeeping internals

correct financial semantics > convenience shortcuts

reuse existing account workspace > parallel account UI

cash-flow correctness > feature count

integration correctness > optimistic cosmetic state

focused vertical slices > broad refactoring

The target user journey is:

Create Account
→ Initialize
→ Fund
→ Use
→ Inspect
→ Correct
→ Reconcile
→ Maintain

Do not rebuild what already works.

Complete the milestone, record final verification evidence, and stop.

Do not proceed into unrelated Trading Workflow or Analytics work.
