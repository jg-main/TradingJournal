'use client';

// WorkstationShell — risk-first CSS Grid layout proving the S04 concept at
// 2560×1440 and effective 1536×960, extended by S06 to render the active
// saved view's panel configuration.
//
// S06 (R035): the shell consumes the active workstation view from
// useWorkstationViews and computes the dynamic grid-template-areas /
// -columns / -rows from the view's layout config (see
// src/lib/workstation-view-types.ts). Only the panels visible in the active
// view are rendered; hidden optional panels simply have no cells in the
// grid. When no view is active yet (defensive fallback), the immutable
// Risk & Positions template grid is rendered.
//
// The data-quality alert strip (T01) renders above the grid, outside it, so
// it stays visible in every view and can never be hidden or rearranged by a
// saved layout. The Risk & Positions template uses document flow so its
// operational panels do not create competing nested scroll regions; the
// other curated templates retain their contained workstation behavior (see
// .ws and .ws-grid in workstation.css).

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EyeOff } from 'lucide-react';
import { useWorkstation } from './workstation-context';
import { useWorkstationViewsContext } from './workstation-views-context';
import { useWorkstationCustomizeContext } from './workstation-customize-context';
import { CustomizeBar } from './customize-bar';
import { DataQualityAlertStrip } from './data-quality-alert-strip';
import { WorkstationArrangeGrid } from './workstation-arrange-grid';
import { WorkstationKeyboardArrange } from './workstation-keyboard-arrange';
import { TradesWorkspacePanel } from './trades-workspace-panel';
import { RiskPanel } from './risk-panel';
import { WatchlistPanel } from './watchlist-panel';
import { AccountStatePanel } from './account-state-panel';
import { PerformancePanel } from './performance-panel';
import { ProcessReviewPanel } from './process-review-panel';
import {
  WORKSTATION_PANEL_CATALOGUE,
  WORKSTATION_PANEL_IDS,
  WORKSTATION_TEMPLATE_IDS,
  computeGridTemplateAreas,
  computeGridTemplateColumns,
  computeDocumentFlowGridTemplateRows,
  computeGridTemplateRows,
  computeVisiblePanels,
  createViewFromTemplate,
  type WorkstationPanelId,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';

// ── View grid ──────────────────────────────────────────────────────────

/**
 * Defensive fallback grid: the immutable Risk & Positions template. Used
 * only when the hook has no active view yet (it always does after the first
 * render — the store initialises synchronously — so this is a safety net).
 */
const DEFAULT_VIEW_CONFIG: WorkstationViewConfig = createViewFromTemplate(
  WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
);

/**
 * Return the panel component for one catalogue panel id. Renderers receive
 * the values they need as arguments so the map stays pure; the trades
 * workspace consumes the same reconciled valuation snapshot the alert
 * strip and risk band consume (Open tab) and fetches its own closed-trades
 * history scoped to the active account (Closed tab).
 */
function renderPanelById(
  id: WorkstationPanelId,
  positions: Parameters<typeof TradesWorkspacePanel>[0]['positions'],
): ReactNode {
  switch (id) {
    case WORKSTATION_PANEL_IDS.RISK:
      return <RiskPanel />;
    case WORKSTATION_PANEL_IDS.TRADES:
      return <TradesWorkspacePanel positions={positions} />;
    case WORKSTATION_PANEL_IDS.ACCOUNT:
      return <AccountStatePanel />;
    case WORKSTATION_PANEL_IDS.PERFORMANCE:
      return <PerformancePanel />;
    case WORKSTATION_PANEL_IDS.PROCESS_REVIEW:
      return <ProcessReviewPanel />;
    case WORKSTATION_PANEL_IDS.WATCHLIST:
      return <WatchlistPanel />;
  }
}

export function WorkstationShell() {
  const { fixtures } = useWorkstation();
  const { dashboardV2 } = fixtures;
  const { valuation } = dashboardV2;

  // Saved workstation views (S06): the provider owns the view store; the
  // shell renders the active view's layout config as the dynamic grid.
  const viewsState = useWorkstationViewsContext();

  // Customize session (S06-T04): while customizing, the shell renders the
  // session draft as a live preview (hidden panels disappear immediately and
  // are re-shown from the bar), shows per-panel Hide overlays on optional
  // panels, and mounts the customize bar between the alert strip and the
  // grid — outside the editable layout.
  const customize = useWorkstationCustomizeContext();
  const {
    isCustomizing,
    draft,
    isDirty,
    canUndo,
    hiddenOptionalPanels,
    togglePanelVisibility,
    applyLayout,
    undo,
    resetDraft,
    cancel,
    save,
  } = customize;

  // Arrange sub-mode (M017/S04): while customizing, the user can switch
  // between the hide/show CSS grid and the react-grid-layout arrangement
  // grid (drag handles, southeast resize handles, keyboard moves). The flag
  // is shell-local UI state — the session state machine (useCustomizeMode)
  // stays untouched.
  const [arrangeMode, setArrangeMode] = useState(false);

  // A new customize session always opens in hide/show mode: arrangement
  // mode is per-session editing chrome, so a fresh session must never
  // inherit a stale arrange flag from a previously cancelled session (e.g.
  // a mid-edit view switch). Reset on the session boundary with the
  // React-recommended "adjust state during render" pattern — conditional
  // setState during render, not an effect (react-hooks/set-state-in-effect).
  const [wasCustomizing, setWasCustomizing] = useState(isCustomizing);
  if (isCustomizing !== wasCustomizing) {
    setWasCustomizing(isCustomizing);
    if (isCustomizing) {
      setArrangeMode(false);
    }
  }

  const handleToggleArrangeMode = useCallback(() => {
    setArrangeMode((v) => !v);
  }, []);

  // The active view's layout config is the rendered truth: hidden panels
  // have no cells in the grid. Fall back to the Risk & Positions template
  // while no active view exists (defensive). During customization the draft
  // replaces the persisted config so edits preview live.
  const config = isCustomizing && draft
    ? draft
    : (viewsState.activeView?.config ?? DEFAULT_VIEW_CONFIG);

  // The curated Risk & Positions workflow is intentionally a vertically
  // scrolling document: a trader scans the paired overview row, then Open
  // Positions and Process Review, without having to discover separate panel
  // scrollbars. User views derived from that template retain this workflow;
  // the Performance and Process Review templates keep their contained grid.
  const scrollMode = config.templateId === WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS
    ? 'document'
    : 'contained';

  const gridStyle = {
    gridTemplateAreas: computeGridTemplateAreas(config),
    gridTemplateColumns: computeGridTemplateColumns(config),
    gridTemplateRows: scrollMode === 'document'
      ? computeDocumentFlowGridTemplateRows(config)
      : computeGridTemplateRows(config),
  };

  const visiblePanels = computeVisiblePanels(config);

  // Cancel the session when the active view changes mid-edit — the draft
  // belongs to the view that was active when Customize was entered, and a
  // switch discards it rather than silently saving to the wrong view.
  const sessionViewIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isCustomizing) {
      sessionViewIdRef.current = null;
      return;
    }
    if (sessionViewIdRef.current === null) {
      sessionViewIdRef.current = viewsState.activeViewId;
      return;
    }
    if (sessionViewIdRef.current !== viewsState.activeViewId) {
      cancel();
    }
  }, [isCustomizing, cancel, viewsState.activeViewId]);

  // Save: persist the draft to the active (user) view. System presets are
  // read-only in the view store and never reach this path — the toolbar
  // disables Customize for them.
  const handleSave = useCallback(() => {
    const active = viewsState.activeView;
    if (!active || active.isSystem) return;
    const configToSave = save();
    if (configToSave) {
      viewsState.updateViewConfig(active.id, configToSave);
    }
  }, [save, viewsState]);

  return (
    <>
      {/* Data-quality alert strip — fixed above the grid, outside any
          editable layout (§5.1 area 2). It is rendered before the grid in
          every view and cannot be hidden by a saved layout or by customize
          mode. Pure consumer of API provenance state; renders nothing when
          every section is healthy. */}
      <DataQualityAlertStrip dashboardV2={dashboardV2} />

      {/* Customize bar — explicit editing chrome (R035). Mounted only while
          a customize session is open, between the alert strip and the grid:
          sibling of the editable layout, never inside it. The alert strip
          stays outside the editable layout in all modes. */}
      {isCustomizing && (
        <CustomizeBar
          viewName={viewsState.activeView?.name ?? 'View'}
          hiddenOptionalPanels={hiddenOptionalPanels}
          canUndo={canUndo}
          isDirty={isDirty}
          arrangeMode={arrangeMode}
          onToggleArrangeMode={handleToggleArrangeMode}
          onTogglePanel={togglePanelVisibility}
          onUndo={undo}
          onReset={resetDraft}
          onCancel={cancel}
          onSave={handleSave}
        />
      )}

      {/* Arrangement-mode keyboard handler (M017/S04). Mounted only while
          the arrange sub-mode is open: arrow keys move the focused panel,
          Shift+Arrow grows/shrinks it, Escape exits back to hide/show. */}
      {isCustomizing && arrangeMode && draft && (
        <WorkstationKeyboardArrange
          config={draft}
          onApplyLayout={applyLayout}
          onExitArrangeMode={() => setArrangeMode(false)}
        />
      )}

      {isCustomizing && arrangeMode && draft ? (
        /* Arrangement surface: the react-grid-layout grid replaces the CSS
            grid while the arrange sub-mode is open. The draft is the
            rendered truth; every RGL commit (onLayoutChange/onDragStop/
            onResizeStop) and every keyboard move flows through
            applyLayout — the single commit path — so the draft stays
            catalogue-valid, undoable, and persistable only on Save. */
        <main
          className="ws-arrange-shell"
          data-testid="ws-arrange-mode"
          data-scroll-mode={scrollMode}
          id="ws-main-content"
          tabIndex={-1}
        >
          <WorkstationArrangeGrid
            config={draft}
            renderPanel={(id) => renderPanelById(id, valuation.positions)}
            onLayoutChange={applyLayout}
          />
        </main>
      ) : (
        <main
          className="ws-grid"
          style={gridStyle}
          data-testid="ws-grid"
          data-scroll-mode={scrollMode}
          id="ws-main-content"
          tabIndex={-1}
        >
          {visiblePanels.map((id) => {
            const panel = renderPanelById(id, valuation.positions);
            // Only optional panels are editable: fixed safety/data-quality
            // panels (risk, trades) render unchanged in every mode.
            if (!isCustomizing || !WORKSTATION_PANEL_CATALOGUE[id].canHide) {
              return <Fragment key={id}>{panel}</Fragment>;
            }
            return (
              <div
                key={id}
                className="ws-customize-cell"
                style={{ gridArea: id }}
                data-testid={`ws-customize-cell-${id}`}
              >
                <div className="ws-customize-cell-bar">
                  <span className="ws-customize-cell-title">
                    {WORKSTATION_PANEL_CATALOGUE[id].title}
                  </span>
                  <button
                    type="button"
                    className="ws-customize-hide-overlay"
                    data-testid={`ws-customize-hide-${id}`}
                    onClick={() => togglePanelVisibility(id)}
                    title={`Hide ${WORKSTATION_PANEL_CATALOGUE[id].title}`}
                  >
                    <EyeOff className="ws-customize-overlay-icon" aria-hidden="true" />
                    Hide
                  </button>
                </div>
                {panel}
              </div>
            );
          })}
        </main>
      )}
    </>
  );
}
