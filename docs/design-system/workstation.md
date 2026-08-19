# Workstation Dashboard

**Part of the TradingJournal Design System** (see [`README.md`](./README.md)).

**Status:** stub. This file carries the risk-first workstation standard and
layout contract; the `ws-` pattern documentation (density tokens, panel
chrome, toolbar, grid shell, data-quality alert strip, customize/arrange
modes, keyboard navigation, accessibility) is expanded in a later milestone
slice.

**Authoritative source:** `src/app/(workstation)/workspace/workstation.css` —
`.ws` scoped custom properties and utility classes, plus the workstation
components under `src/components/workstation/`. The workstation reuses the
global color tokens from `globals.css` (theme-aware) and defines its own
density, spacing, and type scale for the terminal-dense desktop surface.

---

## Dashboard workstation standard

`PRODUCT.md` defines the dashboard's risk-first job. This section turns that
job into a visual and data-state contract: first screen answers what is open,
what is at risk, and whether the displayed market state is trustworthy. Period
performance and analytical widgets are the second layer.

**Default composition.** The normal view is a curated, stable workstation, not
a wall of equally weighted KPI cards. Current risk, open positions, unrealized
P&L/data completeness, account state, and material warnings appear before
retrospective analytics. Saved views may rearrange the workstation for a
specific workflow; drag/resize affordances appear only in explicit
customization mode.

The Risk & Positions default has one layout hierarchy: a full-width Main Risk
Metrics band; one equal-width three-panel summary row for Account Performance,
PTD Performance, and Current Risk; then the trades workspace with open/current
and closed/historical tabs. Analytical chart and valuation widgets occupy the
grid rows below the trades workspace. Do not put charts inside the compact
summary row and do not reserve a tall blank panel before a chart has useful
data.

**Metric-group layout.** Summary panels use compact label/value rows or
matrices. The label and qualifying scope are start-aligned; comparable values
are end-aligned with tabular numerals. Monetary values, percentages, ratios,
quantities, and counts never centre-align or receive equal-width KPI tiles
merely to fill their container. Do not use `justify-content: space-between`
across a label, value, and unrelated metadata item; metadata belongs in the
label/value stack instead.

**Readability contract.** Review the dashboard at `2560 × 1440` with normal
browser zoom and at a `1920 × 1200` laptop using 125% display scaling
(approximately `1536 × 960` effective CSS pixels). The first screen must be
comfortably readable without zooming the browser. `1440 × 900` may reveal
structural breakage, but it is not a substitute for those visual-acceptance
viewports.

- Dashboard decision labels and table headers use `--font-size-sm` (12px) or
  larger. `--font-size-xs` is for secondary metadata, status chips, and
  timestamps—not labels needed to interpret risk or P&L.
- Table cells use `--font-size-md` (13px) or larger and the existing
  `--density-row-sm`/`--density-row-md` row scale. Do not compress dashboard
  rows below the system density tokens to fit more panels.
- Current-risk and primary financial values use `--font-size-lg` (16px) to
  `--font-size-xl` (20px), with tabular numerals. Reserve `--font-size-3xl`
  for a genuinely dominant KPI, not every number.

**Market-data state is part of the value.** Every price-derived dashboard
total carries the account and period scope that determines it and exposes its
market-data state beside the value. Use the existing semantic hierarchy:

- current and complete: normal financial treatment;
- stale: an explicit `--warning` state with as-of time;
- partial: an explicit `--missing` state and affected-position count;
- unavailable: an em dash or clear awaiting-price state, never `$0.00`.

Expose a known price source in that panel or its immediate detail. Do not let
a global freshness indicator make an individual P&L total appear current when
one of its positions is stale, unpriced, or otherwise incomplete.
