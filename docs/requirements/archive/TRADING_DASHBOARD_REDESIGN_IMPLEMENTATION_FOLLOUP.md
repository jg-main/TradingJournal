## Dashboard Density and Customization — Required Revision

The current milestone is an improvement, but the dashboard still has the same fundamental problem: it is using large SaaS-style metric cards instead of a dense trading workstation layout. Think of a Bloomberg terminal as reference.

This application is desktop-only and used by one trader. Optimize it for information density and first-screen visibility, not for mobile responsiveness or large presentation cards.

### 1. The first account-performance section must use the customizable grid

The first `Account Performance` section is currently outside the `react-grid-layout` dashboard system.

This creates two different dashboard models:

- A fixed account-performance section.
- Reorganizable KPI and chart sections below it.

That is inconsistent.

The account-performance section must become part of the same customizable dashboard layout so the user can:

- Move it.
- Resize it.
- Hide it.
- Restore it.
- Place it beside period-to-date or risk information.

There should be one unified dashboard grid, not one fixed dashboard followed by another configurable dashboard.

### 2. Do not create one large card for every number

The current three-column layout wastes substantial space.

For example, using approximately one-third of the screen width only to display:

```text
$632.50
Cash
```

is not acceptable for a professional trading dashboard.

Metrics such as these do not need individual large cards:

- Cash.
- NAV.
- Marked positions.
- Realized P&L.
- Unrealized P&L.
- Fees.
- Gross exposure.
- Net exposure.
- Drawdown.
- Win rate.
- Trade count.
- Average R.
- Profit factor.

Replace individual large cards with compact grouped metric panels.

Suggested structure:

```text
┌──────────────────────────────────────┐
│ Account Performance                  │
├──────────────┬──────────────┬────────┤
│ NAV          │ Cash         │ Equity │
│ $10,632      │ $632         │ $10,632│
├──────────────┼──────────────┼────────┤
│ Realized P&L │ Open P&L     │ Total  │
│ +$420        │ +$85         │ +$505  │
├──────────────┼──────────────┼────────┤
│ Gross Exp.   │ Net Exp.     │ Drawdown│
│ $8,400       │ $6,200       │ -2.1%  │
└──────────────┴──────────────┴────────┘
```

A grouped panel can contain six to twelve metrics while occupying approximately the same space currently used by two or three cards.

### 3. Combine related metrics into high-density widgets

Use large draggable widgets containing compact internal grids.

Recommended first-row widgets:

#### Account Performance

Contains:

- NAV.
- Cash.
- Marked positions.
- Realized P&L.
- Unrealized P&L.
- Total P&L.
- Gross exposure.
- Net exposure.
- Drawdown.

#### Period-to-Date Performance

Contains:

- Net P&L.
- Return.
- Average R.
- Profit factor.
- Win rate.
- Payoff ratio.
- Trade count.
- Average grade.
- Fees.

#### Current Risk

Contains:

- Open positions.
- Open risk.
- Portfolio heat.
- Positions without stops.
- Fresh/stale/missing prices.
- Largest exposure.
- Current drawdown.

These widgets should be independently draggable and resizable.

Do not make every metric independently draggable. That would create excessive layout complexity and reproduce the card problem at a smaller scale.

The correct customization unit is usually a meaningful analytical panel, not an isolated number.

### 4. Recommended first-screen layout

At `1440 × 900`, the first screen should approximately contain:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Account | Date | Setup | Direction | View | Customize | Refresh    │
├───────────────────────────────┬──────────────────────────────────────┤
│ Account Performance           │ Period-to-Date / Current Risk        │
│ compact 3 × 3 metric matrix   │ compact metric matrix               │
├───────────────────────────────┴──────────────────────────────────────┤
│ Equity and Drawdown                     │ Open Positions and Risk    │
├──────────────────────────┬──────────────────────┬────────────────────┤
│ Period Comparison        │ Setup Ranking        │ Attention / Process│
└──────────────────────────┴──────────────────────┴────────────────────┘
```

The user should not need to scroll to see:

- Account value.
- Realized P&L.
- Unrealized P&L.
- Drawdown.
- Open positions.
- Open risk.
- Equity curve.
- Period performance.
- Critical warnings.

Scrolling is for secondary analytics, not for current account state.

### 5. Widget visibility and view configuration are required

The user must be able to choose which widgets are displayed.

Add an explicit `Customize Dashboard` mode with:

- Add widget.
- Remove widget.
- Move widget.
- Resize widget.
- Save layout.
- Cancel changes.
- Reset to default.
- Create a new dashboard view.
- Duplicate a view.
- Rename a view.
- Delete a view.
- Set a default view.

Suggested available widgets:

```text
Account Performance
Period-to-Date Metrics
Current Risk
Equity and Drawdown
Open Positions
Period Comparison
Performance Calendar
Setup Ranking
Process Discipline
Attention Insights
Monthly Performance
R Distribution
Directional Performance
Recent Trades
```

The system should ship with a dense default layout, but the user must be able to remove less relevant widgets.

### 6. Use the existing layout library correctly

`react-grid-layout` is already installed and should be used for the entire dashboard.

No additional primary UX library is required for:

- Dragging.
- Resizing.
- Grid collision.
- Widget positioning.
- Layout serialization.

However, the current implementation needs a proper customization layer around it.

Required changes:

- Put all primary dashboard sections inside the grid.
- Disable dragging and resizing during normal dashboard use.
- Add an explicit customization mode.
- Use a dedicated drag handle in each widget header.
- Enforce minimum and maximum sizes.
- Persist the complete layout.
- Add widget visibility configuration.
- Add saved dashboard views.

Do not leave drag and resize permanently enabled.

### 7. Suggested layout constraints

Use a 12-column desktop grid.

Example defaults:

```text
Account Performance       width 6, height 2–3
Period-to-Date Metrics    width 6, height 2–3
Equity and Drawdown       width 7–8, height 4–5
Open Positions / Risk     width 4–5, height 4–5
Period Comparison         width 4, height 2–3
Setup Ranking             width 4, height 2–3
Attention / Process       width 4, height 2–3
```

Prevent inappropriate resizing.

For example:

- A compact metric panel should not be resized to the entire screen.
- Equity/drawdown should not be reduced below a readable width.
- Open positions must retain enough width for a useful table.
- A single statistic must never occupy six or twelve columns.

### 8. Reduce vertical overhead

Remove or reduce:

- Large page title margins.
- Introductory dashboard descriptions.
- Large section descriptions.
- Separate tinted containers around every metric group.
- `p-5` padding inside small metric widgets.
- Large icons above each metric.
- Repeated section headings.
- Large gaps between grids.

Target values:

```text
Dashboard top padding:       8–12px
Toolbar height:             40–48px
Widget header height:       28–36px
Widget padding:              8–12px
Internal metric cell height: 42–58px
Grid gap:                    6–10px
Metric label:               10–11px
Metric value:               16–22px
```

### 9. Remove duplication

There must not be separate widgets showing the same values in multiple sections.

Currently account and journal dashboard areas overlap on:

- Realized P&L.
- Unrealized P&L.
- Account value/NAV.
- Drawdown.
- Exposure and open positions.

Use one authoritative display for each metric.

Ledger/accounting data should provide account-level values.

Journal calculations should provide:

- R metrics.
- Setup analytics.
- Process quality.
- Trade grades.
- Mistakes.
- Checklist adherence.

Do not stack two independent dashboards.

### 10. Acceptance criteria

The revision is not complete unless all of the following are true:

- The fixed `Account Performance` section has been integrated into the customizable grid.
- The first screen no longer contains a three-column grid of large individual metric cards.
- Account and period metrics are presented in compact grouped panels.
- The user can choose which widgets are visible.
- The user can move and resize widgets in explicit customization mode.
- The user can save multiple dashboard views.
- The default `1440 × 900` view shows account state, equity/drawdown, open positions/risk, and performance analysis without scrolling.
- Open positions and open risk are visible on the first screen.
- No core financial metric is duplicated across different dashboard systems.
- Historical polling and live valuation polling remain separate.
- The dashboard looks like a dense solo-trader workstation, not a generic SaaS analytics template.

Do not add more analytical widgets until this consolidation and density pass is complete.
