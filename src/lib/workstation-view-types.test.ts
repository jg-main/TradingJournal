/**
 * Unit tests for src/lib/workstation-view-types.ts — the pure-logic layer
 * for S06 (curated saved views and customization): panel catalogue, system
 * templates, view configuration shape, layout validation, and dynamic CSS
 * grid computation.
 *
 * Coverage:
 * - Catalogue integrity (ids, titles, hide/fill/resize declarations)
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
  FIXED_PANEL_IDS,
  OPTIONAL_PANEL_IDS,
  GRID_EMPTY_CELL,
  createViewFromTemplate,
  resetViewToTemplate,
  cloneWorkstationViewConfig,
  validateWorkstationViewConfig,
  isValidWorkstationViewConfig,
  computeGridTemplateAreas,
  computeGridTemplateColumns,
  computeGridTemplateRows,
  computeDocumentFlowGridTemplateRows,
  computeVisiblePanels,
  type WorkstationPanelId,
  type WorkstationTemplateId,
  type WorkstationViewConfig,
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

  it('marks exactly risk/positions/kpis as fixed and the rest optional', () => {
    expect([...FIXED_PANEL_IDS].sort()).toEqual(
      [WORKSTATION_PANEL_IDS.RISK, WORKSTATION_PANEL_IDS.POSITIONS, WORKSTATION_PANEL_IDS.KPIS].sort(),
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

  it('declares content-sized bands for risk and kpis, fill panels elsewhere', () => {
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.RISK].fill).toBe(false);
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.KPIS].fill).toBe(false);
    for (const id of OPTIONAL_PANEL_IDS) {
      expect(WORKSTATION_PANEL_CATALOGUE[id].fill, `optional panel ${id} fills`).toBe(true);
    }
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.POSITIONS].fill).toBe(true);
  });

  it('declares risk and kpis as non-resizable, everything else resizable', () => {
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.RISK].canResize).toBe(false);
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.KPIS].canResize).toBe(false);
    expect(WORKSTATION_PANEL_CATALOGUE[WORKSTATION_PANEL_IDS.POSITIONS].canResize).toBe(true);
    for (const id of OPTIONAL_PANEL_IDS) {
      expect(WORKSTATION_PANEL_CATALOGUE[id].canResize, `optional panel ${id} resizable`).toBe(true);
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

  it('uses a balanced overview row in Risk & Positions and preserves rails in secondary views', () => {
    const riskPositions = WORKSTATION_TEMPLATES[WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS];
    expect(riskPositions.columns).toEqual([1, 1]);
    expect(riskPositions.areas).toEqual([
      ['risk', 'risk'],
      ['perf', 'account'],
      ['positions', 'positions'],
      ['review', 'review'],
      ['kpis', 'kpis'],
    ]);
    expect(riskPositions.defaultHidden).toEqual([WORKSTATION_PANEL_IDS.WATCHLIST]);

    for (const id of [
      WORKSTATION_TEMPLATE_IDS.PERFORMANCE,
      WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW,
    ]) {
      expect(WORKSTATION_TEMPLATES[id].columns).toEqual([2, 1]);
      expect(WORKSTATION_TEMPLATES[id].areas[0].length).toBe(2);
    }
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
      '"risk risk" "positions account" "perf perf" "perf perf" "kpis kpis"',
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
    expect(fresh.hiddenPanels).toEqual([WORKSTATION_PANEL_IDS.WATCHLIST]);
  });
});

describe('resetViewToTemplate', () => {
  it('restores a customized view to its template base and keeps the template reference', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    // Customize: hide the account panel (watchlist + review are already hidden).
    config.areas[1][1] = GRID_EMPTY_CELL;
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
    copy.areas[1][1] = GRID_EMPTY_CELL;
    copy.hiddenPanels = [WORKSTATION_PANEL_IDS.ACCOUNT];
    expect(source.areas[1][1]).toBe(WORKSTATION_PANEL_IDS.ACCOUNT);
    expect(source.hiddenPanels).toEqual([WORKSTATION_PANEL_IDS.WATCHLIST]);
    expect(copy.templateId).toBe(source.templateId);
    expect(copy.version).toBe(source.version);
  });
});

// ── Grid computation ────────────────────────────────────────────────────

describe('computeGridTemplateAreas', () => {
  it('serializes the Risk & Positions grid exactly', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(computeGridTemplateAreas(config)).toBe(
      '"risk risk" "perf account" "positions positions" "review review" "kpis kpis"',
    );
  });

  it('serializes the Performance template with its full-width panel band', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    expect(computeGridTemplateAreas(config)).toBe(
      '"risk risk" "positions account" "perf perf" "perf perf" "kpis kpis"',
    );
  });

  it('reflects customization changes (hiding the account panel)', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas[1][1] = GRID_EMPTY_CELL;
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST, WORKSTATION_PANEL_IDS.ACCOUNT];
    expect(computeGridTemplateAreas(config)).toBe(
      '"risk risk" "perf ." "positions positions" "review review" "kpis kpis"',
    );
  });
});

describe('computeGridTemplateColumns', () => {
  it('uses equal columns for the balanced Risk & Positions overview row', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(computeGridTemplateColumns(config)).toBe('minmax(0, 1fr) minmax(0, 1fr)');
  });

  it('falls back to equal tracks when the template width set does not match', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas = [
      ['risk', 'risk', 'risk'],
      ['positions', 'account', 'watchlist'],
      ['kpis', 'kpis', 'kpis'],
    ];
    expect(computeGridTemplateColumns(config)).toBe('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)');
  });
});

describe('computeGridTemplateRows', () => {
  it('sizes content bands auto and fill rows 1fr for Risk & Positions', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(computeGridTemplateRows(config)).toBe(
      'auto minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto',
    );
  });

  it('collapses an all-empty row to auto (zero height)', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    // Positions (a fixed panel) stays visible as a full-width row; the
    // middle row is fully empty because every optional panel is hidden.
    config.areas = [
      ['risk', 'risk'],
      [GRID_EMPTY_CELL, GRID_EMPTY_CELL],
      ['positions', 'positions'],
      ['kpis', 'kpis'],
    ];
    config.hiddenPanels = [
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ];
    expect(validateWorkstationViewConfig(config)).toEqual([]);
    expect(computeGridTemplateRows(config)).toBe('auto auto minmax(0, 1fr) auto');
  });

  it('keeps fill rows stretched for the Performance template', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    expect(computeGridTemplateRows(config)).toBe('auto minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto');
  });

  it('keeps rows with any fill panel stretched even when a rail cell is empty', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas[1][1] = GRID_EMPTY_CELL;
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST, WORKSTATION_PANEL_IDS.ACCOUNT];
    expect(computeGridTemplateRows(config)).toBe(
      'auto minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto',
    );
  });
});

describe('computeDocumentFlowGridTemplateRows', () => {
  it('content-sizes every Risk & Positions band so document flow does not create blank 1fr panels', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(computeDocumentFlowGridTemplateRows(config)).toBe('auto auto auto auto auto');
  });
});

describe('computeVisiblePanels', () => {
  it('keeps Watchlist out of the Risk & Positions default while retaining every risk and review panel', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    expect(computeVisiblePanels(config)).toEqual([
      WORKSTATION_PANEL_IDS.RISK,
      WORKSTATION_PANEL_IDS.POSITIONS,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.KPIS,
    ]);
  });

  it('excludes hidden panels in catalogue order', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);
    expect(computeVisiblePanels(config)).toEqual([
      WORKSTATION_PANEL_IDS.RISK,
      WORKSTATION_PANEL_IDS.POSITIONS,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.KPIS,
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
    // a saved view through explicit customization.
    config.areas.push([WORKSTATION_PANEL_IDS.WATCHLIST, WORKSTATION_PANEL_IDS.WATCHLIST]);
    config.hiddenPanels = [];
    expect(validateWorkstationViewConfig(config)).toEqual([]);
  });

  it('accepts hiding a set of optional panels when areas and hiddenPanels agree', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas[1][0] = GRID_EMPTY_CELL;
    config.areas[1][1] = GRID_EMPTY_CELL;
    config.hiddenPanels = [
      WORKSTATION_PANEL_IDS.WATCHLIST,
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
    config.areas.push(['review', 'review']);
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST];
    expect(validateWorkstationViewConfig(config)).toEqual([]);
    expect(computeVisiblePanels(config)).toContain(WORKSTATION_PANEL_IDS.PROCESS_REVIEW);
  });

  it('accepts a 1-column grid derived from a template', () => {
    const config = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
    config.areas = [
      ['risk'],
      ['positions'],
      ['kpis'],
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
    config.areas[2] = ['positions'];
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('rectangular'))).toBe(true);
  });

  it('rejects a panel split into two disconnected regions', () => {
    const config = base();
    // Watchlist appears in two disconnected cells after replacing account
    // and the KPI cell. It remains hidden in the template declaration, so
    // this also exercises that no second location can be introduced casually.
    config.areas[1][1] = WORKSTATION_PANEL_IDS.WATCHLIST;
    config.areas[4][1] = WORKSTATION_PANEL_IDS.WATCHLIST;
    const issues = validateWorkstationViewConfig(config);
    expect(issues.some((i) => i.includes('single contiguous rectangle'))).toBe(true);
    expect(issues).not.toHaveLength(0);
  });

  it('rejects an L-shaped (non-rectangular) region', () => {
    const config = base();
    // Performance normally occupies [1][0]. Extend it into the following
    // full-width Open Positions row to create a non-rectangular L-shape.
    config.areas[2][0] = WORKSTATION_PANEL_IDS.PERFORMANCE;
    config.areas[2][1] = WORKSTATION_PANEL_IDS.PERFORMANCE;
    // Positions disappeared from areas → consistency error as well; check region error exists.
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
    config.areas[4] = [GRID_EMPTY_CELL, GRID_EMPTY_CELL];
    config.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST, WORKSTATION_PANEL_IDS.KPIS];
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
    config.areas[1][1] = GRID_EMPTY_CELL; // account removed from areas
    // Watchlist remains hidden, but account is neither present nor hidden.
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
    config.areas[1] = 'positions account';
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
