/**
 * surface-token-migration.test.ts — M014/S05/T01
 *
 * Source-parsing contract test enforcing the S05 all-surfaces semantic token
 * migration. It is the S05 parallel of:
 *   - token-structure.test.ts          (S01 — guards globals.css token definitions)
 *   - primitive-contracts.test.ts      (S03 — guards the 14 UI primitives)
 *   - chart-palette-migration.test.ts  (S04 — guards the 9 dashboard chart widgets)
 * This file guards every REMAINING application surface: pages and layouts
 * under `src/app` and components under `src/components`.
 *
 * What is banned (arbitrary Tailwind color literals):
 *   1. Palette-shade utilities — text-zinc-*, bg-emerald-*, border-red-*,
 *      ring-blue-*, fill/from/via/to-*, outline/accent/shadow-*, placeholder-*,
 *      etc. — across the full Tailwind v4 default palette (incl. opacity
 *      modifiers like /50 or /[50%]).
 *   2. Theme-blind black/white utilities — text-white, bg-black/10,
 *      border-white/20, ... (theme-blind: they do not respond to the dark
 *      theme; the S01 system replaces them with semantic tokens such as
 *      bg-overlay / text-primary-foreground).
 *   3. Arbitrary-value color utilities carrying literal colors —
 *      bg-[#0f172a], text-[rgb(...)], shadow-[0_2px_8px_rgba(...)], ... .
 *      Token-driven arbitrary values (var(--...)) and pure-length values
 *      (text-[10px], border-[1px]) are allowed.
 *
 * Out of scope (slice contract: "outside dev/ and test files"):
 *   - src/app/dev/** — design-system proof surfaces (dev/charts, dev/tokens, ...)
 *   - src/app/api/** — route handlers, not rendering surfaces
 *   - test files and __tests__ directories
 *   - hex / rgb() / oklch() literals inside JS object literals and ECharts
 *     option configs — that is chart-palette territory (S04 contract), not
 *     Tailwind class names (S05). (Observed on 2026-08-03:
 *     src/components/workstation/equity-chart.tsx is the only remaining
 *     surface with such literals and is intentionally outside this contract.)
 *
 * Allowlist protocol (the "EXEMPT_FILES" mechanism from the slice plan):
 *   Files still awaiting migration are listed in EXEMPT_FILES below, grouped
 *   by the task that migrates them (T02 trade-detail, T03 dashboard + root
 *   shared, T04 accounting, T05 legacy settings, T06 remaining pages). Each
 *   migration task removes its files from the list as it migrates them; the
 *   list MUST be empty when the slice completes. Two hygiene guards keep the
 *   list honest:
 *     * every exempt file must currently contain ≥1 violation — a clean file
 *       that stays on the list is a stale entry and fails,
 *     * every non-exempt surface must be clean — a regression fails and the
 *       test names the file and line.
 *
 * Reading sources from disk is intentional (the same approach as the token,
 * primitive, and chart-palette contracts): a reintroduced literal fails at
 * the source level, before any rendering. Runs under vitest (jsdom env is
 * fine — no DOM interaction here).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

/* ── Surface file discovery ────────────────────────────────────────────── */

const APP_DIR = path.resolve(process.cwd(), 'src/app');
const COMPONENTS_DIR = path.resolve(process.cwd(), 'src/components');

/**
 * Recursively collect surface source files:
 *   - under src/app: .tsx only (pages/layouts), skipping api/ and dev/
 *   - under src/components: .tsx and .ts (components + class-name helpers)
 *   - skipping __tests__ directories and *.test.* / *.spec.* files
 */
function walkSurfaces(
  dir: string,
  extensions: string[],
  skipDirs: string[] = [],
  out: string[] = [],
): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || skipDirs.includes(entry.name)) {
        continue;
      }
      walkSurfaces(full, extensions, skipDirs, out);
    } else if (
      extensions.some((ext) => entry.name.endsWith(ext)) &&
      !/(?:\.test|\.spec)\.(?:ts|tsx)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

function surfaceFiles(): string[] {
  return [
    ...walkSurfaces(APP_DIR, ['.tsx'], ['api', 'dev']),
    ...walkSurfaces(COMPONENTS_DIR, ['.tsx', '.ts']),
  ];
}

/** Project-root-relative path, forward slashes (matches EXEMPT_FILES entries). */
function relPath(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

/* ── Arbitrary Tailwind color literal scanner ──────────────────────────── */

/**
 * Color-utility prefixes that take a color argument in Tailwind v4 (plus the
 * v3-style `placeholder-<color>` form still present in some legacy files and
 * side-specific border colors for future-proofing).
 */
const COLOR_UTILITIES = [
  'text',
  'bg',
  'border',
  'border-x',
  'border-y',
  'border-t',
  'border-b',
  'border-l',
  'border-r',
  'border-s',
  'border-e',
  'ring',
  'ring-offset',
  'fill',
  'stroke',
  'divide',
  'from',
  'via',
  'to',
  'outline',
  'accent',
  'shadow',
  'decoration',
  'caret',
  'placeholder',
].join('|');

/** The Tailwind v4 default palette names (all of them, incl. legacy aliases). */
const PALETTES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'].join('|');

/** Optional Tailwind opacity modifier: /50, /50.5, /[50%]. */
const OPACITY = String.raw`(?:\/(?:\d+(?:\.\d+)?|\[\d+(?:\.\d+)?%\]))?`;

/** 1. text-zinc-500, bg-emerald-50/30, hover:border-red-400, placeholder-zinc-400, ... */
const PALETTE_SHADE_RE = new RegExp(
  String.raw`(?<![\w-])(?:${COLOR_UTILITIES})-(?:${PALETTES})-(?:${SHADES})${OPACITY}\b`,
  'g',
);

/** 2. text-white, bg-black/10, border-white/20, dark:text-white, ... */
const BLACK_WHITE_RE = new RegExp(
  String.raw`(?<![\w-])(?:${COLOR_UTILITIES})-(?:black|white)${OPACITY}\b`,
  'g',
);

/** 3. arbitrary-value color utilities: bg-[#0f172a], text-[10px], ... */
const ARBITRARY_VALUE_RE =
  /(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|via|to|outline|accent|shadow|decoration)-\[([^\]]*)\]/g;

/** Pure lengths (text-[10px]) are font sizes / sizes, not colors. */
const PURE_LENGTH_RE = /^[\d.]+(?:rem|em|px|vh|vw|%)?$/;
/** Non-color type-hint prefixes inside arbitrary values (length:, url:, image:, color-mix:). */
const NON_COLOR_HINT_RE = /^(?:length|size|position|url|image|color-mix):/;

interface Violation {
  line: number;
  literal: string;
}

/** Scan source for arbitrary Tailwind color literals, returning line-numbered hits. */
function findViolations(source: string): Violation[] {
  const hits: Violation[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineno = i + 1;
    const line = lines[i];
    for (const m of line.matchAll(PALETTE_SHADE_RE)) hits.push({ line: lineno, literal: m[0] });
    for (const m of line.matchAll(BLACK_WHITE_RE)) hits.push({ line: lineno, literal: m[0] });
    for (const m of line.matchAll(ARBITRARY_VALUE_RE)) {
      const inner = m[1].trim();
      if (inner.includes('var(--')) continue; // token-driven, e.g. bg-[var(--x)]
      if (PURE_LENGTH_RE.test(inner)) continue; // font size / dimension, e.g. text-[10px]
      if (NON_COLOR_HINT_RE.test(inner)) continue; // type-hinted values, e.g. length:200px
      hits.push({ line: lineno, literal: m[0] });
    }
  }
  return hits;
}

function violationsInFile(file: string): Violation[] {
  return findViolations(fs.readFileSync(file, 'utf-8'));
}

/* ── Allowlist: files still awaiting migration (shrinks per task T02–T06) ── */

/**
 * Files that still contain arbitrary Tailwind color literals and are pending
 * migration. Grouped by the task that migrates them. Each task removes its
 * files from this list as it migrates them; the list must be EMPTY when the
 * slice completes (T06). The groups below were populated from a repo-wide
 * scan on 2026-08-03 (89 files, 5507 palette-shade + 194 black/white hits).
 */
const EXEMPT_FILES: readonly string[] = [
  /* ── T02: trade-detail components (18 listed + helpers.ts) — MIGRATED in T02 ── */

  /* ── T03: dashboard widgets + root shared components (32 listed + formatting.ts) ── */
  'src/components/dashboard/account-performance-panel.tsx',
  'src/components/dashboard/account-selector.tsx',
  'src/components/dashboard/attention-insights-widget.tsx',
  'src/components/dashboard/calendar-heatmap-widget.tsx',
  'src/components/dashboard/current-risk-panel.tsx',
  'src/components/dashboard/dashboard-toolbar.tsx',
  'src/components/dashboard/directional-performance-widget.tsx',
  'src/components/dashboard/equity-drawdown-chart.tsx',
  'src/components/dashboard/formatting.ts',
  'src/components/dashboard/kpi-card.tsx',
  'src/components/dashboard/kpi-widgets.tsx',
  'src/components/dashboard/manage-views-dialog.tsx',
  'src/components/dashboard/monthly-performance-chart.tsx',
  'src/components/dashboard/open-positions-risk-widget.tsx',
  'src/components/dashboard/period-matrix-widget.tsx',
  'src/components/dashboard/process-discipline-widget.tsx',
  'src/components/dashboard/ptd-performance-panel.tsx',
  'src/components/dashboard/r-distribution-chart.tsx',
  'src/components/dashboard/setup-ranking-widget.tsx',
  'src/components/dashboard/view-switcher.tsx',
  'src/components/dashboard-v2.tsx',
  'src/components/execute-dialog.tsx',
  'src/components/restore-modal.tsx',
  'src/components/lifecycle-stepper.tsx',
  'src/components/edit-trade-dialog.tsx',
  'src/components/checklist-manager.tsx',
  'src/components/add-exit-dialog.tsx',
  'src/components/keyboard-shortcuts.tsx',
  'src/components/dashboard-filters.tsx',
  'src/components/plan-trade-form.tsx',
  'src/components/empty-state.tsx',
  'src/components/help-tooltip.tsx',
  'src/components/theme-toggle.tsx',

  /* ── T04: accounting components (13) ─────────────────────────────────── */
  'src/components/accounting/account-activity.tsx',
  'src/components/accounting/account-correction-form.tsx',
  'src/components/accounting/account-detail-header.tsx',
  'src/components/accounting/account-detail-nav.tsx',
  'src/components/accounting/account-execution-form.tsx',
  'src/components/accounting/account-executions-activity.tsx',
  'src/components/accounting/account-ledger.tsx',
  'src/components/accounting/account-overview.tsx',
  'src/components/accounting/account-performance.tsx',
  'src/components/accounting/account-positions.tsx',
  'src/components/accounting/account-reconciliation-summary.tsx',
  'src/components/accounting/account-settings.tsx',
  'src/components/accounting/account-valuation-form.tsx',

  /* ── T05: legacy settings pages (14 flagged; the 5 accounts/[id] sub-pages
        and settings/accounts/[id]/* sub-pages are already token-clean) ─── */
  'src/app/(legacy)/settings/page.tsx',
  'src/app/(legacy)/settings/ai/page.tsx',
  'src/app/(legacy)/settings/backup/page.tsx',
  'src/app/(legacy)/settings/danger-zone/page.tsx',
  'src/app/(legacy)/settings/integrations/page.tsx',
  'src/app/(legacy)/settings/journal-setup/page.tsx',
  'src/app/(legacy)/settings/market-data/page.tsx',
  'src/app/(legacy)/settings/mistake-types/page.tsx',
  'src/app/(legacy)/settings/plays/page.tsx',
  'src/app/(legacy)/settings/plays/[id]/page.tsx',
  'src/app/(legacy)/settings/risk-defaults/page.tsx',
  'src/app/(legacy)/settings/workspace/page.tsx',
  'src/app/(legacy)/settings/accounts/page.tsx',
  'src/app/(legacy)/settings/accounts/[id]/layout.tsx',

  /* ── T06: remaining legacy pages + trades page (9 flagged; (legacy)/page.tsx
        and (legacy)/account/page.tsx are already token-clean) ──────────── */
  'src/app/(legacy)/reviews/page.tsx',
  'src/app/(legacy)/checks/page.tsx',
  'src/app/(legacy)/help/page.tsx',
  'src/app/(legacy)/lookups/page.tsx',
  'src/app/(legacy)/sizing/page.tsx',
  'src/app/(legacy)/watchlist/page.tsx',
  'src/app/(legacy)/alerts/page.tsx',
  'src/app/(legacy)/trades/new/page.tsx',
  'src/app/(trades)/trades/page.tsx',

  /* ── Additional surfaces found by the T01 repo scan (not in the task
        file lists; cleared by the relevant task sweep or T06's final pass) ── */
  'src/components/sidebar/sidebar.tsx', // bg-black/20 mobile scrim → bg-overlay
];

const EXEMPT_SET = new Set(EXEMPT_FILES.map((f) => path.normalize(f)));

const SURFACES = surfaceFiles();
const SURFACE_REL = SURFACES.map(relPath);
const NON_EXEMPT_SURFACES = SURFACE_REL.filter((f) => !EXEMPT_SET.has(path.normalize(f))).sort();

/* ── Group 1: surface inventory ────────────────────────────────────────── */

describe('S05 surface token migration contract', () => {
  describe('group 1: surface inventory', () => {
    it('discovers a non-trivial set of surface files (src/app + src/components)', () => {
      expect(SURFACES.length).toBeGreaterThan(100);
    });

    it('every EXEMPT_FILES entry exists on disk and is a scanned surface file', () => {
      for (const rel of EXEMPT_FILES) {
        const abs = path.resolve(process.cwd(), rel);
        expect(fs.existsSync(abs), `exempt entry does not exist: ${rel}`).toBe(true);
        expect(SURFACE_REL, `exempt entry is not a scanned surface file: ${rel}`).toContain(rel);
      }
    });

    it('EXEMPT_FILES contains no duplicates', () => {
      expect(EXEMPT_FILES.length).toBe(new Set(EXEMPT_FILES).size);
    });

    it('prints the migration backlog (diagnostics for T02–T06)', () => {
      console.log(
        `S05 backlog: ${EXEMPT_FILES.length} exempt surface files still contain arbitrary color literals. ` +
          `T06 target: EXEMPT_FILES empty (currently ${EXEMPT_FILES.length}).`,
      );
      for (const rel of EXEMPT_FILES) {
        console.log(`  ${rel} (${violationsInFile(path.resolve(process.cwd(), rel)).length} hits)`);
      }
    });
  });

  /* ── Group 2: allowlist hygiene ───────────────────────────────────────── */

  describe('group 2: allowlist hygiene (stale entries fail)', () => {
    it('every exempt file currently contains at least one violation', () => {
      const stale = EXEMPT_FILES.filter((rel) => {
        const abs = path.resolve(process.cwd(), rel);
        return violationsInFile(abs).length === 0;
      });
      expect(
        stale,
        `Clean files must be REMOVED from EXEMPT_FILES (a clean entry is a stale allowance): ${stale.join(', ')}`,
      ).toEqual([]);
    });

    it('every surface file with violations is on the allowlist', () => {
      const unlisted = NON_EXEMPT_SURFACES.filter((rel) => {
        const abs = path.resolve(process.cwd(), rel);
        return violationsInFile(abs).length > 0;
      });
      expect(
        unlisted,
        `Surface files with arbitrary color literals are missing from EXEMPT_FILES (add or migrate them): ${unlisted.join(', ')}`,
      ).toEqual([]);
    });
  });

  /* ── Group 3: token-clean contract ────────────────────────────────────── */

  describe('group 3: non-exempt surfaces contain zero arbitrary color literals', () => {
    it.each(NON_EXEMPT_SURFACES)('%s', (rel) => {
      const hits = violationsInFile(path.resolve(process.cwd(), rel));
      expect(
        hits,
        `${rel} contains arbitrary Tailwind color literals — migrate them to S01 semantic tokens ` +
          `(text-positive, text-negative, text-warning, text-info, text-destructive, ` +
          `text-foreground, text-muted-foreground, bg-muted, bg-positive/10, bg-negative/10, ` +
          `border-positive/30, bg-overlay, ...):\n` +
          hits.map((h) => `  line ${h.line}: ${h.literal}`).join('\n'),
      ).toEqual([]);
    });
  });

  /* ── Group 4: scanner self-test ───────────────────────────────────────── */

  describe('group 4: scanner self-test (the contract rejects arbitrary color literals)', () => {
    it('flags palette-shade utilities incl. opacity modifiers and variants', () => {
      const src = [
        'className="text-zinc-500"',
        'className="bg-emerald-50 hover:bg-emerald-100"',
        'className="border-red-400 focus-visible:border-red-500"',
        'className="text-red-500/50 dark:text-red-400"',
        'className="ring-blue-600/30"',
        'className="fill-teal-500 stroke-cyan-600"',
        'className="from-blue-500 via-indigo-500 to-violet-500"',
        'className="outline-amber-400 accent-pink-600 shadow-slate-300"',
        'className="placeholder-zinc-400"',
        'className="divide-red-500"',
        'className="decoration-sky-400 caret-purple-500"',
      ].join('\n');
      expect(findViolations(src).map((h) => h.literal)).toEqual(
        expect.arrayContaining([
          'text-zinc-500',
          'bg-emerald-50',
          'bg-emerald-100',
          'border-red-400',
          'border-red-500',
          'text-red-500/50',
          'text-red-400',
          'ring-blue-600/30',
          'fill-teal-500',
          'stroke-cyan-600',
          'from-blue-500',
          'via-indigo-500',
          'to-violet-500',
          'outline-amber-400',
          'accent-pink-600',
          'shadow-slate-300',
          'placeholder-zinc-400',
          'divide-red-500',
          'decoration-sky-400',
          'caret-purple-500',
        ]),
      );
    });

    it('flags theme-blind black/white utilities', () => {
      const src = 'className="text-white bg-black/10 hover:border-white/20 dark:text-black"';
      const literals = findViolations(src).map((h) => h.literal);
      expect(literals).toEqual(
        expect.arrayContaining(['text-white', 'bg-black/10', 'border-white/20', 'text-black']),
      );
    });

    it('flags arbitrary-value color literals', () => {
      const src = [
        'className="bg-[#0f172a]"',
        'className="text-[rgb(20,30,40)]"',
        'className="shadow-[0_2px_8px_rgba(0,0,0,0.2)]"',
        'className="from-[#2563eb]"',
      ].join('\n');
      const hits = findViolations(src);
      expect(hits.length).toBe(4);
      expect(hits.map((h) => h.literal)).toEqual(
        expect.arrayContaining(['bg-[#0f172a]', 'text-[rgb(20,30,40)]', 'shadow-[0_2px_8px_rgba(0,0,0,0.2)]', 'from-[#2563eb]']),
      );
    });

    it('allows semantic tokens, pure-length arbitrary values, and var(--) values', () => {
      const src = [
        'className="text-primary bg-background border-border text-muted-foreground"',
        'className="bg-muted text-foreground border-positive/30 bg-positive/10 text-negative"',
        'className="text-warning text-info text-destructive"',
        'className="bg-overlay text-primary-foreground"',
        'className="text-sm text-[10px] text-[0.8rem] border-[1px] h-8 shadow-sm"',
        'className="hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]"',
        'className="bg-(--overlay)"',
        'className="focus-visible:ring-3 focus-visible:ring-ring/50"',
        'className="border-separator"',
      ].join('\n');
      expect(findViolations(src)).toEqual([]);
    });

    it('reports line numbers', () => {
      const src = 'const a = 1;\nclassName="text-red-500"\nconst b = 2;';
      const hits = findViolations(src);
      expect(hits).toEqual([{ line: 2, literal: 'text-red-500' }]);
    });
  });
});
