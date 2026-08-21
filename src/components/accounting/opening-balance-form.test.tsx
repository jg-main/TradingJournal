/**
 * Component tests for OpeningBalanceForm (S02/T03).
 *
 * Covers:
 * - Amount/description/date fields render with the currency in the amount label
 * - Client-side amount validation: empty, zero/negative, >2 decimals, and the
 *   no-fetch guarantee when validation fails
 * - Successful post sends eventType opening_balance with canonical amount,
 *   optional description, and optional ISO postedAt
 * - Optional fields are omitted from the body when left empty
 * - Loading state (disabled button + "Posting...") while the request is in flight
 * - Success banner appears, then onInitialized fires after the handoff delay
 * - API 400 field errors surface; API 500 `{ error }` surfaces
 * - Network failure falls back to a friendly message
 *
 * Run: npx vitest run src/components/accounting/opening-balance-form.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { OpeningBalanceForm, POST_SUCCESS_DELAY_MS } from './opening-balance-form';

// ── Test Setup ─────────────────────────────────────────────────────────

const UNMOCKED_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  cleanup();
});

function mockFetchResponse(ok: boolean, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
}

function renderForm(onInitialized = vi.fn<() => void>()) {
  const utils = render(
    <OpeningBalanceForm
      accountId="acct-new"
      currency="USD"
      onInitialized={onInitialized}
    />,
  );
  return { onInitialized, ...utils };
}

async function settleHandoffDelay() {
  await new Promise((resolve) => setTimeout(resolve, POST_SUCCESS_DELAY_MS + 150));
}

const AMOUNT_INPUT = 'Amount (USD)';
const DESCRIPTION_INPUT = 'Description (optional)';
const DATE_INPUT = 'Date (optional)';
const SUBMIT_BUTTON = /record opening balance/i;

/** Fill the amount (and optionally description/date) and submit. */
function fillAndSubmit(amount: string, description?: string, date?: string) {
  fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: amount } });
  if (description !== undefined) {
    fireEvent.change(screen.getByLabelText(DESCRIPTION_INPUT), { target: { value: description } });
  }
  if (date !== undefined) {
    fireEvent.change(screen.getByLabelText(DATE_INPUT), { target: { value: date } });
  }
  fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));
}

/** Capture the last POST body as a parsed object. */
function lastPostBody(): Record<string, unknown> {
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('OpeningBalanceForm — rendering', () => {
  it('renders amount, description, date fields and the submit button', () => {
    renderForm();

    expect(screen.getByLabelText(AMOUNT_INPUT)).toBeTruthy();
    expect(screen.getByLabelText(DESCRIPTION_INPUT)).toBeTruthy();
    expect(screen.getByLabelText(DATE_INPUT)).toBeTruthy();
    expect(screen.getByRole('button', { name: SUBMIT_BUTTON })).toBeTruthy();
  });
});

describe('OpeningBalanceForm — amount validation', () => {
  it('requires an amount and does not call the API', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    renderForm();
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));

    expect(screen.getByText('Enter the opening balance amount.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects zero, negative, and >2-decimal amounts with a field error', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const { unmount } = renderForm();
    for (const bad of ['0', '0.00', '-100', '100.555']) {
      fillAndSubmit(bad);
      expect(screen.getByText('Enter a positive amount with up to 2 decimal places.')).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
      // Clear the field error by editing the amount again before the next case.
      fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '' } });
    }
    unmount();
  });

  it('accepts whole and 2-decimal amounts and sends a canonical decimal', async () => {
    mockFetchResponse(true, { event: { id: 'evt-1' } });
    const { onInitialized } = renderForm();

    fillAndSubmit('5000', 'Initial cash');
    await waitFor(() => {
      expect(screen.getByText('Opening balance recorded')).toBeTruthy();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/accounts/acct-new/financial-events',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(lastPostBody()).toEqual({
      eventType: 'opening_balance',
      amount: '5000.00',
      description: 'Initial cash',
      postedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });

    await settleHandoffDelay();
    expect(onInitialized).toHaveBeenCalledTimes(1);
  });
});

describe('OpeningBalanceForm — submission', () => {
  it('posts opening_balance with a 2-decimal amount, description, and ISO date', async () => {
    mockFetchResponse(true, { event: { id: 'evt-1' } });
    renderForm();

    fillAndSubmit('1234.5', 'Cash from previous broker', '2026-01-15T09:30');
    await waitFor(() => {
      expect(screen.getByText('Opening balance recorded')).toBeTruthy();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/accounts/acct-new/financial-events',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(lastPostBody()).toEqual({
      eventType: 'opening_balance',
      amount: '1234.50',
      description: 'Cash from previous broker',
      // datetime-local is local time; the form converts it to the equivalent UTC ISO.
      postedAt: new Date('2026-01-15T09:30').toISOString(),
    });
  });

  it('omits optional fields from the body when description is empty and date is cleared', async () => {
    mockFetchResponse(true, { event: { id: 'evt-1' } });
    renderForm();

    fillAndSubmit('250.25', '', '');
    await waitFor(() => {
      expect(screen.getByText('Opening balance recorded')).toBeTruthy();
    });

    expect(lastPostBody()).toEqual({
      eventType: 'opening_balance',
      amount: '250.25',
    });
  });

  it('shows a loading state and disables the button while posting', () => {
    // Never resolve the request.
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    renderForm();
    fillAndSubmit('100');

    expect(screen.getByText('Posting...')).toBeTruthy();
    const button = screen.getByRole('button', { name: /posting/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('shows the success banner before the handoff delay fires onInitialized', async () => {
    mockFetchResponse(true, { event: { id: 'evt-1' } });
    const { onInitialized } = renderForm();

    fillAndSubmit('3000');
    await waitFor(() => {
      expect(screen.getByText('Opening balance recorded')).toBeTruthy();
    });

    // The caller handoff is deferred so the confirmation is perceivable.
    expect(onInitialized).not.toHaveBeenCalled();

    await settleHandoffDelay();
    expect(onInitialized).toHaveBeenCalledTimes(1);
  });
});

describe('OpeningBalanceForm — error handling', () => {
  it('surfaces 400 validation field errors from the API response', async () => {
    mockFetchResponse(false, {
      error: 'Validation failed',
      details: {
        fieldErrors: {
          amount: ['Opening balance amount must be positive'],
        },
      },
    });
    const { onInitialized } = renderForm();

    fillAndSubmit('100');
    await waitFor(() => {
      expect(screen.getByText('Opening balance amount must be positive')).toBeTruthy();
    });
    expect(onInitialized).not.toHaveBeenCalled();
  });

  it('surfaces 500 error strings from the API response', async () => {
    mockFetchResponse(false, {
      error: 'Failed to post financial event',
      details: 'ledger constraint violation',
    });
    renderForm();

    fillAndSubmit('100');
    await waitFor(() => {
      expect(screen.getByText('Failed to post financial event')).toBeTruthy();
    });
  });

  it('falls back to a friendly message on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    renderForm();

    fillAndSubmit('100');
    await waitFor(() => {
      expect(
        screen.getByText('Could not record the opening balance. Please try again.'),
      ).toBeTruthy();
    });
  });
});
