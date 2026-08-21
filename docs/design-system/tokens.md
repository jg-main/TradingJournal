# Token Reference

**Part of the TradingJournal Design System** (see [`README.md`](./README.md)).

The canonical light/dark token tables, typography, density, radius/elevation,
financial number conventions, and warning-state hierarchy. This file is the
token half of the source-parsing contract guarded by
`src/lib/__tests__/design-system-docs.test.ts`: every custom property defined
in `src/app/globals.css` (`:root` light and `.dark`) must appear here by name
and value, and every token cited here must exist in the CSS.

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

### Component dimensions

Fixed, theme-independent surface heights for components whose geometry must
not be content-driven (equal-height KPI rail cards):

| Token | Value | Use |
|---|---|---|
| `--kpi-card-h` | `6.875rem` (110px) | Fixed KPI rail card height — the five-card default shares identical top/bottom edges; the microvisualization lives in a reserved fixed slot and can never change it. Consumed via the `h-kpi-card` Tailwind utility. |

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
