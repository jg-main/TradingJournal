/**
 * Tests for the Scratch action in ActionsCell (M015/S02/T01).
 *
 * The Scratch menu item:
 *   - appears only on planned rows (DELETE /api/trades/[id] is planned-only)
 *   - calls the page-provided requestScratch handler via TradesScratchContext
 *     (the page owns the ConfirmDialog, DELETE call, and refetch)
 *   - must never trigger the row-level navigation (stopPropagation contract
 *     from M011/S06) — the menu content is portaled, so row handlers don't fire
 *   - falls back to a no-op when rendered without a provider, so standalone
 *     renderings (tests, legacy surfaces) don't crash
 *
 * Run: npx vitest run "src/app/(trades)/trades/__tests__/scratch-action.test.tsx"
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mockPush = vi.fn();

// Mock next/navigation before importing ActionsCell (it calls useRouter)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/trades',
}));

import { ActionsCell, type ActionsCellRow } from '@/components/trades/actions-cell';
import { TradesScratchContext } from '@/components/trades/scratch-context';

function makeRow(overrides: Partial<ActionsCellRow> = {}): ActionsCellRow {
  return { id: 'trade-001', status: 'planned', ...overrides };
}

/** Renders ActionsCell inside a row with the scratch context provided. */
function Harness({
  row,
  requestScratch,
}: {
  row: ActionsCellRow;
  requestScratch?: (tradeId: string) => void;
}) {
  return (
    <TradesScratchContext.Provider
      value={{ requestScratch: requestScratch ?? (() => {}) }}
    >
      <table>
        <tbody>
          <tr onClick={() => {}}>
            <td data-testid="row-body">AAPL</td>
            <td>
              <ActionsCell row={row} />
            </td>
          </tr>
        </tbody>
      </table>
    </TradesScratchContext.Provider>
  );
}

describe('ActionsCell Scratch action', () => {
  afterEach(() => {
    cleanup();
    mockPush.mockClear();
  });

  it('shows a Scratch menu item on planned rows', async () => {
    render(<Harness row={makeRow()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Trade actions' }));

    expect(await screen.findByRole('menuitem', { name: /scratch/i })).toBeTruthy();
    // View Details stays available alongside the new item
    expect(screen.getByRole('menuitem', { name: /view details/i })).toBeTruthy();
  });

  it('calls requestScratch with the trade id without navigating', async () => {
    const requestScratch = vi.fn();
    render(<Harness row={makeRow()} requestScratch={requestScratch} />);

    await userEvent.click(screen.getByRole('button', { name: 'Trade actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /scratch/i }));

    expect(requestScratch).toHaveBeenCalledTimes(1);
    expect(requestScratch).toHaveBeenCalledWith('trade-001');
    // Scratch must not trigger the row's navigation
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not show a Scratch item on non-planned rows', async () => {
    render(<Harness row={makeRow({ status: 'closed' })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Trade actions' }));

    expect(await screen.findByRole('menuitem', { name: /view details/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /scratch/i })).toBeNull();
  });

  it('does not crash when rendered without a provider (default no-op)', async () => {
    render(
      <table>
        <tbody>
          <tr>
            <td>
              <ActionsCell row={makeRow()} />
            </td>
          </tr>
        </tbody>
      </table>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Trade actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /scratch/i }));
    // No provider → requestScratch is the context default no-op; nothing thrown.
  });
});
