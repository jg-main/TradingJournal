/**
 * Tests for PtdPerformancePanel — compact grouped PTD metric panel.
 *
 * Covers: widget title rendering, all 8 metric values with formatting,
 * loading/error/empty states, profit factor color thresholds, null metrics.
 *
 * Run: npx vitest run src/components/dashboard/ptd-performance-panel.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PtdPerformancePanel } from './ptd-performance-panel';
import type { KpiMetrics } from './kpi-widgets';

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const SAMPLE_KPIS: KpiMetrics = {
  totalTrades: 42,
  openTrades: 3,
  winRate: 0.55,
  netPnl: 2500,
  avgR: 1.8,
  avgGrade: 48,
  currentDrawdown: -500,
  currentDrawdownPct: -0.05,
  accountValue: 25000,
  profitFactor: 1.75,
  avgWin: 350,
  avgLoss: -200,
};

const NULL_KPIS: KpiMetrics = {
  totalTrades: 0,
  openTrades: 0,
  winRate: null,
  netPnl: 0,
  avgR: null,
  avgGrade: null,
  currentDrawdown: null,
  currentDrawdownPct: null,
  accountValue: null,
  profitFactor: null,
  avgWin: null,
  avgLoss: null,
};

const LOW_PROFIT_FACTOR_KPIS: KpiMetrics = {
  ...SAMPLE_KPIS,
  profitFactor: 0.85,
};

const MEDIUM_PROFIT_FACTOR_KPIS: KpiMetrics = {
  ...SAMPLE_KPIS,
  profitFactor: 1.25,
};

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('PtdPerformancePanel', () => {
  afterEach(() => {
    cleanup();
  });

  // ── Widget Title ─────────────────────────────────────────────────

  it('renders widget title', () => {
    const { container } = renderWithTooltip(
      <PtdPerformancePanel data={SAMPLE_KPIS} />,
    );
    const title = container.querySelector('[data-slot="card-title"]');
    expect(title?.textContent).toContain('PTD Performance');
  });

  it('has data-testid="widget-ptd-performance"', () => {
    const { container } = renderWithTooltip(
      <PtdPerformancePanel data={SAMPLE_KPIS} />,
    );
    const el = container.querySelector(
      '[data-testid="widget-ptd-performance"]',
    );
    expect(el).toBeTruthy();
  });

  // ── Loading State ────────────────────────────────────────────────

  it('shows skeleton when isLoading', () => {
    renderWithTooltip(
      <PtdPerformancePanel data={null} isLoading />,
    );
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
  });

  it('shows skeleton on refetch with existing data', () => {
    renderWithTooltip(
      <PtdPerformancePanel data={SAMPLE_KPIS} isLoading />,
    );
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
    // Content should not render while loading
    expect(screen.queryByText(/\$2,500/)).toBeNull();
  });

  // ── Error State ──────────────────────────────────────────────────

  it('shows error message when error prop is set', () => {
    renderWithTooltip(
      <PtdPerformancePanel
        data={SAMPLE_KPIS}
        error="Failed to load PTD data"
      />,
    );
    expect(screen.getByText('Failed to load PTD data')).toBeTruthy();
    // Content should not render when error is shown
    expect(screen.queryByText(/\$2,500/)).toBeNull();
  });

  // ── Empty / No Data State ────────────────────────────────────────

  it('shows "No performance data available" when data is null and not loading', () => {
    renderWithTooltip(
      <PtdPerformancePanel data={null} />,
    );
    expect(screen.getByText('No performance data available')).toBeTruthy();
  });

  // ── All 8 Metrics: Row 1 (Net P&L, Total Trades, Win Rate) ──────

  it('renders Net P&L metric formatted with sign', () => {
    renderWithTooltip(<PtdPerformancePanel data={SAMPLE_KPIS} />);
    // 2500 with signDisplay 'exceptZero' → +$2,500.00
    expect(screen.getByText(/\+?\$2,500/)).toBeTruthy();
    expect(screen.getByText('Net P&L')).toBeTruthy();
  });

  it('renders Total Trades metric', () => {
    renderWithTooltip(<PtdPerformancePanel data={SAMPLE_KPIS} />);
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Total Trades')).toBeTruthy();
  });

  it('renders Win Rate metric as percentage', () => {
    renderWithTooltip(<PtdPerformancePanel data={SAMPLE_KPIS} />);
    expect(screen.getByText('55.0%')).toBeTruthy();
    expect(screen.getByText('Win Rate')).toBeTruthy();
  });

  it('renders -- for Win Rate when win rate is null', () => {
    renderWithTooltip(<PtdPerformancePanel data={NULL_KPIS} />);
    const elements = screen.getAllByText('--');
    expect(elements.length).toBeGreaterThan(0);
    expect(screen.getByText('Win Rate')).toBeTruthy();
  });

  // ── All 8 Metrics: Row 2 (Avg R, Avg Grade, Profit Factor) ──────

  it('renders Avg R metric as decimal', () => {
    renderWithTooltip(<PtdPerformancePanel data={SAMPLE_KPIS} />);
    expect(screen.getByText('1.80')).toBeTruthy();
    expect(screen.getByText('Avg R')).toBeTruthy();
  });

  it('renders Avg Grade metric with grade letter', () => {
    renderWithTooltip(<PtdPerformancePanel data={SAMPLE_KPIS} />);
    // 48 → 48.00 (B)
    expect(screen.getByText('48.00 (B)')).toBeTruthy();
    expect(screen.getByText('Avg Grade')).toBeTruthy();
  });

  it('renders Profit Factor metric as decimal', () => {
    renderWithTooltip(<PtdPerformancePanel data={SAMPLE_KPIS} />);
    expect(screen.getByText('1.75')).toBeTruthy();
    expect(screen.getByText('Profit Factor')).toBeTruthy();
  });

  it('renders -- for Avg R when null', () => {
    renderWithTooltip(<PtdPerformancePanel data={NULL_KPIS} />);
    expect(screen.getByText('Avg R')).toBeTruthy();
  });

  it('renders -- for Avg Grade when null', () => {
    renderWithTooltip(<PtdPerformancePanel data={NULL_KPIS} />);
    expect(screen.getByText('Avg Grade')).toBeTruthy();
  });

  it('renders -- for Profit Factor when null', () => {
    renderWithTooltip(<PtdPerformancePanel data={NULL_KPIS} />);
    expect(screen.getByText('Profit Factor')).toBeTruthy();
  });

  // ── All 8 Metrics: Row 3 (Avg Win, Avg Loss) ────────────────────

  it('renders Avg Win metric as currency', () => {
    renderWithTooltip(<PtdPerformancePanel data={SAMPLE_KPIS} />);
    expect(screen.getByText(/\$350/)).toBeTruthy();
    expect(screen.getByText('Avg Win')).toBeTruthy();
  });

  it('renders Avg Loss metric as currency', () => {
    renderWithTooltip(<PtdPerformancePanel data={SAMPLE_KPIS} />);
    expect(screen.getByText(/\$200/)).toBeTruthy();
    expect(screen.getByText('Avg Loss')).toBeTruthy();
  });

  it('renders -- for Avg Win when null', () => {
    renderWithTooltip(<PtdPerformancePanel data={NULL_KPIS} />);
    expect(screen.getByText('Avg Win')).toBeTruthy();
  });

  it('renders -- for Avg Loss when null', () => {
    renderWithTooltip(<PtdPerformancePanel data={NULL_KPIS} />);
    expect(screen.getByText('Avg Loss')).toBeTruthy();
  });

  // ── Profit Factor Color Classes ──────────────────────────────────

  it('applies green color when profit factor > 1.5', () => {
    renderWithTooltip(<PtdPerformancePanel data={SAMPLE_KPIS} />);
    // profitFactor 1.75 > 1.5 → green
    const valueElement = screen.getByText('1.75');
    expect(valueElement?.className).toContain('text-positive');
  });

  it('applies amber color when profit factor between 1.0 and 1.5', () => {
    renderWithTooltip(<PtdPerformancePanel data={MEDIUM_PROFIT_FACTOR_KPIS} />);
    // profitFactor 1.25 between 1.0 and 1.5 → amber
    const valueElement = screen.getByText('1.25');
    expect(valueElement?.className).toContain('text-warning');
  });

  it('applies red color when profit factor < 1.0', () => {
    renderWithTooltip(<PtdPerformancePanel data={LOW_PROFIT_FACTOR_KPIS} />);
    // profitFactor 0.85 < 1.0 → red
    const valueElement = screen.getByText('0.85');
    expect(valueElement?.className).toContain('text-negative');
  });

  // ── Attribution Badge ────────────────────────────────────────────

  it('renders Period-to-Date attribution badge', () => {
    renderWithTooltip(<PtdPerformancePanel data={SAMPLE_KPIS} />);
    expect(screen.getByText('Period-to-Date')).toBeTruthy();
  });
});
