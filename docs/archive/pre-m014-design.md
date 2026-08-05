# Pre-M014 Design System (Archived)

> **Superseded.** This July 2026 document describes the retired moss-green
> identity. Do not use it for implementation. The current visual authority is
> [`docs/design-system.md`](../design-system.md), with token values in
> `src/app/globals.css` and ECharts values in `src/lib/chart-palette.ts`.
>
> Retained only as historical context for the pre-M014 interface.

# Design System

> A precision instrument for trading journaling. Sharp, disciplined, analytical.
> Generated 2026-07-03. This file is source-of-truth for visual tokens.

## Theme

**Strategy:** Restrained — one brand color (moss green) used sparingly for active states, brand moments, and key actions. The UI lives in pure neutrals. Color always signals function.

**Light / Dark:** Both modes are first-class. Light mode is the default operational surface; dark mode reduces glare for extended evening use.

**Mood phrase:** "Precision instrument — machined aluminum, calibrated dials, morning light through a north-facing window."

## Palette

All values in OKLCH. Chroma-zero values are written without hue.

### Light Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `oklch(1 0 0)` | Pure white. No tint — the brand lives in accent color, not surface. |
| `--foreground` | `oklch(0.13 0.008 130)` | Near-black body text. Microscopic green cast reads as charcoal, not green. ≥15:1. |
| `--card` | `oklch(1 0 0)` | Cards, panels, dialogs. Matches background. |
| `--card-foreground` | `oklch(0.13 0.008 130)` | |
| `--popover` | `oklch(1 0 0)` | |
| `--popover-foreground` | `oklch(0.13 0.008 130)` | |
| `--primary` | `oklch(0.55 0.14 130)` | Moss green. Seed-derived. Used for primary buttons, active nav, key CTAs. |
| `--primary-foreground` | `oklch(0.985 0 0)` | White text on moss fill. |
| `--secondary` | `oklch(0.965 0.005 90)` | Subtle warm-tinted surface for secondary panels, section backgrounds. |
| `--secondary-foreground` | `oklch(0.13 0.008 130)` | |
| `--muted` | `oklch(0.965 0.005 90)` | |
| `--muted-foreground` | `oklch(0.47 0.012 130)` | Secondary text, descriptions. ≥5:1. |
| `--accent` | `oklch(0.50 0.12 250)` | Steel blue. Used for info badges, status indicators, secondary selection. |
| `--accent-foreground` | `oklch(0.985 0 0)` | White text on steel fill. |
| `--destructive` | `oklch(0.55 0.20 25)` | Controlled red. Not alarm-red — a measured warning for delete/scrub/remove actions. |
| `--destructive-foreground` | `oklch(0.985 0 0)` | |
| `--border` | `oklch(0.90 0.005 90)` | Subtle warm border line. |
| `--input` | `oklch(0.90 0.005 90)` | |
| `--ring` | `oklch(0.65 0.08 130)` | Focus ring in brand hue. |
| `--radius` | `0.5rem` | Reduced from shadcn default. Sharp tool, sharp radii. |

**Chart palette** (5-color sequence for echarts/bar charts):

| Token | Value | |
|-------|-------|---|
| `--chart-1` | `oklch(0.55 0.14 130)` | Moss green (primary) |
| `--chart-2` | `oklch(0.50 0.12 250)` | Steel blue (accent) |
| `--chart-3` | `oklch(0.55 0.10 280)` | Subdued violet |
| `--chart-4` | `oklch(0.52 0.10 80)` | Olive-amber |
| `--chart-5` | `oklch(0.48 0.08 20)` | Warm earth |

**P&L colors** (functional, not tokenized as shadcn vars):

| Role | Value | Usage |
|------|-------|-------|
| Profit | `oklch(0.55 0.16 145)` | Clean functional green. 15° away from brand primary — visually distinct. |
| Loss | `oklch(0.55 0.18 25)` | Controlled red. Not the same as destructive. |

**Sidebar** (light):

| Token | Value |
|-------|-------|
| `--sidebar` | `oklch(1 0 0)` |
| `--sidebar-foreground` | `oklch(0.13 0.008 130)` |
| `--sidebar-primary` | `oklch(0.50 0.14 130)` |
| `--sidebar-primary-foreground` | `oklch(0.985 0 0)` |
| `--sidebar-accent` | `oklch(0.965 0.005 90)` |
| `--sidebar-accent-foreground` | `oklch(0.13 0.008 130)` |
| `--sidebar-border` | `oklch(0.90 0.005 90)` |
| `--sidebar-ring` | `oklch(0.65 0.08 130)` |

### Dark Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `oklch(0.12 0.004 130)` | Near-black with microscopic green cast. |
| `--foreground` | `oklch(0.95 0.004 130)` | Near-white body text. |
| `--card` | `oklch(0.16 0.005 130)` | |
| `--card-foreground` | `oklch(0.95 0.004 130)` | |
| `--popover` | `oklch(0.16 0.005 130)` | |
| `--popover-foreground` | `oklch(0.95 0.004 130)` | |
| `--primary` | `oklch(0.62 0.145 130)` | Lighter moss for dark mode contrast. |
| `--primary-foreground` | `oklch(0.12 0 0)` | Near-black text on moss fill. |
| `--secondary` | `oklch(0.20 0.005 130)` | |
| `--secondary-foreground` | `oklch(0.95 0.004 130)` | |
| `--muted` | `oklch(0.20 0.005 130)` | |
| `--muted-foreground` | `oklch(0.60 0.008 130)` | ≥5:1 on bg(0.12). |
| `--accent` | `oklch(0.55 0.11 250)` | |
| `--accent-foreground` | `oklch(0.12 0 0)` | |
| `--destructive` | `oklch(0.60 0.22 25)` | |
| `--destructive-foreground` | `oklch(0.12 0 0)` | |
| `--border` | `oklch(0.22 0.005 130)` | |
| `--input` | `oklch(0.22 0.005 130)` | |
| `--ring` | `oklch(0.55 0.10 130)` | |
| `--chart-*` | same as light | Charts share same palette in both modes. |
| Profit | `oklch(0.60 0.16 145)` | Slightly brighter for dark bg. |
| Loss | `oklch(0.60 0.18 25)` | |

**Sidebar** (dark):

| Token | Value |
|-------|-------|
| `--sidebar` | `oklch(0.14 0.004 130)` |
| `--sidebar-foreground` | `oklch(0.95 0.004 130)` |
| `--sidebar-primary` | `oklch(0.55 0.14 130)` |
| `--sidebar-primary-foreground` | `oklch(0.12 0 0)` |
| `--sidebar-accent` | `oklch(0.20 0.005 130)` |
| `--sidebar-accent-foreground` | `oklch(0.95 0.004 130)` |
| `--sidebar-border` | `oklch(0.22 0.005 130)` |
| `--sidebar-ring` | `oklch(0.55 0.10 130)` |

## Typography

**Font stack:** Geist Sans (body, headings) / Geist Mono (tabular data, codes). Already configured and loaded — no font changes needed.

| Role | Size | Weight | Letter-spacing | Notes |
|------|------|--------|---------------|-------|
| H1 (page title) | `text-2xl` / 1.5rem | 600 (semibold) | `-0.02em` | Page-level titles only |
| H2 (section) | `text-lg` / 1.125rem | 600 (semibold) | `-0.01em` | Section headers in dashboard |
| H3 (card title) | `text-base` / 1rem | 500 (medium) | `0` | Card titles, dialog headers |
| Body | `text-sm` / 0.875rem | 400 (normal) | `0` | Most interface text |
| Small | `text-xs` / 0.75rem | 400 (normal) | `0` | Captions, metadata |
| Table header | `text-xs` / 0.75rem | 500 (medium) | `+0.05em` | Uppercase, tracking-wider |
| Monospace data | `text-xs` – `text-sm` | 400 (normal) | `0` | Trade codes, prices, timestamps |
| KPI value | `text-2xl` / 1.5rem | 700 (bold) | `-0.01em` | Dashboard metric cards |

- **Line-height:** body 1.5, headings 1.3, small 1.4
- **Max line length:** body text capped at 70ch
- **Heading balance:** `text-wrap: balance` on h1–h3
- **Orphan control:** `text-wrap: pretty` on long prose

### Tabular numbers

All numeric data (prices, P&L, percentages, counts, dates) uses `tabular-nums` for aligned columns. This is Geist Mono's default — no opt-in needed beyond the class.

## Components

### Cards

- bg: `var(--card)` / border: `var(--border)` / radius: `var(--radius)`
- Default padding: `p-4` (1rem); `size="sm"` variant: `p-3` (0.75rem)
- Card title: `text-base font-medium` (H3)
- Card description: `text-sm text-muted-foreground`
- No nested cards. Cards are leaf containers.
- No side-stripe borders. Use full borders or nothing.

### Buttons

- `default`: bg=`--primary` / text=`--primary-foreground` / radius=`--radius`
- `outline`: border=`--border` / bg=`transparent` / hover=`--muted`
- `secondary`: bg=`--secondary` / text=`--secondary-foreground`
- `ghost`: transparent / hover=`--muted`
- `destructive`: bg=`--destructive` / text=`--destructive-foreground`
- `link`: `--primary` text / underline on hover
- Heights: default h-8, sm h-7, lg h-9, xs h-6
- Padding: px-2.5 default, data-[icon] variants for icon-in-button
- Active state: `translate-y-px` (eliminates the reactive feedback gap)

### Badges / Status Pills

- `rounded-full` (full pill)
- Size: `px-2.5 py-0.5 text-xs font-medium`
- Color strategy: tinted bg + colored text (e.g. `bg-emerald-100 text-emerald-700`). The tinted-bg approach gives clear signal without flooding the page with saturated fills.
- P&L badge thumb rule: `bg-<color>-100 text-<color>-700` in light, `bg-<color>-900/30 text-<color>-400` in dark
- Grade badges (A/B/C/D/F) use a spectrum: emerald → blue → amber → orange → red

### Tables

- Border: `border-zinc-200 dark:border-zinc-800`
- Header row: `bg-zinc-50 dark:bg-zinc-900`, 12px font, medium weight, uppercase with tracking
- Body rows: `divide-y divide-zinc-200 dark:divide-zinc-800`
- Hover: `hover:bg-zinc-50 dark:hover:bg-zinc-900/50`
- Cell padding: `px-4 py-3`
- Numeric cells: right-aligned, `tabular-nums`
- No alternating row colors — use hover-only for row state

### Forms & Inputs

- Inputs: border=`--input` / bg=`white` / text=`--foreground` / radius=`--radius`
- Focus: ring=`--ring` at 1px width
- Labels: `text-sm font-medium text-foreground` above field
- Validation error: border/ring shifts to `--destructive`
- Placeholder: `text-muted-foreground` (≥4.5:1)

### Dialogs (Plan Trade, Generate Review)

- Radius: `rounded-xl`
- Header: `DialogTitle` + `DialogDescription` with muted foreground
- Footer: `border-t`, right-aligned Cancel + Submit buttons

### Empty States

- Dashed border (`border-dashed border-zinc-300 dark:border-zinc-700`)
- Centered icon (zinc-300/600, strokeWidth 1)
- Title + description + optional CTA button
- Padding: `px-6 py-16`

## Layout

### Page Shell

- `mx-auto max-w-4xl px-8 py-10` (standard page constraint)
- Sidebar: fixed 224px (`w-56`), right border, full height
- Page pattern: heading (h1 + subtitle) → filters/actions → content/table

### Grid Patterns

- KPI cards: `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`
- Dashboard chart panels: `grid grid-cols-1 gap-6 lg:grid-cols-2`
- Settings cards: `grid gap-4 sm:grid-cols-2`
- Form field pairs: `grid grid-cols-2 gap-4` or `grid grid-cols-3 gap-4`

### Spacing Scale

The project uses Tailwind's default spacing scale. Key repeating values:

| Use case | Value |
|----------|-------|
| Page padding | `px-8 py-10` |
| Section gap | `mb-8` / `mt-8` |
| Card grid gap | `gap-4` / `gap-6` |
| Form field gap | `space-y-4` |
| List item gap | `gap-2` / `gap-3` |
| Table cell text-to-border | `px-4 py-3` |
| Icon-to-text | `gap-2.5` (sidebar) / `gap-1.5` (buttons) |

## Interaction

### Motion

- All transitions: `transition-colors` for color-only changes, `transition-all` sparingly
- Easing: ease-out-quart or ease-out-quint curves via `tw-animate-css` defaults
- Reduced motion: `@media (prefers-reduced-motion: reduce)` strips to instant transitions
- No bounce, no elastic, no layout-animating properties
- Loading skeletons: `animate-pulse` (shimmer-free — just opacity pulse)
- Dialog enter/exit: crossfade opacity + subtle scale (tw-animate-css defaults)

### Focus & Keyboard

- All interactive elements: visible focus ring (`outline-ring/50`)
- Focus ring color: `--ring` in brand hue
- Dialogs: focus-trapped, Escape to close
- Tables: keyboard navigable via native `<button>`/`<a>` elements in cells

### Color-Only Signal

- P&L values use BOTH color AND +/- sign
- Status badges use BOTH color AND text label (e.g., not just a green dot)
- Direction badges use BOTH color AND text ("Long" / "Short")
- Grade badges use BOTH color AND letter (A–F)

## Data Visualization

### Charts (ECharts via echarts-for-react)

- Chart palette matches the 5-color chart sequence above
- Grid: `left: 10%, right: 5%, top: 20, bottom: 25`
- Tooltips: `trigger: axis` with custom formatter for readable context
- Lines: smooth, `showSymbol: false` for equity curves, 2px width
- Area fills: linear gradient from full opacity to transparent (equity), or flat tint (drawdown)
- Monthly bar charts: green bars for positive, red for negative
- Always include empty-state fallback when data array is empty

## Accessibility

- WCAG 2.1 AA minimum throughout
- Color never sole differentiator (signs, labels, patterns augment)
- `prefers-reduced-motion` strips all animation
- Focus rings visible on all interactive elements
- Form labels properly associated via `htmlFor`/`id`
- Table headers use `<th>` with scope
- Icon buttons include `aria-label` or visible text
