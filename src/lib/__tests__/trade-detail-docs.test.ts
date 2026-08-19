/**
 * trade-detail-docs.test.ts — M025/S03/T02
 *
 * Source-parsing contract test guarding docs/design-system/trade-detail.md
 * against drift from the code it documents. Same approach as
 * design-system-docs.test.ts (decision D056; D077 concern split) and its
 * sibling workstation-docs.test.ts (M025/S02/T02), reading the doc and its
 * authoritative sources from disk:
 *
 *   - src/components/trade-detail/trade-detail-grid.css — td- classes,
 *     --td-* density/spacing/type/chrome tokens, grid template areas,
 *     data-area scoping, data-slot card-strip selectors, data-state
 *     review triggers, breakpoints, focus ring, reduced-motion
 *     kill-switch.
 *   - src/components/trade-detail/trade-detail-grid.tsx — the grid
 *     primitives: TradeDetailGrid variant wiring, TradeDetailPanel
 *     section/tabIndex/header optionality, TradeDetailColumn data-area.
 *   - src/components/trade-detail/trade-collapsible-review-section.tsx —
 *     the Radix Collapsible review-section wrapper (defaultOpen=false).
 *
 * Contract groups:
 *   1. Section inventory — every canonical ## section of the td- reference
 *      exists in the doc in canonical order.
 *   2. Required content — the sources the doc claims to document, the
 *      three grid variants, and the tabular-nums/reduced-motion contracts.
 *   3. CSS → doc coverage — every td- class, --td-* token (name and value
 *      within a proximity window), grid template area, data-area value,
 *      data-slot/data-state selector, and breakpoint from
 *      trade-detail-grid.css appears in the doc.
 *   4. Doc → code coverage — every td- name and data-area value the doc
 *      cites resolves to a class, token, or selector in the sources.
 *   5. Component contract — the grid primitives (variants, panel
 *      semantics, column areas) and the review-section wrapper match the
 *      doc's claims.
 *   6. No placeholders — PLACEHOLDER/TODO markers are banned.
 *   7. Scanner self-test — the matchers reject a doctored doc that drops a
 *      class, invents a class, stale-drops a token value, cites an unknown
 *      data-area, drops a variant, or omits a required section.
 *
 * Runs under vitest (jsdom env is fine — no DOM interaction here).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

/* ── Document + source loading ──────────────────────────────────────────── */

const DOC_PATH = path.resolve(process.cwd(), 'docs/design-system/trade-detail.md');
const GRID_CSS_PATH = path.resolve(process.cwd(), 'src/components/trade-detail/trade-detail-grid.css');
const COMPONENTS_DIR = path.resolve(process.cwd(), 'src/components/trade-detail');
const GRID_TSX_PATH = path.join(COMPONENTS_DIR, 'trade-detail-grid.tsx');
const REVIEW_SECTION_TSX_PATH = path.join(COMPONENTS_DIR, 'trade-collapsible-review-section.tsx');

function loadSource(filePath: string, label: string, minLength = 100): string {
  const src = fs.readFileSync(filePath, 'utf-8');
  expect(src.length, `${label} should not be empty`).toBeGreaterThan(minLength);
  return src;
}

const docSource = loadSource(DOC_PATH, 'docs/design-system/trade-detail.md', 1000);
const cssSource = loadSource(GRID_CSS_PATH, 'src/components/trade-detail/trade-detail-grid.css', 1000);
const gridSource = loadSource(GRID_TSX_PATH, 'src/components/trade-detail/trade-detail-grid.tsx');
const reviewSectionSource = loadSource(REVIEW_SECTION_TSX_PATH, 'trade-collapsible-review-section.tsx');

/* ── CSS extraction ─────────────────────────────────────────────────────── */

/** Unique td- class names defined in trade-detail-grid.css (leading dot
 *  stripped). The root `.td` class is handled separately via the token
 *  block check — the pattern contract covers `.td-*` members. */
const cssClassNames = new Set<string>([...cssSource.matchAll(/\.td-[a-z][\w-]*/g)].map((m) => m[0].slice(1)));

/** Unique --td-* custom-property names anywhere in trade-detail-grid.css —
 *  the `.td` token block plus var() usages inside rules. */
const cssTokenNames = new Set<string>([...cssSource.matchAll(/--td-[\w-]+/g)].map((m) => m[0].slice(2)));

/** Raw --td-* token definitions from the `.td { ... }` root block. */
function extractTdTokenBlock(css: string): Record<string, string> {
  const start = css.indexOf('.td {');
  expect(start, 'trade-detail-grid.css must contain a ".td {" token block').toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end, '".td" token block must close with "}" on its own line').toBeGreaterThan(start);
  const block = css.slice(start, end);

  const tokens: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^\s*(--td-[\w-]+):\s*([^;]+);/.exec(line);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

const tdTokens = extractTdTokenBlock(cssSource);

/** data-area attribute values referenced by trade-detail-grid.css — the
 *  panel scoping selectors (.td-panel[data-area='X']) and the column
 *  scoping selectors (.td-grid-column[data-area='X']). */
const cssAreaNames = new Set<string>([...cssSource.matchAll(/data-area=['"]([\w-]+)['"]/g)].map((m) => m[1]));

/** Grid template area names from every grid-template-areas declaration —
 *  the lifecycle/left/details/right/assets/plan/main template contract. */
function extractGridTemplateAreas(css: string): string[] {
  const areas: string[] = [];
  const blockRe = /grid-template-areas:([\s\S]*?);/g;
  for (const m of css.matchAll(blockRe)) {
    for (const q of m[1].matchAll(/'([^']+)'/g)) {
      for (const word of q[1].split(/\s+/)) areas.push(word);
    }
  }
  return [...new Set(areas)];
}

const gridTemplateAreas = extractGridTemplateAreas(cssSource);

/** data-slot attribute values targeted by the card-strip rules. */
const cssDataSlotNames = new Set<string>([...cssSource.matchAll(/\[data-slot='([\w-]+)'\]/g)].map((m) => m[1]));

/** data-state values used by the review-section trigger. */
const cssDataStateNames = new Set<string>([...cssSource.matchAll(/\[data-state='([\w-]+)'\]/g)].map((m) => m[1]));

/** @media breakpoints in px (1440 / 1600). */
const cssBreakpointsPx = [...cssSource.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1]));

/* ── Contract matchers (also exercised by the scanner self-test) ────────── */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** td- classes defined in the CSS but absent from the doc (as `.name`). */
function findMissingClassNames(doc: string, classes: Set<string>): string[] {
  return [...classes].filter((name) => !doc.includes(`.${name}`));
}

/** Token names defined in the CSS but absent from the doc. */
function findMissingTokenNames(doc: string, tokens: Record<string, string>): string[] {
  return Object.keys(tokens).filter((name) => !doc.includes(name));
}

/** [name, value] pairs whose value no longer appears near the token's name
 *  in the doc (within a one-line proximity window). Same pairing contract
 *  as workstation-docs.test.ts. */
function findStaleTokenValues(doc: string, tokens: Record<string, string>): Array<[string, string]> {
  return Object.entries(tokens).filter(([name, value]) => {
    const re = new RegExp(`${escapeRegExp(name)}[^\\n]{0,160}`, 'g');
    for (const m of doc.matchAll(re)) {
      if (m[0].includes(value)) return false; // a window pairs this name with its value
    }
    return true;
  });
}

/** Every td- name the doc cites, from prose, tables, and inline code. The
 *  boundary is "not preceded by a word character", so `.td-panel`,
 *  `--td-row-sm`, and `td-compact-card` all yield the same bare name. */
const CITED_TD_NAME_RE = /(?<![\w])td-[\w-]+/g;

function citedTdNames(doc: string): string[] {
  return [...new Set([...doc.matchAll(CITED_TD_NAME_RE)].map((m) => m[0]))];
}

/** Every td- name the code knows: classes and tokens. */
const knownTdNames = new Set<string>([...cssClassNames, ...cssTokenNames]);

/** Cited names that resolve to no code definition. */
function findUnknownCitedNames(doc: string): string[] {
  return citedTdNames(doc).filter((name) => !knownTdNames.has(name));
}

/** data-area attribute values cited in the doc's selector examples. */
function citedAreaValuesOf(doc: string): string[] {
  return [...new Set([...doc.matchAll(/data-area=['"]([\w-]+)['"]/g)].map((m) => m[1]))];
}

/* ── Required heading inventory (the td- pattern reference) ─────────────── */

const REQUIRED_SECTIONS = [
  '## Trade detail standard',
  '## Density tokens',
  '## Panel chrome',
  '## Grid shell',
  '## Variant grids',
  '## Review sections',
  '## Card stripping',
  '## Risk column density',
  '## Legacy page chrome',
  '## Focus ring',
  '## Reduced motion',
  '## Accessibility',
] as const;

/** Sections from `sections` that do not appear in `source`. */
function findMissingSections(source: string, sections: readonly string[]): string[] {
  return sections.filter((heading) => !source.includes(heading));
}

/* ── Required content inventory ─────────────────────────────────────────── */

/** Sources the doc must cite as authoritative, plus the surface-level
 *  contracts it claims (tabular numerals, reduced motion). */
const REQUIRED_PHRASES = [
  'trade-detail-grid.css',
  'src/components/trade-detail/',
  'trade-detail-grid.tsx',
  'TradeDetailGrid',
  'TradeDetailPanel',
  'TradeCollapsibleReviewSection',
  'Radix',
  'active-phase-view.tsx',
  'planned-phase-view.tsx',
  'closed-phase-view.tsx',
  'tabular-nums',
  'prefers-reduced-motion',
  'data-area',
] as const;

/** The three grid variants the doc must describe. */
const REQUIRED_VARIANTS = ['monitoring', 'planned', 'closed'] as const;

/* ── 1. Section inventory ──────────────────────────────────────────────── */

describe('trade-detail doc section inventory', () => {
  it('declares every canonical ## section of the td- reference', () => {
    const missing = findMissingSections(docSource, REQUIRED_SECTIONS);
    expect(missing, `sections missing from docs/design-system/trade-detail.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps the canonical sections in order', () => {
    let cursor = 0;
    for (const heading of REQUIRED_SECTIONS) {
      const idx = docSource.indexOf(heading, cursor);
      expect(idx, `"${heading}" must appear after the previous section`).toBeGreaterThanOrEqual(cursor);
      cursor = idx;
    }
  });
});

/* ── 2. Required content ───────────────────────────────────────────────── */

describe('trade-detail doc required content', () => {
  it.each(REQUIRED_PHRASES)('documents the authoritative source/contract "%s"', (phrase) => {
    expect(docSource, `required phrase "${phrase}" missing from docs/design-system/trade-detail.md`).toContain(phrase);
  });

  it('documents all three grid variants (monitoring/planned/closed)', () => {
    for (const variant of REQUIRED_VARIANTS) {
      expect(docSource, `variant "${variant}" missing from docs/design-system/trade-detail.md`).toContain(variant);
    }
  });

  it('documents every --td-* token from the .td root block', () => {
    // 16 density/spacing/type/chrome tokens: row-sm, panel-header-h,
    // space-1..6, text-xs..xl, border, border-strong, radius.
    expect(Object.keys(tdTokens).length).toBeGreaterThanOrEqual(16);
  });
});

/* ── 3. CSS → doc coverage ─────────────────────────────────────────────── */

describe('CSS → doc coverage (trade-detail-grid.css → trade-detail.md)', () => {
  it('documents every td- class defined in trade-detail-grid.css', () => {
    const missing = findMissingClassNames(docSource, cssClassNames);
    expect(missing, `td- classes missing from docs/design-system/trade-detail.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents every --td-* token name', () => {
    const missing = findMissingTokenNames(docSource, tdTokens);
    expect(missing, `--td-* tokens missing from docs/design-system/trade-detail.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps documented --td-* token values in sync with the CSS', () => {
    const stale = findStaleTokenValues(docSource, tdTokens);
    const rendered = stale.map(([name, value]) => `${name}=${value}`);
    expect(rendered, `--td-* token values drifted from trade-detail-grid.css: ${rendered.join(', ')}`).toEqual([]);
  });

  it('documents every grid template area (lifecycle/left/details/right/assets/plan/main)', () => {
    for (const area of gridTemplateAreas) {
      expect(docSource, `grid template area ${area} missing from docs/design-system/trade-detail.md`).toContain(`\`${area}\``);
    }
  });

  it('documents every data-area value from the scoping selectors', () => {
    for (const area of cssAreaNames) {
      expect(docSource, `data-area value ${area} missing from docs/design-system/trade-detail.md`).toContain(`\`${area}\``);
    }
  });

  it('documents the card-strip data-slot selectors', () => {
    for (const slot of cssDataSlotNames) {
      expect(docSource, `[data-slot='${slot}'] missing from docs/design-system/trade-detail.md`).toContain(`[data-slot='${slot}']`);
    }
  });

  it('documents the review-section data-state trigger selector', () => {
    for (const state of cssDataStateNames) {
      expect(docSource, `[data-state='${state}'] missing from docs/design-system/trade-detail.md`).toContain(`[data-state='${state}']`);
    }
  });

  it('documents the breakpoints', () => {
    for (const px of [...new Set(cssBreakpointsPx)]) {
      expect(docSource, `${px}px breakpoint missing from docs/design-system/trade-detail.md`).toContain(`${px}px`);
    }
    expect([...new Set(cssBreakpointsPx)]).toEqual(expect.arrayContaining([1440, 1600]));
  });

  it('documents the reduced-motion kill-switch duration', () => {
    expect(cssSource).toContain('0.01ms');
    expect(docSource, 'reduced-motion 0.01ms contract missing from trade-detail.md').toContain('0.01ms');
  });
});

/* ── 4. Doc → code coverage ────────────────────────────────────────────── */

describe('doc → code coverage (trade-detail.md → sources)', () => {
  it('every td- name cited in the doc exists in the code it documents', () => {
    const unknown = findUnknownCitedNames(docSource);
    expect(unknown, `doc cites td- names the sources do not define: ${unknown.join(', ')}`).toEqual([]);
  });

  it('every data-area value cited in the doc resolves to a scoping selector', () => {
    const unknown = citedAreaValuesOf(docSource).filter((name) => !cssAreaNames.has(name));
    expect(unknown, `doc cites data-area values with no scoping selector: ${unknown.join(', ')}`).toEqual([]);
  });
});

/* ── 5. Component contract ─────────────────────────────────────────────── */

describe('component contract matches the doc', () => {
  it('wires each grid variant to its CSS modifier class', () => {
    expect(gridSource).toContain("variant === 'planned' && 'td-grid--planned'");
    expect(gridSource).toContain("variant === 'closed' && 'td-grid--closed'");
    for (const cls of ['td-grid--planned', 'td-grid--closed']) {
      expect(cssClassNames.has(cls), `CSS must define ${cls}`).toBe(true);
    }
  });

  it('renders panels as focusable sections with optional headers', () => {
    expect(gridSource).toContain('tabIndex={-1}');
    expect(gridSource).toContain('title != null || meta != null');
    expect(docSource, 'doc must describe the panel focus-ring semantics').toContain('tabIndex={-1}');
    // Phrase-level match, whitespace-tolerant: the doc wraps the phrase
    // across a line break. Normalize the doc to single spaces first.
    const flatDoc = docSource.replace(/\s+/g, ' ');
    expect(flatDoc, 'doc must describe header optionality').toContain('only when a title or meta is provided');
  });

  it('covers every TradeDetailArea / TradeDetailColumnArea with a scoping selector', () => {
    const areas = [...cssAreaNames];
    // 9 panel areas + 3 column areas (details is shared) = 11 distinct values.
    expect(areas.length).toBeGreaterThanOrEqual(11);
    for (const area of ['lifecycle', 'cockpit', 'details', 'risk', 'context', 'history', 'review', 'assets', 'plan']) {
      expect(cssSource, `missing panel scoping selector for data-area='${area}'`).toContain(`[data-area='${area}']`);
    }
    for (const area of ['left', 'details', 'right']) {
      expect(cssSource, `missing column scoping selector for data-area='${area}'`).toContain(`[data-area='${area}']`);
    }
  });

  it('matches the review-section Radix wrapper claims', () => {
    expect(reviewSectionSource).toContain("from '@/components/ui/collapsible'");
    expect(reviewSectionSource).toContain('defaultOpen = false');
    expect(docSource, 'doc must describe the Radix Collapsible wrapper').toContain('Radix');
    expect(docSource, 'doc must document defaultOpen = false').toContain('defaultOpen = false');
  });
});

/* ── 6. No placeholders ────────────────────────────────────────────────── */

describe('trade-detail doc placeholder guard', () => {
  it('contains no PLACEHOLDER markers', () => {
    expect(docSource).not.toContain('PLACEHOLDER');
  });

  it('contains no TODO markers', () => {
    expect(docSource).not.toContain('TODO');
  });
});

/* ── 7. Scanner self-test ──────────────────────────────────────────────── */

describe('scanner self-test (the contract rejects drift)', () => {
  it('flags a doc that silently drops a class', () => {
    // Non-ASCII replacement char guarantees the original substring is gone.
    const doctored = docSource.replaceAll('.td-panel-body', '.td-pänel-body');
    expect(findMissingClassNames(doctored, cssClassNames)).toContain('td-panel-body');
  });

  it('flags a doc that invents a class', () => {
    const doctored = `${docSource}\n\n\`.td-fake-panel\` is not real.`;
    expect(findUnknownCitedNames(doctored)).toContain('td-fake-panel');
  });

  it('flags a doc whose token value went stale', () => {
    const doctored = docSource.replaceAll('36px', '35px');
    const stale = findStaleTokenValues(doctored, tdTokens);
    expect(stale.some(([name]) => name === '--td-row-sm')).toBe(true);
    // sanity: the real doc has no stale token values
    expect(findStaleTokenValues(docSource, tdTokens)).toEqual([]);
  });

  it('flags a doc that cites an unknown data-area value', () => {
    const doctored = docSource.replace("data-area='lifecycle'", "data-area='frozen'");
    const unknown = citedAreaValuesOf(doctored).filter((name) => !cssAreaNames.has(name));
    expect(unknown).toContain('frozen');
  });

  it('flags a doc that drops a grid variant', () => {
    const doctored = docSource.replaceAll('monitoring', 'frozen');
    for (const variant of REQUIRED_VARIANTS) {
      if (variant === 'monitoring') expect(doctored).not.toContain('monitoring');
    }
    expect(REQUIRED_VARIANTS.filter((v) => !doctored.includes(v))).toContain('monitoring');
  });

  it('flags a doc missing a required section heading', () => {
    const doctored = docSource.replace('## Reduced motion', '## Removed section');
    expect(doctored).not.toContain('## Reduced motion');
    expect(findMissingSections(doctored, REQUIRED_SECTIONS)).toContain('## Reduced motion');
  });
});
