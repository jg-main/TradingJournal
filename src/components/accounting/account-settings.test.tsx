/**
 * Component tests for AccountSettings.
 *
 * Covers:
 * - Loading state (spinner/text)
 * - Populated render with identity and trading defaults
 * - Editing name with save success
 * - Editing trading defaults (max risk, commission, starting balance)
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

    expect(screen.getByText('Loading settings...')).toBeTruthy();
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
    expect(screen.getByText('Starting Balance ($)')).toBeTruthy();

    // Check input values
    const maxRiskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    expect(maxRiskInput.value).toBe('2.5');

    const commissionInput = screen.getByLabelText('Default Commission ($)') as HTMLInputElement;
    expect(commissionInput.value).toBe('1');

    const startBalInput = screen.getByLabelText('Starting Balance ($)') as HTMLInputElement;
    expect(startBalInput.value).toBe('50000');
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
  it('shows "Per-account value" button for each null field (currently using global)', async () => {
    mockFetchSuccess(ACCT_NULL_DEFAULTS, GLOBAL_SETTINGS);
    render(<AccountSettings accountId="acct-002" />);

    await waitFor(() => {
      expect(screen.getByText('Trading Defaults')).toBeTruthy();
    });

    // Null fields show "Per-account value" buttons (they are currently using global default)
    const perAccountButtons = screen.getAllByText('Per-account value');
    expect(perAccountButtons.length).toBe(3);

    // Each button has a descriptive aria-label
    expect(screen.getByLabelText('Switch to per-account value')).toBeTruthy();
    expect(screen.getByLabelText('Switch to per-account commission')).toBeTruthy();
    expect(screen.getByLabelText('Switch to per-account starting balance')).toBeTruthy();
  });

  it('shows global default hint text for null fields when settings are available', async () => {
    mockFetchSuccess(ACCT_NULL_DEFAULTS, GLOBAL_SETTINGS);
    render(<AccountSettings accountId="acct-002" />);

    await waitFor(() => {
      expect(screen.getByText('Using global default: 2%')).toBeTruthy();
    });

    expect(screen.getByText('Using global default: 2%')).toBeTruthy();
    expect(screen.getByText('Using global default: $0.50')).toBeTruthy();
    expect(screen.getByText('Using global default: $25,000.00')).toBeTruthy();
  });
});

describe('AccountSettings — edit and save flow', () => {
  it('edits account name and saves successfully', async () => {
    // First call: load data, second call: save (PUT), third call: reload
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
      // Save: PUT succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...ACCT_FULL, name: 'Updated Brokerage' }),
      })
      // Reload account after save
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

    // Verify the PUT payload included name
    const putCall = fetchMock.mock.calls[2];
    expect(putCall[0]).toBe('/api/accounts/acct-001');
    expect(putCall[1]).toBeDefined();
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.name).toBe('Updated Brokerage');
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
      // Save: PUT succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...ACCT_FULL,
          maxRiskPerTradePct: 3.0,
          defaultCommission: 2.00,
          startingBalance: null,
        }),
      })
      // Reload account after save
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

    // Click "Use global default" for starting balance to set it to null
    fireEvent.click(screen.getByLabelText('Clear starting balance to use global default'));

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
    expect(body.startingBalance).toBeNull();
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

describe('AccountSettings — "Use global default" toggle', () => {
  it('toggles between per-account value and global default', async () => {
    mockFetchSuccess(ACCT_FULL, GLOBAL_SETTINGS);
    render(<AccountSettings accountId="acct-001" />);

    await waitFor(() => {
      expect(screen.getByText('Trading Defaults')).toBeTruthy();
    });

    // Initially values are populated - button says "Use global default"
    const toggleButtons = screen.getAllByText('Use global default');
    expect(toggleButtons.length).toBe(3);

    // Click "Use global default" for max risk
    const maxRiskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    expect(maxRiskInput.value).toBe('2.5');
    fireEvent.click(toggleButtons[0]);

    // Now the button should say "Per-account value"
    expect(screen.getByText('Per-account value')).toBeTruthy();

    // The input should be empty
    await waitFor(() => {
      expect(maxRiskInput.value).toBe('');
    });

    // Should show global default hint
    expect(screen.getByText('Using global default: 2%')).toBeTruthy();

    // Click "Per-account value" to go back
    fireEvent.click(screen.getByText('Per-account value'));

    // Input should now show the original value again
    await waitFor(() => {
      expect(maxRiskInput.value).toBe('2.5');
    });
  });

  it('toggles from null to per-account value and back', async () => {
    mockFetchSuccess(ACCT_NULL_DEFAULTS, GLOBAL_SETTINGS);
    render(<AccountSettings accountId="acct-002" />);

    await waitFor(() => {
      expect(screen.getByText('Using global default: 2%')).toBeTruthy();
    });

    // Click "Per-account value" to allow entering a value
    // (The account has null values, starting in "use global" mode.
    //  Null fields all show "Per-account value" text, so use getAllByText.)
    fireEvent.click(screen.getAllByText('Per-account value')[0]);

    // Should no longer show "Using global default" hint since the account
    // has no original per-account value to restore (was null)
    expect(screen.queryByText('Using global default: 2%')).toBeNull();

    // Enter a value
    const maxRiskInput = screen.getByLabelText('Max Risk Per Trade (%)') as HTMLInputElement;
    fireEvent.change(maxRiskInput, { target: { value: '5' } });

    // Now click "Use global default" to clear it
    fireEvent.click(screen.getByText('Use global default'));

    // Should show "Using global default" again
    expect(screen.getByText('Using global default: 2%')).toBeTruthy();
    expect(maxRiskInput.value).toBe('');
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
