# TradingJournal Design System

**Graphite + Steel Blue identity — Milestone M014**

The authoritative reference for the TradingJournal visual system. It documents
design principles, semantic color meanings, light and dark token tables,
typography, density, radius/elevation, financial number conventions, the
warning-state hierarchy, the application shell, usage guidance for the 14
normalized UI primitives, the chart palette and all 9 dashboard chart
categories, prohibited patterns, and migration notes.

**Source of truth.** The token values in this document are transcribed from,
and cross-referenced with, the actual implementation:

| Concern | Authoritative source |
|---|---|
| Product role and workflow priority | `PRODUCT.md` |
| CSS custom properties (light/dark) | `src/app/globals.css` — `:root` (light), `.dark`, and `@theme inline` blocks |
| Chart colors (ECharts-consumable) | `src/lib/chart-palette.ts` — `chartTokens`, `chartPalette`, `deriveChartPalette`, `withAlpha`, `convertOklchToHex` |
| Navigation structure | `src/components/sidebar/nav-config.ts` — `NAV_SECTIONS` |
| Dashboard chart widget categories | `src/components/dashboard/widget-registry.ts` — `WIDGET_REGISTRY` / `WIDGET_IDS` |
| Normalized primitives | `src/components/ui/*.tsx` — the 14 primitives listed in Component usage guidance |

This document is guarded against drift by the source-parsing contract test
`src/lib/__tests__/design-system-docs.test.ts`: a token added to `globals.css`
but missing here (or documented here but absent from the CSS) fails the suite.

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
| `--chart-1..5` | Categorical chart series | Series colors in charts (see Chart palette and categories) |

**No-green identity constraint.** Green hue (oklch 127–165°) appears **only** in
`--positive` (financial profit). Identity, series, and state tokens stay in the
Steel Blue (~235), graphite (~250), amber, and red hue families. The legacy
green-toned primary (`oklch(0.55 0.14 130)`) is gone and must not return.

---

## Light theme tokens

Defined in `src/app/globals.css` under `:root` (`color-scheme: light`).

### Surfaces

| Token | Value | Role |
|---|---|---|
| `--background` | `oklch(0.985 0.003 250)` | Page background — near-white cool |
| `--foreground` | `oklch(0.2 0.015 250)` | Primary text — deep graphite |
| `--card` | `oklch(1 0 0)` | Panel/card surface — white |
| `--card-foreground` | `oklch(0.2 0.015 250)` | Text on card surface |
| `--popover` | `oklch(1 0 0)` | Floating overlay surface (menus, tooltips, dropdowns) |
| `--popover-foreground` | `oklch(0.2 0.015 250)` | Text on popover surface |
| `--muted` | `oklch(0.955 0.006 250)` | Subtle surface — muted backgrounds, skeletons |
| `--muted-foreground` | `oklch(0.49 0.025 250)` | Muted/secondary text |
| `--secondary` | `oklch(0.955 0.006 250)` | Secondary button/control surface |
| `--secondary-foreground` | `oklch(0.24 0.02 250)` | Text on secondary surface |
| `--sidebar` | `oklch(0.975 0.004 250)` | Sidebar surface |
| `--sidebar-foreground` | `oklch(0.2 0.015 250)` | Sidebar text |
| `--sidebar-accent` | `oklch(0.94 0.025 235)` | Active/hover nav item surface |

### Text

| Token | Value | Role |
|---|---|---|
| `--foreground` | `oklch(0.2 0.015 250)` | Default body text |
| `--card-foreground` | `oklch(0.2 0.015 250)` | Text inside cards |
| `--popover-foreground` | `oklch(0.2 0.015 250)` | Text inside popovers |
| `--muted-foreground` | `oklch(0.49 0.025 250)` | Helper text, metadata, disabled text |
| `--secondary-foreground` | `oklch(0.24 0.02 250)` | Text on secondary controls |
| `--accent-foreground` | `oklch(0.35 0.08 235)` | Text on accent (hover) surfaces |
| `--primary-foreground` | `oklch(0.985 0 0)` | Text on primary (Steel Blue) surfaces |
| `--sidebar-foreground` | `oklch(0.2 0.015 250)` | Sidebar text |
| `--sidebar-accent-foreground` | `oklch(0.3 0.08 235)` | Active nav item text |

### Interaction

| Token | Value | Role |
|---|---|---|
| `--primary` | `oklch(0.48 0.1 235)` | **Steel Blue** — primary actions, selection |
| `--primary-foreground` | `oklch(0.985 0 0)` | Text/icon on primary |
| `--accent` | `oklch(0.94 0.025 235)` | Hover/highlight surface (menus, nav) |
| `--accent-foreground` | `oklch(0.35 0.08 235)` | Text on accent surface |
| `--ring` | `oklch(0.55 0.1 235)` | Focus ring |

### Financial and operational state

| Token | Value | Meaning |
|---|---|---|
| `--positive` | `oklch(0.55 0.13 152)` | Profit (the only green) |
| `--negative` | `oklch(0.55 0.19 27)` | Loss |
| `--warning` | `oklch(0.68 0.14 75)` | Caution / attention |
| `--missing` | `oklch(0.6 0.07 75)` | Stale / absent data (low-chroma amber) |
| `--info` | `oklch(0.52 0.1 235)` | Informational (Steel Blue) |
| `--destructive` | `oklch(0.53 0.2 25)` | Destructive action / error |
| `--destructive-foreground` | `oklch(0.985 0 0)` | Text on destructive |

### Structure

| Token | Value | Role |
|---|---|---|
| `--border` | `oklch(0.9 0.008 250)` | Panel/control borders |
| `--input` | `oklch(0.9 0.008 250)` | Input borders |
| `--separator` | `oklch(0.86 0.01 250)` | Separator lines |
| `--overlay` | `oklch(0.16 0.012 250 / 0.3)` | Dialog/sheet backdrop scrim |
| `--radius` | `0.5rem` | Base radius (see Radius and elevation) |

### Charts

| Token | Value | Role |
|---|---|---|
| `--chart-1` | `oklch(0.52 0.1 235)` | Steel blue — primary series |
| `--chart-2` | `oklch(0.45 0.02 250)` | Graphite — comparison / neutral |
| `--chart-3` | `oklch(0.58 0.07 205)` | Steel cyan — secondary series |
| `--chart-4` | `oklch(0.49 0.12 275)` | Indigo — categorical |
| `--chart-5` | `oklch(0.68 0.13 80)` | Warm gold — categorical accent |
| `--chart-grid` | `oklch(0.93 0.006 250)` | Grid / split lines |
| `--chart-axis` | `oklch(0.49 0.025 250)` | Axis label text |
| `--chart-reference` | `oklch(0.7 0.02 250)` | Reference lines / markers |

### Sidebar

| Token | Value | Role |
|---|---|---|
| `--sidebar-primary` | `oklch(0.48 0.1 235)` | Selected nav item (Steel Blue) |
| `--sidebar-primary-foreground` | `oklch(0.985 0 0)` | Text on selected nav item |
| `--sidebar-accent` | `oklch(0.94 0.025 235)` | Hover/active nav surface |
| `--sidebar-accent-foreground` | `oklch(0.3 0.08 235)` | Text on hover/active nav |
| `--sidebar-border` | `oklch(0.9 0.008 250)` | Sidebar separator |
| `--sidebar-ring` | `oklch(0.55 0.1 235)` | Sidebar focus ring |

### Elevation (light)

| Token | Value |
|---|---|
| `--shadow-sm` | `0 1px 2px oklch(0.18 0.02 250 / 0.05)` |
| `--shadow-md` | `0 1px 3px oklch(0.18 0.02 250 / 0.08), 0 4px 12px oklch(0.18 0.02 250 / 0.06)` |
| `--shadow-lg` | `0 2px 8px oklch(0.18 0.02 250 / 0.1), 0 12px 32px oklch(0.18 0.02 250 / 0.12)` |

### Tailwind utility mapping (`@theme inline`)

The `@theme inline` block maps every token above to Tailwind v4 utilities so
components consume tokens without literals: `bg-background`, `text-foreground`,
`bg-card`, `bg-popover`, `bg-muted`, `text-muted-foreground`, `bg-secondary`,
`bg-primary`, `text-primary-foreground`, `bg-accent`, `text-accent-foreground`,
`ring-ring`, `border-border`, `border-input`, `bg-destructive`,
`text-destructive-foreground`, `bg-overlay`, `bg-separator`,
`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`, and the financial
utilities `text-positive`, `text-negative`, `text-warning`, `text-missing`,
`text-info` (each also usable with opacity modifiers such as `bg-negative/10` or
`border-warning/30`). Chart utilities include `bg-chart-1` … `bg-chart-5`,
`bg-chart-grid`, `text-chart-axis`, and `bg-chart-reference`.

---

## Dark theme tokens

Defined in `src/app/globals.css` under `.dark` (`color-scheme: dark`).
Intentionally designed graphite surfaces — **not** an inversion of light.

### Surfaces

| Token | Value | Role |
|---|---|---|
| `--background` | `oklch(0.145 0.006 250)` | Page background — deep graphite |
| `--foreground` | `oklch(0.945 0.006 250)` | Primary text — near-white |
| `--card` | `oklch(0.185 0.008 250)` | Panel/card surface |
| `--card-foreground` | `oklch(0.945 0.006 250)` | Text on card |
| `--popover` | `oklch(0.215 0.01 250)` | Floating overlay surface |
| `--popover-foreground` | `oklch(0.945 0.006 250)` | Text on popover |
| `--muted` | `oklch(0.235 0.01 250)` | Subtle surface |
| `--muted-foreground` | `oklch(0.655 0.02 250)` | Muted/secondary text |
| `--secondary` | `oklch(0.235 0.01 250)` | Secondary control surface |
| `--secondary-foreground` | `oklch(0.945 0.006 250)` | Text on secondary |
| `--sidebar` | `oklch(0.17 0.007 250)` | Sidebar surface |
| `--sidebar-foreground` | `oklch(0.945 0.006 250)` | Sidebar text |
| `--sidebar-accent` | `oklch(0.26 0.03 235)` | Active/hover nav item surface |

### Text

| Token | Value | Role |
|---|---|---|
| `--foreground` | `oklch(0.945 0.006 250)` | Default body text |
| `--card-foreground` | `oklch(0.945 0.006 250)` | Text inside cards |
| `--popover-foreground` | `oklch(0.945 0.006 250)` | Text inside popovers |
| `--muted-foreground` | `oklch(0.655 0.02 250)` | Helper text, metadata, disabled text |
| `--secondary-foreground` | `oklch(0.945 0.006 250)` | Text on secondary controls |
| `--accent-foreground` | `oklch(0.82 0.06 230)` | Text on accent surfaces |
| `--primary-foreground` | `oklch(0.16 0.03 250)` | Text on primary (Steel Blue) |
| `--sidebar-foreground` | `oklch(0.945 0.006 250)` | Sidebar text |
| `--sidebar-accent-foreground` | `oklch(0.82 0.06 230)` | Active nav item text |

### Interaction

| Token | Value | Role |
|---|---|---|
| `--primary` | `oklch(0.65 0.1 235)` | **Steel Blue** — luminous on graphite |
| `--primary-foreground` | `oklch(0.16 0.03 250)` | Text/icon on primary |
| `--accent` | `oklch(0.28 0.03 235)` | Hover/highlight surface |
| `--accent-foreground` | `oklch(0.82 0.06 230)` | Text on accent |
| `--ring` | `oklch(0.6 0.11 235)` | Focus ring |

### Financial and operational state

| Token | Value | Meaning |
|---|---|---|
| `--positive` | `oklch(0.7 0.14 152)` | Profit (brightened for dark) |
| `--negative` | `oklch(0.64 0.2 27)` | Loss |
| `--warning` | `oklch(0.78 0.13 80)` | Caution / attention |
| `--missing` | `oklch(0.7 0.07 75)` | Stale / absent data |
| `--info` | `oklch(0.68 0.1 235)` | Informational |
| `--destructive` | `oklch(0.68 0.2 25)` | Destructive action / error |
| `--destructive-foreground` | `oklch(0.985 0 0)` | Text on destructive |

### Structure

| Token | Value | Role |
|---|---|---|
| `--border` | `oklch(0.26 0.012 250)` | Panel/control borders |
| `--input` | `oklch(0.26 0.012 250)` | Input borders |
| `--separator` | `oklch(0.3 0.012 250)` | Separator lines |
| `--overlay` | `oklch(0 0 0 / 0.5)` | Deep black scrim over graphite surfaces |

### Charts

| Token | Value | Role |
|---|---|---|
| `--chart-1` | `oklch(0.68 0.1 235)` | Steel blue — primary series |
| `--chart-2` | `oklch(0.6 0.02 250)` | Graphite — comparison / neutral |
| `--chart-3` | `oklch(0.7 0.08 205)` | Steel cyan — secondary series |
| `--chart-4` | `oklch(0.65 0.12 275)` | Indigo — categorical |
| `--chart-5` | `oklch(0.78 0.13 80)` | Warm gold — categorical accent |
| `--chart-grid` | `oklch(0.27 0.012 250)` | Grid / split lines |
| `--chart-axis` | `oklch(0.655 0.02 250)` | Axis label text |
| `--chart-reference` | `oklch(0.45 0.015 250)` | Reference lines / markers |

### Sidebar

| Token | Value | Role |
|---|---|---|
| `--sidebar-primary` | `oklch(0.65 0.1 235)` | Selected nav item |
| `--sidebar-primary-foreground` | `oklch(0.16 0.03 250)` | Text on selected nav item |
| `--sidebar-accent` | `oklch(0.26 0.03 235)` | Hover/active nav surface |
| `--sidebar-accent-foreground` | `oklch(0.82 0.06 230)` | Text on hover/active nav |
| `--sidebar-border` | `oklch(0.26 0.012 250)` | Sidebar separator |
| `--sidebar-ring` | `oklch(0.6 0.11 235)` | Sidebar focus ring |

### Elevation (dark)

| Token | Value |
|---|---|
| `--shadow-sm` | `0 1px 2px oklch(0 0 0 / 0.35)` |
| `--shadow-md` | `0 2px 6px oklch(0 0 0 / 0.45), 0 8px 20px oklch(0 0 0 / 0.3)` |
| `--shadow-lg` | `0 4px 12px oklch(0 0 0 / 0.55), 0 16px 40px oklch(0 0 0 / 0.45)` |

---

## Typography

**Font policy.** No new font dependencies. Geist Sans (`--font-sans`) is the
primary interface font; Geist Mono (`--font-mono`) is reserved for trade codes,
identifiers, technical values, and selected dense numeric contexts.

**Scale.** The type scale is theme-independent and defined once in `:root`
(consumed via `var(--font-size-*)`):

| Token | Size | Use |
|---|---|---|
| `--font-size-xs` | 0.6875rem (11px) | Metadata, table headers, badges |
| `--font-size-sm` | 0.75rem (12px) | Compact body, dense UI |
| `--font-size-md` | 0.8125rem (13px) | Table cells, dense UI |
| `--font-size-base` | 0.875rem (14px) | Default body |
| `--font-size-lg` | 1rem (16px) | Section headings |
| `--font-size-xl` | 1.25rem (20px) | Page titles |
| `--font-size-2xl` | 1.5rem (24px) | Panel / product headings |
| `--font-size-3xl` | 2rem (32px) | Numeric KPIs |

**Hierarchy treatments.** Reusable treatments: application/product name
(`--font-size-2xl`, `--font-heading`), page title (`--font-size-xl`), page
description (`--font-size-sm` `--muted-foreground`), section heading
(`--font-size-lg`), card/panel heading (`--font-size-md` semibold), table
header (`--font-size-xs` uppercase `--muted-foreground`), body (`--font-size-base`),
helper text (`--font-size-sm` `--muted-foreground`), metadata (`--font-size-xs`
`--muted-foreground`), badge/status label (`--font-size-xs`), empty state
(`--font-size-md` `--muted-foreground` centered), numeric KPI (`--font-size-3xl`
tabular), technical identifier (`--font-size-sm` mono).

**Numeric presentation.** Financial values always use `font-variant-numeric:
tabular-nums` so digits align across rows (see Financial number conventions).

---

## Density

The product targets compact desktop-workstation density (not mobile card
stacking). The density scale is theme-independent and defined once in `:root`:

| Token | Size | Use |
|---|---|---|
| `--density-control-h-xs` | 1.5rem (24px) | Micro controls |
| `--density-control-h-sm` | 1.75rem (28px) | Compact controls |
| `--density-control-h` | 2rem (32px) | Standard controls |
| `--density-control-h-lg` | 2.25rem (36px) | Prominent controls |
| `--density-row-sm` | 2.25rem (36px) | Dense table rows |
| `--density-row-md` | 2.5rem (40px) | Standard rows |
| `--density-space-1` | 0.25rem (4px) | Inline icon gaps |
| `--density-space-2` | 0.5rem (8px) | Tight inline groups |
| `--density-space-3` | 0.75rem (12px) | Dense panel padding |
| `--density-space-4` | 1rem (16px) | Standard panel padding |
| `--density-space-5` | 1.5rem (24px) | Page section gaps |
| `--density-space-6` | 2rem (32px) | Major section gaps |

**Rules**

- Standard control height: `--density-control-h` (32px); prominent controls
  `--density-control-h-lg` (36px).
- Table rows: `--density-row-md` (40px) standard, `--density-row-sm` (36px)
  for dense tables.
- Panel padding: generally `--density-space-3`/`-4` (12–16px); page section
  gap `--density-space-5`/`-6` (24–32px); dense inline groups
  `--density-space-2`/`-3` (8–12px).
- Interactive control heights must come from the density scale, not hardcoded
  Tailwind `h-*` classes.
- These are targets for the whole system, not per-component requirements.

---

## Radius and elevation

**Radius family.** A single restrained base radius (`--radius: 0.5rem` ≈ 8px)
drives a consistent family in `@theme inline`. Inputs, buttons, tabs, cards,
dropdowns, and alerts share this family:

| Utility | Derivation | Approximate size |
|---|---|---|
| `rounded-sm` | `calc(var(--radius) * 0.6)` | 0.3rem (4.8px) |
| `rounded-md` | `calc(var(--radius) * 0.8)` | 0.4rem (6.4px) |
| `rounded-lg` | `var(--radius)` | 0.5rem (8px) |
| `rounded-xl` | `calc(var(--radius) * 1.4)` | 0.7rem (11.2px) |
| `rounded-2xl` | `calc(var(--radius) * 1.8)` | 0.9rem (14.4px) |
| `rounded-3xl` | `calc(var(--radius) * 2.2)` | 1.1rem (17.6px) |
| `rounded-4xl` | `calc(var(--radius) * 2.6)` | 1.3rem (20.8px) |

**Rules**

- Default surfaces use `rounded-md`/`rounded-lg`. Avoid pill shapes except for
  compact badges, statuses, and segmented controls.
- Do not invent new radius values; derive from `--radius`.

**Elevation.** Borders and surface contrast are the primary separation
mechanism. Shadows are reserved for floating overlays: popovers, dialogs,
dropdown menus, and genuinely raised content.

- `shadow-sm` — subtle hover lift on floating controls.
- `shadow-md` — dropdowns, popovers, tooltips.
- `shadow-lg` — dialogs, sheets, and large overlays.
- Ordinary page panels use borders, not shadows. Do not apply `shadow-xl`+
  or large decorative shadows to cards and panels.

---

## Financial number conventions

Money and P&L formatting is centralized in `src/lib/format-money.ts` and
`src/lib/format-pnl.ts`. These are the accepted formatters — do not replace
them with local formatting.

| Helper | Output shape | Missing (null/undefined/NaN) |
|---|---|---|
| `formatMoney` | `$1,234.50` | `—` |
| `formatMoneyPlain` | `1,234.50` | `—` |
| `formatSignedMoney` | `+$1,234.50` / `-$1,234.50` / `$0.00` | `—` |
| `formatSignedPlain` | `+1,234.50` / `-1,234.50` | `—` |
| `formatPnl` | `+$1,234.50` / `-$1,234.50` / `$0.00` | `—` |
| `formatPnlCompact` | `$1,234.50` / `-$1,234.50` | `—` |
| `formatPnlClass` | `text-positive` / `text-negative` / `text-muted-foreground` | `text-muted-foreground` |

**Rules**

1. **Tabular numerals.** Financial surfaces use `font-variant-numeric:
   tabular-nums` so digits align.
2. **Missing ≠ zero.** Null/undefined/NaN render as `—`, never as a fabricated
   `$0.00`. Missing values remain visually distinct from zero.
3. **Negative-zero safety.** `-0` is normalized to `0` for display — no
   `-0.00` artifacts.
4. **Sign is always present.** Positive and negative values never rely on color
   alone; the `+`/`-` sign, label, or context remains available.
5. **P&L color.** `formatPnlClass` drives `text-positive` / `text-negative`;
   zero and missing values use `text-muted-foreground`.
6. **Consistency.** Currency, price, percentage, quantity, and R-multiple
   formatting stays consistent with the accepted formatters.
7. **Aligned metric matrices.** In compact metric groups, labels sit on the
   start edge and financial values, percentages, ratios, quantities, and
   counts share an end-aligned numeric edge. Put source, scope, and as-of text
   below or immediately beside its related label/value; do not distribute a
   scalar row across three distant columns. A wide panel gains density or a
   comparison table — it does not add blank space around numbers.

---

## Warning-state hierarchy

Every state has a distinct semantic treatment. A monetary loss must **not** look
identical to a destructive-delete action.

| State | Token | Required treatment |
|---|---|---|
| Positive P&L / confirmed healthy | `--positive` | `text-positive` / `bg-positive/10` badge |
| Negative P&L | `--negative` | `text-negative` (data context) |
| Destructive operation | `--destructive` | Solid destructive button/alert — visually stronger than ordinary loss |
| Validation failure | `--destructive` | Error message + `border-destructive` input state, associated with its input (aria) |
| Stale price | `--warning` / `--missing` | Warning badge or low-chroma amber label |
| Missing market price | `--missing` | Muted amber — distinct from zero and from `--warning` |
| Missing stop / risk breach | `--warning` (high attention) or `--destructive` | Alert with icon, not just color |
| Pending review | `--warning` | Attention badge/icon |
| Informational note | `--info` | Info text/badge |
| Disabled / not applicable | `--muted` / `--muted-foreground` | Muted surface/text, distinguishable but inert |

**Hierarchy notes**

- Loss (`--negative`) belongs to data display; destructive (`--destructive`)
  belongs to actions and validation. Keep them distinct.
- Amber carries two intensities: `--warning` (bright, active caution) and
  `--missing` (low-chroma, passive absence). Do not collapse them.
- Color is never the only carrier: signs, labels, icons, or contextual text
  always accompany financial and validation meaning.

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
Metrics band; one equal-width three-panel summary row for Account State,
Performance, and Review Metrics; then a full-width trades workspace with
open/current and closed/historical tabs. Analysis charts are a separate,
full-width tabbed workspace below trades when implemented. Do not put charts
inside the compact summary row and do not reserve a tall blank panel before a
chart has useful data.

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

---

## Navigation and shell

**Navigation model.** The shell organizes routes by user job
(`src/components/sidebar/nav-config.ts`, `NAV_SECTIONS`), not by database
entity. Sections render top-to-bottom:

| Section | Items |
|---|---|
| Trading | Dashboard `/`, Watchlist `/watchlist`, Trades `/trades`, Reviews `/reviews`, Checks `/checks` |
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

### The 9 dashboard chart categories

Defined in `src/components/dashboard/widget-registry.ts` (`WIDGET_REGISTRY`,
category `charts`). All 9 migrated to the M014 palette in S04.

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

**Rules**

- Chart colors must stay legible in both themes and must **not** redefine
  application status semantics: `positive`/`negative`/`warning`/`missing` mean
  the same thing in charts as in the UI.
- Green appears in charts only as profit/positive meaning (series 1 stays Steel
  Blue; the positive ramp is financial).
- Widgets determine the active theme (e.g. `document.documentElement.classList
  .contains('dark')`) and pass it to `deriveChartPalette`.

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
this document.

---

## Migration notes

### For consumers of this system (Dashboard, Trade Detail, Review, Account Detail)

1. **Read this document first.** It is the authoritative reference
   (decision D053). All subsequent visual work must cite tokens from the tables
   above rather than inventing colors.
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
6. **For dashboards, apply the workstation standard.** The risk-first
   hierarchy, normal-zoom readability, explicit customization mode, and
   market-data-state treatment above are acceptance criteria, not decorative
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
4. Document it in this file, in the correct theme and group tables, with its
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

### Related decisions

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
