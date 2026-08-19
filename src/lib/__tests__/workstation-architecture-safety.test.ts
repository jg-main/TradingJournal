/**
 * workstation-architecture-safety.test.ts — M026-1bw68n/S04/T02
 *
 * Architecture safety assertions recap — the milestone's single durable
 * guardrail. Consolidates the workstation architecture invariants proven
 * across S01 (the 17-area capability audit), S02 (live/historical context
 * contract), and S03 (responsive architecture) into one index that makes
 * every protected invariant explicit and fails fast when a structural
 * property drifts.
 *
 * The recap is deliberately cheap and structural: it imports the same
 * modules the workstation uses at runtime (workstation-view-types,
 * workstation-live-adapter, workstation-context) and re-asserts the
 * invariants S02/S03 already proved plus the structural invariants from
 * the S01 audit. Deep behavioral proofs (payload invariance under every
 * scope preference, full validation matrices, browser evidence) stay in
 * their dedicated guards — this file pins that those guards exist and that
 * the structural skeleton they protect still holds.
 *
 * Groups:
 *   1. Capability-area recap index — the 17 audited capability areas, each
 *      mapped to the guard that protects it (verified to exist).
 *   2. Panel catalogue invariants — 6 first-party panels, immutable,
 *      metadata-rich, catalogue-only validation (S01 #1/#4).
 *   3. Fixed-anchor invariants — risk/trades locked full-width anchors in
 *      every template (S01 #9/#10).
 *   4. Layout-version invariants — WORKSTATION_LAYOUT_VERSION=2,
 *      WORKSTATION_DEFAULT_TEMPLATE_VERSION=3, total migration-on-read with
 *      future-version safe fallback (S01 #5).
 *   5. Validation invariants — catalogue-only cells, rectangular grids,
 *      contiguous regions, hidden/areas consistency, RGL bounds/overlap/
 *      duplicate/future-version checks, persisted data cannot loosen
 *      catalogue bounds (S01 #4/#9).
 *   6. Context-separation invariants — the live adapter exposes no
 *      period/date filter; no import edge from the live data path to the
 *      P&L scope preference (S02; S01 #12/#14).
 *   7. Doc-code alignment invariants — workstation.md documents the Live vs
 *      Historical scope contract and the canonical panel testids; the
 *      dedicated alignment guards exist (S01/S02).
 *   8. Responsive architecture invariants — dense breakpoints in
 *      workstation.css and the e2e width/theme specs exist (S03; S01 #17).
 *   9. Scanner self-test — the recap's own matchers reject drift.
 *
 * Run: npx vitest run src/lib/__tests__/workstation-architecture-safety.test.ts
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

// ── Real runtime imports (the modules the workstation uses at runtime) ────
import {
  WORKSTATION_PANEL_IDS,
  WORKSTATION_PANEL_ID_LIST,
  WORKSTATION_PANEL_CATALOGUE,
  WORKSTATION_TEMPLATE_IDS,
  WORKSTATION_TEMPLATES,
  WORKSTATION_LAYOUT_VERSION,
  WORKSTATION_DEFAULT_TEMPLATE_VERSION,
  FIXED_PANEL_IDS,
  OPTIONAL_PANEL_IDS,
  GRID_EMPTY_CELL,
  createViewFromTemplate,
  validateWorkstationViewConfig,
  isValidWorkstationViewConfig,
  migrateWorkstationViewConfig,
  isWorkstationPanelId,
  type WorkstationPanelId,
} from '@/lib/workstation-view-types';

import {
  fetchAllLiveDashboardData,
  fetchDashboardLive,
  fetchAccountsLive,
} from '@/lib/workstation-live-adapter';

import { WorkstationProvider, useWorkstation } from '@/components/workstation/workstation-context';

/* ── Source loading (structural contract groups) ───────────────────────── */

const ADAPTER_PATH = path.resolve(process.cwd(), 'src/lib/workstation-live-adapter.ts');
const CONTEXT_PATH = path.resolve(process.cwd(), 'src/components/workstation/workstation-context.tsx');
const COMPONENTS_DIR = path.resolve(process.cwd(), 'src/components/workstation');
const DOC_PATH = path.resolve(process.cwd(), 'docs/design-system/workstation.md');
const CSS_PATH = path.resolve(process.cwd(), 'src/app/(workstation)/workspace/workstation.css');

function loadSource(filePath: string, label: string, minLength = 100): string {
  const src = fs.readFileSync(filePath, 'utf-8');
  expect(src.length, `${label} should not be empty`).toBeGreaterThan(minLength);
  return src;
}

const adapterSource = loadSource(ADAPTER_PATH, 'src/lib/workstation-live-adapter.ts', 1000);
const contextSource = loadSource(CONTEXT_PATH, 'workstation-context.tsx', 1000);
const docSource = loadSource(DOC_PATH, 'docs/design-system/workstation.md', 1000);
const cssSource = loadSource(CSS_PATH, 'workstation.css', 1000);

/** Non-test workstation component files — the import-edge inventory. */
const workstationComponentFiles = fs
  .readdirSync(COMPONENTS_DIR)
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .map((f) => path.join(COMPONENTS_DIR, f));

/* ═══════════════════════════════════════════════════════════════════════
 * 1. Capability-area recap index (S01 audit)
 * ═══════════════════════════════════════════════════════════════════════ */

interface CapabilityArea {
  /** Capability name from the S01 matrix. */
  readonly area: string;
  /** Audit verdict: complete, refine-retired (G1/G2 closed by S02/S03), or deferred (G3). */
  readonly verdict: 'complete' | 'refine-retired' | 'deferred';
  /** What protects this invariant today (module export, contract, or test guard). */
  readonly guard: string;
  /** A file on disk that backs the guard; asserted to exist. */
  readonly guardFile?: string;
}

/** The 17 audited capability areas (26-01-MATRIX.md), each mapped to the
 *  guard that keeps it true. This table is the milestone's index: if a
 *  capability stops being protected, its guard row must change — and the
 *  test below fails until the row either resolves to a real guard or the
 *  capability is deliberately re-classified. */
const CAPABILITY_AREAS: readonly CapabilityArea[] = [
  {
    area: 'Panel catalogue',
    verdict: 'complete',
    guard: 'WORKSTATION_PANEL_CATALOGUE — immutable 6-panel metadata record; recap group 2 re-asserts it',
    guardFile: 'src/lib/workstation-view-types.ts',
  },
  {
    area: 'Curated templates',
    verdict: 'complete',
    guard: 'WORKSTATION_TEMPLATES — risk-positions immutable default + performance + process-review; recap group 3',
    guardFile: 'src/lib/workstation-view-types.ts',
  },
  {
    area: 'Saved views',
    verdict: 'complete',
    guard: 'WorkstationViewConfig + single-owner store (localStorage + /api/dashboard/views sync); use-workstation-views.test.ts',
    guardFile: 'src/hooks/use-workstation-views.test.ts',
  },
  {
    area: 'Validation',
    verdict: 'complete',
    guard: 'validateWorkstationViewConfig — catalogue-only cells, rectangular, contiguous, hidden/areas, RGL bounds/overlap/duplicate/future-version; recap group 5',
    guardFile: 'src/lib/workstation-view-types.ts',
  },
  {
    area: 'Versioning/migration',
    verdict: 'complete',
    guard: 'WORKSTATION_LAYOUT_VERSION=2, WORKSTATION_DEFAULT_TEMPLATE_VERSION=3, total migrateWorkstationViewConfig; recap group 4',
    guardFile: 'src/lib/workstation-view-types.ts',
  },
  {
    area: 'Hide/show',
    verdict: 'complete',
    guard: 'OPTIONAL_PANEL_IDS + customize toggles; hiddenPanels validated against areas (recap group 5); customize-bar.test.tsx',
    guardFile: 'src/components/workstation/customize-bar.test.tsx',
  },
  {
    area: 'Customize mode',
    verdict: 'complete',
    guard: 'Explicit editing state (R035) — workstation-customize-context draft grid + customize-bar Save/Cancel/Undo/Reset; chrome mounted only while customizing',
    guardFile: 'src/components/workstation/customize-bar.test.tsx',
  },
  {
    area: 'Arrange mode',
    verdict: 'complete',
    guard: 'RGL v2 arrangement grid with static protected items and keyboard move/resize; workstation-arrange-grid.test.tsx',
    guardFile: 'src/components/workstation/workstation-arrange-grid.test.tsx',
  },
  {
    area: 'Drag/resize constraints',
    verdict: 'complete',
    guard: 'Catalogue min/max bounds; fixed anchors locked; validation cannot be loosened by persisted data (recap group 5)',
    guardFile: 'src/lib/workstation-view-types.test.ts',
  },
  {
    area: 'Protected anchors',
    verdict: 'complete',
    guard: 'FIXED_PANEL_IDS (risk, trades) — canHide/canDrag/canResize false, full-width in every template; recap group 3',
    guardFile: 'src/lib/workstation-view-types.test.ts',
  },
  {
    area: 'Account context',
    verdict: 'complete',
    guard: 'AccountProvider single owner, one fetch per session, first-active fallback; account-context.test.tsx',
    guardFile: 'src/lib/account-context.test.tsx',
  },
  {
    area: 'Date/period context',
    verdict: 'refine-retired',
    guard: 'Per-panel PNL-scope preference only (use-performance-pnl-scope); G1 closed by the Live vs Historical contract (recap groups 6/7)',
    guardFile: 'src/hooks/use-performance-pnl-scope.test.ts',
  },
  {
    area: 'Performance-unit context',
    verdict: 'deferred',
    guard: 'G3 — deliberately deferred per requirement §6.2; no global unit switch exists (recap group 6 pins the scope hook is the only one)',
  },
  {
    area: 'Live/historical separation',
    verdict: 'refine-retired',
    guard: 'Live adapter has no period/date filter; WorkstationContext never imports the scope hook; payload invariant proven in live-historical-contract.test.ts (recap group 6)',
    guardFile: 'src/lib/__tests__/live-historical-contract.test.ts',
  },
  {
    area: 'Shared data ownership',
    verdict: 'complete',
    guard: 'One owner per shared state (Account/Workstation/Views/Customize contexts); per-surface fetches only where established; AGENTS.md rule',
    guardFile: 'src/components/workstation/workstation-context.test.tsx',
  },
  {
    area: 'Market-data trust propagation',
    verdict: 'complete',
    guard: 'Freshness/trust fields in the v2 snapshot consumed by alert strip + risk tables; central freshness policy',
    guardFile: 'src/lib/accounting/__tests__/freshness-policy.test.ts',
  },
  {
    area: 'Responsive architecture',
    verdict: 'refine-retired',
    guard: 'Breakpoints at 1800px/980px + reduced-motion in workstation.css; e2e evidence at 1440/1280/1024 (G2 closed by S03); recap group 8',
    guardFile: 'e2e/workstation-responsive.spec.ts',
  },
];

/* ═══════════════════════════════════════════════════════════════════════
 * 2. Panel catalogue invariants (S01 #1/#4)
 * ═══════════════════════════════════════════════════════════════════════ */

/** Catalogue-key invariants: exactly the six first-party panels, in the
 *  canonical order, with no stray ids. */
function catalogueKeyViolations(
  catalogue: Record<string, unknown>,
  panelIdList: readonly string[],
): string[] {
  const violations: string[] = [];
  const keys = Object.keys(catalogue);
  if (keys.length !== panelIdList.length) {
    violations.push(`catalogue has ${keys.length} panels, expected ${panelIdList.length}`);
  }
  for (const expected of panelIdList) {
    if (!(expected in catalogue)) violations.push(`catalogue is missing panel "${expected}"`);
  }
  for (const key of keys) {
    if (!panelIdList.includes(key)) violations.push(`catalogue contains unknown panel "${key}"`);
  }
  return violations;
}

/** Every catalogue definition must be metadata-rich (R035: declared options
 *  only) — the fields the validation, customize, and arrange modes consume. */
function catalogueMetadataViolations(catalogue: Record<string, unknown>): string[] {
  const violations: string[] = [];
  for (const [id, def] of Object.entries(catalogue)) {
    if (typeof def !== 'object' || def === null) {
      violations.push(`panel "${id}" definition is not an object`);
      continue;
    }
    const d = def as Record<string, unknown>;
    for (const strField of ['id', 'title', 'description'] as const) {
      if (typeof d[strField] !== 'string' || d[strField].length === 0) {
        violations.push(`panel "${id}" ${strField} must be a non-empty string`);
      }
    }
    for (const boolField of ['canHide', 'canDrag', 'canResize', 'fill'] as const) {
      if (typeof d[boolField] !== 'boolean') {
        violations.push(`panel "${id}" ${boolField} must be a boolean`);
      }
    }
    for (const numField of ['minW', 'maxW', 'minH', 'maxH'] as const) {
      if (typeof d[numField] !== 'number' || !Number.isInteger(d[numField]) || d[numField] < 1) {
        violations.push(`panel "${id}" ${numField} must be a positive integer`);
      }
    }
    const minW = d.minW as number;
    const maxW = d.maxW as number;
    const minH = d.minH as number;
    const maxH = d.maxH as number;
    if (minW > maxW) violations.push(`panel "${id}" declares minW > maxW`);
    if (minH > maxH) violations.push(`panel "${id}" declares minH > maxH`);
    if (d.id !== id) violations.push(`panel "${id}" definition id does not match its key`);
  }
  return violations;
}

/* ═══════════════════════════════════════════════════════════════════════
 * 3. Fixed-anchor and template invariants (S01 #2/#9/#10)
 * ═══════════════════════════════════════════════════════════════════════ */

interface TemplateLike {
  readonly areas: readonly (readonly string[])[];
  readonly defaultHidden: readonly string[];
  readonly isSystemDefault?: boolean;
}

/** The protected-anchor invariant: risk and trades must be visible and
 *  full-width (span the whole grid row) in every curated template. */
function fixedAnchorViolations(
  templates: Record<string, TemplateLike>,
  fixedIds: readonly string[],
  catalogue: Record<string, unknown>,
): string[] {
  const violations: string[] = [];
  for (const [templateId, template] of Object.entries(templates)) {
    const colCount = template.areas[0]?.length ?? 0;
    for (const id of fixedIds) {
      const fixed = catalogue[id] as Record<string, unknown> | undefined;
      const fullWidth = fixed && fixed.minW === colCount && fixed.maxW === colCount;
      let present = false;
      for (const [r, row] of template.areas.entries()) {
        if (!row.includes(id)) continue;
        present = true;
        if (!fullWidth || !row.every((cell) => cell === id)) {
          violations.push(
            `template "${templateId}" places fixed panel "${id}" at row ${r} without spanning the full ${colCount}-column width`,
          );
        }
      }
      if (!present) {
        violations.push(`template "${templateId}" does not include fixed panel "${id}"`);
      }
    }
  }
  return violations;
}

/** Catalogue-only rule + hidden/areas consistency per curated template. */
function templateConsistencyViolations(
  templates: Record<string, TemplateLike>,
  panelIdList: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const [templateId, template] of Object.entries(templates)) {
    const colCount = template.areas[0]?.length ?? 0;
    for (const [r, row] of template.areas.entries()) {
      if (row.length !== colCount) {
        violations.push(`template "${templateId}" row ${r} is ragged (${row.length} vs ${colCount} columns)`);
      }
      for (const cell of row) {
        if (cell !== GRID_EMPTY_CELL && !panelIdList.includes(cell)) {
          violations.push(`template "${templateId}" row ${r} references non-catalogue cell "${cell}"`);
        }
      }
    }
    const present = new Set<string>();
    for (const row of template.areas) {
      for (const cell of row) {
        if (cell !== GRID_EMPTY_CELL) present.add(cell);
      }
    }
    const hidden = new Set<string>(template.defaultHidden);
    for (const id of panelIdList) {
      const inAreas = present.has(id);
      const isHidden = hidden.has(id);
      if (inAreas && isHidden) {
        violations.push(`template "${templateId}" panel "${id}" is in areas and defaultHidden`);
      } else if (!inAreas && !isHidden) {
        violations.push(`template "${templateId}" panel "${id}" is neither in areas nor defaultHidden`);
      }
    }
  }
  return violations;
}

/* ═══════════════════════════════════════════════════════════════════════
 * 6. Context-separation scanners (S02 contract)
 * ═══════════════════════════════════════════════════════════════════════ */

/** Words that mean a date-window or period filter — the live adapter must
 *  never take a parameter or build a query key from this vocabulary. */
const PERIOD_DATE_WORDS = [
  'period', 'periods', 'range', 'daterange', 'datefrom', 'dateto',
  'fromdate', 'todate', 'startdate', 'enddate', 'since', 'lookback',
  'timeframe', 'window', 'bucket',
] as const;

function bannedVocabularyHits(text: string): string[] {
  const lower = text.toLowerCase();
  return (PERIOD_DATE_WORDS as readonly string[]).filter((word) =>
    new RegExp(`\\b${word}\\b`).test(lower),
  );
}

/** Exported async function signatures from an adapter-like source. */
function exportedAsyncFunctions(source: string): Array<{ name: string; paramsText: string }> {
  const fns: Array<{ name: string; paramsText: string }> = [];
  const re = /^export\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  for (const m of source.matchAll(re)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close >= 0) fns.push({ name: m[1], paramsText: source.slice(open + 1, close) });
  }
  return fns;
}

/** Period/date violations in an adapter source: parameter vocabulary on any
 *  exported async function, plus period/date keys in URLSearchParams. */
function adapterPeriodViolations(source: string): string[] {
  const violations: string[] = [];
  for (const fn of exportedAsyncFunctions(source)) {
    for (const word of bannedVocabularyHits(fn.paramsText)) {
      violations.push(`${fn.name}: ${word} parameter`);
    }
  }
  for (const m of source.matchAll(/URLSearchParams\(\{([^}]*)\}\)/g)) {
    for (const key of [...m[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0])) {
      if (bannedVocabularyHits(key).length > 0) violations.push(`query key: ${key}`);
    }
  }
  return violations;
}

/** Import-edge violations: the live data path must never import the P&L
 *  scope preference; only performance-panel.tsx may consume the hook. */
function scopeImportEdgeViolations(
  adapterSrc: string,
  contextSrc: string,
  componentFiles: string[],
): string[] {
  const violations: string[] = [];
  if (/performance-pnl-scope/.test(adapterSrc)) {
    violations.push('workstation-live-adapter.ts imports the P&L scope module');
  }
  if (/performance-pnl-scope/.test(contextSrc)) {
    violations.push('workstation-context.tsx imports the P&L scope module');
  }
  const consumers = componentFiles
    .filter((file) => /from\s+['"][^'"]*use-performance-pnl-scope['"]/.test(fs.readFileSync(file, 'utf-8')))
    .map((file) => path.basename(file));
  if (consumers.length !== 1 || consumers[0] !== 'performance-panel.tsx') {
    violations.push(
      `P&L scope hook consumers drifted: ${consumers.length === 0 ? 'none' : consumers.join(', ')} (expected exactly performance-panel.tsx)`,
    );
  }
  return violations;
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1. Capability-area recap index
 * ═══════════════════════════════════════════════════════════════════════ */

describe('capability-area recap index (S01 17-area audit)', () => {
  it('indexes all 17 audited capability areas', () => {
    expect(CAPABILITY_AREAS).toHaveLength(17);
    const names = CAPABILITY_AREAS.map((c) => c.area);
    expect(new Set(names).size).toBe(17);
  });

  it('every area carries a guard, and non-deferred guards resolve to a file on disk', () => {
    for (const entry of CAPABILITY_AREAS) {
      expect(entry.guard.length, `${entry.area} must name its guard`).toBeGreaterThan(10);
      if (entry.verdict !== 'deferred') {
        expect(entry.guardFile, `${entry.area} must be backed by a guard file`).toBeDefined();
        const p = path.resolve(process.cwd(), entry.guardFile as string);
        expect(fs.existsSync(p), `${entry.area} guard file missing: ${entry.guardFile}`).toBe(true);
      }
    }
  });

  it('records the three S01 gaps: G1 and G2 retired, G3 deferred', () => {
    const retired = CAPABILITY_AREAS.filter((c) => c.verdict === 'refine-retired');
    expect(retired.map((c) => c.area).sort()).toEqual([
      'Date/period context',
      'Live/historical separation',
      'Responsive architecture',
    ]);
    const deferred = CAPABILITY_AREAS.filter((c) => c.verdict === 'deferred');
    expect(deferred.map((c) => c.area)).toEqual(['Performance-unit context']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2. Panel catalogue invariants
 * ═══════════════════════════════════════════════════════════════════════ */

describe('panel catalogue invariants (S01 #1/#4)', () => {
  it('defines exactly the six first-party panels in canonical order', () => {
    expect(catalogueKeyViolations(WORKSTATION_PANEL_CATALOGUE, WORKSTATION_PANEL_ID_LIST)).toEqual([]);
    expect(WORKSTATION_PANEL_ID_LIST).toHaveLength(6);
    expect(WORKSTATION_PANEL_ID_LIST).toEqual([
      WORKSTATION_PANEL_IDS.RISK,
      WORKSTATION_PANEL_IDS.TRADES,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
  });

  it('every catalogue definition is metadata-rich and internally consistent', () => {
    expect(catalogueMetadataViolations(WORKSTATION_PANEL_CATALOGUE)).toEqual([]);
  });

  it('isWorkstationPanelId accepts exactly the catalogue ids', () => {
    for (const id of WORKSTATION_PANEL_ID_LIST) {
      expect(isWorkstationPanelId(id)).toBe(true);
    }
    for (const stranger of ['hacker-panel', 'kpis', 'positions', '', 42, null]) {
      expect(isWorkstationPanelId(stranger)).toBe(false);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3. Fixed-anchor and template invariants
 * ═══════════════════════════════════════════════════════════════════════ */

describe('fixed-anchor and template invariants (S01 #2/#9/#10)', () => {
  it('FIXED_PANEL_IDS is exactly [risk, trades]', () => {
    expect(FIXED_PANEL_IDS).toEqual([WORKSTATION_PANEL_IDS.RISK, WORKSTATION_PANEL_IDS.TRADES]);
  });

  it('fixed anchors are locked: canHide/canDrag/canResize false and full-width in the catalogue', () => {
    for (const id of FIXED_PANEL_IDS) {
      const def = WORKSTATION_PANEL_CATALOGUE[id];
      expect(def.canHide, `${id} must be always visible`).toBe(false);
      expect(def.canDrag, `${id} must not be draggable`).toBe(false);
      expect(def.canResize, `${id} must not be resizable`).toBe(false);
      expect(def.minW, `${id} full-width min`).toBe(3);
      expect(def.maxW, `${id} full-width max`).toBe(3);
    }
    // The remaining four panels are the optional set.
    expect(OPTIONAL_PANEL_IDS).toHaveLength(4);
    for (const id of OPTIONAL_PANEL_IDS) {
      expect(FIXED_PANEL_IDS).not.toContain(id);
    }
  });

  it('every curated template keeps both anchors visible and full-width', () => {
    expect(fixedAnchorViolations(WORKSTATION_TEMPLATES, FIXED_PANEL_IDS, WORKSTATION_PANEL_CATALOGUE)).toEqual([]);
  });

  it('templates are rectangular, catalogue-only, and hidden/areas consistent', () => {
    expect(templateConsistencyViolations(WORKSTATION_TEMPLATES, WORKSTATION_PANEL_ID_LIST)).toEqual([]);
  });

  it('has exactly one system default template (risk-positions, immutable)', () => {
    const defaults = Object.values(WORKSTATION_TEMPLATES).filter((t) => t.isSystemDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
  });

  it('the dense default keeps the curated summary row (Account State | Performance)', () => {
    const def = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    // risk row full-width, account|perf|perf summary row, trades row full-width.
    expect(def.areas).toEqual([
      ['risk', 'risk', 'risk'],
      ['account', 'perf', 'perf'],
      ['trades', 'trades', 'trades'],
    ]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4. Layout-version and migration invariants
 * ═══════════════════════════════════════════════════════════════════════ */

describe('layout-version and migration invariants (S01 #5)', () => {
  it('pins the supported layout version and default-template version', () => {
    expect(WORKSTATION_LAYOUT_VERSION).toBe(2);
    expect(WORKSTATION_DEFAULT_TEMPLATE_VERSION).toBe(3);
  });

  it('createViewFromTemplate always emits the current version with a derived layout', () => {
    for (const templateId of Object.values(WORKSTATION_TEMPLATE_IDS)) {
      const config = createViewFromTemplate(templateId);
      expect(config.version).toBe(WORKSTATION_LAYOUT_VERSION);
      expect(config.layout?.length).toBeGreaterThan(0);
      expect(isValidWorkstationViewConfig(config)).toBe(true);
    }
  });

  it('migration is total: every hostile input falls back to a valid dense default', () => {
    const hostileInputs: unknown[] = [
      null,
      undefined,
      42,
      'garbage',
      {},
      [],
      { areas: 'not-an-array' },
      { templateId: 'mystery', areas: [], hiddenPanels: [], version: 2 },
      { templateId: 'risk-positions', areas: [['risk']], hiddenPanels: [], version: 1 },
      { templateId: 'risk-positions', areas: [['risk', 'risk', 'risk']], hiddenPanels: ['review'], version: 99 },
    ];
    for (const input of hostileInputs) {
      const migrated = migrateWorkstationViewConfig(input);
      expect(isValidWorkstationViewConfig(migrated), `migration of ${JSON.stringify(input)} must yield a valid config`).toBe(true);
      expect(migrated.templateId).toBe(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    }
  });

  it('future-version configs fall back to the dense default rather than rendering', () => {
    const future = {
      ...createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE),
      version: WORKSTATION_LAYOUT_VERSION + 1,
    };
    const migrated = migrateWorkstationViewConfig(future);
    expect(migrated.templateId).toBe(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(migrated.version).toBe(WORKSTATION_LAYOUT_VERSION);
  });

  it('migrates an unmodified former v2 risk-positions default to the current default', () => {
    // The pre-M018 composition: Review Metrics in the summary row, watchlist hidden.
    const formerDefault = {
      templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
      areas: [
        ['risk', 'risk', 'risk'],
        ['account', 'perf', 'review'],
        ['trades', 'trades', 'trades'],
      ],
      hiddenPanels: [WORKSTATION_PANEL_IDS.WATCHLIST],
      version: 2,
    };
    const migrated = migrateWorkstationViewConfig(formerDefault);
    // Current default: review hidden, performance widened to two columns.
    expect(migrated.hiddenPanels).toContain(WORKSTATION_PANEL_IDS.PROCESS_REVIEW);
    expect(migrated.areas[1]).toEqual(['account', 'perf', 'perf']);
    expect(isValidWorkstationViewConfig(migrated)).toBe(true);
  });

  it('migrates a user-modified v1 view: positions→trades, kpis→empty cells, version bumped', () => {
    // Deliberately NOT the former risk-positions template: rows 3 and 4 are
    // swapped (review/watchlist order reversed), so migration must take the
    // user-modified translation branch rather than the former-template
    // replacement branch.
    const v1 = {
      templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
      areas: [
        ['risk', 'risk'],
        ['positions', 'account'],
        ['positions', 'perf'],
        ['positions', 'watchlist'],
        ['positions', 'review'],
        ['kpis', 'kpis'],
      ],
      hiddenPanels: [],
      version: 1,
    };
    const migrated = migrateWorkstationViewConfig(v1);
    expect(migrated.version).toBe(WORKSTATION_LAYOUT_VERSION);
    const flat = migrated.areas.flat();
    expect(flat).not.toContain('positions');
    expect(flat).not.toContain('kpis');
    expect(flat).toContain(WORKSTATION_PANEL_IDS.TRADES);
    expect(isValidWorkstationViewConfig(migrated)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5. Validation invariants
 * ═══════════════════════════════════════════════════════════════════════ */

describe('validation invariants (S01 #4/#9, R035)', () => {
  it('accepts every curated template config', () => {
    for (const templateId of Object.values(WORKSTATION_TEMPLATE_IDS)) {
      expect(validateWorkstationViewConfig(createViewFromTemplate(templateId))).toEqual([]);
    }
  });

  it('rejects catalogue-foreign cells (arbitrary component names)', () => {
    const cfg = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    cfg.areas[0][0] = 'hacker-panel';
    const issues = validateWorkstationViewConfig(cfg);
    expect(issues.some((i) => i.includes('not in the approved panel catalogue'))).toBe(true);
  });

  it('rejects ragged (non-rectangular) grids', () => {
    const cfg = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    cfg.areas[1] = ['account', 'perf'];
    const issues = validateWorkstationViewConfig(cfg);
    expect(issues.some((i) => i.includes('rectangular grid'))).toBe(true);
  });

  it('rejects split / L-shaped panel regions', () => {
    const cfg = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    // Move perf into two disconnected cells via the summary row.
    cfg.areas = [
      ['risk', 'risk', 'risk'],
      ['account', 'perf', '.'],
      ['trades', 'trades', 'trades'],
      ['perf', '.', '.'],
    ];
    const issues = validateWorkstationViewConfig(cfg);
    expect(issues.some((i) => i.includes('single contiguous rectangle'))).toBe(true);
  });

  it('rejects hiding a fixed panel', () => {
    const cfg = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    cfg.hiddenPanels = [WORKSTATION_PANEL_IDS.RISK];
    const issues = validateWorkstationViewConfig(cfg);
    expect(issues.some((i) => i.includes('required (canHide: false)'))).toBe(true);
  });

  it('rejects hidden/areas inconsistency (panel neither visible nor hidden)', () => {
    const cfg = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    cfg.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST]; // review dropped from hidden, absent from areas
    const issues = validateWorkstationViewConfig(cfg);
    expect(issues.some((i) => i.includes('neither present in areas nor listed in hiddenPanels'))).toBe(true);
  });

  it('rejects unknown and duplicate hidden panels', () => {
    const cfg = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    cfg.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST, 'mystery' as WorkstationPanelId];
    const issues = validateWorkstationViewConfig(cfg);
    expect(issues.some((i) => i.includes('not in the approved panel catalogue'))).toBe(true);

    const cfg2 = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    cfg2.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST, WORKSTATION_PANEL_IDS.PROCESS_REVIEW, WORKSTATION_PANEL_IDS.WATCHLIST];
    const issues2 = validateWorkstationViewConfig(cfg2);
    expect(issues2.some((i) => i.includes('more than once'))).toBe(true);
  });

  it('rejects future layout versions', () => {
    const cfg = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    cfg.version = WORKSTATION_LAYOUT_VERSION + 1;
    const issues = validateWorkstationViewConfig(cfg);
    expect(issues.some((i) => i.includes('newer than the supported layout version'))).toBe(true);
  });

  it('rejects RGL layout duplicates and overlaps', () => {
    const dup = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    dup.layout = [...(dup.layout ?? [])];
    dup.layout.push({ ...dup.layout[0] }); // duplicate risk item
    expect(validateWorkstationViewConfig(dup).some((i) => i.includes('more than once'))).toBe(true);

    const overlap = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    // Layout order follows WORKSTATION_PANEL_ID_LIST: risk, trades, account, perf.
    // Moving item 1 (trades) onto risk's rectangle forces the overlap check.
    overlap.layout = (overlap.layout ?? []).map((item, idx) =>
      idx === 1 ? { ...item, x: 0, y: 0 } : item,
    );
    expect(validateWorkstationViewConfig(overlap).some((i) => i.includes('overlap'))).toBe(true);
  });

  it('rejects out-of-bounds layout coordinates and size-constraint violations', () => {
    const oob = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    oob.layout = (oob.layout ?? []).map((item, idx) =>
      idx === 1 ? { ...item, x: 2 } : item, // account x=2 + w=2 exceeds 3 columns
    );
    expect(validateWorkstationViewConfig(oob).some((i) => i.includes('past the right grid edge'))).toBe(true);

    const narrow = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    narrow.layout = (narrow.layout ?? []).map((item, idx) =>
      idx === 0 ? { ...item, w: 1 } : item, // risk narrowed below its locked full-width
    );
    expect(validateWorkstationViewConfig(narrow).some((i) => i.includes('outside the declared bounds'))).toBe(true);
  });

  it('persisted data cannot loosen the catalogue bounds (declared constraints are checked)', () => {
    const cfg = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    cfg.layout = (cfg.layout ?? []).map((item, idx) =>
      idx === 0 ? { ...item, minW: 1, maxW: 1 } : item, // risk claims looser bounds than the catalogue
    );
    const issues = validateWorkstationViewConfig(cfg);
    expect(issues.some((i) => i.includes('outside the catalogue bounds'))).toBe(true);
  });

  it('rejects an oversized layout array (catalogue caps visible panels)', () => {
    const cfg = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    cfg.layout = [...(cfg.layout ?? []), ...(cfg.layout ?? [])];
    const issues = validateWorkstationViewConfig(cfg);
    expect(issues.some((i) => i.includes('catalogue only defines'))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6. Context-separation invariants (S02 contract)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('context-separation invariants (S02 live/historical contract)', () => {
  it('the live adapter module loads with its documented fetch surface', () => {
    expect(typeof fetchAllLiveDashboardData).toBe('function');
    expect(typeof fetchDashboardLive).toBe('function');
    expect(typeof fetchAccountsLive).toBe('function');
    expect(fetchAllLiveDashboardData.length).toBeGreaterThanOrEqual(1); // accountId, signal, options
  });

  it('WorkstationContext loads with its provider and hook (single owner contract)', () => {
    expect(typeof WorkstationProvider).toBe('function');
    expect(typeof useWorkstation).toBe('function');
  });

  it('the live adapter exposes no period or date filter', () => {
    expect(adapterPeriodViolations(adapterSource)).toEqual([]);
  });

  it('no import edge connects the live data path to the P&L scope preference', () => {
    expect(scopeImportEdgeViolations(adapterSource, contextSource, workstationComponentFiles)).toEqual([]);
  });

  it('the scope hook exists and is the only per-panel selector (positive control)', () => {
    // G3 pin: there is no global unit/date context — the P&L scope hook is
    // the workstation's only per-panel preference, consumed by exactly one
    // panel. The scope module itself is versioned and tested.
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/hooks/use-performance-pnl-scope.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/hooks/use-performance-pnl-scope.test.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/lib/performance-pnl-scope.ts'))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 7. Doc-code alignment invariants
 * ═══════════════════════════════════════════════════════════════════════ */

describe('doc-code alignment invariants (S01/S02)', () => {
  it('workstation.md documents the Live vs Historical scope contract', () => {
    expect(docSource).toContain('### Live vs Historical scope contract');
    expect(docSource).toContain('**Current-state panels.**');
    expect(docSource).toContain('**Retrospective panels.**');
    expect(docSource).toContain('**Separation rule.**');
  });

  it('workstation.md documents the canonical panel testids', () => {
    for (const testid of ['ws-panel-risk', 'ws-panel-positions', 'ws-panel-watchlist', 'ws-panel-insights', 'ws-panel-performance', 'ws-panel-equity']) {
      expect(docSource, `doc must cite ${testid}`).toContain(testid);
    }
  });

  it('the dedicated doc-code and contract guards exist', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/lib/__tests__/workstation-docs.test.ts'))).toBe(true);
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/lib/__tests__/live-historical-contract.test.ts'))).toBe(true);
  });

  it('workstation.css defines the ws- surface the doc documents', () => {
    expect(cssSource).toContain('.ws-');
    expect(cssSource).toContain('--ws-');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 8. Responsive architecture invariants (S03)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('responsive architecture invariants (S03, G2 retired)', () => {
  it('workstation.css keeps the dense breakpoints and reduced-motion guard', () => {
    expect(cssSource).toContain('@media (max-width: 1800px)');
    expect(cssSource).toContain('@media (max-width: 980px)');
    expect(cssSource).toContain('prefers-reduced-motion');
  });

  it('the S03 responsive e2e spec covers the three mandated widths', () => {
    const spec = loadSource(
      path.resolve(process.cwd(), 'e2e/workstation-responsive.spec.ts'),
      'e2e/workstation-responsive.spec.ts',
      1000,
    );
    for (const width of ['1440', '1280', '1024']) {
      expect(spec, `responsive spec must cover ${width}px`).toContain(width);
    }
  });

  it('the S04 theme×viewport UAT spec covers both themes and the three widths', () => {
    const spec = loadSource(
      path.resolve(process.cwd(), 'e2e/m026-s04-workstation-architecture-uat.spec.ts'),
      'e2e/m026-s04-workstation-architecture-uat.spec.ts',
      1000,
    );
    for (const width of ['1440', '1280', '1024']) {
      expect(spec, `S04 UAT spec must cover ${width}px`).toContain(width);
    }
    for (const theme of ['light', 'dark']) {
      expect(spec, `S04 UAT spec must cover the ${theme} theme`).toContain(theme);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 9. Scanner self-test (the recap rejects drift)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('scanner self-test (the recap rejects drift)', () => {
  it('flags a catalogue that gains a foreign panel or drops a metadata field', () => {
    const doctored = { ...WORKSTATION_PANEL_CATALOGUE, 'hacker-panel': { id: 'hacker-panel' } };
    expect(catalogueKeyViolations(doctored, WORKSTATION_PANEL_ID_LIST)).toContain(
      'catalogue contains unknown panel "hacker-panel"',
    );
    // Rebuild without the watchlist entry — a spread of the const catalogue
    // keeps read-only property modifiers, so delete is not allowed.
    const slim = Object.fromEntries(
      Object.entries(WORKSTATION_PANEL_CATALOGUE).filter(([id]) => id !== WORKSTATION_PANEL_IDS.WATCHLIST),
    );
    expect(catalogueKeyViolations(slim, WORKSTATION_PANEL_ID_LIST)).toContain(
      'catalogue is missing panel "watchlist"',
    );
    expect(catalogueMetadataViolations({ ...WORKSTATION_PANEL_CATALOGUE, risk: { id: 'risk' } })).toEqual(
      expect.arrayContaining(['panel "risk" canHide must be a boolean']),
    );
  });

  it('flags a template that drops a fixed anchor or narrows it below full width', () => {
    const noTrades = {
      ...WORKSTATION_TEMPLATES,
      [WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS]: {
        ...WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS],
        areas: [
          ['risk', 'risk', 'risk'],
          ['account', 'perf', 'perf'],
          ['account', 'perf', 'perf'],
        ],
      },
    };
    expect(fixedAnchorViolations(noTrades, FIXED_PANEL_IDS, WORKSTATION_PANEL_CATALOGUE)).toEqual(
      expect.arrayContaining([expect.stringContaining('does not include fixed panel "trades"')]),
    );

    const narrowTrades = {
      ...WORKSTATION_TEMPLATES,
      [WORKSTATION_TEMPLATE_IDS.PERFORMANCE]: {
        ...WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PERFORMANCE],
        areas: [
          ['risk', 'risk', 'risk'],
          ['account', 'account', '.'],
          ['trades', 'trades', '.'],
          ['perf', 'perf', 'perf'],
          ['perf', 'perf', 'perf'],
        ],
      },
    };
    expect(fixedAnchorViolations(narrowTrades, FIXED_PANEL_IDS, WORKSTATION_PANEL_CATALOGUE)).toEqual(
      expect.arrayContaining([expect.stringContaining('without spanning the full')]),
    );
  });

  it('flags a template referencing a non-catalogue cell or a broken hidden set', () => {
    const foreign = {
      ...WORKSTATION_TEMPLATES,
      [WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS]: {
        ...WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS],
        areas: [['risk', 'risk', 'risk'], ['account', 'hacker', 'perf'], ['trades', 'trades', 'trades']],
      },
    };
    expect(templateConsistencyViolations(foreign, WORKSTATION_PANEL_ID_LIST)).toEqual(
      expect.arrayContaining([expect.stringContaining('non-catalogue cell "hacker"')]),
    );
  });

  it('flags the live adapter gaining a period parameter or query key', () => {
    const doctored = adapterSource.replace(
      'export async function fetchDashboardLive(\n  accountId: string,\n  signal?: AbortSignal,\n)',
      'export async function fetchDashboardLive(\n  accountId: string,\n  period: string,\n  signal?: AbortSignal,\n)',
    );
    expect(adapterPeriodViolations(doctored)).toEqual(
      expect.arrayContaining([expect.stringContaining('fetchDashboardLive: period parameter')]),
    );

    const queryDoctored = adapterSource.replace(
      'const params = new URLSearchParams({ accountId });',
      'const params = new URLSearchParams({ accountId, period });',
    );
    expect(adapterPeriodViolations(queryDoctored)).toEqual(
      expect.arrayContaining([expect.stringContaining('query key: period')]),
    );
  });

  it('flags the live data path importing the P&L scope module', () => {
    const doctoredAdapter = `${adapterSource}\nimport { usePerformancePnlScope } from '@/hooks/use-performance-pnl-scope';\n`;
    expect(scopeImportEdgeViolations(doctoredAdapter, contextSource, workstationComponentFiles)).toEqual(
      expect.arrayContaining([expect.stringContaining('workstation-live-adapter.ts imports')]),
    );
    const doctoredContext = contextSource.replace(
      "import {\n  fetchAllLiveDashboardData,",
      "import { usePerformancePnlScope } from '@/hooks/use-performance-pnl-scope';\n\nimport {\n  fetchAllLiveDashboardData,",
    );
    expect(scopeImportEdgeViolations(adapterSource, doctoredContext, workstationComponentFiles)).toEqual(
      expect.arrayContaining([expect.stringContaining('workstation-context.tsx imports')]),
    );
  });

  it('flags a second component consuming the P&L scope hook', () => {
    const fakeConsumer = `${WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.RISK].title}\nimport { usePerformancePnlScope } from '@/hooks/use-performance-pnl-scope';`;
    const tmp = path.join(COMPONENTS_DIR, '__recap_self_test_fake.tsx');
    fs.writeFileSync(tmp, fakeConsumer);
    try {
      const files = [...workstationComponentFiles, tmp];
      expect(scopeImportEdgeViolations(adapterSource, contextSource, files)).toEqual(
        expect.arrayContaining([expect.stringContaining('P&L scope hook consumers drifted')]),
      );
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
