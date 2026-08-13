/**
 * Unit tests for src/lib/workstation-view-types.ts — the pure-logic layer
 * for S06 (curated saved views and customization): panel catalogue, system
 * templates, view configuration shape, layout validation, and dynamic CSS
 * grid computation.
 *
 * Coverage:
 * - Catalogue integrity (ids, titles, hide/fill/resize declarations,
 *   per-panel arrangement constraints)
 * - Template integrity (three curated templates, rectangular catalogue-only
 *   grids, consistency between areas and defaultHidden)
 * - Factories (createViewFromTemplate, resetViewToTemplate, clone)
 * - Grid computation (grid-template-areas / columns / rows, visible panels)
 * - Validation positives (templates and valid customized layouts)
 * - Validation negatives (arbitrary component names, ragged grids, split
 *   regions, non-hideable panels, version violations, hidden/areas
 *   inconsistency, empty grids)
 *
 * @module workstation-view-types.test
 */

import { describe, it, expect } from 'vitest';

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
  resetViewToTemplate,
  cloneWorkstationViewConfig,
  deriveLayoutFromAreas,
  deriveAreasFromLayout,
  validateWorkstationViewConfig,
  isValidWorkstationViewConfig,
  migrateWorkstationViewConfig,
  isWorkstationViewConfigShape,
  computeGridTemplateAreas,
  computeGridTemplateColumns,
  computeGridTemplateRows,
  computeDocumentFlowGridTemplateRows,
  computeVisiblePanels,
  type WorkstationPanelId,
  type WorkstationTemplateId,
  type WorkstationViewConfig,
  type WorkstationLayoutItem,
} from './workstation-view-types';

// ── Helpers ─────────────────────────────────────────────────────────────

const TEMPLATE_IDS: readonly WorkstationTemplateId[] = Object.values(WORKSTATION_TEMPLATE_IDS);
const PANEL_IDS: readonly WorkstationPanelId[] = Object.values(WORKSTATION_PANEL_IDS);

/** Collect every catalogue panel that appears in a grid (ids only). */
function panelsInGrid(areas: readonly (readonly string[])[]): Set<string> {
  const present = new Set<string>();
  for (const row of areas) {
    for (const cell of row) {
      if (cell !== GRID_EMPTY_CELL) present.add(cell);
    }
  }
  return present;
}

/** Every `.` cell's panel is a hidden-by-default optional panel. */
function assertTemplateInternallyConsistent(templateId: WorkstationTemplateId): void {
  const template = WORKSTATION_TEMPLATES[templateId];
  const config = createViewFromTemplate(templateId);

  // Areas are rectangular and every row has the declared column count.
  const colCount = template.areas[0].length;
  for (const [r, row] of template.areas.entries()) {
    expect(row.length, `template ${templateId} row ${r} width`).toBe(colCount);
  }

  // Cells are catalogue ids or empty cells only.
  for (const [r, row] of template.areas.entries()) {
    for (const [c, cell] of row.entries()) {
      expect(
        cell === GRID_EMPTY_CELL || WORKSTATION_PANEL_CATALOGUE[cell as WorkstationPanelId] !== undefined,
        `template ${templateId} areas[${r}][${c}]="${cell}" is not catalogue-valid`,
      ).toBe(true);
    }
  }

  // defaultHidden ⊆ optional panels.
  for (const id of template.defaultHidden) {
    expect(WORKSTATION_PANEL_CATALOGUE[id].canHide, `template ${templateId} hides required panel ${id}`).toBe(
      true,
    );
  }

  // Hidden-by-default panels appear as `.` cells; visible panels appear as ids.
  const present = panelsInGrid(template.areas);
  const hidden = new Set<string>(template.defaultHidden);
  for (const id of PANEL_IDS) {
    if (hidden.has(id)) {
      expect(present.has(id), `template ${templateId}: hidden panel ${id} must not appear in areas`).toBe(
        false,
      );
    } else {
      expect(present.has(id), `template ${templateId}: visible panel ${id} must appear in areas`).toBe(true);
    }
  }

  // The derived config validates cleanly and matches the template.
  expect(validateWorkstationViewConfig(config), `template ${templateId} validates`).toEqual([]);
}

// ── Catalogue ───────────────────────────────────────────────────────────

describe('panel catalogue', () => {
  it('defines exactly the registered ids with matching definitions', () => {
    const defIds = Object.keys(WORKSTATION_PANEL_CATALOGUE).sort();
    expect(defIds).toEqual([...PANEL_IDS].sort());
    expect(WORKSTATION_PANEL_ID_LIST).toHaveLength(PANEL_IDS.length);
    for (const id of WORKSTATION_PANEL_ID_LIST) {
      expect(WORKSTATION_PANEL_CATALOGUE[id].id).toBe(id);
    }
  });

  it('marks exactly risk/trades as fixed and the rest optional', () => {
    expect([...FIXED_PANEL_IDS].sort()).toEqual(
      [WORKSTATION_PANEL_IDS.RISK, WORKSTATION_PANEL_IDS.TRADES].sort(),
    );
    expect([...OPTIONAL_PANEL_IDS].sort()).toEqual(
      [
        WORKSTATION_PANEL_IDS.ACCOUNT,
        WORKSTATION_PANEL_IDS.PERFORMANCE,
        WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
        WORKSTATION_PANEL_IDS.WATCHLIST,
      ].sort(),
    );
  });

  it('gives every panel a unique non-empty title', () => {
    const titles = PANEL_IDS.map((id) => WORKSTATION_PANEL_CATALOGUE[id].title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const title of titles) expect(title.length).toBeGreaterThan(0);
  });

  it('uses the dense v2 titles and ids (positions renamed to trades, kpis band removed, risk/review retitled)', () => {
    expect(WORKSTATION_PANEL_IDS.TRADES).toBe('trades');
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.RISK].title).toBe('Main Risk Metrics');
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.TRADES].title).toBe('Trades Workspace');
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.ACCOUNT].title).toBe('Account State');
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.PERFORMANCE].title).toBe('Performance');
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.PROCESS_REVIEW].title).toBe('Review Metrics');
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.WATCHLIST].title).toBe('Watchlist');
    // The v1 legacy band ids are gone from the catalogue and id map entirely;
    // 'positions'/'kpis' survive only as migration fixtures (v1 → v2).
    expect(WORKSTATION_PANEL_CATALOGUE).not.toHaveProperty('positions');
    expect(WORKSTATION_PANEL_CATALOGUE).not.toHaveProperty('kpis');
    expect(WORKSTATION_PANEL_IDS).not.toHaveProperty('POSITIONS');
    expect(WORKSTATION_PANEL_IDS).not.toHaveProperty('KPIS');
  });

  it('declares content-sized risk band and fill panels elsewhere', () => {
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.RISK].fill).toBe(false);
    for (const id of OPTIONAL_PANEL_IDS) {
      expect(WORKSTATION_PANEL_CATALOGUE[id].fill, `optional panel ${id} fills`).toBe(true);
    }
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.TRADES].fill).toBe(true);
  });

  it('declares risk and trades non-draggable/non-resizable, everything else movable', () => {
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.RISK].canDrag).toBe(false);
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.RISK].canResize).toBe(false);
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.TRADES].canDrag).toBe(false);
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.TRADES].canResize).toBe(false);
    for (const id of OPTIONAL_PANEL_IDS) {
      expect(WORKSTATION_PANEL_CATALOGUE[id].canDrag, `optional panel ${id} draggable`).toBe(true);
      expect(WORKSTATION_PANEL_CATALOGUE[id].canResize, `optional panel ${id} resizable`).toBe(true);
    }
  });
});

// ── Per-panel arrangement constraints ────────────────────────────────────

describe('panel constraints', () => {
  it('declares sane positive integer bounds for every panel (min ≤ max)', () => {
    for (const id of PANEL_IDS) {
      const def = WORKSTATION_PANEL_CATALOGUE[id];
      for (const bound of [def.minW, def.maxW, def.minH, def.maxH]) {
        expect(Number.isInteger(bound) && bound > 0, `${id} ${bound} positive integer`).toBe(true);
      }
      expect(def.minW, `${id} minW ≤ maxW`).toBeLessThanOrEqual(def.maxW);
      expect(def.minH, `${id} minH ≤ maxH`).toBeLessThanOrEqual(def.maxH);
    }
  });

  it('locks fixed panels full-width with non-draggable/non-resizable arrangement', () => {
    for (const id of FIXED_PANEL_IDS) {
      const def = WORKSTATION_PANEL_CATALOGUE[id];
      expect(def.canDrag, `${id} non-draggable`).toBe(false);
      expect(def.canResize, `${id} non-resizable`).toBe(false);
      // Full-width lock: the width bounds are pinned so neither the risk
      // anchor nor the trades workspace can be compressed into a rail.
      expect(def.minW, `${id} minW === maxW`).toBe(def.maxW);
      expect(def.minW, `${id} full-width`).toBe(3);
    }
  });

  it('keeps the risk anchor full-width at one row', () => {
    const risk = WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.RISK];
    expect(risk.minW).toBe(3);
    expect(risk.maxW).toBe(3);
    expect(risk.minH).toBe(1);
    expect(risk.maxH).toBe(1);
  });

  it('keeps the trades workspace full-width so it can never become a narrow rail', () => {
    const trades = WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.TRADES];
    expect(trades.minW).toBe(3);
    expect(trades.maxW).toBe(3);
    // Meaningful minimum height: the workspace must never collapse into a
    // single-row sliver.
    expect(trades.minH).toBeGreaterThan(1);
  });

  it('allows summary panels to resize within the 3-column dense grid bounds', () => {
    for (const id of [
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]) {
      const def = WORKSTATION_PANEL_CATALOGUE[id];
      // At least one readable grid column, never wider than the full grid.
      expect(def.minW, `${id} minW readable`).toBeGreaterThanOrEqual(1);
      expect(def.maxW, `${id} maxW within grid`).toBeLessThanOrEqual(3);
      // Compact by design: content-sized summaries must not grow into walls.
      expect(def.maxH, `${id} maxH compact`).toBeLessThanOrEqual(3);
    }
  });
});

// ── Templates ───────────────────────────────────────────────────────────

describe('system templates', () => {
  it('exposes exactly the three curated templates with correct names', () => {
    expect([...TEMPLATE_IDS].sort()).toEqual(
      [
        WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
        WORKSTATION_TEMPLATE_IDS.PERFORMANCE,
        WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW,
      ].sort(),
    );
    expect(WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS].name).toBe('Risk & Positions');
    expect(WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PERFORMANCE].name).toBe('Performance');
    expect(WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW].name).toBe('Process Review');
  });

  it('marks Risk & Positions as the immutable system default and startup view', () => {
    expect(WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS].isSystemDefault).toBe(true);
    expect(WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PERFORMANCE].isSystemDefault).toBe(false);
    expect(WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW].isSystemDefault).toBe(false);
    // Exactly one system default.
    const defaults = TEMPLATE_IDS.filter((id) => WORKSTATION_TEMPLATES[id].isSystemDefault);
    expect(defaults).toEqual([WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS]);
  });

  it('keeps every template internally consistent and valid', () => {
    for (const id of TEMPLATE_IDS) assertTemplateInternallyConsistent(id);
  });

  it('uses the dense 3-column document flow in every template', () => {
    const riskPositions = WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS];
    expect(riskPositions.columns).toEqual([1, 1, 1]);
    expect(riskPositions.areas).toEqual([
      ['risk', 'risk', 'risk'],
      ['account', 'perf', 'perf'],
      ['trades', 'trades', 'trades'],
    ]);
    expect(riskPositions.defaultHidden).toEqual([
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);

    for (const id of [
      WORKSTATION_TEMPLATE_IDS.PERFORMANCE,
      WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW,
    ]) {
      expect(WORKSTATION_TEMPLATES[id].columns).toEqual([1, 1, 1]);
      expect(WORKSTATION_TEMPLATES[id].areas[0].length).toBe(3);
    }
  });

  it('records the dense default-template version alongside the layout schema version', () => {
    // v2 is the dense composition: both the layout schema and the default
    // template were bumped from v1 so migration can replace unmodified
    // former-default copies while preserving user-modified views. v3 (M018)
    // records the composition change: Review Metrics leaves the default and
    // Performance widens to two grid columns beside Account State.
    expect(WORKSTATION_LAYOUT_VERSION).toBe(2);
    expect(WORKSTATION_DEFAULT_TEMPLATE_VERSION).toBe(3);
    expect(createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS).version).toBe(
      WORKSTATION_LAYOUT_VERSION,
    );
  });

  it('makes the Performance template hide watchlist and process review', () => {
    const perf = WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PERFORMANCE];
    expect(perf.defaultHidden).toEqual([
      WORKSTATION_PANEL_IDS.WATCHLIST,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    ]);
    // Hidden panels have no cells in the base grid.
    for (const row of perf.areas) {
      expect(row).not.toContain(WORKSTATION_PANEL_IDS.PROCESS_REVIEW);
      expect(row).not.toContain(WORKSTATION_PANEL_IDS.WATCHLIST);
    }
    // The rendered grid of the derived view matches the template base.
    expect(computeGridTemplateAreas(createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE))).toBe(
      '"risk risk risk" "account account ." "trades trades trades" "perf perf perf" "perf perf perf"',
    );
  });
});

// ── Factories ───────────────────────────────────────────────────────────

describe('createViewFromTemplate', () => {
  it('builds a valid config per template with the template base grid', () => {
    for (const id of TEMPLATE_IDS) {
      const config = createViewFromTemplate(id);
      expect(validateWorkstationViewConfig(config)).toEqual([]);
      expect(config.templateId).toBe(id);
      expect(config.version).toBe(WORKSTATION_LAYOUT_VERSION);
      expect(config.hiddenPanels).toEqual([...WORKSTATION_TEMPLATES[id].defaultHidden]);
      expect(config.areas).toEqual(
        WORKSTATION_TEMPLATES[id].areas.map((row) => [...row]),
      );
    }
  });

  it('deep-copies the grid so callers cannot mutate the template', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas[0][0] = 'mutated';
    config.hiddenPanels.push(WORKSTATION_PANEL_IDS.ACCOUNT);
    const fresh = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(fresh.areas[0][0]).toBe('risk');
    expect(fresh.hiddenPanels).toEqual([
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
  });
});

describe('resetViewToTemplate', () => {
  it('restores a customized view to its template base and keeps the template reference', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    // Customize: hide the account panel (watchlist + review are already hidden).
    config.areas[1] = [GRID_EMPTY_CELL, GRID_EMPTY_CELL, GRID_EMPTY_CELL];
    config.hiddenPanels = [
      WORKSTATION_PANEL_IDS.WATCHLIST,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.ACCOUNT,
    ];
    expect(validateWorkstationViewConfig(config)).toEqual([]);

    const reset = resetViewToTemplate(config);
    expect(reset.templateId).toBe(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    expect(reset.areas).toEqual(
      WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PERFORMANCE].areas.map((row) => [...row]),
    );
    expect(reset.hiddenPanels).toEqual([
      WORKSTATION_PANEL_IDS.WATCHLIST,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    ]);
    expect(validateWorkstationViewConfig(reset)).toEqual([]);
  });
});

describe('cloneWorkstationViewConfig', () => {
  it('deep-copies rows and the hidden set', () => {
    const source = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    const copy = cloneWorkstationViewConfig(source);
    copy.areas[1][0] = GRID_EMPTY_CELL;
    copy.hiddenPanels = [WORKSTATION_PANEL_IDS.ACCOUNT];
    expect(source.areas[1][0]).toBe(WORKSTATION_PANEL_IDS.ACCOUNT);
    expect(source.hiddenPanels).toEqual([
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
    expect(copy.templateId).toBe(source.templateId);
    expect(copy.version).toBe(source.version);
  });

  it('deep-copies the RGL layout items so callers cannot mutate the source', () => {
    const source = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    const copy = cloneWorkstationViewConfig(source);
    // Layout items are readonly by contract; mutating the copy's array and
    // items must never leak into the source.
    copy.layout = [{ ...copy.layout![0], x: 99, minW: 42 }, ...copy.layout!.slice(1)];
    expect(source.layout![0].x).toBe(0);
    expect(source.layout![0].minW).toBe(3);
    expect(copy.layout).toHaveLength(source.layout!.length);
  });
});

// ── RGL layout (v2): derivation ─────────────────────────────────────────

describe('deriveLayoutFromAreas', () => {
  it('derives one catalogue-ordered item per visible panel for the dense default', () => {
    const areas = WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS].areas;
    expect(deriveLayoutFromAreas(areas)).toEqual([
      { i: WORKSTATION_PANEL_IDS.RISK, x: 0, y: 0, w: 3, h: 1, minW: 3, maxW: 3, minH: 1, maxH: 1 },
      { i: WORKSTATION_PANEL_IDS.TRADES, x: 0, y: 2, w: 3, h: 1, minW: 3, maxW: 3, minH: 3, maxH: 12 },
      { i: WORKSTATION_PANEL_IDS.ACCOUNT, x: 0, y: 1, w: 1, h: 1, minW: 1, maxW: 3, minH: 1, maxH: 3 },
      { i: WORKSTATION_PANEL_IDS.PERFORMANCE, x: 1, y: 1, w: 2, h: 1, minW: 1, maxW: 3, minH: 1, maxH: 3 },
    ]);
  });

  it('captures wide/band panels of the Performance template and omits hidden panels', () => {
    const areas = WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.PERFORMANCE].areas;
    const items = deriveLayoutFromAreas(areas);
    const byId = Object.fromEntries(items.map((it) => [it.i, it]));
    expect(byId[WORKSTATION_PANEL_IDS.ACCOUNT]).toMatchObject({ x: 0, y: 1, w: 2, h: 1 });
    expect(byId[WORKSTATION_PANEL_IDS.TRADES]).toMatchObject({ x: 0, y: 2, w: 3, h: 1 });
    expect(byId[WORKSTATION_PANEL_IDS.PERFORMANCE]).toMatchObject({ x: 0, y: 3, w: 3, h: 2 });
    // Hidden-by-default panels have no cells in the base grid → no items.
    expect(byId[WORKSTATION_PANEL_IDS.WATCHLIST]).toBeUndefined();
    expect(byId[WORKSTATION_PANEL_IDS.PROCESS_REVIEW]).toBeUndefined();
  });
});

describe('deriveAreasFromLayout', () => {
  it('round-trips every template grid exactly (areas → layout → areas)', () => {
    for (const id of TEMPLATE_IDS) {
      const areas = WORKSTATION_TEMPLATES[id].areas.map((row) => [...row]);
      const layout = deriveLayoutFromAreas(areas);
      expect(
        deriveAreasFromLayout(layout, WORKSTATION_TEMPLATES[id].columns.length),
      ).toEqual(areas);
    }
  });

  it('rebuilds a rectangular grid of max(y + h) rows and the requested columns', () => {
    const layout: WorkstationLayoutItem[] = [
      { i: WORKSTATION_PANEL_IDS.RISK, x: 0, y: 0, w: 3, h: 1 },
      { i: WORKSTATION_PANEL_IDS.TRADES, x: 0, y: 1, w: 3, h: 1 },
    ];
    expect(deriveAreasFromLayout(layout, 3)).toEqual([
      ['risk', 'risk', 'risk'],
      ['trades', 'trades', 'trades'],
    ]);
  });

  it('skips malformed items defensively and honors the column count', () => {
    const layout: WorkstationLayoutItem[] = [
      { i: WORKSTATION_PANEL_IDS.RISK, x: 0, y: 0, w: 3, h: 1 },
      { i: WORKSTATION_PANEL_IDS.TRADES, x: 0, y: 1, w: 3, h: 1 },
      { i: 'hacker-panel' as WorkstationPanelId, x: 0, y: 2, w: 3, h: 1 },
      { i: WORKSTATION_PANEL_IDS.ACCOUNT, x: -1, y: 3, w: 1, h: 1 },
    ];
    // Unknown and negative-coordinate items are skipped entirely — they do
    // not create extra grid rows or cells.
    expect(deriveAreasFromLayout(layout, 1)).toEqual([['risk'], ['trades']]);
    expect(deriveAreasFromLayout(layout, 3)).toEqual([
      ['risk', 'risk', 'risk'],
      ['trades', 'trades', 'trades'],
    ]);
    expect(deriveAreasFromLayout([], 3)).toEqual([]);
  });
});

// ── RGL layout (v2): factory + validation integration ───────────────────

describe('v2 RGL layout in factories and validation', () => {
  /** Fresh dense-default config for negative layout validation cases. */
  const base = (): WorkstationViewConfig =>
    createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);

  it('emits a v2 layout for every template config that validates and round-trips', () => {
    for (const id of TEMPLATE_IDS) {
      const config = createViewFromTemplate(id);
      expect(config.layout).toBeDefined();
      expect(config.version).toBe(WORKSTATION_LAYOUT_VERSION);
      expect(validateWorkstationViewConfig(config)).toEqual([]);
      expect(
        deriveAreasFromLayout(config.layout!, WORKSTATION_TEMPLATES[id].columns.length),
      ).toEqual(config.areas);
    }
  });

  it('keeps v1 configs (no layout field) valid — migration-on-read upgrades them', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    const v1Config: WorkstationViewConfig = {
      templateId: config.templateId,
      areas: config.areas,
      hiddenPanels: config.hiddenPanels,
      version: 1,
    };
    expect(validateWorkstationViewConfig(v1Config)).toEqual([]);
  });

  it('also accepts a v2 config without a layout (pre-layout persisted data stays readable)', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    delete config.layout;
    expect(validateWorkstationViewConfig(config)).toEqual([]);
  });

  it('accepts hand-authored layout items without declared constraints when sizes are in bounds', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.layout = [
      { i: WORKSTATION_PANEL_IDS.RISK, x: 0, y: 0, w: 3, h: 1 },
      { i: WORKSTATION_PANEL_IDS.ACCOUNT, x: 0, y: 1, w: 1, h: 1 },
      { i: WORKSTATION_PANEL_IDS.PERFORMANCE, x: 1, y: 1, w: 1, h: 1 },
      { i: WORKSTATION_PANEL_IDS.PROCESS_REVIEW, x: 2, y: 1, w: 1, h: 1 },
      { i: WORKSTATION_PANEL_IDS.TRADES, x: 0, y: 2, w: 3, h: 1 },
    ];
    expect(validateWorkstationViewConfig(config)).toEqual([]);
  });

  it('rejects layout items referencing unknown panels', () => {
    const config = base();
    config.layout = [
      { ...config.layout![0], i: 'hacker-panel' as WorkstationPanelId },
      ...config.layout!.slice(1),
    ];
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('references unknown panel'))).toBe(true);
  });

  it('rejects out-of-bounds layout coordinates', () => {
    const patches: Array<Partial<WorkstationLayoutItem>> = [
      { x: -1 },
      { y: -1 },
      { w: 0 },
      { h: 0 },
      { x: 1.5 },
      { x: 2, w: 2 }, // x + w = 4 exceeds the 3-column grid
    ];
    for (const patch of patches) {
      const config = base();
      config.layout![0] = { ...config.layout![0], ...patch };
      expect(validateWorkstationViewConfig(config).length, JSON.stringify(patch)).toBeGreaterThan(0);
    }
  });

  it('rejects overlapping layout items', () => {
    const config = base();
    // Move Account State into the Main Risk Metrics band's rectangle.
    config.layout![2] = { ...config.layout![2], x: 1, y: 0 };
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('overlap'))).toBe(true);
  });

  it('rejects duplicate panel ids in the layout', () => {
    const config = base();
    config.layout![4] = { ...config.layout![4], i: WORKSTATION_PANEL_IDS.ACCOUNT, x: 1, y: 1 };
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('more than once'))).toBe(true);
  });

  it('rejects size constraint violations against the declared catalogue bounds', () => {
    // Summary panel wider than the readable maximum.
    const wide = base();
    wide.layout![2] = { ...wide.layout![2], w: 4 };
    expect(validateWorkstationViewConfig(wide).some((i) => i.includes('width 4'))).toBe(true);

    // Summary panel taller than its compact maximum.
    const tall = base();
    tall.layout![2] = { ...tall.layout![2], h: 4 };
    expect(validateWorkstationViewConfig(tall).some((i) => i.includes('height 4'))).toBe(true);

    // Trades compressed into a narrow rail (fixed full-width lock).
    const rail = base();
    rail.layout![1] = { ...rail.layout![1], w: 2 };
    expect(validateWorkstationViewConfig(rail).some((i) => i.includes('width 2'))).toBe(true);

    // Main Risk Metrics moved off its full-width anchor.
    const risk = base();
    risk.layout![0] = { ...risk.layout![0], w: 2 };
    expect(validateWorkstationViewConfig(risk).some((i) => i.includes('width 2'))).toBe(true);
  });

  it('rejects malformed or catalogue-incompatible declared item constraints', () => {
    const badMinMax = base();
    badMinMax.layout![2] = { ...badMinMax.layout![2], minW: 3, maxW: 2 };
    expect(validateWorkstationViewConfig(badMinMax).some((i) => i.includes('minW > maxW'))).toBe(
      true,
    );

    const outsideEnvelope = base();
    outsideEnvelope.layout![2] = { ...outsideEnvelope.layout![2], minH: 5 };
    expect(
      validateWorkstationViewConfig(outsideEnvelope).some((i) =>
        i.includes('outside the catalogue bounds'),
      ),
    ).toBe(true);

    const nonPositive = base();
    nonPositive.layout![2] = { ...nonPositive.layout![2], minW: 0 };
    expect(validateWorkstationViewConfig(nonPositive).some((i) => i.includes('invalid minW'))).toBe(
      true,
    );
  });

  it('rejects a non-array layout and non-object layout items', () => {
    const notArray = base() as unknown as { layout: unknown };
    notArray.layout = 'risk';
    expect(validateWorkstationViewConfig(notArray).some((i) => i.includes('layout must be an array'))).toBe(
      true,
    );

    const badItem = base() as unknown as { layout: unknown[] };
    badItem.layout = [null];
    expect(
      validateWorkstationViewConfig(badItem).some((i) => i.includes('layout item 0 is not an object')),
    ).toBe(true);
  });

  it('rejects oversized layouts with more items than the catalogue defines panels', () => {
    // One item per catalogue panel is the maximum a valid layout can hold;
    // anything larger is malformed and would make the overlap check
    // quadratic in attacker-controlled input.
    const config = base();
    const filler: WorkstationLayoutItem = {
      i: WORKSTATION_PANEL_IDS.ACCOUNT,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    };
    config.layout = Array.from({ length: WORKSTATION_PANEL_ID_LIST.length + 1 }, () => ({
      ...filler,
    }));
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('but the catalogue only defines'))).toBe(true);
  });
});

// ── v1 → v2 migration ─────────────────────────────────────────────────

/** The exact v1 risk-positions default grid (legacy ids; M016/S06 shell). */
const V1_RISK_POSITIONS_AREAS: string[][] = [
  ['risk', 'risk'],
  ['positions', 'account'],
  ['positions', 'perf'],
  ['positions', 'review'],
  ['positions', 'watchlist'],
  ['kpis', 'kpis'],
];

const V1_PERFORMANCE_AREAS: string[][] = [
  ['risk', 'risk'],
  ['positions', 'account'],
  ['perf', 'perf'],
  ['perf', 'perf'],
  ['kpis', 'kpis'],
];

const V1_PROCESS_REVIEW_AREAS: string[][] = [
  ['risk', 'risk'],
  ['positions', 'account'],
  ['review', 'review'],
  ['review', 'review'],
  ['kpis', 'kpis'],
];

/** A raw v1 persisted config (legacy ids included) — not a valid v2 config. */
function v1Config(
  templateId: WorkstationTemplateId,
  areas: string[][],
  hiddenPanels: string[],
  version = 1,
): unknown {
  return {
    templateId,
    areas: areas.map((row) => [...row]),
    hiddenPanels: [...hiddenPanels],
    version,
  };
}

/**
 * The exact former v2 risk-positions default grid (pre-M018): Review
 * Metrics in the summary row and only the watchlist hidden. The current
 * default (WORKSTATION_DEFAULT_TEMPLATE_VERSION 3) removes Review Metrics
 * and widens Performance to two columns.
 */
const V2_RISK_POSITIONS_DEFAULT_AREAS: string[][] = [
  ['risk', 'risk', 'risk'],
  ['account', 'perf', 'review'],
  ['trades', 'trades', 'trades'],
];

/** A raw v2 persisted config — the shape `createViewFromTemplate` emits (with a derived layout). */
function v2Config(
  templateId: WorkstationTemplateId,
  areas: string[][],
  hiddenPanels: string[],
): WorkstationViewConfig {
  return {
    templateId,
    areas: areas.map((row) => [...row]),
    hiddenPanels: [...hiddenPanels] as WorkstationPanelId[],
    version: WORKSTATION_LAYOUT_VERSION,
    layout: deriveLayoutFromAreas(areas),
  };
}

describe('isWorkstationViewConfigShape', () => {
  it('accepts config-shaped objects — v1 and v2 alike', () => {
    expect(
      isWorkstationViewConfigShape(
        v1Config(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS, V1_RISK_POSITIONS_AREAS, []),
      ),
    ).toBe(true);
    expect(
      isWorkstationViewConfigShape(createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS)),
    ).toBe(true);
  });

  it('rejects arrays and foreign shapes (dashboard rows carry a grid-item array)', () => {
    expect(isWorkstationViewConfigShape([{ i: 'a', x: 0, y: 0, w: 12, h: 3 }])).toBe(false);
    for (const bad of [
      null,
      undefined,
      42,
      'risk',
      {},
      { templateId: 'risk-positions' },
      { templateId: 'risk-positions', areas: [], hiddenPanels: [] }, // no version
    ]) {
      expect(isWorkstationViewConfigShape(bad)).toBe(false);
    }
  });
});

describe('migrateWorkstationViewConfig', () => {
  const denseDefault = (): WorkstationViewConfig =>
    createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);

  it('replaces an unmodified copy of the former risk-positions default with the dense default', () => {
    const migrated = migrateWorkstationViewConfig(
      v1Config(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS, V1_RISK_POSITIONS_AREAS, []),
    );
    expect(migrated).toEqual(denseDefault());
    expect(migrated.version).toBe(WORKSTATION_LAYOUT_VERSION);
    expect(migrated.layout).toBeDefined();
    expect(validateWorkstationViewConfig(migrated)).toEqual([]);
  });

  it('replaces unmodified copies of the former performance and process-review templates with their dense forms', () => {
    const perf = migrateWorkstationViewConfig(
      v1Config(WORKSTATION_TEMPLATE_IDS.PERFORMANCE, V1_PERFORMANCE_AREAS, ['watchlist', 'review']),
    );
    expect(perf).toEqual(createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE));

    const review = migrateWorkstationViewConfig(
      v1Config(WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW, V1_PROCESS_REVIEW_AREAS, [
        'watchlist',
        'perf',
      ]),
    );
    expect(review).toEqual(createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW));
  });

  it('preserves a user-modified v1 view by translating legacy ids and upgrading the version', () => {
    const areas = [
      ['risk', 'risk'],
      ['positions', '.'],
      ['positions', 'perf'],
      ['positions', 'review'],
      ['positions', 'watchlist'],
      ['kpis', 'kpis'],
    ];
    const migrated = migrateWorkstationViewConfig(
      v1Config(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS, areas, ['account']),
    );
    expect(migrated.templateId).toBe(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(migrated.version).toBe(WORKSTATION_LAYOUT_VERSION);
    expect(migrated.areas).toEqual([
      ['risk', 'risk'],
      ['trades', '.'],
      ['trades', 'perf'],
      ['trades', 'review'],
      ['trades', 'watchlist'],
      ['.', '.'],
    ]);
    expect(migrated.hiddenPanels).toEqual(['account']);
    // The translated two-column grid cannot satisfy the full-width catalogue
    // constraints (v1 fixed panels were not full-width), so the view is
    // preserved without a layout — and stays a valid v2 config.
    expect(migrated.layout).toBeUndefined();
    expect(validateWorkstationViewConfig(migrated)).toEqual([]);
  });

  it('upgrades a v1 config whose areas are already dense with a derived layout', () => {
    const denseAreas = WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS].areas.map(
      (row) => [...row],
    );
    const migrated = migrateWorkstationViewConfig(
      v1Config(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS, denseAreas, ['watchlist']),
    );
    expect(migrated.version).toBe(WORKSTATION_LAYOUT_VERSION);
    expect(migrated.layout).toBeDefined();
    expect(deriveAreasFromLayout(migrated.layout!, 3)).toEqual(denseAreas);
    expect(validateWorkstationViewConfig(migrated)).toEqual([]);
  });

  it('falls back to the dense default for future versions', () => {
    const migrated = migrateWorkstationViewConfig(
      v1Config(
        WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
        V1_RISK_POSITIONS_AREAS,
        [],
        WORKSTATION_LAYOUT_VERSION + 1,
      ),
    );
    expect(migrated).toEqual(denseDefault());
  });

  it('falls back to the dense default for malformed input', () => {
    for (const bad of [null, undefined, 42, 'risk', [], { templateId: 'risk-positions' }]) {
      expect(migrateWorkstationViewConfig(bad)).toEqual(denseDefault());
    }
    // Ragged v1 grid.
    expect(
      migrateWorkstationViewConfig(
        v1Config(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS, [['risk'], ['positions', 'account']], []),
      ),
    ).toEqual(denseDefault());
    // Unknown v1 template id.
    expect(
      migrateWorkstationViewConfig({
        templateId: 'custom-template',
        areas: V1_RISK_POSITIONS_AREAS,
        hiddenPanels: [],
        version: 1,
      }),
    ).toEqual(denseDefault());
    // Non-integer / non-positive versions.
    for (const v of [0, -1, 1.5]) {
      expect(
        migrateWorkstationViewConfig(
          v1Config(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS, V1_RISK_POSITIONS_AREAS, [], v),
        ),
      ).toEqual(denseDefault());
    }
  });

  it('passes valid v2 configs through unchanged (cloned) and falls back for malformed v2 data', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    const migrated = migrateWorkstationViewConfig(config);
    expect(migrated).toEqual(config);
    expect(migrated).not.toBe(config);
    // Mutating the result must never leak into the input.
    migrated.layout![0] = { ...migrated.layout![0], x: 9 };
    expect(config.layout![0].x).toBe(0);

    // Malformed v2 (catalogue-foreign cell) → dense default.
    const bad = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    bad.areas[1][1] = 'hacker-panel';
    expect(migrateWorkstationViewConfig(bad)).toEqual(denseDefault());
  });

  it('replaces an unmodified copy of the former v2 risk-positions default with the current default', () => {
    const former = v2Config(
      WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
      V2_RISK_POSITIONS_DEFAULT_AREAS,
      ['watchlist'],
    );
    const migrated = migrateWorkstationViewConfig(former);
    expect(migrated).toEqual(denseDefault());
    expect(migrated.version).toBe(WORKSTATION_LAYOUT_VERSION);
    expect(migrated.layout).toBeDefined();
    // The migrated default carries the M018 composition: review hidden and
    // Performance widened to two grid columns beside Account State.
    expect(migrated.areas).toEqual([
      ['risk', 'risk', 'risk'],
      ['account', 'perf', 'perf'],
      ['trades', 'trades', 'trades'],
    ]);
    expect(migrated.hiddenPanels).toEqual(['review', 'watchlist']);
    expect(validateWorkstationViewConfig(migrated)).toEqual([]);
  });

  it('preserves a user-modified v2 copy of the former default (account hidden)', () => {
    const userModified = v2Config(
      WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
      [
        ['risk', 'risk', 'risk'],
        ['.', 'perf', 'review'],
        ['trades', 'trades', 'trades'],
      ],
      ['watchlist', 'account'],
    );
    const migrated = migrateWorkstationViewConfig(userModified);
    expect(migrated).toEqual(userModified);
    expect(migrated).not.toBe(userModified);
    expect(migrated.areas[1]).toEqual(['.', 'perf', 'review']);
    expect(migrated.hiddenPanels).toEqual(['watchlist', 'account']);
    expect(validateWorkstationViewConfig(migrated)).toEqual([]);
  });

  it('preserves a user-modified v2 copy whose own hidden set includes review (no widening)', () => {
    // The user hid Review Metrics themselves: the grid keeps account|perf|. —
    // only the system default widens Performance, so this view is untouched.
    const userHiddenReview = v2Config(
      WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
      [
        ['risk', 'risk', 'risk'],
        ['account', 'perf', '.'],
        ['trades', 'trades', 'trades'],
      ],
      ['watchlist', 'review'],
    );
    const migrated = migrateWorkstationViewConfig(userHiddenReview);
    expect(migrated).toEqual(userHiddenReview);
    expect(migrated.areas[1]).toEqual(['account', 'perf', '.']);
    expect(migrated.hiddenPanels).toEqual(['watchlist', 'review']);
    expect(validateWorkstationViewConfig(migrated)).toEqual([]);
  });

  it('passes the current default itself through unchanged', () => {
    const current = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    const migrated = migrateWorkstationViewConfig(current);
    expect(migrated).toEqual(current);
    expect(migrated).not.toBe(current);
    expect(migrated.areas).toEqual(WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS].areas);
    expect(migrated.hiddenPanels).toEqual(['review', 'watchlist']);
  });

  it('always returns a valid v2 config', () => {
    const inputs: unknown[] = [
      null,
      42,
      v1Config(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS, V1_RISK_POSITIONS_AREAS, []),
      v1Config(WORKSTATION_TEMPLATE_IDS.PERFORMANCE, V1_PERFORMANCE_AREAS, ['watchlist', 'review']),
      createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW),
      migrateWorkstationViewConfig({ templateId: 'nope', areas: [], hiddenPanels: [], version: 9 }),
    ];
    for (const input of inputs) {
      const migrated = migrateWorkstationViewConfig(input);
      expect(migrated.version).toBe(WORKSTATION_LAYOUT_VERSION);
      expect(validateWorkstationViewConfig(migrated)).toEqual([]);
    }
  });
});

// ── Grid computation ────────────────────────────────────────────────────

describe('computeGridTemplateAreas', () => {
  it('serializes the Risk & Positions grid exactly', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(computeGridTemplateAreas(config)).toBe(
      '"risk risk risk" "account perf perf" "trades trades trades"',
    );
  });

  it('serializes the Performance template with its full-width panel band', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    expect(computeGridTemplateAreas(config)).toBe(
      '"risk risk risk" "account account ." "trades trades trades" "perf perf perf" "perf perf perf"',
    );
  });

  it('reflects customization changes (hiding the account panel)', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas[1] = [GRID_EMPTY_CELL, GRID_EMPTY_CELL, WORKSTATION_PANEL_IDS.PROCESS_REVIEW];
    config.hiddenPanels = [
      WORKSTATION_PANEL_IDS.WATCHLIST,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
    ];
    expect(computeGridTemplateAreas(config)).toBe(
      '"risk risk risk" ". . review" "trades trades trades"',
    );
  });
});

describe('computeGridTemplateColumns', () => {
  it('uses equal columns for the dense Risk & Positions document flow', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(computeGridTemplateColumns(config)).toBe(
      'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
    );
  });

  it('falls back to equal tracks when the template width set does not match', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas = [
      ['risk', 'risk'],
      ['account', 'perf'],
      ['trades', 'trades'],
    ];
    expect(computeGridTemplateColumns(config)).toBe('minmax(0, 1fr) minmax(0, 1fr)');
  });
});

describe('computeGridTemplateRows', () => {
  it('sizes content bands auto and fill rows 1fr for Risk & Positions', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(computeGridTemplateRows(config)).toBe('auto minmax(0, 1fr) minmax(0, 1fr)');
  });

  it('collapses an all-empty row to auto (zero height)', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    // Trades (a fixed panel) stays visible as a full-width row; the
    // summary row is fully empty because every optional panel is hidden.
    config.areas = [
      ['risk', 'risk', 'risk'],
      [GRID_EMPTY_CELL, GRID_EMPTY_CELL, GRID_EMPTY_CELL],
      ['trades', 'trades', 'trades'],
    ];
    config.hiddenPanels = [
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ];
    expect(validateWorkstationViewConfig(config)).toEqual([]);
    expect(computeGridTemplateRows(config)).toBe('auto auto minmax(0, 1fr)');
  });

  it('keeps fill rows stretched for the Performance template', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    expect(computeGridTemplateRows(config)).toBe(
      'auto minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
    );
  });

  it('keeps rows with any fill panel stretched even when a summary cell is empty', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas[1][1] = GRID_EMPTY_CELL;
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST, WORKSTATION_PANEL_IDS.ACCOUNT];
    expect(computeGridTemplateRows(config)).toBe('auto minmax(0, 1fr) minmax(0, 1fr)');
  });
});

describe('computeDocumentFlowGridTemplateRows', () => {
  it('content-sizes every Risk & Positions band so document flow does not create blank 1fr panels', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(computeDocumentFlowGridTemplateRows(config)).toBe('auto auto auto');
  });
});

describe('computeVisiblePanels', () => {
  it('keeps Watchlist and Review Metrics out of the Risk & Positions default', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(computeVisiblePanels(config)).toEqual([
      WORKSTATION_PANEL_IDS.RISK,
      WORKSTATION_PANEL_IDS.TRADES,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
    ]);
  });

  it('excludes hidden panels in catalogue order', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    expect(computeVisiblePanels(config)).toEqual([
      WORKSTATION_PANEL_IDS.RISK,
      WORKSTATION_PANEL_IDS.TRADES,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
    ]);
  });

  it('always includes the fixed panels', () => {
    for (const id of TEMPLATE_IDS) {
      const config = createViewFromTemplate(id);
      for (const fixed of FIXED_PANEL_IDS) {
        expect(computeVisiblePanels(config)).toContain(fixed);
      }
    }
  });
});

// ── Validation positives ────────────────────────────────────────────────

describe('validateWorkstationViewConfig — positives', () => {
  it('accepts every template-derived config', () => {
    for (const id of TEMPLATE_IDS) {
      expect(isValidWorkstationViewConfig(createViewFromTemplate(id))).toBe(true);
    }
  });

  it('accepts a valid customized reintroduction of Watchlist', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    // Watchlist is hidden in the curated default but remains available to
    // a saved view through explicit customization. Review Metrics stays
    // hidden in this view (its dedicated Process Review saved view covers
    // the review surface).
    config.areas.push([
      WORKSTATION_PANEL_IDS.WATCHLIST,
      WORKSTATION_PANEL_IDS.WATCHLIST,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.PROCESS_REVIEW];
    expect(validateWorkstationViewConfig(config)).toEqual([]);
  });

  it('accepts hiding a set of optional panels when areas and hiddenPanels agree', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas[1] = [GRID_EMPTY_CELL, GRID_EMPTY_CELL, GRID_EMPTY_CELL];
    config.hiddenPanels = [
      WORKSTATION_PANEL_IDS.WATCHLIST,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
    ];
    expect(validateWorkstationViewConfig(config)).toEqual([]);
    expect(computeVisiblePanels(config)).not.toContain(WORKSTATION_PANEL_IDS.ACCOUNT);
  });

  it('accepts unhiding a template-hidden panel when areas and hiddenPanels agree', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    // Unhide Process Review by adding a new full-width row and dropping it
    // from the hidden set; watchlist stays hidden.
    config.areas.push(['review', 'review', 'review']);
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST];
    expect(validateWorkstationViewConfig(config)).toEqual([]);
    expect(computeVisiblePanels(config)).toContain(WORKSTATION_PANEL_IDS.PROCESS_REVIEW);
  });

  it('accepts a 1-column grid derived from a template', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas = [
      ['risk'],
      ['trades'],
    ];
    config.hiddenPanels = [
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ];
    expect(validateWorkstationViewConfig(config)).toEqual([]);
  });
});

// ── Validation negatives (Q7) ───────────────────────────────────────────

describe('validateWorkstationViewConfig — negatives', () => {
  const base = (): WorkstationViewConfig => createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);

  it('rejects arbitrary/unknown panel names (no arbitrary component names)', () => {
    const config = base();
    config.areas[1][1] = 'ArbitraryComponent';
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('not in the approved panel catalogue'))).toBe(true);
  });

  it('rejects markup-like or code-like cell values', () => {
    const config = base();
    config.areas[2][1] = '<script>alert(1)</script>';
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('not in the approved panel catalogue'))).toBe(true);
  });

  it('rejects non-string cells', () => {
    const config = base() as unknown as { areas: unknown[][] };
    config.areas[1][1] = 42;
    expect(validateWorkstationViewConfig(config).length).toBeGreaterThan(0);
  });

  it('rejects ragged (non-rectangular) grids', () => {
    const config = base();
    config.areas[2] = ['trades'];
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('rectangular'))).toBe(true);
  });

  it('rejects a panel split into two disconnected regions', () => {
    const config = base();
    // Watchlist appears in two disconnected summary-row cells after
    // replacing account and review; its bounding box spans three cells.
    config.areas[1][0] = WORKSTATION_PANEL_IDS.WATCHLIST;
    config.areas[1][2] = WORKSTATION_PANEL_IDS.WATCHLIST;
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('single contiguous rectangle'))).toBe(true);
    expect(issues).not.toHaveLength(0);
  });

  it('rejects an L-shaped (non-rectangular) region', () => {
    const config = base();
    // Performance normally occupies the summary-row middle cell. Extend it
    // into the following full-width Trades row to create an L-shape.
    config.areas[2][0] = WORKSTATION_PANEL_IDS.PERFORMANCE;
    config.areas[2][1] = WORKSTATION_PANEL_IDS.PERFORMANCE;
    // Trades disappeared from areas → consistency error as well; check region error exists.
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('single contiguous rectangle'))).toBe(true);
  });

  it('rejects hiding a required (non-hideable) panel', () => {
    const config = base();
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.RISK];
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('cannot be hidden'))).toBe(true);
  });

  it('rejects a required panel missing from the grid', () => {
    const config = base();
    config.areas[2] = [GRID_EMPTY_CELL, GRID_EMPTY_CELL, GRID_EMPTY_CELL];
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST, WORKSTATION_PANEL_IDS.TRADES];
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('cannot be hidden'))).toBe(true);
  });

  it('rejects a panel present in areas and listed as hidden', () => {
    const config = base();
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST, WORKSTATION_PANEL_IDS.ACCOUNT]; // account still in areas
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('appears in areas but is also listed in hiddenPanels'))).toBe(
      true,
    );
  });

  it('rejects a panel neither present nor hidden', () => {
    const config = base();
    config.areas[1][0] = GRID_EMPTY_CELL; // account removed from areas
    // Review Metrics and Watchlist remain hidden, but account is neither
    // present nor hidden.
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('neither present in areas nor listed in hiddenPanels'))).toBe(
      true,
    );
  });

  it('rejects an unknown template id', () => {
    const config = base() as unknown as { templateId: string };
    config.templateId = 'system-custom-template';
    expect(validateWorkstationViewConfig(config).some((i) => i.includes('unknown template id'))).toBe(
      true,
    );
  });

  it('rejects zero, negative, fractional, and future versions', () => {
    for (const bad of [0, -1, 1.5, WORKSTATION_LAYOUT_VERSION + 1]) {
      const config = base() as unknown as { version: number };
      config.version = bad;
      expect(validateWorkstationViewConfig(config).length).toBeGreaterThan(0);
    }
  });

  it('accepts the current version', () => {
    expect(validateWorkstationViewConfig(base())).toEqual([]);
  });

  it('rejects empty areas and non-array areas', () => {
    const empty = base();
    empty.areas = [];
    expect(validateWorkstationViewConfig(empty).some((i) => i.includes('non-empty array'))).toBe(true);

    const notArray = base() as unknown as { areas: unknown };
    notArray.areas = 'risk risk';
    expect(validateWorkstationViewConfig(notArray).some((i) => i.includes('non-empty array'))).toBe(true);
  });

  it('rejects an unknown panel in hiddenPanels', () => {
    const config = base() as unknown as { hiddenPanels: string[] };
    config.hiddenPanels = ['not-a-panel'];
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('hiddenPanels references'))).toBe(true);
  });

  it('rejects duplicate hiddenPanels entries', () => {
    const config = base() as unknown as { hiddenPanels: string[] };
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.ACCOUNT, WORKSTATION_PANEL_IDS.ACCOUNT];
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('more than once'))).toBe(true);
  });

  it('rejects a grid with no visible panel at all', () => {
    const config = base();
    config.areas = config.areas.map((row) => row.map(() => GRID_EMPTY_CELL));
    config.hiddenPanels = [...PANEL_IDS];
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('at least one panel must be visible'))).toBe(true);
  });

  it('rejects non-object input', () => {
    for (const bad of [null, undefined, 'string', 42, []]) {
      expect(validateWorkstationViewConfig(bad).some((i) => i.includes('plain object'))).toBe(true);
    }
  });

  it('rejects a non-array hiddenPanels', () => {
    const config = base() as unknown as { hiddenPanels: unknown };
    config.hiddenPanels = 'account';
    expect(validateWorkstationViewConfig(config).some((i) => i.includes('hiddenPanels must be an array'))).toBe(
      true,
    );
  });

  it('rejects a row that is not an array', () => {
    const config = base() as unknown as { areas: unknown[] };
    config.areas[1] = 'trades account';
    expect(validateWorkstationViewConfig(config).some((i) => i.includes('row 1 is not an array'))).toBe(
      true,
    );
  });
});

// ── End-to-end round trip ───────────────────────────────────────────────

describe('validate → serialize round trip', () => {
  it('validates and serializes every template and a customized view', () => {
    for (const id of TEMPLATE_IDS) {
      const config = createViewFromTemplate(id);
      expect(isValidWorkstationViewConfig(config)).toBe(true);
      const areasCss = computeGridTemplateAreas(config);
      expect(areasCss.split('"')).toHaveLength(config.areas.length * 2 + 1);
      expect(computeGridTemplateColumns(config)).toMatch(/^minmax\(0, \d+fr\)( minmax\(0, \d+fr\))*$/);
      const rowTracks = computeGridTemplateRows(config).match(/minmax\(0, 1fr\)|auto/g) ?? [];
      expect(rowTracks).toHaveLength(config.areas.length);
    }
  });

  it('survives JSON round-trip (persisted shape is validation-safe)', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW);
    const reparsed: unknown = JSON.parse(JSON.stringify(config));
    expect(isValidWorkstationViewConfig(reparsed)).toBe(true);
  });
});
