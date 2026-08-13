'use client';

/**
 * WorkstationKeyboardArrange — keyboard move/grow/shrink for arrangement
 * mode (M017/S04-T03).
 *
 * Arrangement mode adds a keyboard equivalent to the pointer drag/resize
 * surface (DASHBOARD_DENSE_LAYOUT_REQUIREMENTS §Saved-view arrangement
 * mode): with a panel's drag handle focused,
 *
 * - Arrow keys move the panel one arrangement cell in that direction;
 * - Shift+Arrow keys grow/shrink the panel in that direction (ArrowRight
 *   grows width, ArrowLeft shrinks it, ArrowDown grows height, ArrowUp
 *   shrinks it);
 * - Escape exits arrangement mode back to the hide/show customize surface.
 *
 * Every move/resize is computed as a next raw RGL layout and committed
 * through the same single commit path the pointer gestures use
 * (useCustomizeMode.applyLayout), so keyboard edits are clamped to the
 * catalogue constraints, re-projected onto the areas grid, undoable, and
 * rejected when unrepresentable — exactly like a pointer gesture.
 *
 * ## Placement semantics
 *
 * The keyboard model must never emit an overlapping layout (applyLayout
 * rejects collisions, so a blocked move would be a silent no-op). Moves
 * into a free cell are direct; a move into a cell occupied by exactly one
 * other *movable* panel swaps the two panels' positions (window-manager
 * semantics — otherwise the dense templates offer almost no keyboard moves,
 * because the summary row is fully occupied); moves into a fixed anchor
 * (risk, trades) or a crowded cell are blocked. Growing a panel into
 * occupied space is blocked; shrinking is always allowed. The candidate
 * layout is swept for residual overlaps before it is returned, so the pure
 * helper never emits an invalid arrangement.
 *
 * ## Focus contract
 *
 * Arrow keys act only while focus sits on a drag handle
 * (`data-testid="ws-arrange-handle-<panelId>"`) — inside a panel's controls
 * the arrows keep their normal meaning (tables, scrolling). Escape exits
 * arrangement mode from anywhere outside an editable field. The handler
 * yields to events another capture-phase handler already consumed
 * (`defaultPrevented`), so the shortcut overlay's Escape still wins.
 */

import { useEffect, useRef } from 'react';
import {
  WORKSTATION_PANEL_CATALOGUE,
  WORKSTATION_TEMPLATES,
  deriveLayoutFromAreas,
  isWorkstationPanelId,
  type WorkstationLayoutItem,
  type WorkstationPanelId,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';

// ── Constants ──────────────────────────────────────────────────────────

/**
 * Ceiling for keyboard moves in the +y direction. Matches the arrangement
 * hook's own clamp (`ARRANGEMENT_MAX_GRID_ROWS`), so a keyboard session can
 * never outpace the commit path's bound (a hostile or accidental repeat key
 * cannot allocate unbounded rows).
 */
const ARRANGE_KEYBOARD_MAX_Y = 500;

/** Drag-handle testid prefix — the focus gate for keyboard moves. */
const ARRANGE_HANDLE_TESTID_PREFIX = 'ws-arrange-handle-';

// ── Action types ───────────────────────────────────────────────────────

export interface KeyboardArrangeMoveAction {
  type: 'move';
  /** Column delta (negative = left). */
  dx: number;
  /** Row delta (negative = up). */
  dy: number;
}

export interface KeyboardArrangeResizeAction {
  type: 'resize';
  /** Width delta in columns (negative = shrink). */
  dw: number;
  /** Height delta in rows (negative = shrink). */
  dh: number;
}

export type KeyboardArrangeAction = KeyboardArrangeMoveAction | KeyboardArrangeResizeAction;

// ── Pure helpers ───────────────────────────────────────────────────────

/** Round a finite number into [lo, hi]; non-finite input falls back to lo. */
function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

/** Axis-aligned rectangle overlap test for two layout items. */
function rectsOverlap(
  a: Pick<WorkstationLayoutItem, 'x' | 'y' | 'w' | 'h'>,
  b: Pick<WorkstationLayoutItem, 'x' | 'y' | 'w' | 'h'>,
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** True when any pair of items in the layout overlaps. */
function hasAnyOverlap(items: readonly WorkstationLayoutItem[]): boolean {
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (rectsOverlap(items[a], items[b])) return true;
    }
  }
  return false;
}

/**
 * Compute the next raw RGL layout for one keyboard move/resize action, or
 * null when the action cannot change the arrangement.
 *
 * - **Move:** the item steps one cell in the requested direction, clamped
 *   to the grid edges. A target cell that is free places the item there;
 *   a target cell occupied by exactly one other movable panel swaps the
 *   two panels' positions; anything else (fixed anchors, crowded cells)
 *   blocks the move. The candidate layout is swept for residual overlaps
 *   before it is returned.
 * - **Resize:** the item's span steps one cell in the requested direction,
 *   clamped to its catalogue bounds (minW/maxW/minH/maxH); x is re-clamped
 *   so a wider item stays inside the grid's columns. Growing into occupied
 *   space is blocked; shrinking is always allowed.
 *
 * The returned layout is raw — the hook's `normalizeArrangementLayout`
 * clamps, validates, and re-projects it onto the areas grid, so this
 * helper only needs to be safe and predictable, not canonical. Fixed
 * anchors (`canDrag: false`) never move or resize; unknown or hidden
 * panels are not in the layout and return null.
 */
export function computeKeyboardArrangement(
  config: WorkstationViewConfig,
  panelId: WorkstationPanelId,
  action: KeyboardArrangeAction,
): WorkstationLayoutItem[] | null {
  const def = WORKSTATION_PANEL_CATALOGUE[panelId];
  if (!def || !def.canDrag) return null; // fixed anchors never move/resize

  const base = config.layout ?? deriveLayoutFromAreas(config.areas);
  const current = base.find((item) => item.i === panelId);
  if (!current) return null; // hidden or otherwise unplaced panel

  const cols = WORKSTATION_TEMPLATES[config.templateId]?.columns.length ?? 3;

  if (action.type === 'move') {
    const x = clampInt(current.x + action.dx, 0, cols - current.w);
    const y = clampInt(current.y + action.dy, 0, ARRANGE_KEYBOARD_MAX_Y);
    if (x === current.x && y === current.y) return null; // edge — nothing changes

    const target: WorkstationLayoutItem = { ...current, x, y };
    const occupants = base.filter((item) => item.i !== panelId && rectsOverlap(target, item));
    if (occupants.length === 0) {
      // Free cell: move the item there (sweep is trivially clean).
      return base.map((item) => (item.i === panelId ? target : item));
    }
    // Occupied target: only a single movable occupant supports a swap.
    if (occupants.length > 1) return null; // crowded — ambiguous, block
    const occupant = occupants[0];
    if (!WORKSTATION_PANEL_CATALOGUE[occupant.i].canDrag) return null; // never displace anchors
    const displaced: WorkstationLayoutItem = { ...occupant, x: current.x, y: current.y };
    const next = base.map((item) =>
      item.i === panelId ? target : item.i === occupant.i ? displaced : item,
    );
    // The displaced occupant may extend past the mover's old footprint and
    // collide with a third item; sweep and block when that happens.
    return hasAnyOverlap(next) ? null : next;
  }

  // Resize: only catalogue-resizable panels can grow/shrink.
  if (!def.canResize) return null;
  const w = clampInt(current.w + action.dw, def.minW, def.maxW);
  const h = clampInt(current.h + action.dh, def.minH, def.maxH);
  if (w === current.w && h === current.h) return null; // at catalogue bounds

  const next: WorkstationLayoutItem = {
    ...current,
    w,
    h,
    x: Math.min(current.x, cols - w), // keep a wider item inside the columns
  };
  const growing = w > current.w || h > current.h;
  if (
    growing &&
    base.some((item) => item.i !== panelId && rectsOverlap(next, item))
  ) {
    return null; // growing into occupied space is blocked
  }
  return base.map((item) => (item.i === panelId ? next : item));
}

/**
 * The arrangement panel whose drag handle currently holds focus, or null.
 * Arrow-key moves act only on this panel; fixed anchors have no handle, so
 * they can never be the focus target.
 */
export function getFocusedArrangePanel(): WorkstationPanelId | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) return null;
  const testId = el.getAttribute('data-testid');
  if (!testId || !testId.startsWith(ARRANGE_HANDLE_TESTID_PREFIX)) return null;
  const panelId = testId.slice(ARRANGE_HANDLE_TESTID_PREFIX.length);
  return isWorkstationPanelId(panelId) ? panelId : null;
}

/** True when the event target is a text-editing surface (input/textarea/select/contentEditable). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

// ── Key maps ───────────────────────────────────────────────────────────

const MOVE_KEYS: Readonly<Record<string, KeyboardArrangeMoveAction>> = {
  ArrowUp: { type: 'move', dx: 0, dy: -1 },
  ArrowDown: { type: 'move', dx: 0, dy: 1 },
  ArrowLeft: { type: 'move', dx: -1, dy: 0 },
  ArrowRight: { type: 'move', dx: 1, dy: 0 },
};

const RESIZE_KEYS: Readonly<Record<string, KeyboardArrangeResizeAction>> = {
  ArrowUp: { type: 'resize', dw: 0, dh: -1 },
  ArrowDown: { type: 'resize', dw: 0, dh: 1 },
  ArrowLeft: { type: 'resize', dw: -1, dh: 0 },
  ArrowRight: { type: 'resize', dw: 1, dh: 0 },
};

// ── Component ──────────────────────────────────────────────────────────

export interface WorkstationKeyboardArrangeProps {
  /** The session draft being arranged (areas + canonical layout). */
  config: WorkstationViewConfig;
  /**
   * Commit a next keyboard arrangement. The shell wires this to
   * useCustomizeMode().applyLayout — the same single commit path the
   * pointer gestures use (clamped, validated, undoable, no-op guarded).
   */
  onApplyLayout: (layout: readonly WorkstationLayoutItem[]) => void;
  /** Exit arrangement mode (Escape) — back to the hide/show customize surface. */
  onExitArrangeMode: () => void;
}

/**
 * The arrangement-mode keyboard handler. Renders nothing; mounts a
 * capture-phase window keydown listener while the shell keeps it mounted
 * (arrange mode active). Callback/config props are read through refs so the
 * listener never re-registers mid-session (the draft changes on every
 * commit — re-registering per commit would be wasteful and could drop
 * keystrokes).
 */
export function WorkstationKeyboardArrange({
  config,
  onApplyLayout,
  onExitArrangeMode,
}: WorkstationKeyboardArrangeProps) {
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const applyLayoutRef = useRef(onApplyLayout);
  useEffect(() => {
    applyLayoutRef.current = onApplyLayout;
  }, [onApplyLayout]);

  const exitRef = useRef(onExitArrangeMode);
  useEffect(() => {
    exitRef.current = onExitArrangeMode;
  }, [onExitArrangeMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Yield to a handler that already consumed this event (e.g. the
      // keyboard-shortcut overlay's Escape when its dialog is open).
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Escape exits arrangement mode (outside text-editing fields).
      if (e.key === 'Escape') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        exitRef.current();
        return;
      }

      // Arrow moves/grow-shrink act only on the focused panel's drag handle.
      const panelId = getFocusedArrangePanel();
      if (!panelId) return;

      const action = e.shiftKey ? RESIZE_KEYS[e.key] : MOVE_KEYS[e.key];
      if (!action) return;
      // Arrows in arrange mode never scroll the page or the grid, even when
      // the move is blocked at a boundary.
      e.preventDefault();
      const next = computeKeyboardArrangement(configRef.current, panelId, action);
      if (next) {
        applyLayoutRef.current(next);
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  return null;
}
