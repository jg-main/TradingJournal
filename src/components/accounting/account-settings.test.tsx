/**
 * Component tests for AccountSettings.
 *
 * Covers:
 * - Loading state (spinner/text)
 * - Populated render with identity and trading defaults
 * - Editing name with save success
 * - Editing trading defaults (max risk and commission)
 * - Validation error (empty name)
 * - API error with retry
 * - NULL fallback display with global default hints
 * - Save success message
 *
 * Run: npx vitest run --reporter verbose src/components/accounting/account-settings.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import AccountSettings from './account-settings';

// ── Fixtures ───────────────────────────────────────────────────────────

/** Account with all fields populated (non-null). */
const ACCT_FULL = {
  id: 'acct-001',
  name: 'Main Brokerage',
  broker: 'Interactive Brokers',
  currency: 'USD',
  isActive: true,
  maxRiskPerTradePct: 2.5,
  defaultCommission: 1.00,
  startingBalance: 50000.00,
};

/** Account with NULL trading defaults (falls back to globals). */
const ACCT_NULL_DEFAULTS = {
  id: 'acct-002',
  name: 'Null Defaults Account',
  broker: 'Tastyworks',
  currency: 'USD',
  isActive: true,
  maxRiskPerTradePct: null,
  defaultCommission: null,
  startingBalance: null,
};

/** Account that is inactive. */
const ACCT_INACTIVE = {
  id: 'acct-003',
  name: 'Closed Account',
  broker: null,
  currency: 'USD',
  isActive: false,
  maxRiskPerTradePct: 2.0,
  defaultCommission: 0.50,
  startingBalance: 10000.00,
};

/** Global settings fixture with default values. */
const GLOBAL_SETTINGS = {
  id: 'settings-001',
  maxRiskPerTradePct: 2.0,
  defaultCommission: 0.50,
  startingAccountValue: 25000.00,
};

// ── Test Setup ─────────────────────────────────────────────────────────

const UNMOCKED_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  cleanup();
});

function mockFetchSuccess(
  accountData: unknown = ACCT_FULL,
  globalData: unknown = GLOBAL_SETTINGS,
) {
  const mockFn = vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => accountData,
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => globalData,
    });
  globalThis.fetch = mockFn;
}

function mockFetchNetworkError() {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('AccountSettings — loading state', () => {
  it('renders loading indicator while fetching', () => {
    // Never resolve the fetch
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    render(<AccountSettings accountId="acct-loading" />);

    expect(screen.getByRole('status').textContent).toContain('Loading settings...');
  });
});

describe('AccountSettings — populated state', () => {
  it('renders account identity section with status and name field', async () => {
    mockFetchSuccess(ACCT_FULL);
    render(<AccountSettings accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Account Identity')).toBeTruthy();
    });

    // Section headings
    expect(screen.getByText('Account Identity')).toBeTruthy();
    expect(screen.getByText('Trading Defaults')).toBeTruthy();

    // Status badge
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Status:')).toBeTruthy();

    // Name field shows the account name
    const nameInput = screen.getByLabelText('Account Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Main Brokerage');
  });

  it('renders trading default fields with populated values', async () => {
    mockFetchSuccess(ACCT_FULL);
    render(<AccountSettings accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Trading Defaults')).toBeTruthy();
    });

    // Check field labels are rendered
    expect(screen.getByText('Max Risk Per Trade (%)')).toBeTruthy();
    expect(screen.getByText('Default Commission ($)')).toBeTruthy();
    expect(screen.getByText('Opening cash is recorded as a cash transaction in the Ledger, not as an account setting.')).toBeTruthy();
    expect(screen.queryByText('Starting Balance ($)')).toBeNull();

    // Check input values
    const maxRiskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    expect(maxRiskInput.value).toBe('2.5');

    const commissionInput = screen.getByLabelText('Default Commission ($)') as HTMLInputElement;
    expect(commissionInput.value).toBe('1');
  });

  it('renders Save and Discard changes buttons', async () => {
    mockFetchSuccess(ACCT_FULL);
    render(<AccountSettings accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByText('Discard changes')).toBeTruthy();
  });

  it('shows "Inactive" badge for inactive accounts', async () => {
    mockFetchSuccess(ACCT_INACTIVE);
    render(<AccountSettings accountId="acct-003" />);

    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeTruthy();
    });
  });
});

describe('AccountSettings — NULL fallback display', () => {
  it('shows explicit set-override actions for inherited fields', async () => {
    mockFetchSuccess(ACCT_NULL_DEFAULTS, GLOBAL_SETTINGS);
    render(<AccountSettings accountId="acct-002" />);

    await screen.findByText('Trading Defaults');

    expect(screen.getAllByText('Set override')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Set max risk account override' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set commission account override' })).toBeTruthy();
  });

  it('shows inherited effective values when global settings are available', async () => {
    mockFetchSuccess(ACCT_NULL_DEFAULTS, GLOBAL_SETTINGS);
    render(<AccountSettings accountId="acct-002" />);

    const riskStatus = await screen.findByLabelText('Effective max risk per trade');
    const commissionStatus = screen.getByLabelText('Effective default commission');

    expect(riskStatus.textContent).toContain('Inherited');
    expect(riskStatus.textContent).toContain('2%');
    expect(commissionStatus.textContent).toContain('Inherited');
    expect(commissionStatus.textContent).toContain('$0.50');
  });
});

describe('AccountSettings — edit and save flow', () => {
  it('edits account name and saves successfully', async () => {
    const fetchMock = vi.fn()
      // Initial account and settings load
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ACCT_FULL,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => GLOBAL_SETTINGS,
      })
      // The successful PUT response becomes the persisted display state.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...ACCT_FULL, name: 'Updated Brokerage' }),
      });
    globalThis.fetch = fetchMock;

    render(<AccountSettings accountId="acct-001" />);

    // Wait for load
    await waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Edit the name
    const nameInput = screen.getByLabelText('Account Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Updated Brokerage' } });

    // Click Save
    fireEvent.click(screen.getByText('Save'));

    // Wait for success message
    await waitFor(() => {
      expect(screen.getByText('Settings saved successfully.')).toBeTruthy();
    });
    expect(screen.getByText('Settings saved successfully.').closest('[role="status"]')).toBeTruthy();

    // Verify the PUT payload included name
    const putCall = fetchMock.mock.calls[2];
    expect(putCall[0]).toBe('/api/accounts/acct-001');
    expect(putCall[1]).toBeDefined();
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.name).toBe('Updated Brokerage');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('edits trading defaults and saves null values correctly', async () => {
    const fetchMock = vi.fn()
      // Load: account + settings
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ACCT_FULL,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => GLOBAL_SETTINGS,
      })
      // Save: PUT succeeds and returns the persisted account.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...ACCT_FULL,
          maxRiskPerTradePct: 3.0,
          defaultCommission: 2.00,
          startingBalance: null,
        }),
      });
    globalThis.fetch = fetchMock;

    render(<AccountSettings accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Edit max risk
    const maxRiskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    fireEvent.change(maxRiskInput, { target: { value: '3.0' } });

    // Edit commission
    const commissionInput = screen.getByLabelText('Default Commission ($)') as HTMLInputElement;
    fireEvent.change(commissionInput, { target: { value: '2' } });

    // Click Save
    fireEvent.click(screen.getByText('Save'));

    // Wait for success message
    await waitFor(() => {
      expect(screen.getByText('Settings saved successfully.')).toBeTruthy();
    });

    // Verify the PUT payload
    const putCall = fetchMock.mock.calls[2];
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.maxRiskPerTradePct).toBe(3.0);
    expect(body.defaultCommission).toBe(2);
    expect(body).not.toHaveProperty('startingBalance');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('Overridden');
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('3%');
  });
});

describe('AccountSettings — validation', () => {
  it('shows validation error when name is empty', async () => {
    mockFetchSuccess(ACCT_FULL);
    render(<AccountSettings accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Clear the name field
    const nameInput = screen.getByLabelText('Account Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });

    // Click Save
    fireEvent.click(screen.getByText('Save'));

    // Validation error should appear
    await waitFor(() => {
      expect(screen.getByText('Account name is required.')).toBeTruthy();
    });
  });

  it('clears validation error when name is re-entered', async () => {
    mockFetchSuccess(ACCT_FULL);
    render(<AccountSettings accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Clear the name field and try to save
    const nameInput = screen.getByLabelText('Account Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('Account name is required.')).toBeTruthy();
    });

    // Re-enter the name
    fireEvent.change(nameInput, { target: { value: 'My Account' } });

    // Error should be gone
    expect(screen.queryByText('Account name is required.')).toBeNull();
  });
});

describe('AccountSettings — API errors', () => {
  it('renders error message and retry button on network error', async () => {
    mockFetchNetworkError();
    render(<AccountSettings accountId="acct-error" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load account data.')).toBeTruthy();
    });

    expect(screen.getByRole('alert').textContent).toContain('Failed to load account data.');
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('retry button re-fetches and recovers', async () => {
    // First call fails
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    render(<AccountSettings accountId="acct-retry" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load account data.')).toBeTruthy();
    });

    // Set up success for retry
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ACCT_FULL,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => GLOBAL_SETTINGS,
    });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByText('Account Identity')).toBeTruthy();
    });
  });

  it('shows error message when account is not found (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Account not found' }),
    });

    render(<AccountSettings accountId="acct-missing" />);

    await waitFor(() => {
      expect(screen.getByText('Account not found.')).toBeTruthy();
    });
  });

  it('shows error from save API call', async () => {
    const fetchMock = vi.fn()
      // Load: account + settings
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ACCT_FULL,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => GLOBAL_SETTINGS,
      })
      // Save: PUT fails with validation error
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Validation failed',
          details: { fieldErrors: { maxRiskPerTradePct: ['Must be positive'] } },
        }),
      });
    globalThis.fetch = fetchMock;

    render(<AccountSettings accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy();
    });

    // Change and save
    const maxRiskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    fireEvent.change(maxRiskInput, { target: { value: '-1' } });
    fireEvent.click(screen.getByText('Save'));

    // Wait for error message from API
    await waitFor(() => {
      expect(screen.getByText('Validation failed')).toBeTruthy();
    });
  });
});

describe('AccountSettings — explicit override and reset actions', () => {
  it('stages a reset and can restore the persisted account value', async () => {
    mockFetchSuccess(ACCT_FULL, GLOBAL_SETTINGS);
    render(<AccountSettings accountId="acct-001" />);

    await screen.findByText('Trading Defaults');

    const maxRiskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    expect(maxRiskInput.value).toBe('2.5');
    fireEvent.click(screen.getByRole('button', { name: 'Reset max risk to global default' }));

    expect(maxRiskInput.value).toBe('');
    expect(screen.getByRole('button', { name: 'Set max risk account override' })).toBeTruthy();
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('Overridden');

    fireEvent.click(screen.getByRole('button', { name: 'Set max risk account override' }));
    expect(maxRiskInput.value).toBe('2.5');
  });

  it('stages an override for an inherited field and can reset the draft', async () => {
    mockFetchSuccess(ACCT_NULL_DEFAULTS, GLOBAL_SETTINGS);
    render(<AccountSettings accountId="acct-002" />);

    await screen.findByLabelText('Effective max risk per trade');
    fireEvent.click(screen.getByRole('button', { name: 'Set max risk account override' }));

    const maxRiskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    fireEvent.change(maxRiskInput, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset max risk to global default' }));

    expect(maxRiskInput.value).toBe('');
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('Inherited');
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('2%');
  });
});

describe('AccountSettings — "Discard changes"', () => {
  it('reloads account data when Discard changes is clicked', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ACCT_FULL,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => GLOBAL_SETTINGS,
      })
      // Reload on discard
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ACCT_FULL,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => GLOBAL_SETTINGS,
      });
    globalThis.fetch = fetchMock;

    render(<AccountSettings accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Discard changes')).toBeTruthy();
    });

    // Edit name
    const nameInput = screen.getByLabelText('Account Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Unwanted Change' } });

    // Click Discard changes
    fireEvent.click(screen.getByText('Discard changes'));

    // After reload, the component re-renders (loading state then populated),
    // so we need to re-query for the input after the async reload completes.
    await waitFor(() => {
      const reloadedInput = screen.getByLabelText('Account Name') as HTMLInputElement;
      expect(reloadedInput.value).toBe('Main Brokerage');
    });
  });
});

describe('AccountSettings — truthful effective defaults', () => {
  it('renders valid zero inheritance and unavailable fields independently', async () => {
    mockFetchSuccess(ACCT_NULL_DEFAULTS, {
      ...GLOBAL_SETTINGS,
      maxRiskPerTradePct: 0,
      defaultCommission: null,
    });

    render(<AccountSettings accountId="acct-002" />);

    const riskStatus = await screen.findByLabelText('Effective max risk per trade');
    const commissionStatus = screen.getByLabelText('Effective default commission');

    expect(riskStatus.textContent).toContain('Inherited');
    expect(riskStatus.textContent).toContain('0%');
    expect(commissionStatus.textContent).toContain('Unavailable');
    expect(commissionStatus.textContent).toContain('Effective value unavailable');
  });

  it('keeps account overrides available when the global settings request fails', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ACCT_FULL })
      .mockRejectedValueOnce(new Error('Settings connection lost'));

    render(<AccountSettings accountId="acct-001" />);

    const riskStatus = await screen.findByLabelText('Effective max risk per trade');
    const commissionStatus = screen.getByLabelText('Effective default commission');

    expect(screen.getByLabelText('Account Name')).toBeTruthy();
    expect(riskStatus.textContent).toContain('Overridden');
    expect(riskStatus.textContent).toContain('2.5%');
    expect(commissionStatus.textContent).toContain('Overridden');
    expect(commissionStatus.textContent).toContain('$1.00');
  });

  it('retains a typed override and inherited persisted display after a failed save', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ACCT_NULL_DEFAULTS })
      .mockResolvedValueOnce({ ok: true, json: async () => GLOBAL_SETTINGS })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Validation failed', details: { fieldErrors: {} } }),
      });
    globalThis.fetch = fetchMock;

    render(<AccountSettings accountId="acct-002" />);

    await screen.findByLabelText('Effective max risk per trade');
    fireEvent.click(screen.getByRole('button', { name: 'Set max risk account override' }));

    const riskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    fireEvent.change(riskInput, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Validation failed');
    expect(riskInput.value).toBe('5');
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('Inherited');
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('2%');
  });

  it('retains the persisted override display when resetting it fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ACCT_FULL })
      .mockResolvedValueOnce({ ok: true, json: async () => GLOBAL_SETTINGS })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Failed to update account', details: 'database unavailable' }),
      });
    globalThis.fetch = fetchMock;

    render(<AccountSettings accountId="acct-001" />);

    await screen.findByLabelText('Effective max risk per trade');
    fireEvent.click(screen.getByRole('button', { name: 'Reset max risk to global default' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Failed to update account');
    expect((screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('Overridden');
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('2.5%');
  });

  it('reports inherited defaults unavailable when no settings row exists', async () => {
    mockFetchSuccess(ACCT_NULL_DEFAULTS, {
      message: 'No settings configured yet. Use PUT to create.',
    });

    render(<AccountSettings accountId="acct-002" />);

    const riskStatus = await screen.findByLabelText('Effective max risk per trade');
    const commissionStatus = screen.getByLabelText('Effective default commission');

    expect(riskStatus.getAttribute('role')).toBe('status');
    expect(riskStatus.textContent).toContain('Unavailable');
    expect(riskStatus.textContent).toContain('Effective value unavailable');
    expect(commissionStatus.textContent).toContain('Unavailable');
  });

  it('does not commit a malformed successful save response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ACCT_FULL })
      .mockResolvedValueOnce({ ok: true, json: async () => GLOBAL_SETTINGS })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'updated' }) });
    globalThis.fetch = fetchMock;

    render(<AccountSettings accountId="acct-001" />);

    await screen.findByLabelText('Effective max risk per trade');
    const riskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    fireEvent.change(riskInput, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('The server returned an invalid account response.');
    expect(riskInput.value).toBe('4');
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('2.5%');
  });

  it('retains drafts when the save connection is lost', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ACCT_NULL_DEFAULTS })
      .mockResolvedValueOnce({ ok: true, json: async () => GLOBAL_SETTINGS })
      .mockRejectedValueOnce(new Error('connection lost'));
    globalThis.fetch = fetchMock;

    render(<AccountSettings accountId="acct-002" />);

    await screen.findByLabelText('Effective max risk per trade');
    fireEvent.click(screen.getByRole('button', { name: 'Set max risk account override' }));
    const riskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    fireEvent.change(riskInput, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Failed to save settings.');
    expect(riskInput.value).toBe('6');
    expect(screen.getByLabelText('Effective max risk per trade').textContent).toContain('Inherited');
  });
});
