/**
 * Tests for the workstation ReviewWriteSheet (M024/S02/T01).
 *
 * The sheet is a controlled component: the host panel passes open/
 * onOpenChange and receives onSaved after a successful PUT. On open it
 * auto-generates-or-loads the current week's review via POST
 * /api/reviews/weekly { weekStart, accountId } (upsert), displays the
 * auto-computed metrics, and saves notes/focus-next-week via
 * PUT /api/reviews/weekly/[id]. These tests mock the context module and
 * global fetch, then pin:
 *
 *   - fixture mode (liveMode=false) renders nothing (no write chrome)
 *   - open in live mode POSTs the current week with the active account
 *     and renders metrics + editable notes/focus
 *   - load failure surfaces an inline alert + Retry and logs [review-sheet]
 *   - save failure surfaces an inline form error and keeps the sheet open
 *   - save success PUTs notes/focus, calls onSaved, and closes
 *   - empty notes/focus are sent as null (cleared, not blank strings)
 *
 * Run: npx vitest run src/components/workstation/review-write-sheet.test.tsx
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import type { WeeklyReviewRow } from './review-write-sheet';
import { ReviewWriteSheet } from './review-write-sheet';

// ── Mock workstation context ────────────────────────────────────────────

const mockUseWorkstation = vi.fn();

vi.mock('./workstation-context', () => ({
  useWorkstation: () => mockUseWorkstation(),
}));

// ── Global fetch mock ───────────────────────────────────────────────────

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

// ── Fixture factories ───────────────────────────────────────────────────

function reviewRow(overrides: Partial<WeeklyReviewRow> = {}): WeeklyReviewRow {
  return {
    id: 'rev-1',
    weekStart: '2026-08-17',
    weekEnd: '2026-08-23',
    accountId: 'acc-1',
    closedTrades: 5,
    netPnl: 1234.5,
    avgR: 1.25,
    winRate: 0.6,
    avgProcessScore: 48,
    notes: null,
    focusNextWeek: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

function mockFetchResponse(status: number, body: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

/** Local-time Monday of today as YYYY-MM-DD — mirrors the sheet's week
 *  detection so the expected POST body is exact. */
function mondayIsoDate(now: Date): string {
  const date = new Date(now);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().split('T')[0];
}

function renderSheet(overrides: Partial<WeeklyReviewRow> = {}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  mockUseWorkstation.mockReturnValue({
    activeAccountId: 'acc-1',
    liveMode: true,
  });
  mockFetchResponse(200, reviewRow(overrides));
  render(
    <ReviewWriteSheet
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
  );
  return { onOpenChange, onSaved };
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

describe('ReviewWriteSheet live-mode gating', () => {
  it('renders nothing in fixture mode — no write chrome, no fetch', () => {
    mockUseWorkstation.mockReturnValue({
      activeAccountId: 'acc-1',
      liveMode: false,
    });
    const { container } = render(
      <ReviewWriteSheet open onOpenChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Generate / load flow ────────────────────────────────────────────────

describe('ReviewWriteSheet generate-or-load', () => {
  it('POSTs the current week for the active account on open', async () => {
    const { onOpenChange, onSaved } = renderSheet();
    expect(onOpenChange).toBeTruthy();
    expect(onSaved).toBeTruthy();

    // Auto-generated on open: one POST upsert.
    expect(await screen.findByTestId('ws-review-sheet-metrics')).toBeTruthy();
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/reviews/weekly');
    expect(init.method).toBe('POST');
    expect(lastFetchBody()).toEqual({
      weekStart: mondayIsoDate(new Date()),
      accountId: 'acc-1',
    });
  });

  it('displays the auto-computed metrics from the loaded review', async () => {
    renderSheet();
    await screen.findByTestId('ws-review-sheet-metrics');

    expect(
      screen.getByTestId('ws-review-sheet-metric-trades').textContent,
    ).toBe('5');
    expect(
      screen.getByTestId('ws-review-sheet-metric-netpnl').textContent,
    ).toBe('$1,234.50');
    expect(
      screen.getByTestId('ws-review-sheet-metric-winrate').textContent,
    ).toBe('60.0%');
    expect(
      screen.getByTestId('ws-review-sheet-metric-avgr').textContent,
    ).toBe('1.25');
    // 48/60 maps to grade B via the canonical GRADE_RUBRIC.
    expect(
      screen.getByTestId('ws-review-sheet-metric-grade').textContent,
    ).toBe('B (48.0)');
  });

  it('pre-fills notes and focus from an existing review', async () => {
    renderSheet({
      notes: 'Disciplined week',
      focusNextWeek: 'Wait for confirmation',
    });
    await screen.findByTestId('ws-review-sheet-metrics');

    const notesEl = screen.getByTestId(
      'ws-review-sheet-notes',
    ) as HTMLTextAreaElement;
    const focusEl = screen.getByTestId(
      'ws-review-sheet-focus',
    ) as HTMLTextAreaElement;
    expect(notesEl.value).toBe('Disciplined week');
    expect(focusEl.value).toBe('Wait for confirmation');
  });

  it('shows a dash for metrics that have no data', async () => {
    renderSheet({ avgR: null, avgProcessScore: null });
    await screen.findByTestId('ws-review-sheet-metrics');

    expect(screen.getByTestId('ws-review-sheet-metric-avgr').textContent).toBe(
      '—',
    );
    expect(
      screen.getByTestId('ws-review-sheet-metric-grade').textContent,
    ).toBe('—');
  });
});

// ── Load failure ────────────────────────────────────────────────────────

describe('ReviewWriteSheet load failure', () => {
  it('surfaces an inline alert with Retry and logs [review-sheet]', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mockUseWorkstation.mockReturnValue({
      activeAccountId: 'acc-1',
      liveMode: true,
    });
    mockFetchResponse(500, { error: 'Failed to generate weekly review' });

    render(<ReviewWriteSheet open onOpenChange={() => {}} />);

    const alert = await screen.findByTestId('ws-review-sheet-error');
    expect(alert.textContent).toContain('Failed to generate weekly review');
    expect(screen.getByTestId('ws-review-sheet-retry')).toBeTruthy();
    expect(consoleError).toHaveBeenCalledWith(
      '[review-sheet] generate/load failed (500): Failed to generate weekly review',
    );
    consoleError.mockRestore();
  });

  it('retry re-POSTs and recovers to the ready state', async () => {
    mockUseWorkstation.mockReturnValue({
      activeAccountId: 'acc-1',
      liveMode: true,
    });
    // First attempt fails, retry succeeds.
    mockFetchResponse(500, { error: 'Failed to generate weekly review' });
    mockFetchResponse(200, reviewRow());

    render(<ReviewWriteSheet open onOpenChange={() => {}} />);
    await screen.findByTestId('ws-review-sheet-error');

    fireEvent.click(screen.getByTestId('ws-review-sheet-retry'));
    expect(await screen.findByTestId('ws-review-sheet-metrics')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── Save flow ───────────────────────────────────────────────────────────

describe('ReviewWriteSheet save flow', () => {
  it('PUTs notes and focus to /api/reviews/weekly/[id], calls onSaved, closes', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSaved } = renderSheet();
    await screen.findByTestId('ws-review-sheet-metrics');

    const saved = reviewRow({
      notes: 'Good discipline',
      focusNextWeek: 'Tighten stops',
    });
    mockFetchResponse(200, saved);

    fireEvent.change(screen.getByTestId('ws-review-sheet-notes'), {
      target: { value: 'Good discipline' },
    });
    fireEvent.change(screen.getByTestId('ws-review-sheet-focus'), {
      target: { value: 'Tighten stops' },
    });
    await user.click(screen.getByTestId('ws-review-sheet-save'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    const [url, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/reviews/weekly/rev-1');
    expect(init.method).toBe('PUT');
    expect(lastFetchBody()).toEqual({
      notes: 'Good discipline',
      focusNextWeek: 'Tighten stops',
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(saved);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('sends null for notes/focus left empty (cleared, not blank strings)', async () => {
    const user = userEvent.setup();
    renderSheet({
      notes: 'Old note to clear',
      focusNextWeek: 'Old focus',
    });
    await screen.findByTestId('ws-review-sheet-metrics');

    mockFetchResponse(200, reviewRow({ notes: null, focusNextWeek: null }));

    // Clear both fields.
    fireEvent.change(screen.getByTestId('ws-review-sheet-notes'), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByTestId('ws-review-sheet-focus'), {
      target: { value: '' },
    });
    await user.click(screen.getByTestId('ws-review-sheet-save'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    expect(lastFetchBody()).toEqual({
      notes: null,
      focusNextWeek: null,
    });
  });

  it('surfaces a save failure as an inline form error and stays open', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const user = userEvent.setup();
    const { onOpenChange, onSaved } = renderSheet();
    await screen.findByTestId('ws-review-sheet-metrics');

    mockFetchResponse(400, {
      error: 'Validation failed',
      details: {
        formErrors: [],
        fieldErrors: {
          notes: ['Expected string, received number'],
        },
      },
    });

    fireEvent.change(screen.getByTestId('ws-review-sheet-notes'), {
      target: { value: 'New note' },
    });
    await user.click(screen.getByTestId('ws-review-sheet-save'));

    const formError = await screen.findByTestId('ws-review-sheet-form-error');
    expect(formError.textContent).toBe('Expected string, received number');
    // Sheet stays open; no onSaved/close.
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[review-sheet] save failed (400): Expected string, received number',
    );
    consoleError.mockRestore();
  });

  it('surfaces a network failure as an inline form error', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSaved } = renderSheet();
    await screen.findByTestId('ws-review-sheet-metrics');

    mockFetch.mockRejectedValueOnce(new Error('connection lost'));

    fireEvent.change(screen.getByTestId('ws-review-sheet-notes'), {
      target: { value: 'New note' },
    });
    await user.click(screen.getByTestId('ws-review-sheet-save'));

    const formError = await screen.findByTestId('ws-review-sheet-form-error');
    expect(formError.textContent).toBe(
      'Network error — could not save the weekly review',
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
