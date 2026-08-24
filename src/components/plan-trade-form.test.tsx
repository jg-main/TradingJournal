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

/** Preview payload returned for /api/trades/planned-risk-preview requests. */
interface PreviewPayload {
  riskDollar: number | null;
  riskPct: number | null;
  accountRiskPct: number | null;
  rewardDollar: number | null;
  rewardPct: number | null;
  riskRewardRatio: number | null;
  equityAtOpen: number | null;
  maxRiskPerTradePct: number | null;
  maxRiskExceeded: boolean;
}

const DEFAULT_PREVIEW: PreviewPayload = {
  riskDollar: 500,
  riskPct: 5,
  accountRiskPct: 5,
  rewardDollar: 1000,
  rewardPct: 10,
  riskRewardRatio: 2,
  equityAtOpen: 10000,
  maxRiskPerTradePct: 1,
  maxRiskExceeded: true,
};

/**
 * URL-aware fetch mock: preview requests (planned-risk-preview) resolve with
 * the configured preview payload; everything else is a successful trade
 * creation. Fail previews when previewOpts.failPreview is set.
 */
function makeFetchMock(previewOpts?: {
  preview?: Partial<PreviewPayload> | null;
  failPreview?: boolean;
}) {
  const preview = previewOpts?.preview ?? DEFAULT_PREVIEW;
  const failPreview = previewOpts?.failPreview ?? false;
  return vi.fn().mockImplementation((url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.startsWith('/api/trades/planned-risk-preview')) {
      if (failPreview) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => preview,
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({ id: 'trade-1' }),
    } as Response);
  });
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

describe('PlanTradeForm — narrative field character limit', () => {
  it('blocks submission when Thesis exceeds 600 characters', async () => {
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Thesis', 'x'.repeat(601));
    submitForm();
    await expect(screen.findByText(/Thesis must be max 600 characters/)).resolves.toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks submission when Invalidation Condition exceeds 600 characters', async () => {
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Invalidation Condition', 'y'.repeat(601));
    submitForm();
    await expect(
      screen.findByText(/Invalidation Condition must be max 600 characters/),
    ).resolves.toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a two-small-paragraph Thesis under 600 characters and submits it', async () => {
    renderForm();
    setField('Symbol', 'AAPL');
    const thesis =
      'First small paragraph: the setup aligns with the trend and volume supports the move. ' +
      'Second small paragraph: the target zone offers a favorable risk-to-reward ratio.';
    setField('Thesis', thesis);
    submitForm();
    const body = await getPostedBody();
    expect(body.thesis).toBe(thesis);
  });
});

describe('PlanTradeForm — account-relative risk preview (S02/T05)', () => {
  it('displays account risk % of equity when preview data is available', async () => {
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');
    setField('Stop Loss', '95');
    setField('Qty', '100');

    // Debounced preview fetch fires once the price/quantity inputs settle;
    // the Account Risk row renders X.XX% of account equity.
    await screen.findByText('of account equity');
    expect(screen.getByText('5.00%')).toBeTruthy();

    // The preview request carries the account + planned geometry
    const previewCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).startsWith('/api/trades/planned-risk-preview'),
    );
    expect(previewCall).toBeTruthy();
    const url = new URL(String(previewCall![0]), 'http://localhost');
    expect(url.searchParams.get('accountId')).toBe('acc-1');
    expect(url.searchParams.get('direction')).toBe('long');
    expect(url.searchParams.get('entry')).toBe('100');
    expect(url.searchParams.get('stop')).toBe('95');
    expect(url.searchParams.get('quantity')).toBe('100');
  });

  it('shows the max-risk warning when the preview reports maxRiskExceeded', async () => {
    fetchMock = makeFetchMock({
      preview: {
        ...DEFAULT_PREVIEW,
        accountRiskPct: 5,
        maxRiskPerTradePct: 2,
        maxRiskExceeded: true,
      },
    });
    globalThis.fetch = fetchMock;
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');
    setField('Stop Loss', '95');
    setField('Qty', '100');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'This trade exceeds the account max-risk limit of 2%',
    );
  });

  it('shows no max-risk warning when within the limit', async () => {
    fetchMock = makeFetchMock({
      preview: {
        ...DEFAULT_PREVIEW,
        accountRiskPct: 0.5,
        maxRiskExceeded: false,
      },
    });
    globalThis.fetch = fetchMock;
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');
    setField('Stop Loss', '95');
    setField('Qty', '100');

    await screen.findByText('0.50%');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back to a dash for Account Risk when the preview request fails', async () => {
    fetchMock = makeFetchMock({ failPreview: true });
    globalThis.fetch = fetchMock;
    renderForm();
    setField('Symbol', 'AAPL');
    setField('Planned Entry', '100');
    setField('Stop Loss', '95');
    setField('Qty', '100');

    // The client-side risk/reward preview still renders; Account Risk is '—'
    // because the account-relative fetch failed.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).startsWith('/api/trades/planned-risk-preview'),
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText('Account Risk').parentElement!.textContent).toContain('—');
    });
  });
});
