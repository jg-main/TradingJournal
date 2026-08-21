/**
 * Tests for the AddAccountDialog component (S02/T01).
 *
 * Covers: dialog rendering, client-side name validation, account creation
 * through POST /api/accounts (payload shape), API error surfacing (400/500),
 * the optional "Make this my default account" settings update, loading state,
 * and the onCreated handoff that drives navigation.
 *
 * The currency field is a radix Select, so it follows the repository pattern:
 * open the combobox trigger, then click the option rendered in the portal
 * (see performance-filter-bar.test.tsx). jsdom lacks scrollIntoView, which
 * Radix Select calls on open — stubbed below.
 *
 * Run: npx vitest run src/components/accounting/add-account-dialog.test.tsx
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { AddAccountDialog, type CreatedAccount } from './add-account-dialog';

// jsdom does not implement Element.prototype.scrollIntoView; Radix Select calls
// it when opening its option list, so stub it out (repo pattern).
Element.prototype.scrollIntoView = () => {};

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures & helpers
// ═══════════════════════════════════════════════════════════════════════════

const CREATED_ACCOUNT: CreatedAccount = {
  id: 'acc-new-123',
  name: 'Main Brokerage',
  broker: 'Interactive Brokers',
  currency: 'USD',
  isActive: false,
};

function createdResponse(body: CreatedAccount): Response {
  return {
    ok: true,
    status: 201,
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

function renderDialog(props?: Partial<React.ComponentProps<typeof AddAccountDialog>>) {
  const mockOnOpenChange = vi.fn();
  const mockOnCreated = vi.fn();
  const result = render(
    <AddAccountDialog
      open={true}
      onOpenChange={mockOnOpenChange}
      onCreated={mockOnCreated}
      {...props}
    />,
  );
  return { ...result, mockOnOpenChange, mockOnCreated };
}

/** Change an input field by its label. */
function changeInput(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Click a button by exact visible text. */
function clickButton(text: string) {
  fireEvent.click(screen.getByRole('button', { name: text }));
}

/** Flush pending promises (fetch + state updates). */
async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Open the currency Select and pick an option (radix portal pattern). */
async function chooseCurrency(code: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Base currency' }));
  const option = await screen.findByRole('option', { name: code });
  fireEvent.click(option);
  await flushAsync();
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('AddAccountDialog', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────

  it('renders the dialog with title, description and all fields when open', () => {
    renderDialog();

    expect(screen.getByText('Add Account')).toBeTruthy();
    expect(
      screen.getByText(/Create a new brokerage account/, { exact: false }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Account name')).toBeTruthy();
    expect(screen.getByLabelText('Broker')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Base currency' })).toBeTruthy();
    // Default currency shown in the trigger.
    expect(screen.getByRole('combobox', { name: 'Base currency' }).textContent).toContain('USD');
    expect(
      screen.getByRole('checkbox', { name: /Make this my default account/ }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('renders no form content when the dialog is closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('Add Account')).toBeNull();
    expect(screen.queryByLabelText('Account name')).toBeNull();
  });

  // ── Validation ─────────────────────────────────────────────────────

  it('blocks submit with an empty name and shows a field error', async () => {
    renderDialog();
    clickButton('Create Account');

    await waitFor(() => {
      expect(screen.getByText('Account name is required.')).toBeTruthy();
    });
    const nameInput = screen.getByLabelText('Account name') as HTMLInputElement;
    expect(nameInput.getAttribute('aria-invalid')).toBe('true');
    // No fetch was attempted.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('clears the name field error once the user types', async () => {
    renderDialog();
    clickButton('Create Account');
    await waitFor(() => {
      expect(screen.getByText('Account name is required.')).toBeTruthy();
    });

    changeInput('Account name', 'Main');
    expect(screen.queryByText('Account name is required.')).toBeNull();
  });

  // ── Creation happy path ────────────────────────────────────────────

  it('creates the account with trimmed name, broker and currency', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createdResponse(CREATED_ACCOUNT),
    );
    const { mockOnCreated, mockOnOpenChange } = renderDialog();

    changeInput('Account name', '  Main Brokerage  ');
    changeInput('Broker', 'Interactive Brokers');
    clickButton('Create Account');
    await flushAsync();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/accounts',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body).toEqual({
      name: 'Main Brokerage',
      broker: 'Interactive Brokers',
      currency: 'USD',
    });

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    expect(mockOnCreated).toHaveBeenCalledWith(CREATED_ACCOUNT, undefined);
  });

  it('sends null broker when the broker field is empty', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createdResponse({ ...CREATED_ACCOUNT, broker: null }),
    );
    renderDialog();

    changeInput('Account name', 'No Broker Acct');
    clickButton('Create Account');
    await flushAsync();

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body).toEqual({
      name: 'No Broker Acct',
      broker: null,
      currency: 'USD',
    });
  });

  it('submits the selected currency from the Select', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createdResponse({ ...CREATED_ACCOUNT, currency: 'EUR' }),
    );
    renderDialog();

    changeInput('Account name', 'EUR Account');
    await chooseCurrency('EUR');
    clickButton('Create Account');
    await flushAsync();

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.currency).toBe('EUR');
  });

  // ── Default account option ─────────────────────────────────────────

  it('saves the new account as default when the checkbox is checked', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createdResponse(CREATED_ACCOUNT),
    );
    const { mockOnCreated } = renderDialog();

    changeInput('Account name', 'Main Brokerage');
    fireEvent.click(screen.getByRole('checkbox', { name: /Make this my default account/ }));
    clickButton('Create Account');
    await flushAsync();

    // POST /api/accounts, then PUT /api/settings with the created id.
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/settings',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const settingsBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(settingsBody).toEqual({ defaultAccountId: 'acc-new-123' });
    expect(mockOnCreated).toHaveBeenCalledWith(CREATED_ACCOUNT, undefined);
  });

  it('does not touch /api/settings when the checkbox is unchecked', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createdResponse(CREATED_ACCOUNT),
    );
    renderDialog();

    changeInput('Account name', 'Main Brokerage');
    clickButton('Create Account');
    await flushAsync();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/accounts', expect.anything());
  });

  it('hands a warning to onCreated when the default save fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createdResponse(CREATED_ACCOUNT))
      .mockResolvedValueOnce(
        errorResponse(500, { error: 'Failed to update settings' }),
      );
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(fetchMock);
    const { mockOnCreated } = renderDialog();

    changeInput('Account name', 'Main Brokerage');
    fireEvent.click(screen.getByRole('checkbox', { name: /Make this my default account/ }));
    clickButton('Create Account');
    await flushAsync();

    expect(mockOnCreated).toHaveBeenCalledWith(
      CREATED_ACCOUNT,
      expect.stringContaining('could not set it as the default'),
    );
    // The account still flows through despite the settings failure.
    expect(mockOnCreated.mock.calls[0][1]).toContain('Failed to update settings');
  });

  // ── Error states ───────────────────────────────────────────────────

  it('displays API validation errors from a 400 response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse(400, {
        error: 'Validation failed',
        details: {
          formErrors: [],
          fieldErrors: { currency: ['Currency must be 3 characters'] },
        },
      }),
    );
    const { mockOnCreated, mockOnOpenChange } = renderDialog();

    changeInput('Account name', 'Main');
    clickButton('Create Account');
    await waitFor(() => {
      expect(screen.getByText('Currency must be 3 characters')).toBeTruthy();
    });

    // Dialog stays open; no handoff.
    expect(mockOnCreated).not.toHaveBeenCalled();
    expect(mockOnOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('displays the server error message on a 500 response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse(500, { error: 'Failed to create account', details: 'boom' }),
    );
    renderDialog();

    changeInput('Account name', 'Main');
    clickButton('Create Account');
    await waitFor(() => {
      expect(screen.getByText('Failed to create account')).toBeTruthy();
    });
  });

  it('falls back to a generic message on a network failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error'),
    );
    renderDialog();

    changeInput('Account name', 'Main');
    clickButton('Create Account');
    await waitFor(() => {
      expect(screen.getByText('Failed to create account. Please try again.')).toBeTruthy();
    });
  });

  // ── Loading state ─────────────────────────────────────────────────

  it('shows a loading state while the create request is in flight', async () => {
    let resolveFetch: (r: Response) => void;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    renderDialog();

    changeInput('Account name', 'Main');
    clickButton('Create Account');
    await act(async () => {
      await Promise.resolve();
    });

    // Button is disabled and shows the pending label.
    const submitButton = screen.getByRole('button', { name: /Creating/ });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    // Inputs are disabled during submit.
    expect((screen.getByLabelText('Account name') as HTMLInputElement).disabled).toBe(true);

    await act(async () => {
      resolveFetch!(createdResponse(CREATED_ACCOUNT));
    });
    await flushAsync();
  });

  // ── Cancel ─────────────────────────────────────────────────────────

  it('closes the dialog when Cancel is clicked', () => {
    const { mockOnOpenChange } = renderDialog();
    clickButton('Cancel');
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  // ── Accessibility ──────────────────────────────────────────────────

  it('associates the dialog description for screen readers', () => {
    renderDialog();
    const description = document.querySelector('[data-slot="dialog-description"]');
    expect(description?.textContent).toContain('Create a new brokerage account');
  });
});
