# TradingJournal Design System

**Graphite + Steel Blue identity — Milestone M014, restructured in M025**

The authoritative reference for the TradingJournal visual system. This
directory replaces the former monolithic `docs/design-system.md`; content is
split by concern so each surface's documentation stays near its size. The
top-level document is an index plus the shared usage guidance; the concern
files hold the detail.

| File | Concern | Contents |
|---|---|---|
| [`README.md`](./README.md) | Index and shared usage | Identity, principles, semantic color meanings, navigation and shell, component usage guidance, prohibited patterns, migration notes |
| [`tokens.md`](./tokens.md) | Token reference | Light/dark theme token tables, typography, density, radius/elevation, financial number conventions, warning-state hierarchy |
| [`charts.md`](./charts.md) | Charts and widget registry | Chart palette API, the 14 registered dashboard widgets across 3 categories, chart rules |
| [`workstation.md`](./workstation.md) | Workstation dashboard | Risk-first workstation standard and layout contract (stub — expanded in a later milestone) |
| [`trade-detail.md`](./trade-detail.md) | Trade detail surface | Trade-detail grid contract (stub — expanded in a later milestone) |

**Source of truth.** The token values and layout contracts in this directory
are transcribed from, and cross-referenced with, the actual implementation:

| Concern | Authoritative source |
|---|---|
| Product role and workflow priority | `PRODUCT.md` |
| CSS custom properties (light/dark) | `src/app/globals.css` — `:root` (light), `.dark`, and `@theme inline` blocks |
| Workstation layout and density patterns | `src/app/(workstation)/workspace/workstation.css` — `.ws` scoped patterns |
| Trade-detail grid patterns | `src/components/trade-detail/trade-detail-grid.css` — `.td` scoped patterns |
| Chart colors (ECharts-consumable) | `src/lib/chart-palette.ts` — `chartTokens`, `chartPalette`, `deriveChartPalette`, `withAlpha`, `convertOklchToHex` |
| Navigation structure | `src/components/sidebar/nav-config.ts` — `NAV_SECTIONS` |
| Dashboard widget registry | `src/components/dashboard/widget-registry.ts` — `WIDGET_REGISTRY` / `WIDGET_IDS` |
| Normalized primitives | `src/components/ui/*.tsx` — the 14 primitives listed in Component usage guidance |

This directory is guarded against drift by the source-parsing contract test
`src/lib/__tests__/design-system-docs.test.ts`: a token added to `globals.css`
but missing from `tokens.md` (or documented there but absent from the CSS)
fails the suite.

---

## Design principles

1. **Industrial.** The interface reads as a professional trading workstation:
   dense, aligned, mechanical, and quiet until attention is required. It is not
   a marketing page, an executive summary, or a generic SaaS dashboard.
2. **Precise.** Every color, size, and spacing value comes from a semantic
   token. Arbitrary literals (`#hex`, `bg-emerald-500`, `text-blue-600`) are
   prohibited in component and page code.
3. **Restrained.** Decorative color is limited. Most surfaces remain neutral
   graphite/slate. Color is used only where it carries information: P&L, risk
   breach, missing/stale data, integrity failure, selection, validation, and
   workflow status.
4. **Analytical.** Border and surface contrast are the primary separation
   mechanism; shadows are reserved for floating overlays. Financial values use
   tabular numerals so columns align. Tables are compact and scannable.
5. **Fast.** The workstation supports repeated operational use: keyboard
   traversal, visible focus, dense rows, bounded scrolling, and predictable
   controls. No decorative animation.
6. **Consistent.** One token system, one radius family, one density scale, one
   warning hierarchy. Pages do not invent their own headers, colors, or
   spacing.

### Identity: Graphite + Steel Blue

- **Graphite/slate neutrals** define the workspace, surfaces, borders, and
  typography (cool hue ~250).
- **Steel Blue** (`--primary`, hue ~235) is the single interaction and
  selection color: primary actions, active navigation, selected tabs, focus
  rings, links, and the primary chart series.
- **Green is reserved for positive financial meaning only** — `--positive`
  (profit). Green must never be used as a brand, primary-action, navigation,
  or decorative color.
- **Red** (`--negative`, `--destructive`) is reserved for losses, destructive
  actions, validation errors, and genuine failures.
- **Amber** (`--warning`, `--missing`) is reserved for warnings, stale prices,
  incomplete data, pending review, and attention states.
- **Muted gray** represents unavailable, missing, disabled, or
  not-applicable data.
- Light and dark themes are **intentionally designed pairs, not inversion**:
  light uses white/steel surfaces with deep graphite text; dark uses graphite
  surfaces with luminous steel accents.

---

## Visual character and examples

The visual character is **industrial, precise, restrained, analytical, fast,
and quiet until attention is required**: neutral graphite surfaces, fine
borders, compact headers, tabular numerals, dense tables and forms, strong
focus states, short labels, and restrained semantic color.

The identity in practice (light theme, tokens only):

```tsx
{/* Primary action — Steel Blue, never green */}
<Button className="bg-primary text-primary-foreground hover:bg-primary/90">
  Add Trade
</Button>

{/* Financial state — semantic classes, never emerald/red utilities */}
<span className={formatPnlClass(netPnl)}>{formatPnl(netPnl)}</span>

{/* Overlay — theme-aware scrim, never bg-black/10 */}
<DialogOverlay className="bg-overlay" />
```

The same surface in dark theme needs no component changes: `--primary`,
`--positive`, and `--overlay` re-resolve through `.dark` custom properties.

---

## Semantic color meanings

Every color token has exactly one semantic meaning. Do not reuse a token for a
different meaning because its hue happens to fit.

| Token | Meaning | Usage guidance |
|---|---|---|
| `--primary` | Primary interaction and selection (Steel Blue) | Primary buttons, active nav, selected tabs, links, focus rings, primary chart series |
| `--positive` | Profit / gain / confirmed healthy | P&L gains, positive outcomes, healthy state badges. **The only green in the system.** |
| `--negative` | Loss / negative P&L | P&L losses and negative values in data contexts |
| `--warning` | Caution, attention, pending review | Stale prices, risk breaches, pending review, high-attention states |
| `--missing` | Stale / absent data (low-chroma amber) | Missing market prices, absent data — visually distinct from `--warning` and from zero |
| `--info` | Informational note (Steel Blue) | Helpful context, informational badges |
| `--destructive` | Destructive action / validation failure | Delete actions, form errors — visually stronger than ordinary loss |
| `--muted` / `--muted-foreground` | Disabled, not applicable, secondary | Disabled controls, placeholders, secondary text |
| `--border` / `--separator` | Structural separation | Panel borders, row dividers |
| `--overlay` | Backdrop scrim | Dialog and sheet backdrops (theme-aware) |
| `--chart-1..5` | Categorical chart series | Series colors in charts (see `charts.md`) |

**No-green identity constraint.** Green hue (oklch 127–165°) appears **only** in
`--positive` (financial profit). Identity, series, and state tokens stay in the
Steel Blue (~235), graphite (~250), amber, and red hue families. The legacy
green-toned primary (`oklch(0.55 0.14 130)`) is gone and must not return.

---

## Navigation and shell

**Navigation model.** The shell organizes routes by user job
(`src/components/sidebar/nav-config.ts`, `NAV_SECTIONS`), not by database
entity. Sections render top-to-bottom:

| Section | Items |
|---|---|
| Trading | Dashboard `/`, Trades `/trades`, Checks `/checks` |
| Accounts | Accounts `/settings/accounts` |
| Analysis | Sizing `/sizing` |
| System | Alerts `/alerts`, Settings `/settings`, Help `/help` |

Rules: no nav items for unfinished routes; rare maintenance actions live under
System; the number of top-level items stays limited.

**Sidebar.** Uses the sidebar token family. Active route treatment uses
`--sidebar-accent`/`--sidebar-accent-foreground` (Steel Blue family) — **never
green**. Group labels carry low visual weight; icons are consistently sized and
aligned; links are keyboard-accessible with visible focus (`--sidebar-ring`).
`resolveActiveHref` applies longest-matching-href so nested routes (e.g.
`/settings/accounts`) highlight the most specific item.

**Page frame.** Pages share a reusable frame: page title, optional description,
optional breadcrumbs, primary actions, secondary actions, optional status line,
consistent top/side spacing, and full-width content support for table-heavy
pages. Pages must not independently invent header layouts.

**Responsive.** Desktop-first. The shell remains usable at common laptop
widths, avoids clipped primary actions, reflows navigation predictably,
preserves horizontal table behavior, and never silently hides critical risk or
warning information. Mobile-phone optimization is not an objective.

---

## Component usage guidance

The 14 primitives normalized in M014/S03 live in `src/components/ui/`. Every
interactive primitive defines default, hover, active/pressed, focus-visible,
disabled, loading (where relevant), and validation-error (where relevant)
states. Focus follows the normalized pattern `focus-visible:ring-3
focus-visible:ring-ring/50` with the default outline suppressed. Colors come
exclusively from semantic tokens — no literals in class strings.

### Badge (`badge.tsx`)

- **Use for** short status labels: `positive`, `negative`, `warning`, `missing`,
  `info`, `destructive`, or neutral variants.
- **Guidance** compact (`--font-size-xs`), small radius, semantic tints such as
  `bg-positive/10 text-positive`.
- **Avoid** using badges for data containers or making them large.

### Button (`button.tsx`)

- **Use for** actions. Primary actions use `--primary` (Steel Blue);
  secondary uses `--secondary`/outline; destructive actions use
  `--destructive`; low-emphasis actions use ghost.
- **Guidance** heights come from the density scale
  (`--density-control-h*`); icons from `lucide-react` only where they add
  meaning.
- **Avoid** green primary buttons, pill shapes for standard actions, and
  multiple competing accent colors on one surface.

### Card (`card.tsx`)

- **Use for** panels and grouped content.
- **Guidance** separation via `--border` and surface contrast; header with
  `--card-foreground`; standard padding `--density-space-4`.
- **Avoid** heavy shadows on ordinary panels, card-within-card layouts without
  hierarchy, and oversized decorative KPI cards.

### Collapsible (`collapsible.tsx`)

- **Use for** progressive disclosure of secondary detail in dense surfaces.
- **Guidance** collapsed by default for auxiliary info; clear disclosure
  affordance with keyboard support.
- **Avoid** hiding critical risk or warning information inside collapses.

### Dialog (`dialog.tsx`)

- **Use for** focused modal tasks (create/edit, confirm).
- **Guidance** overlay uses `bg-overlay` (theme-aware), surface uses
  `--popover`, radius `rounded-lg`, elevation `shadow-lg`; focus trapped and
  visible; errors associated with inputs.
- **Avoid** modal overload for simple expert tasks; avoid `bg-black/10`
  overlays (theme-blind).

### Dropdown menu (`dropdown-menu.tsx`)

- **Use for** action menus and selections.
- **Guidance** popover surface, `shadow-md`, accent hover, keyboard
  traversal, semantic states for destructive items.
- **Avoid** long ungrouped lists; menu items as a substitute for real form
  controls.

### Input (`input.tsx`)

- **Use for** text and numeric entry.
- **Guidance** `--input` border, density control height, `--font-size-md`
  text; validation error state uses `--destructive` border/message with
  `aria-describedby`.
- **Avoid** hardcoded heights; missing validation association.

### Select (`select.tsx`)

- **Use for** option picking (accounts, setups, direction filters).
- **Guidance** same density and border family as `input`; compact option rows;
  keyboard navigation.
- **Avoid** custom multi-selects when the primitive suffices.

### Separator (`separator.tsx`)

- **Use for** structural division between sections/rows.
- **Guidance** consumes `bg-separator`; hairline weight; generous use inside
  dense panels to aid scanning.
- **Avoid** using borders where group spacing communicates hierarchy better.

### Sheet (`sheet.tsx`)

- **Use for** side panels: filters, inspectors, contextual detail.
- **Guidance** `bg-overlay` backdrop, popover/sidebar surface, `shadow-lg`;
  focus managed; content scrolls internally.
- **Avoid** stacking multiple sheets; using sheets for primary navigation.

### Skeleton (`skeleton.tsx`)

- **Use for** loading placeholders that mirror final layout.
- **Guidance** `--muted` surface, no animation loops beyond a subtle pulse,
  respects reduced motion.
- **Avoid** skeleton shapes that imply different data than the loaded state.

### Table (`table.tsx`)

- **Use for** dense tabular data — the core trading-journal surface.
- **Guidance** compact rows (`--density-row-sm`/`md`), aligned numeric
  columns, tabular numerals, bounded internal scrolling, useful
  sorting/filtering, header `--font-size-xs` uppercase.
- **Avoid** oversized rows, centered numbers in numeric columns, and visual
  clutter from excessive row striping.

### Tabs (`tabs.tsx`)

- **Use for** view segmentation (Planned / Open / Closed, time ranges).
- **Guidance** active tab uses Steel Blue family (`--accent`/`--primary`
  treatment), compact height, keyboard arrow navigation.
- **Avoid** green active states; tabs for unrelated content types.

### Tooltip (`tooltip.tsx`)

- **Use for** supplementary explanation on hover/focus.
- **Guidance** popover surface, `shadow-sm`/`md`, short text, accessible via
  focus as well as hover.
- **Avoid** tooltips as the only carrier of critical meaning.

---

## Prohibited patterns

These patterns are banned in components and page code. They regress the system
to arbitrary colors, theme-blind rendering, or ambiguous meaning.

| Prohibited | Why | Use instead |
|---|---|---|
| `bg-black/10` overlays | Theme-blind; too weak on dark surfaces | `bg-overlay` (theme-aware scrim) |
| `bg-emerald-500`, `text-emerald-*`, `text-green-*` | Arbitrary green outside `--positive`; destroys the "green = profit" invariant | `text-positive`, `bg-positive/10` |
| `text-blue-600`, `bg-blue-*` on actions | Arbitrary blue instead of the Steel Blue identity token | `bg-primary`, `text-primary`, `ring-ring` |
| `bg-red-500`, `text-red-*` | Ambiguous: loss vs destructive vs error are different meanings | `text-negative`, `bg-destructive`, `border-destructive` per the warning hierarchy |
| Hardcoded `#hex` / `oklch(...)` / `rgb(...)` in component class strings | Bypasses the token system; breaks theming | Semantic utilities (`bg-card`, `text-muted-foreground`, …) |
| `oklch(...)` strings in ECharts options | zrender cannot parse oklch; charts render default/black | `chartPalette[theme]` hex values via `deriveChartPalette` |
| Green primary/navigation/active states | Green is reserved for positive financial meaning only | Steel Blue `--primary` / `--sidebar-accent` |
| Pill shapes on standard buttons/inputs | Violates the restrained radius family | `rounded-md`/`rounded-lg` family |
| Large decorative shadows on ordinary panels | Borders must carry separation; shadows are for overlays | `border-border`; `shadow-md`/`lg` only on floating surfaces |
| Multiple competing accent colors per surface | "Quiet until attention is required" | One Steel Blue accent; neutral everywhere else |
| A broad KPI tile or three-way metric row for scalar data | Wastes desktop space and prevents numeric comparison | Compact label/value metric matrix with a common right numeric edge |
| A chart inside a summary panel or a tall empty future-chart placeholder | Displaces current risk and positions without adding a decision | Full-width analysis tabs below the trades workspace, once chart data is available |

**Acceptance rule:** a repo-wide scan for arbitrary color literals in migrated
surfaces returns zero hits. Every color on screen traces back to a token in
this directory.

---

## Migration notes

### For consumers of this system (Dashboard, Trade Detail, Review, Account Detail)

1. **Read `tokens.md` and `charts.md` first.** This directory is the
   authoritative reference (decision D053). All subsequent visual work must
   cite tokens from the tables rather than inventing colors.
2. **Never add arbitrary colors.** If a needed meaning has no token, extend the
   system (below) — do not inline a literal.
3. **Charts** must consume `chartPalette`/`deriveChartPalette` hex values; the
   dual-source mirror (`chartTokens` ↔ `globals.css`) is enforced by
   `token-structure.test.ts`.
4. **Financial meaning travels with the value.** Keep `+`/`-` signs, labels,
   and icons alongside color; keep missing (`—`) distinct from zero.
5. **Reuse the normalized primitives** in `src/components/ui`; do not rebuild
   buttons, tables, dialogs, or tabs per page. A greenfield surface may add
   product-specific primitives only when the existing set cannot express the
   approved interaction — document the limitation first.
6. **For dashboards, apply the workstation standard** in
   [`workstation.md`](./workstation.md). The risk-first hierarchy,
   normal-zoom readability, explicit customization mode, and
   market-data-state treatment are acceptance criteria, not decorative
   preferences.

### Extending the token system

To add a token:

1. Define it in `src/app/globals.css` in **both** `:root` (light) and `.dark`,
   or once in `:root` if theme-independent (radius/typography/density).
2. Map it to a Tailwind utility in the `@theme inline` block if components
   need it (e.g. `--color-positive`).
3. If the token is chart-relevant, mirror it in `chartTokens` in
   `src/lib/chart-palette.ts` (bit-for-bit) and consume the hex form in
   widgets.
4. Document it in `tokens.md`, in the correct theme and group tables, with its
   semantic meaning.
5. Update the required-token inventories in the contract suites
   (`token-structure.test.ts`, `design-system-docs.test.ts`) if the token
   becomes part of the canonical inventory.

The contract test is the guard: a token added to the CSS but not the doc (or
vice versa) fails the suite.

### Surface migration checklist

- Replace arbitrary color literals with semantic utilities.
- Map green → `--positive` (profit) only; blue actions → `--primary`; overlays
  → `bg-overlay`; separators → `bg-separator`.
- Verify light and dark themes render intentionally (designed pairs, not
  inversion).
- Check focus-visible rings, keyboard traversal, and WCAG AA contrast for
  body, muted, controls, warnings, P&L, and disabled states.
- Preserve all accepted behavior: calculations, API contracts, filters,
  pagination, and warning semantics are untouched by presentation work.

### Chart migration checklist

- Use `palette.series` for categorical series; `positive`/`negative` for P&L
  direction; `grid`/`axis`/`reference` for structure.
- Build area gradients with `withAlpha(color, 0.25)`.
- Use `palette.heatmap` for calendar heatmaps.
- Verify legibility in both themes with realistic data.
- Never place `oklch(...)` strings in ECharts options.

---

## Related decisions

- **D053** — full design-system documentation is the authoritative reference
  for subsequent milestones.
- **D054** — dual-source token architecture: `globals.css` owns CSS custom
  properties; `chart-palette.ts` mirrors chart values as JS constants; no
  separate design-token build step.
- **D055** — `--overlay` token replaces the theme-blind `bg-black/10` scrim in
  dialog/sheet backdrops.
- **D056** — `design-system-docs.test.ts` guards this document against drift
  from the token code.
- **D061** — dashboard direction prioritizes live risk and open positions,
  requires normal-zoom readability on the user's desktop environments, and
  makes data freshness part of displayed P&L meaning.
- **D077** — the design-system document is split by concern into this
  directory (`tokens.md`, `workstation.md`, `trade-detail.md`, `charts.md`)
  instead of one monolithic file.
- **D078** — `design-system-docs.test.ts` reads the split files
  (`tokens.md`, `charts.md`) so the source-parsing contract survives the
  split.
