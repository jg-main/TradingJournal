/**
 * Tests for WorkstationArrangeGrid (M017/S04-T02).
 *
 * react-grid-layout cannot run its measurement/layout engine in jsdom, so
 * the module is mocked at the boundary: the mock captures every GridLayout
 * prop (layout items, grid/drag/resize config, callbacks) and renders the
 * children, letting tests assert the arrangement wiring — per-item catalogue
 * flags, drag-handle class, resize-handle axis, callback routing — and the
 * cell DOM (drag handle on eligible panels, none on protected anchors).
 *
 * The pure `arrangeGridLayoutForConfig` helper is tested directly: layout
 * sourcing (canonical config layout vs areas-derived fallback for preserved
 * legacy views), catalogue constraint attachment, and fixed-anchor flags.
 *
 * Run: npx vitest run src/components/workstation/workstation-arrange-grid.test.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';

// ── react-grid-layout mock ─────────────────────────────────────────────

interface CapturedGridLayoutProps {
  layout: Array<Record<string, unknown>>;
  gridConfig: { cols: number; rowHeight: number; margin: readonly [number, number] };
  dragConfig: { enabled: boolean; handle?: string; bounded?: boolean };
  resizeConfig: { enabled: boolean; handles: readonly string[] };
  onLayoutChange: (layout: unknown) => void;
  onDragStop: (layout: unknown) => void;
  onResizeStop: (layout: unknown) => void;
  children: React.ReactNode;
}

/** Every GridLayout render the component produced (cleared per test). */
const gridProps: CapturedGridLayoutProps[] = [];

vi.mock('react-grid-layout', () => ({
  useContainerWidth: () => ({
    width: 1200,
    containerRef: { current: null },
    mounted: true,
  }),
  GridLayout: (props: CapturedGridLayoutProps) => {
    gridProps.push(props);
    return React.createElement('div', { 'data-testid': 'mock-rgl' }, props.children);
  },
}));

import {
  WorkstationArrangeGrid,
  arrangeGridLayoutForConfig,
  ARRANGE_ROW_HEIGHT,
  ARRANGE_GRID_MARGIN,
  ARRANGE_DRAG_HANDLE_CLASS,
} from './workstation-arrange-grid';
import {
  WORKSTATION_PANEL_IDS,
  WORKSTATION_TEMPLATE_IDS,
  WORKSTATION_LAYOUT_VERSION,
  createViewFromTemplate,
  deriveLayoutFromAreas,
  type WorkstationPanelId,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';

// ── Fixtures ───────────────────────────────────────────────────────────

const RISK_POSITIONS = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);

/** A user-arranged view: Performance moved to a full-width row below the
 *  trades workspace. Valid, with a self-describing layout. */
const ARRANGED: WorkstationViewConfig = {
  templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
  areas: [
    ['risk', 'risk', 'risk'],
    ['account', 'review', '.'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
    ['perf', 'perf', 'perf'],
  ],
  hiddenPanels: [WORKSTATION_PANEL_IDS.WATCHLIST],
  version: WORKSTATION_LAYOUT_VERSION,
  layout: deriveLayoutFromAreas([
    ['risk', 'risk', 'risk'],
    ['account', 'review', '.'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
    ['perf', 'perf', 'perf'],
  ]),
};

/** A preserved user-modified v1 view migrated to v2: a valid config whose
 *  2-column areas cannot satisfy the dense catalogue bounds, so it carries
 *  no RGL layout. The arrange grid must still render its arrangement. */
const LEGACY_PRESERVED: WorkstationViewConfig = {
  templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
  areas: [
    ['risk', 'risk'],
    ['trades', 'account'],
    ['trades', 'perf'],
    ['trades', 'review'],
    ['trades', '.'],
  ],
  hiddenPanels: [WORKSTATION_PANEL_IDS.WATCHLIST],
  version: WORKSTATION_LAYOUT_VERSION,
};

/** Only the fixed anchors visible (every optional panel hidden). */
function fixedOnlyConfig(): WorkstationViewConfig {
  return {
    templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
    areas: [
      ['risk', 'risk', 'risk'],
      ['trades', 'trades', 'trades'],
    ],
    hiddenPanels: [
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ],
    version: WORKSTATION_LAYOUT_VERSION,
  };
}

/** The default view with Watchlist shown (appended below the grid). */
function watchlistVisibleConfig(): WorkstationViewConfig {
  return {
    templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
    areas: [
      ['risk', 'risk', 'risk'],
      ['account', 'perf', 'review'],
      ['trades', 'trades', 'trades'],
      ['watchlist', 'watchlist', 'watchlist'],
    ],
    hiddenPanels: [],
    version: WORKSTATION_LAYOUT_VERSION,
    layout: deriveLayoutFromAreas([
      ['risk', 'risk', 'risk'],
      ['account', 'perf', 'review'],
      ['trades', 'trades', 'trades'],
      ['watchlist', 'watchlist', 'watchlist'],
    ]),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function latestGridProps(): CapturedGridLayoutProps {
  const latest = gridProps[gridProps.length - 1];
  if (!latest) throw new Error('GridLayout was never rendered');
  return latest;
}

function renderGrid(config: WorkstationViewConfig) {
  const onLayoutChange = vi.fn();
  const renderPanel = vi.fn((id: WorkstationPanelId) =>
    React.createElement('div', { 'data-testid': `mock-panel-${id}` }, id),
  );
  const utils = render(
    <WorkstationArrangeGrid
      config={config}
      renderPanel={renderPanel}
      onLayoutChange={onLayoutChange}
    />,
  );
  return { ...utils, onLayoutChange, renderPanel };
}

/** Item lookup by panel id inside a captured layout. */
function layoutItem(panelId: WorkstationPanelId) {
  const item = latestGridProps().layout.find((l) => l.i === panelId);
  if (!item) throw new Error(`layout has no item for "${panelId}"`);
  return item;
}

// ── Setup / Teardown ───────────────────────────────────────────────────

beforeEach(() => {
  gridProps.length = 0;
});

afterEach(() => {
  cleanup();
});

// ── Pure helper: arrangeGridLayoutForConfig ────────────────────────────

describe('arrangeGridLayoutForConfig', () => {
  it('emits one item per visible panel in catalogue order', () => {
    const layout = arrangeGridLayoutForConfig(RISK_POSITIONS);
    // Watchlist is hidden in the default view — risk, trades, account, perf,
    // review remain, in catalogue order.
    expect(layout.map((l) => l.i)).toEqual([
      WORKSTATION_PANEL_IDS.RISK,
      WORKSTATION_PANEL_IDS.TRADES,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    ]);
  });

  it('attaches catalogue positions and size constraints from the areas grid', () => {
    const layout = arrangeGridLayoutForConfig(RISK_POSITIONS);
    const risk = layout.find((l) => l.i === WORKSTATION_PANEL_IDS.RISK)!;
    expect({ x: risk.x, y: risk.y, w: risk.w, h: risk.h }).toEqual({ x: 0, y: 0, w: 3, h: 1 });
    expect(risk.minW).toBe(3);
    expect(risk.maxW).toBe(3);

    const trades = layout.find((l) => l.i === WORKSTATION_PANEL_IDS.TRADES)!;
    // The default template places the trades workspace on one full-width row;
    // its catalogue height bounds (minH 3..maxH 12) apply only when the user
    // grows it via a saved arrangement.
    expect({ x: trades.x, y: trades.y, w: trades.w, h: trades.h }).toEqual({ x: 0, y: 2, w: 3, h: 1 });
    expect(trades.minH).toBe(3);
    expect(trades.maxH).toBe(12);

    const account = layout.find((l) => l.i === WORKSTATION_PANEL_IDS.ACCOUNT)!;
    expect({ x: account.x, y: account.y, w: account.w, h: account.h }).toEqual({
      x: 0,
      y: 1,
      w: 1,
      h: 1,
    });
    expect(account.minW).toBe(1);
    expect(account.maxW).toBe(3);
  });

  it('locks fixed anchors: static, not draggable, not resizable, no handles', () => {
    const layout = arrangeGridLayoutForConfig(RISK_POSITIONS);
    for (const id of [WORKSTATION_PANEL_IDS.RISK, WORKSTATION_PANEL_IDS.TRADES]) {
      const item = layout.find((l) => l.i === id)!;
      expect(item.isDraggable).toBe(false);
      expect(item.isResizable).toBe(false);
      expect(item.static).toBe(true);
      // RGL v2 draws a resize handle for every item unless the per-item
      // resizeHandles overrides the grid level — protected anchors declare
      // an empty list so they render no handle at all (dense contract:
      // southeast handles on eligible panels only).
      expect(item.resizeHandles).toEqual([]);
    }
  });

  it('marks eligible panels draggable and resizable (grid-level handles)', () => {
    const layout = arrangeGridLayoutForConfig(RISK_POSITIONS);
    for (const id of [
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    ]) {
      const item = layout.find((l) => l.i === id)!;
      expect(item.isDraggable).toBe(true);
      expect(item.isResizable).toBe(true);
      expect(item.static).toBe(false);
      // Eligible panels inherit the grid-level ['se'] resize axis: no
      // per-item override is declared.
      expect(item.resizeHandles).toBeUndefined();
    }
  });

  it('uses the config layout when present (arranged positions respected)', () => {
    const layout = arrangeGridLayoutForConfig(ARRANGED);
    const perf = layout.find((l) => l.i === WORKSTATION_PANEL_IDS.PERFORMANCE)!;
    expect({ x: perf.x, y: perf.y, w: perf.w, h: perf.h }).toEqual({ x: 0, y: 5, w: 3, h: 1 });
    const account = layout.find((l) => l.i === WORKSTATION_PANEL_IDS.ACCOUNT)!;
    expect({ x: account.x, y: account.y }).toEqual({ x: 0, y: 1 });
  });

  it('falls back to the areas-derived projection when the config carries no layout', () => {
    const layout = arrangeGridLayoutForConfig(LEGACY_PRESERVED);
    // The preserved 2-column arrangement is shown as-is: risk spans 2 of the
    // grid's 3 columns, trades sits in the left column below it.
    const risk = layout.find((l) => l.i === WORKSTATION_PANEL_IDS.RISK)!;
    expect({ x: risk.x, y: risk.y, w: risk.w, h: risk.h }).toEqual({ x: 0, y: 0, w: 2, h: 1 });
    const trades = layout.find((l) => l.i === WORKSTATION_PANEL_IDS.TRADES)!;
    expect({ x: trades.x, y: trades.y, w: trades.w, h: trades.h }).toEqual({
      x: 0,
      y: 1,
      w: 1,
      h: 4,
    });
    expect(layout.length).toBe(5);
  });

  it('excludes hidden panels entirely', () => {
    const layout = arrangeGridLayoutForConfig(fixedOnlyConfig());
    expect(layout.map((l) => l.i)).toEqual([
      WORKSTATION_PANEL_IDS.RISK,
      WORKSTATION_PANEL_IDS.TRADES,
    ]);
  });
});

// ── Component rendering ────────────────────────────────────────────────

describe('WorkstationArrangeGrid', () => {
  it('renders one cell per visible panel and supplies the layout to the grid', () => {
    renderGrid(RISK_POSITIONS);
    const props = latestGridProps();

    expect(props.layout.map((l) => l.i)).toEqual([
      WORKSTATION_PANEL_IDS.RISK,
      WORKSTATION_PANEL_IDS.TRADES,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    ]);
    for (const id of [
      WORKSTATION_PANEL_IDS.RISK,
      WORKSTATION_PANEL_IDS.TRADES,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    ]) {
      expect(screen.getByTestId(`ws-arrange-cell-${id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('ws-arrange-cell-watchlist')).toBeNull();
  });

  it('renders a labelled drag handle only on eligible (canDrag) panels', () => {
    renderGrid(RISK_POSITIONS);

    // Eligible panels carry the RGL drag-handle selector class.
    const accountHandle = screen.getByTestId('ws-arrange-handle-account');
    expect(accountHandle.className).toContain(ARRANGE_DRAG_HANDLE_CLASS);
    expect(accountHandle.getAttribute('aria-label')).toContain('Drag');
    expect(accountHandle.getAttribute('role')).toBe('button');
    expect(accountHandle.getAttribute('tabindex')).toBe('0');

    // Protected anchors render no drag handle at all.
    expect(screen.queryByTestId('ws-arrange-handle-risk')).toBeNull();
    expect(screen.queryByTestId('ws-arrange-handle-trades')).toBeNull();
  });

  it('marks fixed cells and keeps them handle-free', () => {
    renderGrid(RISK_POSITIONS);
    expect(screen.getByTestId('ws-arrange-cell-risk').getAttribute('data-ws-arrange-fixed')).toBe(
      'true',
    );
    expect(
      screen.getByTestId('ws-arrange-cell-account').getAttribute('data-ws-arrange-fixed'),
    ).toBe('false');
  });

  it('configures the grid for constrained drag and southeast resize', () => {
    renderGrid(RISK_POSITIONS);
    const props = latestGridProps();

    expect(props.gridConfig.cols).toBe(3);
    expect(props.gridConfig.rowHeight).toBe(ARRANGE_ROW_HEIGHT);
    expect(props.gridConfig.margin).toEqual(ARRANGE_GRID_MARGIN);

    expect(props.dragConfig.enabled).toBe(true);
    expect(props.dragConfig.handle).toBe(`.${ARRANGE_DRAG_HANDLE_CLASS}`);

    expect(props.resizeConfig.enabled).toBe(true);
    expect(props.resizeConfig.handles).toEqual(['se']);
  });

  it('calls renderPanel once per visible panel with the panel id', () => {
    const { renderPanel } = renderGrid(RISK_POSITIONS);
    expect(renderPanel).toHaveBeenCalledTimes(5);
    expect(renderPanel).toHaveBeenCalledWith(WORKSTATION_PANEL_IDS.RISK);
    expect(renderPanel).toHaveBeenCalledWith(WORKSTATION_PANEL_IDS.ACCOUNT);
    expect(renderPanel).not.toHaveBeenCalledWith(WORKSTATION_PANEL_IDS.WATCHLIST);
  });

  it('forwards committed RGL layouts verbatim to the session commit path', () => {
    const { onLayoutChange } = renderGrid(RISK_POSITIONS);
    const props = latestGridProps();

    const committed = arrangeGridLayoutForConfig(RISK_POSITIONS).map((item) => ({ ...item }));
    // Simulate a drag that moves Account State to a new row.
    committed[2] = { ...committed[2], y: 4 };

    act(() => {
      props.onLayoutChange(committed as unknown as Array<Record<string, unknown>>);
    });
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(onLayoutChange).toHaveBeenCalledWith(committed);
  });

  it('routes onDragStop and onResizeStop through the same commit path', () => {
    const { onLayoutChange } = renderGrid(RISK_POSITIONS);
    const props = latestGridProps();

    const unchanged = arrangeGridLayoutForConfig(RISK_POSITIONS).map((item) => ({ ...item }));
    act(() => {
      props.onDragStop(unchanged as unknown as Array<Record<string, unknown>>);
    });
    act(() => {
      props.onResizeStop(unchanged as unknown as Array<Record<string, unknown>>);
    });
    // The hook no-op guards repeated/unchanged commits; the grid must still
    // deliver every gesture callback (belt-and-suspenders for gestures that
    // end where they started).
    expect(onLayoutChange).toHaveBeenCalledTimes(2);
    expect(onLayoutChange).toHaveBeenNthCalledWith(1, unchanged);
    expect(onLayoutChange).toHaveBeenNthCalledWith(2, unchanged);
  });

  it('is a thin boundary: raw RGL layouts (including unknown ids) are forwarded, not filtered', () => {
    const { onLayoutChange } = renderGrid(RISK_POSITIONS);
    const props = latestGridProps();

    const rawWithUnknown = [
      { i: 'risk', x: 0, y: 0, w: 3, h: 1 },
      { i: 'not-a-panel', x: 0, y: 3, w: 1, h: 1 },
    ];
    act(() => {
      props.onLayoutChange(rawWithUnknown as unknown as Array<Record<string, unknown>>);
    });
    // Dropping unknown ids is the hook's job (normalizeArrangementLayout);
    // the grid must not silently mutate or filter what RGL reported.
    expect(onLayoutChange).toHaveBeenCalledWith(rawWithUnknown);
  });

  it('renders a drag handle for a shown Watchlist panel', () => {
    renderGrid(watchlistVisibleConfig());
    expect(screen.getByTestId('ws-arrange-cell-watchlist')).toBeTruthy();
    expect(screen.getByTestId('ws-arrange-handle-watchlist')).toBeTruthy();
  });

  it('renders only the fixed anchors when every optional panel is hidden', () => {
    renderGrid(fixedOnlyConfig());
    expect(screen.getByTestId('ws-arrange-cell-risk')).toBeTruthy();
    expect(screen.getByTestId('ws-arrange-cell-trades')).toBeTruthy();
    expect(screen.queryByTestId('ws-arrange-cell-account')).toBeNull();
    expect(latestGridProps().layout.map((l) => l.i)).toEqual([
      WORKSTATION_PANEL_IDS.RISK,
      WORKSTATION_PANEL_IDS.TRADES,
    ]);
  });

  it('renders a preserved legacy view without a layout', () => {
    renderGrid(LEGACY_PRESERVED);
    // All five visible panels render; the two-column arrangement is shown
    // as-is (risk spans 2 of the 3 grid columns).
    expect(screen.getByTestId('ws-arrange-cell-risk')).toBeTruthy();
    expect(screen.getByTestId('ws-arrange-cell-account')).toBeTruthy();
    expect(layoutItem(WORKSTATION_PANEL_IDS.RISK)).toMatchObject({ w: 2 });
  });
});
