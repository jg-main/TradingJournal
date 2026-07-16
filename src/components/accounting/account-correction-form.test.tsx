/**
 * Tests for the AccountCorrectionForm component.
 *
 * Covers rendering states: dialog open/close, form editing, validation,
 * confirmation step, and accessibility.
 *
 * Run: npx vitest run src/components/accounting/account-correction-form.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react';
import AccountCorrectionForm from './account-correction-form';
import { TooltipProvider } from '@/components/ui/tooltip';

// ═══════════════════════════════════════════════════════════════════════════
// Test fixture
// ═══════════════════════════════════════════════════════════════════════════

const ORIGINAL_EXECUTION = {
  id: 'exec-12345',
  symbol: 'AAPL',
  action: 'buy',
  quantity: '100.00',
  price: '150.00',
  fees: '5.00',
  postedAt: '2026-07-14T10:00:00.000Z',
};

// ═══════════════════════════════════════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════════════════════════════════════

function renderForm(props?: Partial<React.ComponentProps<typeof AccountCorrectionForm>>) {
  const mockOnOpenChange = vi.fn();
  const mockOnComplete = vi.fn();

  const result = render(
    <TooltipProvider>
      <AccountCorrectionForm
        accountId="acc-1"
        execution={ORIGINAL_EXECUTION}
        open={true}
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

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('AccountCorrectionForm', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Dialog rendering ──────────────────────────────────────────────

  it('renders the correction dialog with title and description', () => {
    renderForm();
    expect(screen.getByText('Correct Execution')).toBeTruthy();
    // Description text may be split across elements; check for key content
    expect(
      screen.getByText(/Replace a posted execution/, { exact: false }),
    ).toBeTruthy();
  });

  // ── Original execution section renders ────────────────────────────

  it('shows original execution reference section with values', () => {
    renderForm();
    expect(screen.getByText('Original Execution')).toBeTruthy();

    // Check that original execution values are rendered somewhere in the dialog
    expect(screen.getByText('AAPL')).toBeTruthy();

    // Quantity and price numbers appear formatted in the Original section
    const origSection = screen.getByText('Original Execution').closest('div');
    expect(origSection?.textContent).toContain('Buy');
    expect(origSection?.textContent).toContain('$150');
  });

  // ── Form field pre-fill ──────────────────────────────────────────

  it('pre-fills replacement form inputs from original execution', () => {
    renderForm();

    // Symbol is rendered as a text input
    const textboxes = screen.getAllByRole('textbox');
    const symInput = textboxes.find((tb) => (tb as HTMLInputElement).value === 'AAPL');
    expect(symInput).toBeTruthy();

    // Quantity and Price are type="number" (spinbutton role)
    const qtyInput = screen.getByRole('spinbutton', { name: /quantity/i }) as HTMLInputElement;
    expect(qtyInput.value).toBe('100.00');

    const priceInput = screen.getByRole('spinbutton', { name: /price/i }) as HTMLInputElement;
    expect(priceInput.value).toBe('150.00');
  });

  // ── Step indicator renders ───────────────────────────────────────

  it('renders step indicator with Edit, Review, Confirm labels', () => {
    renderForm();
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByText('Confirm')).toBeTruthy();
  });

  // ── Form validation: empty symbol ─────────────────────────────────

  it('shows validation error when symbol is empty', async () => {
    renderForm();

    // Clear the symbol field
    const textboxes = screen.getAllByRole('textbox');
    const symInput = textboxes.find((tb) => (tb as HTMLInputElement).value === 'AAPL')!;
    await act(async () => {
      fireEvent.change(symInput, { target: { value: '' } });
    });

    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Symbol is required')).toBeTruthy();
    });

    // Should still be on form step
    expect(screen.getByText('Review Correction')).toBeTruthy();
  });

  // ── Form validation: empty quantity ───────────────────────────────

  it('shows validation error when quantity is empty', async () => {
    renderForm();

    const qtyInput = screen.getByRole('spinbutton', { name: /quantity/i });
    await act(async () => {
      fireEvent.change(qtyInput, { target: { value: '' } });
    });

    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Must be a positive number')).toBeTruthy();
    });
  });

  // ── Form validation: empty price ──────────────────────────────────

  it('shows validation error when price is empty', async () => {
    renderForm();

    const priceInput = screen.getByRole('spinbutton', { name: /price/i });
    await act(async () => {
      fireEvent.change(priceInput, { target: { value: '' } });
    });

    clickButton('Review Correction');

    await waitFor(() => {
      expect(screen.getByText('Must be a positive number')).toBeTruthy();
    });
  });

  // ── Confirmation step transition ──────────────────────────────────

  it('transitions to confirmation step on Review Correction click', async () => {
    renderForm();

    clickButton('Review Correction');

    // The confirmation step shows a comparison table with "Original" and "Replacement" headers
    await waitFor(() => {
      expect(screen.getByText('Original')).toBeTruthy();
    });
    // Replacement may be a table header — use getAllByText if it appears twice
    const replEls = screen.getAllByText('Replacement');
    expect(replEls.length).toBeGreaterThanOrEqual(1);

    // Confirm step should have "Back" and "Confirm Correction" buttons
    expect(screen.getByText('Back')).toBeTruthy();
    const confirmEls = screen.getAllByText('Confirm Correction');
    expect(confirmEls.length).toBeGreaterThanOrEqual(1);
  });

  // ── Back from confirmation step ──────────────────────────────────

  it('returns to form step when Back is clicked', async () => {
    renderForm();

    clickButton('Review Correction');
    await waitFor(() => {
      expect(screen.getByText('Original')).toBeTruthy();
    });

    clickButton('Back');

    // Should be back on form step with Review Correction button visible
    await waitFor(() => {
      expect(screen.getByText('Review Correction')).toBeTruthy();
    });
  });

  // ── Cancel closes dialog ─────────────────────────────────────────

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    const { mockOnOpenChange } = renderForm();

    clickButton('Cancel');

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  // ── Edits propagate to confirmation step ─────────────────────────

  it('reflects edited quantity in confirmation comparison', async () => {
    renderForm();

    // Change the quantity
    const qtyInput = screen.getByRole('spinbutton', { name: /quantity/i }) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(qtyInput, { target: { value: '50' } });
    });

    expect(qtyInput.value).toBe('50');

    clickButton('Review Correction');

    // Confirm step should show the edited value
    await waitFor(() => {
      expect(screen.getByText('Original')).toBeTruthy();
    });

    // The edited quantity "50" should appear in the comparison
    const tableEl = screen.getByRole('table');
    expect(tableEl.textContent).toContain('50');
  });

  // ── Accessible description ───────────────────────────────────────

  it('has accessible description for the dialog', () => {
    renderForm();

    const description = document.getElementById('correction-form-description');
    expect(description).toBeTruthy();
    expect(description?.textContent).toContain('Replace a posted execution');
  });

  // ── Help tooltip for symbol field ────────────────────────────────

  it('renders help tooltip for the symbol field', () => {
    renderForm();

    const tooltipButton = screen.getByLabelText(
      'The ticker symbol for the replacement. Can differ from the original if the ticker changed.',
    );
    expect(tooltipButton).toBeTruthy();
  });
});
