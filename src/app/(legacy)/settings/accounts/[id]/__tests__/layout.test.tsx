/**
 * Component tests for the Account Detail layout (M004 Task 24).
 *
 * Characterizes the MANAGEMENT_WIDE account-detail family shell:
 * - The shared layout is the SINGLE owner of the outer shell (mx-auto
 *   max-w-7xl px-4 py-6, matching the Accounts list surface), Back to
 *   Accounts navigation, account identity header, and workspace tabs;
 *   child routes render bare content inside it.
 * - Loading and not-found/error states keep the same family geometry.
 * - Account identity, status badge, tab navigation, and children render.
 *
 * Run: npx vitest run --reporter verbose src/app/\(legacy\)/settings/accounts/\[id\]/__tests__/layout.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import React, { Suspense, type ComponentType } from 'react';

let AccountDetailLayout: ComponentType<{ children: React.ReactNode; params: Promise<{ id: string }> }>;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/settings/accounts/acc-1',
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => React.createElement('a', { href, ...props }, children),
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/accounts/[id]/layout');
  AccountDetailLayout = mod.default;
});

// ── Fixtures ────────────────────────────────────────────────────────────

const ACCOUNT = {
  id: 'acc-1',
  name: 'Primary Account',
  broker: 'IBKR',
  currency: 'USD',
  isActive: true,
};

interface FetchCall {
  url: string;
}

function mockFetchHandlers(options: { account?: Record<string, unknown> | null }) {
  const calls: FetchCall[] = [];
  const mockFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push({ url });
    if (options.account === null) {
      return { ok: false, json: async () => ({ error: 'Not found' }) } as Response;
    }
    return { ok: true, json: async () => options.account ?? ACCOUNT } as Response;
  });
  globalThis.fetch = mockFn;
  return { mockFn, calls };
}

const UNMOCKED_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  cleanup();
});

async function renderLayout() {
  let container!: HTMLElement;
  await act(async () => {
    container = render(
      <Suspense fallback={<div data-testid="suspended" />}>
        <AccountDetailLayout params={Promise.resolve({ id: 'acc-1' })}>
          <div data-testid="tab-content">Overview content</div>
        </AccountDetailLayout>
      </Suspense>,
    ).container;
  });
  return container;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Account Detail layout — MANAGEMENT_WIDE shell', () => {
  it('shows the loading state inside the management-wide geometry', async () => {
    let resolveFetch!: (value: Response) => void;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    const container = await renderLayout();
    expect(container.querySelector('.max-w-7xl')).toBeTruthy();
    expect(screen.getByText(/loading account\.\.\./i)).toBeTruthy();
    resolveFetch({ ok: true, json: async () => ACCOUNT } as Response);
    await waitFor(() => {
      expect(screen.queryByText(/loading account\.\.\./i)).toBeNull();
    });
  });

  it('renders the not-found state with Back to Accounts navigation', async () => {
    mockFetchHandlers({ account: null });
    await renderLayout();
    await waitFor(() => {
      expect(screen.getByText(/account not found/i)).toBeTruthy();
    });
    const back = screen.getByRole('link', { name: /back to accounts/i });
    expect(back.getAttribute('href')).toBe('/settings/accounts');
  });

  it('renders the loaded shell: Back to Accounts, header, tabs, and children', async () => {
    mockFetchHandlers({ account: ACCOUNT });
    const container = await renderLayout();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /primary account/i })).toBeTruthy();
    });

    // MANAGEMENT_WIDE outer geometry (same as the Accounts list surface).
    expect(container.querySelector('.max-w-7xl')).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to accounts/i }).getAttribute('href')).toBe('/settings/accounts');
    expect(screen.getByText('IBKR')).toBeTruthy();
    expect(screen.getByText('USD')).toBeTruthy();

    // Workspace tab navigation (Overview is the base route; no active badge).
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Ledger', 'Positions', 'Settings']);
    expect(screen.getByTestId('tab-content').textContent).toBe('Overview content');
  });

  it('renders the Inactive badge for inactive accounts', async () => {
    mockFetchHandlers({ account: { ...ACCOUNT, isActive: false } });
    await renderLayout();
    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeTruthy();
    });
  });

  it('renders no Inactive badge for active accounts', async () => {
    mockFetchHandlers({ account: ACCOUNT });
    await renderLayout();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /primary account/i })).toBeTruthy();
    });
    expect(screen.queryByText('Inactive')).toBeNull();
  });
});
