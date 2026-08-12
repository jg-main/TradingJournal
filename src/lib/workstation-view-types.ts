/**
 * Workstation view types — typed foundation for curated saved views and
 * customization on the Risk & Positions workstation (M016/S06).
 *
 * This module is the pure-logic layer for S06: panel identifiers and the
 * approved panel catalogue, the three curated system templates, the saved
 * view configuration shape, layout validation, and dynamic CSS
 * grid-template-* computation. It has no React or database dependency and is
 * fully unit-testable (see workstation-view-types.test.ts).
 *
 * ## Relationship to R035
 *
 * R035 requires that saved layout configuration is validated and versioned,
 * references only the approved first-party widget catalogue and declared
 * options, and never accepts code, markup, queries, or arbitrary component
 * names.
 *
 * - `WORKSTATION_PANEL_CATALOGUE` is that approved catalogue for the
 *   workstation (mirroring the role `widget-registry.ts` plays for the
 *   dashboard grid).
 * - `validateWorkstationViewConfig` enforces the catalogue-only rule — any
 *   cell that is not a registered panel id (or the `.` empty cell) is
 *   rejected, so arbitrary component names can never enter a persisted
 *   layout.
 * - `WORKSTATION_LAYOUT_VERSION` versions the persisted shape; validation
 *   rejects future/unknown schemas.
 *
 * ## Data model
 *
 * A saved view is a `WorkstationViewConfig`: the id of the system template it
 * was derived from (`templateId`), an explicit rectangular `areas` grid (each
 * cell is a registered panel id or `.` for empty space), the set of hidden
 * optional panels (`hiddenPanels`), and a layout `version`.
 *
 * The `areas` grid is the rendered truth — hidden panels have no cells in
 * the grid (customization turns a hidden panel's former cells into `.`).
 * `hiddenPanels` is the declared counterpart used by the UI (customization
 * toggles) and by reset. Validation enforces that the two never diverge:
 * every catalogue panel is either present in `areas` or listed in
 * `hiddenPanels`, never both and never neither.
 */

// ── Panel identifiers and approved catalogue ────────────────────────────

/**
 * Immutable map of workstation panel identifiers.
 *
 * Each id doubles as the CSS grid-area name consumed by the workstation
 * panels (e.g. `style={{ gridArea: 'trades' }}`), so panel ids must stay
 * in sync with the `gridArea` values in `src/components/workstation/*`.
 *
 * Convention: kebab-free lowercase single words matching the grid area.
 */
export const WORKSTATION_PANEL_IDS = {
  RISK: 'risk',
  TRADES: 'trades',
  ACCOUNT: 'account',
  PERFORMANCE: 'perf',
  PROCESS_REVIEW: 'review',
  WATCHLIST: 'watchlist',
} as const;

/** Union type of all registered workstation panel id string values. */
export type WorkstationPanelId = (typeof WORKSTATION_PANEL_IDS)[keyof typeof WORKSTATION_PANEL_IDS];

/** Ordered panel list (stable iteration order for UI and derivation helpers). */
export const WORKSTATION_PANEL_ID_LIST: readonly WorkstationPanelId[] = [
  WORKSTATION_PANEL_IDS.RISK,
  WORKSTATION_PANEL_IDS.TRADES,
  WORKSTATION_PANEL_IDS.ACCOUNT,
  WORKSTATION_PANEL_IDS.PERFORMANCE,
  WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
  WORKSTATION_PANEL_IDS.WATCHLIST,
];

/** Empty-grid cell marker used inside `areas` grids. */
export const GRID_EMPTY_CELL = '.';

/**
 * Metadata for one workstation panel in the approved catalogue.
 *
 * `canHide: false` marks the fixed safety/data-quality areas that stay
 * visible in every view (dense-model contract: the alert strip is outside
 * the grid entirely, while `risk` and `trades` are the always-visible grid
 * panels). `canDrag`/`canResize` declare which panels may be moved or
 * resized in saved-view arrangement mode (dense requirements: Main Risk
 * Metrics and the Trades workspace are protected anchors; summary panels
 * are resizable within readable bounds). `minW`/`maxW`/`minH`/`maxH` are
 * the declared size constraints in arrangement-grid units (the dense
 * template grid has 3 columns; rows are arrangement rows) — a fixed panel
 * declares `minW === maxW` and `minH === maxH`. `fill` drives row sizing in
 * `computeGridTemplateRows`: the content-sized risk band uses `auto`, all
 * other panels stretch with `minmax(0, 1fr)`.
 */
export interface WorkstationPanelDefinition {
  /** Unique panel identifier (matches the CSS grid-area name). */
  readonly id: WorkstationPanelId;
  /** Human-readable title shown in the customize UI. */
  readonly title: string;
  /** What the panel renders (catalogue documentation). */
  readonly description: string;
  /** Whether the panel can be hidden by the user (false = always visible). */
  readonly canHide: boolean;
  /** Whether the panel can be dragged in arrangement mode (false = fixed position). */
  readonly canDrag: boolean;
  /** Whether the panel can be resized in arrangement mode (false = fixed size). */
  readonly canResize: boolean;
  /** Minimum grid-column span in arrangement-grid columns. */
  readonly minW: number;
  /** Maximum grid-column span in arrangement-grid columns. */
  readonly maxW: number;
  /** Minimum grid-row span in arrangement rows. */
  readonly minH: number;
  /** Maximum grid-row span in arrangement rows. */
  readonly maxH: number;
  /** Whether the panel's row stretches to fill available height. */
  readonly fill: boolean;
}

/**
 * Approved first-party workstation panel catalogue — the immutable source of
 * truth for which panels a saved layout may reference. Saved layouts are
 * validated against this catalogue and may not reference anything else.
 */
export const WORKSTATION_PANEL_CATALOGUE = {
  [WORKSTATION_PANEL_IDS.RISK]: {
    id: WORKSTATION_PANEL_IDS.RISK,
    title: 'Main Risk Metrics',
    description:
      'Current exposure and risk summary band — full-width protected anchor (dense requirements: complete grid width below the data-quality alert).',
    canHide: false,
    canDrag: false,
    canResize: false,
    minW: 3,
    maxW: 3,
    minH: 1,
    maxH: 1,
    fill: false,
  } satisfies WorkstationPanelDefinition,

  [WORKSTATION_PANEL_IDS.TRADES]: {
    id: WORKSTATION_PANEL_IDS.TRADES,
    title: 'Trades Workspace',
    description:
      'Full-width open/current and closed/historical trade workflow — the primary operational workspace, never compressed into a side panel.',
    canHide: false,
    canDrag: false,
    canResize: false,
    minW: 3,
    maxW: 3,
    minH: 3,
    maxH: 12,
    fill: true,
  } satisfies WorkstationPanelDefinition,

  [WORKSTATION_PANEL_IDS.ACCOUNT]: {
    id: WORKSTATION_PANEL_IDS.ACCOUNT,
    title: 'Account State',
    description:
      'Compact summary: account balances, valuation state, current Open P&L, realized/total P&L with stated scope, and drawdown (dense summary row).',
    canHide: true,
    canDrag: true,
    canResize: true,
    minW: 1,
    maxW: 3,
    minH: 1,
    maxH: 3,
    fill: true,
  } satisfies WorkstationPanelDefinition,

  [WORKSTATION_PANEL_IDS.PERFORMANCE]: {
    id: WORKSTATION_PANEL_IDS.PERFORMANCE,
    title: 'Performance',
    description:
      'Compact period metrics only: net P&L, return, closed-decision count, win rate, profit factor, average R, and related data points (dense summary row, no charts).',
    canHide: true,
    canDrag: true,
    canResize: true,
    minW: 1,
    maxW: 3,
    minH: 1,
    maxH: 3,
    fill: true,
  } satisfies WorkstationPanelDefinition,

  [WORKSTATION_PANEL_IDS.PROCESS_REVIEW]: {
    id: WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    title: 'Review Metrics',
    description:
      'Compact, action-oriented summary of process score, checklist/mistake coverage, directional or setup insights, and highest-attention items (dense summary row).',
    canHide: true,
    canDrag: true,
    canResize: true,
    minW: 1,
    maxW: 3,
    minH: 1,
    maxH: 3,
    fill: true,
  } satisfies WorkstationPanelDefinition,

  [WORKSTATION_PANEL_IDS.WATCHLIST]: {
    id: WORKSTATION_PANEL_IDS.WATCHLIST,
    title: 'Watchlist',
    description:
      'Optional saved-view attention surface; available separately from the curated Risk & Positions flow.',
    canHide: true,
    canDrag: true,
    canResize: true,
    minW: 1,
    maxW: 3,
    minH: 1,
    maxH: 3,
    fill: true,
  } satisfies WorkstationPanelDefinition,
} as const satisfies Record<WorkstationPanelId, WorkstationPanelDefinition>;

/** Panels that must remain visible in every view. */
export const FIXED_PANEL_IDS: readonly WorkstationPanelId[] = WORKSTATION_PANEL_ID_LIST.filter(
  (id) => !WORKSTATION_PANEL_CATALOGUE[id].canHide,
);

/** Panels the user may hide/show during customization. */
export const OPTIONAL_PANEL_IDS: readonly WorkstationPanelId[] = WORKSTATION_PANEL_ID_LIST.filter(
  (id) => WORKSTATION_PANEL_CATALOGUE[id].canHide,
);

export function isWorkstationPanelId(value: unknown): value is WorkstationPanelId {
  return typeof value === 'string' && value in WORKSTATION_PANEL_CATALOGUE;
}

// ── System templates ────────────────────────────────────────────────────

/**
 * Immutable map of curated system template ids.
 *
 * Templates are the source for every saved view: users create views from a
 * template, and Reset restores the template's base configuration. The
 * Risk & Positions template is the immutable system default and the startup
 * view until the user explicitly selects another saved view (R035).
 */
export const WORKSTATION_TEMPLATE_IDS = {
  RISK_POSITIONS: 'risk-positions',
  PERFORMANCE: 'performance',
  PROCESS_REVIEW: 'process-review',
} as const;

/** Union type of all system template id string values. */
export type WorkstationTemplateId =
  (typeof WORKSTATION_TEMPLATE_IDS)[keyof typeof WORKSTATION_TEMPLATE_IDS];

/**
 * A curated system template: name, description, base grid, and column widths.
 *
 * `areas` is the base grid of visible panels — every cell is a registered
 * panel id or `.`. Hidden-by-default optional panels are declared in
 * `defaultHidden` and have no cells in the base grid (customization may
 * introduce `.` cells when it hides a panel). The fixed panels
 * (`risk`, `trades`) are present in every template grid.
 */
export interface WorkstationTemplate {
  readonly id: WorkstationTemplateId;
  /** Human-readable template name shown in the view switcher. */
  readonly name: string;
  readonly description: string;
  /**
   * Relative column widths for the grid tracks. Every template in the dense
   * model uses three equal columns, e.g. [1, 1, 1]; the pre-dense [2, 1]
   * dominant-column + right-rail split is gone.
   */
  readonly columns: readonly number[];
  /** Base grid; every cell is a registered panel id or `.`. */
  readonly areas: readonly (readonly string[])[];
  /** Optional panels hidden by default in this template. */
  readonly defaultHidden: readonly WorkstationPanelId[];
  /** True for the immutable Risk & Positions template (startup default). */
  readonly isSystemDefault: boolean;
}

/**
 * The three curated system templates (R035), restructured to the dense
 * 3-column model (docs/requirements/DASHBOARD_DENSE_LAYOUT_REQUIREMENTS.md):
 *
 * - **risk-positions** — the immutable default and startup view. The dense
 *   document flow: full-width Main Risk Metrics, a compact equal-width
 *   Account State | Performance | Review Metrics row, then the full-width
 *   Trades workspace. Watchlist is deliberately excluded from this curated
 *   starting layout, while remaining available to saved custom views and its
 *   dedicated navigation surface.
 * - **performance** — the same dense flow with a prominent full-width
 *   Performance panel below the trades workspace; the watchlist and
 *   review-metrics panels are hidden by default.
 * - **process-review** — the same dense flow with a prominent full-width
 *   Review Metrics panel below the trades workspace; the performance and
 *   watchlist panels are hidden by default.
 */
export const WORKSTATION_TEMPLATES = {
  [WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS]: {
    id: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
    name: 'Risk & Positions',
    description:
      'The curated dense default: full-width Main Risk Metrics, a compact equal-width Account State | Performance | Review Metrics row, then the full-width Trades workspace in document flow. Watchlist remains available through saved custom views and its dedicated page. Immutable system default and startup view.',
    columns: [1, 1, 1],
    areas: [
      ['risk', 'risk', 'risk'],
      ['account', 'perf', 'review'],
      ['trades', 'trades', 'trades'],
    ],
    defaultHidden: [WORKSTATION_PANEL_IDS.WATCHLIST],
    isSystemDefault: true,
  } satisfies WorkstationTemplate,

  [WORKSTATION_TEMPLATE_IDS.PERFORMANCE]: {
    id: WORKSTATION_TEMPLATE_IDS.PERFORMANCE,
    name: 'Performance',
    description:
      'Period performance, equity/drawdown, calendar, and breakdowns: dense flow with full-width risk and trades and a prominent full-width Performance panel below. Watchlist and Review Metrics are hidden by default.',
    columns: [1, 1, 1],
    areas: [
      ['risk', 'risk', 'risk'],
      ['account', 'account', '.'],
      ['trades', 'trades', 'trades'],
      ['perf', 'perf', 'perf'],
      ['perf', 'perf', 'perf'],
    ],
    defaultHidden: [WORKSTATION_PANEL_IDS.WATCHLIST, WORKSTATION_PANEL_IDS.PROCESS_REVIEW],
    isSystemDefault: false,
  } satisfies WorkstationTemplate,

  [WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW]: {
    id: WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW,
    name: 'Process Review',
    description:
      'Setup, direction, execution quality, checklist, and review metrics: dense flow with full-width risk and trades and a prominent full-width Review Metrics panel below. Watchlist and Performance are hidden by default.',
    columns: [1, 1, 1],
    areas: [
      ['risk', 'risk', 'risk'],
      ['account', 'account', '.'],
      ['trades', 'trades', 'trades'],
      ['review', 'review', 'review'],
      ['review', 'review', 'review'],
    ],
    defaultHidden: [WORKSTATION_PANEL_IDS.PERFORMANCE, WORKSTATION_PANEL_IDS.WATCHLIST],
    isSystemDefault: false,
  } satisfies WorkstationTemplate,
} as const satisfies Record<WorkstationTemplateId, WorkstationTemplate>;

export function isWorkstationTemplateId(value: unknown): value is WorkstationTemplateId {
  return typeof value === 'string' && value in WORKSTATION_TEMPLATES;
}

// ── Saved view configuration ────────────────────────────────────────────

/**
 * Current version of the saved-layout schema (R035: layouts are versioned).
 *
 * v1: the pre-dense two-column schema — no RGL `layout` field; templates
 * used dominant-column + right-rail arrangements. v2: the dense 3-column
 * model — templates are dense document flows and saved configs carry an RGL
 * layout (introduced alongside, see `WorkstationLayoutItem`). v1 configs
 * remain readable through migration-on-read (`migrateWorkstationViewConfig`).
 */
export const WORKSTATION_LAYOUT_VERSION = 2;

/**
 * Version of the Risk & Positions default-template composition.
 *
 * v1: the former two-column overview/side-rail arrangement. v2: the dense
 * 3-column document flow (full-width risk, compact summary row, full-width
 * trades). Migration uses this to replace unmodified copies of the former
 * system default with the dense default while preserving user-modified views
 * (dense requirements: persistence and migration contract).
 */
export const WORKSTATION_DEFAULT_TEMPLATE_VERSION = 2;

/**
 * A saved workstation view: template reference, rendered grid, and hidden
 * optional panels.
 *
 * `areas` is the rendered truth (hidden panels have no cells in the grid;
 * customization turns a hidden panel's former cells into `.`);
 * `hiddenPanels` is the declared counterpart used by UI toggles and reset.
 * `version` records the schema version this config conforms to.
 */
export interface WorkstationViewConfig {
  /** The system template this view was derived from. */
  readonly templateId: WorkstationTemplateId;
  /** Rectangular grid of panel area names or `.` empty cells. */
  areas: string[][];
  /** Optional panels hidden in this view (must be catalogue-consistent). */
  hiddenPanels: WorkstationPanelId[];
  /** Layout schema version (must be ≥ 1 and ≤ WORKSTATION_LAYOUT_VERSION). */
  version: number;
}

// ── Factories ───────────────────────────────────────────────────────────

/**
 * Create a view configuration from a system template (deep copy of the base
 * grid). Used when creating a saved view from a template and by Reset.
 */
export function createViewFromTemplate(templateId: WorkstationTemplateId): WorkstationViewConfig {
  const template = WORKSTATION_TEMPLATES[templateId];
  return {
    templateId,
    areas: template.areas.map((row) => [...row]),
    hiddenPanels: [...template.defaultHidden],
    version: WORKSTATION_LAYOUT_VERSION,
  };
}

/**
 * Reset a view configuration to its template's base configuration (R035:
 * "reset a view to its template"). The template reference is preserved, so a
 * user view reset still knows which template it came from.
 */
export function resetViewToTemplate(config: WorkstationViewConfig): WorkstationViewConfig {
  return createViewFromTemplate(config.templateId);
}

/** Deep-copy a view configuration (grid rows and hidden set are copied). */
export function cloneWorkstationViewConfig(config: WorkstationViewConfig): WorkstationViewConfig {
  return {
    templateId: config.templateId,
    areas: config.areas.map((row) => [...row]),
    hiddenPanels: [...config.hiddenPanels],
    version: config.version,
  };
}

// ── Validation ──────────────────────────────────────────────────────────

/**
 * Validate a saved layout configuration against the approved panel
 * catalogue and the versioned schema.
 *
 * Returns an array of human-readable issues; an empty array means the config
 * is valid. Validation rejects:
 *
 * - unknown template ids;
 * - unknown/future layout versions;
 * - any area cell that is not a registered panel id or `.` (R035: layouts
 *   must never accept code, markup, queries, or arbitrary component names);
 * - non-rectangular grids;
 * - panel regions that are split or L-shaped (each panel must occupy a
 *   single contiguous rectangle);
 * - required (non-hideable) panels being hidden or absent;
 * - unknown or duplicate hidden panels;
 * - inconsistency between `areas` and `hiddenPanels` (every catalogue panel
 *   must be present in `areas` or listed in `hiddenPanels`, never both and
 *   never neither);
 * - grids with no visible panel at all.
 *
 * Safe to call on untrusted persisted/API data (the parameter is `unknown`).
 */
export function validateWorkstationViewConfig(value: unknown): string[] {
  const issues: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['view config must be a plain object'];
  }
  const config = value as Record<string, unknown>;

  // 1. Template reference — must be one of the curated system templates.
  if (!isWorkstationTemplateId(config.templateId)) {
    issues.push(`unknown template id: ${String(config.templateId)}`);
  }

  // 2. Version — layouts are versioned; reject unknown future schemas.
  const version = config.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    issues.push(`version must be a positive integer, got ${String(version)}`);
  } else if (version > WORKSTATION_LAYOUT_VERSION) {
    issues.push(
      `version ${version} is newer than the supported layout version ${WORKSTATION_LAYOUT_VERSION}`,
    );
  }

  // 3. Areas grid — rectangular, catalogue-only cells.
  const areas = config.areas;
  if (!Array.isArray(areas) || areas.length === 0) {
    issues.push('areas must be a non-empty array of rows');
  } else {
    const colCount = areas[0].length;
    if (!Number.isInteger(colCount) || colCount < 1) {
      issues.push('every area row must contain at least one cell');
    }
    const cellsByPanel = new Map<WorkstationPanelId, Array<[number, number]>>();
    areas.forEach((row: unknown, r: number) => {
      if (!Array.isArray(row)) {
        issues.push(`areas row ${r} is not an array`);
        return;
      }
      if (row.length !== colCount) {
        issues.push(
          `areas row ${r} has ${row.length} cells but the grid has ${colCount} columns — a rectangular grid is required`,
        );
        return;
      }
      row.forEach((cell: unknown, c: number) => {
        if (cell === GRID_EMPTY_CELL) return;
        if (!isWorkstationPanelId(cell)) {
          issues.push(
            `areas[${r}][${c}] references "${String(cell)}" which is not in the approved panel catalogue`,
          );
          return;
        }
        const positions = cellsByPanel.get(cell) ?? [];
        positions.push([r, c]);
        cellsByPanel.set(cell, positions);
      });
    });

    // Each panel's region must be a single contiguous rectangle
    // (no split or L-shaped regions).
    for (const [panelId, positions] of cellsByPanel) {
      const rows = positions.map(([r]) => r);
      const cols = positions.map(([, c]) => c);
      const minRow = Math.min(...rows);
      const maxRow = Math.max(...rows);
      const minCol = Math.min(...cols);
      const maxCol = Math.max(...cols);
      const boundingBoxSize = (maxRow - minRow + 1) * (maxCol - minCol + 1);
      if (positions.length !== boundingBoxSize) {
        issues.push(
          `panel "${panelId}" occupies ${positions.length} cells but its bounding box spans ${boundingBoxSize} — the region must be a single contiguous rectangle`,
        );
      }
    }
  }

  // 4. Hidden panels — declared set of optional panels hidden in this view.
  const hiddenPanels = config.hiddenPanels;
  if (!Array.isArray(hiddenPanels)) {
    issues.push('hiddenPanels must be an array');
  } else {
    const seen = new Set<string>();
    hiddenPanels.forEach((id: unknown) => {
      if (!isWorkstationPanelId(id)) {
        issues.push(
          `hiddenPanels references "${String(id)}" which is not in the approved panel catalogue`,
        );
        return;
      }
      if (!WORKSTATION_PANEL_CATALOGUE[id].canHide) {
        issues.push(`panel "${id}" is required (canHide: false) and cannot be hidden`);
      }
      if (seen.has(id)) {
        issues.push(`hiddenPanels lists "${id}" more than once`);
      }
      seen.add(id);
    });
  }

  // 5. Consistency — every catalogue panel is either present in `areas` or
  //    listed in `hiddenPanels`, never both and never neither.
  if (Array.isArray(areas) && areas.length > 0 && Array.isArray(hiddenPanels)) {
    const present = new Set<WorkstationPanelId>();
    for (const row of areas) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (isWorkstationPanelId(cell)) present.add(cell);
      }
    }
    const hidden = new Set<WorkstationPanelId>();
    for (const id of hiddenPanels) {
      if (isWorkstationPanelId(id)) hidden.add(id);
    }
    for (const id of WORKSTATION_PANEL_ID_LIST) {
      const inAreas = present.has(id);
      const isHidden = hidden.has(id);
      if (inAreas && isHidden) {
        issues.push(`panel "${id}" appears in areas but is also listed in hiddenPanels`);
      } else if (!inAreas && !isHidden) {
        issues.push(`panel "${id}" is neither present in areas nor listed in hiddenPanels`);
      }
    }
    if (present.size === 0) {
      issues.push('at least one panel must be visible in the grid');
    }
  }

  return issues;
}

/**
 * True when the value is a valid `WorkstationViewConfig` (zero validation
 * issues). The type predicate lets callers narrow untrusted persisted data.
 */
export function isValidWorkstationViewConfig(value: unknown): value is WorkstationViewConfig {
  return validateWorkstationViewConfig(value).length === 0;
}

// ── Grid computation ────────────────────────────────────────────────────

/**
 * Serialize a view's areas grid into the CSS `grid-template-areas` value,
 * e.g. `"risk risk" "trades account" "trades trades"`.
 *
 * The areas grid is already the rendered truth (hidden panels have no cells;
 * a hidden panel's former cells appear as `.`), so this is a pure
 * serialization. Callers that load untrusted data should validate first with
 * `validateWorkstationViewConfig`.
 */
export function computeGridTemplateAreas(config: WorkstationViewConfig): string {
  return config.areas.map((row) => `"${row.join(' ')}"`).join(' ');
}

/**
 * Compute the CSS `grid-template-columns` value for a view: one
 * `minmax(0, Nfr)` track per grid column using the template's declared
 * column widths (e.g. `minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)` for
 * the dense three equal columns). Falls back to equal `1fr` tracks when the
 * template does not declare a matching width set.
 */
export function computeGridTemplateColumns(config: WorkstationViewConfig): string {
  const colCount = config.areas[0]?.length ?? 1;
  const template = WORKSTATION_TEMPLATES[config.templateId];
  const ratios =
    template !== undefined && template.columns.length === colCount
      ? template.columns
      : Array.from({ length: colCount }, () => 1);
  return ratios.map((width) => `minmax(0, ${width}fr)`).join(' ');
}

/**
 * Compute the CSS `grid-template-rows` value for a view: rows containing a
 * fill panel stretch with `minmax(0, 1fr)`; content-sized bands (`risk`)
 * and empty rows use `auto` (an empty row collapses to zero height).
 */
export function computeGridTemplateRows(config: WorkstationViewConfig): string {
  return config.areas
    .map((row) => {
      const hasFillPanel = row.some((cell) => {
        if (cell === GRID_EMPTY_CELL) return false;
        if (!isWorkstationPanelId(cell)) return false;
        return WORKSTATION_PANEL_CATALOGUE[cell].fill;
      });
      return hasFillPanel ? 'minmax(0, 1fr)' : 'auto';
    })
    .join(' ');
}

/**
 * Compute content-sized grid rows for the document-flow Risk & Positions
 * workflow. The contained Performance and Process Review views intentionally
 * use `computeGridTemplateRows` to share available viewport height; applying
 * those `1fr` tracks to a page-scrolling workflow would instead create large
 * empty panels below otherwise compact operational content.
 */
export function computeDocumentFlowGridTemplateRows(config: WorkstationViewConfig): string {
  return config.areas.map(() => 'auto').join(' ');
}

/**
 * The ordered list of panels visible in a view (catalogue order minus the
 * view's hidden set). The shell renders exactly these panels; the customize
 * bar lists the optional ones for hide/show toggles.
 */
export function computeVisiblePanels(config: WorkstationViewConfig): WorkstationPanelId[] {
  const hidden = new Set(config.hiddenPanels);
  return WORKSTATION_PANEL_ID_LIST.filter((id) => !hidden.has(id));
}
