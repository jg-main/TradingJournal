# Trades Page Final Accuracy Review

## Overall assessment

The Trades implementation is now **mostly correct**, particularly for individual trade calculations.

The following previously reported issues have been addressed:

- Account displays a human-readable name.
- Sector displays the resolved lookup name when a sector has been assigned.
- Risk and return percentages now follow the decimal-fraction contract.
- FIFO weighted averages and realized P&L remain correct.
- Active Stop uses the stored initial stop and subsequent stop adjustments.
- Stop adjustments are consumed by both Trade Detail and Trades.
- Current account NAV is sourced primarily from `account_performance.nav`.
- Trade Detail now consumes canonical API metrics.
- Open trades without a market price no longer display misleading Total P&L.
- Placeholder-only columns were removed.
- Column selection, persistence and pagination are available.

These changes are supported by the new cross-surface integration suite, which verifies percentage display, stop propagation, FIFO scale-ins, partial exits, friendly names, NAV sourcing, short risk and missing-market-price behavior.

However, the milestone should not yet be marked fully complete. The remaining issues below should be corrected.

---

# 1. Required Open Positions Total redesign

## Current behavior

The Open footer currently displays:

```text
OPEN POSITIONS TOTAL
Unrealized P&L
Open Risk

BY CURRENCY
USD
Unrealized P&L
Open Risk
Portfolio Heat
```

Portfolio Heat is only shown inside the USD currency subsection. This duplicates the same totals and unnecessarily separates them by currency.

The application is currently USD-only, so a currency breakdown adds no value.

## Required design

Remove the entire **By Currency** section from the Trades page.

Display a single Open Positions Total section:

```text
OPEN POSITIONS TOTAL

Unrealized P&L       $XXX.XX
Portfolio Heat $     $XXX.XX
Portfolio Heat %       X.XX%
Open Positions             N
```

`Portfolio Heat $` is the same amount currently called `totalOpenRisk`.

```text
Portfolio Heat $ =
sum of Open Risk at Stop for all filtered open positions
```

```text
Portfolio Heat % =
Portfolio Heat $
÷
current account NAV
```

For multiple USD accounts:

```text
Portfolio Heat % =
sum of Open Risk across selected accounts
÷
sum of unique current NAVs across those accounts
```

Do not sum each trade’s Risk to Account percentage.

## Recommended API contract

Replace the ambiguous fields with:

```ts
interface OpenTradeTotals {
  count: number;
  netUnrealizedPnl: number;
  totalNetPnl: number | null;
  portfolioHeatAmount: number;
  portfolioHeatPct: number | null;
}
```

`portfolioHeatPct` should use the same percentage contract as every other percentage:

```text
0.0125 means 1.25%
```

The frontend should render it through the shared percentage formatter.

Do not maintain a special Portfolio Heat contract where:

```text
1.25 means 1.25%
```

while Risk to Account uses:

```text
0.0125 means 1.25%
```

The current API uses the inconsistent percentage-points contract for Portfolio Heat.

## Remove

The following can be removed from the Trades response and frontend state while the application is USD-only:

```ts
totalsByCurrency;
tabTotalsByCurrency;
currencyEquityByAccount;
allAccountCurrencyMap;
```

The account currency field can remain on individual rows for future use.

---

# 2. P0 — Aggregate Open Risk can disagree with row-level Open Risk

## Root cause

The paginated row calculation correctly passes these risk snapshot values:

```ts
initialRiskAmount;
accountEquityAtOpen;
initialStopPrice;
initialEntryPrice;
```

However, the full-dataset totals calculation only passes:

```ts
initialRiskAmount;
accountEquityAtOpen;
```

It omits the stored `initialStopPrice`.

When there is no stop adjustment, the totals calculation can therefore reconstruct a stop from risk amount rather than using the exact stored stop.

This is particularly incorrect after a scale-in.

## Example

```text
Initial entry: 10 shares at $50
Initial stop: $45
Initial risk: $50

Add: 10 shares at $60
Open average cost: $55
```

### Row calculation

Uses exact stored stop:

```text
Open Risk = ($55 − $45) × 20
          = $200
```

### Aggregate calculation

May reconstruct:

```text
Risk per share = $50 / 20
               = $2.50

Derived stop = $55 − $2.50
             = $52.50

Open Risk = ($55 − $52.50) × 20
          = $50
```

The table row could display `$200`, while Portfolio Heat displays only `$50`.

## Required correction

Pass the complete risk snapshot in both calculation paths:

```ts
riskSnapshot: riskSnapshot
  ? {
      initialRiskAmount: riskSnapshot.initialRiskAmount,
      accountEquityAtOpen: riskSnapshot.accountEquityAtOpen,
      initialStopPrice: riskSnapshot.initialStopPrice,
      initialEntryPrice: riskSnapshot.initialEntryPrice,
    }
  : null;
```

Avoid maintaining two separate blocks that build `TradeMetricsInput`.

Create one shared function:

```ts
buildTradeMetricsInput({
  trade,
  executions,
  riskSnapshot,
  stopAdjustments,
  currentMark,
  currentAccountEquity,
});
```

Use it for:

- Paginated rows
- Full-dataset totals
- Trade Detail
- Dashboard

---

# 3. P0 — Full-dataset NAV lookup depends on the current page

## Root cause

`accountPerfMap` is populated using account IDs found in the current paginated result.

The full totals section later processes all matching trades but reuses that page-level `accountPerfMap`.

## Failure case

Assume:

- 75 open trades
- Page size 50
- Account A appears on page 1
- Account B only appears on page 2
- Account B has an authoritative NAV in `account_performance`

When page 1 is loaded:

- Account A NAV is loaded into `accountPerfMap`.
- Account B NAV may not be loaded.
- Full-dataset Portfolio Heat processes Account B but may fall back to rollforward, starting balance or global settings.

The footer can therefore use a different NAV from the Account page.

## Required correction

For full-dataset totals, fetch `account_performance` using:

```ts
allUniqueAccountIds;
```

not the current page’s `uniqueAccountIds`.

Better:

```ts
const allAccountContext = await loadAccountMetricContext(allUniqueAccountIds);
```

The footer totals must be independent of which pagination page is currently displayed.

## Required test

Create more than 50 open trades across at least two accounts, with the second account absent from page 1.

Verify:

```text
Portfolio Heat on page 1
=
Portfolio Heat on page 2
=
Portfolio Heat from all matching trades and authoritative NAVs
```

---

# 4. P0 — Editing an Open trade still exposes a misleading Stop Loss field

The generic Edit Trade dialog remains available at every lifecycle stage and states:

```text
Changes apply at any stage.
```

It exposes a field called:

```text
Stop Loss
```

but saves that field as:

```ts
plannedStop;
```

through `PUT /api/trades/:id`.

For an Open trade, changing this value does not create an active stop adjustment and therefore should not change:

- Active Stop
- Open Risk
- Risk to Account
- Portfolio Heat

This preserves the same ambiguity that originally caused the WKC issue.

## Required correction

### Planned trade

Show:

```text
Planned Stop
```

and allow it to update `plannedStop`.

### Open trade

Either hide the stop field from Edit Trade or show it read-only as:

```text
Original Planned Stop
```

Active stop changes must use:

```text
Adjust Stop
```

and create a `trade_stop_adjustments` record.

### Closed trade

Stop fields should be historical and read-only.

The dialog needs a lifecycle/status prop:

```ts
tradeStatus: "planned" | "open" | "closed";
```

Do not use the generic label “Stop Loss” for both planned and active stops.

---

# 5. P1 — Distance to Stop remains incorrect

## Current formula

```ts
((currentPrice - activeStop) / currentPrice) * 100;
```

The returned value is then passed to `PercentCell`, which multiplies it by 100 again.

## Example

```text
Market = $100
Stop   = $95
```

Current accessor returns:

```text
5
```

`PercentCell` displays:

```text
500.00%
```

Expected:

```text
5.00%
```

The formula is also Long-only.

## Correct formulas

### Long

```ts
(currentPrice - activeStop) / currentPrice;
```

### Short

```ts
(activeStop - currentPrice) / currentPrice;
```

Recommended implementation:

```ts
function computeDistanceToStop(
  direction: "long" | "short",
  marketPrice: number,
  activeStop: number,
): number {
  return direction === "long"
    ? (marketPrice - activeStop) / marketPrice
    : (activeStop - marketPrice) / marketPrice;
}
```

Add Long and Short rendering tests.

---

# 6. P1 — Planned Distance to Trigger is also 100× too large

The Planned table calculates:

```ts
((currentPrice - plannedEntry) / plannedEntry) * 100;
```

and then passes the result into `PercentCell`.

Remove `* 100`.

The calculation should also be direction-aware.

### Long

Positive distance should normally mean the price is below the trigger and still has distance remaining:

```ts
(plannedEntry - currentPrice) / plannedEntry;
```

### Short

```ts
(currentPrice - plannedEntry) / plannedEntry;
```

The team should explicitly define whether:

- Positive means “distance remaining,” or
- Positive means “price has moved beyond trigger.”

The current formula does not document this semantic.

---

# 7. P1 — Planned footer does not honor the date filter

The visible Planned table filters trades by `createdAt`.

However, `plannedTotals` performs a separate query that only applies:

- Planned status
- Account filter
- Direction filter

It explicitly does not apply the selected date range.

## Consequence

The table may show:

```text
3 planned trades
```

while the footer reports totals for:

```text
12 planned trades
```

## Required correction

The Planned subtotal must use exactly the same filter predicate as the Planned table.

Preferred approach:

- Reuse the existing `whereClause`, or
- Aggregate from the complete filtered Planned result set.

The `count` in the Planned footer should equal the tab count.

---

# 8. P1 — Market Condition still displays a UUID

Account and Sector names are now resolved correctly.

However, the optional Planned `Market Condition` column still renders:

```ts
marketConditionId;
```

directly.

Return and display:

```ts
marketConditionName;
```

in the same manner as `sectorName`.

No user-facing table column should expose a database UUID.

---

# 9. P1 — Sector resolution remains manual-only

The current implementation resolves `sectorName` only when `trades.sectorId` is populated.

If the trade has no manually assigned sector but the latest security profile contains:

```text
position_price_snapshots.sector
```

the Trades page still displays `—`.

Recommended resolution order:

```text
1. Explicit trade sector lookup
2. Latest instrument/profile sector
3. null
```

The fallback should be display-only. It should not silently overwrite the manually curated trade sector.

This item is optional if the intended product rule is that Sector must always be manually classified.

---

# 10. P1 — Date presets are not trailing periods

The current helper creates 1M, 3M and 6M dates on the first day of the earlier month:

```ts
new Date(year, month - n, 1);
```

On July 30:

```text
1M begins June 1
3M begins April 1
6M begins January 1
```

Those are not trailing periods.

Expected:

```text
1M begins June 30
3M begins April 30
6M begins January 30
```

Use calendar subtraction while preserving the day where possible.

The default is also still All/Max rather than YTD when there is no saved selection.

---

# 11. P1 — Date boundaries are forced to UTC

The frontend constructs:

```text
YYYY-MM-DDT00:00:00.000Z
YYYY-MM-DDT23:59:59.999Z
```

The user’s configured timezone is not considered.

For a Bogotá reporting day, UTC boundaries can include or exclude records from the wrong local date.

Date filters should be interpreted in the application timezone and then converted to UTC.

---

# 12. P1 — Actions menu can trigger row navigation

Every table row has an `onClick` navigation handler.

The Actions menu trigger is a button inside that row but does not stop event propagation.

Add:

```tsx
onClick={(event) => event.stopPropagation()}
```

and also prevent propagation from menu interactions where required.

Required browser test:

1. Click the ellipsis.
2. Confirm the menu opens.
3. Confirm the page has not navigated.
4. Select an action.
5. Confirm only the selected action occurs.

---

# 13. P1 — Stop tie-breaking should not depend on stop price

When two stop adjustments have the same timestamp, the canonical engine chooses the larger stop price.

This is not a valid chronology rule:

- For a Long trade, a larger stop is usually tighter.
- For a Short trade, a smaller stop is usually tighter.
- Neither proves which record was entered last.

Use a deterministic event sequence:

```text
adjustedAt
createdAt
id
```

or preferably a monotonic sequence field.

The active stop should represent the latest event, not the numerically largest stop.

The current integration tests codify “largest stop wins” and should be revised.

---

# 14. P2 — Holding period for Open trades depends on quote timestamp

For an Open trade, Holding Period is calculated from entry time to the current market mark timestamp.

If the quote is stale, the holding period is also stale.

Holding Period should generally use:

```text
current application time − openedAt
```

Market-price age should remain a separate field.

---

# 15. P2 — Decimal arithmetic is not universal

Most critical trade calculations use `decimal.js`.

However, some aggregates still use ordinary JavaScript number addition, including:

- Total execution fees
- Full-dataset totals
- Planned totals

This is unlikely to create a visible error for small retail datasets, but it contradicts the module’s guarantee that financial arithmetic uses decimal arithmetic.

For strict accounting consistency, aggregate with Decimal and convert only at the API boundary.

---

# Required priority

## P0 — Must fix before completion

1. Replace Open totals with Portfolio Heat in dollars and percentage.
2. Remove the USD By Currency duplicate section.
3. Pass `initialStopPrice` into full-dataset aggregate calculations.
4. Load authoritative NAV for every account in the complete filtered dataset.
5. Prevent the generic Open-trade Edit dialog from appearing to edit Active Stop.

## P1 — Correctness and UX

1. Correct Distance to Stop.
2. Correct Distance to Trigger.
3. Apply date filters to Planned totals.
4. Resolve Market Condition names.
5. Correct trailing date presets.
6. Use application-timezone date boundaries.
7. Stop Actions-menu event propagation.
8. Replace stop-price tie-breaking with event chronology.

## P2 — Hardening

1. Use current time for Open holding periods.
2. Use Decimal for monetary aggregation.
3. Add automatic sector fallback if desired.

---

# Required acceptance tests

## Open totals

Given:

```text
Trade A Open Risk = $100
Trade B Open Risk = $150
Current NAV       = $20,000
```

Expected:

```text
Portfolio Heat $ = $250.00
Portfolio Heat % = 1.25%
```

No By Currency section should appear.

## Aggregate scale-in

Create a scaled-in position with:

- Exact stored initial stop
- No stop adjustment

Assert:

```text
sum of row Open Risk
=
Portfolio Heat $
```

## Pagination and NAV

Create more than 50 open trades across multiple USD accounts.

Assert Portfolio Heat is identical on every pagination page.

## Percentage optional columns

Assert:

```text
Market $100, Long stop $95
Distance to Stop = 5.00%
```

and:

```text
Market $100, Short stop $105
Distance to Stop = 5.00%
```

## Planned totals

Apply a date filter and verify:

```text
Planned footer count = Planned tab count
```

## Active stop workflow

On an Open trade:

- Generic Edit must not present an editable Active Stop field.
- Adjust Stop must create a stop-adjustment event.
- Trades row and Portfolio Heat must update after saving.

---

# Completion verdict

The individual trade metrics engine is now suitable for normal use in the tested scenarios:

- FIFO matching
- Weighted average entry and exit
- Gross and net realized P&L
- Net unrealized P&L
- Open quantity
- Open average cost
- Active Stop
- Open Risk
- Risk to Account
- Initial Risk
- Return %
- R-Multiple

The Trades page is **not yet fully complete** because aggregate Portfolio Heat can diverge from row-level risk, several optional percentage columns are still incorrect, Planned totals do not match filtered results, and the Open-trade editing workflow still exposes a misleading Stop Loss field.

After the P0 items and percentage-column corrections are implemented, the Trades page can reasonably be considered complete.
