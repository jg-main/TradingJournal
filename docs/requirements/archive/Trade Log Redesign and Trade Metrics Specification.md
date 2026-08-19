# Trade Log Redesign and Trade Metrics Specification

## 1. Objective

Redesign the Trades page so it provides a complete and financially consistent view of:

* Planned trades
* Current open positions
* Completed trades
* Realized and unrealized performance
* Commissions and other transaction charges
* Position-level risk
* Account-level aggregate risk

The Trades page must use the same canonical calculations that will later support:

* Dashboard KPIs
* Account performance
* Equity curves
* Setup analytics
* Weekly reviews
* Trade-detail pages

Financial calculations must be performed on the server through one shared calculation module. The frontend must only display and format the returned values.

---

## 2. Page structure

Replace the current combined table with three distinct tables presented as tabs:

1. **Open**
2. **Closed**
3. **Planned**

Each tab must have:

* Independent column definitions
* Independent sorting
* Persistent column visibility
* Trade count
* Table-level currency totals
* Pagination
* Account filter
* Date-range controls where applicable

Recommended header:

```text
Trades

[Open 3] [Closed 47] [Planned 5]

Account: [All Accounts]
Period:  [YTD] [12M] [3M] [1M] [Custom] [All]
Columns
Export
Plan Trade
```

Do not render three long tables vertically. Each status represents a different workflow and requires different fields.

### Date-range options

Provide:

* YTD
* Trailing 12 months
* Trailing 3 months
* Trailing 1 month
* Custom range
* All time

Default: **YTD**.

### Date-field semantics

The period filter must use the following dates:

| Table   | Date used                                               |
| ------- | ------------------------------------------------------- |
| Closed  | `closedAt`                                              |
| Planned | `createdAt`, until a dedicated `plannedAt` field exists |
| Open    | Open positions must always remain visible               |

The global date range must never hide an existing open position. Risk management screens should always show every current position.

An optional secondary Open-table filter may later provide:

```text
Opened within selected period
```

but it must not be enabled by default.

### Aggregates and pagination

Subtotals must represent the **entire filtered result set**, not only the current page of 50 rows.

The API response should therefore contain:

```ts
{
  data: TradeMetrics[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
  totals: TradeTableTotals;
}
```

---

## 3. Source-of-truth rules

### Stored source-of-truth data

The following records are authoritative:

* Trade metadata
* Execution timestamp
* Execution action
* Execution quantity
* Execution price
* Execution commissions and fees
* Trade direction
* Initial risk snapshot
* Stop adjustments
* Market-price marks
* Account-equity snapshots

Execution records must be immutable except through an explicit correction workflow.

### Derived values

The following must not be manually entered or independently maintained:

* Entry quantity
* Exit quantity
* Open quantity
* Weighted average entry
* Weighted average exit
* Remaining FIFO cost basis
* Gross realized P&L
* Net realized P&L
* Unrealized P&L
* Open risk
* Risk to account
* Return percentage
* R-multiple
* Holding period
* Trade status

These values must be derived from the underlying executions, risk records, stops, account equity and market marks.

### Trade status

Status should be derived as:

```text
No entry fills                   → Planned
Entry quantity > exit quantity  → Open
Entry quantity = exit quantity  → Closed
```

An exit that exceeds the current open quantity must be rejected unless position reversal is explicitly supported.

Do not silently cap excess exit quantity.

---

## 4. Execution ordering and FIFO

FIFO matching must sort executions using:

1. `executedAt`
2. A deterministic execution sequence or execution ID as a tie-breaker

FINRA describes FIFO as matching a sale against the earliest acquired shares when another lot-selection method is not used. Broker reporting systems also commonly expose FIFO or explicitly selected tax-lot methods.

### FIFO algorithm

Maintain a queue of open entry lots.

Each entry creates a lot:

```ts
{
  executionId: string;
  quantityRemaining: Decimal;
  entryPrice: Decimal;
  entryFeeRemaining: Decimal;
  executedAt: string;
}
```

Each exit consumes the oldest available lot.

For every matched portion:

#### Long

```text
Gross realized P&L =
(exit price − entry-lot price) × matched quantity
```

#### Short

```text
Gross realized P&L =
(entry-lot price − exit price) × matched quantity
```

Entry and exit charges must be allocated proportionally to the matched quantity.

---

## 5. Field definitions

## 5.1 Size

Rename `Qty` to **Size**.

Display:

```text
total entry quantity / total exit quantity
```

Examples:

```text
10 / 0
10 / 4
10 / 10
```

The tooltip or secondary text should show:

```text
Entered: 10
Exited: 4
Open: 6
```

All quantities remain positive. Direction is represented separately as Long or Short.

### Derived values

```text
entryQuantity = sum of entry fills
exitQuantity  = sum of exit fills
openQuantity  = entryQuantity − exitQuantity
```

---

## 5.2 Average Entry

Label: **Avg Entry**

This is the quantity-weighted average across all entry fills:

```text
Avg Entry =
Σ(entry price × entry quantity)
÷
Σ(entry quantity)
```

Do not use SQL `AVG(price)`.

Example:

```text
5 shares at $10
15 shares at $12

Avg Entry = ((5 × 10) + (15 × 12)) / 20
          = $11.50
```

---

## 5.3 Average Exit

Label: **Avg Exit**

This is the quantity-weighted average across all exit fills:

```text
Avg Exit =
Σ(exit price × exit quantity)
÷
Σ(exit quantity)
```

It is available for:

* Fully closed trades
* Partially closed open trades

---

## 5.4 Open Average Cost

Add a separate derived field:

**Open Avg Cost**

This is the average cost of the FIFO lots that remain open after all matched exits.

This is not always equal to Avg Entry.

Example:

```text
Buy 10 at $10
Buy 10 at $20
Sell 10 using FIFO

Avg Entry across the full trade = $15
Remaining FIFO open cost        = $20
```

Unrealized P&L must use the remaining open cost of `$20`, not the historical average entry of `$15`.

Professional brokerage position displays distinguish average position cost and current mark when calculating unrealized P&L.

---

## 5.5 Gross Realized P&L

Label: **Gross P&L**

Definition:

```text
Realized gain or loss from FIFO-matched closed quantity,
before commissions and fees.
```

Gross P&L must be calculated whenever an exit closes any quantity.

Therefore, an Open trade may have:

* Gross realized P&L from partial exits
* Unrealized P&L on its remaining quantity

Do not restrict realized P&L to trades whose status is Closed.

---

## 5.6 Charges

Label: **Fees**

Definition:

```text
Actual commissions, regulatory fees, exchange fees and other
execution-level charges attributable to the realized quantity.
```

For a fully closed trade:

```text
Total fees = all entry fees + all exit fees
```

For a partially closed trade:

* Matched entry fees are allocated proportionally to the closed FIFO lots.
* Exit fees are allocated to the quantities sold.
* Fees attached to remaining open lots remain unrealized/open-position costs.

Transaction reports normally present commissions and other transaction costs separately from realized gain or loss.

The schema may initially retain one execution-level `fees` field, but the domain model should treat it as:

```text
commission + regulatory fees + exchange fees + other charges
```

A future import enhancement may split these into separate fields.

---

## 5.7 Net Realized P&L

Label: **Net P&L**

```text
Net realized P&L =
Gross realized P&L − allocated realized fees
```

This is the principal performance value for Closed trades.

The current `totalRealizedPnL` field should be renamed because it already subtracts all fees and is therefore net rather than gross.

---

## 5.8 Unrealized P&L

Label: **Unrealized P&L**

Use the latest valid market mark and the remaining FIFO open lots.

### Long

```text
Unrealized P&L =
(current market price − open average cost) × open quantity
```

### Short

```text
Unrealized P&L =
(open average cost − current market price) × open quantity
```

This field should represent the gross market-price movement before fees.

Add an optional derived field:

```text
Net Unrealized P&L =
Unrealized P&L − fees remaining on open entry lots
```

Do not subtract estimated future exit commissions unless the field is explicitly labeled as an estimate.

The dashboard and trade-detail page must use the same fee policy. The current code has different fee behavior depending on the caller and should be consolidated.

---

## 5.9 Total P&L

For an Open trade, add:

**Total P&L**

```text
Total P&L =
Net realized P&L to date
+ Net unrealized P&L
```

This gives the complete economic result of a partially closed position.

---

## 5.10 Return percentage

Label: **Return %**

For equities:

```text
Net Return % =
Total net P&L
÷
total entry notional
× 100
```

For a closed trade, Total net P&L equals Net realized P&L.

Do not add or average individual row returns to create table totals.

---

## 6. Risk definitions

CME risk-management guidance emphasizes defining the stop, risk per trade, position size, maximum trade loss and maximum aggregate account exposure before entering positions.

## 6.1 Initial Risk

Label: **Initial Risk**

Stored at the first execution as a historical snapshot:

### Long

```text
Initial Risk =
(initial entry price − initial stop price) × initial quantity
```

### Short

```text
Initial Risk =
(initial stop price − initial entry price) × initial quantity
```

Use absolute positive currency values.

Do not change Initial Risk when:

* More shares are added
* Shares are sold
* The stop is adjusted
* Account equity changes

If later entries increase total position risk, record an additional risk event or expose a separate **Peak Risk** metric.

---

## 6.2 Initial Risk to Account

Label: **Initial Risk %**

```text
Initial Risk % =
Initial Risk
÷
account equity at first execution
× 100
```

This value must use the stored `accountEquityAtOpen` snapshot so historical trades do not change when account equity changes later.

---

## 6.3 Active Stop

Label: **Stop**

The active stop is:

```text
latest stop adjustment
or, if none exists,
the initial stop
```

Stop adjustments should remain stored as an auditable timeline.

---

## 6.4 Open Risk

Label: **Open Risk**

Definition:

```text
Potential loss on the remaining position relative to its
remaining FIFO cost basis if the active stop is executed.
```

### Long

```text
Open Risk =
max(0, open average cost − active stop)
× open quantity
```

### Short

```text
Open Risk =
max(0, active stop − open average cost)
× open quantity
```

When a stop has moved beyond breakeven, Open Risk becomes zero.

Do not show a negative risk value.

---

## 6.5 Risk to Account

Label: **Risk to Account**

```text
Risk to Account % =
Open Risk
÷
current account equity
× 100
```

Use current account equity or net liquidation value, including current unrealized P&L.

Do not use:

* Starting account balance
* Account equity at trade open
* Total buying power
* Margin availability

for the current Risk to Account field.

If current account equity is missing or stale, return `null` and show:

```text
Equity unavailable
```

rather than calculating against an incorrect fallback.

---

## 6.6 Portfolio Heat

Add a subtotal-level metric:

**Portfolio Heat**

```text
Portfolio Heat % =
Σ Open Risk across all open trades in the account
÷
current account equity
× 100
```

This is more useful than viewing trade risk independently because it shows the maximum aggregate planned loss if all current stops are reached.

For multiple accounts, calculate Portfolio Heat independently for each account.

---

## 6.7 Remaining Risk

Optional column:

**Remaining Risk %**

```text
Remaining Risk % =
Open Risk
÷
Initial Risk
× 100
```

Interpretation:

```text
100% = original risk remains
50%  = half the original risk remains
0%   = no original capital remains at risk
```

---

## 6.8 Mark-to-Stop Exposure

Optional column:

**To Stop $**

This is different from Open Risk.

It measures the amount of current marked value that would be surrendered if the stop were hit.

### Long

```text
Mark-to-Stop Exposure =
max(0, market price − active stop)
× open quantity
```

### Short

```text
Mark-to-Stop Exposure =
max(0, active stop − market price)
× open quantity
```

This includes unrealized profit that may be given back and should not be called account risk.

---

## 6.9 Locked-in P&L

Optional column:

**Locked P&L**

When the stop is beyond the remaining cost basis:

### Long

```text
Locked P&L =
max(0, active stop − open average cost)
× open quantity
```

### Short

```text
Locked P&L =
max(0, open average cost − active stop)
× open quantity
```

This should be clearly marked as theoretical because execution may differ from the stop price due to slippage or gaps.

---

## 6.10 Position Weight and Exposure

Add:

### Market Value

```text
Market Value =
market price × open quantity
```

### Position Weight

```text
Position Weight % =
absolute market value
÷
current account equity
× 100
```

At account level, optionally expose:

```text
Gross Exposure % =
sum of absolute market values
÷ current equity
```

```text
Net Exposure % =
(long market value − short market value)
÷ current equity
```

Position value is not the same as capital at risk. Both should be available but never conflated.

---

## 7. Recommended columns

## 7.1 Open table

Default columns:

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

Optional columns:

* Avg Entry
* Avg Exit
* Gross realized P&L to date
* Net realized P&L to date
* Market Value
* Position Weight
* Distance to Stop %
* To Stop $
* Remaining Risk %
* Initial Risk
* Initial Risk %
* Locked P&L
* Return %
* Open R
* Account
* Sector
* Grade

### Open-table footer

Show:

* Number of open trades
* Total market value
* Net realized P&L to date
* Total unrealized P&L
* Total P&L
* Total open risk
* Portfolio Heat

Do not total:

* Prices
* Holding periods
* Position weights
* Row-level percentages

---

## 7.2 Closed table

Default columns:

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

Optional columns:

* Initial Risk
* Initial Risk %
* MFE
* MAE
* Execution count
* Account
* Sector
* Grade
* Followed Plan
* Mistake severity
* Thesis

Professional journal products commonly expose execution count, commissions and fees, initial risk, R-based P&L, MFE and MAE as customizable trade columns.

### Closed-table footer

Show:

* Closed trade count
* Gross P&L
* Total fees
* Net P&L
* Total initial risk
* Aggregate R

Aggregate R should be:

```text
Aggregate R =
total net P&L
÷
total initial risk
```

Do not sum Return %.

---

## 7.3 Planned table

Default columns:

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

Optional columns:

* Account
* Sector
* Thesis
* Invalidation
* Pre-trade plan
* Expiration date

### Planned-table footer

Show:

* Number of planned trades
* Total planned capital
* Total planned risk
* Planned portfolio heat

Planned portfolio heat must be labeled as hypothetical and must not be combined with actual open risk unless the product explicitly provides a combined scenario metric.

---

## 8. Currency handling

Currency totals must never combine unlike currencies directly.

When multiple currencies or accounts are selected:

* Group totals by currency, or
* Convert through an explicit FX rate with rate timestamp and source

Do not display:

```text
USD 500 + EUR 300 = 800
```

without conversion.

---

## 9. Storage versus on-the-fly computation

## Store permanently

Store:

* Executions
* Execution fees
* Initial risk snapshot
* Stop-adjustment history
* Market marks with timestamps
* Account-equity snapshots
* Trade metadata
* Manual trade-review fields

## Calculate on demand

Calculate:

* Size
* Weighted entry
* Weighted exit
* FIFO lot matches
* Remaining open cost
* Gross realized P&L
* Net realized P&L
* Unrealized P&L
* Total P&L
* Open risk
* Risk to account
* Portfolio heat
* Return %
* R-multiple
* Holding period

## Cache only when necessary

Initially calculate metrics server-side through one function:

```ts
computeTradeMetrics({
  trade,
  executions,
  riskSnapshot,
  stopAdjustments,
  currentMark,
  currentAccountEquity,
})
```

Use this function from:

* `GET /api/trades`
* Trade-detail API
* Dashboard API
* Account overview
* Reviews and analytics

Do not duplicate formulas inside React components or individual API routes.

If query performance later becomes a problem, create a recomputable projection such as:

```text
trade_metrics_cache
```

The cache must:

* Be derived from source records
* Include `calculatedAt`
* Include calculation-version metadata
* Be invalidated after executions, fee edits, stop changes or price updates
* Never become the accounting source of truth

---

## 10. Numerical precision

Do not use JavaScript floating-point arithmetic directly for final financial calculations.

Use a decimal arithmetic library such as:

```text
decimal.js
```

or an equivalent fixed-precision implementation.

Rules:

* Preserve execution prices at broker precision
* Preserve fractional quantities
* Perform intermediate calculations without display rounding
* Round only when displaying currency or exporting reports
* Use the account currency’s minor-unit convention for final monetary presentation

---

## 11. Required corrections to the current implementation

### Correction 1: weighted averages

Replace:

```sql
AVG(execution.price)
```

with quantity-weighted calculation or the canonical server calculation service.

### Correction 2: implement actual FIFO

The current implementation applies exits against one average entry price. Replace it with explicit entry-lot matching.

### Correction 3: separate gross and net P&L

Return separate fields:

```ts
grossRealizedPnl
realizedFees
netRealizedPnl
grossUnrealizedPnl
openFees
netUnrealizedPnl
totalNetPnl
```

### Correction 4: use actual execution quantities

The Trades table currently exposes planned quantity as Qty.

Replace it with:

```ts
totalEntryQty
totalExitQty
openQty
sizeDisplay
```

Keep `plannedQuantity` only in the Planned table.

### Correction 5: unify unrealized fee treatment

The dashboard, Trades page and trade-detail page must return identical Unrealized P&L for the same trade and market mark.

### Correction 6: distinguish current market from exit price

Do not place current market price in the `Exit` column for Open or Planned trades.

Use:

* `Market` for current marked price
* `Avg Exit` only for actual exit executions

### Correction 7: derive partial realized P&L

An Open trade with partial exits must show realized P&L to date.

### Correction 8: use remaining FIFO basis for unrealized P&L

Do not use historical all-entry average after FIFO lots have been sold.

---

## 12. Validation and testing

Add deterministic tests covering at least:

1. One long entry and one complete exit
2. One short entry and one complete cover
3. Multiple weighted entry fills
4. Multiple weighted exit fills
5. FIFO scale-in followed by partial exit
6. Partially closed trade with realized and unrealized P&L
7. Entry and exit commissions
8. Fees allocated across partial exits
9. Stop adjustment reducing risk
10. Stop beyond breakeven
11. Missing market mark
12. Stale market mark
13. Exit quantity greater than open quantity
14. Executions sharing the same timestamp
15. Multiple accounts
16. Multiple currencies
17. Full reconciliation against a broker statement

### Example FIFO acceptance case

Executions:

```text
Buy 10 at $10, fee $1
Buy 10 at $20, fee $1
Sell 10 at $15, fee $1
Current market price $22
```

Expected:

```text
Entry quantity          20
Exit quantity           10
Open quantity           10
Avg Entry               $15
Avg Exit                $15
Remaining Open Avg Cost $20

Gross realized P&L      $50
Realized fees           $2
Net realized P&L        $48

Gross unrealized P&L    $20
Open entry fees         $1
Net unrealized P&L      $19

Total net P&L           $67
```

The exact fee-allocation result must be documented and consistent across all application surfaces.

---

## 13. Definition of done

The change is complete when:

* Open, Closed and Planned trades have separate table definitions.
* All filtered totals are computed server-side across the complete dataset.
* Entry and exit prices are quantity weighted.
* FIFO lot matching is implemented and tested.
* Gross and net P&L are separate.
* Partially closed trades show both realized and unrealized results.
* Open Risk and Risk to Account are available.
* Portfolio Heat is available for Open trades.
* The current market price is never displayed as an exit.
* Dashboard, trade detail, account overview and Trades page reconcile exactly.
* P&L values reconcile against test broker statements.
* No financial calculation is duplicated in frontend components.
* Existing column ordering and visibility preferences continue to work.
