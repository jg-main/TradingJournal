# New Dashborad Design

Use the `trading-workstation-design` skill in **Greenfield Parallel Dashboard mode**.

The required data, calculations, APIs, accounting logic, journal analytics, market-data providers, and mark-to-market logic already exist in the repository. Reuse those authoritative data sources and domain services.

However, take **nothing from the existing dashboard presentation or architecture**.

Do not reuse or adapt:

- `DashboardV2`
- Existing dashboard page composition
- Existing KPI cards
- `KPI_WIDGET_MAP`
- Existing KPI widget components
- Existing dashboard layouts
- Existing chart-grid configuration
- Existing section tinting
- Existing card styling
- Existing dashboard `localStorage` layout keys
- Existing “Show detailed analytics” behavior
- Existing dashboard visual hierarchy
- Any component whose structure assumes one large card per metric

Do not attempt to improve, refactor, compress, or reorganize the existing dashboard.

Build a completely new dashboard from a blank UI architecture.

## Preserve the existing dashboard

The current dashboard must remain functional and unchanged as a legacy reference.

Build the new dashboard on a separate route:

```text
/workstation
```

Add a temporary navigation item:

```text
Workstation — Preview
```

Do not replace the existing dashboard route. Do not delete or modify the existing dashboard during this milestone.

Cutover will be a separate decision after visual review.

## What may be reused

Reuse only authoritative non-visual code where appropriate:

- Database and Drizzle schema
- Ledger and accounting calculations
- Journal calculations
- Existing trade data
- Existing account data
- Existing market-data providers
- Market-data resolver
- Mark-to-market calculations
- Equity and drawdown calculations
- Setup-performance calculations
- Period-comparison calculations
- Process and attention calculations
- Existing APIs when their contracts are suitable
- Pure formatting utilities that fit the workstation
- Application shell, theme support, and sidebar

Do not duplicate these calculations.

Create adapters when necessary to transform existing data into the new workstation contracts.

## New architecture

Create a new component tree under:

```text
src/components/workstation/
```

Suggested structure:

```text
src/app/workstation/page.tsx

src/components/workstation/
  workstation-shell.tsx
  workstation-toolbar.tsx
  workstation-alert-strip.tsx
  workstation-grid.tsx
  workstation-widget-frame.tsx
  workstation-view-selector.tsx
  workstation-customize-toolbar.tsx
  workstation-widget-catalog.tsx
  workstation-context.tsx
  widget-registry.ts
  view-schema.ts

  hooks/
    use-workstation-overview.ts
    use-live-mtm.ts
    use-workstation-view.ts
    use-workstation-layout.ts

  widgets/
    account-performance-widget.tsx
    period-performance-widget.tsx
    current-risk-widget.tsx
    equity-drawdown-widget.tsx
    open-positions-risk-widget.tsx
    period-comparison-widget.tsx
    setup-ranking-widget.tsx
    attention-process-widget.tsx
```

The new dashboard must have:

- One unified `react-grid-layout` grid
- One widget registry
- One account selector
- One filter context
- One shared data layer
- One live polling lifecycle
- Explicit customization mode
- Saved dashboard views
- Desktop-only layout
- Screenshot-driven visual acceptance

## First implementation stage: visual prototype

Before integrating all APIs, build the complete workstation using realistic fixture data.

The first prototype must be reviewed at:

```text
1440 × 900
```

It must include:

```text
Account Performance
Period Performance
Current Risk
Equity and Drawdown
Open Positions and Risk
Period Comparison
Setup Ranking
Attention / Process
```

The goal of this first stage is to approve:

- Density
- Information hierarchy
- Widget dimensions
- First-screen composition
- Typography
- Table density
- Chart allocation
- Workstation visual character

Do not spend the first stage adapting legacy dashboard components.

## Default layout

Use a 12-column desktop grid:

```ts
[
  { i: "account-performance", x: 0, y: 0, w: 4, h: 2 },
  { i: "period-performance", x: 4, y: 0, w: 4, h: 2 },
  { i: "current-risk", x: 8, y: 0, w: 4, h: 2 },

  { i: "equity-drawdown", x: 0, y: 2, w: 7, h: 5 },
  { i: "open-positions-risk", x: 7, y: 2, w: 5, h: 5 },

  { i: "period-comparison", x: 0, y: 7, w: 4, h: 3 },
  { i: "setup-ranking", x: 4, y: 7, w: 4, h: 3 },
  { i: "attention-process", x: 8, y: 7, w: 4, h: 3 },
];
```

Recommended grid configuration:

```ts
{
  cols: 12,
  rowHeight: 46,
  margin: [8, 8],
  containerPadding: [0, 0]
}
```

## Do not reproduce the existing design

The new dashboard must not contain:

- One card per metric
- Large icon boxes
- Oversized KPI numbers
- Three-column grids of individual numerical cards
- Full-width default charts
- Multiple independent dashboard sections
- Large tinted section backgrounds
- Large page descriptions
- Generic SaaS card styling
- Executive-dashboard spacing
- Open positions below the fold
- Fixed-height charts inside resizable widgets

Account Performance, Period Performance, and Current Risk must each be compact grouped metric matrices—not collections of nested cards.

## Data integration

After the visual prototype is approved, connect the existing data through a workstation-specific adapter.

Suggested contract:

```ts
interface WorkstationData {
  account: AccountWorkstationData | null;
  journal: JournalWorkstationData | null;
  live: LiveWorkstationData | null;
  analytics: AnalyticsWorkstationData | null;
  trades: WorkstationTradesData | null;
}
```

The dashboard shell loads shared data once.

Widgets must not perform independent global API requests.

The new dashboard may consume existing APIs, but it must not inherit the existing dashboard component architecture.

## Live data

Live mark-to-market polling must update only:

- Current prices
- Open P&L
- Exposure
- Open risk
- Portfolio heat
- Price freshness
- Open-position rows

It must not refetch:

- Equity history
- Calendar data
- Setup rankings
- Period comparisons
- Process analytics

## Isolation

Use separate persistence or namespacing for the new dashboard:

```text
workstation_views
```

or:

```text
dashboard_views.surface = 'workstation'
```

Do not overwrite legacy dashboard layouts or `localStorage` keys.

## Required deliverables

Before connecting production data:

1. Screenshot at `1440 × 900`
2. Screenshot at `1920 × 1080`
3. Normal mode
4. Customization mode
5. Realistic populated fixture data
6. Annotated widget dimensions
7. List of anything below the first-screen fold

After data integration:

1. Side-by-side screenshots of legacy Dashboard and new Workstation
2. Confirmation that the legacy dashboard remains functional
3. Confirmation that no business calculations were duplicated
4. Confirmation that no legacy dashboard visual components were reused
5. Playwright first-screen assertions
6. Test results
7. Remaining acceptance failures, if any

Do not replace the existing dashboard or begin migration until the new workstation has been visually approved.
