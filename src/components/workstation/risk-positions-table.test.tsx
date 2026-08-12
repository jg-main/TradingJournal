/**
 * Tests for the workstation risk-positions table (S04 T03).
 *
 * The table is a prop-driven pure consumer of
 * DashboardV2Response['valuation']['positions'] (DashboardPositionSummary):
 * every cell renders an API-declared value (markStatus, markProvenance,
 * attribution, risk state) and the default sort (sortPositionsRiskFirst)
 * uses only per-position state the API already computed — classification is
 * never re-implemented from raw timestamps or rows.
 *
 * These tests pin:
 *   - risk-first sort order (stop → mark → magnitude → symbol tiebreak)
 *   - all nine columns + headers in contract order
 *   - qualified per-cell rendering (mark state text + source + as-of,
 *     attribution labels + linked-journal-trade count, 'No valid stop',
 *     'Incomplete', '—' P&L when incalculable, exposure mark-completeness
 *     state, P&L sign classes)
 *   - empty state ('No open account positions', no table)
 *   - readability token values in workstation.css (headers ≥12px,
 *     data cells ≥13px, primary values 16–20px, rows 36–40px)
 *
 * Run: npx vitest run src/components/workstation/risk-positions-table.test.tsx
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import { render, screen, within, cleanup } from '@testing-library/react';
import React from 'react';

import type {
  DashboardPositionSummary,
  DashboardV2Response,
} from '@/lib/accounting/dashboard-v2';
import { RiskPositionsTable, sortPositionsRiskFirst } from './risk-positions-table';

// ── Fixture helpers ────────────────────────────────────────────────────
// A minimal fully-fresh position factory. Each test overrides only the
// fields it exercises so the remaining cells stay baseline-clean.

const COMPUTED_AT = '2026-07-17T20:15:00.000Z';
const AS_OF = '2026-07-17T19:58:00.000Z';

function position(
  overrides: Partial<DashboardPositionSummary> = {},
): DashboardPositionSummary {
  return {
    instrumentId: 'inst-xxxx',
    symbol: 'XXXX',
    direction: 'long',
    quantity: '100',
    averageCost: '100.00',
    markStatus: 'fresh',
    markPrice: '110.00',
    markedValue: '11000.00',
    unrealizedPnl: '1000.00',
    markTimestamp: AS_OF,
    markAgeMinutes: 5,
    attribution: { kind: 'journal', executionCount: 10, journalTradeCount: 1 },
    markProvenance: { source: 'market_data', asOf: AS_OF, computedAt: COMPUTED_AT, status: 'fresh' },
    risk: { hasValidStop: true, stopPrice: 95, currentRiskToStop: '1500.00', openTrades: 1 },
    journalLinkedMetrics: null,
    ...overrides,
  };
}

// ── Sort contract: sortPositionsRiskFirst ──────────────────────────────

describe('sortPositionsRiskFirst', () => {
  it('sorts positions without a valid stop before positions with one', () => {
    const hasStop = position({ symbol: 'AAA', risk: { hasValidStop: true, stopPrice: 95, currentRiskToStop: '500.00', openTrades: 1 } });
    const noStop = position({ symbol: 'BBB', risk: { hasValidStop: false, stopPrice: null, currentRiskToStop: null, openTrades: 1 } });

    expect(sortPositionsRiskFirst([hasStop, noStop]).map((p) => p.symbol)).toEqual(['BBB', 'AAA']);
  });

  it('sorts missing marks before stale before fresh within the same stop state', () => {
    const missing = position({ symbol: 'AAA', markStatus: 'missing', markPrice: null, markedValue: null, unrealizedPnl: null, markProvenance: { source: null, asOf: null, computedAt: COMPUTED_AT, status: 'missing' } });
    const stale = position({ symbol: 'BBB', markStatus: 'stale', markProvenance: { source: 'user', asOf: AS_OF, computedAt: COMPUTED_AT, status: 'stale' } });
    const fresh = position({ symbol: 'CCC', markStatus: 'fresh' });

    expect(sortPositionsRiskFirst([fresh, stale, missing]).map((p) => p.symbol)).toEqual([
      'AAA',
      'BBB',
      'CCC',
    ]);
  });

  it('treats stop state as the primary key (a fresh mark does not outrank a missing stop)', () => {
    const noStopFresh = position({
      symbol: 'AAA',
      risk: { hasValidStop: false, stopPrice: null, currentRiskToStop: null, openTrades: 1 },
    });
    const hasStopMissing = position({
      symbol: 'BBB',
      markStatus: 'missing',
      markPrice: null,
      markedValue: null,
      unrealizedPnl: null,
      markProvenance: { source: null, asOf: null, computedAt: COMPUTED_AT, status: 'missing' },
    });

    expect(sortPositionsRiskFirst([hasStopMissing, noStopFresh]).map((p) => p.symbol)).toEqual([
      'AAA',
      'BBB',
    ]);
  });

  it('sorts by largest current risk descending within equal stop/mark state', () => {
    const riskBig = position({ symbol: 'AAA', risk: { hasValidStop: true, stopPrice: 95, currentRiskToStop: '4000.00', openTrades: 1 } });
    const riskSmall = position({ symbol: 'BBB', risk: { hasValidStop: true, stopPrice: 95, currentRiskToStop: '100.00', openTrades: 1 } });

    expect(sortPositionsRiskFirst([riskSmall, riskBig]).map((p) => p.symbol)).toEqual(['AAA', 'BBB']);
  });

  it('falls back to exposure magnitude when current risk is unavailable', () => {
    const bigExposure = position({
      symbol: 'AAA',
      markStatus: 'missing',
      markPrice: null,
      unrealizedPnl: null,
      markedValue: '20000.00',
      markProvenance: { source: null, asOf: null, computedAt: COMPUTED_AT, status: 'missing' },
      risk: { hasValidStop: false, stopPrice: null, currentRiskToStop: null, openTrades: 0 },
    });
    const smallExposure = position({
      symbol: 'BBB',
      markStatus: 'missing',
      markPrice: null,
      unrealizedPnl: null,
      markedValue: '500.00',
      markProvenance: { source: null, asOf: null, computedAt: COMPUTED_AT, status: 'missing' },
      risk: { hasValidStop: false, stopPrice: null, currentRiskToStop: null, openTrades: 0 },
    });

    expect(sortPositionsRiskFirst([smallExposure, bigExposure]).map((p) => p.symbol)).toEqual([
      'AAA',
      'BBB',
    ]);
  });

  it('uses symbol ascending as the deterministic tiebreak', () => {
    const a = position({ symbol: 'NVDA', risk: { hasValidStop: true, stopPrice: 95, currentRiskToStop: '1000.00', openTrades: 1 } });
    const b = position({ symbol: 'AMD', risk: { hasValidStop: true, stopPrice: 95, currentRiskToStop: '1000.00', openTrades: 1 } });

    expect(sortPositionsRiskFirst([a, b]).map((p) => p.symbol)).toEqual(['AMD', 'NVDA']);
  });

  it('returns a new array and never mutates the input', () => {
    const input = [position({ symbol: 'AAA' }), position({ symbol: 'BBB' })];
    const before = input.map((p) => p.symbol);
    const sorted = sortPositionsRiskFirst(input);
    expect(sorted).not.toBe(input);
    expect(input.map((p) => p.symbol)).toEqual(before);
  });

  it('handles empty and single-position inputs', () => {
    expect(sortPositionsRiskFirst([])).toEqual([]);
    const solo = position({ symbol: 'SOLO' });
    expect(sortPositionsRiskFirst([solo])).toEqual([solo]);
  });
});

// ── Component rendering ─────────────────────────────────────────────────

const DEFAULT_POSITIONS: DashboardPositionSummary[] = [
  // NVDA — journal attribution, valid stop, fresh mark.
  position({
    instrumentId: 'inst-nvda',
    symbol: 'NVDA',
    direction: 'long',
    quantity: '120',
    averageCost: '128.40',
    markPrice: '131.85',
    markedValue: '15822.00',
    unrealizedPnl: '414.00',
    markAgeMinutes: 17,
    attribution: { kind: 'journal', executionCount: 214, journalTradeCount: 214 },
    risk: { hasValidStop: true, stopPrice: 127.9, currentRiskToStop: '474.00', openTrades: 1 },
  }),
  // AMD — mixed attribution, valid stop, fresh mark, smaller risk.
  position({
    instrumentId: 'inst-amd',
    symbol: 'AMD',
    direction: 'long',
    quantity: '80',
    averageCost: '112.10',
    markPrice: '118.42',
    markedValue: '9473.60',
    unrealizedPnl: '505.60',
    attribution: { kind: 'mixed', executionCount: 3, journalTradeCount: 2 },
    risk: { hasValidStop: true, stopPrice: 115.2, currentRiskToStop: '257.60', openTrades: 1 },
  }),
  // TSLA — account-only, no valid stop, stale user mark.
  position({
    instrumentId: 'inst-tsla',
    symbol: 'TSLA',
    direction: 'short',
    quantity: '25',
    averageCost: '246.80',
    markStatus: 'stale',
    markPrice: '249.93',
    markedValue: '6248.25',
    unrealizedPnl: '-78.25',
    markTimestamp: '2026-07-16T20:00:00.000Z',
    markAgeMinutes: 1455,
    attribution: { kind: 'account_only', executionCount: 3, journalTradeCount: 0 },
    markProvenance: { source: 'user', asOf: '2026-07-16T20:00:00.000Z', computedAt: COMPUTED_AT, status: 'stale' },
    risk: { hasValidStop: false, stopPrice: null, currentRiskToStop: null, openTrades: 1 },
    journalLinkedMetrics: null,
  }),
];

function renderTable(positions: DashboardPositionSummary[] = DEFAULT_POSITIONS) {
  return render(<RiskPositionsTable positions={positions} />);
}

// Unmount the previous render between tests so getByTestId never resolves
// against accumulated DOM from earlier cases.
afterEach(cleanup);

describe('RiskPositionsTable', () => {
  it('renders the panel title with the open-position count', () => {
    renderTable();
    expect(
      screen.getByTestId('ws-panel-positions').querySelector('.ws-panel-header')
        ?.textContent,
    ).toContain('Open account positions: 3');
  });

  it('renders all nine column headers in contract order', () => {
    renderTable();
    const headers = screen
      .getByTestId('ws-positions-table')
      .querySelectorAll('thead th');
    expect(Array.from(headers).map((h) => h.textContent)).toEqual([
      'Symbol',
      'Attribution',
      'Side/qty',
      'Avg cost',
      'Mark',
      'Unrealized P&L',
      'Active stop',
      'Current risk to stop',
      'Exposure',
    ]);
  });

  it('renders rows in risk-first sort order (TSLA, NVDA, AMD)', () => {
    renderTable();
    const symbols = Array.from(
      screen.getByTestId('ws-positions-table').querySelectorAll('tbody tr'),
    ).map((tr) => tr.querySelector('td')?.textContent);
    expect(symbols).toEqual(['TSLA', 'NVDA', 'AMD']);
  });

  it('renders attribution labels with linked-journal-trade counts', () => {
    renderTable();
    const tslaRow = screen.getByTestId('ws-position-row-TSLA');
    const nvdaRow = screen.getByTestId('ws-position-row-NVDA');
    const amdRow = screen.getByTestId('ws-position-row-AMD');

    // Account-only: label without a linked count sub-line.
    const tslaAttribution = tslaRow.querySelectorAll('td')[1];
    expect(tslaAttribution.textContent).toContain('Account only');
    expect(tslaAttribution.querySelector('.ws-cell-sub')).toBeNull();

    // Journal: label + linked count.
    expect(nvdaRow.textContent).toContain('Journal');
    expect(within(nvdaRow).getByText('214 linked')).toBeTruthy();

    // Mixed: label + linked count.
    expect(amdRow.textContent).toContain('Mixed');
    expect(within(amdRow).getByText('2 linked')).toBeTruthy();
  });

  it('renders side/qty with direction letter and quantity', () => {
    renderTable();
    const nvdaRow = screen.getByTestId('ws-position-row-NVDA');
    expect(within(nvdaRow).getByTestId('ws-position-cell-side').textContent).toContain(
      'L 120',
    );
    const tslaRow = screen.getByTestId('ws-position-row-TSLA');
    expect(within(tslaRow).getByTestId('ws-position-cell-side').textContent).toContain(
      'S 25',
    );
  });

  it('renders symbol, avg cost, and exposure cells', () => {
    renderTable();
    const nvdaRow = screen.getByTestId('ws-position-row-NVDA');
    expect(nvdaRow.querySelector('td')?.textContent).toContain('NVDA');
    expect(nvdaRow.textContent).toContain('$128.40');
    expect(nvdaRow.textContent).toContain('$15,822.00');
  });

  it('renders stale mark price with visible state text, source, and as-of', () => {
    renderTable();
    const tslaRow = screen.getByTestId('ws-position-row-TSLA');

    // Price is still shown for stale marks.
    expect(tslaRow.textContent).toContain('$249.93');
    // State text + source + as-of are visible (never an amber dot alone).
    const markState = within(tslaRow).getByTestId('ws-position-cell-mark-state');
    expect(markState.textContent).toContain('Stale');
    expect(markState.textContent).toContain('user');
    expect(markState.textContent).toContain('2026-07-16 20:00 UTC');
    // The amber dot remains as an accent, with an accessible label.
    expect(
      within(tslaRow).getByTestId('ws-mark-stale-indicator'),
    ).toBeTruthy();
  });

  it('renders Unpriced for missing marks (never a bare em dash)', () => {
    const missing = position({
      symbol: 'CRWD',
      markStatus: 'missing',
      markPrice: null,
      markedValue: null,
      unrealizedPnl: null,
      markProvenance: { source: null, asOf: null, computedAt: COMPUTED_AT, status: 'missing' },
      risk: { hasValidStop: false, stopPrice: null, currentRiskToStop: null, openTrades: 1 },
    });
    renderTable([missing]);

    const row = screen.getByTestId('ws-position-row-CRWD');
    const markCell = row.querySelectorAll('td')[4];
    expect(markCell.textContent).toContain('Unpriced');
    expect(markCell.textContent).toContain('Missing mark');
    expect(markCell.textContent).not.toContain('$');
    // Exposure carries the mark-completeness state.
    expect(row.textContent).toContain('Unpriced');
  });

  it('renders fresh marks without a stale indicator and with tooltip provenance', () => {
    renderTable();
    const nvdaRow = screen.getByTestId('ws-position-row-NVDA');
    expect(
      within(nvdaRow).queryAllByTestId('ws-mark-stale-indicator'),
    ).toHaveLength(0);
    // Provenance stays discoverable via the mark title attribute.
    const markPrimary = nvdaRow.querySelector('.ws-cell-primary');
    expect(markPrimary?.getAttribute('title')).toContain('source market_data');
    expect(markPrimary?.getAttribute('title')).toContain('as-of 2026-07-17 19:58 UTC');
  });

  it('renders unrealized P&L or — when incalculable (never zero)', () => {
    const incalculable = position({
      symbol: 'CRWD',
      markStatus: 'missing',
      markPrice: null,
      markedValue: null,
      unrealizedPnl: null,
      markProvenance: { source: null, asOf: null, computedAt: COMPUTED_AT, status: 'missing' },
      risk: { hasValidStop: false, stopPrice: null, currentRiskToStop: null, openTrades: 1 },
    });
    renderTable([incalculable, position({ symbol: 'NVDA', unrealizedPnl: '414.00' })]);

    const pnlCells = screen
      .getByTestId('ws-positions-table')
      .querySelectorAll('[data-testid="ws-position-cell-pnl"]');
    const byRow = new Map(
      Array.from(pnlCells).map((cell) => {
        const row = (cell as HTMLElement).closest('tr');
        const symbol = row?.querySelector('td')?.textContent ?? '';
        return [symbol, cell.textContent];
      }),
    );
    expect(byRow.get('CRWD')).toBe('—');
    expect(byRow.get('NVDA')).toBe('$414.00');
  });

  it('renders P&L sign classes for positive and negative values', () => {
    const positive = position({ symbol: 'AAA', unrealizedPnl: '414.00' });
    const negative = position({ symbol: 'BBB', unrealizedPnl: '-78.25' });
    renderTable([positive, negative]);

    const rows = screen.getByTestId('ws-positions-table').querySelectorAll('tbody tr');
    const classes = Array.from(rows).map((tr) =>
      tr.querySelector('[data-testid="ws-position-cell-pnl"]')?.getAttribute('class') ?? '',
    );
    expect(classes.join(' ')).toContain('ws-pos');
    expect(classes.join(' ')).toContain('ws-neg');
  });

  it('renders active stop or No valid stop', () => {
    renderTable();
    const nvdaRow = screen.getByTestId('ws-position-row-NVDA');
    expect(nvdaRow.textContent).toContain('$127.90');

    const tslaRow = screen.getByTestId('ws-position-row-TSLA');
    expect(tslaRow.textContent).toContain('No valid stop');
  });

  it('renders current risk or Incomplete with a stable testid', () => {
    renderTable();
    const nvdaRow = screen.getByTestId('ws-position-row-NVDA');
    expect(
      within(nvdaRow).getByTestId('ws-position-cell-risk').textContent,
    ).toContain('$474.00');

    const tslaRow = screen.getByTestId('ws-position-row-TSLA');
    expect(
      within(tslaRow).getByTestId('ws-position-cell-risk').textContent,
    ).toContain('Incomplete');
  });

  it('renders exposure with mark-completeness state for stale marks', () => {
    renderTable();
    const tslaRow = screen.getByTestId('ws-position-row-TSLA');
    // Stale exposure keeps its value and adds the state sub-line.
    expect(tslaRow.textContent).toContain('$6,248.25');
    expect(tslaRow.textContent).toContain('Stale');
  });

  it('renders the empty state with the R034 text and no table', () => {
    renderTable([]);
    expect(screen.getByTestId('ws-positions-empty').textContent).toContain(
      'No open account positions',
    );
    expect(screen.queryByTestId('ws-positions-table')).toBeNull();
    expect(
      screen.getByTestId('ws-panel-positions').textContent,
    ).toContain('Open account positions: 0');
  });
});

// ── Readability contract (R034 §8.1) ────────────────────────────────────
// Reading workstation.css from disk is intentional: this guards the CSS
// token file itself, not a compiled copy (same approach as
// token-structure.test.ts for globals.css).

const WORKSTATION_CSS_PATH = path.resolve(
  process.cwd(),
  'src/app/(workstation)/workspace/workstation.css',
);

function extractWsTokens(): Record<string, string> {
  const css = fs.readFileSync(WORKSTATION_CSS_PATH, 'utf-8');
  const start = css.indexOf('.ws {');
  expect(start, 'workstation.css must contain a ".ws {" block').toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end, '".ws" block must close with "}" on its own line').toBeGreaterThan(start);
  const block = css.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^\s*(--[\w-]+):\s*([^;]+);/.exec(line);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

describe('readability tokens (R034 §8.1)', () => {
  const wsTokens = extractWsTokens();

  it('declares the type-scale tiers at the §8.1 minimums', () => {
    // Decision labels / table headers ≥12px.
    expect(wsTokens['--ws-text-xs']).toBe('12px');
    // Data cells ≥13px.
    expect(wsTokens['--ws-text-sm']).toBe('13px');
    // Primary financial values within 16–20px.
    expect(wsTokens['--ws-text-lg']).toBe('16px');
    expect(wsTokens['--ws-text-xl']).toBe('20px');
  });

  it('declares the row-height tiers within the 36–40px contract', () => {
    expect(wsTokens['--ws-row-sm']).toBe('36px');
    expect(wsTokens['--ws-row-md']).toBe('40px');
  });

  it('uses the token tiers in the table styles', () => {
    const css = fs.readFileSync(WORKSTATION_CSS_PATH, 'utf-8');
    // Headers use the ≥12px decision-label tier.
    expect(css).toMatch(/\.ws-table th\s*{[\s\S]*?font-size: var\(--ws-text-xs\)/);
    // The positions table rows use the 40px standard tier (36–40px contract).
    expect(css).toMatch(/\.ws-positions-table td\s*{[\s\S]*?height: var\(--ws-row-md\)/);
    // Primary-value cells use the 16px tier.
    expect(css).toMatch(/\.ws-cell-primary\s*{[\s\S]*?font-size: var\(--ws-text-lg\)/);
  });
});

// ── Never-re-implement contract ─────────────────────────────────────────
// The table must stay a pure consumer of API state: it should not accept or
// recompute freshness/coverage from inputs the API does not declare.

describe('RiskPositionsTable API contract', () => {
  it('consumes exactly the DashboardPositionSummary shape', () => {
    // Type-level pin: the prop type is DashboardV2Response positions.
    const v2: Pick<DashboardV2Response, 'valuation'> = {
      valuation: { positions: DEFAULT_POSITIONS } as DashboardV2Response['valuation'],
    };
    render(<RiskPositionsTable positions={v2.valuation.positions} />);
    expect(screen.getByTestId('ws-positions-table')).toBeTruthy();
  });
});
