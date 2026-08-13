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
 * optional panels (`hiddenPanels`), a layout `version`, and — in the v2
 * schema — an optional RGL `layout` (see `WorkstationLayoutItem`) that is
 * derived from the areas grid by `deriveLayoutFromAreas`.
 *
 * The `areas` grid is the rendered truth — hidden panels have no cells in
 * the grid (customization turns a hidden panel's former cells into `.`).
 * `hiddenPanels` is the declared counterpart used by the UI (customization
 * toggles) and by reset. Validation enforces that the two never diverge:
 * every catalogue panel is either present in `areas` or listed in
 * `hiddenPanels`, never both and never neither.
 *
 * The RGL `layout` field is optional so v1 configs (which predate the field)
 * remain readable: validation accepts a config without `layout` at any
 * version, and migration-on-read (`migrateWorkstationViewConfig`)
 * upgrades v1 configs to v2 with a layout derived from their areas.
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
 *   document flow: full-width Main Risk Metrics, a compact summary row of
 *   Account State | Performance (two grouped KPI columns), then the
 *   full-width Trades workspace. Review Metrics and Watchlist are
 *   deliberately excluded from this curated starting layout — Process
 *   Review has its dedicated saved view and Watchlist its own surface —
 *   while both remain available to saved custom views.
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
      'The curated dense default: full-width Main Risk Metrics, a compact Account State | Performance summary row (Performance rendered as two grouped KPI columns at roughly Account State height), then the full-width Trades workspace in document flow. Review Metrics and Watchlist are excluded from the default — Process Review has its dedicated saved view and Watchlist its own surface — while both remain available to saved custom views. Immutable system default and startup view.',
    columns: [1, 1, 1],
    areas: [
      ['risk', 'risk', 'risk'],
      ['account', 'perf', 'perf'],
      ['trades', 'trades', 'trades'],
    ],
    defaultHidden: [WORKSTATION_PANEL_IDS.PROCESS_REVIEW, WORKSTATION_PANEL_IDS.WATCHLIST],
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
 * `createViewFromTemplate` always emits a v2 config with a layout derived
 * from the template's areas.
 */
export const WORKSTATION_LAYOUT_VERSION = 2;

/**
 * Version of the Risk & Positions default-template composition.
 *
 * v1: the former two-column overview/side-rail arrangement. v2: the dense
 * 3-column document flow (full-width risk, compact Account State |
 * Performance | Review Metrics summary row, full-width trades). v3 (M018):
 * Review Metrics leaves the default (the dedicated Process Review saved
 * view covers it) and Performance widens to two grid columns beside Account
 * State. Migration replaces unmodified copies of former system-default
 * compositions with the current default while preserving user-modified
 * views (dense requirements: persistence and migration contract).
 */
export const WORKSTATION_DEFAULT_TEMPLATE_VERSION = 3;

/**
 * A saved workstation view: template reference, rendered grid, hidden
 * optional panels, and (v2) RGL arrangement layout.
 *
 * `areas` is the rendered truth (hidden panels have no cells in the grid;
 * customization turns a hidden panel's former cells into `.`);
 * `hiddenPanels` is the declared counterpart used by UI toggles and reset.
 * `version` records the schema version this config conforms to. `layout` is
 * the v2 RGL arrangement grid (see `WorkstationLayoutItem`); it is optional
 * so v1 configs stay readable, and is validated whenever present — unknown
 * panel ids, out-of-bounds coordinates, duplicates, overlaps, and size
 * constraint violations are rejected.
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
  /**
   * RGL arrangement layout (v2 schema): one item per visible panel with its
   * position, span, and declared size constraints. Optional so v1 configs
   * (no layout field) remain valid; v2 configs produced by this module
   * always carry a layout derived from `areas`.
   */
  layout?: WorkstationLayoutItem[];
}

// ── RGL layout (v2) ────────────────────────────────────────────────────

/**
 * One react-grid-layout grid item for the workstation arrangement grid.
 *
 * `i` is the catalogue panel id placed by this item (the single placement
 * owner for the dense model — an item may only reference the approved
 * panel catalogue). `x`/`y` are the item's top-left position in
 * arrangement-grid units and `w`/`h` its column/row span. The optional
 * `minW`/`maxW`/`minH`/`maxH` mirror react-grid-layout's per-item size
 * constraints; `deriveLayoutFromAreas` populates them from the panel
 * catalogue so persisted v2 configs are self-describing, while the
 * catalogue remains the source of truth for the accepted bounds.
 */
export interface WorkstationLayoutItem {
  /** Catalogue panel id placed by this item. */
  readonly i: WorkstationPanelId;
  /** Left column in arrangement-grid columns. */
  readonly x: number;
  /** Top row in arrangement rows. */
  readonly y: number;
  /** Column span in arrangement-grid columns. */
  readonly w: number;
  /** Row span in arrangement rows. */
  readonly h: number;
  /** Declared minimum column span (from the panel catalogue). */
  readonly minW?: number;
  /** Declared maximum column span (from the panel catalogue). */
  readonly maxW?: number;
  /** Declared minimum row span (from the panel catalogue). */
  readonly minH?: number;
  /** Declared maximum row span (from the panel catalogue). */
  readonly maxH?: number;
}

// ── RGL layout derivation ──────────────────────────────────────────────

/**
 * Derive RGL layout items from an areas grid: one item per visible panel
 * whose bounds are the panel's contiguous rectangle (x = leftmost column,
 * y = topmost row, w = column span, h = row span), with the per-panel size
 * constraints from the approved catalogue attached so the persisted layout
 * is self-describing. Items are emitted in catalogue order for
 * determinism; the inverse transform is `deriveAreasFromLayout`.
 *
 * The areas grid is the rendered truth in normal (document-flow) mode and
 * the layout is the arrangement-grid truth consumed by react-grid-layout;
 * the transform is a faithful bounding-box projection, so fixed panels
 * keep their grid span exactly (their height is content-driven in normal
 * mode — the catalogue height bounds on fixed panels are arrangement-mode
 * constraints enforced by react-grid-layout in S04, not by this transform).
 */
export function deriveLayoutFromAreas(areas: readonly (readonly string[])[]): WorkstationLayoutItem[] {
  const cellsByPanel = new Map<WorkstationPanelId, Array<[number, number]>>();
  areas.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell === GRID_EMPTY_CELL) return;
      if (!isWorkstationPanelId(cell)) return;
      const positions = cellsByPanel.get(cell) ?? [];
      positions.push([r, c]);
      cellsByPanel.set(cell, positions);
    });
  });

  const items: WorkstationLayoutItem[] = [];
  for (const id of WORKSTATION_PANEL_ID_LIST) {
    const positions = cellsByPanel.get(id);
    if (!positions) continue;
    const rows = positions.map(([r]) => r);
    const cols = positions.map(([, c]) => c);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    const minCol = Math.min(...cols);
    const maxCol = Math.max(...cols);
    const def = WORKSTATION_PANEL_CATALOGUE[id];
    items.push({
      i: id,
      x: minCol,
      y: minRow,
      w: maxCol - minCol + 1,
      h: maxRow - minRow + 1,
      minW: def.minW,
      maxW: def.maxW,
      minH: def.minH,
      maxH: def.maxH,
    });
  }
  return items;
}

/**
 * Rebuild an areas grid from RGL layout items: a rectangular grid with
 * `columns` columns and `max(y + h)` rows (an empty array when no items are
 * given), where every cell inside an item's rectangle carries that item's
 * panel id and every other cell carries `.`. This is the inverse of
 * `deriveLayoutFromAreas` for arrangement data; items with malformed
 * coordinates (negative or non-integer x/y, zero or negative w/h) are
 * skipped defensively — callers should validate untrusted layouts with
 * `validateWorkstationViewConfig` first.
 *
 * Note the two row models differ: one areas row is a document-flow row,
 * while one layout row is an arrangement row, so the transforms are not
 * losslessly invertible in general (for the curated dense templates they
 * round-trip exactly, because every visible panel's span is preserved).
 */
export function deriveAreasFromLayout(
  layout: readonly WorkstationLayoutItem[],
  columns: number,
): string[][] {
  const cols = Math.max(1, Math.floor(columns));
  if (layout.length === 0) return [];
  // Malformed items are skipped entirely — they must not influence the grid
  // dimensions either (a hostile y=10⁶ item must not allocate a giant grid).
  const valid = layout.filter(
    (item) =>
      isWorkstationPanelId(item.i) &&
      Number.isInteger(item.x) &&
      Number.isInteger(item.y) &&
      Number.isInteger(item.w) &&
      Number.isInteger(item.h) &&
      item.x >= 0 &&
      item.y >= 0 &&
      item.w >= 1 &&
      item.h >= 1,
  );
  if (valid.length === 0) return [];
  const rows = Math.max(0, ...valid.map((item) => item.y + item.h));
  const grid: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => GRID_EMPTY_CELL),
  );
  for (const item of valid) {
    const endRow = Math.min(item.y + item.h, rows);
    const endCol = Math.min(item.x + item.w, cols);
    for (let r = item.y; r < endRow; r++) {
      for (let c = item.x; c < endCol; c++) {
        grid[r][c] = item.i;
      }
    }
  }
  return grid;
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
    layout: deriveLayoutFromAreas(template.areas),
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

/** Deep-copy a view configuration (grid rows, hidden set, and layout items are copied). */
export function cloneWorkstationViewConfig(config: WorkstationViewConfig): WorkstationViewConfig {
  return {
    templateId: config.templateId,
    areas: config.areas.map((row) => [...row]),
    hiddenPanels: [...config.hiddenPanels],
    version: config.version,
    layout: config.layout?.map((item) => ({ ...item })),
  };
}

// ── v1 → v2 migration ──────────────────────────────────────────────────

/**
 * One former (pre-dense) v1 system template composition, recorded so the
 * migration can recognize unmodified copies of the templates that v1 code
 * persisted. v1 used the two-column dominant-column/right-rail arrangement
 * with the legacy panel ids `positions` (renamed `trades` in the dense
 * model) and `kpis` (removed — the period KPI band has no home in the dense
 * document flow). The grid shapes mirror the M016/S06 shell evidence and
 * docs/requirements/DASHBOARD_RISK_FIRST_REQUIREMENTS.md §5.1.
 */
interface FormerV1Template {
  readonly templateId: WorkstationTemplateId;
  /** The v1 template's base areas grid (legacy ids included). */
  readonly areas: readonly (readonly string[])[];
  /** The v1 template's declared hidden optional panels. */
  readonly defaultHidden: readonly string[];
}

const FORMER_V1_TEMPLATES: readonly FormerV1Template[] = [
  {
    templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
    areas: [
      ['risk', 'risk'],
      ['positions', 'account'],
      ['positions', 'perf'],
      ['positions', 'review'],
      ['positions', 'watchlist'],
      ['kpis', 'kpis'],
    ],
    defaultHidden: [],
  },
  {
    templateId: WORKSTATION_TEMPLATE_IDS.PERFORMANCE,
    areas: [
      ['risk', 'risk'],
      ['positions', 'account'],
      ['perf', 'perf'],
      ['perf', 'perf'],
      ['kpis', 'kpis'],
    ],
    defaultHidden: ['watchlist', 'review'],
  },
  {
    templateId: WORKSTATION_TEMPLATE_IDS.PROCESS_REVIEW,
    areas: [
      ['risk', 'risk'],
      ['positions', 'account'],
      ['review', 'review'],
      ['review', 'review'],
      ['kpis', 'kpis'],
    ],
    defaultHidden: ['watchlist', 'perf'],
  },
];

/** The legacy v1 panel id for the trades workspace (renamed `trades` in v2). */
const V1_PANEL_ID_POSITIONS = 'positions';
/** The legacy v1 panel id for the period KPI band (removed in the dense model). */
const V1_PANEL_ID_KPIS = 'kpis';

/** Deep-equality for a rectangular string grid (areas). */
function sameStringGrid(a: readonly (readonly string[])[], b: unknown): boolean {
  if (!Array.isArray(b) || a.length !== b.length) return false;
  return a.every((row, r) => {
    const other = b[r];
    return (
      Array.isArray(other) &&
      row.length === other.length &&
      row.every((cell, c) => cell === other[c])
    );
  });
}

/** Order-sensitive string-list equality (hiddenPanels). */
function sameStringList(a: readonly string[], b: unknown): boolean {
  return Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The current dense Risk & Positions default — the safe fallback target. */
function denseDefaultView(): WorkstationViewConfig {
  return createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
}

/**
 * True when `value` has the shape of a workstation view config (a plain
 * object carrying `templateId`, `areas`, `hiddenPanels`, and a numeric
 * `version`) — a much weaker test than `validateWorkstationViewConfig`,
 * which additionally requires catalogue-consistent, rectangular data.
 *
 * This is the discriminator the shared-route reader uses to separate
 * workstation rows (whose `layout` field holds a config object) from
 * dashboard rows in the same table (whose `layout` is an array of
 * react-grid-layout items): shape first, then migration upgrades v1 data,
 * then validation guards the result.
 */
export function isWorkstationViewConfigShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return (
    typeof config.templateId === 'string' &&
    Array.isArray(config.areas) &&
    Array.isArray(config.hiddenPanels) &&
    typeof config.version === 'number'
  );
}

/**
 * Migrate a persisted workstation view configuration to the current (v2)
 * schema — the migration-on-read entry point the view hook runs on every
 * config loaded from localStorage or the shared API route.
 *
 * The function is total: it always returns a valid v2 config.
 *
 * - **v2 configs** pass through unchanged when they validate; malformed v2
 *   data falls back to the dense default.
 * - **Unmodified copies of the former v1 system templates** are replaced
 *   with the corresponding dense template (v1 risk-positions → dense
 *   default; v1 performance / process-review → their dense templates), per
 *   the dense persistence contract: unmodified former-default copies
 *   receive the new default, while user-modified views are preserved and
 *   may be reset deliberately to the new template.
 * - **User-modified v1 views** are preserved: the legacy `positions` id is
 *   translated to `trades`, the removed `kpis` band's cells become empty
 *   cells, the version is bumped to v2, and a layout is derived from the
 *   translated areas when it satisfies the catalogue constraints. It
 *   usually cannot — v1's fixed panels spanned only part of the grid, and
 *   the dense anchors are locked full-width — so the view is kept as a
 *   valid v2 config without a layout, preserving the user's arrangement
 *   exactly in the rendered areas grid.
 * - **Future versions and malformed input** (non-objects, missing fields,
 *   unknown template ids, ragged grids, catalogue-foreign cells) fall back
 *   to the current dense default, so corrupt or hostile persisted data can
 *   never reach the renderer.
 */
export function migrateWorkstationViewConfig(value: unknown): WorkstationViewConfig {
  if (!isWorkstationViewConfigShape(value)) return denseDefaultView();
  const config = value as Record<string, unknown>;
  const version = config.version as number;
  const templateId = config.templateId as string;
  const areas = config.areas;
  const hiddenPanels = config.hiddenPanels;

  // Version gate: reject unknown/future schemas with the safe fallback to
  // the current system default (dense requirements: persistence contract).
  if (!Number.isInteger(version) || version < 1) return denseDefaultView();
  if (version > WORKSTATION_LAYOUT_VERSION) return denseDefaultView();

  // Current schema: pass valid configs through untouched (cloned so callers
  // can never alias persisted data); malformed v2 data falls back.
  if (version === WORKSTATION_LAYOUT_VERSION) {
    return isValidWorkstationViewConfig(config)
      ? cloneWorkstationViewConfig(config as WorkstationViewConfig)
      : denseDefaultView();
  }

  // v1 schema: unmodified former-template copies become the dense template;
  // user-modified views are translated onto the v2 catalogue and upgraded.
  if (!isWorkstationTemplateId(templateId)) return denseDefaultView();
  const unmodified = FORMER_V1_TEMPLATES.find(
    (former) =>
      former.templateId === templateId &&
      sameStringGrid(former.areas, areas) &&
      sameStringList(former.defaultHidden, hiddenPanels),
  );
  if (unmodified !== undefined) return createViewFromTemplate(unmodified.templateId);

  // User-modified v1 view: translate legacy ids, drop the removed KPI band.
  const translatedAreas: string[][] = (areas as unknown[]).map((row: unknown) => {
    if (!Array.isArray(row)) return [] as string[]; // malformed → validation fallback
    return row.map((cell: unknown) => {
      if (cell === V1_PANEL_ID_POSITIONS) return WORKSTATION_PANEL_IDS.TRADES;
      if (cell === V1_PANEL_ID_KPIS) return GRID_EMPTY_CELL;
      return cell as string;
    });
  });
  const translated: WorkstationViewConfig = {
    templateId,
    areas: translatedAreas,
    hiddenPanels: [...(hiddenPanels as unknown[])] as WorkstationPanelId[],
    version: WORKSTATION_LAYOUT_VERSION,
  };
  // Prefer a self-describing v2 config with a derived layout; when the
  // translated grid cannot satisfy the catalogue constraints (v1 fixed
  // panels were not full-width), keep the layout off — a v2 config without
  // a layout is still valid, and the user's arrangement is preserved.
  const withLayout: WorkstationViewConfig = {
    ...translated,
    layout: deriveLayoutFromAreas(translatedAreas),
  };
  if (isValidWorkstationViewConfig(withLayout)) return withLayout;
  if (isValidWorkstationViewConfig(translated)) return translated;
  return denseDefaultView();
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
 * When an RGL `layout` is present (v2 configs), validation additionally
 * rejects:
 *
 * - layout items referencing unknown panel ids;
 * - out-of-bounds coordinates (negative or non-integer x/y, zero or negative
 *   w/h, or an item extending past the grid's column edge);
 * - duplicate panel ids and overlapping items;
 * - size constraint violations (width outside the catalogue bounds for any
 *   panel — fixed panels stay locked full-width; height outside the bounds
 *   for resizable panels);
 * - malformed or catalogue-incompatible declared item constraints.
 *
 * The `layout` field itself is optional: v1 configs (no layout field) remain
 * valid and are upgraded to v2 through migration-on-read.
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

  // 6. RGL layout (v2) — item-level placement validation. The field is
  //    optional so v1 configs (no layout) remain valid — migration-on-read
  //    (`migrateWorkstationViewConfig`) upgrades them. When present, every
  //    item must reference the approved catalogue, stay inside the grid's
  //    column bounds, occupy its own space (no duplicates, no overlaps),
  //    and respect the declared per-panel size constraints.
  const layout = config.layout;
  if (layout !== undefined) {
    if (!Array.isArray(layout)) {
      issues.push('layout must be an array of grid items');
    } else if (layout.length > WORKSTATION_PANEL_ID_LIST.length) {
      // The catalogue caps visible panels (one item per panel); an oversized
      // array is malformed and would otherwise make the pairwise overlap
      // check quadratic in attacker-controlled input.
      issues.push(
        `layout has ${layout.length} items but the catalogue only defines ${WORKSTATION_PANEL_ID_LIST.length} panels`,
      );
    } else {
      const gridCols = isWorkstationTemplateId(config.templateId)
        ? WORKSTATION_TEMPLATES[config.templateId].columns.length
        : Array.isArray(areas) && areas.length > 0 && Array.isArray(areas[0])
          ? areas[0].length
          : 0;
      const seen = new Set<WorkstationPanelId>();
      const placed: Array<{ id: WorkstationPanelId; x: number; y: number; w: number; h: number }> =
        [];
      layout.forEach((rawItem: unknown, idx: number) => {
        if (typeof rawItem !== 'object' || rawItem === null || Array.isArray(rawItem)) {
          issues.push(`layout item ${idx} is not an object`);
          return;
        }
        const item = rawItem as Record<string, unknown>;
        const id = item.i;
        if (!isWorkstationPanelId(id)) {
          issues.push(`layout item ${idx} references unknown panel "${String(id)}"`);
          return;
        }
        const panelId = id;
        if (seen.has(panelId)) {
          issues.push(`layout lists panel "${panelId}" more than once`);
        }
        seen.add(panelId);

        // Shape: non-negative integer coordinates with positive spans.
        let shapeOk = true;
        const fields: ReadonlyArray<[string, unknown, number]> = [
          ['x', item.x, 0],
          ['y', item.y, 0],
          ['w', item.w, 1],
          ['h', item.h, 1],
        ];
        for (const [name, value, min] of fields) {
          if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
            issues.push(
              `layout item "${panelId}" has an invalid ${name} coordinate (expected an integer ≥ ${min}, got ${String(value)})`,
            );
            shapeOk = false;
          }
        }
        if (!shapeOk) return;
        const x = item.x as number;
        const y = item.y as number;
        const w = item.w as number;
        const h = item.h as number;

        // Right-edge bound — an item may not extend past the grid's columns.
        if (gridCols > 0 && x + w > gridCols) {
          issues.push(
            `layout item "${panelId}" extends past the right grid edge (x + w = ${x + w} exceeds ${gridCols} columns)`,
          );
        }

        // Declared per-panel constraints (RGL minW/maxW/minH/maxH) must be
        // positive integers, min ≤ max, and within the catalogue envelope so
        // persisted data can never loosen the approved bounds.
        const declaredMinW = typeof item.minW === 'number' ? item.minW : undefined;
        const declaredMaxW = typeof item.maxW === 'number' ? item.maxW : undefined;
        const declaredMinH = typeof item.minH === 'number' ? item.minH : undefined;
        const declaredMaxH = typeof item.maxH === 'number' ? item.maxH : undefined;
        let boundsOk = true;
        for (const [name, value] of [
          ['minW', declaredMinW],
          ['maxW', declaredMaxW],
          ['minH', declaredMinH],
          ['maxH', declaredMaxH],
        ] as const) {
          if (value !== undefined && (value < 1 || !Number.isInteger(value))) {
            issues.push(`layout item "${panelId}" declares an invalid ${name} (got ${String(value)})`);
            boundsOk = false;
          }
        }
        if (boundsOk) {
          if (
            declaredMinW !== undefined &&
            declaredMaxW !== undefined &&
            declaredMinW > declaredMaxW
          ) {
            issues.push(
              `layout item "${panelId}" declares minW > maxW (${declaredMinW} > ${declaredMaxW})`,
            );
          }
          if (
            declaredMinH !== undefined &&
            declaredMaxH !== undefined &&
            declaredMinH > declaredMaxH
          ) {
            issues.push(
              `layout item "${panelId}" declares minH > maxH (${declaredMinH} > ${declaredMaxH})`,
            );
          }
          const def = WORKSTATION_PANEL_CATALOGUE[panelId];
          const envelope: ReadonlyArray<[string, number | undefined, number, number]> = [
            ['minW', declaredMinW, def.minW, def.maxW],
            ['maxW', declaredMaxW, def.minW, def.maxW],
            ['minH', declaredMinH, def.minH, def.maxH],
            ['maxH', declaredMaxH, def.minH, def.maxH],
          ];
          for (const [name, value, lo, hi] of envelope) {
            if (value !== undefined && (value < lo || value > hi)) {
              issues.push(
                `layout item "${panelId}" declares ${name} = ${value} outside the catalogue bounds [${lo}, ${hi}]`,
              );
            }
          }
        }

        // Catalogue constraint check: width bounds apply to every panel (the
        // fixed anchors are locked full-width and must never become a rail);
        // height bounds apply to resizable panels only — fixed panels' height
        // is content-driven in the normal document flow.
        const def = WORKSTATION_PANEL_CATALOGUE[panelId];
        if (w < def.minW || w > def.maxW) {
          issues.push(
            `layout item "${panelId}" has width ${w} outside the declared bounds [${def.minW}, ${def.maxW}]`,
          );
        }
        if (def.canResize && (h < def.minH || h > def.maxH)) {
          issues.push(
            `layout item "${panelId}" has height ${h} outside the declared bounds [${def.minH}, ${def.maxH}]`,
          );
        }

        placed.push({ id: panelId, x, y, w, h });
      });

      // Overlap check — pairwise rectangle intersection between the
      // shape-valid items that were placed.
      for (let a = 0; a < placed.length; a++) {
        for (let b = a + 1; b < placed.length; b++) {
          const A = placed[a];
          const B = placed[b];
          const overlap =
            A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
          if (overlap) {
            issues.push(`layout items "${A.id}" and "${B.id}" overlap`);
          }
        }
      }
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
