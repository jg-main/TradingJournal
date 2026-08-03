/**
 * chart-palette-migration.test.ts — M014/S04/T04
 *
 * Source-parsing contract test enforcing the S04 chart-palette migration for
 * all 9 dashboard chart widgets. Reads the widget .tsx sources from disk (the
 * same approach token-structure.test.ts uses to guard globals.css) so a
 * regression that reintroduces hardcoded chart colors fails at the source
 * level, before any rendering.
 *
 * Contract groups:
 *   1. Inventory — the 9 expected chart widget files exist; the 5 migrated
 *      widgets (T01–T03: equity-drawdown, monthly-performance, r-distribution,
 *      calendar-heatmap, process-discipline) import ChartPalette +
 *      useChartPalette from the canonical modules and actually invoke the
 *      hook. The 4 token-clean widgets (period-matrix, setup-ranking,
 *      attention-insights, directional-performance) are table/report surfaces
 *      with zero chart colors; a palette import there would be dead code, so
 *      their contract is group 4 (color-free).
 *   2. No arbitrary color literals — no 6-digit (#rrggbb), 8-digit
 *      (#rrggbbaa), or 3-digit (#rgb) hex, no rgb()/rgba() — rgba() is
 *      allowed only when the containing line references var( or palette
 *      (palette-driven translucency) — and no oklch() (oklch syntax lives in
 *      chart-palette.ts, which emits ECharts-consumable hex).
 *   3. chartPalette usage — each migrated widget references the palette
 *      members its design requires (series/positive/negative/primary/grid/
 *      axis/heatmap/missing), and every required member is validated against
 *      the real ChartPalette keys so a typo in this contract map itself fails.
 *   4. Token-clean widgets — the 4 remaining widgets contain no chart
 *      color literals at all (stricter than group 2: no rgba() exception).
 *      Tailwind utility class names (text-zinc-300, text-red-400, ...) are
 *      class names, not color literals — covered by the scanner self-test.
 *
 * Runs under vitest (jsdom env is fine — no DOM interaction here).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import { chartPalette } from '@/lib/chart-palette';

/* ── Widget inventory ──────────────────────────────────────────────────── */

const DASHBOARD_DIR = path.resolve(process.cwd(), 'src/components/dashboard');

/** All 9 dashboard chart widgets under contract (S04 goal + demo list). */
const ALL_WIDGETS = [
  'equity-drawdown-chart.tsx',
  'monthly-performance-chart.tsx',
  'r-distribution-chart.tsx',
  'calendar-heatmap-widget.tsx',
  'process-discipline-widget.tsx',
  'period-matrix-widget.tsx',
  'setup-ranking-widget.tsx',
  'attention-insights-widget.tsx',
  'directional-performance-widget.tsx',
] as const;

/** Widgets migrated onto the theme-aware chartPalette (T01–T03). */
const MIGRATED_WIDGETS = [
  'equity-drawdown-chart.tsx',
  'monthly-performance-chart.tsx',
  'r-distribution-chart.tsx',
  'calendar-heatmap-widget.tsx',
  'process-discipline-widget.tsx',
] as const;

/** Widgets that are token-clean by construction (table/report surfaces, T03). */
const TOKEN_CLEAN_WIDGETS = [
  'period-matrix-widget.tsx',
  'setup-ranking-widget.tsx',
  'attention-insights-widget.tsx',
  'directional-performance-widget.tsx',
] as const;

function readWidgetSource(file: string): string {
  const fullPath = path.join(DASHBOARD_DIR, file);
  expect(fs.existsSync(fullPath), `expected widget file to exist: ${file}`).toBe(true);
  return fs.readFileSync(fullPath, 'utf-8');
}

/* ── Color literal scanner ─────────────────────────────────────────────── */

interface ColorLiteralHit {
  line: number;
  literal: string;
}

/**
 * Scan source for arbitrary color literals.
 *
 * Flags: 6-digit hex (#rrggbb), 8-digit hex (#rrggbbaa), 3-digit hex (#rgb),
 * rgb()/rgba(), and oklch(). With `allowPaletteDrivenRgba`, an rgba()/rgb()
 * occurrence is tolerated when its line also references `var(` or `palette`
 * — i.e. the translucency value is derived from a token, not invented inline.
 * (The recommended path is withAlpha(palette.x, a), which emits no rgba() in
 * widget source at all; the exception exists for legitimate token-derived
 * variants.)
 */
function findColorLiterals(
  source: string,
  options: { allowPaletteDrivenRgba: boolean },
): ColorLiteralHit[] {
  const hits: ColorLiteralHit[] = [];
  const hex6 = /#[0-9a-fA-F]{6}(?![0-9a-fA-F])/g;
  const hex8 = /#[0-9a-fA-F]{8}(?![0-9a-fA-F])/g;
  const hex3 = /#[0-9a-fA-F]{3}(?![0-9a-fA-F])/g;
  const rgba = /\brgba?\(/g;
  const oklch = /\boklch\(/g;

  for (const [index, line] of source.split('\n').entries()) {
    const lineno = index + 1;
    const hexHits = [
      ...(line.match(hex6) ?? []),
      ...(line.match(hex8) ?? []),
      ...(line.match(hex3) ?? []),
    ];
    const rgbaHits = line.match(rgba) ?? [];
    const tokenDriven = line.includes('var(') || line.includes('palette');
    const forbiddenRgba = options.allowPaletteDrivenRgba && tokenDriven ? [] : rgbaHits;
    const oklchHits = line.match(oklch) ?? [];
    for (const literal of [...hexHits, ...forbiddenRgba, ...oklchHits]) {
      hits.push({ line: lineno, literal });
    }
  }
  return hits;
}

/* ── Group 1: inventory ────────────────────────────────────────────────── */

describe('S04 chart-palette migration contract', () => {
  describe('group 1: inventory — 9 dashboard chart widgets', () => {
    it('all 9 expected chart widget files exist', () => {
      for (const file of ALL_WIDGETS) {
        expect(fs.existsSync(path.join(DASHBOARD_DIR, file)), `missing widget: ${file}`).toBe(true);
      }
    });

    it('the 5 migrated widgets import ChartPalette + useChartPalette from the canonical modules and invoke the hook', () => {
      for (const file of MIGRATED_WIDGETS) {
        const src = readWidgetSource(file);
        expect(src, `${file}: missing import from @/lib/chart-palette`).toMatch(
          /from\s+['"]@\/lib\/chart-palette['"]/,
        );
        expect(src, `${file}: missing import from @/hooks/use-chart-palette`).toMatch(
          /from\s+['"]@\/hooks\/use-chart-palette['"]/,
        );
        expect(src, `${file}: useChartPalette imported but never invoked`).toContain(
          'useChartPalette()',
        );
      }
    });

    it('the 4 token-clean widgets exist and are not forced to import the palette', () => {
      // T03 verified these widgets need zero code change: they have no chart
      // colors to serve. A palette import here would be dead code — group 4
      // enforces their color-freedom instead, which is the real regression risk.
      for (const file of TOKEN_CLEAN_WIDGETS) {
        expect(fs.existsSync(path.join(DASHBOARD_DIR, file)), `missing widget: ${file}`).toBe(true);
      }
    });
  });

  /* ── Group 2: no arbitrary color literals ─────────────────────────────── */

  describe('group 2: no arbitrary color literals in chart widget sources', () => {
    it.each(ALL_WIDGETS)(
      '%s contains no hardcoded hex (#rrggbb / #rrggbbaa / #rgb) or rgb()/rgba() chart literals',
      (file) => {
        const hits = findColorLiterals(readWidgetSource(file), {
          allowPaletteDrivenRgba: true,
        });
        expect(hits).toEqual([]);
      },
    );

    it.each(ALL_WIDGETS)(
      '%s contains no oklch() literals (oklch syntax lives in chart-palette.ts only)',
      (file) => {
        expect(readWidgetSource(file)).not.toMatch(/\boklch\(/);
      },
    );
  });

  /* ── Group 3: palette usage per migrated widget ───────────────────────── */

  describe('group 3: migrated widgets consume the theme-aware palette', () => {
    /** Required palette members per migrated widget (mirrors the S04 design). */
    const PALETTE_USAGE: ReadonlyArray<{ file: string; members: readonly string[] }> = [
      { file: 'equity-drawdown-chart.tsx', members: ['primary', 'positive', 'negative', 'grid', 'axis'] },
      { file: 'monthly-performance-chart.tsx', members: ['primary', 'positive', 'negative', 'grid', 'axis'] },
      { file: 'r-distribution-chart.tsx', members: ['positive', 'negative', 'missing', 'grid', 'axis'] },
      { file: 'calendar-heatmap-widget.tsx', members: ['heatmap', 'grid', 'axis'] },
      { file: 'process-discipline-widget.tsx', members: ['series', 'negative', 'missing', 'grid', 'axis'] },
    ];

    it('required palette members are real ChartPalette keys', () => {
      const keys = new Set(Object.keys(chartPalette.light));
      for (const { members } of PALETTE_USAGE) {
        for (const member of members) {
          expect(keys.has(member), `"${member}" is not a ChartPalette key`).toBe(true);
        }
      }
    });

    it.each(PALETTE_USAGE)('$file references its required palette members', ({ file, members }) => {
      const src = readWidgetSource(file);
      for (const member of members) {
        expect(src, `${file}: missing palette.${member} reference`).toContain(`palette.${member}`);
      }
    });
  });

  /* ── Group 4: token-clean widgets stay color-free ─────────────────────── */

  describe('group 4: the 4 token-clean widgets stay color-free', () => {
    it.each(TOKEN_CLEAN_WIDGETS)(
      '%s contains no chart color literals (hex, rgb(), rgba(), oklch())',
      (file) => {
        const hits = findColorLiterals(readWidgetSource(file), {
          allowPaletteDrivenRgba: false,
        });
        expect(hits).toEqual([]);
      },
    );
  });

  /* ── Scanner self-test: the contract rejects hardcoded colors ─────────── */

  describe('scanner self-test (the contract rejects hardcoded chart colors)', () => {
    const forbiddenSample = [
      'color: "#2563eb",',
      'color: "#0af",',
      'color: "#11223344",',
      'fill: "rgba(37, 99, 235, 0.25)",',
      'axisLine: { color: "rgb(100, 100, 100)" },',
      'ramp: oklch(0.5 0.1 235),',
    ].join('\n');

    it('flags every forbidden literal shape (6-hex, 3-hex, 8-hex, rgba, rgb, oklch)', () => {
      const hits = findColorLiterals(forbiddenSample, { allowPaletteDrivenRgba: true });
      expect(hits.length).toBe(6);
      expect(hits.map((h) => h.literal)).toEqual(
        expect.arrayContaining(['#2563eb', '#0af', '#11223344', 'rgba(', 'rgb(', 'oklch(']),
      );
    });

    it('allows palette-/var-driven rgba() lines in migrated widgets, but not in token-clean widgets', () => {
      const src = 'colorStops: [{ offset: 0, color: rgba(palette.primary, 0.25) }],';
      expect(findColorLiterals(src, { allowPaletteDrivenRgba: true })).toEqual([]);
      expect(findColorLiterals(src, { allowPaletteDrivenRgba: false }).length).toBe(1);
    });

    it('does not flag Tailwind utility class names (out of scope — S05 territory)', () => {
      const src = 'className={cn("text-zinc-300 text-red-400 bg-blue-50 border-blue-500")}';
      expect(findColorLiterals(src, { allowPaletteDrivenRgba: false })).toEqual([]);
    });
  });
});
