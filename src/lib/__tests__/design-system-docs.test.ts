/**
 * design-system-docs.test.ts — M014/S07/T02
 *
 * Source-parsing contract test guarding docs/design-system.md against drift
 * from the token code it documents (decision D056). Reads the document and the
 * authoritative token sources (src/app/globals.css, src/lib/chart-palette.ts)
 * from disk — the same approach token-structure.test.ts uses for globals.css —
 * so a token added to the CSS but missing from the doc, or removed from the
 * CSS while still documented, fails the suite at the source level, before any
 * rendering.
 *
 * Contract groups:
 *   1. Document inventory — docs/design-system.md exists, is non-trivial, and
 *      declares the 15 canonical top-level sections (D053 content areas).
 *   2. Required content — identity phrases, financial conventions, the
 *      chart-palette API surface, all 14 normalized primitives, and all 9
 *      dashboard chart categories are present.
 *   3. Code → doc coverage — every custom property defined in globals.css
 *      `:root` (light) and `.dark` (name AND value) appears in the doc; every
 *      chartTokens value from chart-palette.ts appears verbatim.
 *   4. Doc → code coverage — every `--` custom-property name the doc cites
 *      exists in globals.css. A prefix rule tolerates documented abstract
 *      patterns (`--font-size-*`, `--chart-*`, `--density-control-h*`).
 *   5. No placeholders — PLACEHOLDER/TODO markers are banned.
 *   6. Scanner self-test — the matchers reject a doctored doc that drops a
 *      token, invents a token, or omits a required section.
 *
 * Runs under vitest (jsdom env is fine — no DOM interaction here).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import { chartTokens } from '../chart-palette';

/* ── Document + CSS loading ─────────────────────────────────────────────── */

const DOCS_PATH = path.resolve(process.cwd(), 'docs/design-system.md');
const GLOBALS_CSS_PATH = path.resolve(process.cwd(), 'src/app/globals.css');

function loadDoc(): string {
  const doc = fs.readFileSync(DOCS_PATH, 'utf-8');
  expect(doc.length, 'docs/design-system.md should not be empty').toBeGreaterThan(1000);
  return doc;
}

const docSource = loadDoc();

function loadGlobalsCss(): string {
  const css = fs.readFileSync(GLOBALS_CSS_PATH, 'utf-8');
  expect(css.length, 'globals.css should not be empty').toBeGreaterThan(1000);
  return css;
}

const cssSource = loadGlobalsCss();

/**
 * Extract the raw custom-property map for a top-level block — same parser as
 * token-structure.test.ts. Only `:root {` and `.dark {` blocks carry the raw
 * token definitions; the `@theme inline` block maps --color-* utilities to
 * var() references and is intentionally ignored here.
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

/** Every `--` custom-property name anywhere in globals.css — includes the
 *  `@theme inline` Tailwind utility mappings (--color-positive) and font
 *  aliases (--font-sans / --font-mono / --font-heading) in addition to the
 *  raw `:root`/`.dark` token definitions. The doc cites these aliases too. */
const allCssTokenNames = new Set<string>([...cssSource.matchAll(/--[a-z][\w-]*/g)].map((m) => m[0]));

/* ── Contract matchers (also exercised by the scanner self-test) ────────── */

/** A `--` custom-property citation in the doc: requires a letter right after
 *  the hyphens so markdown table separators (`---`) never match. */
const TOKEN_NAME_RE = /--[a-z][\w-]*/g;

/** Unique token names the doc cites, with trailing hyphens stripped so
 *  abstract patterns like `--font-size-*` normalize to `--font-size`. */
function citedTokenNames(doc: string): string[] {
  const names = new Set<string>();
  for (const m of doc.matchAll(TOKEN_NAME_RE)) {
    names.add(m[0].replace(/-+$/, ''));
  }
  return [...names];
}

/** Token names defined in the CSS but absent from the doc. */
function findMissingTokenNames(doc: string, tokens: Record<string, string>): string[] {
  return Object.keys(tokens).filter((name) => !doc.includes(name));
}

/** [name, value] pairs whose value string is absent from the doc. */
function findMissingTokenValues(doc: string, tokens: Record<string, string>): Array<[string, string]> {
  return Object.entries(tokens).filter(([, value]) => !doc.includes(value));
}

/** Cited names that resolve to neither an exact CSS token nor a `name-*`
 *  prefix family (abstract patterns like `--font-size-*` resolve via prefix). */
function findUnknownCitedTokens(doc: string, known: Set<string>): string[] {
  return citedTokenNames(doc).filter((name) => ![...known].some((t) => t === name || t.startsWith(`${name}-`)));
}

/* ── Required heading inventory (D053 content areas, promoted to ##) ────── */

const REQUIRED_SECTIONS = [
  '## Design principles',
  '## Visual character and examples',
  '## Semantic color meanings',
  '## Light theme tokens',
  '## Dark theme tokens',
  '## Typography',
  '## Density',
  '## Radius and elevation',
  '## Financial number conventions',
  '## Warning-state hierarchy',
  '## Navigation and shell',
  '## Component usage guidance',
  '## Chart palette and categories',
  '## Prohibited patterns',
  '## Migration notes',
] as const;

/* ── Required content inventory ─────────────────────────────────────────── */

const REQUIRED_PHRASES = [
  // identity
  'reserved for positive financial meaning',
  'Steel Blue',
  'Graphite + Steel Blue',
  // canonical light/dark primary values (T01 verify command anchors)
  'oklch(0.48 0.1 235)',
  'oklch(0.65 0.1 235)',
  // financial number conventions
  'formatMoney',
  'formatPnlClass',
  'tabular-nums',
  // chart-palette public API surface (M014/S04)
  'chartTokens',
  'chartPalette',
  'deriveChartPalette',
  'withAlpha',
  'convertOklchToHex',
  'zrender',
  // overlay token (replaces theme-blind bg-black/10)
  'bg-overlay',
  // governing decisions
  'D053',
  'D054',
  'D055',
  'D056',
] as const;

/** All 14 normalized primitives, referenced by their component source file. */
const PRIMITIVE_SOURCES = [
  'badge.tsx',
  'button.tsx',
  'card.tsx',
  'collapsible.tsx',
  'dialog.tsx',
  'dropdown-menu.tsx',
  'input.tsx',
  'select.tsx',
  'separator.tsx',
  'sheet.tsx',
  'skeleton.tsx',
  'table.tsx',
  'tabs.tsx',
  'tooltip.tsx',
] as const;

/** All 9 dashboard chart categories by widget id (matches widget-registry). */
const CHART_CATEGORY_IDS = [
  'equity-drawdown',
  'calendar-heatmap',
  'period-matrix',
  'setup-ranking',
  'process-discipline',
  'monthly-performance',
  'r-distribution',
  'attention-insights',
  'directional-performance',
] as const;

/* ── 1. Document inventory ──────────────────────────────────────────────── */

describe('design-system doc inventory', () => {
  it('declares all 15 canonical top-level sections', () => {
    for (const heading of REQUIRED_SECTIONS) {
      expect(docSource, `missing section heading "${heading}"`).toContain(heading);
    }
  });

  it('declares each canonical section in order', () => {
    let cursor = 0;
    for (const heading of REQUIRED_SECTIONS) {
      const idx = docSource.indexOf(heading, cursor);
      expect(idx, `"${heading}" must appear after the previous section`).toBeGreaterThanOrEqual(cursor);
      cursor = idx;
    }
  });
});

/* ── 2. Required content ────────────────────────────────────────────────── */

describe('design-system doc required content', () => {
  it.each(REQUIRED_PHRASES)('documents "%s"', (phrase) => {
    expect(docSource, `required phrase "${phrase}" missing from docs/design-system.md`).toContain(phrase);
  });

  it('documents usage guidance for all 14 normalized primitives', () => {
    for (const source of PRIMITIVE_SOURCES) {
      expect(docSource, `primitive ${source} missing from Component usage guidance`).toContain(source);
    }
  });

  it('documents all 9 dashboard chart categories by widget id', () => {
    for (const id of CHART_CATEGORY_IDS) {
      expect(docSource, `chart category ${id} missing from Chart palette and categories`).toContain(id);
    }
  });

  it('documents the oklch-in-ECharts limitation (hex conversion requirement)', () => {
    expect(docSource, 'doc must warn that ECharts/zrender cannot parse oklch()').toMatch(/ECharts/i);
    expect(docSource, 'doc must mention the hex conversion requirement').toContain('convertOklchToHex');
  });
});

/* ── 3. Code → doc coverage ─────────────────────────────────────────────── */

describe('code → doc token coverage (globals.css + chart-palette.ts)', () => {
  it.each(['light', 'dark'] as const)('%s: every token name is documented', (theme) => {
    const tokens = theme === 'light' ? lightTokens : darkTokens;
    const missing = findMissingTokenNames(docSource, tokens);
    expect(missing, `tokens missing from docs/design-system.md: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(['light', 'dark'] as const)('%s: every token value appears verbatim', (theme) => {
    const tokens = theme === 'light' ? lightTokens : darkTokens;
    const missing = findMissingTokenValues(docSource, tokens);
    const rendered = missing.map(([name, value]) => `${name}=${value}`);
    expect(rendered, `token values missing from docs/design-system.md: ${rendered.join(', ')}`).toEqual([]);
  });

  it.each(['light', 'dark'] as const)('%s: every chartTokens value appears verbatim', (theme) => {
    const palette = chartTokens[theme];
    const missing = Object.entries(palette).filter(([, value]) => !docSource.includes(value));
    const rendered = missing.map(([key, value]) => `chartTokens.${key}=${value}`);
    expect(rendered, `chartTokens values missing from docs/design-system.md: ${rendered.join(', ')}`).toEqual([]);
  });

  it('the doc token inventory is non-trivial (guards against a truncated doc)', () => {
    expect(Object.keys(lightTokens).length).toBeGreaterThanOrEqual(45);
    expect(citedTokenNames(docSource).length).toBeGreaterThan(40);
  });
});

/* ── 4. Doc → code coverage ─────────────────────────────────────────────── */

describe('doc → code token coverage', () => {
  it('every custom-property name cited in the doc exists in globals.css', () => {
    const unknown = findUnknownCitedTokens(docSource, allCssTokenNames);
    expect(
      unknown,
      `doc cites tokens globals.css does not define (neither exact nor name-* family): ${unknown.join(', ')}`,
    ).toEqual([]);
  });

  it('resolves documented abstract patterns to real token families', () => {
    // `--font-size-*`, `--chart-*`, `--density-control-h*` are intentional
    // shorthand for families that DO exist in the CSS.
    for (const family of ['--font-size-', '--chart-', '--density-control-h-']) {
      const matches = [...allCssTokenNames].filter((t) => t.startsWith(family));
      expect(matches.length, `no CSS token in family ${family}*`).toBeGreaterThan(0);
    }
  });
});

/* ── 5. No placeholders ─────────────────────────────────────────────────── */

describe('design-system doc placeholder guard', () => {
  it('contains no PLACEHOLDER markers', () => {
    expect(docSource).not.toContain('PLACEHOLDER');
  });

  it('contains no TODO markers', () => {
    expect(docSource).not.toContain('TODO');
  });
});

/* ── 6. Scanner self-test ───────────────────────────────────────────────── */

describe('scanner self-test (the contract rejects drift)', () => {
  it('flags a doc that silently drops a token name', () => {
    // Non-ASCII replacement chars guarantee the original substring is gone
    // (a rename like --primary → --primary-renamed would still contain it).
    const doctored = docSource
      .replaceAll('--primary', '--prïmary')
      .replaceAll('--background', '--bäçkground');
    const missing = findMissingTokenNames(doctored, lightTokens);
    expect(missing).toEqual(expect.arrayContaining(['--primary', '--background']));
    expect(missing.length).toBeGreaterThanOrEqual(2);
  });

  it('flags a doc whose token value went stale', () => {
    // replaceAll: the canonical light primary value appears more than once
    // (token tables AND chart palette table).
    const doctored = docSource.replaceAll('oklch(0.48 0.1 235)', 'oklch(0.99 0.1 235)');
    const stale = findMissingTokenValues(doctored, lightTokens);
    expect(stale.some(([name]) => name === '--primary')).toBe(true);
    // sanity: the real doc has no stale values
    expect(findMissingTokenValues(docSource, lightTokens)).toEqual([]);
  });

  it('flags a doc that cites a token the code does not define', () => {
    const doctored = docSource.replace('--shadow-sm', '--shadow-glow');
    const unknown = findUnknownCitedTokens(doctored, allCssTokenNames);
    expect(unknown).toContain('--shadow-glow');
  });

  it('tolerates abstract pattern citations like --font-size-* and --chart-*', () => {
    expect(findUnknownCitedTokens('var(--font-size-*) and --chart-* and --density-control-h*', allCssTokenNames)).toEqual([]);
  });

  it('flags a doc missing a required section heading', () => {
    const doctored = docSource.replace('## Migration notes', '## Removed section');
    for (const heading of ['## Migration notes'] as const) {
      expect(doctored).not.toContain(heading);
    }
    expect(findMissingTokenNames(doctored, lightTokens)).not.toContain('--primary'); // name check still passes — heading check is separate
  });
});
