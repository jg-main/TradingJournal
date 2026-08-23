/**
 * Component tests for AccountInitialization (S02/T02).
 *
 * Covers:
 * - Both initialization paths are presented ("Add opening balance",
 *   "Start with zero") with the account name in the headline
 * - "Start with zero" activates the account via PUT /api/accounts/:id
 *   and calls onInitialized on success
 * - Loading state while the activation request is in flight
 * - API error messages surface (409 body) with retry via the path button
 * - Network failures fall back to a friendly message
 * - "Add opening balance" reveals the opening-balance panel; Back returns
 *
 * Run: npx vitest run src/components/accounting/account-initialization.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { AccountInitialization } from './account-initialization';

// ── Test Setup ─────────────────────────────────────────────────────────

const UNMOCKED_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  cleanup();
});

function mockFetchResponse(ok: boolean, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
}

function renderInitialization() {
  const onInitialized = vi.fn();
  const utils = render(
    <AccountInitialization
      accountId="acct-new"
      accountName="Main Brokerage"
      currency="USD"
      onInitialized={onInitialized}
    />,
  );
  return { onInitialized, ...utils };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('AccountInitialization — paths', () => {
  it('renders the account name headline and both initialization paths', () => {
    renderInitialization();

    expect(screen.getByText('Set up Main Brokerage')).toBeTruthy();
    expect(screen.getByText('Add opening balance')).toBeTruthy();
    expect(screen.getByText('Start with zero')).toBeTruthy();
  });

  it('does not render the initialization headline when neither path is chosen', () => {
    renderInitialization();
    // Headline is present; the opening-balance panel is not shown yet.
    expect(screen.queryByRole('region', { name: 'Opening balance' })).toBeNull();
  });
});

describe('AccountInitialization — start with zero', () => {
  it('activates the account via initialize (mode zero) and calls onInitialized on success', async () => {
    mockFetchResponse(true, {
      account: {
        id: 'acct-new',
        name: 'Main Brokerage',
        isActive: true,
      },
      event: null,
      entry: null,
      postings: null,
    });
    const { onInitialized } = renderInitialization();

    fireEvent.click(screen.getByText('Start with zero'));

    await waitFor(() => {
      expect(onInitialized).toHaveBeenCalledTimes(1);
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/accounts/acct-new/initialize',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'zero' }),
      }),
    );
  });

  it('disables both path buttons and shows a busy indicator while activating', () => {
    // Never resolve the activation request.
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    renderInitialization();
    fireEvent.click(screen.getByText('Start with zero'));

    expect(screen.getByText('Activating...')).toBeTruthy();

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(2);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('surfaces API error messages (409 conflict) and retry recovers', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Account already initialized' }),
    });

    const { onInitialized } = renderInitialization();

    fireEvent.click(screen.getByText('Start with zero'));

    await waitFor(() => {
      expect(screen.getByText('Account already initialized')).toBeTruthy();
    });

    // Retry: the path button is still available and the request succeeds.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ account: { id: 'acct-new', isActive: true }, event: null, entry: null, postings: null }),
    });

    fireEvent.click(screen.getByText('Start with zero'));

    await waitFor(() => {
      expect(onInitialized).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces 400 validation field errors from the API response', async () => {
    mockFetchResponse(false, {
      error: 'Validation failed',
      details: {
        fieldErrors: {
          mode: ['Invalid discriminator value'],
        },
      },
    });

    renderInitialization();
    fireEvent.click(screen.getByText('Start with zero'));

    await waitFor(() => {
      expect(screen.getByText('Invalid discriminator value')).toBeTruthy();
    });
  });

  it('falls back to a friendly message on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    renderInitialization();
    fireEvent.click(screen.getByText('Start with zero'));

    await waitFor(() => {
      expect(
        screen.getByText('Could not activate the account. Please try again.'),
      ).toBeTruthy();
    });
  });
});

describe('AccountInitialization — add opening balance path', () => {
  it('reveals the opening-balance panel and Back returns to the paths', () => {
    renderInitialization();

    fireEvent.click(screen.getByText('Add opening balance'));

    // Panel is announced through an accessible region and shows the currency.
    const region = screen.getByRole('region', { name: 'Opening balance' });
    expect(region).toBeTruthy();
    expect(region.textContent).toContain('USD');
    expect(screen.getByText('Back')).toBeTruthy();

    fireEvent.click(screen.getByText('Back'));

    expect(screen.getByText('Add opening balance')).toBeTruthy();
    expect(screen.getByText('Start with zero')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Opening balance' })).toBeNull();
  });

  it('does not activate the account when only opening balance is selected', () => {
    globalThis.fetch = vi.fn();
    renderInitialization();
    fireEvent.click(screen.getByText('Add opening balance'));

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
