/**
 * Tests for the AddAccountDialog component (S02/T01, A1).
 *
 * Covers: dialog rendering, client-side name validation, account creation
 * through POST /api/accounts (payload shape), the USD-only base-currency
 * read-only field (no currency selector), API error surfacing (400/500),
 * creation (no default-account setting — A8), loading
 * state, and the onCreated handoff that drives navigation.
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
    // Base currency is a read-only USD field (USD-only contract, A1): no
    // multi-currency selector is presented.
    expect(screen.getByText('Base currency')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Base currency' })).toBeNull();
    expect(screen.getByText('USD')).toBeTruthy();
    expect(
      screen.getByText(/currently supports USD account accounting only/),
    ).toBeTruthy();
    // A8: account creation NEVER offers "Make this my default account" — new
    // accounts begin as Draft (inactive) and are not eligible until
    // initialized; default selection happens from Account Settings.
    expect(
      screen.queryByRole('checkbox', { name: /Make this my default account/ }),
    ).toBeNull();
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
    expect(mockOnCreated).toHaveBeenCalledWith(CREATED_ACCOUNT);
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

  it('always creates a USD account (USD-only contract, no currency choices)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createdResponse(CREATED_ACCOUNT),
    );
    renderDialog();

    changeInput('Account name', 'USD Account');
    clickButton('Create Account');
    await flushAsync();

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.currency).toBe('USD');
  });

  // ── Default account option ─────────────────────────────────────────

  it('never touches /api/settings during creation (A8: drafts are not eligible)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createdResponse(CREATED_ACCOUNT),
    );
    const { mockOnCreated } = renderDialog();

    changeInput('Account name', 'Main Brokerage');
    clickButton('Create Account');
    await flushAsync();

    // Exactly one request: POST /api/accounts. No default-account setting is
    // attempted — the new account is a Draft and default selection happens
    // later from Account Settings once the account is active.
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/accounts', expect.anything());
    expect(mockOnCreated).toHaveBeenCalledWith(CREATED_ACCOUNT);
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
