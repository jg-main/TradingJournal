/**
 * workstation-docs.test.ts — M025/S02/T02
 *
 * Source-parsing contract test guarding docs/design-system/workstation.md
 * against drift from the code it documents. Same approach as
 * design-system-docs.test.ts (decision D056; D077 concern split), reading
 * the doc and its authoritative sources from disk:
 *
 *   - src/app/(workstation)/workspace/workstation.css — ws- classes,
 *     --ws-* density/spacing/type tokens, @keyframes animations,
 *     data-testid panel scoping, data-ws-* state attributes.
 *   - src/components/workstation/*.tsx (non-test) — data-testid attributes
 *     (panel ids) and the keyboard-shortcut implementation.
 *   - src/lib/workstation-view-types.ts — the grid-area/panel-id catalogue
 *     the panel testid contract must stay in sync with.
 *
 * Contract groups:
 *   1. Section inventory — every canonical ## section of the ws- reference
 *      exists in the doc in canonical order.
 *   2. Required content — the sources the doc claims to document, plus the
 *      canonical panel testids.
 *   3. CSS → doc coverage — every ws- class, --ws-* token (name and value
 *      within a proximity window), @keyframes name, and CSS data-testid /
 *      data-ws-* attribute from workstation.css appears in the doc.
 *   4. Doc → code coverage — every ws- name the doc cites resolves to a
 *      class, token, keyframe, testid, or data attribute in the sources
 *      (abstract patterns like ws-panel-<area> / ws-perf-* are tolerated).
 *   5. Panel testids — every ws-panel-* testid the doc cites exists in the
 *      component source or the CSS scoping selectors (ws-panel-equity is a
 *      CSS-only scoping testid).
 *   6. Component → CSS coverage — every ws- class referenced from a className
 *      attribute in the workstation components is defined in workstation.css.
 *      This is the guard that was missing while ws-arrange-grid,
 *      ws-attention-*, ws-directional-grid, ws-process-score-bars,
 *      ws-process-bar, ws-trades-body, and ws-watchlist-error went undefined.
 *   7. Keyboard shortcuts — the documented shortcut table matches
 *      workstation-keyboard-shortcuts.tsx (SHORTCUT_ENTRIES keys + labels,
 *      ArrowUp/ArrowDown/Enter row navigation) and the arrange ceiling
 *      ARRANGE_KEYBOARD_MAX_Y matches workstation-keyboard-arrange.tsx.
 *   8. No placeholders — PLACEHOLDER/TODO markers are banned.
 *   9. Scanner self-test — the matchers reject a doctored doc that drops a
 *      class, invents a class, stale-drops a token value, cites an unknown
 *      panel testid, drops a shortcut key, or omits a required section; the
 *      component→CSS matcher rejects components that use undefined ws- classes.
 *
 * Runs under vitest (jsdom env is fine — no DOM interaction here).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

/* ── Document + source loading ──────────────────────────────────────────── */

const DOC_PATH = path.resolve(process.cwd(), 'docs/design-system/workstation.md');
const WORKSTATION_CSS_PATH = path.resolve(process.cwd(), 'src/app/(workstation)/workspace/workstation.css');
const COMPONENTS_DIR = path.resolve(process.cwd(), 'src/components/workstation');
const KEYBOARD_SHORTCUTS_PATH = path.join(COMPONENTS_DIR, 'workstation-keyboard-shortcuts.tsx');
const KEYBOARD_ARRANGE_PATH = path.join(COMPONENTS_DIR, 'workstation-keyboard-arrange.tsx');

function loadSource(filePath: string, label: string, minLength = 100): string {
  const src = fs.readFileSync(filePath, 'utf-8');
  expect(src.length, `${label} should not be empty`).toBeGreaterThan(minLength);
  return src;
}

const docSource = loadSource(DOC_PATH, 'docs/design-system/workstation.md', 1000);
const cssSource = loadSource(WORKSTATION_CSS_PATH, 'src/app/(workstation)/workspace/workstation.css', 1000);
const keyboardSource = loadSource(KEYBOARD_SHORTCUTS_PATH, 'workstation-keyboard-shortcuts.tsx');
const arrangeKeyboardSource = loadSource(KEYBOARD_ARRANGE_PATH, 'workstation-keyboard-arrange.tsx');

/** Concatenated non-test workstation component sources — the data-testid
 *  inventory and any testid-bearing renderers the doc describes. */
const componentSources = fs
  .readdirSync(COMPONENTS_DIR)
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .map((f) => fs.readFileSync(path.join(COMPONENTS_DIR, f), 'utf-8'))
  .join('\n');

/* ── CSS extraction ─────────────────────────────────────────────────────── */

/** Unique ws- class names defined in workstation.css (leading dot stripped). */
const cssClassNames = new Set<string>([...cssSource.matchAll(/\.ws-[a-z][\w-]*/g)].map((m) => m[0].slice(1)));

/** Unique --ws-* custom-property names anywhere in workstation.css — the
 *  `.ws` token block plus var() usages inside rules. */
const cssTokenNames = new Set<string>([...cssSource.matchAll(/--ws-[\w-]+/g)].map((m) => m[0].slice(2)));

/** @keyframes animation names defined in workstation.css. */
const cssAnimationNames = new Set<string>([...cssSource.matchAll(/@keyframes\s+(ws-[\w-]+)/g)].map((m) => m[1]));

/** data-testid attributes referenced by workstation.css (panel scoping). */
const cssTestidNames = new Set<string>([...cssSource.matchAll(/data-testid=["'](ws-[\w-]+)["']/g)].map((m) => m[1]));

/** data-ws-* state attributes (e.g. data-ws-arrange-fixed). */
const cssDataAttributeNames = new Set<string>([...cssSource.matchAll(/data-(ws-[\w-]+)=/g)].map((m) => m[1]));

/** data-testid attributes defined in the workstation components. */
const componentTestidNames = new Set<string>([...componentSources.matchAll(/data-testid=["'](ws-[\w-]+)["']/g)].map((m) => m[1]));

/* ── Component → CSS extraction ─────────────────────────────────────────── */

/** Component source with full-line and block comments removed, so a
 *  commented-out className never counts as a live usage. */
function stripComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** ws- class names referenced from className attributes in a component
 *  source: className="..." literals, className={'...'} strings, and
 *  className={`...`} template literals. Tokens that end in a hyphen are
 *  dynamic tails (e.g. the `ws-dq-` of `ws-dq-${severity}`) and are skipped —
 *  the concrete ws-dq-* classes are what the CSS defines. */
function extractClassNameWsTokens(source: string): string[] {
  const values = [
    ...source.matchAll(/className\s*=\s*["']([^"']*)["']/g),
    ...source.matchAll(/className\s*=\s*\{\s*["']([^"']*)["']\s*\}/g),
    ...source.matchAll(/className\s*=\s*\{`([^`]*)`\}/g),
  ].map((m) => m[1]);

  const tokens: string[] = [];
  for (const value of values) {
    for (const token of value.matchAll(/ws-[\w-]+/g)) {
      if (!token[0].endsWith('-')) tokens.push(token[0]);
    }
  }
  return tokens;
}

/** Unique ws- classes referenced from className attributes in the
 *  workstation components. */
const componentClassNameNames = new Set<string>(extractClassNameWsTokens(stripComments(componentSources)));

/** ws- classes used in a component source's className attributes with no
 *  matching definition in workstation.css (sorted for stable failures). */
function findUndefinedComponentClasses(source: string): string[] {
  return [...new Set(extractClassNameWsTokens(stripComments(source)))]
    .filter((name) => !cssClassNames.has(name))
    .sort();
}

/** Live component→CSS gap at scan time. */
const undefinedComponentClasses = findUndefinedComponentClasses(componentSources);

/** Raw --ws-* token definitions from the `.ws { ... }` root block. */
function extractWsTokenBlock(css: string): Record<string, string> {
  const start = css.indexOf('.ws {');
  expect(start, 'workstation.css must contain a ".ws {" token block').toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end, '".ws" token block must close with "}" on its own line').toBeGreaterThan(start);
  const block = css.slice(start, end);

  const tokens: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^\s*(--ws-[\w-]+):\s*([^;]+);/.exec(line);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

const wsTokens = extractWsTokenBlock(cssSource);

/* ── Contract matchers (also exercised by the scanner self-test) ────────── */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** ws- classes defined in the CSS but absent from the doc (as `.name`). */
function findMissingClassNames(doc: string, classes: Set<string>): string[] {
  return [...classes].filter((name) => !doc.includes(`.${name}`));
}

/** Token names defined in the CSS but absent from the doc. */
function findMissingTokenNames(doc: string, tokens: Record<string, string>): string[] {
  return Object.keys(tokens).filter((name) => !doc.includes(name));
}

/** [name, value] pairs whose value no longer appears near the token's name
 *  in the doc (within a one-line proximity window). Loose value-presence
 *  would miss drift when the bare value string (e.g. "2px") appears
 *  elsewhere; pairing name→value in a window is the real contract. */
function findStaleTokenValues(doc: string, tokens: Record<string, string>): Array<[string, string]> {
  return Object.entries(tokens).filter(([name, value]) => {
    const re = new RegExp(`${escapeRegExp(name)}[^\\n]{0,160}`, 'g');
    for (const m of doc.matchAll(re)) {
      if (m[0].includes(value)) return false; // a window pairs this name with its value
    }
    return true;
  });
}

/** Every ws- name the doc cites, from prose, tables, and inline code. The
 *  boundary is "not preceded by a word character", so `.ws-panel`,
 *  `--ws-row-xs`, `data-testid="ws-panel-risk"`, and `data-ws-arrange-fixed`
 *  all yield the same bare name. */
const CITED_WS_NAME_RE = /(?<![\w])ws-[\w-]+/g;

function citedWsNames(doc: string): string[] {
  return [...new Set([...doc.matchAll(CITED_WS_NAME_RE)].map((m) => m[0]))];
}

/** Abstract pattern citations tolerated by the doc→code check:
 *  `ws-panel-<area>` and `ws-perf-*` are intentional shorthand for families
 *  whose concrete members are documented individually. Only the bare prefix
 *  forms (trailing hyphen) are tolerated — exact match, never prefix match —
 *  so a misspelled concrete testid like ws-panel-mystery is still flagged. */
const ABSTRACT_WS_PATTERNS = ['ws-panel-', 'ws-perf-'] as const;

/** Every ws- name the code knows: classes, tokens, keyframes, CSS testids,
 *  data-ws-* attributes, and component testids. */
const knownWsNames = new Set<string>([
  ...cssClassNames,
  ...cssTokenNames,
  ...cssAnimationNames,
  ...cssTestidNames,
  ...cssDataAttributeNames,
  ...componentTestidNames,
]);

/** Cited names that resolve to no code definition and no abstract pattern. */
function findUnknownCitedNames(doc: string): string[] {
  return citedWsNames(doc).filter((name) => !knownWsNames.has(name) && !(ABSTRACT_WS_PATTERNS as readonly string[]).includes(name));
}

/** Concrete ws-panel-* testids cited in the doc — class names (ws-panel-header),
 *  tokens (ws-panel-header-h), and the abstract `ws-panel-<area>` pattern are
 *  excluded so only real panel testids remain. */
function citedPanelTestidsOf(doc: string): string[] {
  return [...new Set([...doc.matchAll(/ws-panel-[a-z][\w-]*/g)].map((m) => m[0]))].filter(
    (name) => !cssClassNames.has(name) && !cssTokenNames.has(name) && !name.endsWith('-'),
  );
}

const citedPanelTestids = citedPanelTestidsOf(docSource);

/** Every data-testid the code knows for panels: component attributes plus
 *  the CSS scoping selectors (ws-panel-equity lives only in CSS). */
const knownPanelTestids = new Set<string>(
  [...componentTestidNames, ...cssTestidNames].filter((n) => n.startsWith('ws-panel-')),
);

/** Key/label pairs from SHORTCUT_ENTRIES in workstation-keyboard-shortcuts.tsx. */
function extractShortcutEntries(source: string): Array<{ keys: string; label: string }> {
  const entries: Array<{ keys: string; label: string }> = [];
  const re = /\{\s*keys:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'\s*\}/g;
  for (const m of source.matchAll(re)) entries.push({ keys: m[1], label: m[2] });
  return entries;
}

const shortcutEntries = extractShortcutEntries(keyboardSource);

/** Significant words of a label (≥4 chars). The doc may rephrase with
 *  articles and case, so the contract is word-level presence, not verbatim. */
function labelWords(label: string): string[] {
  return label.split(/\s+/).filter((w) => w.length >= 4);
}

/** SHORTCUT_ENTRIES keys whose backticked form is absent from the doc. */
function findMissingShortcutKeys(doc: string, entries: Array<{ keys: string; label: string }>): string[] {
  return entries.filter((e) => !doc.includes(`\`${e.keys}\``)).map((e) => e.keys);
}

/** SHORTCUT_ENTRIES labels whose significant words are absent from the doc. */
function findMissingShortcutLabels(doc: string, entries: Array<{ keys: string; label: string }>): string[] {
  const lower = doc.toLowerCase();
  return entries
    .filter((e) => !labelWords(e.label).every((w) => lower.includes(w.toLowerCase())))
    .map((e) => `${e.keys} (${e.label})`);
}

/** ARRANGE_KEYBOARD_MAX_Y ceiling from workstation-keyboard-arrange.tsx. */
const arrangeMaxY = Number(/ARRANGE_KEYBOARD_MAX_Y\s*=\s*(\d+)/.exec(arrangeKeyboardSource)?.[1] ?? NaN);

/* ── Required heading inventory (the ws- pattern reference) ─────────────── */

const REQUIRED_SECTIONS = [
  '## Dashboard workstation standard',
  '## Density tokens',
  '## Panel chrome',
  '## Toolbar',
  '## Grid shell',
  '## Dense data table',
  '## Trades workspace',
  '## Data-quality alert strip',
  '## Market strip',
  '## Watchlist panel',
  '## Positions panel',
  '## Risk positions table',
  '## Risk band',
  '## Performance KPI grid',
  '## Process Review panel',
  '## Setups and ideas panel',
  '## Equity chart',
  '## Keyboard navigation',
  '## Accessibility',
  '## Customize mode',
  '## Arrange mode',
] as const;

/** Sections from `sections` that do not appear in `source`. */
function findMissingSections(source: string, sections: readonly string[]): string[] {
  return sections.filter((heading) => !source.includes(heading));
}

/* ── Required content inventory ─────────────────────────────────────────── */

/** Sources the doc must cite as authoritative, and the canonical panel
 *  testids the panel-testid contract must resolve. */
const REQUIRED_PHRASES = [
  'workstation.css',
  'src/components/workstation/',
  'workstation-keyboard-shortcuts.tsx',
  'workstation-keyboard-arrange.tsx',
  'workstation-view-types.ts',
  'react-grid-layout',
] as const;

const REQUIRED_PANEL_TESTIDS = [
  'ws-panel-risk',
  'ws-panel-positions',
  'ws-panel-watchlist',
  'ws-panel-insights',
  'ws-panel-performance',
  'ws-panel-equity',
] as const;

/* ── 1. Section inventory ──────────────────────────────────────────────── */

describe('workstation doc section inventory', () => {
  it('declares every canonical ## section of the ws- reference', () => {
    const missing = findMissingSections(docSource, REQUIRED_SECTIONS);
    expect(missing, `sections missing from docs/design-system/workstation.md: ${missing.join(', ')}`).toEqual([]);
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

describe('workstation doc required content', () => {
  it.each(REQUIRED_PHRASES)('documents the authoritative source "%s"', (phrase) => {
    expect(docSource, `required phrase "${phrase}" missing from docs/design-system/workstation.md`).toContain(phrase);
  });

  it('documents the canonical panel testids', () => {
    for (const id of REQUIRED_PANEL_TESTIDS) {
      expect(docSource, `panel testid ${id} missing from docs/design-system/workstation.md`).toContain(id);
    }
  });

  it('documents every --ws-* token from the .ws root block', () => {
    // 14 density/space/type/chrome tokens: row-xs/sm/md, toolbar-h,
    // panel-header-h, space-1..6, text-xs..xl, border, border-strong, radius.
    expect(Object.keys(wsTokens).length).toBeGreaterThanOrEqual(14);
  });
});

/* ── 3. CSS → doc coverage ─────────────────────────────────────────────── */

describe('CSS → doc coverage (workstation.css → workstation.md)', () => {
  it('documents every ws- class defined in workstation.css', () => {
    const missing = findMissingClassNames(docSource, cssClassNames);
    expect(missing, `ws- classes missing from docs/design-system/workstation.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents every --ws-* token name', () => {
    const missing = findMissingTokenNames(docSource, wsTokens);
    expect(missing, `--ws-* tokens missing from docs/design-system/workstation.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps documented --ws-* token values in sync with the CSS', () => {
    const stale = findStaleTokenValues(docSource, wsTokens);
    const rendered = stale.map(([name, value]) => `${name}=${value}`);
    expect(rendered, `--ws-* token values drifted from workstation.css: ${rendered.join(', ')}`).toEqual([]);
  });

  it('documents every @keyframes animation defined in workstation.css', () => {
    for (const name of cssAnimationNames) {
      expect(docSource, `animation ${name} missing from docs/design-system/workstation.md`).toContain(name);
    }
  });

  it('documents the CSS panel-scoping testids and data-ws-* attributes', () => {
    for (const name of cssTestidNames) {
      expect(docSource, `CSS testid ${name} missing from docs/design-system/workstation.md`).toContain(name);
    }
    for (const name of cssDataAttributeNames) {
      expect(docSource, `CSS data attribute ${name} missing from docs/design-system/workstation.md`).toContain(name);
    }
  });
});

/* ── 4. Doc → code coverage ────────────────────────────────────────────── */

describe('doc → code coverage (workstation.md → sources)', () => {
  it('every ws- name cited in the doc exists in the code it documents', () => {
    const unknown = findUnknownCitedNames(docSource);
    expect(unknown, `doc cites ws- names the sources do not define: ${unknown.join(', ')}`).toEqual([]);
  });

  it('tolerates abstract pattern citations (ws-panel-<area>, ws-perf-*)', () => {
    expect(findUnknownCitedNames('ws-panel-<area> and ws-perf-* and .ws-panel')).toEqual([]);
    expect(findUnknownCitedNames('ws-panel-mystery')).toEqual(['ws-panel-mystery']);
  });
});

/* ── 5. Panel testids match component source ───────────────────────────── */

describe('panel testids match component source', () => {
  it('every documented panel testid resolves to a component testid or CSS scoping selector', () => {
    const unknown = REQUIRED_PANEL_TESTIDS.filter((id) => !knownPanelTestids.has(id));
    expect(unknown, `panel testids missing from src/components/workstation or workstation.css: ${unknown.join(', ')}`).toEqual([]);
  });

  it('every ws-panel-* testid the doc cites resolves too', () => {
    const unknown = citedPanelTestids.filter((name) => !knownPanelTestids.has(name));
    expect(unknown, `doc cites panel testids missing from the sources: ${unknown.join(', ')}`).toEqual([]);
  });

  it('keeps the panel-testid inventory non-trivial', () => {
    expect(citedPanelTestids.length).toBeGreaterThanOrEqual(6);
    expect(knownPanelTestids.size).toBeGreaterThanOrEqual(7);
  });
});

/* ── 6. Component → CSS coverage ───────────────────────────────────────── */

describe('component → CSS coverage (components → workstation.css)', () => {
  it('extracts a non-trivial ws- className inventory from the components', () => {
    expect(componentClassNameNames.size).toBeGreaterThan(80);
  });

  it('every ws- class used in a workstation component className is defined in workstation.css', () => {
    expect(
      undefinedComponentClasses,
      `ws- classes used in src/components/workstation but missing from workstation.css: ${undefinedComponentClasses.join(', ')}`,
    ).toEqual([]);
  });
});

/* ── 7. Keyboard shortcuts match implementation ────────────────────────── */

describe('keyboard shortcuts match implementation', () => {
  it('parses the SHORTCUT_ENTRIES inventory from the implementation', () => {
    // [ ] ? 1 2 3 4 5 Escape — the nine documented surface shortcuts.
    expect(shortcutEntries.length).toBeGreaterThanOrEqual(9);
  });

  it('documents every SHORTCUT_ENTRIES key', () => {
    const missing = findMissingShortcutKeys(docSource, shortcutEntries);
    expect(missing, `shortcut keys missing from docs/design-system/workstation.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents every SHORTCUT_ENTRIES action (significant words)', () => {
    const missing = findMissingShortcutLabels(docSource, shortcutEntries);
    expect(missing, `shortcut labels missing from docs/design-system/workstation.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('covers the table row-navigation keys implemented in the handler', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter']) {
      expect(keyboardSource, `handler must implement key === '${key}'`).toContain(`key === '${key}'`);
      expect(docSource, `doc must document the ${key} row-navigation shortcut`).toContain(key);
    }
  });

  it('documents the arrange keyboard ceiling ARRANGE_KEYBOARD_MAX_Y', () => {
    expect(Number.isFinite(arrangeMaxY)).toBe(true);
    expect(docSource, 'doc must cite ARRANGE_KEYBOARD_MAX_Y').toContain('ARRANGE_KEYBOARD_MAX_Y');
    expect(docSource, 'doc must cite the arrange ceiling value').toContain(String(arrangeMaxY));
  });
});

/* ── 8. No placeholders ────────────────────────────────────────────────── */

describe('workstation doc placeholder guard', () => {
  it('contains no PLACEHOLDER markers', () => {
    expect(docSource).not.toContain('PLACEHOLDER');
  });

  it('contains no TODO markers', () => {
    expect(docSource).not.toContain('TODO');
  });
});

/* ── 9. Scanner self-test ──────────────────────────────────────────────── */

describe('scanner self-test (the contract rejects drift)', () => {
  it('flags a doc that silently drops a class', () => {
    // Non-ASCII replacement char guarantees the original substring is gone.
    const doctored = docSource.replaceAll('.ws-toolbar', '.ws-toölbar');
    expect(findMissingClassNames(doctored, cssClassNames)).toContain('ws-toolbar');
  });

  it('flags a doc that invents a class', () => {
    const doctored = `${docSource}\n\n\`.ws-fake-panel\` is not real.`;
    expect(findUnknownCitedNames(doctored)).toContain('ws-fake-panel');
  });

  it('flags a doc whose token value went stale', () => {
    const doctored = docSource.replaceAll('28px', '27px');
    const stale = findStaleTokenValues(doctored, wsTokens);
    expect(stale.some(([name]) => name === '--ws-row-xs')).toBe(true);
    // sanity: the real doc has no stale token values
    expect(findStaleTokenValues(docSource, wsTokens)).toEqual([]);
  });

  it('flags a doc that cites an unknown panel testid', () => {
    const doctored = docSource.replaceAll('ws-panel-risk', 'ws-panel-mystery');
    const unknown = citedPanelTestidsOf(doctored).filter((name) => !knownPanelTestids.has(name));
    expect(unknown).toContain('ws-panel-mystery');
  });

  it('flags a doc that drops a shortcut key', () => {
    const doctored = docSource.replace('`Escape` | Dismiss', '`End` | Dismiss');
    expect(findMissingShortcutKeys(doctored, shortcutEntries)).toContain('Escape');
  });

  it('flags a doc missing a required section heading', () => {
    const doctored = docSource.replace('## Arrange mode', '## Removed section');
    expect(doctored).not.toContain('## Arrange mode');
    expect(findMissingSections(doctored, REQUIRED_SECTIONS)).toContain('## Arrange mode');
  });

  it('flags a component className that references an undefined ws- class', () => {
    const doctored = `${componentSources}\n<div className="ws-fake-component-class">x</div>`;
    expect(findUndefinedComponentClasses(doctored)).toContain('ws-fake-component-class');
  });

  it('flags a template-literal component className whose ws- class is undefined', () => {
    const doctored = `${componentSources}\n<div className={\`ws-panel-body ws-ghost-bar\`}>x</div>`;
    expect(findUndefinedComponentClasses(doctored)).toContain('ws-ghost-bar');
  });

  it('accepts a component that only uses defined ws- classes', () => {
    expect(findUndefinedComponentClasses('<div className="ws-panel ws-panel-body ws-num">x</div>')).toEqual([]);
  });
});
