# Charts and Widget Registry

**Part of the TradingJournal Design System** (see [`README.md`](./README.md)).

The chart palette API and the dashboard widget registry. Chart colors,
the ECharts hex-conversion constraint, the 14 registered dashboard widgets
across 3 categories (metrics, charts, valuation), and chart rules. The chart
half of the source-parsing contract is guarded by
`src/lib/__tests__/design-system-docs.test.ts`, which cross-references
`src/lib/chart-palette.ts` values and the widget IDs in
`src/components/dashboard/widget-registry.ts`.

---

## Chart palette and categories

### The `chart-palette.ts` API

`src/lib/chart-palette.ts` is the pure, theme-aware palette module for ECharts.
It is safe to import from server components, API routes, and client widgets.

| Export | Contract |
|---|---|
| `chartTokens` | Canonical raw `oklch(L C H)` strings keyed by `light`/`dark` — mirrors the `--chart-*`, `--positive`, `--negative`, `--warning`, `--missing`, `--info`, `--destructive`, and `--primary` custom properties in `globals.css` |
| `chartPalette` | Resolved, ECharts-consumable hex palettes for both themes, built eagerly at module load |
| `deriveChartPalette(theme)` | Theme-aware resolver; throws `Chart palette error:` for unknown theme names |
| `withAlpha(hex, alpha)` | Returns `rgba(r, g, b, alpha)` for gradients and translucent split lines; throws on non-hex input or alpha outside `[0, 1]` |
| `convertOklchToHex(color)` | Pure oklch → `#rrggbb` conversion (validated bit-for-bit against Chromium) |
| `ChartPalette` (type) | `series[]`, `primary`, `positive`, `negative`, `warning`, `missing`, `info`, `destructive`, `grid`, `axis`, `reference`, `heatmap[]` |

> **Critical constraint: ECharts cannot parse `oklch()`.** zrender (ECharts 6)
> parses hex, named, `rgb()`/`rgba()`, and `hsl()`/`hsla()` — **not** oklch.
> Chart widgets must consume the resolved **hex** values from `chartPalette`
> (or `deriveChartPalette`), never `oklch(...)` strings.

**Consumer guidance**

- Categorical series → `palette.series` (or `color: [...]` option).
- P&L wins/losses → `palette.positive` / `palette.negative`.
- Split lines / grid → `palette.grid` (dash via `withAlpha(palette.grid, 0.5)`).
- Axis labels → `palette.axis`.
- Reference lines (breakeven, averages) → `palette.reference`.
- Area gradients → `withAlpha(color, 0.25)` inside ECharts gradient
  `colorStops` (zrender accepts `rgba()`).
- Calendar heatmap → `palette.heatmap` (8-stop diverging ramp,
  negative → positive: index 0 = deepest negative, 3 = pale negative,
  4 = pale positive, 7 = deepest positive).

---

## The dashboard widget registry

Defined in `src/components/dashboard/widget-registry.ts` (`WIDGET_REGISTRY`,
`WIDGET_IDS`). The registry is the single immutable source of truth for all
dashboard widgets — a const record mapping widget IDs to definitions
(`id`, `title`, `description`, `category`, `defaultLayout`, `minSize`,
`maxSize`, `canHide`, `canResize`, `allowMultipleInstances`, `dataDomains`,
`defaultVisible`, `configSchema`, `defaultConfig`). User actions never mutate
it; saved views hold layout/visibility/config separately. The registry
currently defines **14 widgets across 3 categories**: `metrics`, `charts`,
and `valuation`.

### Metrics widgets (3)

Compact label/value metric matrices for the summary band. They follow the
metric-group layout rule: labels on the start edge, values on a common
end-aligned numeric edge with tabular numerals.

| Widget ID | Widget title | Purpose |
|---|---|---|
| `account-performance` | Account Performance | Account-level financial summary |
| `ptd-performance` | PTD Performance | Period-to-date performance summary |
| `current-risk` | Current Risk | Live risk position (risk-first dashboard priority) |

### Chart widgets (9)

All 9 migrated to the M014 palette. Palette role is documented per widget.

| Widget ID | Widget title | Palette role |
|---|---|---|
| `equity-drawdown` | Equity & Drawdown | Equity line in `series[0]`/`primary`; drawdown area `withAlpha(negative, 0.25)`; breakeven/reference markers `reference` |
| `calendar-heatmap` | Calendar Heatmap | `heatmap` 8-stop diverging ramp (negative → positive); absent days stay neutral/pale |
| `period-matrix` | Period Comparison | Grouped bars cycling `series`; directional splits use `positive`/`negative` |
| `setup-ranking` | Setup Ranking | Ranked metric in `series[0]`; win/loss splits `positive`/`negative`; reference line `reference` |
| `process-discipline` | Process Discipline | Single-series metric `primary`/`series[0]`; target line `reference` |
| `monthly-performance` | Monthly Performance | Month bars colored `positive`/`negative` by sign; breakeven `reference` |
| `r-distribution` | R Distribution | Histogram bars `positive`/`negative` by R sign (or `series` for buckets); zero marker `reference` |
| `attention-insights` | Attention Insights | Attention states `warning`/`missing`; categorical groups cycle `series` |
| `directional-performance` | Directional Performance | Long vs short via two series (`series[0]`, `series[1]`) or `positive`/`negative` |

### Valuation widgets (2)

Valuation / account-detail surfaces. They answer "what is open and what is at
risk" with live market data and carry the market-data-state treatment from
`workstation.md`.

| Widget ID | Widget title | Purpose |
|---|---|---|
| `valuation-positions` | Valuation Positions | Position valuation with live prices and market-data state |
| `open-positions-risk` | Open Positions & Risk | Open-position exposure and risk aggregation |

**Rules**

- Chart colors must stay legible in both themes and must **not** redefine
  application status semantics: `positive`/`negative`/`warning`/`missing` mean
  the same thing in charts as in the UI.
- Green appears in charts only as profit/positive meaning (series 1 stays Steel
  Blue; the positive ramp is financial).
- Widgets determine the active theme (e.g. `document.documentElement.classList
  .contains('dark')`) and pass it to `deriveChartPalette`.
