# Trades Page Final Accuracy — Post-Implementation Audit

## Verdict

**Core trade calculations: approved.**

**Trades page milestone: not fully complete.**

The important financial defects from the prior audit have been corrected:

* Portfolio Heat amount now equals aggregate Open Risk.
* Portfolio Heat percentage uses the decimal-fraction percentage contract.
* Aggregate risk uses the exact stored initial stop after scale-ins.
* NAV is loaded for all accounts in the filtered dataset, independently of pagination.
* Stop adjustments use event chronology rather than price magnitude.
* Open holding period uses current time.
* Monetary totals use Decimal arithmetic.
* Planned totals respect date filters.
* Market Condition displays its name.
* Open-trade planned stop edits are blocked.
* Actions-menu clicks no longer trigger row navigation.

The canonical trade engine now correctly handles FIFO matching, partial exits, realized and unrealized P&L, exact initial stops, Active Stop, Open Risk and Risk to Account.

The cross-surface suite now exercises the real Trades list and Trade Detail handlers against a migrated SQLite database, covering percentages, stop propagation, scale-ins, partial exits, names, NAV, short positions and missing market marks.

The remaining issues are primarily footer requirements and lifecycle integrity.

---

# P0 — Required before marking the milestone complete

## 1. Remove “By Currency” from the Closed tab

### Current behavior

The Closed footer renders:

```text
CLOSED TOTALS
Gross P&L
Fees
Net P&L

BY CURRENCY
USD
Gross P&L
Fees
Net P&L
```

The source still renders `totalsByCurrency` under the Closed footer.

The component test explicitly requires:

* `By Currency`
* `USD`
* `EUR`

This means the undesired behavior is intentional and protected by a regression test.

### Required result

Because the application is currently USD-only, the Closed footer should contain one section:

```text
CLOSED TRADES TOTAL

Gross P&L       $X,XXX.XX
Fees               $XX.XX
Net P&L         $X,XXX.XX
Trades                   N
```

Remove from the Trades page:

```ts
totalsByCurrency
tabTotalsByCurrency
By Currency
```

These can remain in a future multi-currency accounting API if needed, but they should not be exposed in the current UI.

Update the component test so it asserts that `By Currency`, `USD`, and `EUR` are absent from the Closed footer.

---

## 2. Restore Unrealized P&L to the Open Positions total

### Current behavior

The Open footer currently contains only:

```text
PORTFOLIO HEAT

Portfolio Heat $
Portfolio Heat %
Positions
```

It no longer displays total Unrealized P&L.

The component test explicitly asserts:

```ts
queryByText('Unrealized P&L') === null
```

This does not match the requested change. Portfolio Heat was supposed to be **added to the Open Positions total**, not replace the existing aggregate P&L information.

### Required result

```text
OPEN POSITIONS TOTAL

Unrealized P&L       $X,XXX.XX
Portfolio Heat $        $XXX.XX
Portfolio Heat %           X.XX%
Open Positions                 N
```

Use:

```ts
totals.netUnrealizedPnl
totals.portfolioHeatAmount
totals.portfolioHeatPct
count
```

The heading should be **Open Positions Total**, not only Portfolio Heat.

---

## 3. Closed trades still allow historical stop modification

The dialog correctly makes the stop read-only for Open trades and explains that Active Stop must be changed through Adjust Stop.

However, the implementation treats every non-Open trade identically:

```text
Planned trade → editable Stop Loss
Closed trade  → editable Stop Loss
```

The backend rejects `plannedStop` only when status is `open`; it permits modification for Closed trades.

That permits historical planning information to be rewritten after the trade has closed.

### Required lifecycle behavior

| Status  | Stop field                                                         |
| ------- | ------------------------------------------------------------------ |
| Planned | Editable `Planned Stop`                                            |
| Open    | Read-only `Original Planned Stop`; Active Stop through Adjust Stop |
| Closed  | Read-only historical `Original Planned Stop`                       |

Backend protection should be:

```ts
if (
  existing.status !== 'planned' &&
  parsed.data.plannedStop !== undefined
) {
  return NextResponse.json(
    {
      error:
        'Planned stop can only be changed while the trade is planned.',
    },
    { status: 400 },
  );
}
```

Add route tests proving Closed trades cannot modify or clear `plannedStop`.

---

## 4. Stop adjustments are not restricted to Open trades

`POST /api/trades/:id/stop-adjustments` verifies that the trade exists but does not verify that it is Open. A direct request can therefore add a stop adjustment to:

* Planned trades
* Closed trades
* Deleted trades

### Required protection

```ts
if (trade.status !== 'open') {
  return NextResponse.json(
    { error: 'Stop adjustments are only allowed for open trades.' },
    { status: 409 },
  );
}
```

Add tests for Planned, Closed and Deleted statuses.

---

# P1 — Correctness and semantic improvements

## 5. Planned risk still accepts an invalid stop direction

The list API calculates Planned Risk to Account using:

```ts
Math.abs(plannedEntry - plannedStop) * plannedQuantity
```

Planned totals use the same absolute-distance calculation.

This permits invalid configurations such as:

```text
Long entry:  $100
Long stop:   $105
```

and reports positive risk instead of rejecting or suppressing it.

### Correct rules

```text
Long:  stop < entry
Short: stop > entry
```

Use one shared server helper:

```ts
function computeValidPlannedRisk(
  direction: 'long' | 'short',
  entry: number | null,
  stop: number | null,
  quantity: number | null,
): Decimal | null {
  if (
    entry == null ||
    stop == null ||
    quantity == null ||
    quantity <= 0
  ) {
    return null;
  }

  const riskPerUnit =
    direction === 'long'
      ? new Decimal(entry).minus(stop)
      : new Decimal(stop).minus(entry);

  if (riskPerUnit.lte(0)) return null;

  return riskPerUnit.mul(quantity);
}
```

Use this helper for:

* Planned Risk column
* Planned Risk to Account
* Planned totals
* Trade planning validation

---

## 6. Distance calculations hide crossed stops and triggers

The new helpers fixed the 100× display error, but they use `Math.abs`.

For example:

```text
Long position
Market: $94
Stop:   $95
```

The stop has already been crossed, but the helper reports a positive `1.06%` distance.

Likewise, a planned trigger already crossed by the market is displayed as a normal positive distance.

### Recommended semantics

For Distance to Stop:

```ts
direction === 'long'
  ? (market - stop) / market
  : (stop - market) / market
```

For Distance to Trigger, define positive as **distance remaining**:

```ts
direction === 'long'
  ? (trigger - market) / trigger
  : (market - trigger) / trigger
```

Then:

* Positive: level has not been reached.
* Zero: market is at the level.
* Negative: market has crossed the level.

The helpers therefore need the trade direction argument.

---

## 7. Date presets are fixed-day approximations, not calendar periods

The implementation uses:

```text
1M = 31 days
3M = 91 days
6M = 180 days
```

That is acceptable only if the product explicitly defines these as trailing-day windows.

Most financial interfaces interpret:

```text
1M = one calendar month ago
3M = three calendar months ago
6M = six calendar months ago
```

For July 31:

```text
1M → June 30 or June 31-clamped
3M → April 30
6M → January 31
```

The current 3M calculation produces approximately May 1, not April 30.

Use calendar-month subtraction with end-of-month clamping if these controls are intended to represent standard market periods.

---

## 8. Date boundaries use browser timezone, not profile timezone

The hardcoded UTC problem was corrected, but the bounds now use the browser’s timezone offset.

The application schema already defines a profile timezone, defaulting to `America/Bogota`.

If the journal is opened while traveling or through a workstation configured to another timezone, the reporting boundaries will shift.

For accounting and journal reporting, use:

```text
app_profile.timezone
```

rather than the browser timezone.

This is not blocking for normal Bogotá use but should be corrected before timezone portability is claimed.

---

# Confirmed correct

## Portfolio Heat calculations

The current implementation correctly defines:

```text
Portfolio Heat $ =
sum of Open Risk across all filtered open positions
```

```text
Portfolio Heat % =
Portfolio Heat $
÷
sum of unique account NAVs
```

The denominator includes each account only once, avoiding double-counting when one account contains several positions. It uses full-dataset account NAV rather than current-page account data.

The percentage contract is correct:

```text
0.0125 = 1.25%
```

The UI multiplies the value by 100 once.

## Aggregate scale-in risk

The aggregate calculation now passes:

```ts
initialStopPrice
initialEntryPrice
```

into the canonical metrics engine. This prevents Portfolio Heat from reconstructing an incorrect stop after additional entries.

## Active Stop chronology

Active Stop now uses:

```text
adjustedAt
→ createdAt
→ id
```

Price magnitude is no longer used as a chronology proxy.

The stop routes use the same ordering.

## Open Risk and Risk to Account

Open Risk continues to use the remaining FIFO position:

```text
Long:
max(0, open average cost − Active Stop)
× open quantity

Short:
max(0, Active Stop − open average cost)
× open quantity
```

Risk to Account is:

```text
Open Risk ÷ current account NAV
```

## Missing market price

Open Total P&L remains unavailable when the position has no current market price, preventing realized-only P&L from being presented as complete.

## Holding period

Open-trade holding period now uses current time instead of a possibly stale quote timestamp.

## Monetary precision

Trade-level fees, net realized P&L and full-dataset totals now use Decimal arithmetic.

## Market Condition

The Planned tab now displays `marketConditionName` rather than a lookup UUID.

## Planned date-filter totals

The Planned totals query now applies the same From and To date boundaries when the Planned tab is active.

## Actions menu

The Actions trigger stops click and keyboard propagation, preventing accidental row navigation when opening the menu.

---

# Required acceptance tests

## Open footer

Assert that the Open footer displays:

```text
Open Positions Total
Unrealized P&L
Portfolio Heat $
Portfolio Heat %
Open Positions
```

Assert that it does not display:

```text
By Currency
USD
EUR
```

## Closed footer

Assert that the Closed footer displays:

```text
Closed Trades Total
Gross P&L
Fees
Net P&L
Trades
```

Assert that it does not display:

```text
By Currency
USD
EUR
```

## Stop lifecycle

| Request                              | Expected |
| ------------------------------------ | -------- |
| Modify Planned Stop on Planned trade | Allowed  |
| Modify Planned Stop on Open trade    | Rejected |
| Modify Planned Stop on Closed trade  | Rejected |
| Add stop adjustment to Open trade    | Allowed  |
| Add stop adjustment to Planned trade | Rejected |
| Add stop adjustment to Closed trade  | Rejected |

## Planned risk direction

Assert:

```text
Long entry 100, stop 95  → valid
Long entry 100, stop 105 → invalid

Short entry 100, stop 105 → valid
Short entry 100, stop 95  → invalid
```

## Crossed distance

Assert:

```text
Long market 100, stop 95 → +5.00%
Long market 94, stop 95  → negative/crossed state

Short market 100, stop 105 → +5.00%
Short market 106, stop 105 → negative/crossed state
```

---

# Final status

| Area                                 | Status             |
| ------------------------------------ | ------------------ |
| FIFO and trade-level P&L             | Approved           |
| Open Risk                            | Approved           |
| Risk to Account                      | Approved           |
| Portfolio Heat calculation           | Approved           |
| Scale-in aggregate risk              | Approved           |
| NAV pagination independence          | Approved           |
| Stop chronology                      | Approved           |
| Decimal aggregation                  | Approved           |
| Market Condition display             | Approved           |
| Planned totals date filtering        | Approved           |
| Open footer presentation             | **Incomplete**     |
| Closed footer presentation           | **Incomplete**     |
| Closed-trade stop immutability       | **Incomplete**     |
| Stop-adjustment lifecycle protection | **Incomplete**     |
| Planned risk direction validation    | **Incomplete**     |
| Distance crossed-state semantics     | Needs decision/fix |

## Completion decision

**Do not reopen the financial calculation engine. It is now materially correct.**

Create one focused final remediation slice covering:

1. Remove Closed `By Currency`.
2. Restore Unrealized P&L to Open Positions Total.
3. Make Closed planned stop read-only and immutable.
4. Restrict stop adjustments to Open trades.
5. Validate planned stop direction.
6. Preserve signed stop/trigger distance or explicitly document absolute-distance behavior.

After those items pass their acceptance tests, the Trades page can be marked complete.
