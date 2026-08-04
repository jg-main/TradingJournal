# Trading Journal Dashboard Redesign — Implementation Specification

## 1. Purpose

Redesign the Trading Journal home dashboard into a professional, data-dense, operational trading command center.

The dashboard must:

- Use the available viewport width efficiently rather than rendering inside a narrow centered container.
- Remain responsive and usable from large desktop monitors down to mobile screens.
- Prioritize risk-adjusted performance, current portfolio state, process quality, and actionable issues.
- Refresh open-position quotes automatically from the configured market-data provider at a configurable interval.
- Recompute mark-to-market values and live metrics without reloading all historical analytics.
- Preserve the current local-first architecture, calculation conventions, database migration discipline, and test expectations.
- Remain asset-neutral at the dashboard-contract level so equities are supported now without blocking future options, futures, forex, or crypto support.
- Allow users to create, save, select, duplicate, rename, reorganize, resize, and reset their own dashboard views from a controlled catalog of first-party widgets.

This document is the implementation source of truth for the dashboard redesign. Do not treat the current `src/app/page.tsx` layout as a design constraint.

---

## 2. Current-State Summary

The repository already provides the required foundations:

- Next.js App Router, React, TypeScript, Tailwind, shadcn/radix-style components.
- SQLite with Drizzle migrations.
- Accounts, trades, executions, risk snapshots, stop adjustments, grades, mistakes, checklists, weekly reviews, watchlists, and account rollforwards.
- Reusable ECharts wrapper.
- Dashboard KPI calculations in `src/lib/dashboard.ts`.
- Equity and drawdown calculations in `src/lib/equity.ts`.
- Mark-to-market calculations in `src/lib/mark-to-market.ts`.
- Configured quote-provider resolution in `src/lib/market-data-resolver.ts`.
- Quote refresh through `POST /api/trades/mtm/refresh`.
- Price snapshot persistence through `position_price_snapshots`.

The existing dashboard has several structural limitations that this milestone must resolve:

1. `src/app/page.tsx` is a large monolithic client component.
2. The dashboard is constrained by `max-w-4xl`, wasting desktop space.
3. Eleven similarly weighted KPI cards create weak information hierarchy.
4. Current-state metrics and selected-period metrics are mixed.
5. The account selector implies “All accounts,” but the API currently resolves a missing account to the default or first active account.
6. Monthly win-rate axis formatting treats a fractional value as if it were already a percentage.
7. Important process analytics are hidden behind a “detailed analytics” toggle.
8. Quote refresh is manual and triggers a second full dashboard fetch.
9. The current refresh route is globally rate-limited to one successful refresh every ten seconds.
10. Historical analytics and live valuation are not separated into independent update paths.

---

## 3. Product Principles

### 3.1 Operational, not decorative

The dashboard is not a marketing page. Favor:

- Dense, scannable tables.
- Compact metric strips.
- Clear current-state warnings.
- Consistent filter behavior.
- Drilldowns into the underlying trades.
- Minimal decorative whitespace.
- Limited use of icons and color.

### 3.2 Risk and process before vanity statistics

The dashboard must answer these questions quickly:

1. How am I performing over the selected period?
2. What is the current account and open-position state?
3. Is portfolio risk within limits?
4. Which setups, directions, or conditions produce the edge?
5. Which mistakes or process failures are degrading results?
6. What requires action now?

### 3.3 Separate historical analytics from live valuation

Do not poll the full dashboard endpoint.

Use two data domains:

- **Analytics domain:** selected-period realized performance, distributions, setup rankings, process analytics, calendar, period matrix.
- **Live domain:** current prices, open quantities, unrealized P&L, exposure, effective stops, open risk, portfolio heat, price freshness, and provider status.

Analytics refresh when filters or persisted trade data change. Live data refresh on its own configurable schedule.

### 3.4 Curated default with controlled customization

Ship an excellent, professional default dashboard first. Customization extends that default; it does not replace the product information architecture with an unrestricted blank canvas.

The system must:

- Preserve an immutable system default that can always be restored.
- Let users maintain multiple saved views for different workflows.
- Allow rearranging, resizing, adding, and removing supported widgets.
- Keep the global filter bar and critical risk/data-quality alerts outside the customizable grid so they cannot be accidentally hidden.
- Use a first-party widget registry. Saved layouts must never reference arbitrary React components, executable code, SQL, or user-supplied HTML.
- Require an explicit edit mode before drag or resize behavior is enabled.
- Keep normal dashboard interactions—chart zoom, table sorting, tooltips, text selection, and links—free from accidental dragging.

### 3.5 Asset-neutral contracts

Do not hardcode “shares,” “stock,” or equity-only behavior into generic dashboard DTOs. Use neutral names such as:

- `instrument`
- `quantity`
- `position`
- `marketValue`
- `assetClass`
- `contractMultiplier`

Equity UI labels may display “Shares” when `assetClass === 'equity'`.

Full multi-leg options and cross-currency accounting are out of scope for this milestone, but the dashboard implementation must not make them harder to add.

---

## 4. Required Dashboard Layout

## 4.1 Global layout

Replace the narrow centered dashboard container with a full-width responsive shell.

Required behavior:

```tsx
<main className="min-w-0 flex-1 overflow-auto">
  <div className="w-full max-w-none px-3 py-3 sm:px-4 lg:px-6 2xl:px-8">
    ...
  </div>
</main>
```

Do not use `max-w-4xl`, `max-w-5xl`, or another narrow application-wide cap on the dashboard.

The sidebar may continue consuming its normal width. The dashboard must use all remaining horizontal space. A collapsible desktop sidebar/icon rail is desirable but should not block the dashboard milestone.

## 4.2 Responsive grid

Use a responsive grid that becomes data-dense on larger screens:

- **Below 640 px:** one column.
- **640–1023 px:** two-column card layout where practical.
- **1024–1279 px:** eight-column analytical layout.
- **1280 px and above:** twelve-column layout.
- **1536 px and above:** retain twelve columns but increase chart/table width and reduce unnecessary wrapping.

Rules:

- No fixed widths that create horizontal page overflow.
- Dense tables may use an internal horizontal scroll container.
- Keep the symbol/instrument column sticky in wide tables when feasible.
- Charts must resize with their container.
- On mobile, secondary statistics may wrap into two columns.
- Do not hide critical risk warnings on smaller screens.
- Preserve readable touch targets on mobile without inflating desktop controls.

## 4.3 Desktop composition

Use the following approximate structure:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Account | Date | Asset | Setup | Direction | Regime | Compare | Refresh   │
├─────────────────────────────────────────────────────────────────────────────┤
│ Net P&L       Equity        Expectancy       Current / Maximum Drawdown     │
├─────────────────────────────────────────────────────────────────────────────┤
│ PF | Win Rate | Payoff | Avg R | Median R | Trades | Avg Risk | Fees       │
├──────────────────────────────────────────────┬──────────────────────────────┤
│ Equity + synchronized drawdown               │ Live positions and risk      │
├──────────────────────────────────────────────┼──────────────────────────────┤
│ Performance calendar                         │ Period matrix                │
├──────────────────────────────────────────────┼──────────────────────────────┤
│ Setup performance ranking                    │ Process and discipline       │
├──────────────────────────────────────────────┼──────────────────────────────┤
│ Performance breakdown                        │ What needs attention         │
├──────────────────────────────────────────────┴──────────────────────────────┤
│ Open and recent trades table                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

The exact column spans may vary by breakpoint, but the hierarchy must remain.


## 4.4 User-Configurable Dashboard Views

Users must be able to reorganize dashboard cards and build multiple purpose-specific views.

### Required user capabilities

Provide a dashboard view selector and these actions:

- Open the immutable `System Default`.
- Create a new view from the system default.
- Create a blank view from the approved widget catalog.
- Duplicate the current view.
- Rename a user-created view.
- Set a user-created view as the startup default.
- Delete a user-created view.
- Enter and exit layout edit mode.
- Drag widgets to new positions.
- Resize widgets within declared minimum and maximum dimensions.
- Add widgets from the catalog.
- Remove optional widgets.
- Configure supported per-widget options.
- Save or cancel an edit session.
- Undo the latest layout operation during the current edit session.
- Reset a user view to its original template.
- Export and import a versioned view configuration through the existing backup/export model.

Suggested first-party templates:

- `System Default`
- `Performance`
- `Risk Monitor`
- `Process Review`
- `Compact`

Templates are starting configurations, not separate hardcoded dashboard pages.

### Fixed versus customizable regions

Keep these outside the customizable grid:

- Global account/date/filter command bar.
- Active-view selector and customization controls.
- Critical risk and data-quality alert strip.
- Provider/freshness failure banner.
- Page-level errors.

The following may be registered widgets:

- Primary metrics.
- Secondary metric strip.
- Equity and drawdown.
- Live risk summary.
- Open positions.
- Performance calendar.
- Period matrix.
- Setup performance.
- Process and discipline.
- Attention items.
- Performance breakdown.
- Recent/open/needs-review trades.

A critical condition must still appear in the fixed alert strip even when the related widget is removed from a custom view. Users may customize presentation, but they may not suppress mandatory safety and data-quality signals.

### Edit-mode interaction model

The dashboard is locked by default.

When the user selects `Customize`:

1. Enable drag handles only in widget headers.
2. Enable resize handles only for widgets that declare themselves resizable.
3. Open the widget catalog.
4. Show `Save`, `Cancel`, `Undo`, and `Reset`.
5. Suspend chart-level pointer interactions while a widget is being dragged or resized.
6. Exclude widget body content from drag activation.
7. Validate the entire layout before saving.
8. Persist only after `Save`; `Cancel` restores the last persisted version.

Do not make the whole card draggable. Use a dedicated handle class such as:

```text
.dashboard-widget-handle
```

This prevents charts, links, table headers, and selected text from accidentally moving a widget.

### Package recommendation

Install:

```bash
npm install react-grid-layout
```

Recommended dependency at implementation time:

```json
"react-grid-layout": "^2.2.3"
```

Use the React Grid Layout v2 API. It is the preferred dashboard engine because it provides:

- React-native draggable and resizable widgets.
- First-class TypeScript support.
- React 18+ compatibility, covering the repository’s React 19 runtime.
- Responsive breakpoints with independent layouts.
- Serializable/restorable layout objects.
- Per-item minimum and maximum dimensions.
- Static/non-draggable widgets.
- Bounds checking and grid compaction.
- Server-rendered application support.
- `useContainerWidth`, which measures the actual remaining dashboard container instead of assuming `window.innerWidth`.

Use package exports documented by the installed v2 release, for example:

```ts
import {
  Responsive,
  useContainerWidth,
} from 'react-grid-layout';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
```

Use a mounted guard or `useContainerWidth({ measureBeforeMount: true })` to avoid server/client width mismatch.

The repository already includes:

```text
@dnd-kit/core
@dnd-kit/sortable
@dnd-kit/utilities
```

Retain `dnd-kit` for sortable lists, the widget-catalog list, and other one-dimensional interactions. Do not use it as the primary dashboard grid engine: the application would otherwise own resizing, collision handling, two-dimensional packing, and breakpoint-layout persistence. Do not mount both drag engines on the same widget surface.

Alternative evaluated:

- **GridStack:** technically capable, including saving/loading layouts, resizing, responsive columns, nested grids, and external drag-in. Do not choose it unless a proof of concept identifies a material requirement React Grid Layout cannot meet. Its core integration is more imperative and less aligned with the repository’s declarative React component model.
- **react-resizable-panels:** suitable for split panes, not a multi-widget dashboard.
- **Custom CSS Grid plus dnd-kit:** rejected because the team would need to build and maintain grid collision, resizing, packing, responsive layout translation, and persistence infrastructure.

Official references:

- `https://github.com/react-grid-layout/react-grid-layout`
- `https://www.npmjs.com/package/react-grid-layout`
- `https://docs.dndkit.com/`
- `https://gridstackjs.com/`

### Widget registry

Create a typed first-party widget registry instead of scattering switches on unvalidated saved strings.

Suggested contract:

```ts
type DashboardWidgetId =
  | 'primary-metrics'
  | 'secondary-metrics'
  | 'equity-drawdown'
  | 'live-risk'
  | 'open-positions'
  | 'performance-calendar'
  | 'period-matrix'
  | 'setup-performance'
  | 'process-discipline'
  | 'attention-items'
  | 'performance-breakdown'
  | 'dashboard-trades';

interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  title: string;
  description: string;
  component: React.ComponentType<DashboardWidgetProps>;

  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  maxSize?: { w: number; h: number };

  defaultEnabled: boolean;
  canHide: boolean;
  canResize: boolean;
  allowMultipleInstances: boolean;

  supportedAssetClasses: string[];
  requiredDataDomains: Array<'overview' | 'live' | 'trades'>;
  configSchema?: z.ZodType;
}
```

Saved views may reference only registered widget IDs. Unknown or retired IDs must be ignored with a non-fatal warning and removed when the view is next saved.

Use one shared data request per domain. Adding the same data-backed widget must not create another independent fetch or quote polling loop.

### Responsive layout persistence

Persist layouts by breakpoint instead of forcing one desktop coordinate set onto every screen.

Recommended breakpoints and columns:

```ts
const breakpoints = {
  lg: 1280,
  md: 1024,
  sm: 640,
  xs: 0,
};

const columns = {
  lg: 12,
  md: 8,
  sm: 4,
  xs: 1,
};
```

Requirements:

- Save an independent layout for every supported breakpoint.
- If a breakpoint layout is missing, derive it from the next larger layout and compact it deterministically.
- `xs` always renders as a single ordered column.
- Saving a desktop layout must not corrupt an existing mobile order.
- Validate against negative coordinates, duplicate IDs, unsupported IDs, invalid dimensions, and overlap after compaction.
- Measure the actual remaining content-container width.
- Notify ECharts widgets to resize after a grid resize ends.
- Do not persist transient drag coordinates on every pointer movement; persist the committed layout after the edit is saved.

### View persistence

Add a versioned `dashboard_views` table.

Suggested schema:

```ts
export const dashboardViews = sqliteTable('dashboard_views', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),

  accountId: text('account_id').references(() => accounts.id),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  isSystem: integer('is_system', { mode: 'boolean' }).default(false),

  schemaVersion: integer('schema_version').notNull().default(1),
  configJson: text('config_json').notNull(),

  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});
```

`accountId = null` means the view is globally available. An account-specific startup view may override the global startup view for that account.

Suggested configuration:

```ts
interface DashboardViewConfigV1 {
  schemaVersion: 1;

  widgets: Array<{
    id: DashboardWidgetId;
    enabled: boolean;
    config?: Record<string, unknown>;
  }>;

  layouts: {
    lg?: DashboardGridItem[];
    md?: DashboardGridItem[];
    sm?: DashboardGridItem[];
    xs?: DashboardGridItem[];
  };
}

interface DashboardGridItem {
  i: DashboardWidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
}
```

Requirements:

- Validate `configJson` with Zod at every API boundary.
- Seed one immutable system default.
- Do not mutate the system default; customization creates a user-owned copy.
- Enforce one default user view per scope using a transaction.
- Include a `schemaVersion` and explicit migration functions for future widget changes.
- Include dashboard views in backup/export and restore.
- Apply reasonable limits, for example 50 user views.
- Reject duplicate widget instances unless the registry explicitly allows them.
- Store presentation configuration only. Do not store metrics, secrets, provider credentials, SQL, or executable expressions in the view.

### API surface

Suggested routes:

```text
GET    /api/dashboard/views
POST   /api/dashboard/views
GET    /api/dashboard/views/[id]
PUT    /api/dashboard/views/[id]
DELETE /api/dashboard/views/[id]
POST   /api/dashboard/views/[id]/duplicate
POST   /api/dashboard/views/[id]/set-default
POST   /api/dashboard/views/[id]/reset
```

Use Zod validation and the repository’s existing API error conventions.

### Accessibility

Drag-and-drop cannot be the only configuration mechanism.

Each widget menu must provide keyboard-operable alternatives:

- Move earlier.
- Move later.
- Move to top.
- Move to bottom.
- Width: compact / standard / wide / full.
- Height: compact / standard / tall, when supported.
- Remove from view.

Also:

- Announce move and resize changes through an ARIA live region.
- Provide an accessible label on the drag handle.
- Preserve visible focus states.
- Keep controls reachable without interacting with the chart canvas.
- Keep DOM order aligned with compacted visual reading order as closely as possible.

### Customization performance rules

- Layout changes must not refetch analytics.
- Dragging or resizing must not trigger market-data refresh.
- The auto-refresh hook must exist once at the dashboard-shell level, not once per widget.
- A layout operation should update only layout state and affected widget dimensions.
- ECharts resize should be throttled during active resizing and finalized on resize stop.
- Lazy-mount widgets below the fold only when it does not hide critical live risk.
- Removing a widget must not discard the underlying trade or metric data.


---

## 5. Global Filter and Command Bar

Create one compact filter bar shared by every historical dashboard panel.

Required filters:

- Account.
- Date range.
- Date presets: `1W`, `1M`, `3M`, `6M`, `YTD`, `All`.
- Asset class.
- Setup/play.
- Direction.
- Market condition/regime.
- Grade or process-score range.
- Followed plan: all / yes / no.
- Mistake present: all / yes / no.
- Comparison: none / previous equivalent period.
- Reset filters.
- Manual quote refresh.

Requirements:

- Persist filter state in URL search parameters.
- Keep filter serialization in one hook or utility.
- Do not let individual panels maintain conflicting local filter state.
- Clicking a setup, direction, calendar day, process bucket, or breakdown row should apply a dashboard filter or open a filtered trade drilldown.
- Make active filters visible.
- On mobile, collapse advanced filters into a drawer or popover; keep account, date, and refresh directly accessible.

### Account semantics

Correct the current misleading account behavior.

Implement one of these explicit states:

- A specific account.
- Consolidated “All accounts.”

For consolidated mode:

- Aggregate only accounts using the same reporting currency.
- If selected accounts have different currencies and FX normalization is unavailable, disable consolidated financial totals and show a precise explanation.
- Do not silently fall back to the default account.
- Non-financial counts may still aggregate, but do not mix currencies in P&L, equity, exposure, or drawdown.

---

## 6. Metric Hierarchy

## 6.1 Primary metrics

Replace the eleven equal KPI cards with four primary metric cells.

### A. Net P&L — selected period

Display:

- Realized net P&L.
- Return percentage where a valid beginning-equity denominator exists.
- Change versus comparison period.
- Closed-trade count or coverage note.

### B. Current equity — current state

Display:

- Current account equity.
- Period change.
- High-water mark.
- Current unrealized P&L as a subordinate value.

### C. Expectancy — selected period

Display:

- Expectancy in dollars.
- Expectancy in R.
- Sample size.
- Null/insufficient-data state when initial risk is unavailable.

Definitions:

```text
Dollar expectancy =
    win_rate × average_winning_trade
  - loss_rate × average_losing_trade_magnitude

R expectancy =
    mean valid closed-trade R multiple
```

Do not present win rate without payoff or expectancy context.

### D. Drawdown

Display:

- Current drawdown amount and percentage.
- Maximum drawdown in the selected period.
- Days underwater.
- Recovery state or distance to high-water mark.

## 6.2 Secondary metric strip

Use one compact strip, not separate large cards:

- Profit factor.
- Win rate.
- Payoff ratio.
- Average R.
- Median R.
- Closed trades.
- Average account risk per trade.
- Fees.
- Average hold time, when available.

Definitions must be exposed through tooltips or a metric glossary.

### Correctness requirement

Fix the monthly win-rate formatting bug. Internally stored fractions must render as percentages by multiplying by 100 or by using an explicit formatter.

---

## 7. Equity and Drawdown Panel

Create the dominant historical chart panel.

Required features:

- Equity, cumulative realized P&L, and cumulative R toggle.
- Net/gross toggle where fee data supports it.
- High-water-mark overlay.
- Synchronized drawdown pane below the main series.
- Zoom and pan.
- Clear zero baseline for cumulative P&L and R.
- Entry/exit marker toggle; markers are off by default to avoid clutter.
- Tooltips containing date, equity, cumulative P&L, drawdown, and relevant trade event.
- Comparison-period overlay when comparison mode is active.
- Respect the global date and account filters.

Do not render equity and drawdown as unrelated cards. They represent the same risk-return path.

---

## 8. Live Open Positions and Mark-to-Market

This is a mandatory part of the redesign.

## 8.1 Auto-refresh behavior

When one or more positions are open, fetch quotes from the configured quote provider every configured number of seconds and recompute live metrics.

Add explicit settings to `market_data_settings`:

```ts
autoRefreshEnabled: boolean          // default true
quoteRefreshIntervalSeconds: number // default 30
pauseRefreshWhenHidden: boolean     // default true
priceStaleAfterSeconds: number      // default 90
```

Validation:

- Minimum configured interval: 10 seconds.
- Suggested selectable values: 10, 15, 30, 60, 120, 300.
- Maximum accepted value: 3600 seconds.
- If a provider exposes a stricter minimum, use the larger of the application setting and provider minimum.
- Do not allow an invalid interval to create a tight retry loop.

The current configured-provider resolution remains the authoritative source. Do not introduce a dashboard-specific provider selection path.

## 8.2 Polling lifecycle

Create a reusable hook such as:

```text
src/components/dashboard/use-live-mtm.ts
```

Required behavior:

1. Load the dashboard from persisted prices immediately.
2. If open positions exist and prices are stale, request an immediate refresh.
3. Start the configured interval only when:
   - auto refresh is enabled;
   - at least one position is open;
   - the dashboard is mounted;
   - the document is visible when `pauseRefreshWhenHidden` is enabled.
4. Never start a second request while one is already in flight.
5. Pause polling when the tab is hidden.
6. On visibility restore, refresh immediately if the latest data is stale.
7. Stop polling when all positions are closed.
8. Reset the interval cleanly when configuration changes.
9. Apply exponential backoff after repeated provider or network failures, capped at five minutes.
10. Reset the backoff after a successful refresh.
11. Preserve manual refresh.
12. Manual refresh must respect the server/provider minimum interval and display the returned retry time after HTTP 429.
13. Do not show a page-level loading skeleton during live refreshes.
14. Update only live dashboard state.

Do not use `setInterval` without cleanup, visibility handling, and an in-flight guard.

## 8.3 Server-side refresh service

Refactor the current route implementation so provider fetching, persistence, and live-summary construction are not embedded entirely in the route handler.

Suggested structure:

```text
src/lib/server/market-data/refresh-open-positions.ts
src/app/api/trades/mtm/refresh/route.ts
```

The server service should:

1. Query all relevant open trades for the requested account scope.
2. Deduplicate quote requests by normalized instrument symbol.
3. Resolve the configured quote provider.
4. Fetch quotes in a batch when supported.
5. Persist successful `position_price_snapshots`.
6. Update each trade’s current price and fetch timestamp.
7. Keep the last valid price when a symbol refresh fails.
8. Compute per-position open quantity, average entry, market value, unrealized P&L, effective stop, open risk, and price status.
9. Compute the aggregate live summary.
10. Return provider and freshness metadata.
11. Preserve the current non-blocking Yahoo profile enrichment behavior where applicable.
12. Avoid importing database code into pure calculation modules.

Keep pure formulas in `src/lib/mark-to-market.ts` or additional pure libraries.

## 8.4 Refresh response contract

Extend `POST /api/trades/mtm/refresh` to return a live dashboard payload so the client does not need to refetch the full historical dashboard after every quote update.

Suggested response:

```ts
interface LiveDashboardResponse {
  requestedProvider: string;
  resolvedProvider: string;
  refreshedAt: string;
  nextAllowedRefreshAt: string | null;

  quoteResult: {
    requestedSymbols: number;
    updatedSymbols: number;
    failedSymbols: string[];
  };

  summary: {
    openPositionCount: number;
    positionsWithFreshPrices: number;
    positionsWithStalePrices: number;
    positionsMissingPrices: number;

    grossMarketValue: number | null;
    netMarketExposure: number | null;
    netUnrealizedPnl: number | null;

    openRiskAmount: number | null;
    openRiskPct: number | null;
    portfolioHeatPct: number | null;

    positionsWithoutStops: number;
  };

  positions: LivePositionRow[];
}
```

Suggested position DTO:

```ts
interface LivePositionRow {
  tradeId: string;
  accountId: string;
  instrument: string;
  assetClass: string;
  direction: 'long' | 'short';

  quantity: number;
  contractMultiplier: number;
  averageEntryPrice: number | null;
  currentPrice: number | null;
  currentPriceFetchedAt: string | null;
  valuationStatus: 'fresh' | 'stale' | 'missing' | 'error';

  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedR: number | null;

  effectiveStopPrice: number | null;
  openRiskAmount: number | null;
  openRiskPct: number | null;

  sector: string | null;
  industry: string | null;
  ageDays: number | null;
}
```

Do not return a zero price or zero P&L when data is missing.

## 8.5 Price freshness and failure semantics

For each position:

- **Fresh:** quote age is within `priceStaleAfterSeconds`.
- **Stale:** a previous valid price exists but is older than the threshold.
- **Missing:** no valid price has ever been stored.
- **Error:** latest refresh failed; use the last valid price if available and mark it stale/error.

Aggregate P&L may use the last valid stale price, but the UI must show coverage:

```text
Open P&L: +$842.10
Prices: 4 fresh · 1 stale · 0 missing
As of: 10:32:18
Provider: Schwab
```

Never erase valid prices because a provider call fails.

Show:

- Refreshing indicator.
- Last successful refresh.
- Next scheduled refresh countdown.
- Configured and resolved provider.
- Fresh/stale/missing coverage.
- Symbol-level errors.
- A non-blocking warning when fallback provider resolution occurs.

## 8.6 Live position panel

Show a compact summary:

```text
Open positions                 3
Unrealized P&L            +$842
Portfolio heat              1.35%
Open risk                    $620
Positions without stops         1
Largest sector exposure       58%
```

Then a dense sortable table:

```text
Instrument | Side | Qty | Avg Entry | Last | P&L | P&L R | Stop | Risk | Exposure | Age | Status
```

Requirements:

- P&L and risk values use tabular numerals.
- Instrument links open the trade detail.
- Missing stops are visually prominent.
- Stale prices use an amber status, not red P&L formatting.
- Failed/missing quotes do not collapse the panel.
- Sort by risk, P&L, exposure, age, or instrument.
- On narrow screens, show the most important columns and place the rest in an expandable row.

## 8.7 Effective stop and open-risk calculation

Define effective stop in this order:

1. Latest valid stop adjustment.
2. Initial stop from `trade_risk_snapshots`.
3. Planned stop from the trade.
4. Missing.

For an equity position with multiplier 1:

```text
Long open risk =
  max(0, average_entry_price - effective_stop_price)
  × open_quantity

Short open risk =
  max(0, effective_stop_price - average_entry_price)
  × open_quantity
```

For future asset classes:

```text
open risk =
  directional price distance
  × open quantity
  × contract multiplier
```

Portfolio heat:

```text
portfolio heat % =
  sum(valid open position risk)
  / current account equity
```

If any open position lacks a stop, report both:

- Known portfolio heat.
- Number and market value of positions excluded from risk calculation.

Do not present known portfolio heat as complete when stop coverage is incomplete.

---

## 9. Performance Calendar

Add a daily/monthly performance calendar.

Metric toggle:

- P&L.
- R.
- Process score.
- Trade count.

Each day cell should show:

- Primary selected metric.
- Trade count.
- Rule-violation indicator when applicable.
- Tooltip with P&L, R, win/loss count, process score, and fees.

Clicking a day filters the dashboard or opens the filtered trade list.

Color intensity must use a bounded scale so one outlier does not make all other days indistinguishable. Always provide text values; do not rely only on color.

---

## 10. Period Matrix

Add a Myfxbook-style period matrix adapted to this journal.

Required rows:

- Today.
- This week.
- This month.
- This quarter.
- YTD.
- All time.

Required columns:

- Net P&L.
- Return.
- R.
- Trades.
- Win rate.
- Profit factor.
- Maximum drawdown.
- Average process score.

Rows should be clickable.

Use consistent period boundaries based on the configured application timezone.

---

## 11. Setup Performance Ranking

Create a sortable table instead of only a chart.

Required columns:

```text
Setup | Sample | Net P&L | Avg R | Median R | PF | Win Rate | Max DD | Process | Trend
```

Requirements:

- Respect all global filters except setup when showing the full ranking.
- Clicking a row applies the setup filter.
- Show a sample-size warning.
- Do not identify a setup as “best” with insufficient observations.
- Default minimum sample for strong claims: 10 closed trades.
- Still display smaller samples, clearly marked.
- Include a compact sparkline or recent-period trend where practical.
- Provide a drilldown to the underlying trades.

---

## 12. Process and Discipline Panel

Process quality must be visible on the main dashboard.

Show:

- Average process score.
- Process-score trend.
- Percentage of A/B process trades.
- Checklist adherence.
- Plan-followed versus plan-violated results.
- Rule-violation count.
- Trades awaiting grading.
- Open corrective actions.
- P&L and R associated with mistake-tagged trades.

Use precise wording.

Do not label a number “mistake cost” unless a valid counterfactual model exists. In the first implementation, use:

- `P&L on trades with mistakes`.
- `R on trades with mistakes`.
- `Mistake-associated trade count`.

A later MAE/MFE or planned-exit model may support estimated execution cost.

---

## 13. “What Needs Attention” Panel

Implement deterministic insights before adding AI-generated commentary.

Each insight must include:

- The measured issue.
- Sample size.
- Comparison baseline.
- Materiality threshold.
- Link to the filtered underlying trades.

Examples:

```text
Friday trades produced -3.8R across 14 closed trades versus +0.6R on other days.
Trades with checklist adherence below 6/7 produced -4.2R across 9 trades.
Three closed trades remain ungraded.
One open position has no effective stop.
Two open-position prices are stale.
```

Requirements:

- Minimum sample for behavioral/performance claims: five trades.
- Do not generate claims from one or two trades.
- Prioritize risk and data-quality issues above statistical observations.
- Limit the main panel to the three to five highest-priority items.
- Provide “View trades” or a direct corrective action.
- Rules must be unit tested.

Suggested priority:

1. Open position without stop.
2. Missing or stale price.
3. Risk-limit breach.
4. Ungraded or incomplete review backlog.
5. Significant negative process pattern.
6. Significant negative setup/time/regime pattern.

---

## 14. Recent and Open Trades Table

Add a dense dashboard table with tabs:

- Open.
- Recently closed.
- Needs review.

Open columns:

```text
Instrument | Side | Opened | Qty | Avg Entry | Last | P&L | R | Stop | Risk | Setup | Status
```

Closed columns:

```text
Instrument | Closed | Setup | P&L | R | Grade | Followed Plan | Mistakes | Hold Time
```

Requirements:

- Paginated or virtualized when needed.
- Sortable.
- Filtered by the global dashboard context.
- Row click opens trade detail.
- Do not fetch an unbounded full execution history merely to render the first page.
- Provide a clear empty state for each tab.

---

## 15. Historical Analytics API

Keep historical analytics independent from the live polling path.

The existing `GET /api/dashboard` may remain the overview endpoint, but its contract should be reorganized.

Suggested response groups:

```ts
interface DashboardOverviewResponse {
  filterContext: {...};

  periodMetrics: {...};
  currentAccountState: {...};

  equitySeries: {...};
  drawdownSeries: {...};

  calendar: {...};
  periodMatrix: {...};
  setupPerformance: {...};
  processAnalytics: {...};
  breakdowns: {...};
  attentionItems: {...};

  dataCoverage: {
    closedTrades: number;
    tradesWithRisk: number;
    tradesWithGrades: number;
    tradesWithChecklists: number;
  };
}
```

Important:

- Current-state metrics must be labeled and grouped separately from selected-period metrics.
- `totalTrades` in a selected-period response must not silently mean all-time trades.
- Use explicit names such as `periodClosedTrades`, `currentOpenPositions`, and `currentEquity`.
- Add response-contract tests.
- Avoid polling this endpoint.

For large datasets, prefer SQL-side grouping or targeted aggregation rather than repeatedly hydrating every related row into memory. Preserve pure computation functions by passing plain DTOs into them.

---

## 16. Component and Module Structure

Refactor the current monolithic page.

Suggested structure:

```text
src/app/page.tsx
src/components/dashboard/
  dashboard-shell.tsx
  dashboard-toolbar.tsx
  dashboard-view-selector.tsx
  dashboard-customize-toolbar.tsx
  dashboard-widget-grid.tsx
  dashboard-widget-frame.tsx
  dashboard-widget-catalog.tsx
  dashboard-filter-drawer.tsx
  primary-metrics.tsx
  secondary-metric-strip.tsx
  equity-drawdown-panel.tsx
  live-risk-panel.tsx
  open-positions-table.tsx
  performance-calendar.tsx
  period-matrix.tsx
  setup-performance-table.tsx
  process-discipline-panel.tsx
  attention-panel.tsx
  dashboard-trades-table.tsx
  dashboard-empty-state.tsx
  dashboard-error-state.tsx
  use-dashboard-filters.ts
  use-dashboard-overview.ts
  use-dashboard-view.ts
  use-dashboard-layout.ts
  use-live-mtm.ts
  widget-registry.ts
  view-schema.ts
  types.ts

src/lib/
  dashboard.ts
  dashboard-periods.ts
  dashboard-process.ts
  dashboard-attention.ts
  dashboard-live-risk.ts
  mark-to-market.ts

src/lib/server/market-data/
  refresh-open-positions.ts
```

Exact file names may vary, but maintain these boundaries:

- Components render.
- Hooks own browser lifecycle and fetch state.
- Route handlers validate and orchestrate.
- Server services perform DB/provider operations.
- `src/lib/*.ts` calculations remain pure and testable.
- Do not import Drizzle or `NextResponse` into pure calculation files.

---

## 17. Minimal Multi-Asset Foundation

This milestone must not implement full multi-leg trading, but it should add enough structure to avoid equity-only dashboard contracts.

Recommended minimal schema addition:

```ts
trades.assetClass
```

Supported values initially:

```text
equity
option
future
forex
crypto
```

Migration behavior:

- Existing trades default to `equity`.
- Current forms default to `equity`.
- Dashboard asset-class filter is present.
- Current calculations support equity.
- Unsupported asset-class calculations must return explicit unsupported/partial coverage states rather than silently applying equity formulas.

Recommended DTO fields:

```text
assetClass
instrument
quantity
contractMultiplier
reportingCurrency
```

Do not rename the existing `trade_assets` attachment table as part of this milestone. Document clearly that it stores screenshots/documents/links and is not an instrument master.

Deferred:

- Instrument master.
- Multi-leg trade model.
- Options Greeks.
- Futures contract specifications and rolls.
- Forex pip/lot calculations.
- Crypto funding.
- FX conversion and cross-currency portfolio reporting.

---

## 18. Visual and Interaction Standards

### Density

- Use compact card padding.
- Prefer one metric strip over many cards.
- Prefer tables for multi-dimensional comparisons.
- Use `tabular-nums` for numerical data.
- Keep section headings small and functional.
- Avoid large empty headers and promotional copy.

### Color

- Positive: restrained green.
- Negative: restrained red.
- Warning/stale: amber.
- Neutral: zinc/foreground tokens.
- Do not use color alone to communicate state.
- Do not color every positive metric green; reserve strong color for meaningful state changes and exceptions.

### Loading

- Initial overview: section-level skeletons.
- Live refresh: subtle inline spinner only.
- Do not blank charts or tables during a refresh.
- Preserve last successful values while new data loads.

### Errors

- Historical overview failure and live refresh failure are separate states.
- A quote-provider failure must not hide historical analytics.
- A historical analytics failure must not prevent open-position refresh if the live endpoint is operational.
- Show actionable retry controls.

### Accessibility

- Keyboard-accessible filters and tabs.
- Tooltips must not be the only source of essential information.
- Visible focus states.
- Sufficient contrast.
- ARIA labels for icon-only controls.
- Charts must have adjacent summaries or accessible tabular equivalents for core values.

---

## 19. Performance Requirements

- Do not refetch all historical dashboard calculations every 10–30 seconds.
- Deduplicate symbols before provider requests.
- Batch quote requests when provider supports it.
- Do not issue overlapping refresh requests.
- Keep overview and live response payloads separate.
- Paginate recent-trade tables.
- Memoize expensive client chart options where useful.
- Avoid rebuilding all charts when only live prices change.
- Use stable component boundaries so live state updates do not rerender the entire dashboard.
- Retain canvas rendering for ECharts unless a specific accessibility requirement needs an alternative.
- Add DB indexes for new high-frequency query paths where justified.

Target behavior on a normal local dataset:

- Dashboard remains interactive during refresh.
- Live refresh does not cause visible layout shifts.
- Live route response should normally complete within the provider latency plus minimal local DB overhead.
- No accumulating intervals, listeners, or requests after navigation.

---

## 20. Migration and Settings Work

Required schema work:

1. Add auto-refresh settings to `market_data_settings`.
2. Add the versioned `dashboard_views` table and seed the immutable system default.
3. Add `trades.assetClass` with default `equity`, unless the team explicitly documents why this is deferred.
4. Add indexes needed for:
   - open trades by account/status;
   - latest price snapshot by trade/fetch time;
   - latest stop adjustment by trade/adjusted time.
5. Generate and commit a Drizzle migration.
6. Update settings API validation.
7. Add UI controls under Market Data settings.
8. Preserve existing provider configuration.
9. Include dashboard view configuration in backup/export and restore.
10. Do not store secrets in provider JSON, dashboard settings, or view configuration.

Settings UI must explain:

- Active quote provider.
- Auto-refresh enabled.
- Refresh interval.
- Stale-price threshold.
- Pause while tab is hidden.
- Effective minimum interval.

---

## 21. Testing Requirements

Follow the repository’s existing Vitest, response-contract, migration, and Playwright conventions.

## 21.1 Pure unit tests

Add tests for:

- Expectancy.
- Payoff ratio.
- Median R.
- Maximum drawdown in selected period.
- Days underwater.
- Effective stop resolution.
- Open position risk for long and short positions.
- Portfolio heat.
- Missing-stop coverage.
- Fresh/stale/missing valuation classification.
- Consolidated same-currency account aggregation.
- Mixed-currency rejection.
- Period matrix boundaries in the configured timezone.
- Deterministic attention-item prioritization.
- Minimum sample-size rules.
- Monthly percentage formatting helper.

## 21.2 Refresh service tests

Cover:

- No open positions.
- Duplicate symbols across positions.
- Successful batch quote update.
- Partial provider failure.
- Total provider failure.
- Last valid price preserved on failure.
- Stale status after threshold.
- Configured provider resolution.
- Fallback provider metadata.
- Rate limit.
- No successful quote means cooldown is not reset, preserving current behavior unless intentionally changed.
- Successful refresh persists snapshots and updates trade prices.
- Live response recomputes unrealized P&L.
- Position without stop is excluded from known heat and counted separately.
- Account scope is enforced.

## 21.3 Hook/component tests

Cover:

- System default cannot be mutated.
- Creating, renaming, duplicating, deleting, and setting a default view.
- Entering edit mode is required before drag or resize.
- Save persists; cancel restores the prior layout.
- Add/remove widget behavior.
- Widget minimum and maximum dimensions.
- Unknown widget IDs fail safely.
- Breakpoint-specific layouts persist independently.
- Missing breakpoint layouts derive deterministically.
- Mobile single-column ordering.
- Keyboard move and size controls.
- Layout changes do not refetch analytics or trigger quote refresh.
- ECharts receives a resize after widget resize.
- Polling starts only with open positions.
- Polling stops after positions close.
- Interval cleanup on unmount.
- No overlapping requests.
- Hidden-tab pause.
- Resume and stale refresh.
- Backoff after errors.
- Manual refresh and HTTP 429 countdown.
- Live refresh does not trigger full overview reload.
- Responsive table column behavior.
- Filter state persists in the URL.

## 21.4 Playwright

Add user-facing flows for:

1. Wide desktop layout uses available content width.
2. Mobile filter drawer works.
3. Date/account filters update all historical panels.
4. Manual quote refresh updates open P&L.
5. Automatic refresh updates live values without page reload.
6. Stale-price warning appears.
7. Missing-stop warning links to the affected trade.
8. Setup-ranking row filters the dashboard.
9. Calendar-day click opens or filters relevant trades.
10. “All accounts” does not silently resolve to one account.
11. Historical charts remain visible when live quote refresh fails.
12. User can create a custom view, reorder and resize widgets, save it, reload the page, and recover the same layout.
13. User can switch between system default and custom views.
14. Mobile layout remains usable after desktop customization.
15. Keyboard controls can reorganize a widget without drag-and-drop.

## 21.5 Quality gate

Run:

```bash
make lint
make typecheck
make build
make test-all
make playwright
```

Document any intentionally skipped browser test and the reason.

---

## 22. Recommended Delivery Sequence

Implement in reviewable slices. Do not deliver the entire redesign as one unstructured change.

### PR 1 — Correctness and contracts

- Fix monthly win-rate formatting.
- Define selected-period versus current-state semantics.
- Correct account-selector behavior.
- Introduce grouped dashboard response types.
- Add calculation tests and response-contract tests.

### PR 2 — Responsive dashboard shell and view foundation

- Add `react-grid-layout` v2.
- Full-width root.
- Responsive widget grid.
- Typed widget registry.
- Immutable system-default view.
- Versioned `dashboard_views` persistence and APIs.
- Filter/command bar.
- Four primary metrics.
- Secondary metric strip.
- View selector and explicit customization mode.
- Refactor monolithic page into components.

### PR 3 — Live MTM architecture

- Add refresh settings.
- Refactor provider refresh into server service.
- Extend refresh response with live summary and position rows.
- Implement `use-live-mtm`.
- Add visibility pause, in-flight guard, stale handling, backoff, and manual refresh.
- Add live risk/positions panel.

### PR 4 — Core analytical panels

- Combined equity/drawdown chart.
- Performance calendar.
- Period matrix.
- Recent/open/needs-review trade table.

### PR 5 — Edge and process panels

- Setup performance table.
- Process and discipline panel.
- Deterministic attention items.
- Drilldowns and sample-size warnings.

### PR 6 — Custom views, multi-asset preparation, and hardening

- Complete add/remove, drag, resize, duplicate, reset, import/export, and per-breakpoint view behavior.
- Add keyboard alternatives and customization accessibility tests.
- Minimal `assetClass` migration and filter.
- Asset-neutral DTO review.
- Responsive and accessibility audit.
- Query/index optimization.
- Full regression test pass.
- Update README/help documentation.

Each PR must leave the application functional.

---

## 23. Acceptance Criteria

The milestone is complete only when all conditions below are satisfied.

### Layout and responsiveness

- Dashboard no longer uses `max-w-4xl`.
- At 1440 px and wider, the dashboard uses the available content width.
- No unintended page-level horizontal scrollbar.
- Core panels stack cleanly on mobile.
- Tables remain usable on narrow screens.
- Charts resize without clipping.

### User-configurable views

- An immutable system default is available and restorable.
- Users can create, duplicate, rename, select, delete, and set a default custom view.
- Users can add, remove, move, and resize registered widgets in explicit edit mode.
- Saving persists the layout; canceling restores the last persisted layout.
- Layouts persist independently by responsive breakpoint.
- Mobile always renders a usable single-column view.
- Critical risk and data-quality alerts remain visible outside the customizable grid.
- Unknown or retired widget IDs fail safely.
- View configuration is versioned, validated, backed up, and restored.
- Layout operations do not refetch historical analytics or trigger extra quote polling.
- Keyboard users can reorganize and resize widgets without drag-and-drop.

### Metrics

- Four primary metrics have clear hierarchy.
- Secondary statistics render in a compact strip.
- Selected-period and current-state metrics are not mixed ambiguously.
- Monthly win-rate percentages are correct.
- Metric coverage/sample size is visible where relevant.

### Live data

- Open-position quotes come from the configured provider.
- Refresh interval is configurable.
- Automatic refresh runs only while required.
- Hidden-tab pause works.
- No overlapping refresh calls occur.
- Live refresh updates open P&L and risk metrics without refetching the full historical dashboard.
- Manual refresh remains available.
- Provider failures preserve last valid values and display freshness/error state.
- Fresh/stale/missing price coverage is visible.
- Missing stops are visible.
- Portfolio heat communicates incomplete stop coverage.

### Analytics

- Combined equity/drawdown panel is implemented.
- Performance calendar is implemented.
- Period matrix is implemented.
- Setup ranking is implemented.
- Process/discipline panel is visible without an extra “show details” step.
- Attention panel uses deterministic, testable rules.
- Open/recent/needs-review trade table is implemented.

### Account behavior

- “All accounts” performs real valid aggregation or is unavailable with an explicit explanation.
- Missing account selection does not masquerade as consolidated mode.
- Mixed-currency financial aggregation is not performed without FX normalization.

### Engineering quality

- Current provider resolver is reused.
- Pure calculations remain database-independent.
- Schema changes include migrations.
- Response contracts are tested.
- Polling has cleanup, visibility handling, in-flight protection, and backoff.
- `react-grid-layout` is isolated behind dashboard grid/view components rather than leaking through every widget.
- View DTOs and persisted JSON are versioned and Zod-validated.
- Existing trade, review, account, and settings flows remain functional.
- Documentation is updated.

---

## 24. Non-Goals

Do not expand this milestone into:

- Broker execution synchronization.
- Streaming/WebSocket quotes.
- Server-side background daemons that continue when the local app is closed.
- Full multi-leg options support.
- Cross-currency portfolio accounting.
- Third-party or user-authored widgets, arbitrary executable widget builders, custom SQL widgets, or user-supplied React/HTML. First-party registered widgets and saved layouts are in scope.
- AI-generated dashboard commentary.
- Replacing ECharts.
- Rewriting unrelated trade-entry or review workflows.
- Deleting existing preserved documentation or migrations.

Client polling while the application is open is sufficient for this milestone. Streaming and persistent background valuation can be evaluated later.

---

## 25. Final Design Direction

The finished dashboard should combine:

- Myfxbook-style information density and period summaries.
- Modern, restrained visual hierarchy.
- Strong filtering and drilldown behavior.
- Trading-journal process accountability.
- Explicit live risk and data freshness.
- A full-width analytical workstation layout.
- A curated but user-configurable set of saved dashboard views.

The result must feel like a professional portfolio and execution-review system, not a grid of generic KPI cards or an uncontrolled blank-canvas widget builder.
