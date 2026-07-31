/**
 * Regression test for the Actions dropdown propagation fix (M011/S06/T02).
 *
 * The DynamicTable row renders with an onClick handler that navigates to
 * /trades/{id}. The Actions ⋮ trigger lives inside the row, so without
 * stopping propagation a click on it would BOTH open the menu AND bubble up
 * to the <tr>, kicking the user off the list page.
 *
 * This test exercises the REAL Radix DropdownMenu + the real ActionsCell and
 * pins the contract:
 *   - clicking the ⋮ trigger does NOT fire the row click handler
 *   - the menu still opens when the trigger is clicked
 *   - pressing Enter on the focused trigger does NOT fire the row handler
 *   - clicking the row body still fires the row click handler (navigation intact)
 *   - selecting a menu item still navigates to the trade detail page
 *
 * Run: npx vitest run "src/app/(trades)/trades/__tests__/actions-propagation.test.tsx"
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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

function makeRow(overrides: Partial<ActionsCellRow> = {}): ActionsCellRow {
  return { id: 'trade-001', status: 'planned', ...overrides };
}

/** Renders ActionsCell inside a row that mirrors DynamicTable's click/keydown wiring. */
function Harness({
  row,
  onRowClick,
  onRowKeyDown,
}: {
  row: ActionsCellRow;
  onRowClick: () => void;
  onRowKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  return (
    <table>
      <tbody>
        <tr onClick={onRowClick} onKeyDown={onRowKeyDown}>
          <td data-testid="row-body">AAPL</td>
          <td>
            <ActionsCell row={row} />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

describe('ActionsCell event propagation', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('clicking the row body still fires the row click handler', async () => {
    const onRowClick = vi.fn();
    render(<Harness row={makeRow()} onRowClick={onRowClick} />);

    await userEvent.click(screen.getByTestId('row-body'));

    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('clicking the ⋮ trigger opens the menu WITHOUT firing the row click handler', async () => {
    const onRowClick = vi.fn();
    render(<Harness row={makeRow()} onRowClick={onRowClick} />);

    const trigger = screen.getByRole('button', { name: 'Trade actions' });
    await userEvent.click(trigger);

    // Menu opens (real Radix content, portaled)
    expect(await screen.findByRole('menuitem', { name: /view details/i })).toBeTruthy();
    // Row navigation must NOT have fired
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('pressing Enter on the focused trigger opens the menu WITHOUT firing the row handlers', async () => {
    const onRowClick = vi.fn();
    const onRowKeyDown = vi.fn();
    render(<Harness row={makeRow()} onRowClick={onRowClick} onRowKeyDown={onRowKeyDown} />);

    const trigger = screen.getByRole('button', { name: 'Trade actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('menuitem', { name: /view details/i })).toBeTruthy();
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowKeyDown).not.toHaveBeenCalled();
  });

  it('selecting a menu item still navigates to the trade detail page', async () => {
    const onRowClick = vi.fn();
    render(<Harness row={makeRow()} onRowClick={onRowClick} />);

    await userEvent.click(screen.getByRole('button', { name: 'Trade actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /view details/i }));

    expect(mockPush).toHaveBeenCalledWith('/trades/trade-001');
  });
});
