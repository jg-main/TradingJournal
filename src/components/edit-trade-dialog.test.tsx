/**
 * Component tests for EditTradeDialog — R019 planned-stop lifecycle.
 *
 * Covers:
 * - Planned trade: editable "Stop Loss" field; PUT sends plannedStop.
 * - Open trade: read-only historical "Original Planned Stop"; PUT omits
 *   plannedStop; Adjust Stop helper text.
 * - Closed trade: read-only historical "Original Planned Stop"; PUT omits
 *   plannedStop; R019 helper text.
 * - Deleted trade: read-only historical "Original Planned Stop"; PUT omits
 *   plannedStop.
 * - Missing plannedStop renders an empty read-only field for non-planned
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

describe('EditTradeDialog — planned trade (editable Stop Loss)', () => {
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
});

describe('EditTradeDialog — open trade (read-only historical stop)', () => {
  it('shows read-only Original Planned Stop with Adjust Stop helper', () => {
    const fetchMock = mockFetchForSave();
    globalThis.fetch = fetchMock;

    render(
      <EditTradeDialog
        open
        onOpenChange={vi.fn()}
        trade={makeTrade({ status: 'open' })}
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
        trade={makeTrade({ status: 'open' })}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Save Changes'));

    const body = await getPutBody(fetchMock);
    expect(body).not.toHaveProperty('plannedStop');
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
        trade={makeTrade({ status: 'closed' })}
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
        'Read-only — the planned stop can only be changed while the trade is planned.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Update trade details. The planned stop is historical and read-only.',
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
        trade={makeTrade({ status: 'closed' })}
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
        trade={makeTrade({ status: 'deleted' })}
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
        trade={makeTrade({ status: 'closed', plannedStop: null })}
        onSaved={vi.fn()}
      />,
    );

    const input = stopFieldInput('Original Planned Stop');
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('');
  });
});
