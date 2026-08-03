/**
 * token-structure.test.ts — M014/S01/T04
 *
 * Structural verification of the Graphite + Steel Blue semantic token system
 * in src/app/globals.css, plus its contract with the chart palette module:
 *   1. Completeness — theme-dependent token groups (surfaces, text, financial
 *      state (--positive/--negative/--warning/--missing/--info/--destructive),
 *      structure, interaction, charts, sidebar, elevation) are defined in BOTH
 *      :root (light) and .dark; theme-independent tokens (radius, typography,
 *      density) are defined once in :root and inherited by .dark.
 *   2. Format — every color token is a well-formed oklch(L C H) string.
 *   3. No-green identity — green hue (oklch 127–165°) appears ONLY in
 *      --positive (financial profit). Identity/series/state tokens keep the
 *      Steel Blue (hue ~235) / graphite / amber / red families.
 *   4. Steel Blue identity — --primary/--ring/--sidebar-primary/--chart-1/
 *      --info sit in the steel band (200–260°).
 *   5. Mirror contract — chart-palette.ts chartTokens must stay bit-for-bit
 *      in sync with globals.css (module = single source of truth for S04).
 *   6. Scale sanity — typography and density scales are strictly monotonic.
 *
 * Reading globals.css from disk is intentional: this test guards the CSS file
 * itself, not a compiled copy. Runs under vitest (jsdom env is fine — no DOM
 * interaction here).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import { chartTokens } from '../chart-palette';

/* ── CSS loading + parsing ──────────────────────────────────────────────── */

const GLOBALS_CSS_PATH = path.resolve(process.cwd(), 'src/app/globals.css');

function loadGlobalsCss(): string {
  const css = fs.readFileSync(GLOBALS_CSS_PATH, 'utf-8');
  expect(css.length, 'globals.css should not be empty').toBeGreaterThan(1000);
  return css;
}

const cssSource = loadGlobalsCss();

/**
 * Extract the raw custom-property map for a top-level block.
 * Only `:root {` and `.dark {` blocks carry the raw token definitions; the
 * `@theme inline` block maps --color-* utilities to var() references and is
 * intentionally ignored here.
 */
function extractTokens(css: string, selector: ':root' | '.dark'): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `globals.css must contain a "${selector} {" block`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end, `"${selector}" block must close with "}" on its own line`).toBeGreaterThan(start);
  const block = css.slice(start, end);

  const tokens: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^\s*(--[\w-]+):\s*([^;]+);/.exec(line);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

const lightTokens = extractTokens(cssSource, ':root');
const darkTokens = extractTokens(cssSource, '.dark');

/* ── Shared helpers ─────────────────────────────────────────────────────── */

interface OklchComponents {
  L: number;
  C: number;
  H: number;
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i;

function parseOklch(color: string): OklchComponents {
  const m = OKLCH_RE.exec(color.trim());
  if (!m) throw new Error(`Expected oklch(L C H), got "${color}"`);
  return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

function isOklch(color: string): boolean {
  return OKLCH_RE.test(color.trim());
}

/** Green hue band (oklch degrees) — matches the T03 proof-surface audit. */
const GREEN_MIN = 127;
const GREEN_MAX = 165;
/** Steel Blue identity hue band — matches the T03 proof-surface audit. */
const STEEL_MIN = 200;
const STEEL_MAX = 260;

function isGreenHue(h: number): boolean {
  return h >= GREEN_MIN && h <= GREEN_MAX;
}

/** Normalize internal whitespace so CSS and module strings compare exactly. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/* ── Required token inventory ───────────────────────────────────────────── */

const REQUIRED_TOKENS = {
  surfaces: ['--background', '--card', '--popover', '--muted', '--secondary', '--sidebar', '--sidebar-accent'],
  text: [
    '--foreground',
    '--card-foreground',
    '--popover-foreground',
    '--muted-foreground',
    '--secondary-foreground',
    '--accent-foreground',
    '--primary-foreground',
    '--sidebar-foreground',
    '--sidebar-accent-foreground',
  ],
  financial: ['--positive', '--negative', '--warning', '--missing', '--info', '--destructive'],
  structure: ['--border', '--input', '--separator'],
  interaction: ['--primary', '--accent', '--ring'],
  charts: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-grid', '--chart-axis', '--chart-reference'],
  sidebar: ['--sidebar-primary', '--sidebar-primary-foreground', '--sidebar-border', '--sidebar-ring'],
  elevation: ['--shadow-sm', '--shadow-md', '--shadow-lg'],
} as const;

/**
 * Theme-independent tokens: defined once in `:root` and inherited by `.dark`
 * through CSS custom-property inheritance (radius, typography, density).
 */
const THEME_INDEPENDENT_TOKENS = {
  structure: ['--radius'],
  typography: ['--font-size-xs', '--font-size-sm', '--font-size-md', '--font-size-base', '--font-size-lg', '--font-size-xl', '--font-size-2xl', '--font-size-3xl'],
  density: ['--density-control-h-sm', '--density-control-h', '--density-row-sm', '--density-row-md', '--density-space-1', '--density-space-2', '--density-space-3', '--density-space-4', '--density-space-5', '--density-space-6'],
} as const;

const COLOR_TOKENS = [
  ...REQUIRED_TOKENS.surfaces,
  ...REQUIRED_TOKENS.text,
  ...REQUIRED_TOKENS.financial,
  ...REQUIRED_TOKENS.structure,
  ...REQUIRED_TOKENS.interaction,
  ...REQUIRED_TOKENS.charts,
  ...REQUIRED_TOKENS.sidebar,
];

/* ── Completeness ───────────────────────────────────────────────────────── */

describe('globals.css token completeness', () => {
  it('defines every theme-dependent token in BOTH :root (light) and .dark', () => {
    for (const [group, names] of Object.entries(REQUIRED_TOKENS)) {
      for (const name of names) {
        expect(lightTokens, `light:${group}:${name}`).toHaveProperty(name);
        expect(darkTokens, `dark:${group}:${name}`).toHaveProperty(name);
      }
    }
  });

  it('defines theme-independent tokens (radius, typography, density) once in :root', () => {
    for (const [group, names] of Object.entries(THEME_INDEPENDENT_TOKENS)) {
      for (const name of names) {
        expect(lightTokens, `light:${group}:${name}`).toHaveProperty(name);
        // Theme-independent by design: .dark inherits via custom-property
        // inheritance and must NOT redefine them.
        expect(darkTokens, `dark should not redefine ${group}:${name}`).not.toHaveProperty(name);
      }
    }
  });

  it('declares all token groups in the documented @theme inline mapping', () => {
    // Tailwind utilities for the financial tokens must exist so components can
    // use text-positive / bg-negative / border-warning etc.
    for (const util of ['--color-positive', '--color-negative', '--color-warning', '--color-missing', '--color-info', '--color-separator']) {
      expect(cssSource, util).toContain(`${util}: var(`);
    }
  });
});

/* ── Format: every color token is valid oklch ───────────────────────────── */

describe('globals.css color token format', () => {
  it.each(['light', 'dark'] as const)('%s: every color token is well-formed oklch', (theme) => {
    const tokens = theme === 'light' ? lightTokens : darkTokens;
    for (const name of COLOR_TOKENS) {
      const value = tokens[name];
      expect(value, `${theme}:${name} missing`).toBeTruthy();
      expect(isOklch(value), `${theme}:${name} = "${value}" is not oklch(L C H)`).toBe(true);
      const { L, C, H } = parseOklch(value);
      expect(Number.isFinite(L) && Number.isFinite(C) && Number.isFinite(H), `${theme}:${name}`).toBe(true);
      expect(L).toBeGreaterThanOrEqual(0);
      expect(L).toBeLessThanOrEqual(1);
    }
  });
});

/* ── No-green identity constraint (green reserved for --positive) ───────── */

describe('no-green identity constraint (green reserved for --positive)', () => {
  it.each(['light', 'dark'] as const)(
    '%s: every non-positive color token stays out of the green hue band',
    (theme) => {
      const tokens = theme === 'light' ? lightTokens : darkTokens;
      for (const name of COLOR_TOKENS) {
        if (name === '--positive') continue;
        const value = tokens[name];
        if (!isOklch(value)) continue; // non-oklch tokens are covered elsewhere
        const { C, H } = parseOklch(value);
        // Achromatic neutrals (C ≈ 0) carry no hue meaning.
        if (C < 0.02) continue;
        expect(
          isGreenHue(H),
          `${theme}:${name} = "${value}" hue ${H.toFixed(1)} is in green band [${GREEN_MIN}, ${GREEN_MAX}]`,
        ).toBe(false);
      }
    },
  );

  it.each(['light', 'dark'] as const)('%s: --positive is the financial green', (theme) => {
    const tokens = theme === 'light' ? lightTokens : darkTokens;
    const { H } = parseOklch(tokens['--positive']);
    expect(isGreenHue(H), `${theme}:--positive hue ${H.toFixed(1)}`).toBe(true);
  });

  it.each(['light', 'dark'] as const)(
    '%s: identity tokens carry the Steel Blue hue (200–260°)',
    (theme) => {
      const tokens = theme === 'light' ? lightTokens : darkTokens;
      for (const name of ['--primary', '--ring', '--sidebar-primary', '--chart-1', '--info']) {
        const { H } = parseOklch(tokens[name]);
        expect(H, `${theme}:${name} hue ${H.toFixed(1)}`).toBeGreaterThanOrEqual(STEEL_MIN);
        expect(H, `${theme}:${name} hue ${H.toFixed(1)}`).toBeLessThanOrEqual(STEEL_MAX);
      }
    },
  );

  it('light and dark --positive both carry the same green hue family (~152°)', () => {
    const lightHue = parseOklch(lightTokens['--positive']).H;
    const darkHue = parseOklch(darkTokens['--positive']).H;
    expect(lightHue).toBeCloseTo(152, 0);
    expect(darkHue).toBeCloseTo(152, 0);
  });
});

/* ── Financial state completeness (both themes, actual colors) ──────────── */

describe('financial state tokens', () => {
  it.each(['light', 'dark'] as const)(
    '%s: all six financial tokens are defined with non-zero chroma',
    (theme) => {
      const tokens = theme === 'light' ? lightTokens : darkTokens;
      for (const name of ['--positive', '--negative', '--warning', '--missing', '--info', '--destructive']) {
        const { C } = parseOklch(tokens[name]);
        expect(C, `${theme}:${name} chroma ${C}`).toBeGreaterThan(0.02);
      }
    },
  );
});

/* ── Mirror contract: chartTokens ↔ globals.css ─────────────────────────── */

describe('chart-palette chartTokens mirror globals.css', () => {
  const MIRROR_MAP = {
    primary: '--primary',
    positive: '--positive',
    negative: '--negative',
    warning: '--warning',
    missing: '--missing',
    info: '--info',
    destructive: '--destructive',
    chart1: '--chart-1',
    chart2: '--chart-2',
    chart3: '--chart-3',
    chart4: '--chart-4',
    chart5: '--chart-5',
    grid: '--chart-grid',
    axis: '--chart-axis',
    reference: '--chart-reference',
  } as const;

  it.each(['light', 'dark'] as const)(
    '%s: every chartTokens value matches the CSS custom property',
    (theme) => {
      const cssTokens = theme === 'light' ? lightTokens : darkTokens;
      const moduleTokens = chartTokens[theme];
      for (const [moduleKey, cssName] of Object.entries(MIRROR_MAP)) {
        const moduleValue = normalize(moduleTokens[moduleKey as keyof typeof moduleTokens]);
        const cssValue = normalize(cssTokens[cssName]);
        expect(cssValue, `${theme}:${cssName} must be defined`).toBeTruthy();
        expect(
          moduleValue,
          `${theme}: chartTokens.${moduleKey} (${moduleValue}) ≠ ${cssName} (${cssValue})`,
        ).toBe(cssValue);
      }
    },
  );
});

/* ── Scale sanity: typography + density monotonicity ────────────────────── */

describe('typography and density scales', () => {
  const remToNumber = (value: string): number => {
    const m = /^([\d.]+)rem$/.exec(value.trim());
    if (!m) throw new Error(`Expected rem length, got "${value}"`);
    return Number(m[1]);
  };

  it('typography scale is strictly increasing', () => {
    const scale = ['--font-size-xs', '--font-size-sm', '--font-size-md', '--font-size-base', '--font-size-lg', '--font-size-xl', '--font-size-2xl', '--font-size-3xl'].map(
      (name) => remToNumber(lightTokens[name]),
    );
    for (let i = 1; i < scale.length; i++) {
      expect(scale[i], `step ${i}`).toBeGreaterThan(scale[i - 1]);
    }
  });

  it('density control heights are ordered (sm < default)', () => {
    const sm = remToNumber(lightTokens['--density-control-h-sm']);
    const standard = remToNumber(lightTokens['--density-control-h']);
    expect(sm).toBeLessThan(standard);
  });

  it('density row heights are ordered (sm < md)', () => {
    const sm = remToNumber(lightTokens['--density-row-sm']);
    const md = remToNumber(lightTokens['--density-row-md']);
    expect(sm).toBeLessThan(md);
  });

  it('density spacing scale is strictly increasing', () => {
    const scale = Array.from({ length: 6 }, (_, i) => remToNumber(lightTokens[`--density-space-${i + 1}`]));
    for (let i = 1; i < scale.length; i++) {
      expect(scale[i], `space-${i + 1}`).toBeGreaterThan(scale[i - 1]);
    }
  });
});

/* ── Regression guard: the legacy green-primary hue is gone ─────────────── */

describe('legacy green-primary regression guard', () => {
  it('globals.css no longer contains the pre-M014 green primary token', () => {
    // T01 removed the green-toned primary (oklch hue 130). Guard against
    // reintroduction — the string below is the exact pre-M014 value.
    expect(cssSource).not.toContain('oklch(0.55 0.14 130)');
  });

  it('no identity/interaction token resolves to a green primary hue', () => {
    for (const tokens of [lightTokens, darkTokens]) {
      for (const name of ['--primary', '--ring', '--accent', '--sidebar-primary', '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']) {
        const { C, H } = parseOklch(tokens[name]);
        if (C < 0.02) continue;
        expect(isGreenHue(H), `${name} hue ${H.toFixed(1)}`).toBe(false);
      }
    }
  });
});
