/**
 * Fix 3 — /trades/new consumes the canonical AccountProvider:
 * - Account options come from the provider (no independent /api/accounts).
 * - The form's initial account is the CURRENT global accountId.
 * - On successful save under a DIFFERENT account, the global selection
 *   switches to the persisted trade's account before navigation.
 * Run: npx vitest run src/app/(legacy)/trades/new/page.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const mockPush = vi.fn();
const mockSetAccountId = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));
vi.mock('lucide-react', () => ({
  ArrowLeft: () => React.createElement('span'),
  Loader2: () => React.createElement('span'),
  AlertCircle: () => React.createElement('span'),
}));
vi.mock('@/components/empty-state', () => ({
  EmptyState: ({ title, description }: { title?: string; description?: string }) =>
    React.createElement('div', { 'data-testid': 'empty-state' }, title ?? '', description ?? ''),
}));

// Canonical provider: global account = acc-A.
vi.mock('@/lib/account-context', () => ({
  useAccount: () => ({
    accounts: [
      { id: 'acc-A', name: 'Account A', broker: null, currency: 'USD', isActive: true },
      { id: 'acc-B', name: 'Account B', broker: null, currency: 'USD', isActive: true },
    ],
    loading: false,
    error: null,
    accountId: 'acc-A',
    setAccountId: mockSetAccountId,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

// The form receives provider accounts; capture the props it is rendered with.
let capturedProps: Record<string, unknown> | null = null;
vi.mock('@/components/plan-trade-form', () => ({
  default: (props: {
    accounts: unknown[];
    setups: unknown[];
    defaultAccountId: string | null;
    onSuccess: (result: { id: string; accountId: string }) => void;
    onCancel: () => void;
  }) => {
    capturedProps = props as unknown as Record<string, unknown>;
    return React.createElement('div', { 'data-testid': 'plan-form' },
      `defaultAccountId=${String(props.defaultAccountId)}`);
  },
}));

const UNMOCKED_FETCH = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  const impl = async (url: RequestInfo | URL) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('/api/setup-definitions')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  };
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
});
afterEach(() => {
  fetchMock.mockRestore();
  cleanup();
  capturedProps = null;
  mockPush.mockReset();
  mockSetAccountId.mockReset();
});

import NewTradePage from './page';

describe('NewTradePage — canonical account scope (Fix 3)', () => {
  it('defaults the Plan Trade form to the current global account (not settings)', async () => {
    render(React.createElement(NewTradePage));
    await waitFor(() => {
      expect(capturedProps?.defaultAccountId).toBe('acc-A');
    });
    // Provider accounts are passed through as the form's options.
    expect((capturedProps?.accounts as unknown[]).length).toBe(2);
  });

  it('switches the global account to the persisted trade account before navigation', async () => {
    render(React.createElement(NewTradePage));
    await waitFor(() => {
      expect(capturedProps).not.toBeNull();
    });
    const onSuccess = capturedProps!.onSuccess as (r: { id: string; accountId: string }) => void;

    // Save Plan under account B while the global selection is A.
    onSuccess({ id: 'trade-9', accountId: 'acc-B' });
    expect(mockSetAccountId).toHaveBeenCalledWith('acc-B');
    expect(mockPush).toHaveBeenCalledWith('/trades/trade-9');
  });

  it('keeps the global account when the persisted trade belongs to it', async () => {
    render(React.createElement(NewTradePage));
    await waitFor(() => {
      expect(capturedProps).not.toBeNull();
    });
    const onSuccess = capturedProps!.onSuccess as (r: { id: string; accountId: string }) => void;
    onSuccess({ id: 'trade-9', accountId: 'acc-A' });
    expect(mockSetAccountId).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/trades/trade-9');
  });
});
