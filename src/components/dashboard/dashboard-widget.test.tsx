/**
 * Tests for the DashboardWidget component.
 *
 * Covers: title rendering, loading state, error state, empty state,
 * content rendering, drag handle presence, and className passthrough.
 *
 * Run: npx vitest run src/components/dashboard/dashboard-widget.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { DashboardWidget } from './dashboard-widget';

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('DashboardWidget', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Title ───────────────────────────────────────────────────────

  it('renders the title in the card header', () => {
    render(
      <DashboardWidget title="Net P&L">
        <span>$2,500</span>
      </DashboardWidget>,
    );
    expect(screen.getByText('Net P&L')).toBeTruthy();
  });

  // ── Content ─────────────────────────────────────────────────────

  it('renders children content by default', () => {
    render(
      <DashboardWidget title="Widget">
        <div data-testid="content">Hello World</div>
      </DashboardWidget>,
    );
    expect(screen.getByTestId('content')).toBeTruthy();
    expect(screen.getByText('Hello World')).toBeTruthy();
  });

  // ── Loading state ───────────────────────────────────────────────

  it('shows skeleton elements when isLoading is true', () => {
    const { container } = render(
      <DashboardWidget title="Loading Widget" isLoading>
        <span>Should not render</span>
      </DashboardWidget>,
    );
    // Should have skeleton elements (animate-pulse class)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    // Children should not be visible when loading
    expect(screen.queryByText('Should not render')).toBeNull();
  });

  it('shows aria-busy when loading', () => {
    render(
      <DashboardWidget title="Aria Busy" isLoading>
        <span />
      </DashboardWidget>,
    );
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).toBeTruthy();
  });

  // ── Error state ─────────────────────────────────────────────────

  it('shows error message and alert role when error is provided', () => {
    render(
      <DashboardWidget title="Error Widget" error="Something went wrong">
        <span>Should not render</span>
      </DashboardWidget>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.queryByText('Should not render')).toBeNull();
    // Should have role="alert"
    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeTruthy();
  });

  it('prioritises error over loading', () => {
    // When both error and loading are set, error should win
    render(
      <DashboardWidget title="Priority" isLoading error="Error wins">
        <span />
      </DashboardWidget>,
    );
    expect(screen.getByText('Error wins')).toBeTruthy();
  });

  // ── Empty state ─────────────────────────────────────────────────

  it('shows default empty message when isEmpty is true', () => {
    render(
      <DashboardWidget title="Empty Widget" isEmpty>
        <span>Should not render</span>
      </DashboardWidget>,
    );
    expect(screen.getByText('No data available')).toBeTruthy();
    expect(screen.queryByText('Should not render')).toBeNull();
  });

  it('shows custom empty message when provided', () => {
    render(
      <DashboardWidget title="Custom Empty" isEmpty emptyMessage="No trades found">
        <span />
      </DashboardWidget>,
    );
    expect(screen.getByText('No trades found')).toBeTruthy();
  });

  // ── Drag handle ─────────────────────────────────────────────────

  it('renders the drag handle element when isCustomizing is true', () => {
    const { container } = render(
      <DashboardWidget title="Draggable" isCustomizing>
        <span />
      </DashboardWidget>,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeTruthy();
  });

  it('hides the drag handle when isCustomizing is false (default)', () => {
    const { container } = render(
      <DashboardWidget title="Locked">
        <span />
      </DashboardWidget>,
    );
    const dragHandle = container.querySelector('.dashboard-widget-drag-handle');
    expect(dragHandle).toBeFalsy();
  });

  it('drag handle has accessible label and role when visible', () => {
    render(
      <DashboardWidget title="Accessible" isCustomizing>
        <span />
      </DashboardWidget>,
    );
    const handle = screen.getByLabelText('Drag to reorder');
    expect(handle).toBeTruthy();
    expect(handle.getAttribute('role')).toBe('button');
  });

  // ── ClassName passthrough ───────────────────────────────────────

  it('passes className to the card wrapper', () => {
    const { container } = render(
      <DashboardWidget title="Styled" className="extra-class">
        <span />
      </DashboardWidget>,
    );
    const card = container.querySelector('[data-slot="card"]');
    expect(card?.classList.contains('extra-class')).toBe(true);
  });

  // ── testId ──────────────────────────────────────────────────────

  it('sets data-testid attribute when provided', () => {
    render(
      <DashboardWidget title="Test ID" testId="widget-net-pnl">
        <span />
      </DashboardWidget>,
    );
    expect(screen.getByTestId('widget-net-pnl')).toBeTruthy();
  });

  // ── Error is null (no error shown) ──────────────────────────────

  it('renders content when error is null', () => {
    render(
      <DashboardWidget title="No Error" error={null}>
        <span>Happy path</span>
      </DashboardWidget>,
    );
    expect(screen.getByText('Happy path')).toBeTruthy();
  });
});
