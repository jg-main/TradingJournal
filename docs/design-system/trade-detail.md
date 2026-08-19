# Trade Detail Surface

**Part of the TradingJournal Design System** (see [`README.md`](./README.md)).

This file is the `td-` pattern reference for the trade detail page — the
single-trade, lifecycle-first surface that opens from the dashboard trades
table and the open/closed trade lists. It documents the density tokens,
panel chrome, grid shell, phase variants, review sections, card stripping,
risk-column density rules, focus ring, and reduced-motion contract at the
pattern/contract level — the same level the components consume, not a
line-by-line CSS echo.

**Authoritative source:** `src/components/trade-detail/trade-detail-grid.css` —
`.td` scoped custom properties, grid templates, and panel/review patterns,
plus the trade-detail components under `src/components/trade-detail/` (the
grid shell primitives live in `trade-detail-grid.tsx`). The surface reuses
the global color tokens from `globals.css` (theme-aware) and defines its own
density, spacing, and type scale for the terminal-dense single-trade surface.

**Scope rule.** Every `td-` class is scoped under the `.td` root class so
nothing leaks into the legacy dashboard (`src/app/dashboard/`) or the
workstation (`src/app/(workstation)/`). Trade-detail components must render
inside a `.td` container (the phase views — `active-phase-view.tsx`,
`planned-phase-view.tsx`, `closed-phase-view.tsx` — do this via
`TradeDetailGrid`) and must never rely on the global `ui/*` Tailwind
primitives for layout that belongs to a `td-` pattern. New trade-detail CSS
belongs in `trade-detail-grid.css`, documented here, and covered by
`trade-detail-docs.test.ts`.

---

## Trade detail standard

The trade detail page is a dense, lifecycle-first management surface for one
trade: it must answer what phase the trade is in, what the position facts and
risk are, what happened over the trade's history, and what the review verdict
is — in that priority order, in one continuous reading path. It is a fixed
management layout, never a customizable canvas (unlike the workstation's
saved views).

**No competing scrollbars.** The trade detail page scrolls at the document
level; the legacy shell's `<main>` owns the scrollbar and no panel ever
creates an inner scrollbar. The `.td` root sets `min-height: 0` and the grid
and panels opt out of viewport containment entirely — there is no `100dvh`
wrapper, no `overflow: auto` panel body, and no nested scroll region.

**Document flow.** The grid grows with its content. Panels are content-sized,
top-aligned (`align-self: start`), and never stretched to a fixed row height.
A short panel in one column never delays the panel beneath it because of a
taller neighbour elsewhere — each continuous column owns its own vertical
rhythm.

**Readability contract.** Rows meet the same 36–40px density contract as the
workstation: decision labels and table headers use `--td-text-xs` (12px) or
larger, data cells use `--td-text-sm`/`--td-text-md` (13–14px) or larger,
and primary financial values use `--td-text-lg` (16px) to `--td-text-xl`
(20px). Every numeric value in the surface renders with tabular numerals.

**Phase variants.** The page has three grid variants, selected by the
`variant` prop on `TradeDetailGrid`:

- `monitoring` — the active/open trade arrangement: lifecycle stepper, then
  three continuous columns (Cockpit → Context, Trade Details → History,
  Risk → Review) with Assets spanning beneath the first two columns.
- `planned` — the pre-trade arrangement: lifecycle band, one full-width plan
  panel, and the Assets row carrying pre-trade screenshots.
- `closed` — the frozen snapshot arrangement: the monitoring columns plus a
  review column whose collapsible sections hold grade, mistakes, AI
  assessment, and exit notes.

---

## Density tokens

Defined on the `.td` root, consumed by every trade-detail component. The
surface does not invent ad-hoc spacing or type sizes; if a value is not one
of the tokens below, it is a violation of this contract.

**Row and chrome scale — meets the §8.1 readability contract (36–40px rows).**

| Token | Value | Use |
|---|---|---|
| `--td-row-sm` | 36px | Dense table row (floor of the 36–40px contract) |
| `--td-panel-header-h` | 32px | Panel title bar (and review-section trigger height) |

**Spacing scale** (half of the legacy default, matching the workstation):
`--td-space-1` 2px, `--td-space-2` 4px, `--td-space-3` 6px, `--td-space-4`
8px, `--td-space-5` 12px, `--td-space-6` 16px. Use these for paddings, gaps,
and offsets; never raw pixel values for layout rhythm.

| Token | Value | Use |
|---|---|---|
| `--td-space-1` | 2px | Hairline offsets inside compact card headers |
| `--td-space-2` | 4px | Tight cell padding, card-header rhythm |
| `--td-space-3` | 6px | Default gap/padding: grid gap, panel body padding, review content |
| `--td-space-4` | 8px | Panel/review header side padding |
| `--td-space-5` | 12px | Group-level gaps |
| `--td-space-6` | 16px | Large section gaps |

**Type scale — meets the §8.1 readability contract**: decision labels/table
headers ≥12px, data cells ≥13px, primary financial values 16–20px. Maps onto
the global `--font-size-*` family (12/13/14/16/20px).

| Token | Value | Use |
|---|---|---|
| `--td-text-xs` | 12px | Decision labels, table headers, section headers, uppercase metadata |
| `--td-text-sm` | 13px | Panel headers, review-section triggers, scope lines, secondary values |
| `--td-text-md` | 14px | Body default: table cells, stat rows, form controls |
| `--td-text-lg` | 16px | Primary values (mark price, P&L, risk snapshot values) |
| `--td-text-xl` | 20px | Dominant financial values (headline P&L) |

**Chrome tokens.** `--td-border` (`1px solid var(--border)`) and
`--td-border-strong` (`1px solid var(--muted-foreground)`) for separators
and panel outlines; `--td-radius` is 2px for all panel/control corners.

| Token | Value | Use |
|---|---|---|
| `--td-border` | 1px solid var(--border) | Panel outlines, header separators |
| `--td-border-strong` | 1px solid var(--muted-foreground) | Emphasis separators (available for high-contrast dividers) |
| `--td-radius` | 2px | All panel/review corners |

**Root behavior.** The `.td` root sets `font-variant-numeric: tabular-nums`,
`font-size: var(--td-text-md)`, `line-height: 1.35`, and
`color: var(--foreground)`. It is a plain document-flow container
(`min-height: 0`) — no viewport containment, no background surface of its
own (the page background shows through), and no nested scrollbars. The root
is also where the reduced-motion contract is enforced (see below).

---

## Panel chrome

Five classes make a panel: `.td-panel`, `.td-panel-header`, `.td-panel-title`,
`.td-panel-meta`, and `.td-panel-body`.

- `.td-panel` — `var(--td-border)` outline, `var(--td-radius)` corners,
  `var(--card)` background, column flex, `min-height: 0` / `min-width: 0`.
  Panels are content-sized in document flow: `overflow: visible`,
  `height: auto`, `align-self: start`. A panel never stretches to its row
  height and never scrolls internally.
- `.td-panel-header` — fixed `var(--td-panel-header-h)` title bar with
  `var(--td-space-4)` side padding, `var(--td-text-sm)` size, weight 600,
  uppercase, `0.04em` letter-spacing, `var(--muted-foreground)` color, and a
  bottom `var(--td-border)` separator. `flex: none` so the body owns the
  remaining space.
- `.td-panel-title` — the header's leading label; `min-width: 0` with
  ellipsis so long titles truncate instead of wrapping.
- `.td-panel-meta` — an optional right-aligned header companion
  (`margin-left: auto`, weight 400, no uppercase/letter-spacing) for counts
  and secondary annotations.
- `.td-panel-body` — the content region: `flex: none`, column flex with
  `gap: var(--td-space-3)`, padded `var(--td-space-3)`, `overflow: visible`
  (document flow — content is never clipped to an inner scrollbar).

**Area assignment.** Every panel carries a `data-area` attribute naming its
grid area — `lifecycle`, `cockpit`, `details`, `risk`, `context`, `history`,
`review`, `plan`, or `assets` — and the CSS maps each value to the matching
grid area name (`.td-panel[data-area='lifecycle'] { grid-area: lifecycle }`
and so on). Panels inside a continuous column are additionally stretched to
the full, equal column width (`.td-grid-column > .td-panel` sets
`align-self: stretch; width: 100%`) so the scan path stays aligned; the
grid-area rules are what actually place each panel into the shell.

**Header optionality.** A panel may omit its header entirely (the history
feed and assets panels do) — `TradeDetailPanel` renders the header only when
a title or meta is provided. The panel body is always present.

---

## Grid shell

`.td-grid` is the CSS grid container: `display: grid`,
`gap: var(--td-space-3)`, `align-items: start`, with `minmax(0, 1fr)`
columns so content never overflows on narrow screens. The template is a
lifecycle-first, three-breakpoint contract — the trade detail page is a
reading and management layout, not a customizable canvas, so the template
lives in CSS (unlike the workstation, where saved views compute the template
inline).

**Breakpoint 1 — single column (default, <1440px).** Lifecycle first, then
each continuous flow in reading order.

```css
.td-grid {
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    'lifecycle'
    'left'
    'details'
    'right'
    'assets';
}
```

**Breakpoint 2 — two columns (1440–1599px).** Lifecycle spans the top; the
left column and trade details sit side by side; risk/review and assets each
span both columns beneath them.

```css
@media (min-width: 1440px) {
  .td-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-areas:
      'lifecycle lifecycle'
      'left details'
      'right right'
      'assets assets';
  }
}
```

**Breakpoint 3 — wide operational layout (≥1600px).** A two-column
operational workspace (`main`) plus an independent Risk/Review column
(`right`). Assets sit beneath the workspace's first two columns even while
Risk/Review continues independently.

```css
@media (min-width: 1600px) {
  .td-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-areas:
      'lifecycle lifecycle lifecycle'
      'main main right';
  }
}
```

**Workspace wrapper.** `.td-grid-main` is transparent to the single- and
two-column fallbacks (`display: contents`), preserving their reading order.
On wide screens (≥1600px) it becomes its own two-column grid occupying the
`main` area:

```css
.td-grid-main {
  grid-area: main;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-areas:
    'left details'
    'assets assets';
  gap: var(--td-space-3);
  align-items: start;
}
```

**Continuous columns.** `.td-grid-column` is the column wrapper
(`min-width: 0`, column flex, `align-self: start`,
`gap: var(--td-space-3)`) that owns its column's vertical rhythm. It takes
one of three area names via `data-area` — `left`, `details`, or `right` —
mapped by `.td-grid-column[data-area='left'|'details'|'right']` rules.
Because columns are independent flex stacks, a taller panel in the left
column never delays the details column or the right column.

**Composition (monitoring / active trade).** The lifecycle stepper spans the
top as the `lifecycle` panel. Inside the workspace: the `left` column stacks
Cockpit → Context; the `details` column stacks Trade Details → History. The
`right` column stacks Risk → Review and is never blocked by the workspace's
height. The `assets` panel spans beneath Context and History (its grid area
is `assets`, declared inside the workspace at ≥1600px and on the root grid in
the fallbacks).

---

## Variant grids

Two `.td-grid` modifiers swap the arrangement for the other trade phases.
Each variant keeps the same three breakpoints; only the area template
changes.

**Planned-phase variant.** `.td-grid--planned` covers pre-trade plans: a
lifecycle band, one full-width plan panel, and the Assets row (pre-trade
screenshots). No price/risk/history/review columns exist in this phase — the
plan surface is the whole point of the page.

```css
.td-grid--planned {
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    'lifecycle'
    'plan'
    'assets';
}
```

At ≥1440px the plan and assets rows each span both columns; at ≥1600px the
plan and assets rows each span all three. The plan panel area is assigned by
`.td-panel[data-area='plan']` (see Grid shell), and the same `.mb-6`
normalization that tames the cockpit header applies to the plan panel body.

**Closed-phase variant.** `.td-grid--closed` freezes the snapshot for closed
trades: lifecycle first, then the cockpit/history workspace, central risk,
and context/review — the same template as monitoring — with the review
column carrying the collapsible review sections (see Review sections below).
Assets occupy the two-column operational workspace beneath Context and
History, without waiting for the review column.

```css
.td-grid--closed {
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    'lifecycle'
    'left'
    'details'
    'right'
    'assets';
}
```

The closed variant uses the identical 1440px and 1600px overrides as the
monitoring grid, so a closed trade always reads in the same scan path as an
open one — only the review content differs.

---

## Review sections

The closed-trade review column is built from `.td-review-section` units —
collapsible, progressive-disclosure boxes rendered by
`TradeCollapsibleReviewSection` over the Radix Collapsible primitive. Each
section is its own chrome unit: a bordered box whose header is a full-width
trigger button (title + meta + chevron) over the collapsible body.

- `.td-review-section` — `var(--td-border)` outline,
  `var(--td-radius)` corners, `var(--card)` background.
- `.td-review-section-trigger` — the full-width header button:
  `width: 100%`, row flex with `gap: var(--td-space-3)`,
  `padding: 0 var(--td-space-4)`, `min-height: var(--td-panel-header-h)`,
  `border-radius: 0`, left-aligned text at `var(--td-text-sm)` weight 600,
  uppercase with `0.04em` letter-spacing, `var(--muted-foreground)` color —
  the panel-header rhythm applied to a button so the whole header is one
  click target.
- `.td-review-section-title` — the trigger's leading label; ellipsized
  (`min-width: 0`, `overflow: hidden`) so long titles truncate.
- `.td-review-section-meta` — the right-aligned companion
  (`margin-left: auto`, weight 400, no uppercase/letter-spacing), e.g. the
  grade badge or mistake count.
- `.td-review-section-chevron` — the trailing chevron icon; `transition:
  transform 160ms ease`, rotating 180° while the section is open
  (`.td-review-section-trigger[data-state='open'] .td-review-section-chevron`).
- `.td-review-section-content` — the collapsible body:
  `padding: 0 var(--td-space-3) var(--td-space-3)`.

**Interaction contract (inherited from Radix).** The trigger exposes the
standard `data-state` attribute (`open`/`closed`) and `aria-expanded`, and
toggles with Enter/Space — no custom keyboard handling. Sections are
collapsed by default (`defaultOpen = false`): collapsibles are for auxiliary
detail in dense surfaces, and critical risk or warnings must never hide
inside them.

**Review panel composition (closed trades).** The Review panel
(`data-area='review'`) stacks the trade check-results card first — it stays
visible, never collapsed, because check results are critical evidence — then
the collapsible sections in fixed order: **Grade** (with the grade label as
meta), **Mistakes** (with a recorded count as meta), **AI Assessment**
(assessment card + history), and **Exit Notes** (the one section that may be
absent entirely when the trade has no notes or lesson).

---

## Card stripping

The panel is the chrome unit on the trade detail surface. Legacy shadcn
Cards that land inside a panel body — or inside a review-section content —
drop their own ring, rounded corners, background, and padding so the dense
surface shows one border per panel, not a card-in-panel double frame.
Internal row borders, headers, and content spacing are preserved.

```css
.td-panel-body [data-slot='card'],
.td-review-section-content [data-slot='card'],
.td-compact-card [data-slot='card'] {
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
}
```

The strip also zeroes card-to-card vertical margins (`.td-panel-body
[data-slot='card'] + [data-slot='card']`, and the review-section and
compact-card equivalents) and re-applies the panel-header rhythm to the
legacy card header and content — spacing only, no chrome:

```css
.td-panel-body [data-slot='card-header'],
.td-review-section-content [data-slot='card-header'],
.td-compact-card [data-slot='card-header'] {
  padding: var(--td-space-1) var(--td-space-2);
}

.td-panel-body [data-slot='card-header'] + [data-slot='card-content'],
.td-review-section-content [data-slot='card-header'] + [data-slot='card-content'],
.td-compact-card [data-slot='card-header'] + [data-slot='card-content'] {
  padding-top: var(--td-space-1);
}
```

The strip rule also removes card-to-card vertical margins inside the panel
body and review content, and re-applies the panel-header rhythm to the
legacy card header (spacing only, no chrome — `padding: var(--td-space-1)
var(--td-space-2)` with `var(--td-space-1)` between header and content).
This is why the trade-detail phase views can reuse the existing
`trade-*-card` components unchanged: the grid's context selectors strip the
chrome automatically.

**Explicit opt-in.** `.td-compact-card` applies the same strip to a wrapper
of the caller's choosing, for legacy cards that render outside a panel body
or review section (for example inside a dialog).

---

## Risk column density

Risk remains a compact decision-support panel; Trade Details owns the
position fields in its own equal-width column. Two scoped rules compress the
legacy responsive grid utilities inside the Risk panel so the risk surface
reads as one dense column rather than a sparse four-across layout:

- `.td-panel[data-area='risk'] .sm:grid-cols-4` → `repeat(2, minmax(0, 1fr))`
- `.td-panel[data-area='risk'] .sm:grid-cols-2` → `minmax(0, 1fr)`

The selectors are scoped to the risk area only — Trade Details and the other
panels keep their normal responsive grid behavior.

---

## Legacy page chrome

Legacy page-level margin utilities are normalized inside the grid so the
document-flow rhythm comes from the panel body's flex gap, not from the
components' original page margins:

- `.td-panel[data-area='cockpit'] .mb-6` and
  `.td-panel[data-area='plan'] .mb-6` → `margin-bottom: var(--td-space-3)`
  (TradeDetailHeader's page rhythm becomes panel rhythm).
- `.td-panel-body .mb-8` → `margin-bottom: var(--td-space-3)`.

---

## Focus ring

Panels are focusable regions: `TradeDetailPanel` renders
`<section tabIndex={-1}>`, and the focused panel shows the ring contract:

```css
.td-panel:focus {
  outline: 2px solid var(--ring);
  outline-offset: -1px;
  border-color: var(--ring);
}
```

The inset offset keeps the ring inside the panel's 2px radius without
clipping. Interactive controls inside panels keep their own focus-visible
rings from the `ui/*` primitives; the panel ring is the region-level cue for
keyboard and assistive-technology users.

---

## Reduced motion

The whole surface honors `prefers-reduced-motion: reduce` with the standard
kill-switch: every animation and transition inside the `.td` scope is
collapsed to `0.01ms` duration with `animation-iteration-count: 1`, so the
review-section chevron rotation and any in-flight animations degrade to
instant state changes.

```css
@media (prefers-reduced-motion: reduce) {
  .td,
  .td *,
  .td *::before,
  .td *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Accessibility

- **Document scroll, never nested.** The page scrolls at the document level;
  no panel creates a competing inner scrollbar, so keyboard and screen-reader
  users never fight a scroll trap.
- **Semantic regions.** Panels are `<section>` elements with
  `tabIndex={-1}` for programmatic focus; each carries a visible header when
  it has a title. The lifecycle stepper, cockpit, risk, and review regions
  read in the grid's area order.
- **Radix primitives.** The review collapsibles inherit standard keyboard
  behavior (Enter/Space toggling), `aria-expanded`, and `data-state`
  attributes from the Radix Collapsible primitive — no bespoke interaction
  code.
- **Type and numerals.** All values use tabular numerals via the `.td` root;
  decision labels and table headers are ≥12px, data cells ≥13px, primary
  financial values 16–20px, meeting the surface readability contract.
- **State is never conveyed by motion alone.** The only animated element is
  the review-section chevron, which duplicates the `aria-expanded` state
  carried by the trigger. The reduced-motion contract (above) collapses all
  animation for users who opt out.
