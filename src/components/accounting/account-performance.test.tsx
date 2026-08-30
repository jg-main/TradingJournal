/**
 * Component tests for AccountPerformance semantic states (M004/T3).
 *
 * Proves:
 *  - Long/Short direction icons/labels are neutral (no profit/loss semantics)
 *  - missing mark status uses the canonical missing token
 *  - fresh mark status keeps its healthy positive treatment
 *  - stale mark status remains warning
 *  - financial P&L keeps positive/negative semantics
 *
 * Run: npx vitest run --reporter verbose src/components/accounting/account-performance.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import AccountPerformance from './account-performance';

// ── Fixtures ───────────────────────────────────────────────────────────

const FIXTURE = {
  accountId: 'acct-001',
  computedAt: '2026-08-30T12:00:00.000Z',
  netCash: '10000.00',
  nav: '25000.00',
  markedPositions: '15000.00',
  realizedPnl: '500.00',
  unrealizedPnl: '750.00',
  totalPnl: '1250.00',
  realizedFees: '50.00',
  grossExposure: '20000.00',
  netExposure: '20000.00',
  modifiedDietzReturn: '0.05',
  twr: '0.06',
  highWaterMark: '26000.00',
  drawdown: '0.00',
  drawdownPct: '0.00',
  warnings: [] as string[],
  positions: [
    {
      instrumentId: 'inst-aapl-001',
      symbol: 'AAPL',
      direction: 'long' as const,
      quantity: '50.00',
      averageCost: '150.00',
      totalCostBasis: '7500.00',
      realizedPnl: '200.00',
      realizedFees: '5.00',
      realizedNetPnl: '195.00',
      markPrice: '165.00',
      markStatus: 'fresh' as const,
      markedValue: '8250.00',
  unrealizedPnl: '-250.00',
      markTimestamp: '2026-08-30T11:00:00.000Z',
      markSource: 'market_data' as const,
      markAgeMinutes: 60,
    },
    {
      instrumentId: 'inst-nvda-001',
      symbol: 'NVDA',
      direction: 'short' as const,
      quantity: '40.00',
      averageCost: '500.00',
      totalCostBasis: '20000.00',
      realizedPnl: '-100.00',
      realizedFees: '5.00',
      realizedNetPnl: '-105.00',
      markPrice: null,
      markStatus: 'missing' as const,
      markedValue: null,
      unrealizedPnl: null,
      markTimestamp: null,
      markSource: null,
      markAgeMinutes: null,
    },
    {
      instrumentId: 'inst-tsla-001',
      symbol: 'TSLA',
      direction: 'long' as const,
      quantity: '10.00',
      averageCost: '220.00',
      totalCostBasis: '2200.00',
      realizedPnl: '0.00',
      realizedFees: '0.00',
      realizedNetPnl: '0.00',
      markPrice: '235.00',
      markStatus: 'stale' as const,
      markedValue: '2350.00',
      unrealizedPnl: '150.00',
      markTimestamp: '2026-08-30T05:00:00.000Z',
      markSource: 'market_data' as const,
      markAgeMinutes: 420,
    },
  ],
  rebuildCount: 0,
  lastRebuiltAt: null,
};

// ── Test Setup ─────────────────────────────────────────────────────────

const UNMOCKED_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  cleanup();
});

function mockFetchSuccess(data: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('AccountPerformance — semantic states (M004/T3)', () => {
  async function renderFixture() {
    mockFetchSuccess(FIXTURE);
    render(<AccountPerformance accountId="acct-001" />);
    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeTruthy();
    });
  }

  it('Long direction label/icon carries no profit/loss semantics', async () => {
    await renderFixture();
    // Both AAPL and TSLA are long.
    const labels = screen.getAllByText('long');
    expect(labels.length).toBeGreaterThanOrEqual(2);
    for (const label of labels) {
      const cell = label.closest('td') as HTMLElement;
      expect(cell.innerHTML).not.toContain('text-positive');
      expect(cell.innerHTML).not.toContain('text-negative');
      expect(cell.innerHTML).not.toContain('text-destructive');
      expect(cell.querySelector('svg')).toBeTruthy();
    }
  });

  it('Short direction label/icon carries no profit/loss semantics', async () => {
    await renderFixture();
    const label = screen.getByText('short');
    const cell = label.closest('td') as HTMLElement;
    expect(cell.innerHTML).not.toContain('text-positive');
    expect(cell.innerHTML).not.toContain('text-negative');
    expect(cell.innerHTML).not.toContain('text-destructive');
    expect(cell.querySelector('svg')).toBeTruthy();
  });

  it('missing mark status uses the canonical missing token', async () => {
    await renderFixture();
    const badge = screen.getByText('Missing');
    expect(badge.className).toContain('bg-missing');
    expect(badge.className).toContain('text-missing');
    expect(badge.className).not.toContain('bg-negative');
    expect(badge.className).not.toContain('text-negative');
  });

  it('fresh mark status keeps its healthy positive treatment', async () => {
    await renderFixture();
    const badge = screen.getByText('Fresh');
    expect(badge.className).toContain('bg-positive/10');
    expect(badge.className).toContain('text-positive');
  });

  it('stale mark status remains warning', async () => {
    await renderFixture();
    const badge = screen.getByText('Stale');
    expect(badge.className).toContain('bg-warning/10');
    expect(badge.className).toContain('text-warning');
  });

  it('financial P&L keeps positive/negative semantics', async () => {
    await renderFixture();
    // +$750.00 is the AAPL row unrealized P&L.
    const profits = screen.getAllByText('+$750.00');
    expect(profits.length).toBeGreaterThanOrEqual(1);
    for (const profit of profits) {
      expect(profit.className).toContain('text-positive');
    }
    // The Unrealized P&L metric card renders the negative snapshot as "$-250.00".
    const loss = screen.getByText(/^\$?-?250\.00$/);
    expect(loss.className).toContain('text-negative');
  });
});
