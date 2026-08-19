/**
 * design-system-docs.test.ts — M014/S07/T02, restructured in M025/S01/T02
 *
 * Source-parsing contract test guarding the docs/design-system/ directory
 * against drift from the token code it documents (decision D056; split into
 * concern files by D077; multi-file reading by D078). Reads the split files
 * and the authoritative token sources (src/app/globals.css,
 * src/lib/chart-palette.ts) from disk — the same approach
 * token-structure.test.ts uses for globals.css — so a token added to the CSS
 * but missing from the doc, or removed from the CSS while still documented,
 * fails the suite at the source level, before any rendering.
 *
 * File ownership (D077 concern split):
 *   - README.md: index, identity, semantic color meanings, navigation and
 *     shell, component usage guidance, prohibited patterns, migration notes.
 *   - tokens.md: light/dark token tables, typography, density, radius and
 *     elevation, financial number conventions, warning-state hierarchy — the
 *     token half of the coverage contract (all coverage checks read here).
 *   - charts.md: chart palette API and the dashboard widget registry — the
 *     chart half (API phrases, widget ids, ECharts constraint read here).
 *   - workstation.md: the full ws- pattern reference, guarded by its own
 *     contract test (workstation-docs.test.ts). This file still reads it for
 *     the directory-wide section inventory, doc→code citation, and
 *     placeholder checks; its --ws-* custom properties resolve against
 *     workstation.css rather than globals.css (M025/S02/T02).
 *   - trade-detail.md: the full td- pattern reference, guarded by its own
 *     contract test (trade-detail-docs.test.ts). This file still reads it for
 *     the directory-wide section inventory, doc→code citation, and
 *     placeholder checks; its --td-* custom properties resolve against
 *     trade-detail-grid.css rather than globals.css (M025/S03/T01).
 *
 * Contract groups:
 *   1. Document inventory — every file exists and is non-trivial; the 16
 *      canonical top-level sections (D053 content areas plus the D061
 *      dashboard workstation standard) are covered across the directory, each
 *      owned by the file where its concern lives, in canonical order.
 *   2. Required content — identity phrases and governing decisions
 *      (README.md), financial conventions and canonical primary values
 *      (tokens.md), the chart-palette API surface (charts.md), all 14
 *      normalized primitives (README.md), and all 11 registered widget ids
 *      (9 chart + 2 valuation, charts.md).
 *   3. Code → doc coverage — every custom property defined in globals.css
 *      `:root` (light) and `.dark` (name AND value) appears in tokens.md;
 *      every chartTokens value from chart-palette.ts appears verbatim in
 *      tokens.md.
 *   4. Doc → code coverage — every `--` custom-property name cited anywhere
 *      in the directory exists in globals.css, workstation.css, or
 *      trade-detail-grid.css. A prefix rule tolerates documented abstract
 *      patterns (`--font-size-*`, `--chart-*`, `--density-control-h*`).
 *   5. No placeholders — PLACEHOLDER/TODO markers are banned across the
 *      directory.
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

const DOCS_DIR = path.resolve(process.cwd(), 'docs/design-system');
const README_PATH = path.join(DOCS_DIR, 'README.md');
const TOKENS_PATH = path.join(DOCS_DIR, 'tokens.md');
const CHARTS_PATH = path.join(DOCS_DIR, 'charts.md');
const WORKSTATION_PATH = path.join(DOCS_DIR, 'workstation.md');
const TRADE_DETAIL_PATH = path.join(DOCS_DIR, 'trade-detail.md');
const GLOBALS_CSS_PATH = path.resolve(process.cwd(), 'src/app/globals.css');
const WORKSTATION_CSS_PATH = path.resolve(process.cwd(), 'src/app/(workstation)/workspace/workstation.css');
const TRADE_DETAIL_CSS_PATH = path.resolve(process.cwd(), 'src/components/trade-detail/trade-detail-grid.css');

function loadDoc(filePath: string, label: string): string {
  const doc = fs.readFileSync(filePath, 'utf-8');
  expect(doc.length, `${label} should not be empty`).toBeGreaterThan(1000);
  return doc;
}

const readmeSource = loadDoc(README_PATH, 'docs/design-system/README.md');
const tokensSource = loadDoc(TOKENS_PATH, 'docs/design-system/tokens.md');
const chartsSource = loadDoc(CHARTS_PATH, 'docs/design-system/charts.md');
const workstationSource = loadDoc(WORKSTATION_PATH, 'docs/design-system/workstation.md');
const tradeDetailSource = loadDoc(TRADE_DETAIL_PATH, 'docs/design-system/trade-detail.md');

/** Union of every file in the directory — used by directory-wide checks
 *  (section coverage, doc→code citations, placeholder guard, self-tests). */
const docSource = [readmeSource, tokensSource, chartsSource, workstationSource, tradeDetailSource].join('\n');

function loadGlobalsCss(): string {
  const css = fs.readFileSync(GLOBALS_CSS_PATH, 'utf-8');
  expect(css.length, 'globals.css should not be empty').toBeGreaterThan(1000);
  return css;
}

const cssSource = loadGlobalsCss();

/** workstation.css — owns the --ws-* density/spacing/type tokens the
 *  workstation.md reference cites. Loaded so those citations resolve here
 *  (the ws- contract itself is guarded by workstation-docs.test.ts). */
function loadWorkstationCss(): string {
  const css = fs.readFileSync(WORKSTATION_CSS_PATH, 'utf-8');
  expect(css.length, 'workstation.css should not be empty').toBeGreaterThan(1000);
  return css;
}

const workstationCssSource = loadWorkstationCss();

/** trade-detail-grid.css — owns the --td-* density/spacing/type tokens the
 *  trade-detail.md reference cites. Loaded so those citations resolve here
 *  (the td- contract itself is guarded by trade-detail-docs.test.ts). */
function loadTradeDetailCss(): string {
  const css = fs.readFileSync(TRADE_DETAIL_CSS_PATH, 'utf-8');
  expect(css.length, 'trade-detail-grid.css should not be empty').toBeGreaterThan(1000);
  return css;
}

const tradeDetailCssSource = loadTradeDetailCss();

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

/** Every `--ws-*` custom-property name anywhere in workstation.css — the
 *  `.ws` token definitions plus var() usages inside rules. These are owned
 *  by workstation.css, not globals.css (D077 concern split; M025/S02/T02). */
const allWsTokenNames = new Set<string>([...workstationCssSource.matchAll(/--ws-[a-z][\w-]*/g)].map((m) => m[0]));

/** Every `--td-*` custom-property name anywhere in trade-detail-grid.css —
 *  the `.td` token definitions plus var() usages inside rules. These are
 *  owned by trade-detail-grid.css, not globals.css (M025/S03/T01). */
const allTdTokenNames = new Set<string>([...tradeDetailCssSource.matchAll(/--td-[a-z][\w-]*/g)].map((m) => m[0]));

/** Known custom-property names across all three token sources. */
const allKnownTokenNames = new Set<string>([...allCssTokenNames, ...allWsTokenNames, ...allTdTokenNames]);

/* ── Contract matchers (also exercised by the scanner self-test) ────────── */

/** A `--` custom-property citation in the doc: requires a letter right after
 *  the hyphens so markdown table separators (`---`) never match. The negative
 *  lookbehind rejects BEM-style modifier class suffixes such as
 *  `.td-grid--planned` / `.td-grid--closed` — those `--` names are class
 *  fragments, not custom-property citations. */
const TOKEN_NAME_RE = /(?<![\w-])--[a-z][\w-]*/g;

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
  '## Dashboard workstation standard',
  '## Navigation and shell',
  '## Component usage guidance',
  '## Chart palette and categories',
  '## Prohibited patterns',
  '## Migration notes',
] as const;

/** Where each canonical section is owned after the D077 split. The union must
 *  cover all 16 REQUIRED_SECTIONS; each file must contain its own sections
 *  in canonical order. */
const SECTION_OWNERSHIP = [
  {
    file: 'README.md',
    source: readmeSource,
    sections: [
      '## Design principles',
      '## Visual character and examples',
      '## Semantic color meanings',
      '## Navigation and shell',
      '## Component usage guidance',
      '## Prohibited patterns',
      '## Migration notes',
    ],
  },
  {
    file: 'tokens.md',
    source: tokensSource,
    sections: [
      '## Light theme tokens',
      '## Dark theme tokens',
      '## Typography',
      '## Density',
      '## Radius and elevation',
      '## Financial number conventions',
      '## Warning-state hierarchy',
    ],
  },
  {
    file: 'charts.md',
    source: chartsSource,
    sections: ['## Chart palette and categories'],
  },
  {
    file: 'workstation.md',
    source: workstationSource,
    sections: ['## Dashboard workstation standard'],
  },
] as const;

/** Sections from `sections` that do not appear in `source`. */
function findMissingSections(source: string, sections: readonly string[]): string[] {
  return sections.filter((heading) => !source.includes(heading));
}

/* ── Required content inventory ─────────────────────────────────────────── */

/** Identity phrases, overlay token, and governing decisions — README.md. */
const README_REQUIRED_PHRASES = [
  // identity
  'reserved for positive financial meaning',
  'Steel Blue',
  'Graphite + Steel Blue',
  // overlay token (replaces theme-blind bg-black/10)
  'bg-overlay',
  // governing decisions
  'D053',
  'D054',
  'D055',
  'D056',
  'D061',
  // split-governing decisions (D077/D078)
  'D077',
  'D078',
] as const;

/** Financial conventions and canonical primary values — tokens.md. */
const TOKENS_REQUIRED_PHRASES = [
  // canonical light/dark primary values
  'oklch(0.48 0.1 235)',
  'oklch(0.65 0.1 235)',
  // financial number conventions
  'formatMoney',
  'formatPnlClass',
  'tabular-nums',
] as const;

/** Chart-palette public API surface (M014/S04) — charts.md. */
const CHARTS_REQUIRED_PHRASES = [
  'chartTokens',
  'chartPalette',
  'deriveChartPalette',
  'withAlpha',
  'convertOklchToHex',
  'zrender',
] as const;

/** All 14 normalized primitives, referenced by their component source file —
 *  Component usage guidance in README.md. */
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

/** All 9 chart widget ids (matches widget-registry) — charts.md. */
const CHART_WIDGET_IDS = [
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

/** The 2 valuation widgets added to the registry documentation — charts.md. */
const VALUATION_WIDGET_IDS = ['valuation-positions', 'open-positions-risk'] as const;

/* ── 1. Document inventory ──────────────────────────────────────────────── */

describe('design-system doc inventory', () => {
  it('declares all 16 canonical top-level sections across the directory', () => {
    const missing = findMissingSections(docSource, REQUIRED_SECTIONS);
    expect(missing, `sections missing from docs/design-system/: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(SECTION_OWNERSHIP)('$file owns its canonical sections in order', ({ file, source, sections }) => {
    for (const heading of sections) {
      expect(source, `missing section heading "${heading}" in ${file}`).toContain(heading);
    }
    let cursor = 0;
    for (const heading of sections) {
      const idx = source.indexOf(heading, cursor);
      expect(idx, `"${heading}" must appear after the previous section`).toBeGreaterThanOrEqual(cursor);
      cursor = idx;
    }
  });
});

/* ── 2. Required content ────────────────────────────────────────────────── */

describe('design-system doc required content', () => {
  it.each(README_REQUIRED_PHRASES)('README.md documents "%s"', (phrase) => {
    expect(readmeSource, `required phrase "${phrase}" missing from docs/design-system/README.md`).toContain(phrase);
  });

  it.each(TOKENS_REQUIRED_PHRASES)('tokens.md documents "%s"', (phrase) => {
    expect(tokensSource, `required phrase "${phrase}" missing from docs/design-system/tokens.md`).toContain(phrase);
  });

  it.each(CHARTS_REQUIRED_PHRASES)('charts.md documents "%s"', (phrase) => {
    expect(chartsSource, `required phrase "${phrase}" missing from docs/design-system/charts.md`).toContain(phrase);
  });

  it('documents usage guidance for all 14 normalized primitives', () => {
    for (const source of PRIMITIVE_SOURCES) {
      expect(readmeSource, `primitive ${source} missing from Component usage guidance`).toContain(source);
    }
  });

  it('documents all 9 dashboard chart widgets by widget id', () => {
    for (const id of CHART_WIDGET_IDS) {
      expect(chartsSource, `chart widget ${id} missing from the widget registry`).toContain(id);
    }
  });

  it('documents the 2 valuation widgets in the widget registry', () => {
    for (const id of VALUATION_WIDGET_IDS) {
      expect(chartsSource, `valuation widget ${id} missing from the widget registry`).toContain(id);
    }
  });

  it('documents the oklch-in-ECharts limitation (hex conversion requirement)', () => {
    expect(chartsSource, 'doc must warn that ECharts/zrender cannot parse oklch()').toMatch(/ECharts/i);
    expect(chartsSource, 'doc must mention the hex conversion requirement').toContain('convertOklchToHex');
  });
});

/* ── 3. Code → doc coverage ─────────────────────────────────────────────── */

describe('code → doc token coverage (globals.css + chart-palette.ts → tokens.md)', () => {
  it.each(['light', 'dark'] as const)('%s: every token name is documented', (theme) => {
    const tokens = theme === 'light' ? lightTokens : darkTokens;
    const missing = findMissingTokenNames(tokensSource, tokens);
    expect(missing, `tokens missing from docs/design-system/tokens.md: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(['light', 'dark'] as const)('%s: every token value appears verbatim', (theme) => {
    const tokens = theme === 'light' ? lightTokens : darkTokens;
    const missing = findMissingTokenValues(tokensSource, tokens);
    const rendered = missing.map(([name, value]) => `${name}=${value}`);
    expect(rendered, `token values missing from docs/design-system/tokens.md: ${rendered.join(', ')}`).toEqual([]);
  });

  it.each(['light', 'dark'] as const)('%s: every chartTokens value appears verbatim', (theme) => {
    const palette = chartTokens[theme];
    const missing = Object.entries(palette).filter(([, value]) => !tokensSource.includes(value));
    const rendered = missing.map(([key, value]) => `chartTokens.${key}=${value}`);
    expect(rendered, `chartTokens values missing from docs/design-system/tokens.md: ${rendered.join(', ')}`).toEqual([]);
  });

  it('the doc token inventory is non-trivial (guards against a truncated doc)', () => {
    expect(Object.keys(lightTokens).length).toBeGreaterThanOrEqual(45);
    expect(citedTokenNames(tokensSource).length).toBeGreaterThan(40);
  });
});

/* ── 4. Doc → code coverage ─────────────────────────────────────────────── */

describe('doc → code token coverage', () => {
  it('every custom-property name cited in the docs exists in a token source (globals.css, workstation.css, or trade-detail-grid.css)', () => {
    const unknown = findUnknownCitedTokens(docSource, allKnownTokenNames);
    expect(
      unknown,
      `docs cite tokens no token source defines (neither exact nor name-* family): ${unknown.join(', ')}`,
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

  it('ignores BEM-style modifier class suffixes (--planned/--closed are not token citations)', () => {
    // .td-grid--planned / .td-grid--closed appear in trade-detail.md; the
    // `--` there is a class-modifier separator, not a custom property.
    expect(findUnknownCitedTokens('.td-grid--planned and .td-grid--closed', allCssTokenNames)).toEqual([]);
  });

  it('flags a doc missing a required section heading', () => {
    const doctored = docSource.replace('## Migration notes', '## Removed section');
    for (const heading of ['## Migration notes'] as const) {
      expect(doctored).not.toContain(heading);
    }
    expect(findMissingSections(doctored, REQUIRED_SECTIONS)).toContain('## Migration notes');
    expect(findMissingTokenNames(doctored, lightTokens)).not.toContain('--primary'); // name check still passes — heading check is separate
  });
});
