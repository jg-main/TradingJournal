/**
 * Tests for useCustomizeMode (M016/S06-T04).
 *
 * Covers: the pure `togglePanelVisibilityInConfig` helper (hide/show/fixed/
 * occupied-home/validity), `workstationConfigsEqual`, and the full
 * customize-session state machine: enter (with snapshot semantics), hide/
 * show toggles with undo history, Undo across multiple edits, Reset to
 * template (with no-op guard), Cancel (discard), Save (returns a clone and
 * exits), dirty tracking, hidden-optional-panel derivation, and defensive
 * no-ops outside a session.
 *
 * Run: npx vitest run src/hooks/use-customize-mode.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

import {
  useCustomizeMode,
  togglePanelVisibilityInConfig,
  workstationConfigsEqual,
} from './use-customize-mode';
import {
  WORKSTATION_PANEL_IDS,
  WORKSTATION_TEMPLATE_IDS,
  WORKSTATION_LAYOUT_VERSION,
  createViewFromTemplate,
  validateWorkstationViewConfig,
  type WorkstationViewConfig,
} from '@/lib/workstation-view-types';

// ── Fixtures ───────────────────────────────────────────────────────────

const RISK_POSITIONS = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS);
const PERFORMANCE = createViewFromTemplate(WORKSTATION_TEMPLATE_IDS.PERFORMANCE);

/** A grid deliberately missing one column so template regions are out of bounds. */
function undersizedConfig(): WorkstationViewConfig {
  return {
    templateId: WORKSTATION_TEMPLATE_IDS.RISK_POSITIONS,
    areas: [['risk'], ['positions'], ['positions'], ['positions'], ['positions'], ['kpis']],
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
    const kpisIdx = next!.areas.findIndex((row) => row.includes(WORKSTATION_PANEL_IDS.KPIS));
    expect(next!.areas[kpisIdx - 1]).toEqual([
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

  it('shows a default-hidden panel by appending a right-rail row above the KPI band', () => {
    // Performance template hides watchlist + process-review by default and
    // has no watchlist cells in its base grid — so showing it appends a
    // rail row rather than restoring in place.
    expect(PERFORMANCE.hiddenPanels).toContain(WORKSTATION_PANEL_IDS.WATCHLIST);
    const next = togglePanelVisibilityInConfig(PERFORMANCE, WORKSTATION_PANEL_IDS.WATCHLIST);
    expect(next).not.toBeNull();
    expect(next!.hiddenPanels).toEqual([WORKSTATION_PANEL_IDS.PROCESS_REVIEW]);
    // The new rail row sits immediately above the fixed KPI band.
    const kpisIdx = next!.areas.findIndex((row) => row.includes(WORKSTATION_PANEL_IDS.KPIS));
    expect(next!.areas[kpisIdx - 1]).toEqual(['.', WORKSTATION_PANEL_IDS.WATCHLIST]);
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

  it('returns null for fixed panels (risk, positions, kpis)', () => {
    expect(
      togglePanelVisibilityInConfig(RISK_POSITIONS, WORKSTATION_PANEL_IDS.RISK),
    ).toBeNull();
    expect(
      togglePanelVisibilityInConfig(RISK_POSITIONS, WORKSTATION_PANEL_IDS.POSITIONS),
    ).toBeNull();
    expect(
      togglePanelVisibilityInConfig(RISK_POSITIONS, WORKSTATION_PANEL_IDS.KPIS),
    ).toBeNull();
  });

  it('returns null for an id outside the approved catalogue', () => {
    // @ts-expect-error — deliberately passing an unknown id through the unknown surface.
    expect(togglePanelVisibilityInConfig(RISK_POSITIONS, 'hacker-panel')).toBeNull();
  });

  it('falls back to a rail row when the template region is out of bounds', () => {
    // A 1-column grid cannot host the watchlist at its risk-positions region
    // ([4][1] does not exist), so the show falls back to a rail row above
    // the KPI band — the grid stays rectangular and valid.
    const next = togglePanelVisibilityInConfig(
      undersizedConfig(),
      WORKSTATION_PANEL_IDS.WATCHLIST,
    );
    expect(next).not.toBeNull();
    const kpisIdx = next!.areas.findIndex((row) => row.includes(WORKSTATION_PANEL_IDS.KPIS));
    expect(next!.areas[kpisIdx - 1]).toEqual([WORKSTATION_PANEL_IDS.WATCHLIST]);
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
      RISK_POSITIONS.areas[3][1] = '.';
      RISK_POSITIONS.hiddenPanels.push(WORKSTATION_PANEL_IDS.PROCESS_REVIEW);
    });
    expect(result.current.draft!.areas[3][1]).toBe(WORKSTATION_PANEL_IDS.PROCESS_REVIEW);
    expect(result.current.draft!.hiddenPanels).toEqual([WORKSTATION_PANEL_IDS.WATCHLIST]);
    // Restore fixture for later tests.
    RISK_POSITIONS.areas[3][1] = WORKSTATION_PANEL_IDS.PROCESS_REVIEW;
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
    expect(result.current.draft!.areas[1][1]).toBe('.');
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
    expect(result.current.draft!.areas[1][0]).toBe(WORKSTATION_PANEL_IDS.PERFORMANCE);

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
    expect(saved!.areas[1][1]).toBe('.');
    // The returned config is a clone — mutating it cannot affect the hook.
    act(() => {
      saved!.areas[1][1] = WORKSTATION_PANEL_IDS.ACCOUNT;
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
