/**
 * Component tests for PlanTradeForm — R025 wrong-side planned stop blocking.
 *
 * Covers the form-boundary half of R025 (the API half is covered in
 * src/app/api/trades/__tests__/route.test.ts):
 * - Long stop >= entry: inline error below Stop Loss, submission blocked
 *   (fetch never called).
 * - Short stop <= entry: inline error below Stop Loss, submission blocked.
 * - Boundary equality (stop == entry): blocked for both directions.
 * - Valid long 100/95 and short 100/105: no error, submission proceeds with
 *   the expected payload.
 * - Partial entries (only entry, only stop, neither): never flagged.
 * - Inline error clears when the user corrects the stop.
 *
 * Run: npx vitest run --reporter verbose src/components/plan-trade-form.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from '@testing-library/react';
import PlanTradeForm from './plan-trade-form';
import type { Account, SetupDefinition } from './plan-trade-form';
import { TooltipProvider } from '@/components/ui/tooltip';

// jsdom does not implement Element.prototype.scrollIntoView; Radix Select calls
// it when opening the listbox. Polyfill before any Radix Select interaction.
Element.prototype.scrollIntoView = () => {};

// ── Fixtures ───────────────────────────────────────────────────────────

const ACCOUNTS: Account[] = [
  {
    id: 'acc-1',
    name: 'Main Trading',
    broker: null,
    currency: 'USD',
    isActive: true,
    maxRiskPerTradePct: 1,
    defaultCommission: 1,
    startingBalance: 10000,
  },
];

const SETUPS: SetupDefinition[] = [];

// ── Test Setup ─────────────────────────────────────────────────────────

const UNMOCKED_FETCH = globalThis.fetch;
let fetchMock: ReturnType<typeof makeFetchMock>;

/** Mock fetch to resolve a successful trade-creation response. */
function makeFetchMock() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ id: 'trade-1' }),
  } as Response);
}

beforeEach(() => {
  fetchMock = makeFetchMock();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  cleanup();
});

function renderForm() {
  return render(
    <TooltipProvider>
      <PlanTradeForm
        accounts={ACCOUNTS}
        setups={SETUPS}
        defaultAccountId="acc-1"
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    </TooltipProvider>,
  );
}

/** Change an input located through its htmlFor label. */
function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Submit via the Plan Trade button (type="submit", inside the form). */
function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Plan Trade' }));
}

/** Switch the Direction Radix Select (combobox) to a specific option. */
async function setDirection(option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Direction' }));
  const item = await screen.findByRole('option', { name: option });
  fireEvent.click(item);
}

/** Get the JSON body of the single fetch call to /api/trades. */
async function getPostedBody() {
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  const call = fetchMock.mock.calls[0];
  expect(call[0]).toBe('/api/trades');
  return JSON.parse((call[1] as RequestInit).body as string) as Record<
    string,
    unknown
  >;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('PlanTradeForm — R025 wrong-side planned stop blocking', () => {
  it('long stop >= entry: inline error below Stop Loss, submission blocked', async () => {
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');
    setField('Stop Loss', '105');

    // Inline blocking error below the Stop Loss field
    expect(screen.getByRole('alert').textContent).toContain(
      'Planned stop must be below the planned entry for a long trade.',
    );

    // Stop Loss input is marked invalid and described by the error
    const stopInput = screen.getByLabelText('Stop Loss') as HTMLInputElement;
    expect(stopInput.getAttribute('aria-invalid')).toBe('true');
    expect(stopInput.getAttribute('aria-describedby')).toBe(
      'plan-plannedStop-error',
    );

    submitForm();

    // Blocked — the payload is never sent
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('short stop <= entry: inline error below Stop Loss, submission blocked', async () => {
    renderForm();
    await setDirection('Short');
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');
    setField('Stop Loss', '95');

    expect(screen.getByRole('alert').textContent).toContain(
      'Planned stop must be above the planned entry for a short trade.',
    );

    submitForm();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('boundary equality (stop == entry) is blocked for both directions', async () => {
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');
    setField('Stop Loss', '100');

    expect(screen.getByRole('alert').textContent).toContain(
      'Planned stop must be below the planned entry for a long trade.',
    );
    submitForm();
    expect(fetchMock).not.toHaveBeenCalled();

    // Switch to short at the same boundary
    fireEvent.change(screen.getByLabelText('Stop Loss'), {
      target: { value: '' },
    });
    await setDirection('Short');
    setField('Stop Loss', '100');
    expect(screen.getByRole('alert').textContent).toContain(
      'Planned stop must be above the planned entry for a short trade.',
    );
  });

  it('valid long 100/95 submits normally with plannedStop 95', async () => {
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');
    setField('Stop Loss', '95');

    expect(screen.queryByRole('alert')).toBeNull();

    submitForm();
    const body = await getPostedBody();
    expect(body).toMatchObject({
      symbol: 'AAPL',
      direction: 'long',
      accountId: 'acc-1',
      plannedEntry: 100,
      plannedStop: 95,
      plannedQuantity: null,
    });
  });

  it('valid short 100/105 submits normally with plannedStop 105', async () => {
    renderForm();
    await setDirection('Short');
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');
    setField('Stop Loss', '105');

    expect(screen.queryByRole('alert')).toBeNull();

    submitForm();
    const body = await getPostedBody();
    expect(body).toMatchObject({
      symbol: 'AAPL',
      direction: 'short',
      plannedEntry: 100,
      plannedStop: 105,
    });
  });

  it('partial entries are never flagged — neither price field', async () => {
    renderForm();
    setField('Symbol', 'AAPL');

    // Neither price field: no error, submits with both null
    expect(screen.queryByRole('alert')).toBeNull();
    submitForm();
    const body = await getPostedBody();
    expect(body).toMatchObject({ plannedEntry: null, plannedStop: null });
  });

  it('partial entries are never flagged — only entry', async () => {
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');

    expect(screen.queryByRole('alert')).toBeNull();
    submitForm();
    const body = await getPostedBody();
    expect(body).toMatchObject({ plannedEntry: 100, plannedStop: null });
  });

  it('partial entries are never flagged — only stop', async () => {
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Stop Loss', '95');

    expect(screen.queryByRole('alert')).toBeNull();
    submitForm();
    const body = await getPostedBody();
    expect(body).toMatchObject({ plannedEntry: null, plannedStop: 95 });
  });

  it('inline error clears when the user corrects the stop', async () => {
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');
    setField('Stop Loss', '105');

    expect(screen.getByRole('alert')).toBeTruthy();

    // Correct the stop to the valid side
    fireEvent.change(screen.getByLabelText('Stop Loss'), {
      target: { value: '95' },
    });

    expect(screen.queryByRole('alert')).toBeNull();
    const stopInput = screen.getByLabelText('Stop Loss') as HTMLInputElement;
    expect(stopInput.getAttribute('aria-invalid')).toBeNull();

    submitForm();
    const body = await getPostedBody();
    expect(body).toMatchObject({ plannedEntry: 100, plannedStop: 95 });
  });
});
