'use client';

// CustomizeBar — explicit customize-mode chrome for the workstation
// (M016/S06-T04).
//
// R035: Customize is an explicit editing state with Save, Cancel, Undo, and
// Reset. While a customize session is open this bar renders above the grid
// (sibling of the data-quality alert strip, never inside the editable
// layout) with:
//
// - the name of the view being edited and an unsaved-changes indicator;
// - "Show {panel}" chips for the optional panels currently hidden in the
//   draft (hidden panels have no cells in the grid, so the bar is where the
//   user brings them back);
// - a fixed-panels note (risk / trades workspace are always visible and
//   can never be hidden or rearranged);
// - Undo (disabled without history), Reset to template, Cancel (discard),
//   and Save (disabled until the draft differs from the session snapshot).
//
// Visible optional panels carry their own "Hide" overlay in the grid (see
// WorkstationShell), so the two surfaces together cover hide/show without
// ever touching the fixed safety/data-quality areas.

import { Check, Eye, Move, RotateCcw, Undo2, X } from 'lucide-react';
import { WORKSTATION_PANEL_CATALOGUE, type WorkstationPanelId } from '@/lib/workstation-view-types';

// ── Types ──────────────────────────────────────────────────────────────

export interface CustomizeBarProps {
  /** Name of the view being edited (shown in the bar title). */
  viewName: string;
  /** Optional panels currently hidden in the draft (catalogue order). */
  hiddenOptionalPanels: WorkstationPanelId[];
  /** True when Undo has history to restore. */
  canUndo: boolean;
  /** True when the draft differs from the session-start snapshot. */
  isDirty: boolean;
  /** True while the arrangement (drag/resize) sub-mode is active. */
  arrangeMode: boolean;
  /** Toggle the arrangement sub-mode (RGL grid with drag/resize handles vs the hide/show CSS grid). */
  onToggleArrangeMode: () => void;
  /** Re-show a hidden optional panel in the draft. */
  onTogglePanel: (panelId: WorkstationPanelId) => void;
  /** Restore the previous draft state. */
  onUndo: () => void;
  /** Reset the draft to the view's template base grid. */
  onReset: () => void;
  /** Discard the draft and exit customize mode. */
  onCancel: () => void;
  /** Persist the draft and exit customize mode. */
  onSave: () => void;
}

// ── Component ──────────────────────────────────────────────────────────

/**
 * The customize bar. Renders only while a customize session is open (the
 * shell conditionally mounts it), so there is no normal-mode chrome here —
 * normal mode has no drag/resize or editing handles (R035).
 */
export function CustomizeBar({
  viewName,
  hiddenOptionalPanels,
  canUndo,
  isDirty,
  arrangeMode,
  onToggleArrangeMode,
  onTogglePanel,
  onUndo,
  onReset,
  onCancel,
  onSave,
}: CustomizeBarProps) {
  return (
    <div
      className="ws-customize-bar"
      data-testid="ws-customize-bar"
      role="region"
      aria-label="Customize view"
    >
      <span className="ws-customize-title" data-testid="ws-customize-title">
        Customizing: {viewName}
      </span>

      {isDirty && (
        <span className="ws-customize-dirty" data-testid="ws-customize-dirty">
          Unsaved changes
        </span>
      )}

      <div className="ws-customize-panels" data-testid="ws-customize-panels">
        {hiddenOptionalPanels.length === 0 ? (
          <span className="ws-customize-all-visible" data-testid="ws-customize-all-visible">
            All optional panels visible
          </span>
        ) : (
          // Defensive: only catalogue-optional panels are toggleable — fixed
          // safety/data-quality panels (risk, trades) never get a
          // Show chip even if passed through the untrusted prop surface.
          hiddenOptionalPanels
            .filter((id) => WORKSTATION_PANEL_CATALOGUE[id]?.canHide)
            .map((id) => {
              const def = WORKSTATION_PANEL_CATALOGUE[id];
              return (
                <button
                  key={id}
                  type="button"
                  className="ws-customize-chip"
                  data-testid={`ws-customize-show-${id}`}
                  onClick={() => onTogglePanel(id)}
                  title={`Show ${def.title}`}
                >
                  <Eye className="ws-customize-chip-icon" aria-hidden="true" />
                  Show {def.title}
                </button>
              );
            })
        )}
      </div>

      <div className="ws-customize-spacer" />

      <span className="ws-customize-fixed-note" data-testid="ws-customize-fixed-note">
        Risk · Trades are always visible
      </span>

      {/* Arrange toggle — enters/exits the arrangement (drag/resize) sub-mode
          (M017/S04). While active the shell swaps the hide/show CSS grid for
          the react-grid-layout arrangement grid with labelled drag handles
          and southeast resize handles; Save/Cancel/Undo/Reset continue to
          work against the same draft, persisting only on Save. */}
      <button
        type="button"
        className={`ws-customize-btn${arrangeMode ? ' ws-customize-btn-active' : ''}`}
        data-testid="ws-customize-arrange-toggle"
        onClick={onToggleArrangeMode}
        aria-pressed={arrangeMode}
        title={
          arrangeMode
            ? 'Exit arrangement mode (back to hide/show editing)'
            : 'Enter arrangement mode (drag and resize panels)'
        }
      >
        <Move className="ws-customize-btn-icon" aria-hidden="true" />
        Arrange
      </button>

      {arrangeMode && (
        <span className="ws-arrange-hint" data-testid="ws-arrange-hint">
          Drag handles move · SE handle resizes · Arrow: move · Shift+Arrow: resize · Esc: exit
        </span>
      )}

      <button
        type="button"
        className="ws-customize-btn"
        data-testid="ws-customize-undo"
        onClick={onUndo}
        disabled={!canUndo}
        title={canUndo ? 'Undo last change' : 'Nothing to undo'}
      >
        <Undo2 className="ws-customize-btn-icon" aria-hidden="true" />
        Undo
      </button>

      <button
        type="button"
        className="ws-customize-btn"
        data-testid="ws-customize-reset"
        onClick={onReset}
        title="Reset this view to its template"
      >
        <RotateCcw className="ws-customize-btn-icon" aria-hidden="true" />
        Reset
      </button>

      <button
        type="button"
        className="ws-customize-btn"
        data-testid="ws-customize-cancel"
        onClick={onCancel}
        title="Discard changes and exit customize mode"
      >
        <X className="ws-customize-btn-icon" aria-hidden="true" />
        Cancel
      </button>

      <button
        type="button"
        className="ws-customize-btn ws-customize-btn-primary"
        data-testid="ws-customize-save"
        onClick={onSave}
        disabled={!isDirty}
        title={isDirty ? 'Save layout changes' : 'No changes to save'}
      >
        <Check className="ws-customize-btn-icon" aria-hidden="true" />
        Save
      </button>
    </div>
  );
}
