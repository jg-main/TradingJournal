/**
 * Tests for the FinancialEventCorrectionDialog component.
 *
 * Covers: dialog rendering, original event section, amount pre-fill,
 * validation (canonical format, zero, sign per event type, required
 * reason, description length), confirm-step comparison, back/cancel
 * navigation, successful submit (fetch URL + body, success step,
 * auto-close), and error handling (409 already corrected, 422 not
 * correctable, 404 missing, network failure).
 *
 * Run: npx vitest run src/components/accounting/financial-event-correction-dialog.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react';
import FinancialEventCorrectionDialog from './financial-event-correction-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';

// ═══════════════════════════════════════════════════════════════════════════
// Test fixtures
// ═══════════════════════════════════════════════════════════════════════════

const ORIGINAL_EVENT = {
  id: 'evt-0001',
  eventType: 'deposit',
  description: 'Initial deposit',
  postedAt: '2026-07-14T10:00:00.000Z',
  amount: '500.00',
};

const MANUAL_ADJUSTMENT_EVENT = {
  id: 'evt-0002',
  eventType: 'manual_adjustment',
  description: 'Manual adjustment',
  postedAt: '2026-07-14T10:00:00.000Z',
  amount: '-150.00',
};

const CORRECTION_RESPONSE = {
  success: true,
  correction: {
    id: 'corr-0001',
    accountId: 'acc-1',
    originalEventId: 'evt-0001',
    reversalEventId: 'rev-0001',
    replacementEventId: 'rep-0001',
    reason: 'Wrong amount entered',
    correctedAt: '2026-07-15T10:00:00.000Z',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════════════════════════════════════

function renderForm(props?: Partial<React.ComponentProps<typeof FinancialEventCorrectionDialog>>) {
  const mockOnOpenChange = vi.fn();
  const mockOnComplete = vi.fn();

  const result = render(
    <TooltipProvider>
      <FinancialEventCorrectionDialog
        accountId="acc-1"
        event={ORIGINAL_EVENT}
        open
        onOpenChange={mockOnOpenChange}
        onCorrectionComplete={mockOnComplete}
        {...props}
      />
    </TooltipProvider>,
  );

  return { ...result, mockOnOpenChange, mockOnComplete };
}

/** Click a button by its full visible text (exact match). */
function clickButton(text: string) {
  const btn = screen.getByText(text).closest('button');
  if (!btn) throw new Error(`Could not find button with text "${text}"`);
  fireEvent.click(btn);
  return btn;
}

/** Set valid amount + reason values (pre-filled amount stays as-is). */
async function fillValidForm(overrides?: { amount?: string; reason?: string }) {
  if (overrides?.amount !== undefined) {
    const amountInput = screen.getByRole('textbox', { name: /amount/i }) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(amountInput, { target: { value: overrides.amount } });
    });
  }
  const reasonInput = screen.getByRole('textbox', { name: /reason/i }) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(reasonInput, { target: { value: overrides?.reason ?? 'Wrong amount entered' } });
  });
}

/** Walk form → confirm and submit. Mock fetch must already be installed. */
async function submitCorrection() {
  clickButton('Review Correction');
  await waitFor(() => {
    // "Confirm Correction" appears as both the confirm heading and the
    // submit button — use getAllByText.
    const confirmEls = screen.getAllByText('Confirm Correction');
    expect(confirmEls.length).toBeGreaterThanOrEqual(1);
  });
  const confirmBtn = screen
    .getAllByText('Confirm Correction')
    .map((el) => el.closest('button'))
    .find((b) => b);
  await act(async () => {
    fireEvent.click(confirmBtn!);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('FinancialEventCorrectionDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ── Dialog rendering ──────────────────────────────────────────────

  it('renders the correction dialog with title and description', () => {
    renderForm();
    expect(screen.getByText('Correct Financial Event')).toBeTruthy();
    expect(
      screen.getByText(/Replace a posted financial event/, { exact: false }),
    ).toBeTruthy();
  });

  it('shows original event reference section with values', () => {
    renderForm();
    expect(screen.getByText('Original Event')).toBeTruthy();

    const origSection = screen.getByText('Original Event').closest('div');
    expect(origSection?.textContent).toContain('Deposit');
    expect(origSection?.textContent).toContain('$500.00');
    expect(origSection?.textContent).toContain('Initial deposit');
  });

  // ── Pre-fill ─────────────────────────────────────────────────────

  it('pre-fills the amount input from the event brief', () => {
    renderForm();
    const amountInput = screen.getByRole('textbox', { name: /amount/i }) as HTMLInputElement;
    expect(amountInput.value).toBe('500.00');
  });

  it('pre-fills signed amount for manual_adjustment events', () => {
    renderForm({ event: MANUAL_ADJUSTMENT_EVENT });
    const amountInput = screen.getByRole('textbox', { name: /amount/i }) as HTMLInputElement;
    expect(amountInput.value).toBe('-150.00');
  });

  it('renders step indicator with Edit, Review, Confirm labels', () => {
    renderForm();
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByText('Confirm')).toBeTruthy();
  });

  // ── Validation ────────────────────────────────────────────────────

  it('shows validation error when amount is empty', async () => {
    renderForm();
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: /amount/i }), { target: { value: '' } });
    });
    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Amount is required')).toBeTruthy();
    });
    // Still on the form step
    expect(screen.getByText('Review Correction')).toBeTruthy();
  });

  it('shows validation error when amount is not a canonical decimal', async () => {
    renderForm();
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: /amount/i }), { target: { value: '500' } });
    });
    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Amount must be a canonical decimal (e.g. 500.00)')).toBeTruthy();
    });
  });

  it('shows validation error when amount is zero', async () => {
    renderForm();
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: /amount/i }), { target: { value: '0.00' } });
    });
    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Amount must be non-zero')).toBeTruthy();
    });
  });

  it('rejects negative amounts for non-manual-adjustment event types', async () => {
    renderForm();
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: /amount/i }), { target: { value: '-100.00' } });
    });
    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Amount must be positive for this event type')).toBeTruthy();
    });
  });

  it('shows validation error when reason is empty (required)', async () => {
    renderForm();
    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Correction reason is required')).toBeTruthy();
    });
  });

  it('shows validation error when description exceeds 500 characters', async () => {
    renderForm();
    const descInput = screen.getByRole('textbox', { name: /description/i });
    await act(async () => {
      fireEvent.change(descInput, { target: { value: 'x'.repeat(501) } });
    });
    await fillValidForm();
    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Description must be 500 characters or fewer')).toBeTruthy();
    });
  });

  // ── Confirm step ──────────────────────────────────────────────────

  it('transitions to confirmation step with comparison table', async () => {
    renderForm();
    await fillValidForm({ amount: '750.00' });
    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Original')).toBeTruthy();
    });
    const replEls = screen.getAllByText('Replacement');
    expect(replEls.length).toBeGreaterThanOrEqual(1);

    // Comparison shows original and replacement amounts
    const tableEl = screen.getByRole('table');
    expect(tableEl.textContent).toContain('$500.00');
    expect(tableEl.textContent).toContain('$750.00');
    expect(tableEl.textContent).toContain('Wrong amount entered');

    expect(screen.getByText('Back')).toBeTruthy();
  });

  it('returns to form step when Back is clicked', async () => {
    renderForm();
    await fillValidForm();
    clickButton('Review Correction');
    await waitFor(() => {
      expect(screen.getByText('Original')).toBeTruthy();
    });

    clickButton('Back');

    await waitFor(() => {
      expect(screen.getByText('Review Correction')).toBeTruthy();
    });
  });

  it('allows negative replacement amounts for manual_adjustment events', async () => {
    renderForm({ event: MANUAL_ADJUSTMENT_EVENT });
    await fillValidForm({ amount: '-200.00' });
    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Original')).toBeTruthy();
    });
    const tableEl = screen.getByRole('table');
    expect(tableEl.textContent).toContain('-$200.00');
  });

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    const { mockOnOpenChange } = renderForm();
    clickButton('Cancel');
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  // ── Successful submit ─────────────────────────────────────────────

  it('posts the correction and shows the success step with lineage', async () => {
    // Intercept only the dialog's 2000ms success auto-close timer so
    // testing-library's waitFor polling (shorter intervals) still works.
    let successCb: (() => void) | null = null;
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    setTimeoutSpy.mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout === 2000) {
        successCb = handler as () => void;
        return 123 as unknown as ReturnType<typeof setTimeout>;
      }
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof setTimeout);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => CORRECTION_RESPONSE,
    });

    const { mockOnOpenChange, mockOnComplete } = renderForm();
    await fillValidForm({ amount: '750.00' });
    await submitCorrection();

    await waitFor(() => {
      expect(screen.getByText('Correction Posted')).toBeTruthy();
    });

    // Request shape: URL, method, and canonical body
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/accounts/acc-1/financial-events/evt-0001/correct');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      amount: '750.00',
      // The pre-filled description from the original event is carried
      // through unless the user clears it.
      description: 'Initial deposit',
      reason: 'Wrong amount entered',
    });

    // Success step shows correction lineage IDs
    expect(screen.getByText('Correction ID:')).toBeTruthy();
    expect(screen.getByText('Reversal:')).toBeTruthy();
    expect(screen.getByText('Replacement:')).toBeTruthy();

    // Auto-close after the success delay fires completion callbacks
    await act(async () => {
      successCb?.();
    });
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    expect(mockOnComplete).toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
  });

  it('includes description in the request when provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => CORRECTION_RESPONSE,
    });

    renderForm();
    const descInput = screen.getByRole('textbox', { name: /description/i });
    await act(async () => {
      fireEvent.change(descInput, { target: { value: 'Corrected deposit amount' } });
    });
    await fillValidForm();
    await submitCorrection();

    await waitFor(() => {
      expect(screen.getByText('Correction Posted')).toBeTruthy();
    });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      amount: '500.00',
      description: 'Corrected deposit amount',
      reason: 'Wrong amount entered',
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  it('shows readable error when the event was already corrected (409)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'Financial event already corrected',
        code: 'EVENT_ALREADY_CORRECTED',
        details: 'Financial event "evt-0001" has already been corrected via correction "corr-0009"',
      }),
    });

    renderForm();
    await fillValidForm();
    await submitCorrection();

    await waitFor(() => {
      expect(screen.getByText('Correction Failed')).toBeTruthy();
    });
    expect(screen.getByText('Financial event already corrected')).toBeTruthy();
    expect(screen.getByText('This event has already been corrected.')).toBeTruthy();
  });

  it('shows readable error when the event is not correctable (422)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'Financial event not correctable',
        code: 'EVENT_NOT_CORRECTABLE',
        details: 'Financial event "evt-0001" cannot be corrected: event type "stock_split" is not eligible for correction',
      }),
    });

    renderForm();
    await fillValidForm();
    await submitCorrection();

    await waitFor(() => {
      expect(screen.getByText('Correction Failed')).toBeTruthy();
    });
    expect(screen.getByText(/This event cannot be corrected/)).toBeTruthy();
  });

  it('shows a not-found error (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: 'Account or financial event not found',
        details: 'Financial event "evt-0001" not found',
      }),
    });

    renderForm();
    await fillValidForm();
    await submitCorrection();

    await waitFor(() => {
      expect(screen.getByText('Correction Failed')).toBeTruthy();
    });
    expect(screen.getByText('Account or financial event not found.')).toBeTruthy();
  });

  it('shows a network error and can retry from the form step', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { mockOnOpenChange } = renderForm();
    await fillValidForm();
    await submitCorrection();

    await waitFor(() => {
      expect(screen.getByText('Correction Failed')).toBeTruthy();
    });
    expect(screen.getByText('Network error')).toBeTruthy();

    // Retry returns to the form step
    clickButton('Try Again');
    await waitFor(() => {
      expect(screen.getByText('Review Correction')).toBeTruthy();
    });

    // Dismiss closes the dialog
    clickButton('Cancel');
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  // ── Accessibility ─────────────────────────────────────────────────

  it('has an accessible description for the dialog', () => {
    renderForm();
    const description = document.getElementById('financial-correction-description');
    expect(description).toBeTruthy();
    expect(description?.textContent).toContain('Replace a posted financial event');
  });

  it('renders a help tooltip for the amount field', () => {
    renderForm();
    const tooltipButton = screen.getByLabelText(
      'The corrected amount for this event. Must be a positive dollar amount (e.g. 500.00).',
    );
    expect(tooltipButton).toBeTruthy();
  });
});
