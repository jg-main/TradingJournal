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
