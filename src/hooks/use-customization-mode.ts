'use client';

import { useCallback, useReducer } from 'react';
import type { LayoutItem } from 'react-grid-layout';

// ── Types ──────────────────────────────────────────────────────────────

export interface UseCustomizationModeOptions {
  /**
   * Default layout used when the user clicks "Reset to defaults".
   * Each item must have at minimum: i, x, y, w, h.
   */
  defaultLayout: LayoutItem[];
  /**
   * Complete list of all registered widget IDs.
   * Used to derive the default hidden set (empty = all visible).
   */
  allWidgetIds: string[];
}

export interface UseCustomizationModeResult {
  /** Whether the user is currently in customization mode. */
  isCustomizing: boolean;
  /**
   * Enter customization mode. Takes a snapshot of the current layout so that
   * cancel reverts to this exact state.
   */
  enterCustomization: (currentLayout: LayoutItem[]) => void;
  /**
   * Save customization with the current (post-drag) layout, persist it, and
   * exit customization mode.
   * @param currentLayout - The current layout from the caller's layout state.
   * @returns An object with the saved layout and hidden widget IDs, or null
   *   if not in customization mode.
   */
  saveCustomization: (currentLayout: LayoutItem[]) => { layout: LayoutItem[]; hiddenWidgetIds: string[] } | null;
  /**
   * Cancel customization: return the snapshot so the caller can restore the
   * pre-edit layout. Exits customization mode.
   * @returns The snapshot layout, or null if not in customization mode.
   */
  cancelCustomization: () => LayoutItem[] | null;
  /**
   * Reset to defaults: return the default layout.
   * Exits customization mode.
   * @returns The default layout with all widgets visible.
   */
  resetToDefaults: () => LayoutItem[];
  /**
   * Toggle a widget's visibility during an active customization session.
   * Hidden widgets are excluded from the rendered grid.
   * Has no effect when not in customization mode.
   */
  toggleWidgetVisibility: (widgetId: string) => void;
  /**
   * Widget IDs currently hidden during this customization session.
   * Empty array means all widgets are visible.
   */
  hiddenWidgetIds: string[];
  /**
   * The snapshot layout captured when `enterCustomization` was called.
   * Null when not in customization mode.
   */
  snapshot: LayoutItem[] | null;
}

// ── State Shape ────────────────────────────────────────────────────────

interface CustomizationState {
  isCustomizing: boolean;
  snapshot: LayoutItem[] | null;
  hiddenWidgetIds: string[];
}

type CustomizationAction =
  | { type: 'ENTER'; currentLayout: LayoutItem[] }
  | { type: 'SAVE' }
  | { type: 'CANCEL' }
  | { type: 'RESET' }
  | { type: 'TOGGLE_VISIBILITY'; widgetId: string };

function customizationReducer(
  state: CustomizationState,
  action: CustomizationAction,
): CustomizationState {
  switch (action.type) {
    case 'ENTER':
      return {
        isCustomizing: true,
        snapshot: action.currentLayout.map((item) => ({ ...item })),
        hiddenWidgetIds: [],
      };
    case 'SAVE':
    case 'CANCEL':
    case 'RESET':
      return { isCustomizing: false, snapshot: null, hiddenWidgetIds: [] };
    case 'TOGGLE_VISIBILITY': {
      if (!state.isCustomizing) return state;
      const alreadyHidden = state.hiddenWidgetIds.includes(action.widgetId);
      return {
        ...state,
        hiddenWidgetIds: alreadyHidden
          ? state.hiddenWidgetIds.filter((id) => id !== action.widgetId)
          : [...state.hiddenWidgetIds, action.widgetId],
      };
    }
    default:
      return state;
  }
}

// ── Initial State ──────────────────────────────────────────────────────

function createInitialState(): CustomizationState {
  return { isCustomizing: false, snapshot: null, hiddenWidgetIds: [] };
}

// ── Hook ───────────────────────────────────────────────────────────────

/**
 * Customization mode state machine for the dashboard.
 *
 * Manages the isCustomizing flag, layout snapshot (for cancel), and
 * hidden-widget tracking during an active customization session.
 *
 * The hook does NOT directly persist to localStorage or call setLayout —
 * it returns the state and actions so the caller (page.tsx or a view
 * management layer) can decide how to persist.  This keeps the hook
 * reusable across S02 (customization) and S03 (view management).
 *
 * @example
 * ```tsx
 * const { isCustomizing, enterCustomization, saveCustomization,
 *         cancelCustomization, resetToDefaults, toggleWidgetVisibility,
 *         hiddenWidgetIds, snapshot } = useCustomizationMode({
 *   defaultLayout: DEFAULT_UNIFIED_LAYOUT,
 *   allWidgetIds: Object.keys(WIDGET_REGISTRY) as WidgetId[],
 * });
 *
 * // Enter editing
 * enterCustomization(currentLayout);
 *
 * // Save — pass the current (post-drag) layout
 * const saved = saveCustomization(currentLayout);
 * if (saved) {
 *   persistLayout(saved.layout, saved.hiddenWidgetIds);
 * }
 *
 * // Cancel — restore snapshot
 * const restored = cancelCustomization();
 * if (restored) setLayout(restored);
 *
 * // Reset to defaults
 * const defaults = resetToDefaults();
 * setLayout(defaults);
 * ```
 */
export function useCustomizationMode(
  options: UseCustomizationModeOptions,
): UseCustomizationModeResult {
  const { defaultLayout } = options;

  const [state, dispatch] = useReducer(
    customizationReducer,
    undefined,
    createInitialState,
  );

  const enterCustomization = useCallback((currentLayout: LayoutItem[]) => {
    dispatch({ type: 'ENTER', currentLayout });
  }, []);

  const saveCustomization = useCallback(
    (currentLayout: LayoutItem[]): {
      layout: LayoutItem[];
      hiddenWidgetIds: string[];
    } | null => {
      if (!state.isCustomizing) return null;
      const result = {
        layout: currentLayout.map((item) => ({ ...item })),
        hiddenWidgetIds: [...state.hiddenWidgetIds],
      };
      dispatch({ type: 'SAVE' });
      return result;
    },
    [state.isCustomizing, state.hiddenWidgetIds],
  );

  const cancelCustomization = useCallback((): LayoutItem[] | null => {
    const snap = state.snapshot;
    dispatch({ type: 'CANCEL' });
    return snap ? snap.map((item) => ({ ...item })) : null;
  }, [state.snapshot]);

  const resetToDefaults = useCallback((): LayoutItem[] => {
    dispatch({ type: 'RESET' });
    return defaultLayout.map((item) => ({ ...item }));
  }, [defaultLayout]);

  const toggleWidgetVisibility = useCallback((widgetId: string) => {
    dispatch({ type: 'TOGGLE_VISIBILITY', widgetId });
  }, []);

  return {
    isCustomizing: state.isCustomizing,
    enterCustomization,
    saveCustomization,
    cancelCustomization,
    resetToDefaults,
    toggleWidgetVisibility,
    hiddenWidgetIds: state.hiddenWidgetIds,
    snapshot: state.snapshot,
  };
}
