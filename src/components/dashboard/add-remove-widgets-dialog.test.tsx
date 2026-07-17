/**
 * Tests for the AddRemoveWidgetsDialog component.
 *
 * Covers: sheet open/close state, widget listing by category, toggle
 * switch state from hiddenWidgetIds, toggle callback invocation,
 * accessibility attributes on toggles, and all 13 registered widgets
 * appearing in the correct category groups.
 *
 * Run: npx vitest run src/components/dashboard/add-remove-widgets-dialog.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AddRemoveWidgetsDialog } from './add-remove-widgets-dialog';

// ═══════════════════════════════════════════════════════════════════════════
// Setup / Teardown
// ═══════════════════════════════════════════════════════════════════════════

afterEach(() => {
  cleanup();
});

function renderDialog(props: Partial<Parameters<typeof AddRemoveWidgetsDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onToggleWidget = vi.fn();

  const result = render(
    <AddRemoveWidgetsDialog
      open={true}
      onOpenChange={onOpenChange}
      hiddenWidgetIds={[]}
      onToggleWidget={onToggleWidget}
      {...props}
    />,
  );

  return { onOpenChange, onToggleWidget, ...result };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('AddRemoveWidgetsDialog', () => {
  // ── Open State ────────────────────────────────────────────────────

  it('renders content when open is true', () => {
    renderDialog({ open: true });
    expect(screen.getByText('Widgets')).toBeTruthy();
    expect(
      screen.getByText('Show or hide dashboard widgets. Changes apply when you save.'),
    ).toBeTruthy();
  });

  it('does not render content when open is false', () => {
    renderDialog({ open: false });
    // The Sheet should not be reachable — radix-ui portal renders only when open
    expect(screen.queryByText('Widgets')).toBeNull();
  });

  // ── Category Groups ───────────────────────────────────────────────

  it('renders all three category headers', () => {
    renderDialog({ open: true });
    expect(screen.getByText('Metrics')).toBeTruthy();
    expect(screen.getByText('Charts')).toBeTruthy();
    expect(screen.getByText('Valuation')).toBeTruthy();
  });

  it('renders all 13 registered widgets', () => {
    renderDialog({ open: true });
    // Metrics (3)
    expect(screen.getByText('Account Performance')).toBeTruthy();
    expect(screen.getByText('PTD Performance')).toBeTruthy();
    expect(screen.getByText('Current Risk')).toBeTruthy();
    // Charts (9)
    expect(screen.getByText('Equity & Drawdown')).toBeTruthy();
    expect(screen.getByText('Calendar Heatmap')).toBeTruthy();
    expect(screen.getByText('Setup Ranking')).toBeTruthy();
    expect(screen.getByText('Process Discipline')).toBeTruthy();
    expect(screen.getByText('Monthly Performance')).toBeTruthy();
    expect(screen.getByText('R Distribution')).toBeTruthy();
    expect(screen.getByText('Period Comparison')).toBeTruthy();
    expect(screen.getByText('Attention Insights')).toBeTruthy();
    expect(screen.getByText('Directional Performance')).toBeTruthy();
    // Valuation (1)
    expect(screen.getByText('Valuation Positions')).toBeTruthy();
  });

  // ── Widgets ordered correctly within categories ───────────────────

  it('places widgets in the correct category groups', () => {
    renderDialog({ open: true });

    // Metrics row: use data-testid
    expect(screen.getByTestId('widget-row-account-performance')).toBeTruthy();
    expect(screen.getByTestId('widget-row-current-risk')).toBeTruthy();

    // Charts row
    expect(screen.getByTestId('widget-row-equity-drawdown')).toBeTruthy();
    expect(screen.getByTestId('widget-row-calendar-heatmap')).toBeTruthy();
    expect(screen.getByTestId('widget-row-directional-performance')).toBeTruthy();

    // Valuation row
    expect(screen.getByTestId('widget-row-valuation-positions')).toBeTruthy();
  });

  // ── Toggle Switch State ───────────────────────────────────────────

  it('toggles are checked (visible) when hiddenWidgetIds is empty', () => {
    renderDialog({ open: true, hiddenWidgetIds: [] });

    const toggle = screen.getByTestId('toggle-account-performance');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('toggles are unchecked (hidden) for IDs in hiddenWidgetIds', () => {
    renderDialog({
      open: true,
      hiddenWidgetIds: ['account-performance', 'calendar-heatmap'],
    });

    const hiddenToggle = screen.getByTestId('toggle-account-performance');
    expect(hiddenToggle.getAttribute('aria-checked')).toBe('false');

    const hiddenToggle2 = screen.getByTestId('toggle-calendar-heatmap');
    expect(hiddenToggle2.getAttribute('aria-checked')).toBe('false');
  });

  it('toggles remain checked for widgets NOT in hiddenWidgetIds', () => {
    renderDialog({
      open: true,
      hiddenWidgetIds: ['calendar-heatmap'],
    });

    // account-performance is NOT hidden
    const visibleToggle = screen.getByTestId('toggle-account-performance');
    expect(visibleToggle.getAttribute('aria-checked')).toBe('true');

    // calendar-heatmap IS hidden
    const hiddenToggle = screen.getByTestId('toggle-calendar-heatmap');
    expect(hiddenToggle.getAttribute('aria-checked')).toBe('false');
  });

  // ── Toggle Callback ───────────────────────────────────────────────

  it('calls onToggleWidget with the widget ID when a toggle is clicked', async () => {
    const user = userEvent.setup();
    const onToggleWidget = vi.fn();

    renderDialog({ open: true, onToggleWidget });

    const toggle = screen.getByTestId('toggle-current-risk');
    await user.click(toggle);

    expect(onToggleWidget).toHaveBeenCalledTimes(1);
    expect(onToggleWidget).toHaveBeenCalledWith('current-risk');
  });

  it('calls onToggleWidget for a chart widget', async () => {
    const user = userEvent.setup();
    const onToggleWidget = vi.fn();

    renderDialog({ open: true, onToggleWidget });

    await user.click(screen.getByTestId('toggle-equity-drawdown'));
    expect(onToggleWidget).toHaveBeenCalledWith('equity-drawdown');
  });

  it('calls onToggleWidget for a valuation widget', async () => {
    const user = userEvent.setup();
    const onToggleWidget = vi.fn();

    renderDialog({ open: true, onToggleWidget });

    await user.click(screen.getByTestId('toggle-valuation-positions'));
    expect(onToggleWidget).toHaveBeenCalledWith('valuation-positions');
  });

  it('handles multiple toggles correctly', async () => {
    const user = userEvent.setup();
    const onToggleWidget = vi.fn();

    renderDialog({ open: true, onToggleWidget });

    await user.click(screen.getByTestId('toggle-account-performance'));
    await user.click(screen.getByTestId('toggle-ptd-performance'));
    await user.click(screen.getByTestId('toggle-current-risk'));

    expect(onToggleWidget).toHaveBeenCalledTimes(3);
    expect(onToggleWidget).toHaveBeenNthCalledWith(1, 'account-performance');
    expect(onToggleWidget).toHaveBeenNthCalledWith(2, 'ptd-performance');
    expect(onToggleWidget).toHaveBeenNthCalledWith(3, 'current-risk');
  });

  // ── Accessibility ─────────────────────────────────────────────────

  it('toggle switches have role="switch" and aria-checked', () => {
    renderDialog({ open: true, hiddenWidgetIds: ['current-risk'] });

    const visibleToggle = screen.getByTestId('toggle-account-performance');
    expect(visibleToggle.getAttribute('role')).toBe('switch');
    expect(visibleToggle.getAttribute('aria-checked')).toBe('true');

    const hiddenToggle = screen.getByTestId('toggle-current-risk');
    expect(hiddenToggle.getAttribute('role')).toBe('switch');
    expect(hiddenToggle.getAttribute('aria-checked')).toBe('false');
  });

  it('toggle switches are focusable', () => {
    renderDialog({ open: true });

    const toggle = screen.getByTestId('toggle-account-performance');
    expect(toggle.getAttribute('tabindex')).toBeNull(); // buttons are natively focusable
    expect(toggle.tagName).toBe('BUTTON');
  });

  // ── Snapshot: all widgets present ─────────────────────────────────

  it('renders the correct number of toggle switches (13)', () => {
    renderDialog({ open: true });
    const toggles = screen.getAllByRole('switch');
    expect(toggles.length).toBe(13);
  });

  // ── Edge Cases ───────────────────────────────────────────────────—

  it('works with all widgets hidden', () => {
    const allIds = [
      'account-performance',
      'ptd-performance',
      'current-risk',
      'equity-drawdown',
      'calendar-heatmap',
      'setup-ranking',
      'process-discipline',
      'monthly-performance',
      'r-distribution',
      'period-matrix',
      'attention-insights',
      'directional-performance',
      'valuation-positions',
    ];

    renderDialog({ open: true, hiddenWidgetIds: allIds });

    // All toggles should be aria-checked="false"
    const toggles = screen.getAllByRole('switch');
    toggles.forEach((t) => {
      expect(t.getAttribute('aria-checked')).toBe('false');
    });
  });
});
