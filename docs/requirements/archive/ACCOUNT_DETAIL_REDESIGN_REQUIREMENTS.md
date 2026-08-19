# Account Detail Page Redesign Requirements

**Project:** Trading Journal  
**Repository:** `jg-main/TradingJournal`  
**Document type:** Product and engineering requirements  
**Audience:** Frontend engineers, backend engineers, QA, product owner  
**Status:** Proposed for implementation  
**Date:** 2026-07-16  

---

## 1. Executive Summary

The current Account Detail page mixes multiple product concerns:

- Account identity and settings
- Legacy account balance calculations
- Ledger-derived accounting state
- Portfolio valuation
- Trading performance
- Execution activity
- Position details
- Reconciliation
- Technical maintenance controls

This produces a long, repetitive page with duplicated information and conflicting values.

The Account Detail page must be redesigned as an **account operations workspace**, not a performance dashboard.

The redesigned page must answer:

> What is this account, what cash and positions does it currently hold, what financial events changed it, and is its accounting state valid?

The page must not attempt to answer:

> How well is the trader performing over time?

Performance analytics belong on Dashboard V2 and dedicated analytics pages.

The Account Detail page will be reorganized into five tabs:

```text
Overview
Ledger
Positions
Reconciliation
Settings
```

The page must use the new accounting ledger and projections as the authoritative source for account state.

Legacy balance calculations may remain available only inside reconciliation and migration diagnostics during the cutover period.

---

## 2. Goals

The redesign must:

1. Make the Account Detail page operational and accounting-focused.
2. Remove performance analytics that belong on Dashboard V2.
3. Eliminate duplicate position and execution representations.
4. Make the ledger the primary financial activity view.
5. Make reconciliation a dedicated workflow.
6. Reduce vertical scrolling.
7. Improve information hierarchy and scanability.
8. Separate user-facing operational controls from technical maintenance controls.
9. Prevent legacy and ledger-derived values from appearing as equally authoritative.
10. Preserve existing accounting functionality.
11. Preserve all current journal links and trade associations.
12. Provide a clear transition path from the current page.

---

## 3. Non-Goals

This redesign does not include:

- Redesigning Dashboard V2.
- Changing double-entry accounting rules.
- Changing FIFO or position calculation logic.
- Changing journal trade grading or review flows.
- Adding new asset classes.
- Adding broker synchronization.
- Replacing SQLite.
- Rewriting the ledger engine.
- Removing legacy accounting tables during this milestone.
- Adding user-configurable dashboard widgets.
- Adding a full general-ledger accounting interface.

This milestone is primarily an information architecture, UI, API composition, and workflow redesign.

---

## 4. Current Problems

### 4.1 Conflicting account summaries

The page currently displays both:

- Legacy current balance and account net P&L
- Ledger-derived NAV, cash, market value, realized P&L, and unrealized P&L

These values may differ while reconciliation is incomplete.

The ordinary account page must not present legacy and ledger values as equivalent account summaries.

### 4.2 Performance analytics are in the wrong context

The following metrics do not belong on Account Detail:

- Total P&L
- Realized P&L summary
- Unrealized P&L summary
- TWR
- Modified Dietz
- High-water mark
- Drawdown
- Realized-fee performance summary

These belong on Dashboard V2 or dedicated performance analytics.

### 4.3 Positions are duplicated

The current page has both:

- Valuation Positions
- Current Positions

These must become one unified Positions experience.

### 4.4 Reconciliation is duplicated

The page currently contains:

- A reconciliation warning near the top
- A large reconciliation section near the bottom

The default view must display one compact status summary only.

Detailed reconciliation must move to its own tab.

### 4.5 Execution Activity is incomplete

Execution Activity only represents trades.

The account operations page must represent all financial events:

- Executions
- Deposits
- Withdrawals
- Dividends
- Interest
- Fees
- Taxes
- Adjustments
- Corrections
- Reversals
- Transfers

This requires a unified Ledger view.

### 4.6 Technical controls are too prominent

Controls such as:

- Rebuild
- Projection version
- Multiple refresh buttons
- Post mark

must not dominate the default account page.

---

## 5. Product Model

The page must follow these boundaries.

### 5.1 Account Detail owns

- Account identity
- Current NAV
- Current cash
- Current market value
- Current open positions
- Financial event history
- Cash transactions
- Adjustments
- Corrections
- Reconciliation
- Account settings
- Accounting maintenance

### 5.2 Dashboard V2 owns

- TWR
- Modified Dietz
- Historical P&L
- Drawdown
- High-water mark
- Performance comparison
- Period matrix
- Setup attribution
- Process analytics
- Trading expectancy
- Profit factor
- Win rate
- Historical fees
- Realized versus unrealized performance analysis

### 5.3 Journal Trade pages own

- Thesis
- Setup
- Risk
- Entries
- Exits
- R-multiple
- Grade
- Mistakes
- Lessons
- Trade-level screenshots
- Journal-specific P&L attribution

---

## 6. Navigation and Page Shell

### 6.1 Breadcrumb

Replace:

```text
Back to Settings
```

with:

```text
Accounts / Main.Paper
```

or:

```text
← Accounts
```

The account page is not a Settings subpage.

### 6.2 Header

Required layout:

```text
Main.Paper                                      Active
Schwab · USD                    [Add transaction] [Record execution] [More]
```

Header fields:

- Account name
- Account status
- Broker
- Base currency

Primary actions:

```text
Add transaction
Record execution
```

Secondary actions under `More`:

```text
Post valuation mark
Reconcile account
Rebuild projections
Export account
Close account
```

Technical actions may be conditionally visible only when needed.

### 6.3 Tabs

Required tabs:

```text
Overview
Ledger
Positions
Reconciliation
Settings
```

The selected tab must be represented in the URL.

Recommended routes:

```text
/accounts/:accountId
/accounts/:accountId/ledger
/accounts/:accountId/positions
/accounts/:accountId/reconciliation
/accounts/:accountId/settings
```

Alternative query-based routing is acceptable:

```text
/accounts/:accountId?tab=ledger
```

Path-based routing is preferred for direct linking and browser history.

---

## 7. Overview Tab Requirements

The Overview tab is the default account landing page.

It must be concise.

### 7.1 Account snapshot

Display exactly four primary metrics:

| Metric | Definition |
|---|---|
| Net Asset Value | Current ledger-derived NAV |
| Cash | Current account cash |
| Market Value | Current marked securities value |
| Open Positions | Count of non-zero positions |

Required layout:

```text
NET ASSET VALUE       CASH               MARKET VALUE       OPEN POSITIONS
$1,000.50             $632.50            $368.00            2
```

Do not display:

- TWR
- Modified Dietz
- Drawdown
- High-water mark
- Total P&L
- Realized P&L summary
- Unrealized P&L summary
- Legacy current balance
- Starting balance
- Account net P&L

### 7.2 As-of and data-quality line

Below the summary:

```text
As of Jul 16, 11:48 AM · Prices: 2 fresh · 0 stale · 0 missing
```

Required data:

- Projection timestamp
- Valuation timestamp
- Fresh price count
- Stale price count
- Missing price count

### 7.3 Accounting health banner

Show one compact banner.

Failure state:

```text
⚠ Reconciliation blocked — 3 unexplained differences
4 of 7 comparisons match                              [Review]
```

Healthy state:

```text
✓ Account reconciled · Last checked Jul 16, 11:48 AM
```

Rules:

- Do not repeat full reconciliation details on Overview.
- `Review` links to the Reconciliation tab.
- Banner severity must match reconciliation state.
- Banner must not show only a generic status; it must show issue count.

### 7.4 Open positions preview

Show a dense table.

Columns:

```text
Symbol
Side
Quantity
Average Cost
Mark
Market Value
Unrealized P&L
Price Status
```

Required behavior:

- Maximum 5 rows.
- Sort by absolute market value descending.
- Symbol links to the Positions tab with instrument filter.
- `View all positions` links to Positions.
- Do not use large card-per-position layout.
- Zero P&L must be neutral.
- Negative zero must render as `$0.00`.

### 7.5 Recent account activity

Display the latest 10 ledger events.

Columns:

```text
Date
Event
Instrument / Description
Quantity
Cash Impact
Journal Trade
Status
```

Examples of Event:

```text
Buy
Sell
Deposit
Withdrawal
Dividend
Fee
Adjustment
Correction
Transfer
```

Rules:

- Do not display raw IDs.
- Journal trade must show a meaningful label.
- Corrections should be grouped as one logical row when possible.
- `View complete ledger` links to Ledger.

---

## 8. Ledger Tab Requirements

The Ledger tab is the main accounting operations workspace.

### 8.1 Ledger summary strip

Display:

| Metric | Definition |
|---|---|
| Cash Balance | Current ledger cash |
| Net External Funding | Deposits minus withdrawals |
| Posted Events | Count of posted financial events |
| Adjustments | Count of manual adjustments in current filter |

Do not show trading performance metrics here.

### 8.2 Quick actions

Required actions:

```text
Deposit
Withdrawal
Record execution
Income or fee
Adjustment
```

`Income or fee` must support:

```text
Dividend
Interest income
Interest expense
Commission
Regulatory fee
Borrow fee
Tax
```

### 8.3 Unified ledger table

Replace `Execution Activity`.

Columns:

```text
Date
Type
Instrument / Description
Quantity
Price
Cash Impact
Fees
Source
Journal Trade
Status
```

Optional columns:

```text
Event ID
External Reference
Settlement Date
```

These should be hidden by default.

### 8.4 Filters

Required filters:

```text
Date range
Event category
Symbol
Journal trade
Source
Status
Corrections
```

Required event category presets:

```text
All
Executions
Cash
Income
Fees
Adjustments
Corrections
Transfers
```

### 8.5 Row expansion

A ledger row may expand to show:

- Event metadata
- Debit and credit postings
- Linked original and reversal events
- Linked execution
- Linked journal trade
- External reference
- Notes
- Source
- Projection impact

Example:

```text
Long Securities at Cost       Debit   $1,000.00
Commission Expense             Debit       $1.00
Cash                           Credit  $1,001.00
```

### 8.6 Journal trade display

Do not show truncated UUIDs.

Display:

```text
WKC · Breakout
```

or:

```text
WKC-20260709
```

The value must link to the journal trade.

If no journal trade is linked:

```text
Unassigned
```

Provide an action to link the execution when supported.

### 8.7 Correction grouping

A correction must be represented as one logical item.

Collapsed display:

```text
Correction · NTC execution
Quantity changed from 10 to 100
```

Expanded display:

```text
Original event
Reversal event
Replacement event
Reason
Timestamp
User/source
```

Do not force users to interpret reversal and replacement rows manually.

### 8.8 Duplicate rows

The ledger table must display only authoritative financial events.

The implementation must verify whether duplicate rows currently come from:

- Legacy and new execution tables both being queried
- Duplicate migration events
- One-to-many joins
- Reversal/replacement flattening
- Client-side duplication

Acceptance requires no unexplained duplicates.

---

## 9. Positions Tab Requirements

Merge all current position displays into one tab.

### 9.1 Position summary

Display:

```text
Market Value
Gross Exposure
Net Exposure
Open Positions
```

Optional:

```text
Long Exposure
Short Exposure
Cash Weight
```

### 9.2 Main positions table

Columns:

```text
Symbol
Side
Quantity
Average Cost
Cost Basis
Mark
Market Value
Unrealized P&L
Portfolio Weight
Price Status
```

Optional columns:

```text
Realized P&L YTD
Linked Journal Trades
Last Event
```

Historical realized P&L must not be presented as a property of the remaining open lot by default.

### 9.3 Row expansion

Expanded position detail must include:

- FIFO open lots
- Opening executions
- Linked journal trades
- Latest valuation mark
- Mark timestamp
- Price source
- Realized history for the instrument
- Correction history
- Projection sequence
- Position rebuild metadata when in technical mode

### 9.4 Open lot table

Columns:

```text
Opened At
Quantity Opened
Quantity Remaining
Unit Cost
Total Remaining Basis
Opening Execution
Journal Trade
```

### 9.5 Price status

Required statuses:

```text
Fresh
Stale
Missing
Manual
```

Missing price must not render market value as zero.

### 9.6 Display rules

- `$0.00` must be neutral.
- `-$0.00` is forbidden.
- Positive values use positive semantic color.
- Negative values use negative semantic color.
- Quantities use configured instrument precision.
- Monetary values use account currency formatting.

---

## 10. Reconciliation Tab Requirements

The Reconciliation tab contains all legacy-versus-ledger and integrity diagnostics.

### 10.1 Reconciliation summary

Required:

```text
Account is not eligible for cutover

7 comparisons
4 matching
0 explained
3 unexplained
```

Healthy state:

```text
Account is eligible for cutover
All 7 comparisons match or are explained
```

### 10.2 Comparison table

Columns:

```text
Dimension
Legacy Value
Ledger Value
Difference
Classification
Severity
Action
```

Required dimensions may include:

```text
Cash
Positions
Realized P&L
Fees
Account Equity
Execution Count
External Funding
```

### 10.3 Issue actions

Supported actions:

```text
Review source records
Explain difference
Correct event
Create approved adjustment
Mark expected migration difference
Re-run reconciliation
```

### 10.4 Explanation requirements

An explained difference must store:

- Explanation
- User or source
- Timestamp
- Supporting references
- Classification
- Whether it blocks cutover

### 10.5 Technical maintenance controls

Move here:

```text
Rebuild projections
Run reconciliation
Integrity check
Projection version
Last event sequence
Migration report
Rebuild history
```

These controls must not be prominent on Overview.

### 10.6 Cutover status

The tab must clearly show:

```text
Eligible for cutover
Not eligible for cutover
Already cut over
```

---

## 11. Settings Tab Requirements

Move the current Parameters section here.

### 11.1 Account identity

Fields:

```text
Account name
Broker
Base currency
Account type
Active status
Opened date
Closed date
```

### 11.2 Trading defaults

Fields:

```text
Max risk per trade
Default commission
```

### 11.3 Accounting settings

Read-only or configurable as appropriate:

```text
Accounting enabled date
Cost basis method
Accounting date basis
Base currency
Migration status
Ledger status
```

### 11.4 Destructive and lifecycle actions

Actions:

```text
Deactivate account
Close account
Export account
Delete account
```

Delete must follow existing data-safety rules.

---

## 12. Remove or Relocate Existing Elements

| Existing element | Required action |
|---|---|
| Back to Settings | Replace with Accounts breadcrumb |
| Current Balance | Remove from Overview; use NAV |
| Starting Balance | Move to Ledger opening event |
| Net Deposits | Move to Ledger summary |
| Account Net P&L | Move to Dashboard V2 |
| Reconciliation banner | Keep once on Overview |
| Parameters card | Move to Settings |
| Valuation & Performance section | Remove |
| Net Asset Value | Keep |
| Net Cash | Keep as Cash |
| Marked Positions | Rename Market Value |
| Realized P&L | Move to Dashboard |
| Unrealized P&L summary | Move to Dashboard; keep per position |
| Total P&L | Move to Dashboard |
| Realized Fees | Move to Dashboard or Ledger |
| Gross Exposure | Move to Positions summary |
| Net Exposure | Move to Positions summary |
| TWR | Move to Dashboard |
| Modified Dietz | Move to Dashboard |
| High-water mark | Move to Dashboard |
| Drawdown | Move to Dashboard |
| Valuation Positions | Merge into Positions |
| Execution Activity | Replace with Ledger |
| Current Position cards | Replace with positions table |
| Full Reconciliation section | Move to Reconciliation |
| Post Mark | Move to Positions or More |
| Rebuild | Move to Reconciliation |
| Projection version | Hide from normal view |
| Multiple Refresh buttons | Replace with one refresh strategy |

---

## 13. Data Contracts

### 13.1 Account overview API

Recommended:

```text
GET /api/accounts/:accountId/overview
```

Response:

```json
{
  "account": {
    "id": "string",
    "name": "Main.Paper",
    "broker": "Schwab",
    "baseCurrency": "USD",
    "status": "active"
  },
  "asOf": "2026-07-16T16:48:00Z",
  "snapshot": {
    "nav": 1000500000,
    "cash": 632500000,
    "marketValue": 368000000,
    "openPositionCount": 2
  },
  "priceQuality": {
    "fresh": 2,
    "stale": 0,
    "missing": 0
  },
  "reconciliation": {
    "status": "blocked",
    "matching": 4,
    "explained": 0,
    "unexplained": 3,
    "total": 7
  },
  "positionsPreview": [],
  "recentEvents": []
}
```

Amounts should follow the ledger API’s canonical representation.

### 13.2 Ledger API

Recommended:

```text
GET /api/accounts/:accountId/ledger
```

Parameters:

```text
dateFrom
dateTo
category
instrumentId
journalTradeId
source
status
page
pageSize
```

Response must be paginated.

### 13.3 Positions API

Recommended:

```text
GET /api/accounts/:accountId/positions
```

Parameters:

```text
status
instrumentId
priceStatus
sort
```

### 13.4 Reconciliation API

Recommended:

```text
GET  /api/accounts/:accountId/reconciliation
POST /api/accounts/:accountId/reconciliation/run
POST /api/accounts/:accountId/reconciliation/issues/:issueId/explain
```

### 13.5 Settings API

Existing account settings endpoints may be reused if they already expose the required fields.

---

## 14. Frontend Component Structure

Recommended components:

```text
src/app/accounts/[id]/layout.tsx
src/app/accounts/[id]/page.tsx
src/app/accounts/[id]/ledger/page.tsx
src/app/accounts/[id]/positions/page.tsx
src/app/accounts/[id]/reconciliation/page.tsx
src/app/accounts/[id]/settings/page.tsx

src/components/accounts/account-header.tsx
src/components/accounts/account-tabs.tsx
src/components/accounts/account-snapshot.tsx
src/components/accounts/account-health-banner.tsx
src/components/accounts/open-positions-preview.tsx
src/components/accounts/recent-ledger-activity.tsx
src/components/accounts/ledger-table.tsx
src/components/accounts/ledger-filters.tsx
src/components/accounts/ledger-event-details.tsx
src/components/accounts/position-table.tsx
src/components/accounts/position-lot-table.tsx
src/components/accounts/reconciliation-summary.tsx
src/components/accounts/reconciliation-table.tsx
src/components/accounts/account-settings-form.tsx
```

Shared formatting:

```text
src/lib/format-money.ts
src/lib/format-quantity.ts
src/lib/format-pnl.ts
```

---

## 15. Visual and Interaction Requirements

### 15.1 Density

The page must remain data-dense.

Avoid:

- Large marketing cards
- Excessive whitespace
- Large card-per-position layouts
- Repeated section headings
- Redundant KPIs
- Decorative charts

### 15.2 Tables

Tables must support:

- Sticky header where useful
- Row hover
- Sort
- Filter
- Pagination or virtualization
- Row expansion
- Keyboard accessibility
- Horizontal overflow without breaking the page

### 15.3 Refresh

Use one of:

- Automatic query refresh
- One page-level refresh
- Local refresh only when a specific section is stale

Do not show multiple identical Refresh buttons on the same page.

### 15.4 Loading

Use skeletons that preserve layout.

### 15.5 Empty states

Required empty states:

```text
No open positions
No ledger activity
No reconciliation issues
No valuation marks
No linked journal trade
```

Empty states must provide the relevant next action.

### 15.6 Error states

Errors must distinguish:

```text
API unavailable
Projection stale
Reconciliation failed
Missing valuation
Account not found
Unauthorized or invalid action
```

---

## 16. Legacy and Cutover Behavior

### 16.1 Before cutover

Overview must display ledger-derived values.

Legacy values may appear only in Reconciliation.

### 16.2 After cutover

Remove legacy value references from all ordinary Account Detail tabs.

### 16.3 Legacy execution rows

The ordinary Ledger tab must never mix legacy and authoritative execution rows.

### 16.4 Feature flag

The team may implement:

```text
ACCOUNT_DETAIL_V2
```

or equivalent.

The feature flag must be temporary and removed after acceptance.

---

## 17. Duplicate Execution Investigation

This is a blocking requirement.

The team must identify why identical executions appear twice.

Required investigation:

1. Compare source IDs.
2. Compare financial event IDs.
3. Compare legacy execution IDs.
4. Inspect SQL joins.
5. Inspect migration idempotency keys.
6. Inspect reversal/replacement flattening.
7. Inspect client-side state updates.
8. Inspect React key usage.

Acceptance:

- Every ledger event appears once.
- Reversal and replacement events appear only according to the designed correction grouping.
- No duplicate event is hidden merely through UI deduplication if the database contains an actual duplicate.
- Actual duplicate events must be corrected through migration or reversal, not silently dropped.

---

## 18. Testing Requirements

### 18.1 Unit tests

Required:

- Account snapshot composition
- Reconciliation banner state
- P&L formatting
- Negative-zero formatting
- Price-status classification
- Journal-trade label formatting
- Correction grouping
- Ledger category mapping
- Position row mapping

### 18.2 API tests

Required:

- Overview response
- Ledger filtering
- Ledger pagination
- Position filtering
- Reconciliation summary
- Reconciliation explanation
- Empty account
- Missing prices
- Blocked reconciliation
- Healthy reconciliation

### 18.3 Playwright tests

Required flow:

1. Open account.
2. Verify Overview is default.
3. Verify four snapshot metrics.
4. Verify performance metrics are absent.
5. Open Ledger.
6. Filter executions.
7. Expand ledger event.
8. Open linked journal trade.
9. Open Positions.
10. Expand FIFO lots.
11. Open Reconciliation.
12. Review one issue.
13. Open Settings.
14. Edit a trading default.
15. Return to Overview.

Additional correction flow:

1. Create execution correction.
2. Verify grouped correction row.
3. Expand correction.
4. Verify original, reversal, and replacement.

### 18.4 Visual regression

Capture:

```text
Overview desktop
Ledger desktop
Positions desktop
Reconciliation desktop
Settings desktop
Overview narrow desktop
Empty account
Blocked reconciliation
Healthy reconciliation
```

---

## 19. Accessibility Requirements

- All tabs must support keyboard navigation.
- Tables must have semantic headers.
- Status colors must include text or icons.
- Positive and negative values must not rely on color alone.
- Expandable rows must expose `aria-expanded`.
- Buttons must have clear accessible names.
- Focus order must follow visual order.
- Warnings must use appropriate alert semantics.

---

## 20. Performance Requirements

Targets:

```text
Overview initial API response        < 500 ms typical
Ledger first page                    < 500 ms typical
Positions                            < 500 ms typical
Reconciliation summary               < 750 ms typical
Tab navigation after first load      < 200 ms perceived
```

The UI must not load the full ledger on Overview.

Overview must request only:

- Snapshot
- Position preview
- Recent events
- Reconciliation summary

---

## 21. Implementation Sequence

### Phase 1 — Data and API cleanup

- Identify duplicate execution cause.
- Add overview API.
- Add paginated ledger API.
- Confirm positions API.
- Confirm reconciliation API.
- Add meaningful journal-trade labels.

### Phase 2 — Page shell

- Add account breadcrumb.
- Add account header.
- Add tabs.
- Add route structure.

### Phase 3 — Overview

- Four-metric snapshot.
- Price-quality line.
- Accounting health banner.
- Open positions preview.
- Recent activity preview.

### Phase 4 — Ledger

- Unified event table.
- Filters.
- Pagination.
- Expandable postings.
- Grouped corrections.
- Quick actions.

### Phase 5 — Positions

- Summary strip.
- Dense table.
- FIFO lot expansion.
- Price-quality states.

### Phase 6 — Reconciliation

- Summary.
- Comparison table.
- Issue actions.
- Technical controls.
- Cutover state.

### Phase 7 — Settings

- Move Parameters.
- Add account identity.
- Add accounting metadata.
- Add lifecycle actions.

### Phase 8 — Legacy cleanup

- Remove old sections.
- Remove duplicate refresh controls.
- Remove performance metrics.
- Update navigation.
- Update Help and README.
- Remove feature flag after acceptance.

---

## 22. Expected Deliverables

```text
Account tab routes
Account header and tab components
Overview API and UI
Ledger API and UI
Positions UI consolidation
Reconciliation UI
Settings relocation
Correction grouping
Duplicate execution root-cause fix
Formatting utilities
Unit tests
API tests
Playwright tests
Visual regression screenshots
README updates
Help-page updates
AGENTS.md updates if architecture rules change
```

---

## 23. Acceptance Criteria

### Overview

- [ ] Default tab is Overview.
- [ ] Only NAV, Cash, Market Value, and Open Positions appear as primary metrics.
- [ ] No TWR, Modified Dietz, drawdown, high-water mark, or Total P&L.
- [ ] Reconciliation appears once as a compact banner.
- [ ] Positions preview uses one table.
- [ ] Recent activity uses authoritative ledger events.
- [ ] No raw UUIDs are visible.

### Ledger

- [ ] All financial event types are visible.
- [ ] Events are filterable and paginated.
- [ ] Posting details are expandable.
- [ ] Corrections are grouped.
- [ ] No unexplained duplicates remain.
- [ ] Quick actions are available.
- [ ] Cash impact is clear.

### Positions

- [ ] Valuation Positions and Current Positions are merged.
- [ ] Open positions use one dense table.
- [ ] FIFO lots are expandable.
- [ ] Missing prices do not display as zero.
- [ ] Negative zero never appears.

### Reconciliation

- [ ] Full reconciliation is isolated to its tab.
- [ ] Legacy values appear only here.
- [ ] Issues can be reviewed and explained.
- [ ] Technical maintenance controls are here.
- [ ] Cutover state is visible.

### Settings

- [ ] Parameters moved from Overview.
- [ ] Account identity and accounting status are visible.
- [ ] Lifecycle actions remain available.

### General

- [ ] Back to Settings is removed.
- [ ] Multiple Refresh buttons are removed.
- [ ] Projection version is hidden from normal users.
- [ ] Performance analytics are moved out of Account Detail.
- [ ] Existing ledger operations continue to work.
- [ ] Existing journal links continue to work.
- [ ] Full quality gate passes.

---

## 24. Final Product Direction

The Account Detail page must become a focused account operations interface:

```text
Account identity
→ current account state
→ ledger activity
→ open positions
→ accounting integrity
→ account settings
```

Performance belongs elsewhere:

```text
Historical P&L
→ returns
→ drawdown
→ attribution
→ trading process
→ Dashboard V2
```

The redesigned page must make the ledger easier to trust and easier to operate without turning the Account Detail page into a second dashboard.
