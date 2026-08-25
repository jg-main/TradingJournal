/**
 * Fix 6 — ExecuteDialog idempotency-key lifecycle.
 *
 * A. First submit sends a non-empty key.
 * B. Network-error retry reuses the SAME key.
 * C. HTTP-error retry reuses the SAME key.
 * D. Success clears the key; a new dialog session gets a new key.
 * E. Cancel clears the key; reopening mints a new key.
 * F. No double submit while the first request is unresolved.
 *
 * The dialog is rendered at the entry-form step (trade.accountId = null) so no
 * setup/checklist fetches run. Run: npx vitest run src/components/execute-dialog.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ExecuteDialog } from './execute-dialog';
import type { ExecuteTradeData } from './execute-dialog';

// jsdom does not implement Element.prototype.scrollIntoView; Radix Select
// calls it when opening the option list (repo pattern).
Element.prototype.scrollIntoView = () => {};

const TRADE: ExecuteTradeData = {
  id: 'trade-1',
  tradeCode: 'T-0001',
  symbol: 'AAPL',
  direction: 'long',
  plannedEntry: 100,
  plannedStop: 95,
  plannedTarget1: null,
  plannedQuantity: 10,
  accountId: null, // → entry-form step directly, no setup/checklist fetches
  setupId: null,
};

function renderDialog(overrides?: { open?: boolean }) {
  const onOpenChange = vi.fn();
  const onComplete = vi.fn();
  const utils = render(
    <ExecuteDialog
      trade={TRADE}
      open={overrides?.open ?? true}
      onOpenChange={onOpenChange}
      onComplete={onComplete}
    />,
  );
  return { ...utils, onOpenChange, onComplete };
}

/** Fill the minimal required fields and submit. */
function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/Entry Price/), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText(/Size/), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: /^Execute$/ }));
}

/** Extract the idempotencyKey from the captured /execute request body. */
function lastKey(): string | null {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const url = String(calls[i][0]);
    if (url.includes('/execute')) {
      const body = JSON.parse((calls[i][1] as RequestInit).body as string) as { idempotencyKey?: string };
      return body.idempotencyKey ?? null;
    }
  }
  return null;
}

const UNMOCKED_FETCH = globalThis.fetch;

describe('ExecuteDialog — idempotency-key lifecycle (Fix 6)', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = UNMOCKED_FETCH;
    cleanup();
  });

  it('A. first submit sends a non-empty idempotency key', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({}),
    } as Response);
    renderDialog();
    fillAndSubmit();

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    const key = lastKey();
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(10);
  });

  it('B. network-error retry reuses the SAME key', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) } as Response);

    renderDialog();
    fillAndSubmit();
    // First request rejects → connection error shown, dialog stays open.
    await waitFor(() => {
      expect(screen.getByText(/Failed to execute trade/)).toBeTruthy();
    });
    const first = lastKey();

    fillAndSubmit();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const second = lastKey();
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it('C. HTTP-error retry reuses the SAME key', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Trade is not in planned status' }),
    } as Response);
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) } as Response);

    renderDialog();
    fillAndSubmit();
    await waitFor(() => {
      expect(screen.getByText('Trade is not in planned status')).toBeTruthy();
    });
    const first = lastKey();

    fillAndSubmit();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(lastKey()).toBe(first);
  });

  it('D. success clears the key; a new dialog session gets a new key', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) } as Response);

    const firstSession = renderDialog();
    fillAndSubmit();
    await waitFor(() => {
      expect(firstSession.onComplete).toHaveBeenCalled();
    });
    const first = lastKey();
    firstSession.unmount();

    // A genuinely new dialog session (fresh mount) must mint a new key.
    renderDialog();
    fillAndSubmit();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const second = lastKey();
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('E. cancel clears the key; reopening mints a new key', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new Error('Network error'));

    const session = renderDialog();
    fillAndSubmit();
    await waitFor(() => {
      expect(screen.getByText(/Failed to execute trade/)).toBeTruthy();
    });
    const first = lastKey();

    // Cancel closes the dialog (abandon the logical submission) — the
    // close-reset path clears the submission key.
    session.rerender(
      <ExecuteDialog trade={TRADE} open={false} onOpenChange={session.onOpenChange} onComplete={() => {}} />,
    );
    session.unmount();

    // Reopen → new logical session.
    renderDialog();
    fillAndSubmit();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const second = lastKey();
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('F. no double submit while the first request is unresolved', async () => {
    let release!: (r: Response) => void;
    const pending = new Promise<Response>((res) => {
      release = res;
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReturnValueOnce(pending);
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) } as Response);

    renderDialog();
    fillAndSubmit();

    // While in flight, the submit button is disabled — a second activation is
    // impossible; simulate the guard directly.
    const submitButton = screen.getByRole('button', { name: /Executing/ }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    fireEvent.click(submitButton); // no-op
    await act(async () => {
      release({ ok: true, status: 201, json: async () => ({}) } as Response);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fix 7 — setup-picker initialization + persisted setup coherence
// ═══════════════════════════════════════════════════════════════════════════

const SETUP_LESS_TRADE: ExecuteTradeData = {
  ...TRADE,
  accountId: 'acc-A',
  setupId: null,
};

const WITH_SETUP_TRADE: ExecuteTradeData = {
  ...TRADE,
  accountId: 'acc-A',
  setupId: 'setup-breakout',
};

const SETUPS = [
  { id: 'setup-breakout', name: 'Breakout', description: null },
  { id: 'setup-pivot', name: 'Episodic Pivot', description: null },
];

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errJson(body: unknown, status = 500): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

function urlOf(call: unknown[]): string {
  return String(call[0]);
}

describe('ExecuteDialog — setup picker (Fix 7)', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const impl = (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/api/setup-definitions')) {
        return Promise.resolve(okJson({ data: SETUPS }));
      }
      if (u.includes('/api/checks/merged')) {
        return Promise.resolve(okJson([]));
      }
      return Promise.resolve(okJson({ id: 'trade-1', setupId: null }));
    };
    fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
  });
  afterEach(() => {
    fetchMock.mockRestore();
    cleanup();
  });

  function renderSetupDialog(overrides?: {
    trade?: ExecuteTradeData;
    onTradeChanged?: () => void;
  }) {
    const onOpenChange = vi.fn();
    const onComplete = vi.fn();
    const onTradeChanged = overrides?.onTradeChanged ?? vi.fn();
    const utils = render(
      <ExecuteDialog
        trade={overrides?.trade ?? SETUP_LESS_TRADE}
        open
        onOpenChange={onOpenChange}
        onComplete={onComplete}
        onTradeChanged={onTradeChanged}
      />,
    );
    return { ...utils, onOpenChange, onComplete, onTradeChanged };
  }

  async function pickSetup(optionName: string) {
    fireEvent.click(screen.getByRole('combobox'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const option = screen.getByRole('option', { name: optionName });
    fireEvent.click(option);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('A. setup-less initial open fetches and renders the active setup catalogue', async () => {
    renderSetupDialog();
    await waitFor(() => {
      const setupCall = fetchMock.mock.calls.find((c: [RequestInfo | URL, RequestInit?]) => urlOf(c).includes('/api/setup-definitions'));
      expect(setupCall).toBeTruthy();
    });
    // Wait for the catalogue to render in the picker.
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('combobox'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('option', { name: 'Breakout' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Episodic Pivot' })).toBeTruthy();
  });

  it('B. no false empty while the catalogue request is unresolved', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/api/setup-definitions')) {
        return new Promise<Response>((res) => {
          release = res;
        });
      }
      return Promise.resolve(okJson({ id: 'trade-1' }));
    });
    renderSetupDialog();
    await act(async () => {
      await Promise.resolve();
    });
    // Loading state shown; the empty-catalogue message must NOT appear.
    expect(screen.getByText('Loading setups...')).toBeTruthy();
    expect(screen.queryByText(/No setup definitions found/)).toBeNull();
    await act(async () => {
      release(okJson({ data: SETUPS }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText('Loading setups...')).toBeNull();
    });
  });

  it('C. successful empty catalogue shows the truthful empty message', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/api/setup-definitions')) {
        return Promise.resolve(okJson({ data: [] }));
      }
      return Promise.resolve(okJson({ id: 'trade-1' }));
    });
    renderSetupDialog();
    await waitFor(() => {
      expect(screen.getByText(/No setup definitions found/)).toBeTruthy();
    });
  });

  it('D. catalogue fetch failure shows an error + Retry, never a false empty', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/api/setup-definitions')) {
        return Promise.resolve(errJson({ error: 'Setup catalogue unavailable' }));
      }
      return Promise.resolve(okJson({ id: 'trade-1' }));
    });
    renderSetupDialog();
    await waitFor(() => {
      expect(screen.getByText('Setup catalogue unavailable')).toBeTruthy();
    });
    expect(screen.queryByText(/No setup definitions found/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('E. Retry after a failure loads the catalogue', async () => {
    let failFirst = true;
    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/api/setup-definitions')) {
        if (failFirst) {
          failFirst = false;
          return Promise.resolve(errJson({ error: 'Setup catalogue unavailable' }));
        }
        return Promise.resolve(okJson({ data: SETUPS }));
      }
      return Promise.resolve(okJson({ id: 'trade-1' }));
    });
    renderSetupDialog();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('F. selecting a setup PUTs exactly once with setupId and syncs the parent', async () => {
    const onTradeChanged = vi.fn();
    renderSetupDialog({ onTradeChanged });
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    await pickSetup('Breakout');
    const putCalls = fetchMock.mock.calls.filter((c: [RequestInfo | URL, RequestInit?]) => String(c[1]?.method).toUpperCase() === 'PUT');
    expect(putCalls).toHaveLength(1);
    expect(urlOf(putCalls[0])).toContain('/api/trades/trade-1');
    expect(JSON.parse((putCalls[0][1] as RequestInit).body as string)).toEqual({ setupId: 'setup-breakout' });
    expect(onTradeChanged).toHaveBeenCalled();
  });

  it('G. PUT failure stays on the picker, no checklist request, no parent sync', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/setup-definitions')) {
        return Promise.resolve(okJson({ data: SETUPS }));
      }
      if (init?.method === 'PUT') {
        return Promise.resolve(errJson({ error: 'Failed to save setup' }));
      }
      return Promise.resolve(okJson([]));
    });
    const onTradeChanged = vi.fn();
    renderSetupDialog({ onTradeChanged });
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    await pickSetup('Breakout');
    await waitFor(() => {
      expect(screen.getByText('Failed to save setup')).toBeTruthy();
    });
    // Still on the setup picker; no merged-checklist fetch; no parent sync.
    expect(screen.getByRole('combobox')).toBeTruthy();
    const checklistCalls = fetchMock.mock.calls.filter((c: [RequestInfo | URL, RequestInit?]) => urlOf(c).includes('/api/checks/merged'));
    expect(checklistCalls).toHaveLength(0);
    expect(onTradeChanged).not.toHaveBeenCalled();
  });

  it('H. successful persistence fetches the merged checklist for account + setup', async () => {
    renderSetupDialog();
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    await pickSetup('Breakout');
    await waitFor(() => {
      const checklistCall = fetchMock.mock.calls.find((c: [RequestInfo | URL, RequestInit?]) => urlOf(c).includes('/api/checks/merged'));
      expect(checklistCall).toBeTruthy();
    });
    const checklistUrl = urlOf(
      fetchMock.mock.calls.find((c: [RequestInfo | URL, RequestInit?]) => urlOf(c).includes('/api/checks/merged'))!,
    );
    expect(checklistUrl).toContain('accountId=acc-A');
    expect(checklistUrl).toContain('setupId=setup-breakout');
  });

  it('I. an existing setup never fetches the setup catalogue — initializes via merged checklist', async () => {
    renderSetupDialog({ trade: WITH_SETUP_TRADE });
    await waitFor(() => {
      const checklistCall = fetchMock.mock.calls.find((c: [RequestInfo | URL, RequestInit?]) => urlOf(c).includes('/api/checks/merged'));
      expect(checklistCall).toBeTruthy();
    });
    const setupCalls = fetchMock.mock.calls.filter((c: [RequestInfo | URL, RequestInit?]) => urlOf(c).includes('/api/setup-definitions'));
    expect(setupCalls).toHaveLength(0);
    // Empty merged checklist → straight to the entry form.
    await waitFor(() => {
      expect(screen.getByLabelText(/Entry Price/)).toBeTruthy();
    });
  });

  it('J. changing setup via Back PUTs T, clears the old checklist, and fetches checklist for T', async () => {
    // Two-step checklist: Breakout has 1 required item, Episodic Pivot has none.
    fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/setup-definitions')) {
        return Promise.resolve(okJson({ data: SETUPS }));
      }
      if (u.includes('/api/checks/merged')) {
        if (u.includes('setupId=setup-breakout')) {
          return Promise.resolve(okJson([{ id: 'c1', description: 'Check 1', sortOrder: 0 }]));
        }
        return Promise.resolve(okJson([]));
      }
      if (init?.method === 'PUT') {
        return Promise.resolve(okJson({ id: 'trade-1', setupId: JSON.parse((init.body as string)).setupId }));
      }
      return Promise.resolve(okJson({ id: 'trade-1' }));
    });
    renderSetupDialog();
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    // Select Breakout → checklist step with one item.
    await pickSetup('Breakout');
    await waitFor(() => {
      expect(screen.getByText('Check 1')).toBeTruthy();
    });

    // Back → setup picker.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    // Select Episodic Pivot → PUT T, old checklist cleared, entry form (no items).
    await pickSetup('Episodic Pivot');
    const putBodies = fetchMock.mock.calls
      .filter((c: [RequestInfo | URL, RequestInit?]) => String(c[1]?.method).toUpperCase() === 'PUT')
      .map((c: [RequestInfo | URL, RequestInit?]) => JSON.parse((c[1] as RequestInit).body as string));
    expect(putBodies.some((b: { setupId: string }) => b.setupId === 'setup-pivot')).toBe(true);
    await waitFor(() => {
      expect(screen.queryByText('Check 1')).toBeNull();
      expect(screen.getByLabelText(/Entry Price/)).toBeTruthy();
    });
  });
});
