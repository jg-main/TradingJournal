/**
 * Tests for WorkstationProvider controlled account mode (M007 S02/D037).
 *
 * Controlled mode: the global AccountProvider owns accounts + selection;
 * the workstation consumes them via props, skips its own accounts
 * bootstrap fetch, and routes selection changes to onAccountIdChange.
 * Uncontrolled mode (isolated /workspace) must be unchanged.
 *
 * Run: npx vitest run src/components/workstation/workstation-context.test.tsx
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';

// ── Mock the live adapter before importing the provider ─────────────

const fetchAccountsLive = vi.fn();
const fetchAllLiveDashboardData = vi.fn();

vi.mock('@/lib/workstation-live-adapter', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/workstation-live-adapter')>();
  return {
    ...original,
    fetchAccountsLive: (...args: unknown[]) => fetchAccountsLive(...args),
    fetchAllLiveDashboardData: (...args: unknown[]) =>
      fetchAllLiveDashboardData(...args),
    fetchWatchlistPricesLive: vi.fn().mockResolvedValue({ success: true, data: {} }),
  };
});

import { WorkstationProvider, useWorkstation } from './workstation-context';

// ── Probe ───────────────────────────────────────────────────────────

function Probe() {
  const {
    accounts,
    activeAccountId,
    setActiveAccountId,
    accountSelectionExternal,
  } = useWorkstation();
  return (
    <div>
      <span data-testid="external">{String(accountSelectionExternal)}</span>
      <span data-testid="active">{activeAccountId}</span>
      <span data-testid="accounts">{accounts.map((a) => a.id).join(',')}</span>
      <button data-testid="switch" onClick={() => setActiveAccountId('acc-2')} />
    </div>
  );
}

const controlledAccounts = [
  { id: 'acc-1', name: 'Main', currency: 'USD' },
  { id: 'acc-2', name: 'Taxable', currency: 'USD' },
];

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('WorkstationProvider account control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAllLiveDashboardData.mockResolvedValue({
      success: true,
      data: {
        accounts: controlledAccounts,
        positions: [],
        watchlist: [],
        dashboard: { setupRanking: [] },
        dashboardV2: { account: {} },
        risk: {},
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('controlled mode uses provided accounts and selection, skips bootstrap fetch', async () => {
    const onAccountIdChange = vi.fn();
    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-1"
        onAccountIdChange={onAccountIdChange}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    expect(screen.getByTestId('external').textContent).toBe('true');
    expect(screen.getByTestId('active').textContent).toBe('acc-1');
    expect(screen.getByTestId('accounts').textContent).toBe('acc-1,acc-2');
    // Bootstrap accounts fetch must NOT fire — the provider owns accounts.
    expect(fetchAccountsLive).not.toHaveBeenCalled();
  });

  it('controlled mode routes selection changes to onAccountIdChange', async () => {
    const onAccountIdChange = vi.fn();
    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-1"
        onAccountIdChange={onAccountIdChange}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    act(() => {
      screen.getByTestId('switch').click();
    });

    expect(onAccountIdChange).toHaveBeenCalledWith('acc-2');
  });

  it('controlled mode falls back to first account for an unknown id', async () => {
    render(
      <WorkstationProvider
        liveMode
        accounts={controlledAccounts}
        accountId="acc-unknown"
        onAccountIdChange={vi.fn()}
      >
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    expect(screen.getByTestId('active').textContent).toBe('acc-1');
  });

  it('uncontrolled mode keeps internal state and flags selection as local', async () => {
    // Fixture mode (no liveMode) — the isolated /workspace path.
    render(
      <WorkstationProvider>
        <Probe />
      </WorkstationProvider>,
    );
    await flush();

    expect(screen.getByTestId('external').textContent).toBe('false');
    // Fixture account from the default scenario.
    expect(screen.getByTestId('active').textContent).not.toBe('');

    act(() => {
      screen.getByTestId('switch').click();
    });
    // Internal fallback: 'acc-2' is not a fixture account, so it falls
    // back to the fixture account id — but crucially no crash and no
    // external callback involvement.
    expect(screen.getByTestId('external').textContent).toBe('false');
  });
});
