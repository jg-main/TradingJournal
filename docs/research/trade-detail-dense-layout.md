# Dense Financial Data Display — Research Brief

Trade detail page reorganization basis (explore session 2026-08-14, milestone M020-0crj7s).

Context: local-first trading journal (Next.js/React/Tailwind). The trade detail page
(`src/app/(legacy)/trades/[id]/page.tsx`) is a single-column `max-w-4xl` (896px) stack.
Target displays: 2560x1440 primary, 3840x2400 at 125% scaling (effective 3072x1920).
Primary workflow: monitoring an open position (live price, P&L, stop/target adjustments,
adding fills). Secondary: post-close review (grade, mistakes, AI assessment).

## 1. Professional trading terminal layout patterns

- **Bloomberg Terminal**: tiled panel architecture on a dark background; each function
  (quote, chart, orders, news, positions) occupies a fixed rectangular panel. Typical
  layout 3–4 panels across, 2–3 rows deep. Fixed-size panels with internal scroll only.
  No max-width constraint — full bleed to the monitor edges. The "golden layout" is a
  2x2 or 3x2 grid with the largest panel (chart/positions) center-left.
  ([Wikipedia — Bloomberg Terminal](https://en.wikipedia.org/wiki/Bloomberg_Terminal))
- **TradingView**: multi-chart layouts (up to 8 panels) use a CSS grid with
  user-resizable panels; default 2x2 on large screens. Persistent left sidebar
  (200–280px); collapsible right panel (~320px) for the order ticket.
- **thinkorswim (Schwab)**: "Gadget" system — free-floating panels on a dark canvas.
  Active trader view: Level 2 DOM (center, ~400px), Time & Sales (right, ~280px),
  chart (left, fills remaining). 4+ columns at 2560px.
- **DAS Trader Pro**: densest mainstream terminal; 4 columns — Level 2 DOM, Time &
  Sales, chart, order entry. Fixed pixel widths (not fluid), fine 1px borders,
  12–13px type, no card chrome — raw data tables separated by hairline rules.
- **NinjaTrader**: docking panel system (Visual Studio style). Default at 2560px:
  3 columns — chart (left 50%), DOM (center 25%), market data (right 25%).

**Key pattern**: professional terminals use fixed-panel grids with named areas, not
fluid card layouts. Panels are separated by 1px borders rather than gaps/cards. No
max-width constraint — the layout fills the viewport.

## 2. Visual hierarchy and information density

- **Data-ink ratio (Tufte)**: maximize ink devoted to data vs chrome — remove card
  shadows, decorative borders, redundant labels. Border + surface contrast for
  separation; shadows reserved for overlays.
  ([Edward Tufte](https://www.edwardtufte.com/tufte/))
- **Tabular numerals**: `font-variant-numeric: tabular-nums` is required for column
  alignment in multi-column layouts (already project-wide).
- **Label/value alignment**: labels on the start edge, values end-aligned on a shared
  numeric edge (Bloomberg/thinkorswim convention). Every metric row is a 2-column
  grid (label | value), never a 3-column sprawl.
- **Dense metric clusters vs cards**: terminals stack 4–6 key-value pairs vertically
  in narrow panels instead of spreading metrics across wide cards. A 4-column layout
  at 2560px gives each column ~400–640px — enough for a single-purpose panel with
  6–10 rows.

## 3. Color and typography conventions

- **Semantic color**: green/red reserved exclusively for P&L, amber for warnings,
  neutral graphite for everything else (already the project convention via the
  `--positive` token; no hardcoded green literals).
- **Contrast for density**: near-black backgrounds with high-contrast text (Bloomberg
  uses #000–#1a1a1a). The dark theme achieves similar contrast. At high density,
  **border contrast matters more than shadow** — 1px `--border` separators are right.
- **Font sizes at high DPI**: at 3840x2400 @ 125% (effective 3072x1920), 13–14px body
  text remains readable. Bloomberg uses ~12–13px data cells, 10–11px labels. The
  workstation tokens (`--ws-text-xs: 12px`, `--ws-text-sm: 13px`, `--ws-text-md: 14px`)
  are correctly calibrated.
- **Monospace identifiers**: trade codes, prices, quantities in `--font-mono` improve
  scanability in dense columns.

## 4. Progressive disclosure patterns

- **Always-visible (live monitoring)**: symbol/direction, live price, unrealized P&L,
  position size, stop distance, target distance, order entry buttons — top row or
  leftmost columns.
- **Collapsible/expandable**: execution history, adjustment log, check results, assets,
  notes — secondary review data in lower or right-side panels.
- **Post-close review**: grade, mistakes, AI assessment, lesson — only relevant after
  close; bottom row or tabbed/collapsible panel, never in the primary monitoring
  columns.
- **thinkorswim/DAS pattern**: active monitoring occupies 60–70% of screen real estate
  (left/center columns); review/analytics 30–40% (right column or bottom row). Action
  first, review second.

## 5. High-DPI / large monitor considerations

- **No max-width constraint**: professional terminals never cap at 896px. At 2560px or
  3840px that wastes 60–75% of horizontal space. The workstation surface already does
  this correctly (`.ws-grid` fills the viewport).
- **Column count scaling**: Bloomberg uses 4 columns at 2560px, 5–6 at 3840px.
  Practical breakpoints:
  - >=1440px: 2 columns
  - >=2048px: 3 columns
  - >=2560px: 4 columns
  - >=3440px (ultrawide) / >=3840px: 4–5 columns
- **Full-bleed with gutter**: panels extend edge-to-edge with 4–8px gutters
  (`--ws-space-3: 6px` / `--ws-space-4: 8px`). No outer page padding beyond the grid
  gutter.
- **CSS Grid with named areas**: `grid-template-areas` lets panels be rearranged
  without changing component order — the workstation's existing approach.

## 6. Known pitfalls

- **Nested scrollbars**: the #1 density anti-pattern. Follow the workstation
  `data-scroll-mode='document'` pattern — one page-level scroll; panel-internal
  scroll only for genuinely unbounded lists (execution history, level history).
- **Over-densification**: below 12px font or below 28px row height readability drops
  sharply. The workstation `--ws-row-sm: 36px` floor is the correct minimum; do not go
  below 32px for interactive rows.
- **Cognitive overload**: limit always-visible panels to 4–6; more than 8 visible
  panels degrades task performance (Nielsen Norman Group dashboard research). For
  trade detail, 4 columns x 2–3 panels each = 8–12 visible panels is the upper bound;
  primary monitoring should show 4–6.
- **Card chrome at density**: rounded corners, shadows, padding >16px waste space.
  Workstation uses `--ws-radius: 2px` and 1px borders — correct for dense surfaces.
- **Scroll jails**: a column taller than the viewport with internal scroll hides
  content below. Solution: document-flow scrolling or bounded panel heights with
  explicit max-height + overflow.

## Actionable recommendations for the 4-column trade detail

1. **Drop `max-w-4xl`**. Full viewport CSS grid
   (`grid-template-columns: repeat(4, minmax(0, 1fr))` at >=2560px), 2 columns at
   >=1440px.
2. **Column assignment by workflow priority**:
   - Col 1 (cockpit): symbol header, live price widget, actions (add fill, add exit,
     adjust stop/target) — answers "what stock / where is it".
   - Col 2 (risk/position): risk snapshot (plan vs actual), P&L card, lifecycle
     summary, levels with distances — answers "where is my trade / what levels / what
     risk".
   - Col 3 (history): unified history feed, executions, stop/target adjustments.
   - Col 4 (review): checklist, grade, mistakes, AI assessment, assets — collapsible.
3. **Workstation panel pattern**: 1px borders, 2px radius, 32px panel headers, 6px
   gaps. Reuse `.ws-panel` / `.ws-panel-header` / `.ws-panel-body` or extract shared
   density primitives.
4. **Named grid areas**: `grid-template-areas: "price risk history review"` so panels
   can be rearranged later without DOM changes.
5. **Single document scroll**: no panel-internal scrollbars except the history feed.
6. **Responsive breakpoints**: collapse 4 -> 2 -> 1; at 2 columns merge (price+risk)
   and (history+review).
7. **Phase-aware column visibility**: planned hides live price and history; closed
   demotes action buttons and expands review sections.

## Sources

- Bloomberg Terminal architecture: https://en.wikipedia.org/wiki/Bloomberg_Terminal
- Tufte data-ink ratio: https://www.edwardtufte.com/tufte/
- TradingView multi-chart layouts: https://www.tradingview.com/chart/
- thinkorswim gadget system: https://www.schwab.com/trade/thinkorswim
- DAS Trader Pro: https://www.dastrader.com/
- NinjaTrader docking panels: https://ninjatrader.com/
- Nielsen Norman Group dashboard design principles: https://www.nngroup.com/articles/
- Project design system (density tokens, financial conventions): `docs/design-system.md`
- Project workstation implementation (grid, panel pattern, scroll modes):
  `src/app/(workstation)/workspace/workstation.css`
