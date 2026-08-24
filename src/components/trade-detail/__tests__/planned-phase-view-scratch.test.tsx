/**
 * Tests for the Scratch action in PlannedPhaseView (M015/S02/T02).
 *
 * The planned detail view dropdown gets a Scratch menu item (Trash2) between
 * Edit and Assess. Clicking it calls the page-provided `onScratch` callback —
 * the detail page owns the ConfirmDialog, the DELETE /api/trades/[id] call,
 * and the navigation back to /trades (mirror of T01's page-owns-it split for
 * the list row menu, minus the context: PlannedPhaseView already receives
 * callbacks as props). `onScratch` is optional so existing renderings keep
 * working.
 *
 * Run: npx vitest run src/components/trade-detail/__tests__/planned-phase-view-scratch.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import PlannedPhaseView from '@/components/trade-detail/planned-phase-view';
import type { Trade, TradeAsset } from '@/components/trade-detail/types';

const mockOnExecute = vi.fn();
const mockOnEdit = vi.fn();
const mockOnAssetsChanged = vi.fn(async () => {});

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-001',
    tradeCode: 'TC-001',
    symbol: 'AAPL',
    direction: 'long',
    accountId: 'acc-001',
    setupId: null,
    setupName: null,
    marketConditionId: null,
    status: 'planned',
    plannedEntry: 150,
    plannedStop: 145,
    plannedTarget1: 160,
    plannedTarget2: null,
    plannedQuantity: 100,
    thesis: 'Breakout continuation',
    invalidationCondition: null,
    preTradePlan: null,
    openedAt: null,
    closedAt: null,
    exitNotes: null,
    lesson: null,
    reviewedAt: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

/**
 * PlannedPhaseView fetches the latest assessment on mount — stub the fetch
 * to a benign empty payload so the effect resolves instead of hitting the
 * network.
 */
function stubFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderView(onScratch?: () => void) {
  return render(
    <PlannedPhaseView
      trade={makeTrade()}
      assets={[] as TradeAsset[]}
      onAssetsChanged={mockOnAssetsChanged}
      onExecute={mockOnExecute}
      onEdit={mockOnEdit}
      onScratch={onScratch}
    />,
  );
}

describe('PlannedPhaseView Scratch action', () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mockOnExecute.mockClear();
    mockOnEdit.mockClear();
    mockOnAssetsChanged.mockClear();
  });

  it('shows a Scratch menu item in the planned detail view dropdown', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));

    expect(await screen.findByRole('menuitem', { name: /scratch/i })).toBeTruthy();
    // Edit and Assess stay available alongside the new item
    expect(screen.getByRole('menuitem', { name: /edit/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /assess/i })).toBeTruthy();
  });

  it('calls onScratch when Scratch is clicked', async () => {
    const onScratch = vi.fn();
    renderView(onScratch);

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /scratch/i }));

    expect(onScratch).toHaveBeenCalledTimes(1);
    // Scratch must not fire the Edit or Execute callbacks
    expect(mockOnEdit).not.toHaveBeenCalled();
    expect(mockOnExecute).not.toHaveBeenCalled();
  });

  it('does not crash when onScratch is omitted (optional prop)', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /scratch/i }));
    // No onScratch → the menu item is a no-op; nothing thrown.
  });
});
