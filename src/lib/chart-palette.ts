/**
 * chart-palette.ts
 *
 * Theme-aware ECharts color palette for TradingJournal (M014/S01/T02).
 *
 * Pure TypeScript: no React, no DOM, no ECharts import. Safe to import from
 * server components, API routes, and client chart widgets alike. All values
 * are plain JSON-able strings/arrays, so the palette is inspectable from the
 * browser console (`import('/src/lib/chart-palette.ts').then(m => m.chartPalette)`).
 *
 * Design contract (mirrors src/app/globals.css token groups):
 *   - `chartTokens` is the canonical source: the exact oklch token strings
 *     defined in globals.css `:root` (light) and `.dark` blocks.
 *   - `chartPalette` is the resolved, ECharts-consumable form. Colors are
 *     emitted as `#rrggbb` hex because zrender (ECharts 6) parses hex, named,
 *     rgb()/rgba(), and hsl()/hsla() — NOT oklch(). The oklch → hex conversion
 *     (`convertOklchToHex`) is bit-for-bit validated against Chromium's native
 *     oklch rendering.
 *   - Steel Blue (oklch hue ~235) is the identity hue for primary series.
 *     Green (hue ~152) appears ONLY in `positive` / the positive heatmap ramp
 *     as financial profit meaning — never as a primary/series identity color.
 *
 * Consumer guidance for S04 chart migration:
 *   - Categorical series → `palette.series` (or the `color: [...]` option)
 *   - P&L wins/losses → `palette.positive` / `palette.negative`
 *   - Split lines / grid → `palette.grid` (dash via `withAlpha(palette.grid, 0.5)`)
 *   - Axis labels → `palette.axis`
 *   - Reference lines (breakeven, averages) → `palette.reference`
 *   - Area gradients → `withAlpha(color, 0.25)` inside the ECharts gradient
 *     colorStops (zrender accepts rgba() strings).
 *   - Calendar heatmap → `palette.heatmap` (8-stop diverging ramp, negative → positive)
 */

export type ThemeName = 'light' | 'dark';

/** The two supported themes, in canonical order. */
export const THEMES: readonly ThemeName[] = ['light', 'dark'] as const;

/** Narrowing guard: is `value` a supported theme name? */
export function isThemeName(value: unknown): value is ThemeName {
  return value === 'light' || value === 'dark';
}

// ── Canonical token sources (must mirror globals.css :root / .dark) ────────

/**
 * Raw oklch token strings used by charts, keyed by theme.
 *
 * These strings are the source of truth for the chart palette and must stay in
 * sync with the matching `--chart-*`, `--positive`, `--negative`, `--warning`,
 * `--missing`, `--info`, `--destructive`, and `--primary` custom properties in
 * src/app/globals.css. Token-structure tests assert both sides.
 */
export const chartTokens = {
  light: {
    /** Steel Blue — primary series / identity (hue 235) */
    primary: 'oklch(0.48 0.1 235)',
    /** Financial state — profit */
    positive: 'oklch(0.55 0.13 152)',
    /** Financial state — loss */
    negative: 'oklch(0.55 0.19 27)',
    /** Financial state — caution */
    warning: 'oklch(0.68 0.14 75)',
    /** Financial state — stale / absent data (low-chroma amber, distinct from warning) */
    missing: 'oklch(0.6 0.07 75)',
    /** Financial state — informational */
    info: 'oklch(0.52 0.1 235)',
    /** UI destructive (used by error markers) */
    destructive: 'oklch(0.53 0.2 25)',
    /** Categorical series 1 — steel blue primary series */
    chart1: 'oklch(0.52 0.1 235)',
    /** Categorical series 2 — graphite comparison / neutral */
    chart2: 'oklch(0.45 0.02 250)',
    /** Categorical series 3 — steel cyan */
    chart3: 'oklch(0.58 0.07 205)',
    /** Categorical series 4 — indigo */
    chart4: 'oklch(0.49 0.12 275)',
    /** Categorical series 5 — warm gold accent */
    chart5: 'oklch(0.68 0.13 80)',
    /** Grid / split lines */
    grid: 'oklch(0.93 0.006 250)',
    /** Axis label text */
    axis: 'oklch(0.49 0.025 250)',
    /** Reference lines / markers */
    reference: 'oklch(0.7 0.02 250)',
  },
  dark: {
    primary: 'oklch(0.65 0.1 235)',
    positive: 'oklch(0.7 0.14 152)',
    negative: 'oklch(0.64 0.2 27)',
    warning: 'oklch(0.78 0.13 80)',
    missing: 'oklch(0.7 0.07 75)',
    info: 'oklch(0.68 0.1 235)',
    destructive: 'oklch(0.68 0.2 25)',
    chart1: 'oklch(0.68 0.1 235)',
    chart2: 'oklch(0.6 0.02 250)',
    chart3: 'oklch(0.7 0.08 205)',
    chart4: 'oklch(0.65 0.12 275)',
    chart5: 'oklch(0.78 0.13 80)',
    grid: 'oklch(0.27 0.012 250)',
    axis: 'oklch(0.655 0.02 250)',
    reference: 'oklch(0.45 0.015 250)',
  },
} as const;

// ── Resolved ECharts palette ──────────────────────────────────────────────

/** Theme-keyed chart palette with all colors in ECharts-compatible hex. */
export interface ChartPalette {
  /**
   * Categorical series colors (chart-1..chart-5). Pass directly to an ECharts
   * series `color` option or to `option.color` for automatic cycling.
   */
  series: readonly string[];
  /** Profit color (green, financial meaning only). */
  positive: string;
  /** Loss color (red). */
  negative: string;
  /** Caution color (amber). */
  warning: string;
  /** Stale / absent data color (low-chroma amber). */
  missing: string;
  /** Informational color (steel blue). */
  info: string;
  /** Destructive / error color. */
  destructive: string;
  /** Grid and split-line color. */
  grid: string;
  /** Axis label color. */
  axis: string;
  /** Reference line / marker color. */
  reference: string;
  /**
   * 8-stop diverging ramp for P&L heatmaps, negative → positive:
   * index 0 = deepest negative, 3 = pale negative, 4 = pale positive, 7 = deepest positive.
   */
  heatmap: readonly string[];
}

// ── OKLCH → hex conversion (pure, no dependencies) ────────────────────────

interface OklchComponents {
  L: number;
  C: number;
  H: number;
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i;

function parseOklch(color: string): OklchComponents {
  const match = OKLCH_RE.exec(color.trim());
  if (!match) {
    throw new Error(
      `Chart palette error: expected "oklch(L C H)" (e.g. "oklch(0.52 0.1 235)"), got "${color}"`,
    );
  }
  const L = Number(match[1]);
  const C = Number(match[2]);
  const H = Number(match[3]);
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) {
    throw new Error(`Chart palette error: non-finite oklch component in "${color}"`);
  }
  return { L, C, H };
}

/**
 * Convert an `oklch(L C H)` color string to `#rrggbb` hex.
 *
 * Implements Björn Ottosson's OKLab reference conversion (oklch → oklab →
 * linear sRGB → gamma-encoded sRGB). Validated bit-for-bit against Chromium's
 * native oklch rendering for the M014 token set.
 *
 * @throws {Error} `Chart palette error:` on malformed input (mirrors the
 *   position-sizing error prefix convention).
 */
export function convertOklchToHex(color: string): string {
  const { L, C, H } = parseOklch(color);
  const hue = (H * Math.PI) / 180;
  const a = C * Math.cos(hue);
  const b = C * Math.sin(hue);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const toByte = (c: number): number => {
    const clamped = Math.max(0, Math.min(1, c));
    const encoded =
      clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(255, encoded * 255)));
  };

  return `#${[toByte(rLin), toByte(gLin), toByte(bLin)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Return `rgba(r, g, b, alpha)` from a `#rgb` / `#rrggbb` hex string.
 *
 * ECharts area-gradient colorStops and dashed split lines accept rgba()
 * strings, so widgets build translucent variants of palette colors without
 * inventing new hex values.
 *
 * @param alpha Opacity 0..1 (clamped).
 * @throws {Error} `Chart palette error:` on non-hex input or out-of-range alpha.
 */
export function withAlpha(hex: string, alpha: number): string {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(
      `Chart palette error: alpha must be a number in [0, 1], got ${alpha}`,
    );
  }
  const value = hex.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(value);
  const long = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (short) {
    const [r, g, b] = short[1]
      .split('')
      .map((c) => parseInt(c + c, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (long) {
    const n = parseInt(long[1], 16);
    return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
  }
  throw new Error(
    `Chart palette error: expected "#rgb" or "#rrggbb" hex, got "${hex}"`,
  );
}

// ── Palette builders (internal) ───────────────────────────────────────────

interface TokenSet {
  primary: string;
  positive: string;
  negative: string;
  warning: string;
  missing: string;
  info: string;
  destructive: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  grid: string;
  axis: string;
  reference: string;
}

/**
 * Build an 8-stop diverging P&L ramp from the negative/positive tokens.
 *
 * Stops 0..3 interpolate from the theme's `negative` color toward a pale,
 * surface-tinted neutral; stops 4..7 interpolate from that neutral toward
 * `positive`. Hue is held constant per side (red family / green family) so
 * the ramp stays monochromatic instead of sweeping through unrelated hues.
 */
function buildHeatmapRamp(tokens: TokenSet, theme: ThemeName): readonly string[] {
  const { L: negL, C: negC, H: negH } = parseOklch(tokens.negative);
  const { L: posL, C: posC, H: posH } = parseOklch(tokens.positive);
  // Pale anchor tuned to the theme's surface luminance: light near-white,
  // dark near-graphite-surface.
  const paleL = theme === 'light' ? 0.955 : 0.24;
  const paleC = theme === 'light' ? 0.02 : 0.03;

  // Perceptual stop spacing: long pale tail (many near-zero days), dense deep end.
  const fractions = [0, 0.5, 0.82, 1] as const;
  const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

  const negativeStops = fractions
    .map((t) =>
      convertOklchToHex(`oklch(${lerp(paleL, negL, t).toFixed(4)} ${lerp(paleC, negC, t).toFixed(4)} ${negH})`),
    )
    // Calendar-heatmap convention (matches the pre-M014 PNL_COLORS array):
    // index 0 = deepest negative, index 3 = pale negative.
    .reverse();
  const positiveStops = fractions.map((t) =>
    convertOklchToHex(`oklch(${lerp(paleL, posL, t).toFixed(4)} ${lerp(paleC, posC, t).toFixed(4)} ${posH})`),
  );
  return [...negativeStops, ...positiveStops];
}

function buildPalette(tokens: TokenSet, theme: ThemeName): ChartPalette {
  return {
    series: [
      convertOklchToHex(tokens.chart1),
      convertOklchToHex(tokens.chart2),
      convertOklchToHex(tokens.chart3),
      convertOklchToHex(tokens.chart4),
      convertOklchToHex(tokens.chart5),
    ],
    positive: convertOklchToHex(tokens.positive),
    negative: convertOklchToHex(tokens.negative),
    warning: convertOklchToHex(tokens.warning),
    missing: convertOklchToHex(tokens.missing),
    info: convertOklchToHex(tokens.info),
    destructive: convertOklchToHex(tokens.destructive),
    grid: convertOklchToHex(tokens.grid),
    axis: convertOklchToHex(tokens.axis),
    reference: convertOklchToHex(tokens.reference),
    heatmap: buildHeatmapRamp(tokens, theme),
  };
}

/**
 * Resolved ECharts palettes for both themes. Built eagerly at module load so
 * the constants are plain, console-inspectable data (no lazy computation).
 */
export const chartPalette: Record<ThemeName, ChartPalette> = {
  light: buildPalette(chartTokens.light, 'light'),
  dark: buildPalette(chartTokens.dark, 'dark'),
};

/**
 * Theme-aware palette resolver for chart widgets.
 *
 * Client widgets determine the active theme (e.g. via
 * `document.documentElement.classList.contains('dark')`) and pass the result
 * here; server contexts default to explicit theme selection by the caller.
 *
 * @throws {Error} `Chart palette error:` for unknown theme names, so a typo
 *   or a new theme added to globals.css without a palette entry fails loudly
 *   instead of silently rendering default colors.
 */
export function deriveChartPalette(theme: ThemeName): ChartPalette {
  const palette = chartPalette[theme];
  if (!palette) {
    throw new Error(
      `Chart palette error: unknown theme "${String(theme)}"; expected one of ${THEMES.join(', ')}`,
    );
  }
  return palette;
}
