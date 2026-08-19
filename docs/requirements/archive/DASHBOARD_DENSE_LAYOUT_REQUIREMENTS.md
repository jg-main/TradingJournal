# Dense Dashboard Layout and Data Display Requirements

## Status and purpose

**Status:** Approved follow-on requirement for the Risk & Positions
workstation.

The dashboard data and calculations are not being changed by this requirement.
This work corrects the way that trustworthy data is distributed and scanned on
desktop screens. It supersedes the default-widget distribution and
summary-panel display portions of the Risk-First Dashboard Requirements; all
of that document's scope, provenance, completeness, naming, and reconciliation
contracts remain in force.

The outcome is a risk-first workstation that uses a broad desktop efficiently:
current risk and trades get the wide space they need, while scalar metrics stay
compact, comparable, and easy to read without zooming.

## Problem to solve

The current right-side arrangement gives Account State, Performance, and
Process Review large, tall areas even when they primarily contain short data
points. Account State also spreads labels, values, and supporting text across
the row, so monetary amounts no longer form a clear right-aligned column.
The resulting whitespace makes the dashboard feel less readable than the
Trades page even though the underlying values are correct.

The dashboard must not solve this by shrinking text, hiding definitions in
tooltips, converting every metric into a card, or introducing a second
dashboard layout system.

## Product decisions

1. The curated Risk & Positions view remains the default workstation and
   stays risk-first.
2. The default layout is a single desktop grid with the sections in this exact
   document order. It replaces the default two-column overview/side-rail
   arrangement.
3. The primary open-trade workflow is a full-width workspace. It is never
   compressed into a side panel to make room for retrospective widgets.
4. A trader can arrange eligible panels only in a deliberate saved-view
   arrangement mode. Normal use has no drag handles, resize affordances, or
   nested panel scrolling.
5. Charts are not part of the compact summary row. Their future home is a
   full-width tabbed analysis workspace below trades; until useful charts are
   delivered, do not render a large empty placeholder merely to reserve space.

## Required default layout

At the normal desktop widths, render this hierarchy in document flow:

```text
Data-quality alert, when needed
Main Risk Metrics                                      full width
Account State | Performance (data points only) | Review Metrics
Trades workspace: Open/current | Closed/historical     full width
Analysis charts: tabbed workspace when implemented     full width
```

### Main Risk Metrics

- Occupies the complete grid width immediately below any non-dismissible
  data-quality alert.
- Remains a protected, non-hideable, non-resizable anchor in the default
  Risk & Positions view.
- Retains the existing canonical risk, Open P&L, mark coverage, stop coverage,
  exposure, and freshness semantics. This requirement does not rename or
  recalculate them.

### Compact summary row

- Account State, Performance, and Review Metrics occupy three equal-width
  columns at the target desktop viewports. They share one row and are ordered
  exactly as shown above.
- The shared row height is set by the tallest natural summary content, never by
  remaining viewport height. Shorter panel content stays top-aligned; it must
  not acquire a chart, filler, or a nested scrollbar merely to fill the row.
- Each panel has a concise title, its relevant account/period scope, and a
  compact list or matrix of data points. A summary panel may use sensible
  internal grouping and separators, but never a card for every metric.
- **Account State** contains account balances, valuation state, current Open
  P&L, realized/total P&L only with their stated scope, and drawdown. The
  equity/drawdown chart moves to the future analysis workspace; it does not
  share the summary panel.
- **Performance** has one compact P&L scope control plus completed-decision
  metrics. Its P&L control offers **Realized**, **Open**, and **Total**:
  Realized includes every closed quantity, including partial exits; Open is
  the current marked P&L of remaining quantity; Total is their sum. Open and
  Total retain the current valuation's complete, stale, partial, or
  unavailable qualification and never present a partial sum as complete. The
  selected scope persists as a browser preference and defaults to Total.
  The panel labels this control **Live P&L** and labels its outcome metrics as
  closed-trade metrics, so a scope change is not mistaken for a recalculation
  of win rate, expectancy, or R-based measures.
  Closed-decision count, win rate, profit factor, average R, expectancy,
  payoff, average win/loss, fees, and best/worst trade remain completed-
  decision metrics, so scaling out cannot create extra decisions. Performance
  shows data points, not charts, distributions, or ranking tables.
- **Review Metrics** is the compact, action-oriented summary of supported
  process score, checklist/mistake coverage, directional or setup insights,
  and highest-attention items. It replaces the broad Process Review surface in
  this row. Deeper review analysis belongs below trades or in its saved view.
- The existing Watchlist remains out of the default Risk & Positions view. It
  stays available from its dedicated page and an eligible saved view.

### Trades workspace

- Occupies the complete grid width immediately after the summary row.
- Provides tabs for the current open workflow and the selected-period closed
  workflow. Tab labels must state their real universe, for example **Open
  positions**, **Open journal trades**, or **Closed trades**, rather than using
  an ambiguous unqualified count.
- The current/open tab retains its canonical live mark, risk, and data-quality
  indicators. The closed tab obeys the retrospective period controls. Switching
  tabs must not mix a current account total with a period-filtered total.
- The standard table follows the established Trades-page readability contract:
  meaningful columns, right-aligned numeric values, tabular numerals, 36–40px
  rows, and horizontal scrolling only when columns cannot safely compress.
- In the default view, table content uses normal page scrolling. It must not
  require a second vertical scrollbar within a panel.

### Future analysis workspace

- When analytical charts are implemented, place them in a full-width tabbed
  workspace below trades. Equity/drawdown is its first candidate because it
  is removed from Account State by this requirement.
- Keep charts out of the first summary row. A chart tab renders only when it
  has a defined metric contract, real data, a useful empty/unavailable state,
  and a meaningful visual height.
- This requirement does not authorize speculative charts, fabricated zero
  series, or Tier-3 metrics whose prerequisites are still absent.

## Data-display rules

The following rules apply to every compact summary panel and the trade table:

- Use a two-edge metric pattern: label (and qualifying scope/source/as-of
  metadata) at the start edge; one comparable value at the end edge.
- Right-align monetary values, prices, percentages, ratios, quantities, and
  counts. Apply tabular numerals. Positive/negative signs remain visible and
  semantic colour remains supplemental, never the only signal.
- Do not use `space-between` to position a label, value, and third unrelated
  metadata item. Supporting text belongs below the label, below the value, or
  in a compact accessible detail treatment.
- Use the product's centralized money, P&L, percentage, and ratio formatters.
  Null, partial, stale, and unavailable values retain their existing qualified
  presentation; no layout code may coerce them to zero.
- Use a fixed, readable label/value relationship. A panel may gain a second
  metric column only when both columns preserve their own shared right numeric
  edge and remain readable at the laptop target viewport.
- Do not centre numeric values, use equal-width KPI tiles for scalar values,
  or allow a wide container to create decorative whitespace.
- Summary panels are content-sized and use page flow. Internal scrolling is
  reserved for a genuinely long table or interactive chart, never the normal
  way to read Account State, Performance, or Review Metrics.

## Saved-view arrangement mode

Use the repository's installed `react-grid-layout` v2 package for the one
workstation grid; do not add a second drag-and-resize library. Its current API
supports the needed layout serialization, constraints, responsive breakpoints,
explicit drag handles, and resize handles.

### Interaction contract

- Only a user-owned saved view can enter **Arrange dashboard** mode. System
  presets remain read-only; duplicating a preset creates the editable copy.
- Normal mode is static. In arrangement mode, eligible panel headers show a
  clearly labelled drag handle and a visible southeast resize handle; controls
  within a panel must remain usable without accidentally starting a drag.
- Provide Save, Cancel, Reset to template, and Undo. Save is disabled until a
  layout change exists; Cancel leaves the stored view untouched.
- Provide keyboard-equivalent panel arrangement actions: move by one grid
  track in each direction and grow/shrink within constraints. Announce the
  panel name, position, and size after each change.
- Keep the data-quality alert outside the editable grid. In the default
  template, Main Risk Metrics and the Trades workspace cannot be hidden or
  moved below the summary/analysis workflow. Account State, Performance,
  Review Metrics, Watchlist, and future analysis panels may be arranged only
  within their declared constraints.
- Each panel has declared minimum size based on its content. Summary panels
  cannot shrink below a readable label/value layout; the trades workspace
  cannot be resized into a narrow side rail; charts maintain a useful minimum
  height and remeasure after a resize.

### Persistence and migration

- Maintain one validated, versioned saved-view schema and one placement owner.
  The layout must reference only the approved panel catalogue and declared
  per-panel size constraints.
- Introduce a new default-template version for this composition. Unmodified
  copies of the former system default receive the new default; an existing
  user-created or modified saved view is preserved exactly and may be reset
  deliberately to the new template.
- Reject malformed, out-of-bounds, unknown, overlapping, or future-version
  persisted layout data. Fall back safely to the current system default with a
  visible recoverable notice; never execute persisted markup, code, or queries.
- Persist only after Save, not after every pointer movement. A failed local
  write is visible and does not pretend the layout was saved.

## Non-goals

- Recalculation, renaming, or changed fee treatment for existing account,
  risk, mark-to-market, or period-performance metrics.
- Adding a new chart category, Tier-3 statistic, watchlist widget, or market
  data source.
- Making the dashboard a free-form canvas or allowing its protected risk and
  trade workflow to disappear from the default.
- Redesigning the established Graphite + Steel Blue visual identity or adding
  a new design-token system.

## Acceptance criteria

### Visual and usability

1. At `2560 × 1440` normal zoom and effective `1536 × 960` CSS pixels for the
   `1920 × 1200` laptop at 125% display scaling, Main Risk Metrics is full
   width; Account State, Performance, and Review Metrics appear as one
   equal-width compact row; the full-width trades tabs immediately follow.
2. The three summary panels do not contain charts, long ranking tables, or a
   vertical scrollbar in the normal default view. Their shared row height is
   content-driven, not viewport-fill-driven; panel content is top-aligned and
   no filler is added merely to make neighboring panels look equal.
3. In populated fixtures, each monetary value in the summary row and trade
   table ends on its panel/table numeric edge. Labels remain start-aligned and
   metadata does not form a third distributed column.
4. The default Risk & Positions view shows no Watchlist and no permanent drag
   or resize handle. The visual density and type scale remain at least as
   readable as the Trades page.
5. At `1440 × 900`, the layout has no overlap, clipped critical value, or
   unusable table. It may reflow according to declared breakpoints but does
   not substitute a compressed small-text mode.

### Behaviour and data integrity

6. Opening and closing the trades tabs preserves their distinct current versus
   retrospective scopes and displays the existing correct metric values.
7. The same current Open P&L shown in Main Risk Metrics and Account State
   comes from the existing shared dashboard snapshot and retains its
   completeness/freshness qualification.
8. Performance's Open and Total P&L scopes use the same qualified current Open
   P&L source as Main Risk Metrics; Realized includes partial exits. Changing
   this reading preference never changes the completed-decision metrics.
9. Entering arrangement mode on a user view supports constrained drag, resize,
   keyboard equivalents, Undo, Cancel, Reset, and Save. Normal mode supports
   none of the pointer drag/resize behavior.
10. A refreshed page restores a saved arranged view. An old user-customized
   view remains intact after the new default-template migration; Reset produces
   the new dense template.
11. System presets, malformed saved data, screen resize, and a failed
    persistence write all leave a safe, usable workstation and expose the
    correct recovery state.

## Delivery and evidence

Deliver the work as one vertical dashboard slice with a layout-state migration
and no changes to canonical calculations. Add focused tests for the layout
schema/constraints and summary metric presentation, plus browser coverage for
the normal default, a user-saved arrangement, keyboard arrangement, saved-view
migration, and the two trades tabs.

Capture populated dashboard screenshots at both primary target viewports and
the `1440 × 900` structural fallback. The review must explicitly check numeric
alignment, the absence of normal-use nested scrollbars, summary-row height,
and the placement of the trades tabs. Run lint, typecheck, production build,
the full test orchestrator, and the targeted browser workflow before release.
