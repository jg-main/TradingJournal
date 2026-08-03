/**
 * Tests for the useChartPalette / useChartTheme hooks.
 *
 * Covers: light theme default, dark theme reactivity via MutationObserver
 * on documentElement class changes, and reversion back to light.
 *
 * Run: npx vitest run src/hooks/use-chart-palette.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';
import { useChartPalette, useChartTheme } from './use-chart-palette';
import { chartPalette } from '@/lib/chart-palette';

// ── Probe component ─────────────────────────────────────────────────────

function PaletteProbe() {
  const theme = useChartTheme();
  const palette = useChartPalette();
  return (
    <div>
      <span data-testid="probe-theme">{theme}</span>
      <span data-testid="probe-primary">{palette.primary}</span>
    </div>
  );
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('useChartPalette', () => {
  afterEach(() => {
    cleanup();
    // Restore the light theme so later tests start from a clean slate
    document.documentElement.classList.remove('dark');
  });

  it('resolves the light palette when no dark class is present', () => {
    document.documentElement.classList.remove('dark');
    render(<PaletteProbe />);
    expect(screen.getByTestId('probe-theme').textContent).toBe('light');
    expect(screen.getByTestId('probe-primary').textContent).toBe(
      chartPalette.light.primary,
    );
  });

  it('re-renders with the dark palette when the dark class is added', async () => {
    render(<PaletteProbe />);
    expect(screen.getByTestId('probe-theme').textContent).toBe('light');

    // MutationObserver delivers callbacks asynchronously (microtask), so the
    // mutation must be wrapped in async act to flush them.
    await act(async () => {
      document.documentElement.classList.add('dark');
    });

    expect(screen.getByTestId('probe-theme').textContent).toBe('dark');
    expect(screen.getByTestId('probe-primary').textContent).toBe(
      chartPalette.dark.primary,
    );
  });

  it('reverts to the light palette when the dark class is removed', async () => {
    document.documentElement.classList.add('dark');
    render(<PaletteProbe />);
    expect(screen.getByTestId('probe-theme').textContent).toBe('dark');

    await act(async () => {
      document.documentElement.classList.remove('dark');
    });

    expect(screen.getByTestId('probe-theme').textContent).toBe('light');
    expect(screen.getByTestId('probe-primary').textContent).toBe(
      chartPalette.light.primary,
    );
  });
});
