/**
 * Component tests for the Risk Defaults settings page.
 *
 * Covers:
 * - Loading state shows loading text
 * - Renders risk fields (maxRiskPerTradePct, defaultCommission) after loading
 * - Displays global fallback explanatory text
 * - No startingAccountValue, journalStartDate, or defaultAccountId fields in DOM
 * - Pre-populates fields from API response
 * - Save submits risk fields and hidden fields correctly
 * - API error displays error message
 * - Network error during initial fetch shows defaults
 * - Handles empty/null values gracefully
 *
 * Run: npx vitest run --reporter verbose src/app/settings/risk-defaults/__tests__/page.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ComponentType } from 'react';

let RiskDefaultsPage: ComponentType;

const mockPush = vi.fn();

// Mock next/navigation before importing the page
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link to render a simple anchor
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) =>
    React.createElement(
      'a',
      { href, className },
      children,
    ),
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/risk-defaults/page');
  RiskDefaultsPage = mod.default;
});

// ── Helpers ────────────────────────────────────────────────────────────

const UNMOCKED_FETCH = globalThis.fetch;

/** Full settings row including hidden fields that get round-tripped. */
const DEFAULT_SETTINGS = {
  id: 'sett-001',
  maxRiskPerTradePct: 2,
  defaultCommission: 0.5,
  startingAccountValue: 50000,
  defaultAccountId: null,
  currency: 'USD',
  journalStartDate: '2025-01-01',
  backupEnabled: false,
  backupRetentionCount: 3,
  backupLastRunAt: null,
  backupLastRunStatus: null,
  backupCronTime: '02:00',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-15T00:00:00.000Z',
};

function mockFetchSuccess(data: unknown = DEFAULT_SETTINGS) {
  const mockFn = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
  globalThis.fetch = mockFn;
  return mockFn;
}

function mockFetchNetworkError() {
  const mockFn = vi.fn().mockRejectedValue(new TypeError('Network request failed'));
  globalThis.fetch = mockFn;
  return mockFn;
}

// ── Tests ──────────────────────────────────────────────────────────────

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  mockPush.mockClear();
  cleanup();
});

describe('Risk Defaults settings page', () => {
  it('shows loading state initially', async () => {
    mockFetchSuccess(); // delayed by test framework
    const { container } = render(React.createElement(RiskDefaultsPage));
    expect(container.textContent).toContain('Loading risk defaults...');
  });

  it('renders heading, explanation, and both risk fields after load', async () => {
    mockFetchSuccess();
    render(React.createElement(RiskDefaultsPage));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /risk defaults/i })).toBeTruthy();
    });

    expect(screen.getByText('Back to Settings')).toBeTruthy();
    expect(screen.getByText(/global defaults for all accounts/i)).toBeTruthy();
    expect(screen.getByText(/individual accounts can override/i)).toBeTruthy();
    expect(screen.getByLabelText('Max Risk Per Trade (%)')).toBeTruthy();
    expect(screen.getByLabelText('Default Commission ($)')).toBeTruthy();
    expect(screen.getByText('Save Risk Defaults')).toBeTruthy();
  });

  it('pre-populates risk fields from the API response', async () => {
    mockFetchSuccess();
    render(React.createElement(RiskDefaultsPage));

    await waitFor(() => {
      const riskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
      expect(riskInput.value).toBe('2');
    });

    const commissionInput = screen.getByLabelText('Default Commission ($)') as HTMLInputElement;
    expect(commissionInput.value).toBe('0.5');
  });

  it('has no startingAccountValue, journalStartDate, or defaultAccountId fields', async () => {
    mockFetchSuccess();
    render(React.createElement(RiskDefaultsPage));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /risk defaults/i })).toBeTruthy();
    });

    // Should only have two number inputs (the risk fields)
    const numberInputs = screen.queryAllByRole('spinbutton');
    expect(numberInputs).toHaveLength(2);

    // Check that hidden field labels are absent
    expect(screen.queryByText(/starting.*account.*value/i)).toBeNull();
    expect(screen.queryByText(/journal.*start.*date/i)).toBeNull();
    // There should be no combobox/select for picking a default account
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByLabelText('Default Account')).toBeNull();
  });

  it('submits risk fields and round-trips hidden fields, then redirects', async () => {
    const fetchMock = mockFetchSuccess();
    const user = userEvent.setup();

    render(React.createElement(RiskDefaultsPage));

    await waitFor(() => {
      expect(screen.getByLabelText('Max Risk Per Trade (%)')).toBeTruthy();
    });

    // Change risk per trade
    const riskInput = screen.getByLabelText('Max Risk Per Trade (%)');
    await user.clear(riskInput);
    await user.type(riskInput, '3');

    // Click save
    await user.click(screen.getByText('Save Risk Defaults'));

    await waitFor(() => {
      // First call is GET on mount, second call is PUT on save
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const putCall = fetchMock.mock.calls[1];
    expect(putCall[0]).toBe('/api/settings');
    expect(putCall[1]?.method).toBe('PUT');

    const putBody = JSON.parse(putCall[1]?.body as string);
    expect(putBody).toMatchObject({
      maxRiskPerTradePct: 3,
      defaultCommission: 0.5,
    });
    // Hidden fields should be round-tripped
    expect(putBody).toHaveProperty('startingAccountValue', 50000);
    expect(putBody).toHaveProperty('journalStartDate', '2025-01-01');
    expect(putBody).toHaveProperty('defaultAccountId', null);
    expect(putBody).toHaveProperty('currency', 'USD');

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/settings');
    });
  });

  it('displays error message when save fails', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(DEFAULT_SETTINGS),
        });
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'Validation failed' }),
      });
    });
    globalThis.fetch = fetchMock;

    const user = userEvent.setup();
    render(React.createElement(RiskDefaultsPage));

    await waitFor(() => {
      expect(screen.getByLabelText('Max Risk Per Trade (%)')).toBeTruthy();
    });

    await user.click(screen.getByText('Save Risk Defaults'));

    await waitFor(() => {
      expect(screen.getByText('Validation failed')).toBeTruthy();
    });
  });

  it('shows success message after save', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            callCount === 1
              ? DEFAULT_SETTINGS
              : {
                  ...DEFAULT_SETTINGS,
                  maxRiskPerTradePct: 3,
                },
          ),
      });
    });
    globalThis.fetch = fetchMock;

    const user = userEvent.setup();
    render(React.createElement(RiskDefaultsPage));

    await waitFor(() => {
      expect(screen.getByLabelText('Max Risk Per Trade (%)')).toBeTruthy();
    });

    const riskInput = screen.getByLabelText('Max Risk Per Trade (%)');
    await user.clear(riskInput);
    await user.type(riskInput, '3');
    await user.click(screen.getByText('Save Risk Defaults'));

    await waitFor(() => {
      expect(screen.getByText(/Risk defaults saved/i)).toBeTruthy();
    });
  });

  it('handles null settings gracefully (no stored values)', async () => {
    mockFetchSuccess({
      id: 'sett-001',
      maxRiskPerTradePct: null,
      defaultCommission: null,
      startingAccountValue: null,
      defaultAccountId: null,
      currency: 'USD',
      journalStartDate: null,
      backupEnabled: false,
      backupRetentionCount: 3,
      backupLastRunAt: null,
      backupLastRunStatus: null,
      backupCronTime: '02:00',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-15T00:00:00.000Z',
    });

    render(React.createElement(RiskDefaultsPage));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /risk defaults/i })).toBeTruthy();
    });

    const riskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    expect(riskInput.value).toBe('');

    const commissionInput = screen.getByLabelText('Default Commission ($)') as HTMLInputElement;
    expect(commissionInput.value).toBe('');
  });

  it('falls back when initial fetch fails (network error)', async () => {
    mockFetchNetworkError();

    render(React.createElement(RiskDefaultsPage));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /risk defaults/i })).toBeTruthy();
    });

    // Fields should render empty
    const riskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    expect(riskInput.value).toBe('');
  });

  it('does not include null hidden fields in PUT body', async () => {
    const settingsWithNullHidden = {
      ...DEFAULT_SETTINGS,
      startingAccountValue: null as unknown as number,
      journalStartDate: null as unknown as string,
    };

    const fetchMock = mockFetchSuccess(settingsWithNullHidden);
    const user = userEvent.setup();

    render(React.createElement(RiskDefaultsPage));

    await waitFor(() => {
      expect(screen.getByLabelText('Max Risk Per Trade (%)')).toBeTruthy();
    });

    await user.click(screen.getByText('Save Risk Defaults'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    // Risk fields should be present
    expect(putBody).toHaveProperty('maxRiskPerTradePct');
    expect(putBody).toHaveProperty('defaultCommission');
    // Null hidden fields should NOT be included (avoids Zod validation failure)
    expect(putBody).not.toHaveProperty('startingAccountValue');
    expect(putBody).not.toHaveProperty('journalStartDate');
    // Non-null hidden fields should still be included
    expect(putBody).toHaveProperty('defaultAccountId', null);
    expect(putBody).toHaveProperty('currency', 'USD');
  });
});
