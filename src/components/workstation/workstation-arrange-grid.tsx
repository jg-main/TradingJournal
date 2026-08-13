'use client';

/**
 * WorkstationArrangeGrid — react-grid-layout arrangement grid for saved-view
 * arrangement mode (M017/S04-T02).
 *
 * While a customize session is open on a user view, the shell mounts this
 * grid instead of the CSS grid (grid-template-areas). It renders the draft's
 * visible panels inside a react-grid-layout v2 grid — the arrangement editing
 * surface (DASHBOARD_DENSE_LAYOUT_REQUIREMENTS §Saved-view arrangement mode):
 *
 * - **Protected anchors stay locked.** The fixed panels (risk, trades) are
 *   emitted as `static` items (never dragged, never resized) with their
 *   declared full-width bounds; raw pointer input cannot move them — the
 *   customize hook re-locks them on every commit (`normalizeArrangementLayout`
 *   in src/hooks/use-customize-mode.ts).
 * - **Eligible panels get explicit editing chrome.** Each canDrag panel shows
 *   a labelled drag handle (`.ws-arrange-handle`, the RGL drag handle
 *   selector) and — through RGL — the visible southeast resize handle, both
 *   constrained to the approved catalogue bounds (minW/maxW/minH/maxH).
 * - **Every committed layout feeds the session draft.** RGL v2 fires
 *   onLayoutChange only when it is not actively dragging, so a single
 *   drag/resize gesture produces exactly one committed layout; onDragStop /
 *   onResizeStop are routed too so a gesture that ends where it started still
 *   reaches the hook. The hook's `applyLayout` is the single commit path: it
 *   clamps raw placements back to the catalogue-valid space, drops unknown
 *   ids, and rejects unrepresentable placements (no-op guarded, undoable).
 *   Normal mode never mounts this component.
 *
 * The grid is view-agnostic: the shell supplies the session draft as
 * `config` and renders the actual panel elements through `renderPanel`.
 */

import { useCallback, type ReactNode } from 'react';
import {
  GridLayout,
  useContainerWidth,
  type Layout,
} from 'react-grid-layout';
import { GripVertical } from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import {
  WORKSTATION_PANEL_CATALOGUE,
  WORKSTATION_TEMPLATES,
  computeVisiblePanels,
  deriveLayoutFromAreas,
  type WorkstationLayoutItem,
  type WorkstationPanelId,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';

// ── Arrangement-grid metrics ───────────────────────────────────────────

/**
 * Height of one arrangement row in pixels. The arrangement grid is a coarse
 * editing surface, not the final rendered state (normal mode renders the CSS
 * grid with content-sized rows): one arrangement row ≈ the risk band's
 * content height (header + one cell row), so the h=1 summary panels and the
 * risk band stay readable while arranging, and the 3-row trades workspace
 * shows a usable table slice.
 */
export const ARRANGE_ROW_HEIGHT = 72;

/** Horizontal and vertical gap between arrangement items. */
export const ARRANGE_GRID_MARGIN = [8, 8] as const;

/** Drag-handle class — the react-grid-layout drag `handle` selector. */
export const ARRANGE_DRAG_HANDLE_CLASS = 'ws-arrange-handle';

// ── Pure helper ────────────────────────────────────────────────────────

/**
 * The react-grid-layout layout for a draft config: the config's canonical
 * layout when present, else the areas-derived projection (preserved legacy
 * views carry no layout — the grid still renders their arrangement so the
 * user can edit it), with per-item interaction flags from the approved
 * catalogue:
 *
 * - fixed panels (`canDrag: false`) are `static` with `isDraggable: false`
 *   and `isResizable: false` — RGL keeps them in place and compacts other
 *   items around them;
 * - eligible panels are explicitly draggable and resizable within their
 *   declared catalogue bounds.
 *
 * The layout prop is the RGL boundary: RGL reads `i` as a plain string, so
 * callers cast at the edge when committing (see `handleCommit`).
 */
export function arrangeGridLayoutForConfig(config: WorkstationViewConfig): Layout {
  const base = config.layout ?? deriveLayoutFromAreas(config.areas);
  return base.map((item) => {
    const def = WORKSTATION_PANEL_CATALOGUE[item.i];
    return {
      ...item,
      isDraggable: def.canDrag,
      isResizable: def.canResize,
      static: !def.canDrag && !def.canResize,
    };
  });
}

// ── Component ──────────────────────────────────────────────────────────

export interface WorkstationArrangeGridProps {
  /** The session draft being arranged (areas + canonical layout). */
  config: WorkstationViewConfig;
  /**
   * Render one catalogue panel. The shell supplies the real panel components
   * (same map as the normal-mode grid), so the arrange grid stays
   * view-agnostic and panels keep their own data fetching.
   */
  renderPanel: (id: WorkstationPanelId) => ReactNode;
  /**
   * Commit a react-grid-layout arrangement to the session draft. The shell
   * wires this to useCustomizeMode().applyLayout, which clamps and validates
   * before committing (no-op guarded, undoable).
   */
  onLayoutChange: (layout: readonly WorkstationLayoutItem[]) => void;
}

export function WorkstationArrangeGrid({
  config,
  renderPanel,
  onLayoutChange,
}: WorkstationArrangeGridProps) {
  const { width, containerRef, mounted } = useContainerWidth();

  const layout = arrangeGridLayoutForConfig(config);
  const cols = WORKSTATION_TEMPLATES[config.templateId]?.columns.length ?? 3;
  const visiblePanels = computeVisiblePanels(config);

  // RGL boundary cast: RGL items carry `i` as a plain string; the hook drops
  // unknown ids and clamps placements back to the catalogue-valid space, so
  // the grid forwards raw commits verbatim.
  const handleCommit = useCallback(
    (next: Layout) => {
      onLayoutChange(next as readonly WorkstationLayoutItem[]);
    },
    [onLayoutChange],
  );

  return (
    <div ref={containerRef} className="ws-arrange" data-testid="ws-arrange-grid">
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols, rowHeight: ARRANGE_ROW_HEIGHT, margin: ARRANGE_GRID_MARGIN }}
          // The labelled handle is the only drag surface: controls inside a
          // panel can never accidentally start a drag (requirement: panel
          // controls remain usable while arranging).
          dragConfig={{ enabled: true, handle: `.${ARRANGE_DRAG_HANDLE_CLASS}` }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          onLayoutChange={handleCommit}
          onDragStop={handleCommit}
          onResizeStop={handleCommit}
          autoSize
          className="ws-arrange-grid"
        >
          {visiblePanels.map((id) => {
            const def = WORKSTATION_PANEL_CATALOGUE[id];
            const isFixed = !def.canDrag;
            return (
              <div
                key={id}
                className="ws-arrange-cell"
                data-testid={`ws-arrange-cell-${id}`}
                data-ws-arrange-fixed={isFixed}
              >
                {isFixed ? (
                  // Fixed anchors render unchanged: no drag handle, no
                  // resize handle. The solid border (CSS) marks them
                  // protected.
                  null
                ) : (
                  <div
                    className={ARRANGE_DRAG_HANDLE_CLASS}
                    data-testid={`ws-arrange-handle-${id}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Drag ${def.title} to move`}
                    title="Drag to move"
                  >
                    <GripVertical className="ws-arrange-grip" aria-hidden="true" />
                    <span className="ws-arrange-handle-title">{def.title}</span>
                  </div>
                )}
                {renderPanel(id)}
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}
