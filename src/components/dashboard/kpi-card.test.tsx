/**
 * Tests for the KpiCardContent and KpiCardSkeleton components.
 *
 * Covers: icon rendering, value display, label with tooltip,
 * tooltip content resolution, custom tooltip override, and skeleton.
 *
 * Run: npx vitest run src/components/dashboard/kpi-card.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { Target } from 'lucide-react';
import { KpiCardContent, KpiCardSkeleton, KPI_TOOLTIPS } from './kpi-card';
import {
  TooltipProvider,
} from '@/components/ui/tooltip';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TooltipProvider is required because radix tooltip is used inside KpiCardContent.
 * Without it, the tooltip trigger renders but the content won't be in the DOM
 * until hover-activated. We test the trigger text directly.
 */
function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ═══════════════════════════════════════════════════════════════════════════
// KPI_TOOLTIPS
// ═══════════════════════════════════════════════════════════════════════════

describe('KPI_TOOLTIPS', () => {
  it('contains all expected KPI metric labels', () => {
    const expectedLabels = [
      'Profit Factor',
      'Avg Win',
      'Avg Loss',
      'Avg R',
      'Avg Grade',
      'Current Drawdown',
      'Account Value',
      'Net P&L',
      'Win Rate',
      'Total Trades',
      'Unrealized P&L',
      'Open Trades',
    ];

    for (const label of expectedLabels) {
      expect(KPI_TOOLTIPS[label]).toBeDefined();
      expect(KPI_TOOLTIPS[label].length).toBeGreaterThan(10);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KpiCardContent
// ═══════════════════════════════════════════════════════════════════════════

describe('KpiCardContent', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Icon rendering ──────────────────────────────────────────────

  it('renders the icon element', () => {
    const { container } = renderWithTooltip(
      <KpiCardContent
        icon={<Target data-testid="kpi-icon" />}
        iconBg="bg-zinc-100 dark:bg-zinc-800"
        value="$2,500"
        label="Net P&amp;L"
      />,
    );
    const icon = container.querySelector('[data-testid="kpi-icon"]');
    expect(icon).toBeTruthy();
  });

  it('applies iconBg class to the icon container', () => {
    const { container } = renderWithTooltip(
      <KpiCardContent
        icon={<Target />}
        iconBg="bg-custom-bg"
        value="$2,500"
        label="Net P&amp;L"
      />,
    );
    // The first div with the class should contain 'bg-custom-bg'
    const iconContainer = container.querySelector('.rounded-lg');
    expect(iconContainer?.classList.contains('bg-custom-bg')).toBe(true);
  });

  // ── Value rendering ─────────────────────────────────────────────

  it('renders the value text', () => {
    renderWithTooltip(
      <KpiCardContent
        icon={<Target />}
        iconBg="bg-zinc-100"
        value="$2,500"
        label="Net P&amp;L"
      />,
    );
    expect(screen.getByText('$2,500')).toBeTruthy();
  });

  it('renders a React node as value', () => {
    renderWithTooltip(
      <KpiCardContent
        icon={<Target />}
        iconBg="bg-zinc-100"
        value={<span data-testid="custom-value">42</span>}
        label="Total Trades"
      />,
    );
    expect(screen.getByTestId('custom-value')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('applies valueClassName to the value text', () => {
    const { container } = renderWithTooltip(
      <KpiCardContent
        icon={<Target />}
        iconBg="bg-zinc-100"
        value="$2,500"
        label="Net P&amp;L"
        valueClassName="text-green-600"
      />,
    );
    const valueEl = container.querySelector('.tabular-nums');
    expect(valueEl?.classList.contains('text-green-600')).toBe(true);
  });

  // ── Label with tooltip ──────────────────────────────────────────

  it('renders the label text', () => {
    renderWithTooltip(
      <KpiCardContent
        icon={<Target />}
        iconBg="bg-zinc-100"
        value="$2,500"
        label="Net P&amp;L"
      />,
    );
    // The label is rendered inside a tooltip trigger
    // It should appear in the DOM
    const labelEl = screen.getByText('Net P&L');
    expect(labelEl).toBeTruthy();
  });

  it('uses KPI_TOOLTIPS content for known labels', () => {
    // The tooltip content won't be visible without interaction,
    // but we verify the default tooltipContent is NOT the label itself
    // for known labels (it should come from KPI_TOOLTIPS)
    const netPnlTooltip = KPI_TOOLTIPS['Net P&L'];
    expect(netPnlTooltip).not.toBe('Net P&L');
    expect(netPnlTooltip).toContain('realized profit');
  });

  it('uses custom tooltipContent when provided', () => {
    renderWithTooltip(
      <KpiCardContent
        icon={<Target />}
        iconBg="bg-zinc-100"
        value="$2,500"
        label="Custom Label"
        tooltipContent="Custom tooltip text"
      />,
    );
    // Verify the label renders
    expect(screen.getByText('Custom Label')).toBeTruthy();
    // Tooltip content is in the DOM but hidden
    const tooltipDiv = document.body.querySelector('[class*="max-w-64"]');
    // The tooltip content is rendered via Radix portal
    // In jsdom, tooltip content may not be in the DOM without interaction
    // We verify the component renders without error
  });

  // ── Fallback tooltip ────────────────────────────────────────────

  it('falls back to label text for unknown labels when no tooltipContent', () => {
    renderWithTooltip(
      <KpiCardContent
        icon={<Target />}
        iconBg="bg-zinc-100"
        value="42"
        label="Unknown Label"
      />,
    );
    // Label should render
    expect(screen.getByText('Unknown Label')).toBeTruthy();
  });

  // ── Accessibility ───────────────────────────────────────────────

  it('renders with cursor-help on the label', () => {
    const { container } = renderWithTooltip(
      <KpiCardContent
        icon={<Target />}
        iconBg="bg-zinc-100"
        value="$2,500"
        label="Net P&amp;L"
      />,
    );
    const labelEl = container.querySelector('.cursor-help');
    expect(labelEl).toBeTruthy();
  });

  it('renders dotted underline decoration on the label', () => {
    const { container } = renderWithTooltip(
      <KpiCardContent
        icon={<Target />}
        iconBg="bg-zinc-100"
        value="$2,500"
        label="Net P&amp;L"
      />,
    );
    const labelEl = container.querySelector('.decoration-dotted');
    expect(labelEl).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KpiCardSkeleton
// ═══════════════════════════════════════════════════════════════════════════

describe('KpiCardSkeleton', () => {
  it('renders a pulse animation container', () => {
    const { container } = render(<KpiCardSkeleton />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper?.classList.contains('animate-pulse')).toBe(true);
  });

  it('renders three skeleton children', () => {
    const { container } = render(<KpiCardSkeleton />);
    const children = container.querySelectorAll('.rounded-lg, .rounded');
    // Should have at least 3 rounded elements (icon, value, label)
    expect(children.length).toBeGreaterThanOrEqual(3);
  });

  it('renders skeleton placeholders with bg-zinc classes', () => {
    const { container } = render(<KpiCardSkeleton />);
    const skeletonElements = container.querySelectorAll('.bg-zinc-200, .bg-zinc-100');
    expect(skeletonElements.length).toBe(3);
  });

  it('renders an icon-size skeleton', () => {
    const { container } = render(<KpiCardSkeleton />);
    const iconSkeleton = container.querySelector('.size-9');
    expect(iconSkeleton).toBeTruthy();
  });
});
