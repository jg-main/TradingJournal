/**
 * Component tests for the Accounts management page (M004/T8).
 *
 * Proves the MANAGEMENT_WIDE grammar:
 *  - compact page header with semantic H1 + canonical Add Account Button
 *  - no top-level "Back to Settings" link
 *  - default-account section uses the shared Select + canonical Save Button
 *  - status badges use canonical Badge semantics
 *  - success/error message roles preserved
 *  - table renders all rows and row navigation is unchanged
 *
 * Run: npx vitest run "src/app/(legacy)/settings/accounts/__tests__/page.test.tsx"
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import AccountsPage from '../page';

// ── Mocks ───────────────────────────────────────────────────────────────

const mockRouter = { push: vi.fn(), back: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('@/lib/account-context', () => ({
  useAccount: () => ({
    refresh: vi.fn().mockResolvedValue(undefined),
    setAccountId: vi.fn(),
  }),
}));

vi.mock('@/components/accounting/add-account-dialog', () => ({
  AddAccountDialog: ({ open }: { open: boolean }) =>
    open ? React.createElement('div', { 'data-testid': 'add-account-dialog-open' }) : null,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}));

// jsdom does not implement Element.prototype.scrollIntoView; Radix Select
// calls it when opening its option list (matches the repo pattern).
Element.prototype.scrollIntoView = () => {};

// ── Fixtures ────────────────────────────────────────────────────────────

const ACCOUNTS = [
  { id: 'acc-1', name: 'Main Trading', broker: 'IBKR', currency: 'USD', isActive: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'acc-2', name: 'Retirement', broker: null, currency: 'USD', isActive: false, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
];

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function setupFetchMocks(options: { defaultAccountId?: string | null; settingsFail?: boolean; accountsFail?: boolean } = {}) {
  const { defaultAccountId = null, settingsFail = false, accountsFail = false } = options;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr === '/api/accounts') {
      return accountsFail
        ? ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
        : okResponse(ACCOUNTS);
    }
    if (urlStr === '/api/settings') {
      return settingsFail
        ? ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
        : okResponse({ defaultAccountId });
    }
    return ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response);
  });
}

async function renderLoaded(options?: { defaultAccountId?: string | null }) {
  setupFetchMocks(options);
  render(<AccountsPage />);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Accounts', level: 1 })).toBeTruthy());
}

async function chooseSelectOption(comboboxName: string, optionName: string) {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('option', { name: optionName }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockRouter.push.mockClear();
});

beforeEach(() => {
  window.localStorage.clear();
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('AccountsPage — management page grammar (M004/T8)', () => {
  it('renders a semantic H1 Accounts', async () => {
    await renderLoaded();
    const heading = screen.getByRole('heading', { name: 'Accounts', level: 1 });
    expect(heading.textContent).toBe('Accounts');
  });

  it('has no top-level Back to Settings link', async () => {
    await renderLoaded();
    expect(screen.queryByText('Back to Settings')).toBeNull();
    expect(screen.queryByRole('link', { name: /Back to Settings/i })).toBeNull();
  });

  it('renders Add Account through the canonical Button', async () => {
    await renderLoaded();
    const addBtn = screen.getByRole('button', { name: /Add Account/i });
    expect(addBtn.getAttribute('data-slot')).toBe('button');
    expect(addBtn.getAttribute('data-variant')).toBe('default');
    // No redundant "+" text next to the Landmark icon.
    expect(addBtn.textContent?.trim()).not.toMatch(/^\+/);
  });

  it('opens the Add Account dialog on click', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: /Add Account/i }));
    expect(screen.getByTestId('add-account-dialog-open')).toBeTruthy();
  });

  it('keeps the MANAGEMENT_WIDE max-w-7xl bounded container', async () => {
    await renderLoaded();
    const page = screen.getByTestId('accounts-page');
    expect(page.className).toContain('max-w-7xl');
    expect(page.className).toContain('px-4');
    // Document-flow management page — no full-bleed operational header.
    expect(page.className).not.toContain('border-b');
  });

  it('renders the Default account section with the shared Select', async () => {
    await renderLoaded();
    const section = screen.getByTestId('accounts-default-section');
    expect(section).toBeTruthy();
    expect(screen.getByText('Default account')).toBeTruthy();
    // Radix Select combobox shows the current draft ("No default account").
    expect(screen.getByRole('combobox', { name: 'Account used by default' })).toBeTruthy();
    expect(screen.getByText('No default account')).toBeTruthy();
  });

  it('lists all default-account options including active accounts', async () => {
    await renderLoaded();
    await chooseSelectOption('Account used by default', 'Main Trading');
    // Draft updated → unsaved status text appears.
    expect(screen.getByText(/Selection not saved/)).toBeTruthy();
    await chooseSelectOption('Account used by default', 'No default account');
    expect(screen.queryByText(/Selection not saved/)).toBeNull();
  });

  it('shows a disabled unavailable entry when the persisted default is inactive', async () => {
    await renderLoaded({ defaultAccountId: 'acc-2' });
    // acc-2 is inactive → the persisted default is unavailable and disabled.
    await chooseSelectOption('Account used by default', 'Current default is inactive or unavailable');
    expect(screen.getByRole('option', { name: 'Current default is inactive or unavailable' }).hasAttribute('aria-disabled')).toBe(true);
  });

  it('saves the default via the canonical Button through the persistence workflow', async () => {
    let putBody: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr === '/api/accounts') return okResponse(ACCOUNTS);
      if (urlStr === '/api/settings') {
        if (init?.method === 'PUT') {
          putBody = typeof init.body === 'string' ? init.body : null;
          return okResponse({ defaultAccountId: 'acc-1' });
        }
        return okResponse({ defaultAccountId: null });
      }
      return ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response);
    });
    render(<AccountsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Save default/i })).toBeTruthy());

    const saveBtn = screen.getByRole('button', { name: /Save default/i });
    expect(saveBtn.getAttribute('data-slot')).toBe('button');
    expect(saveBtn.getAttribute('data-variant')).toBe('secondary');

    fireEvent.click(saveBtn);
    await waitFor(() => expect(putBody).toContain('"defaultAccountId":null'));
    // Success message keeps role=status.
    await waitFor(() => {
      const saved = screen.getByText('Default account saved.');
      expect(saved.closest('[role="status"]')).toBeTruthy();
    });
  });

  it('marks the Default account with the info Badge', async () => {
    await renderLoaded({ defaultAccountId: 'acc-1' });
    const defaultBadge = screen.getByText('Default');
    const badge = defaultBadge.closest('[data-slot="badge"]') as HTMLElement;
    expect(badge.getAttribute('data-variant')).toBe('info');
  });

  it('uses positive Badge semantics for Active and neutral for Inactive', async () => {
    await renderLoaded();
    const activeBadge = screen.getByText('Active').closest('[data-slot="badge"]') as HTMLElement;
    expect(activeBadge.getAttribute('data-variant')).toBe('positive');
    const inactiveBadge = screen.getByText('Inactive').closest('[data-slot="badge"]') as HTMLElement;
    // Inactive is a neutral account state — never negative/destructive semantics.
    expect(inactiveBadge.getAttribute('data-variant')).toBe('secondary');
  });

  it('surfaces load errors with role=alert', async () => {
    setupFetchMocks({ accountsFail: true });
    render(<AccountsPage />);
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('Failed to load accounts.');
    });
  });

  it('renders all account rows and preserves row navigation', async () => {
    await renderLoaded();
    // DynamicTable renders each account row with the name as the row link.
    expect(screen.getByText('Main Trading')).toBeTruthy();
    expect(screen.getByText('Retirement')).toBeTruthy();

    const rowLink = screen.getByRole('link', { name: 'Open account Main Trading' });
    expect(rowLink.getAttribute('href')).toBe('/settings/accounts/acc-1');

    // Row click (on the row, not the link — the link stops propagation)
    // still invokes onRowClick → router.push.
    const row = screen.getByText('Main Trading').closest('tr') as HTMLElement;
    fireEvent.click(row);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/accounts/acc-1');
  });
});
