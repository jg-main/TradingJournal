# Trade Log Redesign — Post-Implementation Audit

## Audit conclusion

Milestone M008 should **not be considered complete**.

The implementation successfully delivers:

* Separate Open, Closed and Planned tabs
* FIFO lot matching
* Quantity-weighted entry and exit prices
* Gross and net realized P&L
* Execution-fee allocation
* Unrealized P&L
* Date controls and account filter
* Full-filtered-dataset totals
* Row navigation
* Filter persistence

However, the feature remains incomplete in four important areas:

1. **Column management is unavailable**
2. **Many specified columns were never defined**
3. **Several risk and filtering calculations are incorrect**
4. **Important table functions such as pagination and actions are missing**

The accounting kernel is largely complete. The Trades frontend and its API contract are not.

---

# 1. Critical: there is no column selector

The current `DynamicTable` maintains:

* `columnVisibility`
* `columnOrder`
* Sorting state
* LocalStorage persistence

It also passes `onColumnVisibilityChange` into TanStack Table. However, it does not render any UI that calls `column.toggleVisibility()`. There is no Columns button, dropdown, checkbox list, Show All option or Reset option.

The Trades page only passes:

```tsx
<DynamicTable
  data={rows}
  columns={colMap[tab.id]}
  storageKey={`trades:${tab.id}`}
  onRowClick={...}
/>
```

No column-management control is rendered outside the component either.

Therefore:

* Users cannot hide columns.
* Users cannot restore hidden columns.
* A visibility value already saved in LocalStorage can hide a column permanently from the UI.
* The claim that “column visibility persistence” was verified only confirms persistence of internal state, not the existence of a usable feature. The implementation commit explicitly claimed this functionality despite not adding a visibility control.

## Required implementation

Add a visible **Columns** dropdown for the active table.

It must contain:

```text
Columns
☑ Symbol
☑ Direction
☑ Setup
☑ Size
☑ Open Avg Cost
☐ Avg Entry
☐ Market Value
...

Show all
Reset to defaults
```

Recommended implementation:

* Put the visibility menu inside `DynamicTable`, or expose the TanStack `table` instance through a toolbar render prop.
* Use `table.getAllLeafColumns()`.
* Only show columns where `column.getCanHide()` is true.
* Set `enableHiding: false` for:

  * Symbol
  * Actions
* Maintain separate visibility state for:

  * `trades:open`
  * `trades:closed`
  * `trades:planned`
* Add a version to the storage key, for example:

```text
trades:open:v2
trades:closed:v2
trades:planned:v2
```

This prevents old LocalStorage layouts from corrupting new column configurations.

---

# 2. Critical: optional columns were not implemented

The current implementation only defines the default visible columns. A column selector cannot expose a field that does not exist in the table’s column definitions.

## 2.1 Open table

### Currently implemented

1. Symbol
2. Direction
3. Setup
4. Opened
5. Holding Period
6. Size
7. Open Avg Cost
8. Market
9. Active Stop
10. Unrealized P&L
11. Total P&L
12. Open Risk
13. Risk to Account
14. Actions

These are present in the current source.

### Missing optional columns

Add the following columns, hidden by default:

* Avg Entry
* Avg Exit
* Gross Realized P&L to Date
* Net Realized P&L to Date
* Realized Fees to Date
* Gross Unrealized P&L
* Net Unrealized P&L
* Market Value
* Position Weight %
* Distance to Stop %
* Mark-to-Stop Exposure
* Remaining Risk %
* Initial Risk
* Initial Risk %
* Locked-in P&L
* Return %
* Open R-Multiple
* Entry Fill Count
* Exit Fill Count
* Account
* Sector
* Grade
* Current-price timestamp
* Current-price age/status

Several of these values already exist in `TradeMetricsResult`, including average prices, fees, initial risk, return, market value and position weight. They only need corresponding column definitions.

The following require additional computation:

* Distance to Stop %
* Mark-to-Stop Exposure
* Remaining Risk %
* Locked-in P&L
* Execution counts
* Price-age classification
* Grade joins

---

## 2.2 Closed table

### Currently implemented

1. Symbol
2. Direction
3. Setup
4. Entry Date
5. Exit Date
6. Holding Period
7. Size
8. Avg Entry
9. Avg Exit
10. Gross P&L
11. Fees
12. Net P&L
13. Return %
14. R-Multiple
15. Actions

These required default columns are present.

### Missing optional columns

Add, hidden by default:

* Initial Risk
* Initial Risk %
* Total Entry Notional
* Execution Count
* Entry Fill Count
* Exit Fill Count
* MFE
* MAE
* Account
* Sector
* Grade
* Followed Plan
* Rule Violation
* Highest Mistake Severity
* Thesis
* Exit Notes
* Lesson

MFE and MAE require market-data calculations and are not currently part of `TradeMetricsResult`.

---

## 2.3 Planned table

### Currently implemented

The current source defines only 12 columns:

1. Symbol
2. Direction
3. Setup
4. Planned Date
5. Planned Size
6. Entry Trigger
7. Stop
8. Target
9. Planned Risk
10. Risk to Account
11. Planned R:R
12. Actions

The milestone commit claimed 13 Planned columns, but the current code defines 12.

### Missing optional columns

Add, hidden by default:

* Account
* Sector
* Thesis
* Invalidation
* Pre-trade Plan
* Planned Capital
* Target 2
* Market Condition
* Date Added
* Expiration Date
* Distance to Trigger
* Current Market Price

An `expirationDate` field does not currently exist in the trade schema and would require a migration.

---

# 3. Critical: date filtering uses the wrong date field

The agreed date semantics were:

| Tab     | Date field                        |
| ------- | --------------------------------- |
| Open    | Do not hide active positions      |
| Closed  | `closedAt`                        |
| Planned | `createdAt` or future `plannedAt` |

The current API always applies date conditions to `trades.openedAt`:

```ts
gte(trades.openedAt, from)
lte(trades.openedAt, to)
```

This happens regardless of trade status.

The frontend also sends `from` and `to` to all three tab requests.

## Consequences

### Open trades

An active position opened before the selected period disappears from the risk-management table.

That is unacceptable. Current positions must always remain visible.

### Closed trades

Closed trades are filtered based on entry date rather than closing date.

Example:

```text
Opened: December 2025
Closed: January 2026
Filter: 2026 YTD
```

This trade would incorrectly be excluded from 2026 closed-trade performance.

### Planned trades

Planned trades generally have `openedAt = null`.

When a date filter is active, planned trades may all disappear because the API compares a null `openedAt` against the date boundary.

## Required correction

Select the filter column based on status:

```ts
switch (status) {
  case 'closed':
    dateColumn = trades.closedAt;
    break;

  case 'planned':
    dateColumn = trades.createdAt;
    break;

  case 'open':
    dateColumn = null; // ignore global date range
    break;
}
```

Open positions may optionally have a separate secondary filter called:

```text
Opened within period
```

but it must be off by default.

---

# 4. Date presets are not true trailing periods

The latest implementation includes:

* Max
* YTD
* 1Y
* 6M
* 3M
* MTD
* 1M

However, `monthsAgo()` sets the date to the first day of the historical month.

For example, on July 30:

```text
1M currently starts June 1
Expected trailing 1M starts June 30
```

Similarly:

```text
3M currently starts April 1
Expected trailing 3M starts April 30
```

## Required correction

Use exact calendar subtraction:

```ts
const d = new Date(today);
d.setMonth(d.getMonth() - n);
```

The required labels should include:

* YTD
* 12M
* 3M
* 1M
* Custom
* All

Additional presets such as MTD and 6M are acceptable.

The initial default should be **YTD**, not an empty/Max range, unless a previously saved user selection exists.

Date-bound conversion must also respect the configured application timezone rather than constructing UTC boundaries with:

```ts
T00:00:00.000Z
T23:59:59.999Z
```

---

# 5. Critical: Active Stop is incomplete

The required definition was:

```text
Active Stop =
latest stop adjustment
or initial stop if no adjustment exists
```

The current metrics input only contains:

```ts
initialRiskAmount
accountEquityAtOpen
```

It does not include `initialStopPrice`.

The current calculation sets Active Stop exclusively from stop adjustments:

```ts
const activeStop =
  stopAdjustments.length > 0
    ? stopAdjustments[stopAdjustments.length - 1].stopPrice
    : null;
```

Therefore, a newly opened trade with a valid initial stop but no stop adjustment returns:

```text
Active Stop      —
Open Risk        —
Risk to Account  —
```

The API also drops `initialStopPrice` when constructing the risk-snapshot input.

## Required correction

Extend `RiskSnapshotData`:

```ts
interface RiskSnapshotData {
  initialRiskAmount: number | null;
  accountEquityAtOpen: number | null;
  initialStopPrice: number | null;
}
```

Then calculate:

```ts
const latestAdjustment = sortedStopAdjustments.at(-1)?.stopPrice;

const activeStop =
  latestAdjustment ??
  riskSnapshot?.initialStopPrice ??
  null;
```

Stop adjustments must be explicitly sorted by `adjustedAt`; the current implementation assumes database-return order.

---

# 6. Critical: Open Risk may become negative

The required formula used:

```text
max(0, calculated risk)
```

The implementation does not clamp the result:

```ts
(openAvgCost - activeStop) × quantity
```

or the short equivalent.

When a long stop is above cost:

```text
Open Avg Cost: $20
Stop:          $22
Quantity:      100
```

the code returns:

```text
Open Risk = -$200
```

and Risk to Account also becomes negative.

That should instead be:

```text
Open Risk = $0
Locked-in P&L = $200
```

## Required correction

```ts
const rawRisk = ...;
const openRisk = Decimal.max(0, rawRisk);
```

Add a separate optional `lockedPnl` metric.

---

# 7. Critical: Risk to Account does not use current account equity

The API currently derives `currentAccountEquity` from:

```ts
account.startingBalance
  ?? settings.startingAccountValue
  ?? null
```

This is not current equity or net liquidation value.

It ignores:

* Deposits
* Withdrawals
* Closed-trade P&L
* Current unrealized P&L
* Fees
* Account rollforward

As a result:

* Risk to Account can be materially incorrect.
* Position Weight can be materially incorrect.
* Portfolio Heat cannot be trusted.

## Required correction

Use one canonical account-equity service already shared by:

* Account overview
* Dashboard
* Risk metrics
* Trade list
* Position sizing

The denominator should be:

```text
Current account equity / net liquidation value
```

If current equity cannot be determined, return `null`; do not silently fall back to starting balance for a field labeled Current Risk to Account.

---

# 8. Critical: Planned Risk to Account is always unavailable

The Planned table displays:

```ts
row.metrics.risk.riskToAccount
```

But a planned trade has:

* No executions
* No FIFO open quantity
* No open average cost
* No open risk

The metrics tests explicitly expect `riskToAccount === null` for planned trades.

Therefore, the Planned table’s Risk to Account column cannot display the requested value.

## Required correction

Calculate planned risk independently:

```text
Planned Risk =
abs(planned entry − planned stop)
× planned quantity
```

```text
Planned Risk to Account % =
Planned Risk
÷ current account equity
× 100
```

Return these as explicit fields:

```ts
plannedRisk
plannedRiskToAccountPct
plannedCapital
```

Do not reuse open-position risk metrics for planned trades.

---

# 9. Critical: row and footer Unrealized P&L use different definitions

The Open-row column reads the flat `unrealizedPnl` property.

The API sets that flat field to:

```ts
metrics.unrealizedPnl.grossUnrealizedPnl
```

The Open totals footer displays:

```ts
totals.netUnrealizedPnl
```

Therefore, the footer may not equal the sum of the visible row values.

## Required correction

Choose and label the default explicitly.

Recommended:

```text
Row:    Unrealized P&L       = gross unrealized
Footer: Unrealized P&L       = gross unrealized
Optional column: Net Unrealized P&L
```

Or use net unrealized everywhere.

Do not display gross values in rows and net values in the subtotal under the same label.

---

# 10. Critical: pagination is missing

The API supports:

```text
page
limit
```

and the Trades page uses a page size of 50.

However:

* There is no page state per tab.

* There are no Previous/Next controls.

* There is no page-number control.

* Every filter refresh calls `fetchTab(tab, 1)`.

* Only the first 50 trades are accessible.

## Required implementation

Maintain page independently for each tab:

```ts
{
  open: 1,
  closed: 1,
  planned: 1
}
```

Render:

```text
Previous    Page 1 of 4    Next
```

Reset the active tab’s page to 1 when its filters change.

---

# 11. Totals remain incomplete

## Open totals currently shown

* Net Unrealized P&L
* Total Open Risk

## Required Open totals

* Open-trade count
* Total Market Value
* Gross Realized P&L to Date
* Net Realized P&L to Date
* Gross Unrealized P&L
* Net Unrealized P&L
* Total Net P&L
* Total Open Risk
* Portfolio Heat %

## Closed totals currently shown

* Gross P&L
* Fees
* Net P&L

## Required Closed totals

* Closed-trade count
* Gross P&L
* Fees
* Net P&L
* Total Initial Risk
* Aggregate R

```text
Aggregate R =
total net P&L / total initial risk
```

## Planned totals currently shown

None. The component explicitly returns nothing for Planned totals.

## Required Planned totals

* Planned-trade count
* Total Planned Capital
* Total Planned Risk
* Hypothetical Planned Heat %

---

# 12. Portfolio Heat is not implemented

The API returns:

```ts
totalOpenRisk
```

but it does not return:

```ts
portfolioHeatPct
```

Portfolio Heat must be calculated per account:

```text
Portfolio Heat % =
total open risk for account
÷ current account equity
× 100
```

When All Accounts is selected:

* Return heat grouped by account, or
* Do not show one combined percentage.

A single percentage across accounts with different equity bases is not meaningful.

---

# 13. Multi-currency totals are incorrect

Accounts support independent currencies.

The API nevertheless adds all matching numeric values into one totals object without grouping or conversion.

This can produce an invalid total such as:

```text
USD 500 + EUR 300 = 800
```

## Required correction

When All Accounts is selected:

* Group totals by currency, or
* Convert to a selected base currency using an explicit FX rate, timestamp and source.

The response should resemble:

```ts
totalsByCurrency: {
  USD: {...},
  EUR: {...}
}
```

---

# 14. Actions column is a placeholder, not a feature

The ellipsis button:

* Has no click handler
* Has no menu
* Has no actions
* Does not stop event propagation

The source explicitly calls it a placeholder.

Because the row itself is clickable, clicking the ellipsis will likely navigate to the trade-detail page rather than open an actions menu.

## Required actions

### Open

* View
* Add Exit
* Add Execution
* Adjust Stop
* Edit Trade

### Closed

* View
* Review
* Edit
* Export
* Delete

### Planned

* View
* Execute
* Edit Plan
* Cancel/Delete

The button must call `event.stopPropagation()`.

---

# 15. Plan Trade and Export controls disappeared

The redesigned page does not render:

* Plan Trade button
* CSV Export button
* Refresh prices button

The empty state tells the user to use a Plan Trade button, but no such button exists on the page.

Restore these controls in the page header:

```text
Trades                     [Export] [Refresh] [Plan Trade]
```

Export must include the currently selected:

* Status tab
* Account
* Date range
* Direction, once added

---

# 16. Direction filter is backend-only

The API supports a `direction` query parameter, but the Trades page does not provide a Long/Short filter.

Add:

```text
Direction: All | Long | Short
```

This should persist alongside the date and account filters.

---

# 17. Over-exits are still accepted

The execution POST route validates:

* Direction/action compatibility
* Positive quantity
* Positive price

It does not validate that an exit quantity is less than or equal to the current open quantity. The execution is inserted before the position is recalculated.

The metrics engine then caps the matched exit quantity and effectively ignores excess quantity when calculating the open position.

## Required correction

Before inserting an exit:

```ts
if (requestedExitQty > currentOpenQty) {
  return 409:
  "Exit quantity exceeds the open position."
}
```

Position reversal must be a separate explicit workflow.

---

# 18. Derived P&L fields create a duplicate source of truth

The `trades` table now contains:

* `grossRealizedPnl`
* `netRealizedPnl`
* `realizedFees`

However, the list API calculates these metrics from executions on demand and does not use those stored fields.

This creates two possible sources of truth.

## Required decision

Either:

### Option A — preferred initially

Remove the stored derived fields and calculate from executions.

### Option B — explicit cache

Treat them as a projection cache with:

* Calculation version
* `calculatedAt`
* Invalidation after execution changes
* Rebuild command
* Reconciliation tests

Do not leave unused nullable financial fields in the authoritative trade record.

---

# 19. List API returns excessive debugging detail

`TradeMetricsResult` includes:

* Remaining FIFO lots
* Every FIFO match

These are useful for detailed inspection but unnecessary in every row returned by the Trades list API.

Return a compact list model:

```ts
TradeListMetrics
```

Reserve full:

```ts
remainingLots
matches
```

for:

* Trade-detail endpoint
* Debug endpoint
* Reconciliation tools

This will reduce response size as trade history grows.

---

# 20. Testing gaps

The calculation tests cover FIFO extensively, but the missing functionality requires additional tests.

## Required unit/integration tests

* Initial stop used when no adjustment exists
* Stop adjustment overrides initial stop
* Stop beyond breakeven produces zero Open Risk
* Locked P&L is positive when stop protects profit
* Planned Risk to Account calculation
* Current-equity denominator
* Exit larger than open quantity rejected
* Closed dates filtered using `closedAt`
* Planned dates filtered using `createdAt`
* Open positions remain visible under date filters
* Multi-currency totals do not combine directly
* Gross row values reconcile to gross footer
* Net row values reconcile to net footer
* Full-dataset totals reconcile across pagination

## Required Playwright tests

1. Open Columns menu.
2. Hide a column.
3. Confirm it disappears.
4. Reload the page.
5. Confirm visibility persists.
6. Restore the column.
7. Reset to defaults.
8. Confirm Open, Closed and Planned have independent layouts.
9. Navigate to page 2 and back.
10. Confirm filters and tab layout remain intact.

The latest commit does not have reported GitHub status checks, so the current head should not be treated as independently CI-verified.

---

# Required priority order

## P0 — correctness and usability blockers

1. Add column selector and reset controls.
2. Define all optional columns.
3. Correct status-specific date filtering.
4. Keep all Open positions visible.
5. Add initial-stop fallback.
6. Clamp Open Risk to zero.
7. Use current account equity.
8. Calculate Planned Risk to Account separately.
9. Resolve gross/net Unrealized P&L mismatch.
10. Add pagination.
11. Reject over-exits.
12. Correct multi-currency totals.

## P1 — complete the specified product

1. Add Portfolio Heat.
2. Complete Open, Closed and Planned totals.
3. Implement Actions menus.
4. Restore Plan Trade, Export and Refresh buttons.
5. Add Direction filter.
6. Add missing optional columns.
7. Add price freshness indicators.

## P2 — architecture and maintenance

1. Resolve duplicate stored P&L fields.
2. Return a compact list API model.
3. Version persisted column layouts.
4. Add full UI and API acceptance tests.

---

# Updated definition of done

The milestone may be marked complete only when:

* A user can select, hide, show and reset columns independently for each tab.
* Every required and optional field listed above exists as a selectable column.
* Open trades are never hidden by the global date filter.
* Closed trades filter by close date.
* Planned trades filter by planned/created date.
* Active Stop falls back to the initial stop.
* Open Risk never becomes negative.
* Risk to Account uses current account equity.
* Planned Risk to Account displays a real value.
* Row and footer P&L definitions reconcile exactly.
* All matching records can be accessed through pagination.
* Portfolio Heat is available by account.
* Totals are currency-safe.
* Actions menus perform real actions.
* Plan Trade and Export are available.
* Over-exits are rejected.
* The test suite covers all of the above.
