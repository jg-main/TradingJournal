/**
 * Fix 9 — AddFillDialog exposes the canonical short Add / Reduce management
 * actions (the engine's DIRECTION_ACTIONS already supports them; only the
 * client catalogue was missing them).
 *
 * A. Long options: Buy / Add / Sell / Reduce.
 * B. Short options: Sell Short / Add / Buy to Cover / Reduce (the regression).
 * C. Short Add payload: action=add.
 * D. Short Reduce payload: action=reduce.
 * E. Concrete short actions remain: Sell Short / Buy to Cover.
 *
 * Run: npx vitest run src/components/trade-detail/__tests__/add-fill-dialog.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { AddFillDialog, getFillActions } from '../add-fill-dialog';

Element.prototype.scrollIntoView = () => {};

const LONG_TRADE = { id: 't-long', symbol: 'AAPL', direction: 'long' as const, plannedQuantity: 100 };
const SHORT_TRADE = { id: 't-short', symbol: 'TSLA', direction: 'short' as const, plannedQuantity: 100 };

const UNMOCKED_FETCH = globalThis.fetch;

describe('AddFillDialog — short Add/Reduce catalogue (Fix 9)', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const impl = async () =>
      new Response(JSON.stringify({ id: 'exec-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
  });
  afterEach(() => {
    fetchMock.mockRestore();
    cleanup();
  });

  function renderDialog(direction: 'long' | 'short') {
    const onOpenChange = vi.fn();
    const onComplete = vi.fn();
    const utils = render(
      <AddFillDialog
        trade={direction === 'long' ? LONG_TRADE : SHORT_TRADE}
        open
        onOpenChange={onOpenChange}
        onComplete={onComplete}
      />,
    );
    return { ...utils, onOpenChange, onComplete };
  }

  async function openActionOptions() {
    fireEvent.click(screen.getByRole('combobox'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function lastExecBody(): { action?: string } {
    const calls = fetchMock.mock.calls;
    for (let i = calls.length - 1; i >= 0; i--) {
      if (String(calls[i][0]).includes('/executions')) {
        return JSON.parse((calls[i][1] as RequestInit).body as string) as { action?: string };
      }
    }
    return {};
  }

  async function selectAction(label: string) {
    await openActionOptions();
    const option = screen.getByRole('option', { name: label });
    fireEvent.click(option);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function submitFill() {
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add Fill$/ }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  }

  it('A. long options are exactly Buy / Add / Sell / Reduce', async () => {
    expect(getFillActions('long')).toEqual(['buy', 'add', 'sell', 'reduce']);
    renderDialog('long');
    await openActionOptions();
    expect(screen.getByRole('option', { name: 'Buy' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Add' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Sell' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Reduce' })).toBeTruthy();
  });

  it('B. short options include Add and Reduce (Sell Short / Add / Buy to Cover / Reduce)', async () => {
    expect(getFillActions('short')).toEqual(['sell_short', 'add', 'buy_to_cover', 'reduce']);
    renderDialog('short');
    await openActionOptions();
    expect(screen.getByRole('option', { name: 'Sell Short' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Add' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Buy to Cover' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Reduce' })).toBeTruthy();
  });

  it('C. short Add submits action=add', async () => {
    renderDialog('short');
    await selectAction('Add');
    await submitFill();
    expect(lastExecBody().action).toBe('add');
  });

  it('D. short Reduce submits action=reduce', async () => {
    renderDialog('short');
    await selectAction('Reduce');
    await submitFill();
    expect(lastExecBody().action).toBe('reduce');
  });

  it('E. concrete short actions remain selectable (Sell Short / Buy to Cover)', async () => {
    renderDialog('short');
    await selectAction('Sell Short');
    await submitFill();
    expect(lastExecBody().action).toBe('sell_short');

    cleanup();
    renderDialog('short');
    await selectAction('Buy to Cover');
    await submitFill();
    expect(lastExecBody().action).toBe('buy_to_cover');
  });
});
