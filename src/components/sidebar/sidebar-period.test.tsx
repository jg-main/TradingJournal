/**
 * Tests for the SidebarPeriod sidebar selector (M004/T9B).
 *
 * The selector consumes the canonical OperationalDateRangeProvider — it owns
 * no period state and no persistence (only transient Custom-edit draft UI).
 *
 * Run: npx vitest run src/components/sidebar/sidebar-period.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { SidebarPeriod } from './sidebar-period';
import { TooltipProvider } from '@/components/ui/tooltip';

// ── Mock the canonical provider (the real provider is covered separately) ─

const mockCtx = vi.hoisted(() => ({
  selection: { preset: 'YTD' as string, from: '' as string, to: '' as string },
  resolvedRange: { from: '2026-01-01' as string, to: '' as string },
  hydrated: true,
  setPreset: vi.fn(),
  setCustomRange: vi.fn(),
}));
vi.mock('@/lib/operational-date-range-context', () => ({
  useOperationalDateRange: () => mockCtx,
}));

// jsdom does not implement Element.prototype.scrollIntoView; Radix Popover
// may call it. Matches the repo pattern for radix overlays.
Element.prototype.scrollIntoView = () => {};

async function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: /Period:/ }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx.selection = { preset: 'YTD', from: '', to: '' };
  mockCtx.resolvedRange = { from: '2026-01-01', to: '' };
  mockCtx.hydrated = true;
});

afterEach(() => {
  cleanup();
});

describe('SidebarPeriod — expanded', () => {
  it('renders a loading placeholder before provider hydration', () => {
    mockCtx.hydrated = false;
    render(<SidebarPeriod />);
    expect(screen.getByTestId('sidebar-period-loading')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Period:/ })).toBeNull();
  });

  it('renders the current period on the trigger with an explicit accessible name', () => {
    render(<SidebarPeriod />);
    const trigger = screen.getByRole('button', { name: 'Period: YTD' });
    expect(trigger.textContent).toContain('YTD');
  });

  it('shows all canonical presets when opened', async () => {
    render(<SidebarPeriod />);
    await openPopover();
    for (const preset of ['Max', 'YTD', '1Y', '6M', '3M', 'MTD', '1M', 'Custom']) {
      expect(screen.getByTestId(`period-preset-${preset}`)).toBeTruthy();
    }
  });

  it('selecting a relative preset calls setPreset and closes the popover', async () => {
    render(<SidebarPeriod />);
    await openPopover();
    fireEvent.click(screen.getByTestId('period-preset-3M'));
    expect(mockCtx.setPreset).toHaveBeenCalledWith('3M');
    // Popover closes after selection.
    expect(screen.queryByTestId('period-preset-3M')).toBeNull();
  });

  it('marks the current preset as visually identifiable', async () => {
    render(<SidebarPeriod />);
    await openPopover();
    const current = screen.getByTestId('period-preset-YTD');
    const other = screen.getByTestId('period-preset-3M');
    expect(current.getAttribute('data-variant')).toBe('secondary');
    expect(other.getAttribute('data-variant')).toBe('ghost');
  });

  it('Custom reveals a transient From/To editor instead of committing state', async () => {
    render(<SidebarPeriod />);
    await openPopover();
    fireEvent.click(screen.getByTestId('period-preset-Custom'));
    expect(screen.getByLabelText('Custom period from')).toBeTruthy();
    expect(screen.getByLabelText('Custom period to')).toBeTruthy();
    expect(screen.getByTestId('period-custom-apply')).toBeTruthy();
    expect(screen.getByTestId('period-custom-cancel')).toBeTruthy();
    // Entering Custom edit mode must not commit global state.
    expect(mockCtx.setPreset).not.toHaveBeenCalled();
    expect(mockCtx.setCustomRange).not.toHaveBeenCalled();
  });

  it('initializes the Custom draft from the current global Custom selection', async () => {
    mockCtx.selection = { preset: 'Custom', from: '2026-03-01', to: '2026-04-30' };
    render(<SidebarPeriod />);
    await openPopover();
    fireEvent.click(screen.getByTestId('period-preset-Custom'));
    const from = screen.getByLabelText('Custom period from') as HTMLInputElement;
    const to = screen.getByLabelText('Custom period to') as HTMLInputElement;
    expect(from.value).toBe('2026-03-01');
    expect(to.value).toBe('2026-04-30');
  });

  it('invalid Custom (reversed) cannot Apply and shows a validation message', async () => {
    render(<SidebarPeriod />);
    await openPopover();
    fireEvent.click(screen.getByTestId('period-preset-Custom'));
    fireEvent.change(screen.getByLabelText('Custom period from'), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Custom period to'), { target: { value: '2026-01-01' } });
    const apply = screen.getByTestId('period-custom-apply') as HTMLButtonElement;
    expect(apply.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(mockCtx.setCustomRange).not.toHaveBeenCalled();
  });

  it('valid Custom calls setCustomRange and closes', async () => {
    render(<SidebarPeriod />);
    await openPopover();
    fireEvent.click(screen.getByTestId('period-preset-Custom'));
    fireEvent.change(screen.getByLabelText('Custom period from'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('Custom period to'), { target: { value: '2026-06-30' } });
    fireEvent.click(screen.getByTestId('period-custom-apply'));
    expect(mockCtx.setCustomRange).toHaveBeenCalledWith('2026-06-01', '2026-06-30');
    expect(screen.queryByLabelText('Custom period from')).toBeNull();
  });

  it('Cancel discards the draft and preserves the current global selection', async () => {
    render(<SidebarPeriod />);
    await openPopover();
    fireEvent.click(screen.getByTestId('period-preset-Custom'));
    fireEvent.change(screen.getByLabelText('Custom period from'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByTestId('period-custom-cancel'));
    expect(mockCtx.setCustomRange).not.toHaveBeenCalled();
    expect(mockCtx.setPreset).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Custom period from')).toBeNull();
  });
});

describe('SidebarPeriod — collapsed', () => {
  function renderCollapsed() {
    return render(
      <TooltipProvider>
        <SidebarPeriod collapsed />
      </TooltipProvider>,
    );
  }

  it('shows a compact icon trigger', () => {
    renderCollapsed();
    const trigger = screen.getByTestId('sidebar-period-collapsed-trigger');
    expect(trigger.getAttribute('aria-label')).toBe('Period: YTD');
  });

  it('identifies the current period via accessible label/tooltip', () => {
    renderCollapsed();
    const trigger = screen.getByRole('button', { name: 'Period: YTD' });
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-label')).toBe('Period: YTD');
  });

  it('collapsed opens the same selector interaction', async () => {
    renderCollapsed();
    await openPopover();
    expect(screen.getByTestId('period-preset-Custom')).toBeTruthy();
  });
});

describe('SidebarPeriod — ownership', () => {
  it('introduces no second persistence mechanism inside SidebarPeriod', () => {
    const source = readFileSync(resolve(__dirname, 'sidebar-period.tsx'), 'utf8');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('app:date-range');
    // All period state flows through the canonical provider hook.
    expect(source).toContain('useOperationalDateRange');
  });
});
