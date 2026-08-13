/**
 * Tests for WorkstationKeyboardArrange (M017/S04-T03).
 *
 * The pure `computeKeyboardArrangement` helper is the placement engine:
 * move/resize stepping with clamping, swap semantics for occupied cells,
 * fixed-anchor protection, catalogue-bound resizing, and the residual
 * overlap sweep. The component tests cover the focus gate (arrow keys act
 * only on a focused drag handle), Shift+Arrow resize mapping, Escape exit,
 * modifier-key and editable-target guards, and defaultPrevented yielding.
 *
 * Run: npx vitest run src/components/workstation/workstation-keyboard-arrange.test.tsx
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';

import {
  WorkstationKeyboardArrange,
  computeKeyboardArrangement,
  getFocusedArrangePanel,
} from './workstation-keyboard-arrange';
import {
  WORKSTATION_PANEL_IDS,
  WORKSTATION_TEMPLATE_IDS,
  WORKSTATION_LAYOUT_VERSION,
  deriveLayoutFromAreas,
  type WorkstationPanelId,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';

// ── Fixtures ───────────────────────────────────────────────────────────

/**
 * A view with free space around the movable panels: the dense flow with
 * Watchlist shown (appended below the grid) and Review hidden, so account /
 * perf have room to move and grow.
 */
const SPACIOUS: WorkstationViewConfig = {
  templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
  areas: [
    ['risk', 'risk', 'risk'],
    ['account', 'perf', '.'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
    ['watchlist', 'watchlist', 'watchlist'],
  ],
  hiddenPanels: [WORKSTATION_PANEL_IDS.PROCESS_REVIEW],
  version: WORKSTATION_LAYOUT_VERSION,
  layout: deriveLayoutFromAreas([
    ['risk', 'risk', 'risk'],
    ['account', 'perf', '.'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
    ['watchlist', 'watchlist', 'watchlist'],
  ]),
};

/** A preserved user-modified v1 view: valid, but carries no RGL layout. */
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

/** A view with a lone summary panel at the right edge and free space to its
 *  left, for growing-past-the-edge tests (x re-clamping). */
const RIGHT_EDGE: WorkstationViewConfig = {
  templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
  areas: [
    ['risk', 'risk', 'risk'],
    ['.', 'perf', '.'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
  ],
  hiddenPanels: [
    WORKSTATION_PANEL_IDS.ACCOUNT,
    WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    WORKSTATION_PANEL_IDS.WATCHLIST,
  ],
  version: WORKSTATION_LAYOUT_VERSION,
  layout: deriveLayoutFromAreas([
    ['risk', 'risk', 'risk'],
    ['.', 'perf', '.'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
    ['trades', 'trades', 'trades'],
  ]),
};

// ── Helpers ────────────────────────────────────────────────────────────

/** Layout item lookup by panel id inside a helper result. */
function itemOf(layout: ReturnType<typeof computeKeyboardArrangement>, id: WorkstationPanelId) {
  const item = layout?.find((l) => l.i === id);
  if (!item) throw new Error(`layout has no item for "${id}"`);
  return item;
}

function move(id: WorkstationPanelId, dx: number, dy: number) {
  return { type: 'move' as const, dx, dy };
}

function resize(id: WorkstationPanelId, dw: number, dh: number) {
  return { type: 'resize' as const, dw, dh };
}

/** Render the handler with focusable fake drag handles. */
function renderHandler(config: WorkstationViewConfig) {
  const onApplyLayout = vi.fn();
  const onExitArrangeMode = vi.fn();
  render(
    <>
      <WorkstationKeyboardArrange
        config={config}
        onApplyLayout={onApplyLayout}
        onExitArrangeMode={onExitArrangeMode}
      />
      <button type="button" data-testid="ws-arrange-handle-account" tabIndex={0}>
        Drag Account State
      </button>
      <button type="button" data-testid="ws-arrange-handle-perf" tabIndex={0}>
        Drag Performance
      </button>
    </>,
  );
  return { onApplyLayout, onExitArrangeMode };
}

/** Dispatch a keydown from the currently focused element (realistic target). */
function keydown(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  const target = (document.activeElement ?? document.body) as HTMLElement;
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Focus a rendered testid element (throws when missing). */
function focusTestId(testId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`testid "${testId}" not in the document`);
  el.focus();
  return el;
}

// ── Setup / Teardown ───────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
});

// ── Pure helper: computeKeyboardArrangement — move ─────────────────────

describe('computeKeyboardArrangement — move', () => {
  it('moves a panel one cell into a free cell, leaving other items unchanged', () => {
    const next = computeKeyboardArrangement(
      SPACIOUS,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      move(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 0),
    );
    // perf at (1,1) w=1; the cell (2,1) is free ('.' in the areas grid).
    expect(itemOf(next, WORKSTATION_PANEL_IDS.PERFORMANCE)).toMatchObject({ x: 2, y: 1 });
    expect(itemOf(next, WORKSTATION_PANEL_IDS.ACCOUNT)).toMatchObject({ x: 0, y: 1 });
    expect(next).toHaveLength(5);
  });

  it('moves down into free space and left via swap', () => {
    // watchlist (0,5) w=3 h=1: the row below is free — direct move down.
    const down = computeKeyboardArrangement(
      SPACIOUS,
      WORKSTATION_PANEL_IDS.WATCHLIST,
      move(WORKSTATION_PANEL_IDS.WATCHLIST, 0, 1),
    );
    expect(itemOf(down, WORKSTATION_PANEL_IDS.WATCHLIST)).toMatchObject({ x: 0, y: 6 });

    // perf (1,1) moving left lands on account (0,1) — swap positions.
    const left = computeKeyboardArrangement(
      SPACIOUS,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      move(WORKSTATION_PANEL_IDS.PERFORMANCE, -1, 0),
    );
    expect(itemOf(left, WORKSTATION_PANEL_IDS.PERFORMANCE)).toMatchObject({ x: 0, y: 1 });
    expect(itemOf(left, WORKSTATION_PANEL_IDS.ACCOUNT)).toMatchObject({ x: 1, y: 1 });
  });

  it('swaps with a single movable occupant instead of overlapping it', () => {
    // account (0,1) moves right into perf (1,1): the two swap x positions.
    const next = computeKeyboardArrangement(
      SPACIOUS,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      move(WORKSTATION_PANEL_IDS.ACCOUNT, 1, 0),
    );
    expect(itemOf(next, WORKSTATION_PANEL_IDS.ACCOUNT)).toMatchObject({ x: 1, y: 1 });
    expect(itemOf(next, WORKSTATION_PANEL_IDS.PERFORMANCE)).toMatchObject({ x: 0, y: 1 });
    // The swapped layout must be overlap-free.
    const rects = next!.map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h }));
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const A = rects[a];
        const B = rects[b];
        const overlap = A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('blocks moves into fixed anchors (risk above, trades below)', () => {
    // account (0,1): up is risk, down is trades — both fixed, both blocked.
    expect(
      computeKeyboardArrangement(
        SPACIOUS,
        WORKSTATION_PANEL_IDS.ACCOUNT,
        move(WORKSTATION_PANEL_IDS.ACCOUNT, 0, -1),
      ),
    ).toBeNull();
    expect(
      computeKeyboardArrangement(
        SPACIOUS,
        WORKSTATION_PANEL_IDS.ACCOUNT,
        move(WORKSTATION_PANEL_IDS.ACCOUNT, 0, 1),
      ),
    ).toBeNull();
  });

  it('returns null for a no-op at the grid edge (left of x=0)', () => {
    expect(
      computeKeyboardArrangement(
        SPACIOUS,
        WORKSTATION_PANEL_IDS.ACCOUNT,
        move(WORKSTATION_PANEL_IDS.ACCOUNT, -1, 0),
      ),
    ).toBeNull();
  });

  it('never moves or resizes fixed anchors', () => {
    expect(
      computeKeyboardArrangement(SPACIOUS, WORKSTATION_PANEL_IDS.RISK, move(WORKSTATION_PANEL_IDS.RISK, 0, 1)),
    ).toBeNull();
    expect(
      computeKeyboardArrangement(SPACIOUS, WORKSTATION_PANEL_IDS.TRADES, move(WORKSTATION_PANEL_IDS.TRADES, 1, 0)),
    ).toBeNull();
    expect(
      computeKeyboardArrangement(SPACIOUS, WORKSTATION_PANEL_IDS.TRADES, resize(WORKSTATION_PANEL_IDS.TRADES, 0, 1)),
    ).toBeNull();
  });

  it('returns null for hidden panels (not in the layout)', () => {
    expect(
      computeKeyboardArrangement(
        SPACIOUS,
        WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
        move(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 1, 0),
      ),
    ).toBeNull();
  });

  it('uses the areas-derived projection when the config carries no layout (legacy views)', () => {
    // LEGACY_PRESERVED: trades at (0,1) w=1 h=4, account at (1,1), perf at
    // (1,2). Move account down into (1,2) — perf occupies it → swap.
    const next = computeKeyboardArrangement(
      LEGACY_PRESERVED,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      move(WORKSTATION_PANEL_IDS.ACCOUNT, 0, 1),
    );
    expect(itemOf(next, WORKSTATION_PANEL_IDS.ACCOUNT)).toMatchObject({ x: 1, y: 2 });
    expect(itemOf(next, WORKSTATION_PANEL_IDS.PERFORMANCE)).toMatchObject({ x: 1, y: 1 });
  });
});

// ── Pure helper: computeKeyboardArrangement — resize ───────────────────

describe('computeKeyboardArrangement — resize', () => {
  it('grows a panel into free space within catalogue bounds', () => {
    // perf (1,1) w=1; free cell (2,1) — grow width to 2.
    const next = computeKeyboardArrangement(
      SPACIOUS,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      resize(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 0),
    );
    expect(itemOf(next, WORKSTATION_PANEL_IDS.PERFORMANCE)).toMatchObject({
      x: 1,
      y: 1,
      w: 2,
      h: 1,
    });
  });

  it('re-clamps x so a wider item stays inside the grid columns', () => {
    // perf at (1,1) w=1 with free space both sides: growing to w=2 keeps
    // x=1; growing to w=3 must collapse x to 0 to stay inside 3 columns.
    const grown = computeKeyboardArrangement(
      RIGHT_EDGE,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      resize(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 0),
    );
    expect(itemOf(grown, WORKSTATION_PANEL_IDS.PERFORMANCE)).toMatchObject({ x: 1, w: 2 });
    const wider = computeKeyboardArrangement(
      { ...RIGHT_EDGE, layout: grown! },
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      resize(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 0),
    );
    expect(itemOf(wider, WORKSTATION_PANEL_IDS.PERFORMANCE)).toMatchObject({ x: 0, w: 3 });
  });

  it('clamps growth to the catalogue maximums', () => {
    // watchlist maxH=3 and sits on the last row with free space below:
    // grow height twice, then beyond is a no-op.
    const grow = computeKeyboardArrangement(
      SPACIOUS,
      WORKSTATION_PANEL_IDS.WATCHLIST,
      resize(WORKSTATION_PANEL_IDS.WATCHLIST, 0, 1),
    );
    expect(itemOf(grow, WORKSTATION_PANEL_IDS.WATCHLIST)).toMatchObject({ h: 2 });
    const again = computeKeyboardArrangement(
      { ...SPACIOUS, layout: grow! },
      WORKSTATION_PANEL_IDS.WATCHLIST,
      resize(WORKSTATION_PANEL_IDS.WATCHLIST, 0, 1),
    );
    expect(itemOf(again, WORKSTATION_PANEL_IDS.WATCHLIST)).toMatchObject({ h: 3 });
    const capped = computeKeyboardArrangement(
      { ...SPACIOUS, layout: again! },
      WORKSTATION_PANEL_IDS.WATCHLIST,
      resize(WORKSTATION_PANEL_IDS.WATCHLIST, 0, 1),
    );
    expect(capped).toBeNull(); // already at maxH — nothing changes
  });

  it('clamps shrink to the catalogue minimums', () => {
    // account minW=1, minH=1: shrink below is a no-op.
    expect(
      computeKeyboardArrangement(
        SPACIOUS,
        WORKSTATION_PANEL_IDS.ACCOUNT,
        resize(WORKSTATION_PANEL_IDS.ACCOUNT, 0, -1),
      ),
    ).toBeNull();
  });

  it('blocks growth into occupied space', () => {
    // account (0,1) growing right overlaps perf (1,1) → blocked.
    expect(
      computeKeyboardArrangement(
        SPACIOUS,
        WORKSTATION_PANEL_IDS.ACCOUNT,
        resize(WORKSTATION_PANEL_IDS.ACCOUNT, 1, 0),
      ),
    ).toBeNull();
    // Growing down overlaps the fixed trades anchor → blocked.
    expect(
      computeKeyboardArrangement(
        SPACIOUS,
        WORKSTATION_PANEL_IDS.PERFORMANCE,
        resize(WORKSTATION_PANEL_IDS.PERFORMANCE, 0, 1),
      ),
    ).toBeNull();
  });

  it('allows shrinking regardless of neighbours', () => {
    // watchlist w=3 shrinks to w=2 (minW=1), even though it spans the row.
    const next = computeKeyboardArrangement(
      SPACIOUS,
      WORKSTATION_PANEL_IDS.WATCHLIST,
      resize(WORKSTATION_PANEL_IDS.WATCHLIST, -1, 0),
    );
    expect(itemOf(next, WORKSTATION_PANEL_IDS.WATCHLIST)).toMatchObject({ w: 2 });
  });
});

// ── DOM helper: getFocusedArrangePanel ─────────────────────────────────

describe('getFocusedArrangePanel', () => {
  it('returns the panel id of a focused drag handle', () => {
    render(<button type="button" data-testid="ws-arrange-handle-account" tabIndex={0} />);
    focusTestId('ws-arrange-handle-account');
    expect(getFocusedArrangePanel()).toBe(WORKSTATION_PANEL_IDS.ACCOUNT);
  });

  it('returns null when focus is elsewhere', () => {
    expect(getFocusedArrangePanel()).toBeNull();
  });
});

// ── Component wiring ───────────────────────────────────────────────────

describe('WorkstationKeyboardArrange', () => {
  it('commits a move when an arrow is pressed with a drag handle focused', () => {
    const { onApplyLayout } = renderHandler(SPACIOUS);
    focusTestId('ws-arrange-handle-account');

    keydown('ArrowRight');

    expect(onApplyLayout).toHaveBeenCalledTimes(1);
    const committed = onApplyLayout.mock.calls[0][0] as Array<{ i: string; x: number }>;
    const account = committed.find((l) => l.i === WORKSTATION_PANEL_IDS.ACCOUNT);
    expect(account?.x).toBe(1); // swapped with perf at (1,1)
  });

  it('ignores arrows when focus is not on a drag handle', () => {
    const { onApplyLayout } = renderHandler(SPACIOUS);

    keydown('ArrowRight'); // focus is on the page body, not a handle

    expect(onApplyLayout).not.toHaveBeenCalled();
  });

  it('commits a resize when Shift+Arrow is pressed', () => {
    const { onApplyLayout } = renderHandler(SPACIOUS);
    focusTestId('ws-arrange-handle-perf');

    keydown('ArrowRight', { shiftKey: true });

    expect(onApplyLayout).toHaveBeenCalledTimes(1);
    const committed = onApplyLayout.mock.calls[0][0] as Array<{ i: string; w: number }>;
    const perf = committed.find((l) => l.i === WORKSTATION_PANEL_IDS.PERFORMANCE);
    expect(perf?.w).toBe(2); // grows into the free cell (2,1)
  });

  it('does not commit a blocked move (no-op at a boundary)', () => {
    const { onApplyLayout } = renderHandler(SPACIOUS);
    focusTestId('ws-arrange-handle-account');

    keydown('ArrowLeft'); // account at x=0 — no-op

    expect(onApplyLayout).not.toHaveBeenCalled();
  });

  it('calls onExitArrangeMode on Escape', () => {
    const { onExitArrangeMode } = renderHandler(SPACIOUS);
    focusTestId('ws-arrange-handle-account');

    keydown('Escape');

    expect(onExitArrangeMode).toHaveBeenCalledTimes(1);
  });

  it('does not exit on Escape while typing in an editable field', () => {
    const { onExitArrangeMode } = renderHandler(SPACIOUS);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    keydown('Escape'); // dispatched from the focused input

    expect(onExitArrangeMode).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('ignores events with ctrl/meta/alt modifiers', () => {
    const { onApplyLayout, onExitArrangeMode } = renderHandler(SPACIOUS);
    focusTestId('ws-arrange-handle-account');

    keydown('ArrowRight', { ctrlKey: true });
    keydown('ArrowRight', { metaKey: true });
    keydown('ArrowRight', { altKey: true });
    keydown('Escape', { ctrlKey: true });

    expect(onApplyLayout).not.toHaveBeenCalled();
    expect(onExitArrangeMode).not.toHaveBeenCalled();
  });

  it('yields to a keydown another capture handler already consumed', () => {
    // A listener registered before the component (mount order) claims the
    // event by preventDefault; the arrange handler must defer to it.
    const preHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    window.addEventListener('keydown', preHandler, { capture: true });

    const { onExitArrangeMode } = renderHandler(SPACIOUS);
    focusTestId('ws-arrange-handle-account');

    keydown('Escape');

    expect(onExitArrangeMode).not.toHaveBeenCalled();
    window.removeEventListener('keydown', preHandler, { capture: true });
  });

  it('commits once per keydown for repeated keys', () => {
    const { onApplyLayout } = renderHandler(SPACIOUS);
    focusTestId('ws-arrange-handle-account');

    keydown('ArrowRight');
    keydown('ArrowRight');

    expect(onApplyLayout).toHaveBeenCalledTimes(2);
    // The test harness does not re-render with a fresh draft, so both
    // commits resolve against the same base layout (in the real shell the
    // draft updates between commits and the second key reads it).
    const first = onApplyLayout.mock.calls[0][0] as Array<{ i: string; x: number }>;
    const second = onApplyLayout.mock.calls[1][0] as Array<{ i: string; x: number }>;
    expect(first.find((l) => l.i === WORKSTATION_PANEL_IDS.ACCOUNT)?.x).toBe(1);
    expect(second.find((l) => l.i === WORKSTATION_PANEL_IDS.ACCOUNT)?.x).toBe(1);
  });
});
