/**
 * Component tests for EditTradeDialog — R019/T02 planning-field lifecycle.
 *
 * Covers:
 * - Planned trade: editable planning fields (symbol, direction, setup, entry,
 *   stop, targets, quantity); PUT sends the full planning payload.
 * - Open trade: lock banner + read-only historical planning fields (Symbol,
 *   Planned Entry, Targets, Quantity, Original Planned Stop); PUT omits ALL
 *   planning fields; Adjust Stop helper text.
 * - Closed trade: read-only historical planning fields; PUT omits planning
 *   fields; generalized helper text.
 * - Deleted trade: read-only historical planning fields; PUT omits planning
 *   fields.
 * - Narrative fields (thesis, invalidationCondition, preTradePlan) stay
 *   editable at any status and are the only fields sent for non-planned
 *   trades.
 *
 * Run: npx vitest run --reporter verbose src/components/edit-trade-dialog.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from '@testing-library/react';
import EditTradeDialog, { type EditableTrade } from './edit-trade-dialog';

// ── Fixtures ───────────────────────────────────────────────────────────

function makeTrade(
  overrides: Partial<EditableTrade> = {},
): EditableTrade {
  return {
    id: 't1',
    symbol: 'AAPL',
    direction: 'long',
    status: 'planned',
    accountId: 'a1',
    setupId: null,
    thesis: null,
    plannedEntry: 150,
    plannedStop: 145.5,
    plannedTarget1: null,
    plannedTarget2: null,
    plannedQuantity: null,
    invalidationCondition: null,
    preTradePlan: null,
    preTradeFrozen: false,
    ...overrides,
  };
}

// ── Test Setup ─────────────────────────────────────────────────────────

const UNMOCKED_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  cleanup();
});

/** First call resolves /api/setup-definitions; second resolves the PUT. */
function mockFetchForSave() {
  return vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
}

/**
 * The stop field label is a plain <label> without htmlFor, so locate the
 * input through the label's parent field container.
 */
function stopFieldInput(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  const container = label.parentElement as HTMLElement;
  const input = container.querySelector('input');
  if (!input) throw new Error(`No input found under label "${labelText}"`);
  return input as HTMLInputElement;
}

async function getPutBody(fetchMock: ReturnType<typeof vi.fn>) {
  await waitFor(() => {
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  const putCall = fetchMock.mock.calls[1];
  expect(putCall[0]).toBe('/api/trades/t1');
  expect(putCall[1]).toBeDefined();
  return JSON.parse((putCall[1] as RequestInit).body as string) as Record<
    string,
    unknown
  >;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('EditTradeDialog — planned trade (editable planning fields)', () => {
  it('renders an editable Stop Loss field seeded with the planned stop', () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText('Stop Loss')).toBeTruthy();
    expect(screen.queryByText('Original Planned Stop')).toBeNull();

    const input = stopFieldInput('Stop Loss');
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe('145.5');
  });

  it('shows no lock banner for planned trades', () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade()}
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/The complete pre-trade context/),
    ).toBeNull();
    const symbol = stopFieldInput('Symbol');
    expect(symbol.readOnly).toBe(false);
  });

  it('sends the edited plannedStop in the PUT payload', async () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade()}
        onSaved={vi.fn()}
      />,
    );

    const input = stopFieldInput('Stop Loss');
    fireEvent.change(input, { target: { value: '144' } });
    fireEvent.click(screen.getByText('Save Changes'));

    const body = await getPutBody(fetchMock);
    expect(body.plannedStop).toBe(144);
  });

  it('sends the full planning payload for planned trades', async () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade({ plannedTarget1: 160, plannedQuantity: 100 })}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Save Changes'));

    const body = await getPutBody(fetchMock);
    expect(body.symbol).toBe('AAPL');
    expect(body.direction).toBe('long');
    expect(body.plannedEntry).toBe(150);
    expect(body.plannedStop).toBe(145.5);
    expect(body.plannedTarget1).toBe(160);
    expect(body.plannedQuantity).toBe(100);
    expect(body).toHaveProperty('setup');
  });
});

describe('EditTradeDialog — open trade (read-only historical stop)', () => {
  it('shows read-only Original Planned Stop with Adjust Stop helper', () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade({ status: 'open', preTradeFrozen: true })}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText('Original Planned Stop')).toBeTruthy();
    expect(screen.queryByText('Stop Loss')).toBeNull();

    const input = stopFieldInput('Original Planned Stop');
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('aria-readonly')).toBe('true');
    expect(input.value).toBe('145.5');
    expect(
      screen.getByText(
        'Read-only — the active stop is managed through Adjust Stop.',
      ),
    ).toBeTruthy();
  });

  it('omits plannedStop from the PUT payload for open trades', async () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade({ status: 'open', preTradeFrozen: true })}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Save Changes'));

    const body = await getPutBody(fetchMock);
    expect(body).not.toHaveProperty('plannedStop');
  });

  it('shows the lock banner and renders ALL planning fields read-only', () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade({ status: 'open', preTradeFrozen: true })}
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/The complete pre-trade context/),
    ).toBeTruthy();

    const symbol = stopFieldInput('Symbol');
    expect(symbol.readOnly).toBe(true);
    expect(symbol.getAttribute('aria-readonly')).toBe('true');
    expect(symbol.value).toBe('AAPL');

    const entry = stopFieldInput('Planned Entry');
    expect(entry.readOnly).toBe(true);
    expect(entry.value).toBe('150');

    const target1 = stopFieldInput('Target 1');
    expect(target1.readOnly).toBe(true);

    const target2 = stopFieldInput('Target 2');
    expect(target2.readOnly).toBe(true);

    const qty = stopFieldInput('Quantity');
    expect(qty.readOnly).toBe(true);
  });

  it('A4: renders narrative fields read-only and sends NO pre-trade fields for a frozen trade', async () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade({
          status: 'open',
          preTradeFrozen: true,
          thesis: 'Old thesis',
          invalidationCondition: 'Old invalidation',
          preTradePlan: 'Old plan',
        })}
        onSaved={vi.fn()}
      />,
    );

    // The complete pre-trade context is historical evidence: narrative fields
    // render read-only (no post-entry edit affordance that can never succeed).
    const thesis = screen.getByPlaceholderText('Why are you taking this trade?') as HTMLTextAreaElement;
    expect(thesis.readOnly).toBe(true);
    expect(thesis.value).toBe('Old thesis');
    const invalidation = screen.getByPlaceholderText(
      'What would invalidate this trade idea?',
    ) as HTMLTextAreaElement;
    expect(invalidation.readOnly).toBe(true);
    expect(invalidation.value).toBe('Old invalidation');
    const plan = screen.getByPlaceholderText(
      'Your plan before executing this trade',
    ) as HTMLTextAreaElement;
    expect(plan.readOnly).toBe(true);
    expect(plan.value).toBe('Old plan');

    fireEvent.click(screen.getByText('Save Changes'));

    const body = await getPutBody(fetchMock);
    // Nothing editable remains for an executed trade — geometry AND narrative
    // are omitted (the backend would reject any of them with 400).
    expect(Object.keys(body).filter((k) => k !== 'updatedAt')).toEqual([]);
  });
});

describe('EditTradeDialog — closed trade (read-only historical stop)', () => {
  it('shows read-only Original Planned Stop with R019 helper', () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade({ status: 'closed', preTradeFrozen: true })}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText('Original Planned Stop')).toBeTruthy();
    expect(screen.queryByText('Stop Loss')).toBeNull();

    const input = stopFieldInput('Original Planned Stop');
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('aria-readonly')).toBe('true');
    expect(input.value).toBe('145.5');
    expect(
      screen.getByText(
        'Read-only — planning fields can only be changed while the trade is planned.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Update trade details. Planning fields are historical and locked after the first fill.',
      ),
    ).toBeTruthy();
  });

  it('omits plannedStop from the PUT payload for closed trades', async () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade({ status: 'closed', preTradeFrozen: true })}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Save Changes'));

    const body = await getPutBody(fetchMock);
    expect(body).not.toHaveProperty('plannedStop');
  });
});

describe('EditTradeDialog — deleted trade (read-only historical stop)', () => {
  it('shows read-only Original Planned Stop and omits plannedStop on save', async () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade({ status: 'deleted', preTradeFrozen: true })}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText('Original Planned Stop')).toBeTruthy();

    const input = stopFieldInput('Original Planned Stop');
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('145.5');

    fireEvent.click(screen.getByText('Save Changes'));

    const body = await getPutBody(fetchMock);
    expect(body).not.toHaveProperty('plannedStop');
  });
});

describe('EditTradeDialog — missing historical stop', () => {
  it('renders an empty read-only field when a non-planned trade has no plannedStop', () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade({ status: 'closed', preTradeFrozen: true, plannedStop: null })}
        onSaved={vi.fn()}
      />,
    );

    const input = stopFieldInput('Original Planned Stop');
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('');
  });
});
