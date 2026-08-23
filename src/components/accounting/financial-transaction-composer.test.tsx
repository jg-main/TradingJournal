/**
 * Component tests for FinancialTransactionComposer (S03/T01).
 *
 * Covers:
 * - Dialog renders with the curated event-type selector (exactly the 7
 *   R014 types; no opening_balance / transfer / stock_split)
 * - Switching event type shows the correct dynamic fields
 *   (perShareAmount/shares for dividend, rate for interest, feeType for fee,
 *   taxType for tax, signed amount + reason for manual_adjustment)
 * - Economic-effect preview shows cash direction + amount live for all 7 types
 * - Client-side validation rejects empty, zero, negative (except
 *   manual_adjustment) and >2-decimal amounts with no fetch round-trip
 * - Canonical API submission: correct body shape per event type, canonical
 *   2-decimal amount, optional fields omitted when empty, postedAt ISO
 * - Success confirmation renders before onPosted fires after the delay
 * - API 400 field errors, 500 error strings, and network failures surface in
 *   a role=alert banner with a dismiss/retry path
 *
 * Run: npx vitest run src/components/accounting/financial-transaction-composer.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import {
  FinancialTransactionComposer,
  POST_SUCCESS_DELAY_MS,
  EVENT_TYPE_OPTIONS,
} from './financial-transaction-composer';

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

function renderComposer(props?: Partial<React.ComponentProps<typeof FinancialTransactionComposer>>) {
  const mockOnOpenChange = vi.fn();
  const mockOnPosted = vi.fn();
  const utils = render(
    <FinancialTransactionComposer
      accountId="acct-1"
      currency="USD"
      open={true}
      onOpenChange={mockOnOpenChange}
      onPosted={mockOnPosted}
      {...props}
    />,
  );
  return { mockOnOpenChange, mockOnPosted, ...utils };
}

async function settleHandoffDelay() {
  await new Promise((resolve) => setTimeout(resolve, POST_SUCCESS_DELAY_MS + 150));
}

const AMOUNT_INPUT = /Amount \(USD\)/;
const DESCRIPTION_INPUT = 'Description (optional)';
const DATE_INPUT = 'Date (optional)';
const SUBMIT_BUTTON = /post transaction/i;

/** Select an event type in the curated selector. */
function selectEventType(value: string) {
  fireEvent.change(screen.getByLabelText('Event Type'), { target: { value } });
}

/** Fill amount (+ optional description/date) and submit. */
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

/** The effect preview container's text content. */
function previewText(): string {
  const preview = screen.getByTestId('ftc-effect-preview');
  return preview.textContent ?? '';
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('FinancialTransactionComposer — rendering and curated selector', () => {
  it('renders the dialog with title, shared fields, preview, and submit button', () => {
    renderComposer();

    expect(screen.getByText('Add Transaction')).toBeTruthy();
    expect(screen.getByLabelText('Event Type')).toBeTruthy();
    expect(screen.getByLabelText(AMOUNT_INPUT)).toBeTruthy();
    expect(screen.getByLabelText(DESCRIPTION_INPUT)).toBeTruthy();
    expect(screen.getByLabelText(DATE_INPUT)).toBeTruthy();
    expect(screen.getByTestId('ftc-effect-preview')).toBeTruthy();
    expect(screen.getByRole('button', { name: SUBMIT_BUTTON })).toBeTruthy();
  });

  it('offers exactly the 7 curated event types — no opening_balance, transfer, or stock_split', () => {
    renderComposer();

    const select = screen.getByLabelText('Event Type') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);

    expect(options).toEqual([
      'deposit',
      'withdrawal',
      'dividend',
      'interest',
      'fee',
      'tax',
      'manual_adjustment',
    ]);
    // The curated constant mirrors the selector and excludes non-offered types.
    const offered = new Set<string>(EVENT_TYPE_OPTIONS.map((o) => o.value));
    expect(offered.has('opening_balance')).toBe(false);
    expect(offered.has('transfer')).toBe(false);
    expect(offered.has('stock_split')).toBe(false);
    expect(options).toHaveLength(7);
  });

  it('renders no type-specific extras for deposit (the default type)', () => {
    renderComposer();

    expect(screen.queryByLabelText('Per-Share Amount (optional)')).toBeNull();
    expect(screen.queryByLabelText('Rate (optional)')).toBeNull();
    expect(screen.queryByLabelText('Fee Type (optional)')).toBeNull();
    expect(screen.queryByLabelText('Tax Type (optional)')).toBeNull();
    expect(screen.queryByLabelText('Reason')).toBeNull();
  });
});

describe('FinancialTransactionComposer — dynamic type-specific fields', () => {
  it('shows per-share amount + shares for dividend', () => {
    renderComposer();
    selectEventType('dividend');

    expect(screen.getByLabelText('Per-Share Amount (optional)')).toBeTruthy();
    expect(screen.getByLabelText('Shares (optional)')).toBeTruthy();
    expect(screen.queryByLabelText('Rate (optional)')).toBeNull();
  });

  it('shows rate for interest', () => {
    renderComposer();
    selectEventType('interest');

    expect(screen.getByLabelText('Rate (optional)')).toBeTruthy();
    expect(screen.queryByLabelText('Per-Share Amount (optional)')).toBeNull();
  });

  it('shows fee type for fee', () => {
    renderComposer();
    selectEventType('fee');

    expect(screen.getByLabelText('Fee Type (optional)')).toBeTruthy();
  });

  it('shows tax type for tax', () => {
    renderComposer();
    selectEventType('tax');

    expect(screen.getByLabelText('Tax Type (optional)')).toBeTruthy();
  });

  it('shows a reason field and signed-amount hint for manual_adjustment', () => {
    renderComposer();
    selectEventType('manual_adjustment');

    expect(screen.getByLabelText('Reason')).toBeTruthy();
    expect(screen.getByText(/negative for a decrease/)).toBeTruthy();
  });
});

describe('FinancialTransactionComposer — economic-effect preview', () => {
  it('shows a neutral placeholder before an amount is entered', () => {
    renderComposer();
    expect(previewText()).toContain('Effect');
    expect(previewText()).toContain('—');
  });

  it('shows cash increase for deposit, dividend, and interest', () => {
    const r1 = renderComposer();

    fillAndSubmit('500', '', '');
    expect(previewText()).toContain('Cash increase');
    expect(previewText()).toContain('500.00');
    r1.unmount();

    const r2 = renderComposer();
    selectEventType('dividend');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '120.5' } });
    expect(previewText()).toContain('Cash increase');
    expect(previewText()).toContain('120.50');
    r2.unmount();

    const r3 = renderComposer();
    selectEventType('interest');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '8.25' } });
    expect(previewText()).toContain('Cash increase');
    expect(previewText()).toContain('8.25');
    r3.unmount();
  });

  it('shows cash decrease for withdrawal, fee, and tax', () => {
    const r1 = renderComposer();

    selectEventType('withdrawal');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '200' } });
    expect(previewText()).toContain('Cash decrease');
    expect(previewText()).toContain('200.00');
    r1.unmount();

    const r2 = renderComposer();
    selectEventType('fee');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '15.5' } });
    expect(previewText()).toContain('Cash decrease');
    expect(previewText()).toContain('15.50');
    r2.unmount();

    const r3 = renderComposer();
    selectEventType('tax');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '99' } });
    expect(previewText()).toContain('Cash decrease');
    expect(previewText()).toContain('99.00');
    r3.unmount();
  });

  it('tracks the sign of a manual adjustment in the preview', () => {
    renderComposer();
    selectEventType('manual_adjustment');

    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '-50' } });
    expect(previewText()).toContain('Cash decrease');
    expect(previewText()).toContain('50.00');

    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '75' } });
    expect(previewText()).toContain('Cash increase');
    expect(previewText()).toContain('75.00');

    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '0' } });
    expect(previewText()).toContain('Effect');
    expect(previewText()).toContain('—');
  });

  it('shows a neutral preview for invalid amounts', () => {
    renderComposer();
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '100.555' } });
    expect(previewText()).toContain('Effect');
    expect(previewText()).toContain('—');
  });
});

describe('FinancialTransactionComposer — client-side amount validation', () => {
  it('requires an amount and does not call the API', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));

    expect(screen.getByText('Enter an amount.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects zero, negative, and >2-decimal amounts with a field error and no fetch', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const { unmount } = renderComposer();
    for (const bad of ['0', '0.00', '-100', '100.555']) {
      fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: bad } });
      fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));
      expect(
        screen.getByText('Enter a positive amount with up to 2 decimal places.'),
      ).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '' } });
    }
    unmount();
  });

  it('validates dividend extras when present but allows them empty', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const { unmount } = renderComposer();
    selectEventType('dividend');

    // Invalid per-share amount + non-integer shares
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Per-Share Amount (optional)'), {
      target: { value: '-0.5' },
    });
    fireEvent.change(screen.getByLabelText('Shares (optional)'), { target: { value: '10.5' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));

    expect(
      screen.getByText('Per-share amount must be positive with up to 2 decimal places.'),
    ).toBeTruthy();
    expect(screen.getByText('Shares must be a positive whole number.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();

    // Valid amount with empty extras passes client-side validation
    mockFetchResponse(true, { event: { id: 'evt-1' } });
    renderComposer();
    selectEventType('dividend');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('validates interest rate when present', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    renderComposer();
    selectEventType('interest');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Rate (optional)'), { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));

    expect(screen.getByText('Rate must be a positive number.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('FinancialTransactionComposer — manual_adjustment validation', () => {
  it('accepts a negative amount (outflow) but rejects zero', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    renderComposer();
    selectEventType('manual_adjustment');

    // Zero is rejected
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Balance fix' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));
    expect(screen.getByText('Enter a non-zero adjustment amount.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a reason for manual adjustments', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    renderComposer();
    selectEventType('manual_adjustment');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '-50' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));

    expect(screen.getByText('Enter a reason for the adjustment.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('FinancialTransactionComposer — canonical API submission', () => {
  it('posts a deposit with canonical amount, description, and ISO date', async () => {
    mockFetchResponse(true, { event: { id: 'evt-1' } });
    renderComposer();

    fillAndSubmit('1234.5', 'Cash transfer', '2026-01-15T09:30');
    await waitFor(() => {
      expect(screen.getByText('Deposit posted')).toBeTruthy();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/accounts/acct-1/financial-events',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(lastPostBody()).toEqual({
      eventType: 'deposit',
      amount: '1234.50',
      description: 'Cash transfer',
      postedAt: new Date('2026-01-15T09:30').toISOString(),
    });
  });

  it('posts a withdrawal with the correct eventType', async () => {
    mockFetchResponse(true, { event: { id: 'evt-2' } });
    renderComposer();

    selectEventType('withdrawal');
    fillAndSubmit('250.25', '', '');
    await waitFor(() => {
      expect(screen.getByText('Withdrawal posted')).toBeTruthy();
    });

    expect(lastPostBody()).toEqual({
      eventType: 'withdrawal',
      amount: '250.25',
    });
  });

  it('posts a dividend with perShareAmount and shares extras', async () => {
    mockFetchResponse(true, { event: { id: 'evt-3' } });
    renderComposer();

    selectEventType('dividend');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(DESCRIPTION_INPUT), {
      target: { value: 'Quarterly dividend' },
    });
    fireEvent.change(screen.getByLabelText('Per-Share Amount (optional)'), {
      target: { value: '0.5' },
    });
    fireEvent.change(screen.getByLabelText('Shares (optional)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));

    await waitFor(() => {
      expect(screen.getByText('Dividend posted')).toBeTruthy();
    });
    expect(lastPostBody()).toEqual({
      eventType: 'dividend',
      amount: '50.00',
      description: 'Quarterly dividend',
      perShareAmount: '0.50',
      shares: 100,
      postedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });

  it('posts interest with rate, fee with feeType, and tax with taxType', async () => {
    mockFetchResponse(true, { event: { id: 'evt-4' } });

    renderComposer();
    selectEventType('interest');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Rate (optional)'), { target: { value: '4.5' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));
    await waitFor(() => {
      expect(screen.getByText('Interest posted')).toBeTruthy();
    });
    expect(lastPostBody()).toEqual({
      eventType: 'interest',
      amount: '10.00',
      rate: '4.5',
      postedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    cleanup();

    renderComposer();
    selectEventType('fee');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Fee Type (optional)'), { target: { value: 'Margin' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));
    await waitFor(() => {
      expect(screen.getByText('Fee posted')).toBeTruthy();
    });
    expect(lastPostBody()).toEqual({
      eventType: 'fee',
      amount: '15.00',
      feeType: 'Margin',
      postedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    cleanup();

    renderComposer();
    selectEventType('tax');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText('Tax Type (optional)'), { target: { value: 'Withholding' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));
    await waitFor(() => {
      expect(screen.getByText('Tax posted')).toBeTruthy();
    });
    expect(lastPostBody()).toEqual({
      eventType: 'tax',
      amount: '99.00',
      taxType: 'Withholding',
      postedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });

  it('posts a manual_adjustment with a signed canonical amount and reason', async () => {
    mockFetchResponse(true, { event: { id: 'evt-5' } });
    renderComposer();

    selectEventType('manual_adjustment');
    fireEvent.change(screen.getByLabelText(AMOUNT_INPUT), { target: { value: '-50.5' } });
    fireEvent.change(screen.getByLabelText(DESCRIPTION_INPUT), {
      target: { value: 'Broker correction' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Balance fix' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));

    await waitFor(() => {
      expect(screen.getByText('Manual Adjustment posted')).toBeTruthy();
    });
    expect(lastPostBody()).toEqual({
      eventType: 'manual_adjustment',
      amount: '-50.50',
      reason: 'Balance fix',
      description: 'Broker correction',
      postedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });

  it('omits optional fields (description, date) when empty', async () => {
    mockFetchResponse(true, { event: { id: 'evt-6' } });
    renderComposer();

    fillAndSubmit('500', '', '');
    await waitFor(() => {
      expect(screen.getByText('Deposit posted')).toBeTruthy();
    });

    expect(lastPostBody()).toEqual({
      eventType: 'deposit',
      amount: '500.00',
    });
  });

  it('shows a loading state and disables the button while posting', () => {
    // Never resolve the request.
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    renderComposer();
    fillAndSubmit('100');

    expect(screen.getByText('Posting...')).toBeTruthy();
    const button = screen.getByRole('button', { name: /posting/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe('FinancialTransactionComposer — success handoff', () => {
  it('shows the success confirmation before the handoff delay fires onPosted and closes', async () => {
    mockFetchResponse(true, { event: { id: 'evt-7' } });
    const { mockOnOpenChange, mockOnPosted } = renderComposer();

    fillAndSubmit('3000');
    await waitFor(() => {
      expect(screen.getByText('Deposit posted')).toBeTruthy();
    });

    // The caller handoff is deferred so the confirmation is perceivable.
    expect(mockOnPosted).not.toHaveBeenCalled();

    await settleHandoffDelay();
    expect(mockOnPosted).toHaveBeenCalledTimes(1);
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('FinancialTransactionComposer — error handling', () => {
  it('surfaces 400 validation field errors from the API response', async () => {
    mockFetchResponse(false, {
      error: 'Validation failed',
      details: {
        fieldErrors: {
          amount: ['Deposit amount must be positive'],
        },
      },
    });
    const { mockOnPosted } = renderComposer();

    fillAndSubmit('100');
    await waitFor(() => {
      expect(screen.getByText('Deposit amount must be positive')).toBeTruthy();
    });
    expect(mockOnPosted).not.toHaveBeenCalled();
    // The entered values survive so the user can retry.
    expect((screen.getByLabelText(AMOUNT_INPUT) as HTMLInputElement).value).toBe('100');
  });

  it('surfaces 500 error strings from the API response', async () => {
    mockFetchResponse(false, {
      error: 'Failed to post financial event',
      details: 'ledger constraint violation',
    });
    renderComposer();

    fillAndSubmit('100');
    await waitFor(() => {
      expect(screen.getByText('Failed to post financial event')).toBeTruthy();
    });
  });

  it('surfaces 409 duplicate idempotency errors', async () => {
    mockFetchResponse(false, {
      error: 'Duplicate idempotency key',
      details: 'Idempotency key already used',
    });
    renderComposer();

    fillAndSubmit('100');
    await waitFor(() => {
      expect(screen.getByText('Duplicate idempotency key')).toBeTruthy();
    });
  });

  it('falls back to a friendly message on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    renderComposer();

    fillAndSubmit('100');
    await waitFor(() => {
      expect(
        screen.getByText('Could not post the transaction. Please try again.'),
      ).toBeTruthy();
    });
  });

  it('dismisses the error banner and lets the user resubmit', async () => {
    // First call fails with a 500, second call succeeds.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed to post financial event' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ event: { id: 'evt-8' } }),
      });
    renderComposer();

    fillAndSubmit('100');
    await waitFor(() => {
      expect(screen.getByText('Failed to post financial event')).toBeTruthy();
    });

    // Dismiss clears the banner without losing the entered amount.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Failed to post financial event')).toBeNull();

    // Resubmit succeeds.
    fireEvent.click(screen.getByRole('button', { name: SUBMIT_BUTTON }));
    await waitFor(() => {
      expect(screen.getByText('Deposit posted')).toBeTruthy();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

// ── A6: defensive lifecycle guard (inactive account) ────────────────────

describe('FinancialTransactionComposer — inactive account guard (A6)', () => {
  it('blocks submission with a clear message when isActive is false', async () => {
    globalThis.fetch = vi.fn();
    renderComposer({ isActive: false });

    fillAndSubmit('500.00');

    // No API call is made; the defensive guard blocks submission.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText(/This account is inactive\. Reactivate it from Settings to post new transactions\./),
      ).toBeTruthy();
    });
  });

  it('submits normally when isActive is true (default)', async () => {
    mockFetchResponse(true, { event: { id: 'evt-1' } });
    renderComposer();

    fillAndSubmit('100.00');
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
  });
});
