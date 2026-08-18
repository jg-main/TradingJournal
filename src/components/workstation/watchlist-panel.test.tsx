/**
 * Tests for the workstation WatchlistPanel CRUD (M024/S01/T03).
 *
 * The panel is a pure consumer of WorkstationContext (fixtures, liveMode,
 * refreshLiveData) and mutates via POST/PUT/DELETE /api/watchlist followed by
 * refreshLiveData() so the table reflects each change without a reload.
 * These tests mock the context module and global fetch, then pin:
 *
 *   - live mode renders the header '+ Add' action, per-row Edit/Remove
 *     actions, and an Actions column; fixture mode keeps the read-only table
 *     unchanged (no actions, no Actions column)
 *   - empty state: live mode gains an Add action; fixture mode stays
 *     text-only
 *   - add flow: opens the dialog, POSTs {symbol, direction, triggerPrice,
 *     keyLevel, status} to /api/watchlist, then calls refreshLiveData
 *   - edit flow: PUTs to /api/watchlist/[id] with pre-filled form values,
 *     then calls refreshLiveData
 *   - delete flow: Remove → confirm dialog → DELETE /api/watchlist/[id],
 *     then refreshLiveData; cancel path performs no fetch
 *   - negative paths: empty symbol and invalid price block submission with
 *     inline errors and no fetch; API 400 fieldErrors surface inline; delete
 *     failure surfaces the mutation error without refresh
 *   - row rendering (symbol, dir, status, trigger) is unchanged from the
 *     pre-CRUD panel
 *
 * Run: npx vitest run src/components/workstation/watchlist-panel.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import type { WorkstationWatchlistItem } from '@/lib/workstation-fixtures';
import { WatchlistPanel } from './watchlist-panel';

// jsdom does not implement Element.prototype.scrollIntoView; Radix Select
// calls it when opening the listbox. Polyfill before any Select interaction
// (repo convention — cf. plan-trade-form.test.tsx).
Element.prototype.scrollIntoView = () => {};

// ── Mock workstation context ────────────────────────────────────────────

const mockUseWorkstation = vi.fn();
const mockRefreshLiveData = vi.fn();

vi.mock('./workstation-context', () => ({
  useWorkstation: () => mockUseWorkstation(),
}));

// ── Global fetch mock ───────────────────────────────────────────────────

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

// ── Fixture factories ───────────────────────────────────────────────────

function watchlistItem(
  overrides: Partial<WorkstationWatchlistItem> = {},
): WorkstationWatchlistItem {
  return {
    id: 'wl-1',
    dateAdded: '2026-01-01T00:00:00.000Z',
    symbol: 'NVDA',
    sectorId: null,
    name: 'NVIDIA Corp',
    sector: null,
    industry: null,
    setupId: null,
    direction: 'long',
    thesis: null,
    marketContext: null,
    keyLevel: null,
    triggerPrice: null,
    plannedStop: null,
    targetPrice: null,
    status: 'watching',
    notes: null,
    promotedTradeId: null,
    alertConfig: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const NVDA = watchlistItem({ symbol: 'NVDA', triggerPrice: 131.5 });

type MockCtx = {
  fixtures: {
    watchlist: WorkstationWatchlistItem[];
    symbolPrices: Record<string, unknown>;
    marketIndices: unknown[];
  };
  liveMode: boolean;
  refreshLiveData: typeof mockRefreshLiveData;
};

function renderPanel(ctx: Partial<MockCtx> = {}) {
  mockUseWorkstation.mockReturnValue({
    fixtures: {
      watchlist: [NVDA],
      symbolPrices: {},
      marketIndices: [],
    },
    liveMode: true,
    refreshLiveData: mockRefreshLiveData,
    ...ctx,
  });
  return render(<WatchlistPanel />);
}

function mockFetchResponse(status: number, body: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

/** Open the add/edit dialog via the header Add action. */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('ws-watchlist-add'));
  expect(await screen.findByTestId('ws-watchlist-dialog')).toBeTruthy();
}

/** Switch a Radix Select (combobox) to a specific option. */
async function setSelect(name: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  const item = await screen.findByRole('option', { name: option });
  fireEvent.click(item);
}

/** Capture the JSON body of the single most recent fetch call. */
function lastFetchBody(): Record<string, unknown> {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return JSON.parse((call[1] as RequestInit).body as string) as Record<
    string,
    unknown
  >;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUseWorkstation.mockReset();
  mockFetch.mockReset();
});

// ── Live-mode gating ────────────────────────────────────────────────────

describe('WatchlistPanel live-mode gating', () => {
  it('renders CRUD actions in live mode', () => {
    renderPanel({ liveMode: true });

    expect(screen.getByTestId('ws-watchlist-add')).toBeTruthy();
    expect(screen.getByTestId('ws-watchlist-row-NVDA-edit')).toBeTruthy();
    expect(screen.getByTestId('ws-watchlist-row-NVDA-remove')).toBeTruthy();

    const headers = Array.from(
      screen.getByTestId('ws-watchlist-table').querySelectorAll('thead th'),
    ).map((h) => h.textContent);
    expect(headers).toContain('Actions');
  });

  it('hides all CRUD actions in fixture mode (read-only table)', () => {
    renderPanel({ liveMode: false });

    expect(screen.queryByTestId('ws-watchlist-add')).toBeNull();
    expect(screen.queryByTestId('ws-watchlist-row-NVDA-edit')).toBeNull();
    expect(screen.queryByTestId('ws-watchlist-row-NVDA-remove')).toBeNull();

    const headers = Array.from(
      screen.getByTestId('ws-watchlist-table').querySelectorAll('thead th'),
    ).map((h) => h.textContent);
    expect(headers).toHaveLength(7);
    expect(headers).not.toContain('Actions');
  });

  it('empty state gains an Add action in live mode only', () => {
    renderPanel({
      liveMode: true,
      fixtures: { watchlist: [], symbolPrices: {}, marketIndices: [] },
    });
    expect(screen.getByTestId('ws-watchlist-empty-add')).toBeTruthy();
    expect(screen.getByTestId('ws-watchlist-add')).toBeTruthy();
  });

  it('empty state stays text-only in fixture mode', () => {
    renderPanel({
      liveMode: false,
      fixtures: { watchlist: [], symbolPrices: {}, marketIndices: [] },
    });
    expect(screen.getByTestId('ws-watchlist-empty')).toBeTruthy();
    expect(screen.queryByTestId('ws-watchlist-empty-add')).toBeNull();
    expect(screen.queryByTestId('ws-watchlist-add')).toBeNull();
  });
});

// ── Row / empty-state rendering unchanged ───────────────────────────────

describe('WatchlistPanel row rendering', () => {
  it('renders the unchanged row: symbol, dir, status, trigger', () => {
    renderPanel({ liveMode: false });

    const row = screen.getByTestId('ws-watchlist-row-NVDA');
    expect(row.textContent).toContain('NVDA');
    expect(row.textContent).toContain('L'); // long direction label
    expect(screen.getByTestId('ws-status-NVDA').textContent).toBe('watching');
    expect(row.textContent).toContain('131.50'); // trigger price
  });

  it('renders a dash for a null trigger price', () => {
    renderPanel({
      liveMode: false,
      fixtures: {
        watchlist: [watchlistItem({ id: 'wl-2', symbol: 'AMD' })],
        symbolPrices: {},
        marketIndices: [],
      },
    });
    const row = screen.getByTestId('ws-watchlist-row-AMD');
    expect(row.textContent).toContain('—');
  });
});

// ── Add flow ────────────────────────────────────────────────────────────

describe('WatchlistPanel add flow', () => {
  it('POSTs the form payload then calls refreshLiveData', async () => {
    const user = userEvent.setup();
    renderPanel({ liveMode: true });
    mockFetchResponse(201, { id: 'wl-new' });

    await openDialog(user);
    expect(
      screen.getByRole('heading', { name: 'Add to watchlist' }),
    ).toBeTruthy();

    fireEvent.change(screen.getByTestId('ws-watchlist-form-symbol'), {
      target: { value: 'TSLA' },
    });
    fireEvent.change(screen.getByTestId('ws-watchlist-form-trigger'), {
      target: { value: '250.5' },
    });
    fireEvent.change(screen.getByTestId('ws-watchlist-form-keylevel'), {
      target: { value: '240' },
    });
    await setSelect('Direction', 'Short');
    await setSelect('Status', 'triggered');

    await user.click(screen.getByTestId('ws-watchlist-form-submit'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/watchlist');
    expect(init.method).toBe('POST');
    expect(lastFetchBody()).toEqual({
      symbol: 'TSLA',
      direction: 'short',
      triggerPrice: 250.5,
      keyLevel: 240,
      status: 'triggered',
    });

    await waitFor(() => {
      expect(mockRefreshLiveData).toHaveBeenCalledTimes(1);
    });
    // Dialog closes after a successful mutation.
    expect(screen.queryByTestId('ws-watchlist-dialog')).toBeNull();
  });

  it('sends null prices when the optional fields are left empty', async () => {
    const user = userEvent.setup();
    renderPanel({ liveMode: true });
    mockFetchResponse(201, { id: 'wl-new' });

    await openDialog(user);
    fireEvent.change(screen.getByTestId('ws-watchlist-form-symbol'), {
      target: { value: 'AMD' },
    });
    await user.click(screen.getByTestId('ws-watchlist-form-submit'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    expect(lastFetchBody()).toEqual({
      symbol: 'AMD',
      direction: 'long',
      triggerPrice: null,
      keyLevel: null,
      status: 'pending',
    });
  });

  it('blocks submission with an inline error when symbol is empty', async () => {
    const user = userEvent.setup();
    renderPanel({ liveMode: true });

    await openDialog(user);
    await user.click(screen.getByTestId('ws-watchlist-form-submit'));

    expect(await screen.findByTestId('ws-watchlist-form-error')).toBeTruthy();
    expect(screen.getByTestId('ws-watchlist-form-error').textContent).toBe(
      'Symbol is required',
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRefreshLiveData).not.toHaveBeenCalled();
  });

  it('blocks non-numeric trigger price with an inline error', async () => {
    const user = userEvent.setup();
    renderPanel({ liveMode: true });

    await openDialog(user);
    fireEvent.change(screen.getByTestId('ws-watchlist-form-symbol'), {
      target: { value: 'TSLA' },
    });
    fireEvent.change(screen.getByTestId('ws-watchlist-form-trigger'), {
      target: { value: 'abc' },
    });
    await user.click(screen.getByTestId('ws-watchlist-form-submit'));

    expect(await screen.findByTestId('ws-watchlist-form-error')).toBeTruthy();
    expect(screen.getByTestId('ws-watchlist-form-error').textContent).toBe(
      'Trigger price must be a valid number',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces a 400 validation fieldError inline', async () => {
    const user = userEvent.setup();
    renderPanel({ liveMode: true });
    mockFetchResponse(400, {
      error: 'Validation failed',
      details: {
        formErrors: [],
        fieldErrors: {
          symbol: ['String must contain at most 20 character(s)'],
        },
      },
    });

    await openDialog(user);
    // 21-char symbol passes the client-side required check but exceeds the
    // API's max(20) constraint, so the server 400 path is exercised.
    fireEvent.change(screen.getByTestId('ws-watchlist-form-symbol'), {
      target: { value: 'A'.repeat(21) },
    });
    await user.click(screen.getByTestId('ws-watchlist-form-submit'));

    expect(await screen.findByTestId('ws-watchlist-form-error')).toBeTruthy();
    expect(screen.getByTestId('ws-watchlist-form-error').textContent).toBe(
      'String must contain at most 20 character(s)',
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockRefreshLiveData).not.toHaveBeenCalled();
  });

  it('surfaces a network failure inline without refreshing', async () => {
    const user = userEvent.setup();
    renderPanel({ liveMode: true });
    mockFetch.mockRejectedValueOnce(new Error('connection lost'));

    await openDialog(user);
    fireEvent.change(screen.getByTestId('ws-watchlist-form-symbol'), {
      target: { value: 'TSLA' },
    });
    await user.click(screen.getByTestId('ws-watchlist-form-submit'));

    expect(await screen.findByTestId('ws-watchlist-form-error')).toBeTruthy();
    expect(screen.getByTestId('ws-watchlist-form-error').textContent).toContain(
      'Network error',
    );
    expect(mockRefreshLiveData).not.toHaveBeenCalled();
    // Dialog stays open so the user can retry.
    expect(screen.getByTestId('ws-watchlist-dialog')).toBeTruthy();
  });
});

// ── Edit flow ───────────────────────────────────────────────────────────

describe('WatchlistPanel edit flow', () => {
  it('PUTs the updated fields to /api/watchlist/[id] then refreshes', async () => {
    const user = userEvent.setup();
    renderPanel({ liveMode: true });
    mockFetchResponse(200, { ...NVDA, triggerPrice: 140, status: 'triggered' });

    await user.click(screen.getByTestId('ws-watchlist-row-NVDA-edit'));
    expect(await screen.findByTestId('ws-watchlist-dialog')).toBeTruthy();
    expect(screen.getByText('Edit NVDA')).toBeTruthy();

    // Pre-filled from the row.
    const symbolInput = screen.getByTestId(
      'ws-watchlist-form-symbol',
    ) as HTMLInputElement;
    expect(symbolInput.value).toBe('NVDA');
    const triggerInput = screen.getByTestId(
      'ws-watchlist-form-trigger',
    ) as HTMLInputElement;
    expect(triggerInput.value).toBe('131.5');

    fireEvent.change(triggerInput, { target: { value: '140' } });
    await setSelect('Status', 'triggered');
    await user.click(screen.getByTestId('ws-watchlist-form-submit'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/watchlist/wl-1');
    expect(init.method).toBe('PUT');
    expect(lastFetchBody()).toEqual({
      symbol: 'NVDA',
      direction: 'long',
      triggerPrice: 140,
      keyLevel: null,
      status: 'triggered',
    });

    await waitFor(() => {
      expect(mockRefreshLiveData).toHaveBeenCalledTimes(1);
    });
  });
});

// ── Delete flow ─────────────────────────────────────────────────────────

describe('WatchlistPanel delete flow', () => {
  it('DELETEs the item after confirmation then refreshes', async () => {
    const user = userEvent.setup();
    renderPanel({ liveMode: true });
    mockFetchResponse(200, { message: 'Watchlist item expired' });

    await user.click(screen.getByTestId('ws-watchlist-row-NVDA-remove'));
    expect(await screen.findByTestId('ws-watchlist-confirm-delete')).toBeTruthy();
    expect(screen.getByText('Remove NVDA?')).toBeTruthy();

    await user.click(screen.getByTestId('ws-watchlist-confirm-delete-yes'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/watchlist/wl-1');
    expect(init.method).toBe('DELETE');

    await waitFor(() => {
      expect(mockRefreshLiveData).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('ws-watchlist-confirm-delete')).toBeNull();
  });

  it('cancel closes the confirm dialog without any fetch', async () => {
    const user = userEvent.setup();
    renderPanel({ liveMode: true });

    await user.click(screen.getByTestId('ws-watchlist-row-NVDA-remove'));
    expect(await screen.findByTestId('ws-watchlist-confirm-delete')).toBeTruthy();

    await user.click(screen.getByTestId('ws-watchlist-confirm-delete-no'));
    expect(screen.queryByTestId('ws-watchlist-confirm-delete')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRefreshLiveData).not.toHaveBeenCalled();
  });

  it('surfaces a delete failure inline without refreshing', async () => {
    const user = userEvent.setup();
    renderPanel({ liveMode: true });
    mockFetchResponse(404, { error: 'Watchlist item not found' });

    await user.click(screen.getByTestId('ws-watchlist-row-NVDA-remove'));
    await user.click(
      await screen.findByTestId('ws-watchlist-confirm-delete-yes'),
    );

    expect(
      await screen.findByTestId('ws-watchlist-mutation-error'),
    ).toBeTruthy();
    expect(screen.getByTestId('ws-watchlist-mutation-error').textContent).toBe(
      'Watchlist item not found',
    );
    expect(mockRefreshLiveData).not.toHaveBeenCalled();
  });
});
