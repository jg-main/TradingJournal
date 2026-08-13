/**
 * Tests for the CustomizeBar component (M016/S06-T04).
 *
 * Covers: bar chrome (view name title, unsaved-changes indicator), Show
 * chips for hidden optional panels (and the all-visible note), the fixed
 * panels note (risk / positions / kpis are never listed as toggleable),
 * Undo/Save disabled-state logic, and every action callback firing with the
 * right argument. Uses core Vitest matchers (no jest-dom) matching the
 * established workstation test convention.
 *
 * Run: npx vitest run src/components/workstation/customize-bar.test.tsx
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { CustomizeBar, type CustomizeBarProps } from './customize-bar';
import { WORKSTATION_PANEL_IDS } from '@/lib/workstation-view-types';

// ── Fixtures ───────────────────────────────────────────────────────────

function renderBar(overrides: Partial<CustomizeBarProps> = {}) {
  const props: CustomizeBarProps = {
    viewName: 'My Custom View',
    hiddenOptionalPanels: [],
    canUndo: false,
    isDirty: false,
    arrangeMode: false,
    onToggleArrangeMode: vi.fn(),
    onTogglePanel: vi.fn(),
    onUndo: vi.fn(),
    onReset: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  const utils = render(<CustomizeBar {...props} />);
  return { ...utils, props };
}

/** textContent helper — the repo avoids jest-dom matchers. */
function textOf(testId: string): string {
  return screen.getByTestId(testId).textContent ?? '';
}

/** Whether a testid element is a disabled button. */
function isDisabled(testId: string): boolean {
  const el = screen.getByTestId(testId) as HTMLButtonElement;
  return el.disabled;
}

// ── Setup / Teardown ───────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('CustomizeBar', () => {
  it('renders the bar with the view name being edited', () => {
    renderBar({ viewName: 'Weekly Focus' });
    expect(screen.getByTestId('ws-customize-bar')).toBeTruthy();
    expect(textOf('ws-customize-title')).toBe('Customizing: Weekly Focus');
  });

  it('shows the unsaved-changes indicator only when dirty', () => {
    const { rerender } = renderBar({ isDirty: false });
    expect(screen.queryByTestId('ws-customize-dirty')).toBeNull();

    rerender(
      <CustomizeBar
        viewName="V"
        hiddenOptionalPanels={[]}
        canUndo={false}
        isDirty={true}
        arrangeMode={false}
        onToggleArrangeMode={vi.fn()}
        onTogglePanel={vi.fn()}
        onUndo={vi.fn()}
        onReset={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(textOf('ws-customize-dirty')).toBe('Unsaved changes');
  });

  it('renders Show chips for each hidden optional panel with its catalogue title', () => {
    renderBar({
      hiddenOptionalPanels: [
        WORKSTATION_PANEL_IDS.WATCHLIST,
        WORKSTATION_PANEL_IDS.PERFORMANCE,
      ],
    });
    expect(textOf('ws-customize-show-watchlist')).toContain('Show Watchlist');
    expect(textOf('ws-customize-show-perf')).toContain('Show Performance');
  });

  it('renders the all-visible note when no optional panel is hidden', () => {
    renderBar({ hiddenOptionalPanels: [] });
    expect(textOf('ws-customize-all-visible')).toBe('All optional panels visible');
    expect(screen.queryByTestId('ws-customize-show-watchlist')).toBeNull();
  });

  it('never lists the fixed safety/data-quality panels as toggleable', () => {
    // Fixed panels cannot be hidden by the session, so the bar must never
    // offer a Show chip for them even when passed (defensive).
    renderBar({
      hiddenOptionalPanels: [
        WORKSTATION_PANEL_IDS.RISK,
        WORKSTATION_PANEL_IDS.WATCHLIST,
      ],
    });
    expect(screen.queryByTestId('ws-customize-show-risk')).toBeNull();
    expect(screen.getByTestId('ws-customize-show-watchlist')).toBeTruthy();
  });

  it('renders the fixed-panels note naming risk / positions / kpis', () => {
    renderBar();
    expect(textOf('ws-customize-fixed-note')).toBe(
      'Risk · Open Positions · Period KPIs are always visible',
    );
  });

  it('disables Undo without history and enables it with history', () => {
    const { rerender } = renderBar({ canUndo: false });
    expect(isDisabled('ws-customize-undo')).toBe(true);

    rerender(
      <CustomizeBar
        viewName="V"
        hiddenOptionalPanels={[]}
        canUndo={true}
        isDirty={true}
        arrangeMode={false}
        onToggleArrangeMode={vi.fn()}
        onTogglePanel={vi.fn()}
        onUndo={vi.fn()}
        onReset={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(isDisabled('ws-customize-undo')).toBe(false);
  });

  it('disables Save when the draft is not dirty and enables it when dirty', () => {
    const { rerender } = renderBar({ isDirty: false });
    expect(isDisabled('ws-customize-save')).toBe(true);

    rerender(
      <CustomizeBar
        viewName="V"
        hiddenOptionalPanels={[]}
        canUndo={false}
        isDirty={true}
        arrangeMode={false}
        onToggleArrangeMode={vi.fn()}
        onTogglePanel={vi.fn()}
        onUndo={vi.fn()}
        onReset={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(isDisabled('ws-customize-save')).toBe(false);
  });

  it('fires onTogglePanel with the panel id when a Show chip is clicked', async () => {
    const user = userEvent.setup();
    const onTogglePanel = vi.fn();
    renderBar({
      hiddenOptionalPanels: [WORKSTATION_PANEL_IDS.WATCHLIST],
      onTogglePanel,
    });
    await user.click(screen.getByTestId('ws-customize-show-watchlist'));
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
    expect(onTogglePanel).toHaveBeenCalledWith(WORKSTATION_PANEL_IDS.WATCHLIST);
  });

  it('fires the Undo / Reset / Cancel / Save callbacks', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const onReset = vi.fn();
    const onCancel = vi.fn();
    const onSave = vi.fn();
    renderBar({ canUndo: true, isDirty: true, onUndo, onReset, onCancel, onSave });

    await user.click(screen.getByTestId('ws-customize-undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('ws-customize-reset'));
    expect(onReset).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('ws-customize-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('ws-customize-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not fire disabled actions (Save with no changes)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderBar({ isDirty: false, onSave });
    await user.click(screen.getByTestId('ws-customize-save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  // ── Arrange-mode toggle (M017/S04) ──────────────────────────────────

  it('renders the Arrange toggle and fires onToggleArrangeMode on click', async () => {
    const user = userEvent.setup();
    const onToggleArrangeMode = vi.fn();
    renderBar({ onToggleArrangeMode });

    const toggle = screen.getByTestId('ws-customize-arrange-toggle');
    expect(textOf('ws-customize-arrange-toggle')).toContain('Arrange');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    await user.click(toggle);
    expect(onToggleArrangeMode).toHaveBeenCalledTimes(1);
  });

  it('reflects active arrange mode with aria-pressed and the keyboard hint', () => {
    renderBar({ arrangeMode: true });
    expect(screen.getByTestId('ws-customize-arrange-toggle').getAttribute('aria-pressed')).toBe(
      'true',
    );
    // The hint names the keyboard equivalents (move / grow-shrink / exit).
    expect(textOf('ws-arrange-hint')).toContain('Arrow');
    expect(textOf('ws-arrange-hint')).toContain('Shift+Arrow');
  });

  it('hides the arrange keyboard hint when arrange mode is off', () => {
    renderBar({ arrangeMode: false });
    expect(screen.queryByTestId('ws-arrange-hint')).toBeNull();
  });

  it('keeps the editing actions (Undo/Reset/Cancel/Save) present in arrange mode', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const onSave = vi.fn();
    renderBar({ arrangeMode: true, canUndo: true, isDirty: true, onUndo, onSave });

    await user.click(screen.getByTestId('ws-customize-undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ws-customize-save')).toBeTruthy();
    expect(screen.getByTestId('ws-customize-cancel')).toBeTruthy();
  });
});
