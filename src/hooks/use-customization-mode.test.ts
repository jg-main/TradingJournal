/**
 * Tests for the useCustomizationMode hook.
 *
 * Covers: default state, enter customization with snapshot, save/cancel/reset
 * lifecycle, visibility toggling, snapshot immutability, and idempotent exit.
 *
 * Run: npx vitest run src/hooks/use-customization-mode.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useCustomizationMode } from './use-customization-mode';
import type { LayoutItem } from 'react-grid-layout';

// ── Fixtures ───────────────────────────────────────────────────────────

const WIDGET_IDS = [
  'account-performance',
  'ptd-performance',
  'current-risk',
  'equity-drawdown',
  'calendar-heatmap',
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'account-performance', x: 0, y: 0, w: 12, h: 3 },
  { i: 'ptd-performance', x: 0, y: 3, w: 6, h: 4 },
  { i: 'current-risk', x: 6, y: 3, w: 6, h: 4 },
  { i: 'equity-drawdown', x: 0, y: 7, w: 12, h: 5 },
  { i: 'calendar-heatmap', x: 0, y: 12, w: 12, h: 6 },
];

const EDITED_LAYOUT: LayoutItem[] = [
  { i: 'ptd-performance', x: 0, y: 0, w: 12, h: 4 },
  { i: 'account-performance', x: 0, y: 4, w: 6, h: 3 },
  { i: 'current-risk', x: 6, y: 4, w: 6, h: 4 },
  { i: 'calendar-heatmap', x: 0, y: 8, w: 12, h: 6 },
  { i: 'equity-drawdown', x: 0, y: 14, w: 12, h: 5 },
];

const DEFAULT_OPTIONS = {
  defaultLayout: DEFAULT_LAYOUT,
  allWidgetIds: WIDGET_IDS,
};

// ── Setup / Teardown ───────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('useCustomizationMode', () => {
  // ── Default State ────────────────────────────────────────────────

  it('starts with isCustomizing false, no snapshot, empty hidden set', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    expect(result.current.isCustomizing).toBe(false);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.hiddenWidgetIds).toEqual([]);
  });

  // ── Enter Customization ──────────────────────────────────────────

  it('enters customization mode with a snapshot of the provided layout', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    expect(result.current.isCustomizing).toBe(true);
    expect(result.current.snapshot).toEqual(DEFAULT_LAYOUT);
    expect(result.current.hiddenWidgetIds).toEqual([]);
  });

  it('snapshot is a deep copy — mutating original does not affect snapshot', () => {
    const editable = DEFAULT_LAYOUT.map((item) => ({ ...item }));
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(editable);
    });

    // Mutate the original
    editable[0].x = 99;
    editable[0].y = 99;

    // Snapshot should retain original values
    expect(result.current.snapshot![0].x).toBe(0);
    expect(result.current.snapshot![0].y).toBe(0);
  });

  // ── Save ──────────────────────────────────────────────────────────

  it('saveCustomization returns the passed layout and hidden IDs, then exits', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    // Toggle a widget off
    act(() => {
      result.current.toggleWidgetVisibility('current-risk');
    });

    let saved: ReturnType<typeof result.current.saveCustomization> = null;
    act(() => {
      saved = result.current.saveCustomization(EDITED_LAYOUT);
    });

    // Returns the merged data
    expect(saved).toEqual({
      layout: EDITED_LAYOUT,
      hiddenWidgetIds: ['current-risk'],
    });

    // Exited customization mode
    expect(result.current.isCustomizing).toBe(false);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.hiddenWidgetIds).toEqual([]);
  });

  it('saveCustomization returns null when not in customization mode', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    let saved: ReturnType<typeof result.current.saveCustomization> = null;
    act(() => {
      saved = result.current.saveCustomization(DEFAULT_LAYOUT);
    });

    expect(saved).toBeNull();
  });

  it('saveCustomization returns a deep copy of the layout', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    let saved: ReturnType<typeof result.current.saveCustomization> = null;
    act(() => {
      saved = result.current.saveCustomization(DEFAULT_LAYOUT);
    });

    // Mutating the returned layout should not affect anything
    saved!.layout[0].x = 999;

    expect(saved!.layout[0].x).toBe(999);
    // State is reset, no leftover reference
    expect(result.current.snapshot).toBeNull();
  });

  // ── Cancel ────────────────────────────────────────────────────────

  it('cancelCustomization returns the snapshot and exits', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    // Toggle some widgets
    act(() => {
      result.current.toggleWidgetVisibility('equity-drawdown');
      result.current.toggleWidgetVisibility('calendar-heatmap');
    });

    let restored: ReturnType<typeof result.current.cancelCustomization> = null;
    act(() => {
      restored = result.current.cancelCustomization();
    });

    // Returns the snapshot (pre-edit state)
    expect(restored).toEqual(DEFAULT_LAYOUT);

    // Exited customization mode
    expect(result.current.isCustomizing).toBe(false);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.hiddenWidgetIds).toEqual([]);
  });

  it('cancelCustomization returns null when not customizing', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    let restored: ReturnType<typeof result.current.cancelCustomization> = null;
    act(() => {
      restored = result.current.cancelCustomization();
    });

    expect(restored).toBeNull();
  });

  it('cancelCustomization returns a deep copy of the snapshot', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    let restored: ReturnType<typeof result.current.cancelCustomization> = null;
    act(() => {
      restored = result.current.cancelCustomization();
    });

    // Mutate the returned array — should not affect anything
    restored![0].w = 99;

    // Re-entering customization is independent
    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    expect(result.current.snapshot![0].w).toBe(12);
  });

  // ── Reset ─────────────────────────────────────────────────────────

  it('resetToDefaults returns the default layout and exits', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(EDITED_LAYOUT);
    });

    // Toggle some widgets
    act(() => {
      result.current.toggleWidgetVisibility('account-performance');
    });

    let defaults: ReturnType<typeof result.current.resetToDefaults> = [];
    act(() => {
      defaults = result.current.resetToDefaults();
    });

    // Returns the original default layout from options
    expect(defaults).toEqual(DEFAULT_LAYOUT);

    // Exited customization mode
    expect(result.current.isCustomizing).toBe(false);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.hiddenWidgetIds).toEqual([]);
  });

  it('resetToDefaults returns a deep copy (not same reference)', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    let defaults: ReturnType<typeof result.current.resetToDefaults> = [];
    act(() => {
      defaults = result.current.resetToDefaults();
    });

    // Should not be the same reference as DEFAULT_OPTIONS.defaultLayout
    defaults[0].x = 999;

    // Re-entering with the default should show the original default values
    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    expect(result.current.snapshot![0].x).toBe(0);
  });

  // ── Toggle Visibility ─────────────────────────────────────────────

  it('toggleWidgetVisibility adds a widget to hidden set', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    act(() => {
      result.current.toggleWidgetVisibility('ptd-performance');
    });

    expect(result.current.hiddenWidgetIds).toEqual(['ptd-performance']);
  });

  it('toggleWidgetVisibility removes a widget from hidden set (toggle off)', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    act(() => {
      result.current.toggleWidgetVisibility('ptd-performance');
    });
    expect(result.current.hiddenWidgetIds).toEqual(['ptd-performance']);

    // Toggle it again — should be removed from hidden
    act(() => {
      result.current.toggleWidgetVisibility('ptd-performance');
    });
    expect(result.current.hiddenWidgetIds).toEqual([]);
  });

  it('toggleWidgetVisibility allows multiple hidden widgets', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    act(() => {
      result.current.toggleWidgetVisibility('ptd-performance');
      result.current.toggleWidgetVisibility('current-risk');
      result.current.toggleWidgetVisibility('calendar-heatmap');
    });

    expect(result.current.hiddenWidgetIds).toEqual([
      'ptd-performance',
      'current-risk',
      'calendar-heatmap',
    ]);
  });

  it('toggleWidgetVisibility is a no-op when not in customization mode', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.toggleWidgetVisibility('ptd-performance');
    });

    // hiddenWidgetIds should remain empty — no customization active
    expect(result.current.hiddenWidgetIds).toEqual([]);
    expect(result.current.isCustomizing).toBe(false);
  });

  // ── Lifecycle: Enter → Toggle → Save → Enter again (idempotent) ──

  it('supports multiple enter→customize→exit cycles', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    // Cycle 1
    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });
    expect(result.current.isCustomizing).toBe(true);

    act(() => {
      result.current.toggleWidgetVisibility('equity-drawdown');
    });
    expect(result.current.hiddenWidgetIds).toEqual(['equity-drawdown']);

    act(() => {
      result.current.saveCustomization(DEFAULT_LAYOUT);
    });
    expect(result.current.isCustomizing).toBe(false);

    // Cycle 2
    act(() => {
      result.current.enterCustomization(EDITED_LAYOUT);
    });
    expect(result.current.isCustomizing).toBe(true);
    expect(result.current.snapshot).toEqual(EDITED_LAYOUT);

    act(() => {
      result.current.toggleWidgetVisibility('calendar-heatmap');
    });
    expect(result.current.hiddenWidgetIds).toEqual(['calendar-heatmap']);

    act(() => {
      result.current.cancelCustomization();
    });
    expect(result.current.isCustomizing).toBe(false);

    // Cycle 3 — reset
    act(() => {
      result.current.enterCustomization(EDITED_LAYOUT);
    });
    expect(result.current.isCustomizing).toBe(true);

    act(() => {
      result.current.resetToDefaults();
    });
    expect(result.current.isCustomizing).toBe(false);
  });

  // ── Edge Cases ───────────────────────────────────────────────────

  it('saveCustomization returns hidden IDs accumulated during the session', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(DEFAULT_LAYOUT);
    });

    // Toggle several widgets in sequence
    act(() => {
      result.current.toggleWidgetVisibility('current-risk');
    });
    act(() => {
      result.current.toggleWidgetVisibility('equity-drawdown');
    });

    let saved: ReturnType<typeof result.current.saveCustomization> = null;
    act(() => {
      saved = result.current.saveCustomization(DEFAULT_LAYOUT);
    });

    // All toggles accumulated
    expect(saved!.hiddenWidgetIds).toEqual(['current-risk', 'equity-drawdown']);
  });

  it('cancel after entering with edited layout restores snapshot (not default)', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    act(() => {
      result.current.enterCustomization(EDITED_LAYOUT);
    });

    let restored: ReturnType<typeof result.current.cancelCustomization> = null;
    act(() => {
      restored = result.current.cancelCustomization();
    });

    // Should restore EDITED_LAYOUT (the snapshot), not DEFAULT_LAYOUT
    expect(restored).toEqual(EDITED_LAYOUT);
  });

  it('reset always returns the original default layout regardless of snapshot', () => {
    const { result } = renderHook(() =>
      useCustomizationMode(DEFAULT_OPTIONS),
    );

    // Enter with EDITED_LAYOUT but reset should return DEFAULT_LAYOUT
    act(() => {
      result.current.enterCustomization(EDITED_LAYOUT);
    });

    let defaults: ReturnType<typeof result.current.resetToDefaults> = [];
    act(() => {
      defaults = result.current.resetToDefaults();
    });

    expect(defaults).toEqual(DEFAULT_LAYOUT);
  });
});
