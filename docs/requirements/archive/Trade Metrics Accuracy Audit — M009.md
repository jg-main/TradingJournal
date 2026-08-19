# Trade Metrics Accuracy Audit — M009

## Status

M009 must not be considered fully complete or financially reconciled.

The FIFO engine is substantially implemented, but there are confirmed defects in:

- Percentage display
- Active-stop propagation
- Current-equity sourcing
- Account and sector presentation
- Trade-detail consistency
- Stop-selection ordering
- Initial-stop fallback
- Multi-currency aggregation
- Several optional columns that remain placeholders

These issues affect displayed risk, returns, position weights and downstream calculations.

---

# 1. P0 — Percentage values are displayed 100× too large

## Root cause

The metrics engine returns percentages as percentage points.

Examples:

```ts
riskToAccount = (openRisk / currentAccountEquity) * 100;

initialRiskPct = (initialRisk / accountEquityAtOpen) * 100;

positionWeight = (marketValue / currentAccountEquity) * 100;

returnPct = (totalNetPnl / totalEntryNotional) * 100;
```

However, the frontend formatter treats the input as a decimal fraction:

```ts
const pct = value * 100;
```

This applies a second multiplication by 100.

## Confirmed example

For:

```text
Open Risk = $45.60
Equity    = $10,000
```

The metrics engine returns:

```text
0.456
```

meaning:

```text
0.456%
```

The formatter turns it into:

```text
45.60%
```

## Affected fields

At minimum:

- Risk to Account
- Planned Risk to Account
- Initial Risk %
- Position Weight %
- Return %
- Distance to Stop %
- Distance to Trigger %

The Distance fields are especially incorrect because they also multiply by 100 before being passed into `PercentCell`.

## Required correction

Adopt one percentage contract across the application.

### Recommended contract

All domain and API percentages should be returned as **percentage points**:

```text
0.456 means 0.456%
2.00 means 2.00%
15.25 means 15.25%
```

Change the formatter to:

```ts
export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
```

For neutral risk metrics, omit the plus sign:

```ts
formatRiskPercent(0.456); // "0.46%"
```

Do not use green for positive risk percentages. Higher risk is not a positive performance result.

## Acceptance test

```text
Open Risk:       $45.60
Account NAV:     $10,000
Raw API result:  0.456
Displayed value: 0.46%
```

---

# 2. P0 — Account column displays UUID

## Current behavior

The Trades API returns:

```ts
accountId;
```

The table column directly renders:

```ts
accessorKey: "accountId";
```

The account records are fetched internally for calculations, but their names are not included in each returned trade row.

## Required API fields

Return:

```ts
accountId: string;
accountName: string;
accountCurrency: string;
```

The table must display:

```text
Interactive Brokers
Thinkorswim
Paper Account
```

rather than:

```text
7617a834-b4b3-4a40-...
```

The UUID may remain available as an optional technical/debug column, but it must not be the user-facing Account value.

---

# 3. P0 — Sector column does not resolve a sector name

## Current behavior

The Trades API returns:

```ts
sectorId;
```

The frontend renders `sectorId` directly.

No sector lookup name is joined into the Trades-list query.

## Required resolution

Return:

```ts
sectorId: string | null;
sectorName: string | null;
```

Recommended priority:

```text
1. Explicit trade sector lookup from trades.sectorId
2. Latest instrument/profile sector from position_price_snapshots.sector
3. null
```

The second source should be used as a fallback, not silently written into the manually selected trade classification.

Use separate aliases or batch lookup maps for:

- Sector
- Setup
- Market condition

Do not reuse one `lookupValues` join for multiple foreign keys without aliases.

---

# 4. P0 — Editing the stop on an Open trade does not change Active Stop

## Confirmed root cause

There are currently two stop concepts and two write paths.

### Edit Trade path

The Edit Trade dialog contains a field labelled:

```text
Stop Loss
```

It sends:

```ts
plannedStop;
```

to:

```text
PUT /api/trades/:id
```

That updates:

```text
trades.planned_stop
```

### Active-stop metrics path

Trades metrics do not use the current value of `trades.planned_stop` as the active stop.

They use:

```text
Latest trade_stop_adjustments.new_stop
```

or a fallback derived from the initial risk snapshot.

Therefore, changing WKC’s Stop Loss through Edit Trade updates planning data but does not update:

- Active Stop
- Open Risk
- Risk to Account
- Locked-in P&L
- Distance to Stop
- Portfolio Heat

This matches the observed WKC behavior.

## Required domain rule

### Planned trade

Allow:

```text
Edit Planned Stop
```

This updates:

```text
trades.planned_stop
```

### Open trade

Do not permit the generic Edit Trade dialog to change the active stop.

Use:

```text
Adjust Active Stop
```

which creates a new immutable stop-adjustment record.

If an Open trade’s stop is edited through any UI, route the operation through:

```text
POST /api/trades/:id/stop-adjustments
```

The operation should capture:

- Previous active stop
- New active stop
- Timestamp
- Reason
- Rule-based/manual indicator
- Notes

## UI labels

Use explicit terminology:

```text
Planned Stop
Initial Stop
Active Stop
```

Do not label all three simply as “Stop Loss.”

---

# 5. P0 — Stop updates can remain stale after navigating back to Trades

The Trades page loads data into client state and does not automatically invalidate it when a stop adjustment is added elsewhere.

When navigating back through browser history, the page may be restored from client/router state without a new API request.

## Required correction

Use a shared server-state cache such as React Query/SWR, or implement explicit invalidation.

After adding a stop adjustment:

```text
invalidate trade detail
invalidate Trades list
invalidate dashboard
invalidate account exposure
```

At minimum, the Trades page should refetch on:

- `pageshow`
- window focus
- route reactivation
- explicit mutation completion

A hard page refresh should not be required to see the updated Active Stop.

---

# 6. P0 — Latest stop adjustment is not selected deterministically

## Current behavior

Stop adjustments are fetched without an explicit order in the Trades API.

The metrics kernel selects:

```ts
stopAdjustments[stopAdjustments.length - 1];
```

This assumes the database returned rows chronologically.

SQL result order is not guaranteed without `ORDER BY`.

## Required correction

Sort in the canonical metrics engine defensively:

```ts
const sortedStops = [...stopAdjustments].sort((a, b) => {
  const timeCompare =
    new Date(a.adjustedAt).getTime() - new Date(b.adjustedAt).getTime();

  if (timeCompare !== 0) return timeCompare;
  return a.id.localeCompare(b.id);
});

const activeStop = sortedStops.at(-1)?.stopPrice;
```

Extend `StopAdjustmentData` with a deterministic ID or sequence.

## Acceptance test

Insert adjustments in database order:

```text
$42.00 at 14:00
$41.00 at 10:00
$43.00 at 16:00
```

Expected Active Stop:

```text
$43.00
```

regardless of insertion or retrieval order.

---

# 7. P0 — Initial stop fallback is reconstructed incorrectly

The database already stores:

```text
trade_risk_snapshots.initial_stop_price
```

However, the metrics input does not include this field.

Instead, the kernel reconstructs a stop from:

```text
initialRiskAmount / current total entry quantity
```

and applies that distance to the current weighted average entry.

This is invalid after scale-ins.

## Example

Initial position:

```text
Buy 10 at $50
Initial stop $45
Initial risk $50
```

Later:

```text
Add 10 at $60
```

The reconstruction becomes:

```text
Current Avg Entry = $55
Risk/share        = $50 / 20 = $2.50
Derived stop      = $52.50
```

The real initial stop is still:

```text
$45.00
```

## Required correction

Extend the canonical input:

```ts
interface RiskSnapshotData {
  initialRiskAmount: number | null;
  accountEquityAtOpen: number | null;
  initialStopPrice: number | null;
}
```

Active-stop fallback must be:

```ts
latestStopAdjustment?.stopPrice ?? riskSnapshot?.initialStopPrice ?? null;
```

Never reverse-engineer a price field from a monetary risk value when the exact price is stored.

---

# 8. Open Risk definition

The intended definition is correct:

```text
Open Risk at Stop =
loss on the currently open quantity
if the active stop executes at the stop price
```

### Long

```text
max(0, Open Avg Cost − Active Stop)
× Open Quantity
```

### Short

```text
max(0, Active Stop − Open Avg Cost)
× Open Quantity
```

This is based on the remaining FIFO cost basis, not total historical entry quantity.

It excludes:

- Gap risk
- Slippage
- Future exit commissions
- Stop-order execution uncertainty

The displayed label should preferably be:

```text
Open Risk at Stop
```

The calculation is conceptually correct in the kernel, but its result is not reliable until Active Stop and current Open Quantity are correct.

---

# 9. P0 — Risk to Account must use authoritative current NAV

The correct definition is:

```text
Risk to Account % =
Open Risk at Stop
÷ Current Account NAV
× 100
```

## Current inconsistency

The Trades API uses:

```text
Latest account_rollforward.endingEquity
→ account.startingBalance
→ global startingAccountValue
```

The Trade Detail API uses a different fallback:

```text
account.startingBalance
→ global startingAccountValue
```

However, the Account API identifies:

```text
account_performance.nav
```

as the authoritative post-cutover account value.

This creates differing risk percentages for the same trade depending on the page.

## Required correction

Create one shared service:

```ts
getCurrentAccountNav(accountId);
```

It must read the current authoritative accounting projection:

```text
account_performance.nav
```

and return:

```ts
{
  nav: number | null;
  computedAsOf: string | null;
  isStale: boolean;
  warnings: string[];
}
```

All surfaces must use it:

- Trades
- Trade Detail
- Dashboard
- Account page
- Position sizing
- Portfolio Heat

Do not silently use starting balance for a field labelled current Risk to Account.

When NAV is unavailable:

```text
Risk to Account: —
NAV unavailable
```

---

# 10. P0 — Trade Detail is not using canonical stop and risk metrics

The Trade Detail page currently computes local metrics with:

```ts
stopAdjustments: [];
currentMark: null;
currentAccountEquity: null;
```

even though the page has already fetched stop adjustments and market data.

The Risk Snapshot card also uses:

```text
plannedStop as Actual Stop
initialQuantity as Actual Quantity
```

This is incorrect after:

- Stop adjustments
- Scale-ins
- Partial exits
- Current market changes

## Required correction

Trade Detail must consume the canonical server result:

```text
GET /api/trades/:id
→ metrics
```

Display:

```text
Active Stop       metrics.risk.activeStop
Open Quantity     metrics.size.openQuantity
Open Avg Cost     metrics.averagePrices.openAvgCost
Open Risk         metrics.risk.openRisk
Risk to Account   metrics.risk.riskToAccount
Locked-in P&L     metrics.risk.lockedPnl
Market Value      metrics.position.marketValue
Position Weight   metrics.position.positionWeight
```

Remove duplicate risk and P&L formulas from React components.

A metric must have one formula and one canonical source.

---

# 11. Missing market data must not imply complete Total P&L

The current kernel calculates:

```text
Total Net P&L =
Net Realized P&L + 0
```

when an Open trade has no market mark.

That makes a partially exited Open trade appear to have a complete Total P&L even though unrealized P&L is unavailable.

## Required correction

When:

```text
openQuantity > 0
and currentMark is null
```

return:

```ts
totalNetPnl: null;
isPnlComplete: false;
```

The UI should display:

```text
Total P&L: —
Awaiting market price
```

---

# 12. Distance to Stop is incorrect for Short trades

The current UI calculates:

```ts
((currentPrice - stop) / currentPrice) * 100;
```

This is Long-specific.

## Correct formulas

### Long

```text
(Current Price − Active Stop)
÷ Current Price
× 100
```

### Short

```text
(Active Stop − Current Price)
÷ Current Price
× 100
```

Clamp only according to the desired semantic definition.

This metric is also affected by the 100× percentage formatter defect.

---

# 13. Currency formatting remains hardcoded to USD

The shared currency formatter always uses:

```text
USD
```

even though accounts support different currencies.

Every trade row should include:

```ts
accountCurrency;
```

Format values using that currency.

For multiple currencies:

- Do not display one combined monetary total.
- Show separate currency groups.
- Do not calculate one combined Portfolio Heat unless values are converted using an explicit FX process.

The current UI still displays the invalid combined aggregate before its per-currency breakdown.

---

# 14. Several “implemented” columns are placeholders

The following selectable columns currently render `—` rather than actual values:

- Entry fill count
- Exit fill count
- Execution count
- MFE
- MAE
- Grade
- Followed Plan
- Rule Violation
- Mistake Severity
- Target 2
- Expiration Date

These fields should not be described as implemented.

Either:

1. Populate them correctly, or
2. Remove them from the column selector until implemented.

A selectable empty placeholder is not a completed feature.

---

# 15. Required tests

## Percentage integration

```text
Open Risk $45.60
NAV $10,000
API Risk to Account 0.456
UI displays 0.46%
```

Test all percentage columns through actual rendering, not only the kernel.

## Stop propagation

1. Open WKC.
2. Record an active stop adjustment.
3. Return to Trades.
4. Confirm Active Stop updates.
5. Confirm Open Risk updates.
6. Confirm Risk to Account updates.
7. Confirm Portfolio Heat updates.

## Stop ordering

Multiple stop adjustments inserted out of order must select the latest timestamp.

## Scale-in

An initial stop must remain exact after additional entry fills.

## Partial exit

Confirm:

```text
Open Quantity
FIFO Open Avg Cost
Gross Realized P&L
Net Realized P&L
Unrealized P&L
Open Risk
```

after a partial exit.

## Cross-surface reconciliation

For the same trade, assert exact equality across:

- Trades row
- Trade Detail
- Dashboard
- Account overview

## Friendly names

Assert that the Trades API and UI return:

```text
Account name
Sector name
Market condition name
```

rather than UUIDs.

## Current NAV

Risk to Account must use the same NAV shown on the Account page.

## Short position risk

Test Active Stop, Distance to Stop and Open Risk for a Short position.

## Missing mark

Open positions without a current mark must be explicitly incomplete.

---

# Completion criteria

The implementation may be considered financially reconciled only when:

- CAKE displays approximately 0.46%, not 45.60%, for $45.60 risk on $10,000 NAV.
- Account and Sector display human-readable names.
- Updating WKC’s active stop updates all downstream surfaces immediately.
- Active Stop is selected deterministically.
- Initial Stop uses the stored exact price.
- Trade Detail and Trades use the same canonical metrics.
- Risk to Account uses authoritative current NAV.
- Every percentage follows one contract.
- Currency presentation is account-aware.
- Placeholder columns are either populated or removed.
- Cross-layer integration tests pass.
