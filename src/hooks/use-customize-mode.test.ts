/**
 * Tests for useCustomizeMode (M016/S06-T04, extended by M017/S04-T01).
 *
 * Covers: the pure `togglePanelVisibilityInConfig` helper (hide/show/fixed/
 * occupied-home/validity), `workstationConfigsEqual`, and the full
 * customize-session state machine: enter (with snapshot semantics), hide/
 * show toggles with undo history, Undo across multiple edits, Reset to
 * template (with no-op guard), Cancel (discard), Save (returns a clone and
 * exits), dirty tracking, hidden-optional-panel derivation, and defensive
 * no-ops outside a session.
 *
 * M017/S04 arrangement actions: `canonicalLayoutForConfig` (areas-derived
 * RGL layout normalization), `normalizeArrangementLayout` (RGL input
 * clamped to catalogue constraints with fixed anchors locked), and the
 * hook's `applyLayout` commit path (dirty/undo/no-op semantics, invalid
 * placements rejected, legacy 2-column upgrades, layout/areas consistency
 * invariant).
 *
 * Run: npx vitest run src/hooks/use-customize-mode.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

import {
  useCustomizeMode,
  togglePanelVisibilityInConfig,
  workstationConfigsEqual,
  canonicalLayoutForConfig,
  normalizeArrangementLayout,
  workstationLayoutsEqual,
} from './use-customize-mode';
import {
  WORKSTATION_PANEL_IDS,
  WORKSTATION_TEMPLATE_IDS,
  WORKSTATION_LAYOUT_VERSION,
  createViewFromTemplate,
  deriveLayoutFromAreas,
  validateWorkstationViewConfig,
  type WorkstationLayoutItem,
  type WorkstationPanelId,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';

// ── Fixtures ───────────────────────────────────────────────────────────

const RISK_POSITIONS = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
const PERFORMANCE = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);

/**
 * A preserved user-modified v1 view migrated to v2: a valid config whose
 * 2-column areas cannot satisfy the dense catalogue bounds (fixed panels
 * are locked full-width in the dense model), so it carries no RGL layout.
 */
const LEGACY_PRESERVED: WorkstationViewConfig = {
  templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
  areas: [
    ['risk', 'risk'],
    ['trades', 'account'],
    ['trades', 'perf'],
    ['trades', 'review'],
    ['trades', 'watchlist'],
  ],
  hiddenPanels: [],
  version: WORKSTATION_LAYOUT_VERSION,
};

/** The same preserved view with every rail panel hidden (arrangeable). */
function legacyWithHiddenRail(): WorkstationViewConfig {
  return {
    templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
    areas: [
      ['risk', 'risk'],
      ['trades', '.'],
      ['trades', '.'],
      ['trades', '.'],
      ['trades', '.'],
    ],
    hiddenPanels: ['account', 'perf', 'review', 'watchlist'],
    version: WORKSTATION_LAYOUT_VERSION,
  };
}

/** Build a raw RGL-style layout item (constraints are catalogue-sourced). */
function rawItem(
  i: WorkstationPanelId,
  x: number,
  y: number,
  w: number,
  h: number,
): WorkstationLayoutItem {
  return { i, x, y, w, h };
}

/** Assert the draft invariant: valid, and layout consistent with areas. */
function expectConsistentDraft(draft: WorkstationViewConfig): void {
  expect(validateWorkstationViewConfig(draft)).toEqual([]);
  if (draft.layout === undefined) return;
  expect(workstationLayoutsEqual(draft.layout, deriveLayoutFromAreas(draft.areas))).toBe(true);
}

/** A grid deliberately missing one column so template regions are out of bounds. */
function undersizedConfig(): WorkstationViewConfig {
  return {
    templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
    areas: [['risk'], ['trades'], ['trades'], ['trades'], ['trades']],
    hiddenPanels: ['account', 'perf', 'review', 'watchlist'],
    version: WORKSTATION_LAYOUT_VERSION,
  };
}

// ── Setup / Teardown ───────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

// ── Pure helper: togglePanelVisibilityInConfig ─────────────────────────

describe('togglePanelVisibilityInConfig', () => {
  it('shows default-hidden Watchlist as a full-width saved-view row', () => {
    const next = togglePanelVisibilityInConfig(RISK_POSITIONS, WORKSTATION_PANEL_IDS.WATCHLIST);
    expect(next).not.toBeNull();
    // The fallback row is appended at the end of the grid (the dense
    // catalogue removed the v1 KPI-band anchor).
    expect(next!.areas[next!.areas.length - 1]).toEqual([
      WORKSTATION_PANEL_IDS.WATCHLIST,
      WORKSTATION_PANEL_IDS.WATCHLIST,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
    expect(next!.hiddenPanels).toEqual([]);
    // The result stays catalogue-valid at every step.
    expect(validateWorkstationViewConfig(next)).toEqual([]);
  });

  it('hides multiple panels and keeps hiddenPanels in catalogue order', () => {
    let config = togglePanelVisibilityInConfig(RISK_POSITIONS, WORKSTATION_PANEL_IDS.WATCHLIST)!;
    config = togglePanelVisibilityInConfig(config, WORKSTATION_PANEL_IDS.ACCOUNT)!;
    config = togglePanelVisibilityInConfig(config, WORKSTATION_PANEL_IDS.PERFORMANCE)!;
    config = togglePanelVisibilityInConfig(config, WORKSTATION_PANEL_IDS.PROCESS_REVIEW)!;
    config = togglePanelVisibilityInConfig(config, WORKSTATION_PANEL_IDS.WATCHLIST)!;
    // Catalogue order: account, perf, review, watchlist.
    expect(config.hiddenPanels).toEqual([
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
    expect(validateWorkstationViewConfig(config)).toEqual([]);
  });

  it('shows a default-hidden panel by appending a right-rail row at the grid end', () => {
    // Performance template hides watchlist + process-review by default and
    // has no watchlist cells in its base grid — so showing it appends a
    // rail row rather than restoring in place.
    expect(PERFORMANCE.hiddenPanels).toContain(WORKSTATION_PANEL_IDS.WATCHLIST);
    const next = togglePanelVisibilityInConfig(PERFORMANCE, WORKSTATION_PANEL_IDS.WATCHLIST);
    expect(next).not.toBeNull();
    expect(next!.hiddenPanels).toEqual([WORKSTATION_PANEL_IDS.PROCESS_REVIEW]);
    // The new rail row sits at the end of the grid (the dense catalogue
    // removed the v1 fixed KPI band that previously anchored these rows).
    expect(next!.areas[next!.areas.length - 1]).toEqual([
      '.',
      '.',
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
    expect(validateWorkstationViewConfig(next)).toEqual([]);
  });

  it('shows every hidden panel of the performance template (grid grows by rail rows)', () => {
    let config = PERFORMANCE;
    for (const id of [WORKSTATION_PANEL_IDS.WATCHLIST, WORKSTATION_PANEL_IDS.PROCESS_REVIEW]) {
      const next = togglePanelVisibilityInConfig(config, id);
      expect(next).not.toBeNull();
      config = next!;
    }
    expect(config.hiddenPanels).toEqual([]);
    expect(config.areas.length).toBe(PERFORMANCE.areas.length + 2);
    expect(validateWorkstationViewConfig(config)).toEqual([]);
  });

  it('hide/show round-trips a template-region panel back to the exact base grid', () => {
    // Risk & Positions starts with Watchlist hidden. Showing then hiding it
    // returns exactly to the curated base; showing it again restores the
    // same full-width custom row.
    const shown = togglePanelVisibilityInConfig(RISK_POSITIONS, WORKSTATION_PANEL_IDS.WATCHLIST)!;
    const hidden = togglePanelVisibilityInConfig(shown, WORKSTATION_PANEL_IDS.WATCHLIST)!;
    expect(workstationConfigsEqual(hidden, RISK_POSITIONS)).toBe(true);
    const restored = togglePanelVisibilityInConfig(hidden, WORKSTATION_PANEL_IDS.WATCHLIST);
    expect(restored).not.toBeNull();
    expect(workstationConfigsEqual(restored!, shown)).toBe(true);
  });

  it('repeated hide/show cycles of a default-hidden panel do not grow the grid', () => {
    let config = PERFORMANCE;
    for (let i = 0; i < 5; i++) {
      config = togglePanelVisibilityInConfig(config, WORKSTATION_PANEL_IDS.WATCHLIST)!;
      config = togglePanelVisibilityInConfig(config, WORKSTATION_PANEL_IDS.WATCHLIST)!;
    }
    // After 5 full cycles the grid is back to the base size (no ghost rows)
    // and the hidden set is semantically identical (order normalizes to
    // catalogue order: review before watchlist).
    expect(config.areas.length).toBe(PERFORMANCE.areas.length);
    expect(new Set(config.hiddenPanels)).toEqual(new Set(PERFORMANCE.hiddenPanels));
    expect(config.hiddenPanels).toEqual([
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
    expect(validateWorkstationViewConfig(config)).toEqual([]);
  });

  it('returns null for fixed panels (risk, trades)', () => {
    expect(
      togglePanelVisibilityInConfig(RISK_POSITIONS, WORKSTATION_PANEL_IDS.RISK),
    ).toBeNull();
    expect(
      togglePanelVisibilityInConfig(RISK_POSITIONS, WORKSTATION_PANEL_IDS.TRADES),
    ).toBeNull();
  });

  it('returns null for an id outside the approved catalogue', () => {
    // @ts-expect-error — deliberately passing an unknown id through the unknown surface.
    expect(togglePanelVisibilityInConfig(RISK_POSITIONS, 'hacker-panel')).toBeNull();
  });

  it('falls back to a rail row when the template region is out of bounds', () => {
    // A 1-column grid cannot host the watchlist at its risk-positions region
    // ([4][1] does not exist), so the show falls back to a rail row at the
    // end of the grid — the grid stays rectangular and valid.
    const next = togglePanelVisibilityInConfig(
      undersizedConfig(),
      WORKSTATION_PANEL_IDS.WATCHLIST,
    );
    expect(next).not.toBeNull();
    expect(next!.areas[next!.areas.length - 1]).toEqual([WORKSTATION_PANEL_IDS.WATCHLIST]);
    expect(next!.hiddenPanels).not.toContain(WORKSTATION_PANEL_IDS.WATCHLIST);
    expect(validateWorkstationViewConfig(next)).toEqual([]);
  });

  it('does not mutate the input config', () => {
    const before = JSON.stringify(RISK_POSITIONS);
    const next = togglePanelVisibilityInConfig(RISK_POSITIONS, WORKSTATION_PANEL_IDS.ACCOUNT);
    expect(next).not.toBeNull();
    expect(JSON.stringify(RISK_POSITIONS)).toBe(before);
    expect(next!.hiddenPanels).toEqual([
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
  });
});

// ── Pure helper: workstationConfigsEqual ────────────────────────────────

describe('workstationConfigsEqual', () => {
  it('detects equal configs and structural differences', () => {
    expect(workstationConfigsEqual(RISK_POSITIONS, createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS))).toBe(true);
    expect(workstationConfigsEqual(RISK_POSITIONS, PERFORMANCE)).toBe(false);
    const hiddenWatchlist = togglePanelVisibilityInConfig(RISK_POSITIONS, WORKSTATION_PANEL_IDS.WATCHLIST)!;
    expect(workstationConfigsEqual(RISK_POSITIONS, hiddenWatchlist)).toBe(false);
  });
});

// ── Hook: session lifecycle ────────────────────────────────────────────

describe('useCustomizeMode', () => {
  it('starts idle: not customizing, no draft, not dirty, no undo, no hidden panels', () => {
    const { result } = renderHook(() => useCustomizeMode());
    expect(result.current.isCustomizing).toBe(false);
    expect(result.current.draft).toBeNull();
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.hiddenOptionalPanels).toEqual([]);
  });

  it('enters customize mode with a deep-copied draft (source mutations do not leak)', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => {
      result.current.enterCustomize(RISK_POSITIONS);
    });
    expect(result.current.isCustomizing).toBe(true);
    expect(result.current.draft).toEqual(RISK_POSITIONS);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);

    // Mutating the caller's source config must not affect the draft.
    act(() => {
      RISK_POSITIONS.areas[1][2] = '.';
      RISK_POSITIONS.hiddenPanels.push(WORKSTATION_PANEL_IDS.PROCESS_REVIEW);
    });
    expect(result.current.draft!.areas[1][2]).toBe(WORKSTATION_PANEL_IDS.PROCESS_REVIEW);
    expect(result.current.draft!.hiddenPanels).toEqual([WORKSTATION_PANEL_IDS.WATCHLIST]);
    // Restore fixture for later tests.
    RISK_POSITIONS.areas[1][2] = WORKSTATION_PANEL_IDS.PROCESS_REVIEW;
    RISK_POSITIONS.hiddenPanels = [WORKSTATION_PANEL_IDS.WATCHLIST];
  });

  it('toggle hides an optional panel, marks dirty, and enables undo', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.ACCOUNT));

    expect(result.current.isDirty).toBe(true);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.hiddenOptionalPanels).toEqual([
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
    expect(result.current.draft!.areas[1][0]).toBe('.');
    expect(validateWorkstationViewConfig(result.current.draft!)).toEqual([]);
  });

  it('toggle on a fixed panel is a no-op (no undo entry, not dirty)', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.RISK));

    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.hiddenOptionalPanels).toEqual([WORKSTATION_PANEL_IDS.WATCHLIST]);
  });

  it('undo restores the previous draft and is exhausted after one step', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.ACCOUNT));
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.PERFORMANCE));

    // Two edits → two undo levels.
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.draft!.hiddenPanels).toEqual([
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
    expect(result.current.draft!.areas[1][1]).toBe(WORKSTATION_PANEL_IDS.PERFORMANCE);

    act(() => result.current.undo());
    expect(result.current.draft!.hiddenPanels).toEqual([WORKSTATION_PANEL_IDS.WATCHLIST]);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
  });

  it('undo on an empty history is a no-op', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.undo());
    expect(result.current.draft).toEqual(RISK_POSITIONS);
    expect(result.current.canUndo).toBe(false);
  });

  it('reset restores the template base grid and is undoable', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.ACCOUNT));

    act(() => result.current.resetDraft());
    expect(result.current.draft!.hiddenPanels).toEqual([WORKSTATION_PANEL_IDS.WATCHLIST]);
    // The full grid is back to the template base.
    expect(workstationConfigsEqual(result.current.draft!, RISK_POSITIONS)).toBe(true);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(true);

    // Undo after reset returns to the pre-reset draft (catalogue order).
    act(() => result.current.undo());
    expect(result.current.draft!.hiddenPanels).toEqual([
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
  });

  it('reset on an already-template draft is a no-op (no undo entry)', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.resetDraft());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it('cancel discards the draft and exits without persisting anything', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.ACCOUNT));
    act(() => result.current.cancel());

    expect(result.current.isCustomizing).toBe(false);
    expect(result.current.draft).toBeNull();
    expect(result.current.hiddenOptionalPanels).toEqual([]);
    expect(result.current.canUndo).toBe(false);
  });

  it('save returns the draft config (a clone) and exits the session', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.ACCOUNT));

    let saved: WorkstationViewConfig | null = null;
    act(() => {
      saved = result.current.save();
    });

    expect(saved).not.toBeNull();
    expect(saved!.hiddenPanels).toEqual([
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
    expect(saved!.areas[1][0]).toBe('.');
    // The returned config is a clone — mutating it cannot affect the hook.
    act(() => {
      saved!.areas[1][0] = WORKSTATION_PANEL_IDS.ACCOUNT;
    });
    expect(result.current.isCustomizing).toBe(false);
    expect(result.current.draft).toBeNull();
    expect(result.current.isDirty).toBe(false);
  });

  it('save outside a session returns null', () => {
    const { result } = renderHook(() => useCustomizeMode());
    let saved: WorkstationViewConfig | null = null;
    act(() => {
      saved = result.current.save();
    });
    expect(saved).toBeNull();
  });

  it('toggles outside a session are no-ops', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.WATCHLIST));
    expect(result.current.isCustomizing).toBe(false);
    expect(result.current.draft).toBeNull();
  });

  it('entering twice replaces the session (fresh base and history)', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.WATCHLIST));
    act(() => result.current.enterCustomize(PERFORMANCE));

    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    // The draft is the session-normalized (catalogue-order) hidden set.
    expect(result.current.draft!.hiddenPanels).toEqual([
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
      WORKSTATION_PANEL_IDS.WATCHLIST,
    ]);
  });

  it('a long editing session cannot grow the undo stack past the cap', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    // 25 alternating hide/show edits — far more than the 20-entry cap.
    for (let i = 0; i < 25; i++) {
      act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.WATCHLIST));
    }
    // History is bounded; undo still works and terminates.
    for (let i = 0; i < 25; i++) {
      act(() => result.current.undo());
    }
    expect(result.current.canUndo).toBe(false);
    // 25 alternating toggles push 25 states; the cap keeps the last 20, so
    // 20 undos drain the stack and the draft settles on the state after the
    // first 5 toggles (Watchlist shown after the odd number of toggles).
    expect(result.current.draft!.hiddenPanels).toEqual([]);
    expect(validateWorkstationViewConfig(result.current.draft!)).toEqual([]);
  });
});

// ── Arrangement fixtures ───────────────────────────────────────────────

describe('arrangement fixtures', () => {
  it('the preserved 2-column fixture is a valid v2 config without a layout', () => {
    expect(validateWorkstationViewConfig(LEGACY_PRESERVED)).toEqual([]);
    expect(LEGACY_PRESERVED.layout).toBeUndefined();
    expect(validateWorkstationViewConfig(legacyWithHiddenRail())).toEqual([]);
  });
});

// ── Pure helper: canonicalLayoutForConfig ──────────────────────────────

describe('canonicalLayoutForConfig', () => {
  it('derives the areas-consistent layout for a dense config', () => {
    const layout = canonicalLayoutForConfig(RISK_POSITIONS);
    expect(layout).toBeDefined();
    expect(layout).toEqual(RISK_POSITIONS.layout);
    expect(deriveLayoutFromAreas(RISK_POSITIONS.areas)).toEqual(layout);
    expect(validateWorkstationViewConfig({ ...RISK_POSITIONS, layout })).toEqual([]);
  });

  it('returns undefined for a preserved 2-column view (fixed panels not full-width)', () => {
    expect(canonicalLayoutForConfig(LEGACY_PRESERVED)).toBeUndefined();
  });

  it('normalizes a stale layout that disagrees with areas back to the areas truth', () => {
    const stale = {
      ...RISK_POSITIONS,
      layout: RISK_POSITIONS.layout!.map((item) =>
        item.i === WORKSTATION_PANEL_IDS.ACCOUNT ? { ...item, x: 2 } : item,
      ),
    };
    const layout = canonicalLayoutForConfig(stale)!;
    const account = layout.find((item) => item.i === WORKSTATION_PANEL_IDS.ACCOUNT)!;
    expect(account.x).toBe(0);
    expect(validateWorkstationViewConfig({ ...stale, layout })).toEqual([]);
  });
});

// ── Pure helper: normalizeArrangementLayout ────────────────────────────

describe('normalizeArrangementLayout', () => {
  it('commits a summary-row move and keeps the config catalogue-valid', () => {
    // account ↔ perf swap within the summary row (RGL pushes displaced
    // panels during drags — this is the final non-overlapping layout).
    const raw = [
      rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
      rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 2, 3, 3),
      rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 1, 1, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 0, 1, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 2, 1, 1, 1),
    ];
    const next = normalizeArrangementLayout(RISK_POSITIONS, raw);
    expect(next).not.toBeNull();
    expect(next!.areas[1]).toEqual([
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    ]);
    expect(next!.hiddenPanels).toEqual(RISK_POSITIONS.hiddenPanels);
    expect(validateWorkstationViewConfig(next)).toEqual([]);
  });

  it('clamps a resize wider than the catalogue maxW', () => {
    // PERFORMANCE has a slack cell at [1][2]; growing account to w=5 clamps
    // to maxW=3 and fills the summary row without colliding.
    const raw = [
      rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
      rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 2, 3, 3),
      rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 0, 1, 5, 1),
      rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 0, 3, 3, 2),
    ];
    const next = normalizeArrangementLayout(PERFORMANCE, raw);
    expect(next).not.toBeNull();
    const account = next!.layout!.find((item) => item.i === WORKSTATION_PANEL_IDS.ACCOUNT)!;
    expect(account.w).toBe(3);
    expect(next!.areas[1]).toEqual([
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.ACCOUNT,
    ]);
    expect(validateWorkstationViewConfig(next)).toEqual([]);
  });

  it('clamps spans below the catalogue minimums', () => {
    const raw = [
      rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
      rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 2, 3, 3),
      rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 0, 1, 0, 0),
      rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 1, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 2, 1, 1, 1),
    ];
    const next = normalizeArrangementLayout(RISK_POSITIONS, raw);
    expect(next).not.toBeNull();
    const account = next!.layout!.find((item) => item.i === WORKSTATION_PANEL_IDS.ACCOUNT)!;
    expect(account.w).toBe(1);
    expect(account.h).toBe(1);
    expect(validateWorkstationViewConfig(next)).toEqual([]);
  });

  it('keeps fixed anchors locked full-width at the left edge regardless of raw input', () => {
    const raw = [
      rawItem(WORKSTATION_PANEL_IDS.RISK, 1, 1, 1, 1), // hostile: moved + shrunk
      rawItem(WORKSTATION_PANEL_IDS.TRADES, 2, 0, 2, 2),
      rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 0, 1, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 1, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 2, 1, 1, 1),
    ];
    const next = normalizeArrangementLayout(RISK_POSITIONS, raw);
    expect(next).not.toBeNull();
    const risk = next!.layout!.find((item) => item.i === WORKSTATION_PANEL_IDS.RISK)!;
    const trades = next!.layout!.find((item) => item.i === WORKSTATION_PANEL_IDS.TRADES)!;
    expect(risk).toMatchObject({ x: 0, y: 0, w: 3, h: 1 });
    expect(trades).toMatchObject({ x: 0, y: 2, w: 3, h: 1 });
    expect(next!.areas[0]).toEqual(['risk', 'risk', 'risk']);
    expect(validateWorkstationViewConfig(next)).toEqual([]);
  });

  it('ignores items for hidden panels and unknown ids', () => {
    const raw = [
      rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
      rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 2, 3, 3),
      rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 0, 1, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 1, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 2, 1, 1, 1),
      // Watchlist is hidden in RISK_POSITIONS — its item must not be placed.
      rawItem(WORKSTATION_PANEL_IDS.WATCHLIST, 0, 3, 3, 1),
      // @ts-expect-error — unknown id through the untrusted surface.
      rawItem('hacker-panel', 0, 0, 1, 1),
    ];
    const next = normalizeArrangementLayout(RISK_POSITIONS, raw);
    expect(next).not.toBeNull();
    expect(next!.areas.length).toBe(3); // risk / summary / trades — watchlist placed nothing
    expect(next!.layout!.some((item) => item.i === WORKSTATION_PANEL_IDS.WATCHLIST)).toBe(false);
    expect(validateWorkstationViewConfig(next)).toEqual([]);
  });

  it('falls back to the current arrangement when raw items are missing', () => {
    const next = normalizeArrangementLayout(RISK_POSITIONS, []);
    expect(next).not.toBeNull();
    expect(next!.areas).toEqual(RISK_POSITIONS.areas);
    expect(validateWorkstationViewConfig(next)).toEqual([]);
  });

  it('rejects (null) a placement that collides with the fixed trades workspace', () => {
    // account growing into the trades band is impossible — the fixed anchor
    // is never pushed, so the arrangement is rejected as a whole.
    const raw = [
      rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
      rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 2, 3, 3),
      rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 0, 1, 3, 3), // rows 1-3 → collides row 2
      rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 1, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 2, 1, 1, 1),
    ];
    expect(normalizeArrangementLayout(RISK_POSITIONS, raw)).toBeNull();
  });

  it('upgrades a preserved 2-column view to the dense model when its rail is hidden', () => {
    const raw = [
      rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
      rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 1, 3, 4),
    ];
    const next = normalizeArrangementLayout(legacyWithHiddenRail(), raw);
    expect(next).not.toBeNull();
    expect(next!.areas[0]).toEqual(['risk', 'risk', 'risk']);
    expect(next!.areas[1]).toEqual(['trades', 'trades', 'trades']);
    expect(next!.hiddenPanels).toEqual(['account', 'perf', 'review', 'watchlist']);
    expect(validateWorkstationViewConfig(next)).toEqual([]);
  });

  it('rejects (null) an upgrade whose rail panels collide with the trades anchor', () => {
    // LEGACY_PRESERVED keeps account/perf/review/watchlist in the right
    // rail; dense normalization extends trades to full width, so the rail
    // panels collide with the fixed anchor and the upgrade is rejected.
    const raw = [
      rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
      rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 1, 3, 4),
      rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 1, 1, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 2, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 1, 3, 1, 1),
      rawItem(WORKSTATION_PANEL_IDS.WATCHLIST, 1, 4, 1, 1),
    ];
    expect(normalizeArrangementLayout(LEGACY_PRESERVED, raw)).toBeNull();
  });
});

// ── Hook: arrangement actions (M017/S04-T01) ───────────────────────────

describe('useCustomizeMode arrangement actions', () => {
  /** account ↔ perf swap in the summary row — a valid non-overlapping layout. */
  const movedLayout = (): WorkstationLayoutItem[] => [
    rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
    rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 2, 3, 3),
    rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 1, 1, 1, 1),
    rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 0, 1, 1, 1),
    rawItem(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 2, 1, 1, 1),
  ];

  it('applyLayout commits a move: dirty, undoable, and catalogue-consistent', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.applyLayout(movedLayout()));

    expect(result.current.isDirty).toBe(true);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.draft!.areas[1]).toEqual([
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    ]);
    expectConsistentDraft(result.current.draft!);
  });

  it('applyLayout with an unchanged arrangement is a no-op (not dirty, no undo)', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.applyLayout(RISK_POSITIONS.layout ?? []));
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.draft!.areas).toEqual(RISK_POSITIONS.areas);
  });

  it('applyLayout outside a session is a no-op', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.applyLayout(movedLayout()));
    expect(result.current.isCustomizing).toBe(false);
    expect(result.current.draft).toBeNull();
  });

  it('applyLayout with an invalid placement is a no-op (draft untouched)', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    // account growing into the fixed trades workspace → rejected as a whole.
    act(() =>
      result.current.applyLayout([
        rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
        rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 2, 3, 3),
        rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 0, 1, 3, 3),
        rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 1, 1, 1),
        rawItem(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 2, 1, 1, 1),
      ]),
    );
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.draft!.areas).toEqual(RISK_POSITIONS.areas);
  });

  it('undo after applyLayout restores the pre-arrangement draft', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.applyLayout(movedLayout()));
    act(() => result.current.undo());
    expect(result.current.draft!.areas).toEqual(RISK_POSITIONS.areas);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
  });

  it('toggle then applyLayout keeps the draft layout consistent at every step', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.WATCHLIST));
    // The toggle re-derived the layout — watchlist now has a full-width item.
    const watchlist = result.current.draft!.layout!.find(
      (item) => item.i === WORKSTATION_PANEL_IDS.WATCHLIST,
    );
    expect(watchlist).toBeDefined();
    expectConsistentDraft(result.current.draft!);

    // A move that keeps watchlist visible at its row and swaps the summary row.
    act(() =>
      result.current.applyLayout([
        rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
        rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 2, 3, 3),
        rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 1, 1, 1, 1),
        rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 0, 1, 1, 1),
        rawItem(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 2, 1, 1, 1),
        rawItem(WORKSTATION_PANEL_IDS.WATCHLIST, 0, 5, 3, 1),
      ]),
    );
    expect(result.current.draft!.hiddenPanels).toEqual([]);
    expectConsistentDraft(result.current.draft!);
  });

  it('reset after arrangement returns to the template; undo restores the arrangement', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.applyLayout(movedLayout()));
    act(() => result.current.resetDraft());
    expect(workstationConfigsEqual(result.current.draft!, RISK_POSITIONS)).toBe(true);
    expectConsistentDraft(result.current.draft!);
    act(() => result.current.undo());
    expect(result.current.draft!.areas[1]).toEqual([
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    ]);
    expectConsistentDraft(result.current.draft!);
  });

  it('save returns the arranged draft and exits; cancel discards it', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.applyLayout(movedLayout()));
    let saved: WorkstationViewConfig | null = null;
    act(() => {
      saved = result.current.save();
    });
    expect(saved).not.toBeNull();
    expect(saved!.areas[1]).toEqual([
      WORKSTATION_PANEL_IDS.PERFORMANCE,
      WORKSTATION_PANEL_IDS.ACCOUNT,
      WORKSTATION_PANEL_IDS.PROCESS_REVIEW,
    ]);
    expect(validateWorkstationViewConfig(saved!)).toEqual([]);

    act(() => result.current.enterCustomize(RISK_POSITIONS));
    act(() => result.current.applyLayout(movedLayout()));
    act(() => result.current.cancel());
    expect(result.current.isCustomizing).toBe(false);
    expect(result.current.draft).toBeNull();
  });

  it('applyLayout on a preserved 2-column draft upgrades it to the dense model', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(legacyWithHiddenRail()));
    // The preserved view keeps its 2-column areas and no layout on entry.
    expect(result.current.draft!.layout).toBeUndefined();
    expect(result.current.isDirty).toBe(false);

    act(() =>
      result.current.applyLayout([
        rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
        rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 1, 3, 4),
      ]),
    );
    expect(result.current.isDirty).toBe(true);
    expect(result.current.draft!.areas[0]).toEqual(['risk', 'risk', 'risk']);
    expect(result.current.draft!.areas[1]).toEqual(['trades', 'trades', 'trades']);
    expectConsistentDraft(result.current.draft!);
  });

  it('an unrepresentable arrangement on a legacy draft is rejected without state change', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(LEGACY_PRESERVED));
    act(() =>
      result.current.applyLayout([
        rawItem(WORKSTATION_PANEL_IDS.RISK, 0, 0, 3, 1),
        rawItem(WORKSTATION_PANEL_IDS.TRADES, 0, 1, 3, 4),
        rawItem(WORKSTATION_PANEL_IDS.ACCOUNT, 1, 1, 1, 1),
        rawItem(WORKSTATION_PANEL_IDS.PERFORMANCE, 1, 2, 1, 1),
        rawItem(WORKSTATION_PANEL_IDS.PROCESS_REVIEW, 1, 3, 1, 1),
        rawItem(WORKSTATION_PANEL_IDS.WATCHLIST, 1, 4, 1, 1),
      ]),
    );
    expect(result.current.isDirty).toBe(false);
    expect(result.current.draft!.areas).toEqual(LEGACY_PRESERVED.areas);
    expect(validateWorkstationViewConfig(result.current.draft!)).toEqual([]);
  });

  it('enter normalizes a stale persisted layout to the areas truth without marking dirty', () => {
    const stale = {
      ...RISK_POSITIONS,
      layout: RISK_POSITIONS.layout!.map((item) =>
        item.i === WORKSTATION_PANEL_IDS.ACCOUNT ? { ...item, x: 2 } : item,
      ),
    };
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(stale));
    const account = result.current.draft!.layout!.find(
      (item) => item.i === WORKSTATION_PANEL_IDS.ACCOUNT,
    )!;
    expect(account.x).toBe(0);
    expect(result.current.isDirty).toBe(false);
    expectConsistentDraft(result.current.draft!);
  });

  it('the draft layout stays consistent with areas across a mixed session', () => {
    const { result } = renderHook(() => useCustomizeMode());
    act(() => result.current.enterCustomize(RISK_POSITIONS));
    expectConsistentDraft(result.current.draft!);
    act(() => result.current.togglePanelVisibility(WORKSTATION_PANEL_IDS.WATCHLIST));
    expectConsistentDraft(result.current.draft!);
    act(() => result.current.applyLayout(movedLayout()));
    expectConsistentDraft(result.current.draft!);
    act(() => result.current.resetDraft());
    expectConsistentDraft(result.current.draft!);
    act(() => result.current.undo());
    expectConsistentDraft(result.current.draft!);
  });
});

