/**
 * Tests for the workstation ProcessReviewPanel.
 *
 * The panel is a pure consumer of WorkstationContext fixtures.dashboard:
 * processScoreDistribution, directionalPerformance, and attentionInsights.
 * These tests pin:
 *
 *   - process score distribution renders bins with counts
 *   - grade colour coding (A-B → ws-pos, C → '', D-F → ws-neg)
 *   - directional performance shows long/short with P&L colouring
 *   - attention items render with severity indicators, limited to top 3
 *   - panel header reads 'Review Metrics' (WORKSTATION_PANEL_CATALOGUE title)
 *   - empty/undefined data shows compact empty states
 *   - panel renders without crashing
 *
 * Run: npx vitest run src/components/workstation/process-review-panel.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import type { DashboardResponse } from '@/lib/workstation-fixtures';

// ── Mock workstation context ────────────────────────────────────────────

const mockUseWorkstation = vi.fn();

vi.mock('./workstation-context', () => ({
  useWorkstation: () => mockUseWorkstation(),
}));

import { ProcessReviewPanel } from './process-review-panel';

// ── Fixture helpers ─────────────────────────────────────────────────────

function minimalDashboard(
  overrides: Partial<DashboardResponse> = {},
): DashboardResponse {
  return {
    kpis: {} as DashboardResponse['kpis'],
    mtm: {} as DashboardResponse['mtm'],
    equityCurve: [],
    drawdown: [],
    monthlyPerformance: [],
    rDistribution: [],
    calendarHeatmap: [],
    periodMatrix: {},
    setupRanking: [],
    attentionInsights: { insights: [], tradeCount: 0 },
    ...overrides,
  };
}

function renderWithContext(dashboard: Partial<DashboardResponse>) {
  mockUseWorkstation.mockReturnValue({
    fixtures: { dashboard: minimalDashboard(dashboard) },
  });
  return render(<ProcessReviewPanel />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('ProcessReviewPanel', () => {
  it('renders without crashing', () => {
    renderWithContext({});
    expect(screen.getByTestId('ws-panel-process-review')).toBeTruthy();
  });

  it('renders the dense catalogue title Review Metrics in the panel header', () => {
    renderWithContext({});
    const header = screen.getByTestId('ws-panel-process-review').querySelector('.ws-panel-header');
    expect(header?.textContent).toBe('Review Metrics');
    expect(header?.textContent).not.toContain('Process Review');
  });

  describe('Process Score Distribution', () => {
    it('renders bins with counts', () => {
      renderWithContext({
        processScoreDistribution: [
          { label: 'A (54-60)', count: 26, minScore: 54 },
          { label: 'B (48-53)', count: 31, minScore: 48 },
          { label: 'C (42-47)', count: 19, minScore: 42 },
        ],
      });

      const rows = screen.getAllByTestId('ws-process-score-row');
      expect(rows).toHaveLength(3);
      // Counts are rendered
      expect(rows[0].textContent).toContain('26');
      expect(rows[1].textContent).toContain('31');
      expect(rows[2].textContent).toContain('19');
      // Labels are rendered
      expect(rows[0].textContent).toContain('A (54-60)');
    });

    it('applies ws-pos class to A and B grades', () => {
      renderWithContext({
        processScoreDistribution: [
          { label: 'A (54-60)', count: 10, minScore: 54 },
          { label: 'B (48-53)', count: 8, minScore: 48 },
        ],
      });

      const rows = screen.getAllByTestId('ws-process-score-row');
      const barsA = rows[0].querySelector('.ws-process-bar');
      const barsB = rows[1].querySelector('.ws-process-bar');
      expect(barsA?.classList.contains('ws-pos')).toBe(true);
      expect(barsB?.classList.contains('ws-pos')).toBe(true);
    });

    it('applies no colour class to C grade', () => {
      renderWithContext({
        processScoreDistribution: [
          { label: 'C (42-47)', count: 15, minScore: 42 },
        ],
      });

      const rows = screen.getAllByTestId('ws-process-score-row');
      const bar = rows[0].querySelector('.ws-process-bar');
      expect(bar?.classList.contains('ws-pos')).toBe(false);
      expect(bar?.classList.contains('ws-neg')).toBe(false);
    });

    it('applies ws-neg class to D and F grades', () => {
      renderWithContext({
        processScoreDistribution: [
          { label: 'D (36-41)', count: 8, minScore: 36 },
          { label: 'F (0-35)', count: 3, minScore: 0 },
        ],
      });

      const rows = screen.getAllByTestId('ws-process-score-row');
      const barD = rows[0].querySelector('.ws-process-bar');
      const barF = rows[1].querySelector('.ws-process-bar');
      expect(barD?.classList.contains('ws-neg')).toBe(true);
      expect(barF?.classList.contains('ws-neg')).toBe(true);
    });

    it('shows empty state when processScoreDistribution is undefined', () => {
      renderWithContext({});
      const container = screen.getByTestId('ws-process-score-dist');
      expect(container.textContent).toContain('No process scores');
    });

    it('shows empty state when processScoreDistribution is empty array', () => {
      renderWithContext({ processScoreDistribution: [] });
      const container = screen.getByTestId('ws-process-score-dist');
      expect(container.textContent).toContain('No process scores');
    });
  });

  describe('Directional Performance', () => {
    it('shows long and short sides with trade count, P&L, and win rate', () => {
      renderWithContext({
        directionalPerformance: {
          long: { netPnl: 10984.2, winRate: 0.6047, tradeCount: 71 },
          short: { netPnl: -1454.35, winRate: 0.4615, tradeCount: 13 },
        },
      });

      const longSide = screen.getByTestId('ws-dir-perf-long');
      const shortSide = screen.getByTestId('ws-dir-perf-short');

      expect(longSide.textContent).toContain('71');
      expect(longSide.textContent).toContain('$10,984.20');
      expect(longSide.textContent).toContain('60.5%');

      expect(shortSide.textContent).toContain('13');
      expect(shortSide.textContent).toContain('-$1,454.35');
      expect(shortSide.textContent).toContain('46.2%');
    });

    it('applies P&L colour classes', () => {
      renderWithContext({
        directionalPerformance: {
          long: { netPnl: 500, winRate: 0.6, tradeCount: 10 },
          short: { netPnl: -200, winRate: 0.4, tradeCount: 5 },
        },
      });

      const longSide = screen.getByTestId('ws-dir-perf-long');
      const shortSide = screen.getByTestId('ws-dir-perf-short');

      const longPnl = longSide.querySelector('.ws-pos');
      const shortPnl = shortSide.querySelector('.ws-neg');
      expect(longPnl).toBeTruthy();
      expect(shortPnl).toBeTruthy();
    });

    it('shows empty state when directionalPerformance is undefined', () => {
      renderWithContext({});
      const container = screen.getByTestId('ws-directional-performance');
      expect(container.textContent).toContain('No directional data');
    });
  });

  describe('Attention Items', () => {
    it('renders insights with severity indicators', () => {
      renderWithContext({
        attentionInsights: {
          tradeCount: 50,
          insights: [
            { type: 'best-day', severity: 'info', title: 'Best Day', message: 'Tuesday is your best trading day' },
            { type: 'loss-streak', severity: 'warning', title: 'Loss Streak', message: '3 consecutive losses' },
            { type: 'risk-breach', severity: 'critical', title: 'Risk Breach', message: 'Daily risk limit exceeded' },
          ],
        },
      });

      expect(screen.getByTestId('ws-attention-item-0')).toBeTruthy();
      expect(screen.getByTestId('ws-attention-item-1')).toBeTruthy();
      expect(screen.getByTestId('ws-attention-item-2')).toBeTruthy();

      // Severity badges
      expect(screen.getByTestId('ws-severity-info')).toBeTruthy();
      expect(screen.getByTestId('ws-severity-warning')).toBeTruthy();
      expect(screen.getByTestId('ws-severity-critical')).toBeTruthy();

      // Content
      expect(screen.getByTestId('ws-attention-item-0').textContent).toContain('Tuesday is your best trading day');
      expect(screen.getByTestId('ws-attention-item-1').textContent).toContain('3 consecutive losses');
    });

    it('limits to top 3 highest-attention insights (severity-ordered input)', () => {
      // insights are consumed in provider order; attention-insights.ts
      // already sorts most-important first (critical → warning → info).
      const insights = Array.from({ length: 8 }, (_, i) => ({
        type: `type-${i}`,
        severity: 'info' as const,
        title: `Title ${i}`,
        message: `Message ${i}`,
      }));

      renderWithContext({
        attentionInsights: { tradeCount: 100, insights },
      });

      // Items 0–2 exist, 3–7 do not.
      for (let i = 0; i < 3; i++) {
        expect(screen.getByTestId(`ws-attention-item-${i}`)).toBeTruthy();
      }
      expect(screen.queryByTestId('ws-attention-item-3')).toBeNull();
      expect(screen.queryByTestId('ws-attention-item-7')).toBeNull();
    });

    it('renders the leading 3 insights in provider order without re-sorting', () => {
      // attention-insights.ts sorts most-important first (critical → warning
      // → info); the panel is a pure consumer and takes the leading slice
      // as-is rather than duplicating the severity computation.
      const insights = [
        { type: 'crit-item', severity: 'critical' as const, title: 'Crit', message: 'Critical message' },
        { type: 'warn-item', severity: 'warning' as const, title: 'Warn', message: 'Warning message' },
        { type: 'info-item', severity: 'info' as const, title: 'Info', message: 'Info message' },
        { type: 'extra-item', severity: 'warning' as const, title: 'Extra', message: 'Extra message' },
      ];

      renderWithContext({
        attentionInsights: { tradeCount: 50, insights },
      });

      expect(screen.getByTestId('ws-attention-item-0').textContent).toContain('Critical message');
      expect(screen.getByTestId('ws-attention-item-1').textContent).toContain('Warning message');
      expect(screen.getByTestId('ws-attention-item-2').textContent).toContain('Info message');
      expect(screen.queryByTestId('ws-attention-item-3')).toBeNull();
    });

    it('applies ws-neg class to warning and critical severity badges', () => {
      renderWithContext({
        attentionInsights: {
          tradeCount: 50,
          insights: [
            { type: 'info-item', severity: 'info', title: 'Info', message: 'Info message' },
            { type: 'warn-item', severity: 'warning', title: 'Warn', message: 'Warning message' },
            { type: 'crit-item', severity: 'critical', title: 'Crit', message: 'Critical message' },
          ],
        },
      });

      const infoBadge = screen.getByTestId('ws-severity-info');
      const warnBadge = screen.getByTestId('ws-severity-warning');
      const critBadge = screen.getByTestId('ws-severity-critical');

      expect(infoBadge.classList.contains('ws-neg')).toBe(false);
      expect(warnBadge.classList.contains('ws-neg')).toBe(true);
      expect(critBadge.classList.contains('ws-neg')).toBe(true);
    });

    it('shows empty state when no insights', () => {
      renderWithContext({});
      const container = screen.getByTestId('ws-attention-items');
      expect(container.textContent).toContain('No attention items');
    });
  });
});
