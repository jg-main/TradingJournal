# Dashboard Workstation Reference

The default dashboard is a curated risk-first workstation. It answers **what is
open, what is at risk, and whether the market data is trustworthy** before it
answers retrospective performance questions.

## Viewport and readability

Visual acceptance must cover the trader's normal desktop environments:

- `2560 × 1440` at normal browser zoom.
- A `1920 × 1200` laptop at 125% display scaling (approximately `1536 × 960`
  effective CSS pixels).

The dashboard must be comfortably readable at those viewports without asking
the trader to increase browser zoom. Do not use extra screen area as a reason
to shrink decision-critical information. `1440 × 900` remains a structural
fallback check, not the primary readability target.

Use the design-system type and density tokens. On dashboard surfaces:

- Decision labels and table headers use at least `--font-size-sm` (12px).
- Table cells use at least `--font-size-md` (13px); rows use the 36–40px
  density scale.
- Current-risk and primary financial values use `--font-size-lg` to
  `--font-size-xl` (16–20px). Reserve `--font-size-xs` (11px) for secondary
  metadata, badges, and non-decision timestamps.
- Widget headers use `--font-size-md`/`--font-size-lg` with enough contrast to
  identify the domain while scanning.

Core first-screen domains:

- Current risk.
- Open positions.
- Unrealized P&L and market-data completeness.
- Account state and material warnings.
- Equity and drawdown where it explains the current account state.
- Period performance.
- Comparative or process analysis.
- Critical warnings.

Default dense composition:

```text
Main Risk Metrics (full width)
Account State | Performance (data points, no charts) | Review Metrics
Trades workspace — Open/current and Closed/historical tabs (full width)
Analysis charts — full-width tabs below trades, once supported by real data
```

The three summary panels use equal-width tracks at the target desktop
viewports. Wide space belongs to the risk band, the trades table, and later
comparative charts — never to a single scalar metric or an empty placeholder.
Use compact label/value metric matrices: labels and qualifying scope start
aligned; money, percentages, ratios, quantities, and counts share an
end-aligned tabular-numeric edge. Keep source/as-of metadata subordinate to
the related label or value; do not create a third widely distributed column.

Recommended density:

```text
Toolbar: 40–48 px
Grid gap: 6–8 px
Widget header: 32–36 px
Decision labels and table headers: 12 px minimum
Primary metric values: 16–20 px
Table rows: 36–40 px
```

## Trust and customization

- Show the active account and period scope wherever a metric could otherwise
  be misread.
- Price-derived totals must show their market-data state close to the value:
  current, stale, partial, or unavailable. Where a source is available, expose
  the source and as-of time in the same panel or its immediate detail.
- Do not render a partial or unknown aggregate as a complete P&L number. A
  missing value is not zero, and stale data is not current data.
- Ship a stable default view. Saved views may rearrange or hide widgets for a
  specific workflow, but drag/resize controls belong only to explicit
  customization mode.
- The installed `react-grid-layout` is the standard implementation for
  draggable/resizable saved views. Use one validated, versioned layout model;
  preserve user-owned saved views when default layout versions change.
- The alert strip, main risk band, and trades workflow remain reliable anchors
  in the curated default. Customization changes panel placement only in an
  explicit arrangement session with visible handles, Save, Cancel, Undo, and
  Reset; normal mode has no drag or resize affordances.

Do not use one card per KPI, full-width low-information widgets, fixed chart
heights in resizable containers, multiple dashboard grids, permanent drag
handles, open positions below the fold, wide scalar KPI tiles, three-way
distributed metric rows, tall blank chart placeholders, or live polling that
refreshes all historical analytics.
