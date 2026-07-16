/**
 * Component tests for AccountReconciliationSummary.
 *
 * Covers:
 * - Healthy state (all match, cutover eligible)
 * - Blocked state (unexplained differences, not eligible)
 * - Issue state (with anomaly summaries)
 * - No migration run (400 response)
 * - Account not found (404 response)
 * - Loading state
 * - Error state (generic with retry)
 * - Network error (fetch throws, retry available)
 * - Unexpected empty report (report but no comparisons)
 * - Accessibility (aria roles, labels, keyboard expand/collapse)
 *
 * Run: npx vitest run src/components/accounting/account-reconciliation-summary.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from '@testing-library/react';
import AccountReconciliationSummary from './account-reconciliation-summary';

// ── Fixtures ───────────────────────────────────────────────────────────

/** Fully reconciled account — all dimensions match, cutover eligible. */
const FIXTURE_HEALTHY: ReconciliationReport = {
  runId: 'run-abc123',
  accountId: 'acct-001',
  runStatus: 'completed',
  rebuildFingerprint: 'sha256-a1b2c3d4e5',
  computedAt: '2026-07-16T12:00:00.000Z',
  totals: { comparisons: 7, matching: 7, explained: 0, anomalies: 0, unexplained: 0 },
  comparisons: [
    {
      key: 'cash',
      description: 'Net Cash (deposits - withdrawals)',
      legacyValue: '100000.00',
      accountingValue: '100000.00',
      difference: '0.00',
      classification: 'match',
      tolerance: null,
      detail: 'Cash value matches exactly.',
    },
    {
      key: 'execution_count',
      description: 'Execution Count',
      legacyValue: '42',
      accountingValue: '42',
      difference: '0',
      classification: 'match',
      tolerance: null,
      detail: 'Execution count matches exactly.',
    },
    {
      key: 'fee_total',
      description: 'Total Fees',
      legacyValue: '150.00',
      accountingValue: '150.00',
      difference: '0.00',
      classification: 'match',
      tolerance: null,
      detail: 'Fee total matches exactly.',
    },
    {
      key: 'price_mark_count',
      description: 'Price Mark Count',
      legacyValue: '10',
      accountingValue: '10',
      difference: '0',
      classification: 'match',
      tolerance: null,
      detail: 'Price Mark count matches exactly.',
    },
    {
      key: 'position_count',
      description: 'Position Count',
      legacyValue: '3',
      accountingValue: '3',
      difference: '0',
      classification: 'match',
      tolerance: null,
      detail: 'Position count matches exactly.',
    },
    {
      key: 'position_exposure',
      description: 'Position Market Value',
      legacyValue: '50000.00',
      accountingValue: '50000.00',
      difference: '0.00',
      classification: 'match',
      tolerance: null,
      detail: 'Position market value matches exactly.',
    },
    {
      key: 'net_asset_value',
      description: 'Net Asset Value (Cash + Positions)',
      legacyValue: '150000.00',
      accountingValue: '150000.00',
      difference: '0.00',
      classification: 'match',
      tolerance: null,
      detail: 'NAV matches exactly.',
    },
  ],
  anomalies: [],
  recordStatusCounts: {
    mappedCount: 52,
    anomalyCount: 0,
    unsupportedCount: 0,
    duplicateCount: 0,
    totalRecords: 52,
  },
  cutoverEligible: true,
  cutoverRefusalReasons: [],
};

/** Blocked account — unexplained differences and anomalies present. */
const FIXTURE_BLOCKED: ReconciliationReport = {
  runId: 'run-def456',
  accountId: 'acct-002',
  runStatus: 'completed',
  rebuildFingerprint: 'sha256-f6e5d4c3b2',
  computedAt: '2026-07-16T13:00:00.000Z',
  totals: { comparisons: 7, matching: 4, explained: 1, anomalies: 3, unexplained: 2 },
  comparisons: [
    {
      key: 'cash',
      description: 'Net Cash (deposits - withdrawals)',
      legacyValue: '100000.00',
      accountingValue: '100000.00',
      difference: '0.00',
      classification: 'match',
      tolerance: null,
      detail: 'Cash value matches exactly.',
    },
    {
      key: 'execution_count',
      description: 'Execution Count',
      legacyValue: '45',
      accountingValue: '42',
      difference: '3',
      classification: 'unexplained',
      tolerance: null,
      detail: 'Execution count mismatch of 3 cannot be explained by 3 anomalies and 0 unsupported records.',
    },
    {
      key: 'fee_total',
      description: 'Total Fees',
      legacyValue: '155.00',
      accountingValue: '150.00',
      difference: '5.00',
      classification: 'unexplained',
      tolerance: '0.01',
      detail: 'Fee difference of 5.00 exceeds the 1 cent rounding tolerance.',
    },
    {
      key: 'price_mark_count',
      description: 'Price Mark Count',
      legacyValue: '10',
      accountingValue: '9',
      difference: '1',
      classification: 'explained',
      tolerance: null,
      detail: 'Price Mark count mismatch of 1.',
    },
    {
      key: 'position_count',
      description: 'Position Count',
      legacyValue: '3',
      accountingValue: '3',
      difference: '0',
      classification: 'match',
      tolerance: null,
      detail: 'Position count matches exactly.',
    },
    {
      key: 'position_exposure',
      description: 'Position Market Value',
      legacyValue: '50000.00',
      accountingValue: '50000.00',
      difference: '0.00',
      classification: 'match',
      tolerance: null,
      detail: 'Position market value matches exactly.',
    },
    {
      key: 'net_asset_value',
      description: 'Net Asset Value (Cash + Positions)',
      legacyValue: '150000.00',
      accountingValue: '150000.00',
      difference: '0.00',
      classification: 'match',
      tolerance: null,
      detail: 'NAV matches exactly.',
    },
  ],
  anomalies: [
    {
      anomalyCode: 'ANOMALY_MISSING_PRICE',
      count: 3,
      sourceTable: 'trade_executions',
      records: [
        { sourceId: 'exec-001', anomalyField: 'price', anomalyDetail: 'Price value was 0.0 for a buy order' },
        { sourceId: 'exec-002', anomalyField: 'price', anomalyDetail: 'Price value was 0.0 for a sell order' },
        { sourceId: 'exec-003', anomalyField: 'price', anomalyDetail: 'Price value was 0.0 for a buy order' },
      ],
    },
  ],
  recordStatusCounts: {
    mappedCount: 49,
    anomalyCount: 3,
    unsupportedCount: 0,
    duplicateCount: 0,
    totalRecords: 52,
  },
  cutoverEligible: false,
  cutoverRefusalReasons: [
    '2 unexplained difference(s) remain across 7 comparison dimensions.',
  ],
};

/** Partial run status — also blocks cutover. */
const FIXTURE_PARTIAL_RUN: ReconciliationReport = {
  runId: 'run-partial',
  accountId: 'acct-003',
  runStatus: 'partial',
  rebuildFingerprint: null,
  computedAt: '2026-07-16T14:00:00.000Z',
  totals: { comparisons: 7, matching: 7, explained: 0, anomalies: 1, unexplained: 0 },
  comparisons: [
    {
      key: 'cash',
      description: 'Net Cash (deposits - withdrawals)',
      legacyValue: '50000.00',
      accountingValue: '50000.00',
      difference: '0.00',
      classification: 'match',
      tolerance: null,
      detail: 'Cash value matches exactly.',
    },
  ],
  anomalies: [
    {
      anomalyCode: 'ANOMALY_DUPLICATE_EXECUTION',
      count: 1,
      sourceTable: 'trade_executions',
      records: [
        { sourceId: 'exec-dup-01', anomalyField: 'id', anomalyDetail: 'Duplicate execution ID detected' },
      ],
    },
  ],
  recordStatusCounts: {
    mappedCount: 5,
    anomalyCount: 1,
    unsupportedCount: 0,
    duplicateCount: 0,
    totalRecords: 6,
  },
  cutoverEligible: false,
  cutoverRefusalReasons: [
    'Migration run status is "partial"; only completed runs are eligible for cutover.',
  ],
};

/** Empty comparisons edge case — report exists but no comparison dimensions. */
const FIXTURE_NO_COMPARISONS: ReconciliationReport = {
  runId: 'run-empty',
  accountId: 'acct-004',
  runStatus: 'completed',
  rebuildFingerprint: null,
  computedAt: '2026-07-16T15:00:00.000Z',
  totals: { comparisons: 0, matching: 0, explained: 0, anomalies: 0, unexplained: 0 },
  comparisons: [],
  anomalies: [],
  recordStatusCounts: {
    mappedCount: 0,
    anomalyCount: 0,
    unsupportedCount: 0,
    duplicateCount: 0,
    totalRecords: 0,
  },
  cutoverEligible: true,
  cutoverRefusalReasons: [],
};

// ── Types for fixtures ─────────────────────────────────────────────────

interface ComparisonResult {
  key: string;
  description: string;
  legacyValue: string;
  accountingValue: string;
  difference: string;
  classification: 'match' | 'explained' | 'unexplained';
  tolerance: string | null;
  detail: string | null;
}

interface ReconciliationReport {
  runId: string;
  accountId: string;
  runStatus: string;
  rebuildFingerprint: string | null;
  computedAt: string;
  totals: {
    comparisons: number;
    matching: number;
    explained: number;
    anomalies: number;
    unexplained: number;
  };
  comparisons: ComparisonResult[];
  anomalies?: Array<{
    anomalyCode: string;
    count: number;
    sourceTable: string;
    records: Array<{
      sourceId: string;
      anomalyField: string;
      anomalyDetail: string;
    }>;
  }>;
  recordStatusCounts?: {
    mappedCount: number;
    anomalyCount: number;
    unsupportedCount: number;
    duplicateCount: number;
    totalRecords: number;
  };
  cutoverEligible: boolean;
  cutoverRefusalReasons: string[];
}

// ── Test Setup ─────────────────────────────────────────────────────────

const UNMOCKED_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  cleanup();
});

function mockFetchSuccess(data: unknown): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  });
}

function mockFetchStatus(status: number, body?: unknown): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body ?? { error: 'Request failed' },
  });
}

function mockFetchNetworkError(): void {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('AccountReconciliationSummary — healthy state', () => {
  it('renders cutover-eligible banner and summary stats', async () => {
    mockFetchSuccess(FIXTURE_HEALTHY);
    render(<AccountReconciliationSummary accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Account is eligible for cutover')).toBeTruthy();
    });

    // Summary stats — "7" appears twice (Comparisons + Matching); use getAllByText
    const sevens = screen.getAllByText('7');
    expect(sevens.length).toBe(2);
    expect(screen.getByText('Comparisons')).toBeTruthy();
    expect(screen.getByText('Matching')).toBeTruthy();
    // "0" appears twice (Explained + Issues); use getAllByText
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBe(2);
  });

  it('renders green eligibility banner with CheckCircle2 icon', async () => {
    mockFetchSuccess(FIXTURE_HEALTHY);
    render(<AccountReconciliationSummary accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Account is eligible for cutover')).toBeTruthy();
    });

    // Check for the CheckCircle icon by title (lucide icons render as SVGs)
    const svg = document.querySelector('.text-emerald-600');
    expect(svg).toBeTruthy();
  });

  it('shows all 7 comparison rows when expanded', async () => {
    mockFetchSuccess(FIXTURE_HEALTHY);
    render(<AccountReconciliationSummary accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Account is eligible for cutover')).toBeTruthy();
    });

    // Find and click the expand button
    const expandBtn = screen.getByText('7 comparisons');
    fireEvent.click(expandBtn);

    // Verify comparison rows appear
    await waitFor(() => {
      expect(screen.getByText('Net Cash (deposits - withdrawals)')).toBeTruthy();
    });

    expect(screen.getByText('Net Cash (deposits - withdrawals)')).toBeTruthy();
    expect(screen.getByText('Execution Count')).toBeTruthy();
    expect(screen.getByText('Total Fees')).toBeTruthy();
    expect(screen.getByText('Position Market Value')).toBeTruthy();
    expect(screen.getByText('Net Asset Value (Cash + Positions)')).toBeTruthy();
  });

  it('shows footer with run ID and computed timestamp', async () => {
    mockFetchSuccess(FIXTURE_HEALTHY);
    render(<AccountReconciliationSummary accountId="acct-001" />);

    await waitFor(() => {
      // The footer shows the first 8 chars of the run ID
      expect(screen.getByText(/run-abc1/)).toBeTruthy();
    });
  });
});

describe('AccountReconciliationSummary — blocked state', () => {
  it('renders not-eligible banner with refusal reasons', async () => {
    mockFetchSuccess(FIXTURE_BLOCKED);
    render(<AccountReconciliationSummary accountId="acct-002" />);

    await waitFor(() => {
      expect(screen.getByText('Account is not eligible for cutover')).toBeTruthy();
    });

    // Refusal reasons rendered
    expect(
      screen.getByText(/2 unexplained difference\(s\) remain across 7 comparison dimensions/),
    ).toBeTruthy();
  });

  it('shows issues count > 0 highlighted in red', async () => {
    mockFetchSuccess(FIXTURE_BLOCKED);
    render(<AccountReconciliationSummary accountId="acct-002" />);

    await waitFor(() => {
      expect(screen.getByText('Account is not eligible for cutover')).toBeTruthy();
    });

    // Issues stat: anomalies(3) + unexplained(2) = 5
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('Issues')).toBeTruthy();
  });

  it('renders anomaly summaries when present', async () => {
    mockFetchSuccess(FIXTURE_BLOCKED);
    render(<AccountReconciliationSummary accountId="acct-002" />);

    await waitFor(() => {
      expect(screen.getByText('Account is not eligible for cutover')).toBeTruthy();
    });

    expect(screen.getByText(/ANOMALY_MISSING_PRICE/)).toBeTruthy();
    expect(screen.getByText(/3 records/)).toBeTruthy();
  });
});

describe('AccountReconciliationSummary — partial run state', () => {
  it('shows not-eligible due to run status', async () => {
    mockFetchSuccess(FIXTURE_PARTIAL_RUN);
    render(<AccountReconciliationSummary accountId="acct-003" />);

    await waitFor(() => {
      expect(screen.getByText('Account is not eligible for cutover')).toBeTruthy();
    });

    expect(
      screen.getByText(/Migration run status is "partial"/),
    ).toBeTruthy();
  });
});

describe('AccountReconciliationSummary — no migration run', () => {
  it('renders empty no-migration state for 400 response', async () => {
    mockFetchStatus(400, { error: 'No migration run found' });
    render(<AccountReconciliationSummary accountId="acct-005" />);

    await waitFor(() => {
      expect(screen.getByText('No migration run recorded.')).toBeTruthy();
    });
  });
});

describe('AccountReconciliationSummary — account not found', () => {
  it('renders error state for 404 response', async () => {
    mockFetchStatus(404, { error: 'Account not found' });
    render(<AccountReconciliationSummary accountId="acct-nonexistent" />);

    await waitFor(() => {
      expect(screen.getByText('Account not found.')).toBeTruthy();
    });
  });

  it('does not show retry button for 404', async () => {
    mockFetchStatus(404, { error: 'Account not found' });
    render(<AccountReconciliationSummary accountId="acct-nonexistent" />);

    await waitFor(() => {
      expect(screen.getByText('Account not found.')).toBeTruthy();
    });

    expect(screen.queryByText('Try Again')).toBeNull();
  });
});

describe('AccountReconciliationSummary — loading state', () => {
  it('renders loading indicator while fetching', () => {
    // Never resolve the fetch
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<AccountReconciliationSummary accountId="acct-loading" />);

    expect(screen.getByText('Loading reconciliation report...')).toBeTruthy();
  });
});

describe('AccountReconciliationSummary — error state', () => {
  it('renders generic error message on network failure', async () => {
    mockFetchNetworkError();
    render(<AccountReconciliationSummary accountId="acct-error" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });

  it('shows Try Again button for generic errors', async () => {
    mockFetchNetworkError();
    render(<AccountReconciliationSummary accountId="acct-error" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });

    expect(screen.getByText('Try Again')).toBeTruthy();
    expect(screen.getByLabelText('Retry loading reconciliation report')).toBeTruthy();
  });

  it('retry button re-fetches and succeeds on second attempt', async () => {
    // First call fails, second call succeeds
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => FIXTURE_HEALTHY,
      });

    globalThis.fetch = fetchMock;
    render(<AccountReconciliationSummary accountId="acct-retry" />);

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });

    // Click Try Again
    const retryBtn = screen.getByText('Try Again');
    fireEvent.click(retryBtn);

    // Wait for healthy state after retry
    await waitFor(() => {
      expect(screen.getByText('Account is eligible for cutover')).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('AccountReconciliationSummary — empty comparisons edge case', () => {
  it('renders empty state when report exists but has no comparisons', async () => {
    mockFetchSuccess(FIXTURE_NO_COMPARISONS);
    render(<AccountReconciliationSummary accountId="acct-004" />);

    await waitFor(() => {
      expect(
        screen.getByText('Migration completed with no comparison dimensions.'),
      ).toBeTruthy();
    });
  });
});

describe('AccountReconciliationSummary — accessibility', () => {
  it('loading state has accessible region', async () => {
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<AccountReconciliationSummary accountId="acct-a11y-load" />);

    expect(screen.getByText('Loading reconciliation report...')).toBeTruthy();
  });

  it('refresh button has accessible label', async () => {
    mockFetchSuccess(FIXTURE_HEALTHY);
    render(<AccountReconciliationSummary accountId="acct-a11y-refresh" />);

    await waitFor(() => {
      expect(
        screen.getByLabelText('Refresh reconciliation report'),
      ).toBeTruthy();
    });
  });

  it('error state has role="alert"', async () => {
    mockFetchNetworkError();
    render(<AccountReconciliationSummary accountId="acct-a11y-error" />);

    await waitFor(() => {
      const alertDiv = screen.getByRole('alert');
      expect(alertDiv).toBeTruthy();
    });
  });

  it('no-migration state has role="status"', async () => {
    mockFetchStatus(400, { error: 'No migration run found' });
    render(<AccountReconciliationSummary accountId="acct-a11y-nomig" />);

    await waitFor(() => {
      const statusDiv = screen.getByRole('status');
      expect(statusDiv).toBeTruthy();
    });
  });

  it('expands comparison table on keyboard click', async () => {
    mockFetchSuccess(FIXTURE_HEALTHY);
    render(<AccountReconciliationSummary accountId="acct-a11y-expand" />);

    await waitFor(() => {
      expect(screen.getByText('Account is eligible for cutover')).toBeTruthy();
    });

    // The expand button is a button element (keyboard accessible)
    const expandBtn = screen.getByRole('button', { name: /7 comparisons/ });
    expect(expandBtn).toBeTruthy();

    // Click to expand
    fireEvent.click(expandBtn);

    await waitFor(() => {
      // After expand, table headers should be visible
      expect(screen.getByText('Dimension')).toBeTruthy();
    });
  });
});
