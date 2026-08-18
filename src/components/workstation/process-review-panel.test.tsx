/**
 * Tests for the workstation ProcessReviewPanel.
 *
 * The panel is a pure consumer of WorkstationContext fixtures.dashboard:
 * processScoreDistribution, directionalPerformance, and attentionInsights.
 * In live mode (M024/S02/T02) the panel additionally hosts the weekly
 * review write surface:
 *
 *   - a panel-local summary fetch (GET /api/reviews/weekly?accountId=X)
 *     filtered to the current week, with loading / error / empty /
 *     metrics states
 *   - an 'Update review' header button that opens the ReviewWriteSheet
 *   - after a save the summary refreshes SPA-continuously (no reload)
 *
 * These tests pin:
 *
 *   - process score distribution renders bins with counts
 *   - grade colour coding (A-B → ws-pos, C → '', D-F → ws-neg)
 *   - directional performance shows long/short with P&L colouring
 *   - attention items render with severity indicators, limited to top 3
 *   - panel header reads 'Review Metrics' (WORKSTATION_PANEL_CATALOGUE title)
 *   - empty/undefined data shows compact empty states
 *   - fixture mode (liveMode=false): no summary section, no Update review
 *     button, no fetch — panel stays read-only
 *   - live mode: summary loads current-week metrics from the weekly API
 *   - live mode: non-current-week reviews render "No review this week"
 *   - live mode: fetch failure surfaces an inline alert + Retry and logs
 *     [review-panel]
 *   - live mode: Update review opens the sheet; saving refreshes the
 *     summary without a page reload
 *
 * Run: npx vitest run src/components/workstation/process-review-panel.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import type { DashboardResponse } from '@/lib/workstation-fixtures';
import { mondayIsoDate, type WeeklyReviewRow } from './review-write-sheet';

// ── Mock workstation context ────────────────────────────────────────────

const mockUseWorkstation = vi.fn();

vi.mock('./workstation-context', () => ({
  useWorkstation: () => mockUseWorkstation(),
}));

import { ProcessReviewPanel } from './process-review-panel';

// ── Global fetch mock ───────────────────────────────────────────────────

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function reviewRow(overrides: Partial<WeeklyReviewRow> = {}): WeeklyReviewRow {
  const weekStart = mondayIsoDate(new Date());
  return {
    id: 'rev-1',
    weekStart,
    weekEnd: addDaysIso(weekStart, 6),
    accountId: 'acc-1',
    closedTrades: 5,
    netPnl: 1234.5,
    avgR: 1.25,
    winRate: 0.6,
    avgProcessScore: 48,
    notes: null,
    focusNextWeek: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Stateful fetch mock dispatching on method + URL:
 *   GET  /api/reviews/weekly?accountId=…  → the summary list (`rows`)
 *   POST /api/reviews/weekly              → generate-or-load (sheet)
 *   PUT  /api/reviews/weekly/[id]         → save; stores the row so the
 *                                           post-save reconcile GET sees it
 */
function installFetchMock(options: {
  rows?: WeeklyReviewRow[];
  getError?: { status: number; body: unknown } | null;
  failFirstGet?: boolean;
  /** Fail only the Nth GET call (1-based). Lets the mount GET succeed
   *  while the post-save reconcile GET fails. */
  failGetAt?: number;
  rejectGet?: boolean;
  saveRow?: WeeklyReviewRow;
} = {}) {
  let rows = options.rows ?? [];
  let firstGetDone = false;
  let getCount = 0;

  mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.startsWith('/api/reviews/weekly?accountId=')) {
      getCount += 1;
      if (!firstGetDone && options.failFirstGet) {
        firstGetDone = true;
        return Promise.resolve(jsonResponse(500, { error: 'boom' }));
      }
      // Fail-at-index mode: only the Nth GET fails with getError; every
      // other GET returns the rows list (the fallback getError below is
      // intentionally bypassed so the mount GET still succeeds).
      if (options.failGetAt !== undefined) {
        if (options.failGetAt === getCount) {
          return Promise.resolve(
            jsonResponse(
              options.getError?.status ?? 500,
              options.getError?.body ?? { error: 'boom' },
            ),
          );
        }
        return Promise.resolve(jsonResponse(200, rows));
      }
      if (options.rejectGet) {
        return Promise.reject(new Error('network down'));
      }
      if (options.getError) {
        return Promise.resolve(jsonResponse(options.getError.status, options.getError.body));
      }
      return Promise.resolve(jsonResponse(200, rows));
    }

    if (method === 'POST' && url === '/api/reviews/weekly') {
      return Promise.resolve(jsonResponse(200, reviewRow()));
    }

    if (method === 'PUT' && url.startsWith('/api/reviews/weekly/')) {
      const saved = options.saveRow ??
        reviewRow({ notes: 'Disciplined week', focusNextWeek: 'Stay patient' });
      rows = [saved];
      return Promise.resolve(jsonResponse(200, saved));
    }

    return Promise.resolve(jsonResponse(404, { error: `unexpected ${method} ${url}` }));
  });
}

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

function renderWithContext(
  dashboard: Partial<DashboardResponse>,
  opts: { liveMode?: boolean; accountId?: string } = {},
) {
  mockUseWorkstation.mockReturnValue({
    fixtures: { dashboard: minimalDashboard(dashboard) },
    liveMode: opts.liveMode ?? false,
    activeAccountId: opts.accountId ?? 'acc-1',
  });
  return render(<ProcessReviewPanel />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUseWorkstation.mockReset();
  mockFetch.mockReset();
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

  // ── Fixture-mode gating (M024/S02) ─────────────────────────────────

  describe('fixture mode gating', () => {
    it('renders no weekly review write chrome and never fetches', () => {
      renderWithContext({});
      expect(screen.queryByTestId('ws-weekly-review-summary')).toBeNull();
      expect(screen.queryByTestId('ws-update-review')).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('keeps the header title exactly Review Metrics in fixture mode', () => {
      renderWithContext({});
      const header = screen.getByTestId('ws-panel-process-review').querySelector('.ws-panel-header');
      expect(header?.textContent).toBe('Review Metrics');
      expect(header?.textContent).not.toContain('Update review');
    });
  });

  // ── Weekly Review Summary (live mode) ──────────────────────────────

  describe('weekly review summary (live mode)', () => {
    it('fetches the weekly review list for the active account and shows current-week metrics', async () => {
      installFetchMock({ rows: [reviewRow()] });
      renderWithContext({}, { liveMode: true });

      expect(await screen.findByTestId('ws-weekly-review-metric-trades')).toBeTruthy();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/reviews/weekly?accountId=acc-1`);
      expect(init?.method ?? 'GET').toBe('GET');

      expect(screen.getByTestId('ws-weekly-review-metric-trades').textContent).toBe('5');
      expect(screen.getByTestId('ws-weekly-review-metric-netpnl').textContent).toBe('$1,234.50');
      expect(screen.getByTestId('ws-weekly-review-metric-winrate').textContent).toBe('60.0%');
      expect(screen.getByTestId('ws-weekly-review-metric-avgr').textContent).toBe('1.25');
      expect(screen.getByTestId('ws-weekly-review-metric-grade').textContent).toBe('B (48.0)');
      expect(screen.queryByTestId('ws-weekly-review-empty')).toBeNull();
    });

    it('shows the week range label for the loaded review', async () => {
      installFetchMock({ rows: [reviewRow()] });
      renderWithContext({}, { liveMode: true });

      await screen.findByTestId('ws-weekly-review-metric-trades');
      const week = screen.getByTestId('ws-weekly-review-week');
      expect(week.textContent).toContain('Aug');
    });

    it('shows "No review this week" when the API has no current-week review', async () => {
      installFetchMock({ rows: [] });
      renderWithContext({}, { liveMode: true });

      expect(await screen.findByTestId('ws-weekly-review-empty')).toBeTruthy();
      expect(screen.getByTestId('ws-weekly-review-empty').textContent).toContain('No review this week');
    });

    it('treats older reviews as "No review this week" (current-week filter)', async () => {
      installFetchMock({ rows: [reviewRow({ weekStart: '2026-08-03', weekEnd: '2026-08-09' })] });
      renderWithContext({}, { liveMode: true });

      expect(await screen.findByTestId('ws-weekly-review-empty')).toBeTruthy();
      expect(screen.queryByTestId('ws-weekly-review-metric-trades')).toBeNull();
    });

    it('does not fetch when no account is selected', () => {
      installFetchMock();
      mockUseWorkstation.mockReturnValue({
        fixtures: { dashboard: minimalDashboard({}) },
        liveMode: true,
        activeAccountId: null, // account selection happens after mount
      });
      render(<ProcessReviewPanel />);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Weekly review summary failure handling ─────────────────────────

  describe('weekly review summary failure handling', () => {
    it('surfaces an inline alert with Retry and logs [review-panel] on a 500', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      installFetchMock({ getError: { status: 500, body: { error: 'Failed to fetch weekly reviews' } } });
      renderWithContext({}, { liveMode: true });

      const alert = await screen.findByTestId('ws-weekly-review-error');
      expect(alert.textContent).toContain('Failed to fetch weekly reviews');
      expect(screen.getByTestId('ws-weekly-review-retry')).toBeTruthy();
      expect(consoleError).toHaveBeenCalledWith(
        '[review-panel] summary fetch failed (500): Failed to fetch weekly reviews',
      );
      consoleError.mockRestore();
    });

    it('surfaces an inline alert on network failure', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      installFetchMock({ rejectGet: true });
      renderWithContext({}, { liveMode: true });

      const alert = await screen.findByTestId('ws-weekly-review-error');
      expect(alert.textContent).toContain('Network error');
      expect(consoleError).toHaveBeenCalledWith(
        '[review-panel] summary network failure:',
        expect.any(Error),
      );
      consoleError.mockRestore();
    });

    it('retry refetches and recovers to the metrics state', async () => {
      installFetchMock({ failFirstGet: true, rows: [reviewRow()] });
      renderWithContext({}, { liveMode: true });

      await screen.findByTestId('ws-weekly-review-error');
      fireEvent.click(screen.getByTestId('ws-weekly-review-retry'));

      expect(await screen.findByTestId('ws-weekly-review-metric-trades')).toBeTruthy();
      expect(screen.queryByTestId('ws-weekly-review-error')).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('a failed reconcile after save logs but keeps the just-saved summary', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      // The reconcile GET (the 2nd GET call) fails; the mount GET succeeds
      // with no reviews so the direct onSaved state must survive.
      installFetchMock({
        rows: [],
        failGetAt: 2,
        getError: { status: 500, body: { error: 'reconcile boom' } },
      });
      renderWithContext({}, { liveMode: true });

      await screen.findByTestId('ws-weekly-review-empty');
      await user.click(screen.getByTestId('ws-update-review'));
      await screen.findByTestId('ws-review-sheet-metrics');

      await user.type(screen.getByTestId('ws-review-sheet-notes'), 'Disciplined week');
      await user.click(screen.getByTestId('ws-review-sheet-save'));

      // Summary reflects the saved row (direct state), not the failed GET.
      expect(await screen.findByTestId('ws-weekly-review-metric-trades')).toBeTruthy();
      expect(screen.queryByTestId('ws-weekly-review-error')).toBeNull();
      expect(consoleError).toHaveBeenCalledWith(
        '[review-panel] summary fetch failed (500): reconcile boom',
      );
      consoleError.mockRestore();
    });
  });

  // ── Update review → sheet wiring ───────────────────────────────────

  describe('Update review sheet wiring', () => {
    it('opens the ReviewWriteSheet from the header button in live mode', async () => {
      installFetchMock({ rows: [] });
      renderWithContext({}, { liveMode: true });

      await screen.findByTestId('ws-weekly-review-empty');
      const button = screen.getByTestId('ws-update-review');
      expect(button.textContent).toContain('Update review');

      fireEvent.click(button);
      // Sheet auto-generates-or-loads via POST /api/reviews/weekly.
      expect(await screen.findByTestId('ws-review-sheet-metrics')).toBeTruthy();
    });

    it('save refreshes the panel summary without a page reload', async () => {
      const user = userEvent.setup();
      installFetchMock({ rows: [] });
      renderWithContext({}, { liveMode: true });

      await screen.findByTestId('ws-weekly-review-empty');
      await user.click(screen.getByTestId('ws-update-review'));
      await screen.findByTestId('ws-review-sheet-metrics');

      await user.type(screen.getByTestId('ws-review-sheet-notes'), 'Disciplined week');
      await user.type(screen.getByTestId('ws-review-sheet-focus'), 'Stay patient');
      await user.click(screen.getByTestId('ws-review-sheet-save'));

      // SPA-continuous: sheet closes and the panel summary shows the saved
      // metrics (reconciled against the persisted list in the background).
      await waitFor(() => {
        expect(screen.queryByTestId('ws-review-sheet-metrics')).toBeNull();
      });
      expect(await screen.findByTestId('ws-weekly-review-metric-trades')).toBeTruthy();
      expect(screen.getByTestId('ws-weekly-review-metric-trades').textContent).toBe('5');
      expect(screen.getByTestId('ws-weekly-review-metric-netpnl').textContent).toBe('$1,234.50');
      expect(screen.queryByTestId('ws-weekly-review-empty')).toBeNull();
    });
  });
});
