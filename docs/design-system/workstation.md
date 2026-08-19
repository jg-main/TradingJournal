# Workstation Dashboard

**Part of the TradingJournal Design System** (see [`README.md`](./README.md)).

This file is the `ws-` pattern reference for the Risk & Positions workstation
and the contained Performance / Process Review workstations. It documents the
density tokens, panel chrome, toolbar, grid shell, data-quality alert strip,
market strip, watchlist, positions, risk band, performance KPI grid, trades
workspace, setups/ideas panel, equity chart, customize mode, arrange mode,
keyboard navigation, and accessibility contract at the pattern/contract
level — the same level the components consume, not a line-by-line CSS echo.

**Authoritative source:** `src/app/(workstation)/workspace/workstation.css` —
`.ws` scoped custom properties and utility classes, plus the workstation
components under `src/components/workstation/`. The workstation reuses the
global color tokens from `globals.css` (theme-aware) and defines its own
density, spacing, and type scale for the terminal-dense desktop surface.

**Scope rule.** Every `ws-` class is scoped under the `.ws` root class so
nothing leaks into the legacy dashboard (`src/app/dashboard/`). Workstation
components must render inside a `.ws` container (the shell does this) and must
never rely on the global `ui/*` Tailwind primitives for layout that belongs to
a `ws-` pattern. New workstation CSS belongs in `workstation.css`, documented
here, and covered by `workstation-docs.test.ts`.

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

- Dashboard decision labels and table headers use `--ws-text-xs` (12px) or
  larger. `--ws-text-xs` is for secondary metadata, status chips, and
  timestamps—not labels needed to interpret risk or P&L.
- Table cells use `--ws-text-sm`/`--ws-text-md` (13–14px) or larger and the
  `--ws-row-sm`/`--ws-row-md` row scale. Do not compress workstation rows
  below the system density tokens to fit more panels.
- Current-risk and primary financial values use `--ws-text-lg` (16px) to
  `--ws-text-xl` (20px), with tabular numerals. Reserve `--ws-text-xl` for a
  genuinely dominant KPI, not every number.

**Market-data state is part of the value.** Every price-derived dashboard
total carries the account and period scope that determines it and exposes its
market-data state beside the value. Use the existing semantic hierarchy:

- current and complete: normal financial treatment;
- stale: an explicit warning state with as-of time;
- partial: an explicit missing state and affected-position count;
- unavailable: an em dash or clear awaiting-price state, never `$0.00`.

Expose a known price source in that panel or its immediate detail. Do not
let a global freshness indicator make an individual P&L total appear current
when one of its positions is stale, unpriced, or otherwise incomplete.

---

## Density tokens

Defined on the `.ws` root, consumed by every workstation component. The
workstation does not invent ad-hoc spacing or type sizes; if a value is not
one of the tokens below, it is a violation of this contract (the only
exceptions are fixed micro-dimensions documented inline, such as icon sizes
and the 3px alert accent).

**Row scale — meets the §8.1 readability contract (36–40px).**

| Token | Value | Use |
|---|---|---|
| `--ws-row-xs` | 28px | Micro controls: kbd chips, hide overlays, retry buttons, arrange handles |
| `--ws-row-sm` | 36px | Dense table row (floor of the 36–40px contract), select/view-switcher controls |
| `--ws-row-md` | 40px | Standard table row / list item (positions table rows) |
| `--ws-toolbar-h` | 48px | Top toolbar height (command/state bar) |
| `--ws-panel-header-h` | 32px | Panel title bar |

**Spacing scale** (half of the legacy default): `--ws-space-1` 2px,
`--ws-space-2` 4px, `--ws-space-3` 6px, `--ws-space-4` 8px,
`--ws-space-5` 12px, `--ws-space-6` 16px. Use these for paddings, gaps, and
offsets; never raw pixel values for layout rhythm.

**Type scale — meets the §8.1 readability contract**: decision labels/table
headers ≥12px, data cells ≥13px, primary financial values 16–20px. Maps onto
the global `--font-size-*` family (12/13/14/16/20px).

| Token | Value | Use |
|---|---|---|
| `--ws-text-xs` | 12px | Decision labels, table headers, section/group headers, uppercase metadata, stat sub-lines, provenance |
| `--ws-text-sm` | 13px | Panel headers, toolbar metadata, scope lines, secondary values |
| `--ws-text-md` | 14px | Body default: table cells, stat rows, form controls, kbd labels |
| `--ws-text-lg` | 16px | Primary values (mark price, unrealized P&L, current risk, exposure, KPI values, totals) |
| `--ws-text-xl` | 20px | Dominant risk-band values (`.ws-risk-value`) |

**Chrome tokens.** `--ws-border` (`1px solid var(--border)`) and
`--ws-border-strong` (`1px solid var(--muted-foreground)`) for separators and
panel outlines; `--ws-radius` is 2px for all panel/control corners.

**Root behavior.** The `.ws` root sets `font-variant-numeric: tabular-nums`,
`font-size: var(--ws-text-md)`, and `line-height: 1.35`; it is a
`100dvh`, `overflow: hidden`, column-flex surface with
`background: var(--background)` and `color: var(--foreground)`. This is the
contained workstation surface for Performance and Process Review. Risk &
Positions opts into document flow below.

**Utility classes.** `.ws-mono` applies `font-family: var(--font-mono)` with
tabular numerals (kbd chips, ids). `.ws-num` is the numeric cell treatment:
tabular numerals, right-aligned. `.ws-pos` / `.ws-neg` color financial values
with `var(--positive)` / `var(--negative)`.

---

## Panel chrome

Three classes make a panel: `.ws-panel`, `.ws-panel-header`,
`.ws-panel-body`.

- `.ws-panel` — `var(--ws-border)` outline, `var(--ws-radius)` corners,
  `var(--card)` background, column flex, `min-height: 0` / `min-width: 0`,
  `overflow: hidden`. A panel is always a flex column; content never escapes
  the outline.
- `.ws-panel-header` — fixed `var(--ws-panel-header-h)` bar with
  `var(--ws-space-4)` side padding, `var(--ws-text-sm)` size, weight 600,
  uppercase, `0.04em` letter-spacing, `var(--muted-foreground)` color, and a
  bottom `var(--ws-border)` separator. `flex: none` so the body owns the
  remaining height.
- `.ws-panel-body` — `flex: 1`, `min-height: 0`, `overflow: auto`, padded
  `var(--ws-space-3)`.

A header trailing action (e.g. a live badge) aligns via `.ws-panel-meta`
(`margin-left: auto`, weight 400, no uppercase/letter-spacing). Panel
identifiers render as `data-testid="ws-panel-<area>"` (e.g.
`ws-panel-risk`, `ws-panel-positions`) — the CSS scopes several rules to
specific panels through these testids (summary row, performance grid, equity
body), so panel ids must stay in sync with the grid-area names in
`src/lib/workstation-view-types.ts`.

**Dense summary row contract.** In document flow, the Account State,
Performance, and Process Review panels (`ws-panel-account-state`,
`ws-panel-performance`, `ws-panel-process-review`) are content-sized — never
stretched to fill their row — with `align-self: start`,
`justify-content: flex-start`, and no internal scrollbar in normal use. The
CSS pins this with explicit `data-testid` selectors under the document-flow
scope so future content growth cannot re-introduce viewport-fill heights or
nested scrolling. Contained workstations (Performance, Process Review) keep
their shared-viewport grid behavior.

**Document-flow mode.** Risk & Positions is a single page-scrolling workflow.
The shell sets `data-scroll-mode="document"` on `.ws-grid`; a `:has()`
selector relaxes the root to `height: auto; min-height: 100dvh;
overflow: visible` and lets each panel reveal its content in normal document
flow. This removes competing inner scrollbars from Account State, Performance,
Open Positions, and Process Review without changing the saved Performance /
Process Review workstations (which stay `contained`).

---

## Toolbar

`.ws-toolbar` is the 48px command/state bar: `flex: none`, row layout,
`var(--ws-space-5)` gaps and padding, bottom `var(--ws-border)`, `var(--card)`
background. Its children follow the toolbar pattern vocabulary:

- `.ws-toolbar-brand` — product/workspace identity at `var(--ws-text-lg)`,
  weight 700.
- `.ws-back-link` — muted, `var(--ws-text-sm)` navigation back to the legacy
  surface; hover brightens to `var(--foreground)` on `var(--muted)`.
  `.ws-back-icon` (14px) + `.ws-back-label` compose it.
- `.ws-live-toggle` — 28px-high pill switch for live polling. Inactive: muted
  text on `var(--background)`. Active (`.ws-live-toggle-active`): positive
  border/text with a 12% `color-mix` positive wash so the state reads as data
  flowing, not as a financial result. `.ws-toggle-icon` is the 13px leading
  icon.
- `.ws-toolbar-field` — a labelled control cluster: `.ws-toolbar-label`
  (12px uppercase, `0.05em` tracking, muted) above/ beside `.ws-select`
  (36px select control matching the control rhythm, `var(--ws-border)`,
  `var(--ws-radius)`, visible focus ring via `:focus-visible`).
- `.ws-toolbar-spacer` — `flex: 1` push to the end edge.
- `.ws-toolbar-meta` — muted `var(--ws-text-sm)` context text.
- `.ws-fixture-badge` — dev harness marker: 12px uppercase chip with a
  `var(--chart-4, var(--muted-foreground))` outline; used only by the
  fixture toolbar.

**View switcher (S06).** `.ws-view-trigger` is the toolbar entry for the
curated saved-views dropdown, deliberately matching the select rhythm (36px
height, same border/radius family) so it sits naturally beside the account
selector. It carries `.ws-view-trigger-icon` (14px, muted) and shows a
`.ws-customize-dirty`-style state via the switcher content. The trigger uses
the standard `:focus-visible` ring and hover border-color transition.

**Live-mode indicators.** The toolbar's state cluster communicates live-data
health without colour alone:

- `.ws-live-badge` — 12px uppercase chip, stateful border/text:
  `.ws-live-badge-active` (`var(--positive)`),
  `.ws-live-badge-paused` (`var(--muted-foreground)`),
  `.ws-live-badge-error` (`var(--destructive)`).
- `.ws-loading-indicator` — subtle pulsing uppercase label while a fetch is
  in flight (`ws-pulse-text` keyframes, 1.2s).
- `.ws-error-indicator` — solid destructive pill with bold
  `var(--destructive-foreground)` text; rendered `role="alert"` so screen
  readers announce it; `cursor: help`.
- `.ws-mtm-indicator` / `.ws-mtm-dot` — mark-to-market polling label with a
  preceding 7px dot. `.ws-mtm-active` pulses the dot green
  (`ws-mtm-pulse`, 1.5s) and greens the label; `.ws-mtm-paused` renders a
  static 50%-opacity gray dot (no open positions or tab hidden);
  `.ws-mtm-error` renders a static red dot with destructive label text (last
  poll failed).

---

## Grid shell

`.ws-grid` is the CSS grid container: `flex: 1`, `min-height: 0`, `gap` and
padding at `var(--ws-space-3)`. The `grid-template-columns / -rows / -areas`
are **not** in CSS — they are computed from the active saved view's layout
config and applied inline by `WorkstationShell` (see
`src/lib/workstation-view-types.ts`). Without an inline template the grid
falls back to implicit single-column placement.

**KPI strip.** `.ws-kpi-strip` is a compact period-performance band (row flex,
`overflow: hidden`) placed below the risk area — never a competing first-row
wall. Each `.ws-kpi` is an equal flex cell with a left `var(--ws-border)`
separator between cells; `.ws-kpi-value` renders at `var(--ws-text-lg)`
weight 600 with ellipsis; `.ws-kpi-label` is the 12px uppercase muted caption.

**Empty states.** `.ws-empty` centres muted `var(--ws-text-md)` text in the
panel body (`height: 100%`). In the trades tab content it additionally
enforces `min-height: 120px` so loading/empty/error states never collapse the
tab to a sliver.

---

## Dense data table

`.ws-table` is the shared dense table: full width, `border-collapse: collapse`,
`var(--ws-text-md)` cells. Headers are 12px uppercase muted with `0.05em`
tracking, sticky under the panel body padding
(`top: calc(-1 * var(--ws-space-3))`, `var(--card)` background so content
slides beneath cleanly). Cells pad `var(--ws-space-1) var(--ws-space-2)` with
a bottom `var(--ws-border)` and `height: var(--ws-row-sm)`; `white-space:
nowrap` keeps rows single-line unless a cell opts out. Numeric headers/cells
use `.ws-num` for right-aligned tabular values.

**Stat rows.** `.ws-stat-row` is the label/value row used by risk and insights
panels: 36px, `space-between` (label at start, value at end), bottom border.
`.ws-stat-label` stacks a `.ws-stat-sub` (12px muted context) beneath the main
label with `line-height: 1.2`.

**Account State rows.** `.ws-account-stat-row` is the two-column grid
(`minmax(0, 1fr) minmax(0, 1fr)`) that keeps values on one numeric edge:
label + subordinate `.ws-account-stat-label` / `.ws-account-stat-meta`
(12px, 70% opacity, ellipsized) in the first column, `.ws-account-stat-value` end-justified with
`overflow-wrap: anywhere` in the second. Context is subordinate to the label
and never becomes a third data column.

---

## Trades workspace

The full-width trades panel (`.ws-panel` keeps the `ws-panel-positions`
testid) switches between Open/current and Closed/historical tabs. Selectors
are scoped under `.ws-panel` so these rules beat generic `ui/tabs` Tailwind
utilities regardless of stylesheet order, and the document-flow panel-body
override keeps tab content on the page scroll path (no nested scrollbar).

- `.ws-trades-root` — column flex (`gap: 0`), `min-height: 0`.
- `.ws-trades-tabs` — 36px tab bar, `var(--ws-space-4)` padding, bottom
  border, transparent background (radius 0).
- `.ws-trades-tab` — inline-flex uppercase tab (26px within the 36px bar),
  muted text; `[data-state='active']` uses `var(--accent)` with foreground
  text and a `var(--muted-foreground)` border; hover mirrors active; focus
  ring is inset (`outline-offset: -2px`).
- `.ws-trades-tab-count` — tabular count chip (12px, `var(--muted)`
  background, pill radius) carrying **only its own source's counts**: the
  closed tab's totals come from the closed-trades API response only, so a
  current account total is never mixed with a period-filtered total.
- `.ws-trades-content` — `var(--ws-space-3)` padding, `min-height: 0`.
- `.ws-trades-scope` — universe scope line above the closed table stating
  exactly what is shown (13px muted).
- `.ws-trades-totals` — two-edge footer: `.ws-trades-totals-label`
  (scoped uppercase label at the start edge), one comparable
  `.ws-trades-totals-value` at the end edge (`var(--ws-text-lg)`, weight
  600), separated by a top `var(--ws-border)`.
- `.ws-trades-error` — closed-tab error banner with retry: negative-coloured
  message at the start edge, `.ws-trades-retry` action at the end edge
  (28px control, `var(--card)` background, accent hover, inset focus ring).
  A failed fetch is surfaced, never swallowed.

---

## Data-quality alert strip

`.ws-data-quality` is the fixed strip above the main grid whenever a
current-value metric is stale, partial, unavailable, or has an integrity
error. It is a **pure consumer** of API provenance state — gating lives in
`data-quality-alert-strip.tsx`, never re-implemented in CSS. Layout: `flex:
none` column with `var(--ws-space-2)` gaps, `var(--ws-space-2) /
var(--ws-space-4)` padding, bottom border, `var(--card)` background.

Each `.ws-dq-alert` is a stacked card with a **3px left accent border** (the
severity cue) and a `var(--background)` fill:

- `.ws-dq-warning` — `var(--warning)` accent with an 8% `color-mix` warning
  wash.
- `.ws-dq-critical` — `var(--destructive)` accent with an 8% destructive
  wash.

Inside an alert: `.ws-dq-head` (baseline row), `.ws-dq-title` (13px, weight
600), `.ws-dq-state` (12px uppercase state chip at the end edge, coloured to
match severity — visible text so state is never conveyed by colour alone),
`.ws-dq-label` (qualified display hint from the API, e.g. “— Partial — 1
unpriced”, 13px weight 700), `.ws-dq-message` (13px, `line-height: 1.4`), and
`.ws-dq-provenance` (12px muted `source · as-of · computed` metadata).
Readability floor: titles/messages at 13px (≥13px cell rule), state chips and
provenance at 12px (≥12px label rule).

---

## Market strip

`.ws-market-strip` is a thin horizontal ribbon of major index levels inside
the watchlist panel body — a sub-element, never a standalone panel with
header chrome. Row flex, `min-height: 42px`, bottom border, `var(--ws-space-3)`
bottom margin. Each `.ws-market-index` is an equal cell (end-aligned column:
`.ws-market-index-symbol` 12px uppercase muted, `.ws-market-index-value`
16px weight 700, `.ws-market-index-change` /
`.ws-market-index-change-pct` 12px) with a left `var(--ws-border)` divider
between indexes.

---

## Watchlist panel

Inside the watchlist panel (testid `ws-panel-watchlist`):

- **Direction indicators** (Dir column): `.ws-dir-long` uses `var(--chart-1)`,
  `.ws-dir-short` uses `var(--chart-4)`, both weight 700 and centred.
- **Proximity indicators** (Dist% column): `.ws-approaching`
  (`var(--missing)`, weight 600) and `.ws-urgent` (`var(--warning)`, weight
  700) flag key-level distance.
- **Status badges**: `.ws-status` is the 12px uppercase pill base;
  modifiers are colour-mixed washes with matching text — `.ws-status-triggered`
  (`var(--chart-2)`), `.ws-status-watching` (`var(--chart-1)`),
  `.ws-status-pending` / `.ws-status-skipped` / `.ws-status-expired`
  (`var(--muted-foreground)` at 10–12% wash). Status is always readable as
  text, never by colour alone.

Watchlist rows use the shared `.ws-table` contract; the panel hosts the
`.ws-market-strip` above the table and the watchlist add dialog. Watchlist is
deliberately not in the curated default — it can be added to a saved view.

---

## Positions panel

The positions panel (testid `ws-panel-positions`) hosts the risk positions
table and a stale-mark indicator: `.ws-mark-stale-indicator` is a small 6px
amber dot rendered inline before the mark price when `markStatus` is `stale`
or `missing`. Accent only — the data state is always conveyed by visible text
(Stale / Missing mark + source + as-of), never by the dot alone.

---

## Risk positions table

The 9-column primary positions table (`.ws-positions-table`, testid
`ws-positions-table`) uses `--ws-row-md` (40px) rows so two-line cells
(attribution linked count, mark provenance, exposure state) fit the 36–40px
contract without internal scrolling at the target viewport. Cell tiers:

- `.ws-cell-primary` — mark price, unrealized P&L, current risk, and exposure
  at the 16px tier (weight 600, nowrap).
- `.ws-cell-sub` — supporting sub-lines at the 12px decision-label tier
  (muted).
- `.ws-pos-symbol` — sticky symbol column (`position: sticky; left: 0` on
  `var(--card)`, `z-index: 1`, weight 600) so the symbol stays visible when
  the table scrolls horizontally in a narrow fallback.
- `.ws-warn-text` — attention-state text (“No valid stop” / “Incomplete”) in
  `var(--warning)`, weight 600 — a data-quality state is never conveyed by
  position alone.

---

## Risk band

`.ws-risk-band` is the full-width risk summary band (testid `ws-panel-risk`).
Its panel body is an 8-column equal grid (`repeat(8, minmax(0, 1fr))`,
`align-items: stretch`, zero padding) of `.ws-risk-cell` items — each a
centred column of `.ws-risk-value` (`var(--ws-text-xl)`, weight 600,
`overflow-wrap: anywhere`), `.ws-risk-label` (12px uppercase muted), and
`.ws-risk-sub` (13px muted, wraps) — with `var(--ws-border)` left dividers.
Critical values are never ellipsized: the band grows to two rows at
laptop-effective widths rather than hiding an incomplete-risk or stale
valuation label.

Responsive tiers (the band is the only panel with its own breakpoints):

- `max-width: 1800px` (~1536px effective at 125% scaling): 4 stable columns,
  resetting the divider at each row start.
- `max-width: 980px`: 2 columns with the same divider reset.

**Section groups.** `.ws-risk-section` (bottom `var(--ws-space-4)` margin,
none on `:last-child`) groups related blocks, and
`.ws-risk-section-header` is the uppercase sub-header (12px, weight 600,
muted, `18% color-mix` divider) so the hierarchy reads panel → section → row.

---

## Performance KPI grid

The dense default shows Performance at roughly Account State height: its 16
period metrics render as two columns of logical groups — P&L + Risk on the
left, Win Edge + Activity on the right — with compact group headers instead
of a single 16-row list (`.ws-perf-grid` under
`ws-panel-performance`). Rows keep the shared 36px dense-row contract so both
columns read as stat lists, and every `ws-perf-*` testid stays in the same
`ws-performance-kpis` subtree.

- `.ws-perf-column` — the two equal grid columns (`gap: 0 var(--ws-space-5)`,
  `align-items: start`).
- `.ws-perf-group` / `.ws-perf-group-header` — group wrapper and its compact
  header (denser than `ws-risk-section-header`; panel → group → row without
  consuming a full row).
- `.ws-perf-pnl-group-header` — P&L group header row with a segmented scope
  control at the end edge.
- `.ws-perf-scope` — the three-scope (P&L view) segmented control:
  `.ws-perf-scope-option` (22px minimum, 12px, bordered, accent hover) and
  `.ws-perf-scope-option-active`, which uses `var(--primary)` /
  `var(--primary-foreground)` — the interaction token, **not** financial
  green, because the control changes what the panel measures rather than
  indicating a profitable result. Inset focus ring.

Responsive: at `max-width: 980px` (or when a saved view places Performance
in a single grid column), `.ws-perf-grid` collapses to one column so rows
never cramp.

---

## Setups and ideas panel

The insights panel (testid `ws-panel-insights`) stacks sub-sections in a
vertically scrolling body:

- `.ws-setups-subheader` — compact uppercase separator with a
  `.ws-setups-subheader-count` (13px, weight 400, end-aligned, no tracking)
  badge; no top margin on `:first-child`.
- **Severity tokens** (shared cross-panel): `.ws-severity-critical`
  (`var(--destructive)`), `.ws-severity-warning` (`var(--warning)`),
  `.ws-severity-info` (`var(--muted-foreground)`).
- `.ws-sample-size-warning` — inline 12px weight-600 warning indicator next
  to the count column for `very_small`/`small` samples (`cursor: help`).
- `.ws-insights-list` / `.ws-insight-item` — unstyled vertical list of
  horizontal rows (severity badge + message), 2-line clamped
  (`.ws-insight-message` via `-webkit-line-clamp: 2`).
- `.ws-severity-badge` — 12px uppercase pill with a severity-tinted
  `color-mix` background + border.
- `.ws-setups-empty` — per-section empty state (`var(--ws-space-4)` vertical
  padding), shared by all three sub-panels, keyed off
  `ws-setups-ideas-empty` for consolidated testid compatibility.

---

## Equity chart

The equity panel (testid `ws-panel-equity`) body becomes a column flex so the
chart receives a measurable height before ECharts initializes.
`.ws-chart-container` is the flex-filling (`flex: 1`) chart host with a
guaranteed `min-height: 160px` and `width: 100%` — the ECharts canvas sizes
via ResizeObserver, and the min-height prevents a 0×0 container (ECharts
refuses to init) when Account State appears beside Performance in document
flow or inside a constrained saved view.

---

## Keyboard navigation

Workstation keyboard support is implemented in
`workstation-keyboard-shortcuts.tsx` (surface-wide) and
`workstation-keyboard-arrange.tsx` (arrangement sub-mode); the CSS contracts
that make it visible are `.ws-panel:focus`, `.ws-row-active`, and
`.ws-row-highlighted`.

**Panel focus ring.** Programmatic focus via the 1–5 keys lands on the panel
section element. `.ws-panel:focus` draws a 2px `var(--ring)` outline with a
matching border so sighted users see which panel is active; screen-reader
users hear the ARIA role change.

**Surface shortcuts** (no modifier keys; ignored inside inputs, textareas,
selects, contentEditable elements, and when Ctrl/Alt/Meta is held; the
listener runs capture-phase and prevents handled keys before the global
navigation layer):

| Keys | Action |
|---|---|
| `[` / `]` | Previous / next account |
| `1` | Focus Risk |
| `2` | Focus Account State |
| `3` | Focus Positions |
| `4` | Focus Performance |
| `5` | Focus Process Review (rendered only in its dedicated saved view; no-ops when absent) |
| `↑` / `↓` | Navigate table rows within the focused Positions panel |
| `Enter` | Highlight / unhighlight the active row |
| `?` | Toggle the shortcut overlay |
| `Escape` | Dismiss the overlay |

**Table row navigation.** `.ws-row-active` is the keyboard cursor (10%
`var(--ring)` wash) applied when ArrowUp/ArrowDown moves through rows;
`.ws-row-highlighted` is the Enter-pinned persistent highlight (20% ring
wash plus a 2px `var(--ring)` left accent) so pinned rows stay visible after
navigating away. Both are `!important` because they must win over row hover
and striping.

**Arrange keyboard** (see Arrange mode below): with a panel's drag handle
focused, Arrow keys move, Shift+Arrow grows/shrinks, Escape exits
arrangement mode. Moves are computed as raw RGL layouts and committed
through the same single commit path as pointer gestures, so they are clamped,
re-projected, undoable, and rejected when unrepresentable. A move into a cell
occupied by exactly one other movable panel swaps the two (window-manager
semantics); moves into fixed anchors (risk, trades) or crowded cells are
blocked; growing into occupied space is blocked; shrinking is always allowed.
`ARRANGE_KEYBOARD_MAX_Y` (500) caps upward growth so a hostile or accidental
repeat key cannot allocate unbounded rows.

**Shortcut overlay.** `.ws-keynav-backdrop` is the fixed `var(--overlay)`
scrim (`z-index: 100`, `ws-keynav-fade-in` 120ms) with `.ws-keynav-overlay`
(340px card, `var(--shadow-lg)`) at its top. `.ws-keynav-header` (48px, `.ws-keynav-title` uppercase label
+ `.ws-keynav-close`), `.ws-keynav-body` (column of `.ws-keynav-row`s
pairing `.ws-keynav-label` with the key), and
`.ws-keynav-kbd` chips (28px mono, `var(--background)` on `var(--border)`)
render the table above. Rendered inline (no portal) inside the `.ws` scope so
it inherits density tokens.

---

## Accessibility

- **Live announcer.** `.ws-a11y-announcer` is the visually hidden ARIA live
  region (1px clip pattern) for screen-reader announcements (account
  switches, row highlight toggles).
- **Skip link.** `.ws-skip-link` is the first focusable element on the
  workspace page: positioned off-screen (`top: -40px`), sliding into view on
  focus (`top: var(--ws-space-2)`) with the standard ring, so keyboard users
  can skip the toolbar chrome. `z-index: 200`.
- **Focus visibility.** Interactive controls expose visible focus through
  `:focus-visible` ring rules (`2px solid var(--ring)` with 1px offset,
  inset where space is tight); panels expose programmatic focus through the
  panel focus ring. Keyboard access, semantic controls, and accessible
  labels are mandatory for every workstation control.
- **State never colour-only.** Severity, data quality, mark staleness, live
  status, and watchlist status always pair colour with visible text (chips,
  labels, provenance), per §8.3.

**Reduced motion.** Under `prefers-reduced-motion: reduce`, all workstation
animations are disabled (`animation-duration: 0.01ms !important`,
`transition-duration: 0.01ms !important`) across `.ws` and descendants —
MTM pulse, overlay fade-in, loading pulsation — while non-animated visual
treatments (static colours, dots) are preserved.

---

## Customize mode

Explicit editing chrome (R035): the customize bar, the toolbar entry
trigger, and per-panel hide overlays exist **only while a customize session
is open**. Normal mode has no drag/resize or editing handles. The
data-quality alert strip and the fixed panels (risk, positions, kpis) are
never inside the editable layout.

- `.ws-customize-trigger` — toolbar entry button matching the view-switcher
  trigger rhythm (36px, same border/radius family) with a leading
  `.ws-customize-trigger-icon` (14px); `:disabled` renders at
  45% opacity with `not-allowed`.
- `.ws-customize-bar` — the editing bar between the alert strip and the
  grid: 40px minimum, `var(--card)` background, bottom border. Contains
  `.ws-customize-title` (uppercase 13px weight 700),
  `.ws-customize-dirty` (unsaved-changes marker, `var(--chart-4,
  var(--muted-foreground))`), `.ws-customize-panels` (wrap row of
  `.ws-customize-chip` visibility toggles — 28px chips with ring hover and
  focus), `.ws-customize-all-visible`, `.ws-customize-fixed-note`,
  `.ws-customize-spacer`, and the action buttons
  (`.ws-customize-btn` family with `.ws-customize-btn-icon` (14px):
  default, `.ws-customize-btn-primary`
  save, `.ws-customize-btn-active` pressed arrangement toggle, each with
  `:disabled` state).
- `.ws-arrange-hint` — one-line command summary shown while the arrangement
  sub-mode is active (“Arrow: move · Shift+Arrow: resize”).
- `.ws-customize-cell` — dashed `var(--ring)` wrapper around each editable
  optional panel with a slim `.ws-customize-cell-bar` carrying
  `.ws-customize-cell-title` (uppercase ring-coloured label) and a
  `.ws-customize-hide-overlay` Hide control (with
  `.ws-customize-overlay-icon` leading icon) that turns destructive on
  hover. Panel visibility chips carry a `.ws-customize-chip-icon` (12px).
  Fixed panels render unchanged and never get a cell wrapper. The
  panel inside the cell fills it with its own border removed so the dashed
  ring replaces the double chrome.

A new customize session always opens in hide/show mode; arrangement is a
sub-mode toggled from the bar.

---

## Arrange mode

The arrangement grid (react-grid-layout) is the editing surface for a
user-owned saved view's layout. Normal mode never mounts it — the CSS grid
with grid-template-areas remains the rendered truth. RGL positions items
absolutely and injects global `.react-grid-item` /
`.react-resizable-handle` classes; every override below is scoped under
`.ws-arrange` so the legacy dashboard grid is unaffected.

- `.ws-arrange` — the RGL container: fills the shell between the customize
  bar and the view foot; RGL measures width from this element.
- `.ws-arrange-shell` — the `<main>` replacing the CSS grid while the
  arrangement sub-mode is active: bounded column flex with `overflow: auto`,
  so items past the fold scroll inside the shell and the protected anchors
  stay reachable in every template.
- `.ws-arrange-cell` — one arrangement item (the panel cell): dashed ring
  + `var(--card)` background; `[data-ws-arrange-fixed='true']` renders with
  a solid `var(--border)` outline and no handles. The panel inside fills the
  cell with its border removed.
- `.ws-arrange-handle` — the labelled drag handle (the only drag surface,
  RGL's handle selector): 28px, `cursor: grab` (grabbing while active),
  `touch-action: none` for react-draggable pointer handling, `user-select:
  none`, ring-tinted background. `.ws-arrange-grip` is the 14px grip icon;
  `.ws-arrange-handle-title` is the uppercase panel label.
- **Resize handle.** `.ws-arrange .react-resizable-handle-se` — a visible
  18px corner affordance (2px ring borders) replacing RGL's default bare
  line; hover/active promotes to `var(--primary)`.
- **Placeholder.** `.ws-arrange .react-grid-placeholder` — dashed ring with
  a 14% ring wash, distinct from real items.
- **Transitions.** `.react-grid-item.react-draggable-dragging` lifts with
  `var(--shadow-lg)` at `z-index: 20`; `.resizing` sits at `z-index: 21`;
  the default 200ms transform transition is kept so drops settle smoothly.

Saved layout data is validated and versioned by
`workstation-view-types.ts` (catalogue-only panel ids, versioned schema,
`layout` derived from `areas`), so arrange-mode edits can never persist
arbitrary component names or unrepresentable geometries.
