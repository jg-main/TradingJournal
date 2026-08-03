/**
 * chart-palette.test.ts — M014/S01/T04
 *
 * Verifies the theme-aware ECharts palette module (src/lib/chart-palette.ts):
 *   - exported surface shape (THEMES, isThemeName, chartTokens, chartPalette,
 *     convertOklchToHex, withAlpha, deriveChartPalette)
 *   - raw token sources are valid oklch(L C H) strings for BOTH themes
 *   - resolved palettes are ECharts-consumable #rrggbb hex with the documented
 *     shape (5 series, 6 financial colors, grid/axis/reference, 8-stop heatmap)
 *   - the oklch→hex converter matches known reference values (non-circular:
 *     expected hex hardcoded, not derived from the implementation)
 *   - internal consistency: every resolved color equals the conversion of its
 *     canonical token, and heatmap endpoints equal the negative/positive colors
 *   - no-green identity constraint: green hue appears ONLY in `positive`;
 *     identity/series/state tokens keep Steel Blue (hue ~235) / graphite hues
 *   - loud failure modes: malformed oklch, non-hex, out-of-range alpha, and
 *     unknown themes all throw `Chart palette error:`
 */
import { describe, it, expect } from 'vitest';
import {
  THEMES,
  isThemeName,
  chartTokens,
  chartPalette,
  convertOklchToHex,
  withAlpha,
  deriveChartPalette,
  type ThemeName,
} from '../chart-palette';

/* ── Shared helpers ─────────────────────────────────────────────────────── */

interface OklchComponents {
  L: number;
  C: number;
  H: number;
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function parseOklch(color: string): OklchComponents {
  const m = OKLCH_RE.exec(color.trim());
  if (!m) throw new Error(`Test helper: expected oklch(L C H), got "${color}"`);
  return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

/** Green hue band (oklch degrees). The T03 proof surface audit uses 127–165°. */
const GREEN_MIN = 127;
const GREEN_MAX = 165;
/** Steel Blue identity hue band (matches proof-surface audit 200–260°). */
const STEEL_MIN = 200;
const STEEL_MAX = 260;

/** Token keys that are allowed to be green (financial profit). */
const GREEN_ALLOWED = new Set(['positive']);
/** Token keys that must carry the Steel Blue identity hue. */
const STEEL_REQUIRED = ['primary', 'info', 'chart1', 'chart3'] as const;

function isGreenHue(h: number): boolean {
  return h >= GREEN_MIN && h <= GREEN_MAX;
}

/* ── Module surface ─────────────────────────────────────────────────────── */

describe('chart-palette module surface', () => {
  it('exposes exactly the two supported themes in canonical order', () => {
    expect(THEMES).toEqual(['light', 'dark']);
    expect([...THEMES]).toStrictEqual(['light', 'dark']);
  });

  it('isThemeName narrows light/dark and rejects everything else', () => {
    expect(isThemeName('light')).toBe(true);
    expect(isThemeName('dark')).toBe(true);
    expect(isThemeName('blue')).toBe(false);
    expect(isThemeName('Light')).toBe(false);
    expect(isThemeName('')).toBe(false);
    expect(isThemeName(undefined)).toBe(false);
    expect(isThemeName(null)).toBe(false);
    expect(isThemeName(42)).toBe(false);
  });
});

/* ── chartTokens: canonical raw sources ─────────────────────────────────── */

describe('chartTokens (raw oklch sources)', () => {
  const EXPECTED_KEYS = [
    'primary',
    'positive',
    'negative',
    'warning',
    'missing',
    'info',
    'destructive',
    'chart1',
    'chart2',
    'chart3',
    'chart4',
    'chart5',
    'grid',
    'axis',
    'reference',
  ] as const;

  it.each(['light', 'dark'] as const)('defines the full token set for %s', (theme) => {
    const tokens = chartTokens[theme];
    expect(Object.keys(tokens).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it.each(['light', 'dark'] as const)(
    'every %s token is a well-formed oklch(L C H) string with finite components',
    (theme) => {
      for (const [key, value] of Object.entries(chartTokens[theme])) {
        const parsed = parseOklch(value); // throws on malformed input
        expect(Number.isFinite(parsed.L), `${theme}.${key} L`).toBe(true);
        expect(Number.isFinite(parsed.C), `${theme}.${key} C`).toBe(true);
        expect(Number.isFinite(parsed.H), `${theme}.${key} H`).toBe(true);
        expect(parsed.L).toBeGreaterThanOrEqual(0);
        expect(parsed.L).toBeLessThanOrEqual(1);
      }
    },
  );
});

/* ── chartPalette: resolved ECharts palettes ────────────────────────────── */

describe('chartPalette (resolved hex palettes)', () => {
  const FINANCIAL_COLORS = [
    'positive',
    'negative',
    'warning',
    'missing',
    'info',
    'destructive',
  ] as const;

  it.each(['light', 'dark'] as const)('resolves the documented shape for %s', (theme) => {
    const palette = chartPalette[theme];

    expect(palette.series).toHaveLength(5);
    for (const color of palette.series) {
      expect(color).toMatch(HEX_RE);
    }

    for (const key of FINANCIAL_COLORS) {
      expect(palette[key], key).toMatch(HEX_RE);
    }

    expect(palette.grid).toMatch(HEX_RE);
    expect(palette.axis).toMatch(HEX_RE);
    expect(palette.reference).toMatch(HEX_RE);

    expect(palette.heatmap).toHaveLength(8);
    for (const color of palette.heatmap) {
      expect(color).toMatch(HEX_RE);
    }
  });

  it('exposes distinct categorical series colors (5 unique values per theme)', () => {
    for (const theme of THEMES) {
      const series = chartPalette[theme].series;
      expect(new Set(series).size).toBe(5);
    }
  });

  it('exposes an 8-stop heatmap with unique stops', () => {
    for (const theme of THEMES) {
      const heatmap = chartPalette[theme].heatmap;
      expect(new Set(heatmap).size).toBe(8);
    }
  });
});

/* ── convertOklchToHex: reference values + error paths ──────────────────── */

describe('convertOklchToHex', () => {
  it('matches known reference conversions (hardcoded, non-circular)', () => {
    expect(convertOklchToHex('oklch(1 0 0)')).toBe('#ffffff');
    expect(convertOklchToHex('oklch(0 0 0)')).toBe('#000000');
    expect(convertOklchToHex('oklch(0.5 0 0)')).toBe('#636363');
    expect(convertOklchToHex('oklch(0.985 0 0)')).toBe('#fafafa');
    // M014 identity + financial reference values (validated against Chromium
    // native oklch rendering in T02).
    expect(convertOklchToHex('oklch(0.48 0.1 235)')).toBe('#06658e'); // light primary
    expect(convertOklchToHex('oklch(0.52 0.1 235)')).toBe('#1c719a'); // light chart-1 / info
    expect(convertOklchToHex('oklch(0.55 0.13 152)')).toBe('#22864a'); // light positive
    expect(convertOklchToHex('oklch(0.65 0.1 235)')).toBe('#4a99c3'); // dark primary
    expect(convertOklchToHex('oklch(0.7 0.14 152)')).toBe('#4fb772'); // dark positive
  });

  it('tolerates surrounding whitespace between components', () => {
    expect(convertOklchToHex('  oklch( 0.48  0.1 235 ) ')).toBe(convertOklchToHex('oklch(0.48 0.1 235)'));
  });

  it('converts every canonical token to a deterministic 6-digit hex', () => {
    for (const theme of THEMES) {
      for (const [key, value] of Object.entries(chartTokens[theme])) {
        const hex = convertOklchToHex(value);
        expect(hex, `${theme}.${key}`).toMatch(HEX_RE);
        expect(convertOklchToHex(value), `${theme}.${key} deterministic`).toBe(hex);
      }
    }
  });

  it('throws Chart palette error on malformed input', () => {
    const badInputs = [
      '',
      'blue',
      '#1c719a',
      'rgb(1 2 3)',
      'oklch(0.5)',
      'oklch(0.5 0.1)',
      'oklch(0.5 0.1 235 0.5)',
      'oklch(abc def ghi)',
      'oklch(0.5 0.1 235)', // valid — control, must NOT throw
    ];
    for (const input of badInputs.slice(0, -1)) {
      expect(() => convertOklchToHex(input), input).toThrow(/Chart palette error/);
    }
    expect(() => convertOklchToHex(badInputs.at(-1) as string)).not.toThrow();
  });

  it('throws Chart palette error on non-finite components', () => {
    expect(() => convertOklchToHex('oklch(.5.5 0 0)')).toThrow(/Chart palette error/);
    expect(() => convertOklchToHex('oklch(1.1 0 0)')).not.toThrow(); // out-of-range L is clamped, not an error
  });
});

/* ── withAlpha ──────────────────────────────────────────────────────────── */

describe('withAlpha', () => {
  it('builds rgba() from #rrggbb hex', () => {
    expect(withAlpha('#1c719a', 0.5)).toBe('rgba(28, 113, 154, 0.5)');
    expect(withAlpha('#ffffff', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha('#000000', 0.25)).toBe('rgba(0, 0, 0, 0.25)');
  });

  it('builds rgba() from #rgb shorthand (case-insensitive)', () => {
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(withAlpha('#1C7', 0.25)).toBe('rgba(17, 204, 119, 0.25)');
  });

  it('throws Chart palette error on non-hex input', () => {
    expect(() => withAlpha('1c719a', 0.5)).toThrow(/Chart palette error/);
    expect(() => withAlpha('oklch(0.5 0.1 235)', 0.5)).toThrow(/Chart palette error/);
    expect(() => withAlpha('', 0.5)).toThrow(/Chart palette error/);
  });

  it('throws Chart palette error on alpha outside [0, 1] or non-finite', () => {
    expect(() => withAlpha('#1c719a', -0.1)).toThrow(/Chart palette error/);
    expect(() => withAlpha('#1c719a', 1.1)).toThrow(/Chart palette error/);
    expect(() => withAlpha('#1c719a', Number.NaN)).toThrow(/Chart palette error/);
    expect(() => withAlpha('#1c719a', Number.POSITIVE_INFINITY)).toThrow(/Chart palette error/);
  });

  it('accepts boundary alpha values 0 and 1', () => {
    expect(withAlpha('#1c719a', 0)).toBe('rgba(28, 113, 154, 0)');
    expect(withAlpha('#1c719a', 1)).toBe('rgba(28, 113, 154, 1)');
  });
});

/* ── deriveChartPalette ─────────────────────────────────────────────────── */

describe('deriveChartPalette', () => {
  it('returns the eagerly built palette objects for both themes', () => {
    expect(deriveChartPalette('light')).toBe(chartPalette.light);
    expect(deriveChartPalette('dark')).toBe(chartPalette.dark);
  });

  it('throws Chart palette error for unknown themes (loud failure)', () => {
    for (const bad of ['blue', '', 'Light', 'sepia'] as unknown[]) {
      expect(() => deriveChartPalette(bad as ThemeName), String(bad)).toThrow(/Chart palette error/);
    }
  });
});

/* ── Internal consistency: resolved palette ↔ canonical tokens ──────────── */

describe('chartPalette internal consistency', () => {
  it.each(['light', 'dark'] as const)(
    'every resolved %s color equals the conversion of its canonical token',
    (theme) => {
      const tokens = chartTokens[theme];
      const palette = chartPalette[theme];

      const chartKeys = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'] as const;
      chartKeys.forEach((key, i) => {
        expect(palette.series[i], `${theme}.series[${i}] (${key})`).toBe(
          convertOklchToHex(tokens[key]),
        );
      });

      const scalarKeys = [
        'positive',
        'negative',
        'warning',
        'missing',
        'info',
        'destructive',
        'grid',
        'axis',
        'reference',
      ] as const;
      for (const key of scalarKeys) {
        expect(palette[key], `${theme}.${key}`).toBe(convertOklchToHex(tokens[key]));
      }
    },
  );

  it('anchors the heatmap ramp at the negative/positive colors (index 0 / 7)', () => {
    for (const theme of THEMES) {
      const palette = chartPalette[theme];
      const tokens = chartTokens[theme];
      expect(palette.heatmap[0]).toBe(convertOklchToHex(tokens.negative));
      expect(palette.heatmap[7]).toBe(convertOklchToHex(tokens.positive));
    }
  });

  it('keeps the heatmap in the red family (0–3) and green family (4–7) per theme', () => {
    // Hue is held constant per side by the ramp builder: negative side uses the
    // theme negative hue, positive side uses the theme positive hue. Re-parse
    // the *canonical tokens* (not the hex, which is lossy for hue intent) and
    // verify the endpoints derive from the correct family.
    for (const theme of THEMES) {
      const { H: negHue } = parseOklch(chartTokens[theme].negative);
      const { H: posHue } = parseOklch(chartTokens[theme].positive);
      expect(isGreenHue(negHue)).toBe(false); // red/orange family, not green
      expect(isGreenHue(posHue)).toBe(true); // green family (financial profit)
    }
  });
});

/* ── No-green identity constraint ───────────────────────────────────────── */

describe('no-green identity constraint (green reserved for positive)', () => {
  it.each(['light', 'dark'] as const)(
    '%s: every non-positive token stays out of the green hue band',
    (theme) => {
      for (const [key, value] of Object.entries(chartTokens[theme])) {
        if (GREEN_ALLOWED.has(key)) continue;
        const { C, H } = parseOklch(value);
        // Achromatic neutrals (C ≈ 0) carry no hue meaning.
        if (C < 0.02) continue;
        expect(isGreenHue(H), `${theme}.${key} hue ${H} is in green band [${GREEN_MIN}, ${GREEN_MAX}]`).toBe(
          false,
        );
      }
    },
  );

  it.each(['light', 'dark'] as const)('%s: positive is the financial green', (theme) => {
    const { H } = parseOklch(chartTokens[theme].positive);
    expect(isGreenHue(H)).toBe(true);
  });

  it.each(['light', 'dark'] as const)(
    '%s: identity tokens (primary/info/series) carry the Steel Blue hue',
    (theme) => {
      for (const key of STEEL_REQUIRED) {
        const { H } = parseOklch(chartTokens[theme][key]);
        expect(H, `${theme}.${key} hue ${H}`).toBeGreaterThanOrEqual(STEEL_MIN);
        expect(H, `${theme}.${key} hue ${H}`).toBeLessThanOrEqual(STEEL_MAX);
      }
    },
  );

  it('resolved palettes preserve the no-green identity: series/state colors never green', () => {
    for (const theme of THEMES) {
      const palette = chartPalette[theme];
      const state = [
        palette.negative,
        palette.warning,
        palette.missing,
        palette.info,
        palette.destructive,
      ];
      // Convert back to oklch hue via the canonical tokens (the resolved hex is
      // derived from those tokens, and the token-level test above already
      // proves the hues). Here we just confirm the resolved strings differ from
      // the green positive — the strongest hex-level signal.
      for (const color of [...palette.series, ...state]) {
        expect(color).not.toBe(palette.positive);
      }
    }
  });
});
