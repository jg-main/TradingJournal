'use client';

/**
 * useCustomizeMode — explicit customize-mode state machine for workstation
 * saved views (M016/S06-T04).
 *
 * R035 requires Customize to be an explicit editing state with Save, Cancel,
 * Undo, and Reset, with no drag/resize handles in normal mode. This hook owns
 * the editing session for the *active view's layout configuration*
 * (`WorkstationViewConfig` from src/lib/workstation-view-types.ts):
 *
 * - `enterCustomize(config)` snapshots the view's current config as the
 *   session base and opens a working draft (deep-cloned).
 * - `togglePanelVisibility(id)` hides/shows an optional panel in the draft,
 *   keeping `areas` and `hiddenPanels` catalogue-consistent at every step
 *   (hiding blanks the panel's cells to `.`; showing restores the panel's
 *   template region). Fixed panels (`risk`, `trades`) cannot be
 *   toggled — they are always visible in every view.
 * - `undo()` walks back through the draft history (bounded stack).
 * - `resetDraft()` restores the draft to the view's template base grid
 *   (R035: "reset a view to its template").
 * - `cancel()` discards the draft and exits; the persisted view is
 *   untouched because nothing was saved.
 * - `save()` returns the draft config for the caller to persist and exits
 *   the session.
 *
 * The hook is deliberately view-agnostic: it never touches the view store,
 * localStorage, or the API. The shell wires the returned draft into the
 * rendered grid (live preview) and persists the saved config through
 * `useWorkstationViews().updateViewConfig`. This mirrors the
 * `useCustomizationMode` dashboard pattern: state machine in the hook,
 * persistence decisions in the caller.
 *
 * ## Why a bounded undo stack
 *
 * Undo history is capped (`MAX_UNDO_DEPTH`) so a long editing session cannot
 * grow state without bound — the 10x load profile for a single editing
 * session is bounded memory (~20 config clones, each a small 2D grid).
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  GRID_EMPTY_CELL,
  OPTIONAL_PANEL_IDS,
  WORKSTATION_PANEL_CATALOGUE,
  WORKSTATION_PANEL_ID_LIST,
  WORKSTATION_TEMPLATE_IDS,
  WORKSTATION_TEMPLATES,
  cloneWorkstationViewConfig,
  resetViewToTemplate,
  type WorkstationPanelId,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';

// ── Constants ──────────────────────────────────────────────────────────

/** Maximum number of draft states retained for Undo. */
const MAX_UNDO_DEPTH = 20;

// ── Pure helpers ───────────────────────────────────────────────────────

/**
 * Deep-equality for view configs (template id, version, grid, hidden set).
 * `hiddenPanels` ordering is canonical (catalogue order) because
 * `togglePanelVisibilityInConfig` keeps it sorted, so index-wise comparison
 * is deterministic.
 */
export function workstationConfigsEqual(
  a: WorkstationViewConfig,
  b: WorkstationViewConfig,
): boolean {
  if (a.templateId !== b.templateId || a.version !== b.version) return false;
  if (a.areas.length !== b.areas.length) return false;
  for (let r = 0; r < a.areas.length; r++) {
    const rowA = a.areas[r];
    const rowB = b.areas[r];
    if (rowA.length !== rowB.length) return false;
    for (let c = 0; c < rowA.length; c++) {
      if (rowA[c] !== rowB[c]) return false;
    }
  }
  if (a.hiddenPanels.length !== b.hiddenPanels.length) return false;
  return a.hiddenPanels.every((id, i) => id === b.hiddenPanels[i]);
}

/** Catalogue-order comparator for hidden-panel lists. */
function comparePanelByCatalogueOrder(a: WorkstationPanelId, b: WorkstationPanelId): number {
  return WORKSTATION_PANEL_ID_LIST.indexOf(a) - WORKSTATION_PANEL_ID_LIST.indexOf(b);
}

/**
 * Return a deep copy of a config with `hiddenPanels` sorted into catalogue
 * order. Template `defaultHidden` order is author-chosen (pinned by T01
 * tests), so sessions normalize once at entry so `isDirty` compares like
 * with like and hide/show round-trips do not leave spurious unsaved state.
 */
function withNormalizedHiddenOrder(config: WorkstationViewConfig): WorkstationViewConfig {
  const next = cloneWorkstationViewConfig(config);
  next.hiddenPanels.sort(comparePanelByCatalogueOrder);
  return next;
}

/**
 * Toggle one optional panel's visibility in a view config, returning the
 * next config or null when the toggle is not applicable.
 *
 * - Hiding a visible panel replaces its cells with `.` and adds it to
 *   `hiddenPanels` (sorted in catalogue order) — the T01 design contract:
 *   "customization turns a hidden panel's former cells into `.`". Fully
 *   empty rows (every cell `.`) are pruned so repeated hide/show cycles
 *   never accumulate ghost rows.
 * - Showing a hidden panel restores it at the panel's region in the current
 *   template's base grid when every one of those cells is empty and in
 *   bounds (the round-trip path). Otherwise — a panel the template hides by
 *   default, e.g. Watchlist in Risk & Positions or Performance, has no
 *   template region — the panel is appended as a new row at the bottom of
 *   the grid. Risk & Positions adds it as a full-width document row; the
 *   rail-based templates retain a compact rail cell. Any optional panel can
 *   therefore be shown in any view; the grid stays rectangular and
 *   catalogue-valid. (The v1 catalog anchored these fallbacks above the
 *   fixed KPI band; the dense catalogue removed the band, so fallbacks
 *   append at the grid end.)
 * - Fixed panels (`canHide: false`) and unknown ids return null.
 *
 * The result is valid by construction (`validateWorkstationViewConfig`
 * returns []): grids stay rectangular, hidden/areas stay consistent, and
 * regions stay contiguous rectangles.
 */
export function togglePanelVisibilityInConfig(
  config: WorkstationViewConfig,
  panelId: WorkstationPanelId,
): WorkstationViewConfig | null {
  const definition = WORKSTATION_PANEL_CATALOGUE[panelId];
  if (!definition || !definition.canHide) return null;

  const next = cloneWorkstationViewConfig(config);
  const hiddenIdx = next.hiddenPanels.indexOf(panelId);

  if (hiddenIdx >= 0) {
    // SHOW. First try the panel's region in the current template's base
    // grid — the round-trip path for panels the template renders.
    const template = WORKSTATION_TEMPLATES[next.templateId];
    const region: Array<[number, number]> = [];
    template.areas.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell === panelId) region.push([r, c]);
      });
    });
    const homeIsFree =
      region.length > 0 &&
      region.every(([r, c]) => next.areas[r]?.[c] === GRID_EMPTY_CELL);
    if (homeIsFree) {
      for (const [r, c] of region) {
        next.areas[r][c] = panelId;
      }
      next.hiddenPanels.splice(hiddenIdx, 1);
      return next;
    }

    // Fallback: the template hides this panel by default (no region) or the
    // region is occupied. The document-flow Risk & Positions template gets a
    // full-width row; secondary templates retain a compact right-rail cell.
    // Empty rows are pruned first so show/hide cycles are stable. The
    // fallback row is appended at the end of the grid (the v1 fixed KPI
    // band that previously anchored these rows no longer exists in the
    // dense catalogue).
    if (!next.areas[0]) return null; // defensive: grids always have ≥1 row
    next.areas = next.areas.filter((row) => row.some((cell) => cell !== GRID_EMPTY_CELL));
    const fallbackRow: string[] = next.templateId === WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS
      ? next.areas[0].map(() => panelId)
      : next.areas[0].map((_, index, row) =>
          index === row.length - 1 ? panelId : GRID_EMPTY_CELL,
        );
    next.areas.push(fallbackRow);
    next.hiddenPanels.splice(hiddenIdx, 1);
    return next;
  }

  // HIDE: replace the panel's cells with empty cells, then prune any row
  // that became fully empty (e.g. a rail row holding only this panel).
  let found = false;
  next.areas.forEach((row) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === panelId) {
        row[c] = GRID_EMPTY_CELL;
        found = true;
      }
    }
  });
  if (!found) return null; // panel already absent from the grid
  next.areas = next.areas.filter((row) => row.some((cell) => cell !== GRID_EMPTY_CELL));
  next.hiddenPanels.push(panelId);
  next.hiddenPanels.sort(comparePanelByCatalogueOrder);
  return next;
}

// ── State ──────────────────────────────────────────────────────────────

interface CustomizeState {
  /** Whether a customize session is open. */
  isCustomizing: boolean;
  /** Snapshot of the view config at session start (Save/Cancel anchor). */
  base: WorkstationViewConfig | null;
  /** Working layout configuration edited during the session. */
  draft: WorkstationViewConfig | null;
  /** Prior draft states for Undo (bounded). */
  undoStack: WorkstationViewConfig[];
}

type CustomizeAction =
  | { type: 'ENTER'; config: WorkstationViewConfig }
  | { type: 'TOGGLE'; panelId: WorkstationPanelId }
  | { type: 'UNDO' }
  | { type: 'RESET' }
  | { type: 'CANCEL' }
  | { type: 'SAVE' };

function createInitialState(): CustomizeState {
  return { isCustomizing: false, base: null, draft: null, undoStack: [] };
}

/** Push a draft onto the undo stack, bounded to MAX_UNDO_DEPTH entries. */
function pushUndo(stack: WorkstationViewConfig[], config: WorkstationViewConfig): WorkstationViewConfig[] {
  return [...stack, cloneWorkstationViewConfig(config)].slice(-MAX_UNDO_DEPTH);
}

function customizeReducer(state: CustomizeState, action: CustomizeAction): CustomizeState {
  switch (action.type) {
    case 'ENTER':
      // Re-entering mid-session replaces the session (the shell prevents
      // this, but the hook stays safe). hiddenPanels is normalized to
      // catalogue order so dirty checks are order-stable.
      return {
        isCustomizing: true,
        base: withNormalizedHiddenOrder(action.config),
        draft: withNormalizedHiddenOrder(action.config),
        undoStack: [],
      };

    case 'TOGGLE': {
      if (!state.isCustomizing || !state.draft) return state;
      const next = togglePanelVisibilityInConfig(state.draft, action.panelId);
      if (!next) return state; // fixed panel, unknown id, or no applicable change
      return {
        ...state,
        draft: next,
        undoStack: pushUndo(state.undoStack, state.draft),
      };
    }

    case 'UNDO': {
      if (!state.isCustomizing || state.undoStack.length === 0) return state;
      const prior = state.undoStack[state.undoStack.length - 1];
      return {
        ...state,
        draft: cloneWorkstationViewConfig(prior),
        undoStack: state.undoStack.slice(0, -1),
      };
    }

    case 'RESET': {
      if (!state.isCustomizing || !state.draft) return state;
      const next = withNormalizedHiddenOrder(resetViewToTemplate(state.draft));
      // No-op when the draft already matches the template base (no undo push).
      if (workstationConfigsEqual(state.draft, next)) return state;
      return {
        ...state,
        draft: next,
        undoStack: pushUndo(state.undoStack, state.draft),
      };
    }

    case 'CANCEL':
      return createInitialState();

    case 'SAVE':
      return createInitialState();

    default:
      return state;
  }
}

// ── Result type ────────────────────────────────────────────────────────

export interface UseCustomizeModeResult {
  /** Whether a customize session is open. */
  isCustomizing: boolean;
  /** The working layout config being edited, or null outside a session. */
  draft: WorkstationViewConfig | null;
  /** True when the draft differs from the snapshot taken at session start. */
  isDirty: boolean;
  /** True when Undo has at least one prior draft state to restore. */
  canUndo: boolean;
  /** Optional panels currently hidden in the draft (catalogue order). */
  hiddenOptionalPanels: WorkstationPanelId[];
  /**
   * Open a customize session for a view config. Snapshots the config as the
   * base and starts the draft as a deep copy.
   */
  enterCustomize: (config: WorkstationViewConfig) => void;
  /**
   * Hide/show an optional panel in the draft. No-op for fixed panels
   * (`risk`, `trades`), unknown ids, and outside a session.
   */
  togglePanelVisibility: (panelId: WorkstationPanelId) => void;
  /** Restore the previous draft state. No-op when the history is empty. */
  undo: () => void;
  /** Reset the draft to the view's template base grid (undoable). */
  resetDraft: () => void;
  /** Discard the draft and exit the session. The persisted view is untouched. */
  cancel: () => void;
  /**
   * Return the draft config for the caller to persist, then exit the
   * session. Returns null when no session is open. The returned config is a
   * deep clone — mutating it cannot affect the hook.
   */
  save: () => WorkstationViewConfig | null;
}

// ── Hook ───────────────────────────────────────────────────────────────

/**
 * Manage a workstation customize session. View-agnostic: takes a config on
 * entry and hands the caller a draft on save; the caller decides persistence
 * (updateViewConfig through useWorkstationViews). See the module doc for the
 * full state-machine semantics.
 */
export function useCustomizeMode(): UseCustomizeModeResult {
  const [state, dispatch] = useReducer(customizeReducer, undefined, createInitialState);

  // Latest committed state for callbacks that need to read draft state
  // (save returns the current draft). Updated in an effect, so event-handler
  // callbacks always read the last committed render.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const enterCustomize = useCallback((config: WorkstationViewConfig) => {
    dispatch({ type: 'ENTER', config });
  }, []);

  const togglePanelVisibility = useCallback((panelId: WorkstationPanelId) => {
    dispatch({ type: 'TOGGLE', panelId });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const resetDraft = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const cancel = useCallback(() => {
    dispatch({ type: 'CANCEL' });
  }, []);

  const save = useCallback((): WorkstationViewConfig | null => {
    const current = stateRef.current;
    if (!current.isCustomizing || !current.draft) return null;
    const result = cloneWorkstationViewConfig(current.draft);
    dispatch({ type: 'SAVE' });
    return result;
  }, []);

  // Dirty = draft differs from the session-start snapshot.
  const isDirty = useMemo(() => {
    if (!state.isCustomizing || !state.base || !state.draft) return false;
    return !workstationConfigsEqual(state.base, state.draft);
  }, [state.isCustomizing, state.base, state.draft]);

  const canUndo = state.isCustomizing && state.undoStack.length > 0;

  // Hidden optional panels in the draft (fixed panels can never be hidden,
  // but filter defensively so the UI can never propose a fixed toggle).
  const hiddenOptionalPanels = useMemo(() => {
    if (!state.isCustomizing || !state.draft) return [];
    const optional = new Set<WorkstationPanelId>(OPTIONAL_PANEL_IDS);
    return state.draft.hiddenPanels.filter((id) => optional.has(id));
  }, [state.isCustomizing, state.draft]);

  return {
    isCustomizing: state.isCustomizing,
    draft: state.draft,
    isDirty,
    canUndo,
    hiddenOptionalPanels,
    enterCustomize,
    togglePanelVisibility,
    undo,
    resetDraft,
    cancel,
    save,
  };
}
