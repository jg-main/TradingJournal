/**
 * Component tests for the Plays settings page (M004 Task 20).
 *
 * Characterizes the SETTINGS_MANAGEMENT pilot grammar and the frozen
 * setup-definition CRUD semantics:
 * - Settings-family outer shell (max-w-5xl keyline) with a left-aligned
 *   max-w-3xl management body and Back to Journal Setup navigation.
 * - GET /api/setup-definitions?includeInactive=true list rendering,
 *   loading, empty, active/inactive presentation.
 * - New Play dialog; create payload (trimmed name) + navigation to
 *   /settings/plays/<id>.
 * - Deactivate (PUT isActive:false) / Reactivate (PUT isActive:true) /
 *   permanent delete (DELETE) with exact confirmation semantics.
 * - Success/error messaging.
 *
 * Run: npx vitest run --reporter verbose src/app/\(legacy\)/settings/plays/__tests__/page.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ComponentType } from 'react';

let PlaysSettingsPage: ComponentType;

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/plays/page');
  PlaysSettingsPage = mod.default;
});

// ── Fixtures ────────────────────────────────────────────────────────────

interface SetupDefinition {
  id: string;
  name: string;
  description: string | null;
  howToPlay: string | null;
  entryRules: string | null;
  exitRules: string | null;
  tags: string | null;
  defaultRiskPct: number | null;
  positionSizingRules: string | null;
  chartPatterns: string | null;
  analysisConfig: string | null;
  isActive: boolean;
}

function setupRow(overrides: Partial<SetupDefinition> = {}): SetupDefinition {
  return {
    id: 'setup-1',
    name: 'Breakout Pullback',
    description: 'Buy the retest of a broken level.',
    howToPlay: null,
    entryRules: null,
    exitRules: null,
    tags: JSON.stringify(['breakout', 'pullback']),
    defaultRiskPct: 1,
    positionSizingRules: null,
    chartPatterns: null,
    analysisConfig: null,
    isActive: true,
    ...overrides,
  };
}

const ACTIVE = setupRow();
const INACTIVE = setupRow({ id: 'setup-2', name: 'Old Play', description: null, tags: null, defaultRiskPct: null, isActive: false });

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
}

function mockFetchHandlers(options: {
  list?: SetupDefinition[];
  post?: { ok: boolean; json: () => Promise<unknown> };
  put?: { ok: boolean; json: () => Promise<unknown> };
  del?: { ok: boolean; json: () => Promise<unknown> };
}) {
  const calls: FetchCall[] = [];
  const mockFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: (init?.body as string | null) ?? null });

    if (method === 'GET' && url === '/api/setup-definitions?includeInactive=true') {
      return { ok: true, json: async () => ({ data: options.list ?? [] }) } as Response;
    }
    if (method === 'POST' && url === '/api/setup-definitions') {
      return (options.post ?? { ok: true, json: async () => ({ id: 'setup-new', name: 'New Play' }) }) as Response;
    }
    if (method === 'PUT' && url.startsWith('/api/setup-definitions/')) {
      return (options.put ?? { ok: true, json: async () => ({ data: { success: true } }) }) as Response;
    }
    if (method === 'DELETE' && url.startsWith('/api/setup-definitions/')) {
      return (options.del ?? { ok: true, json: async () => ({ success: true }) }) as Response;
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  globalThis.fetch = mockFn;
  return { mockFn, calls };
}

const UNMOCKED_FETCH = globalThis.fetch;
const UNMOCKED_CONFIRM = window.confirm;

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  window.confirm = UNMOCKED_CONFIRM;
  mockPush.mockClear();
  cleanup();
});

function renderPage() {
  return render(React.createElement(PlaysSettingsPage));
}

async function waitLoaded() {
  await waitFor(() => {
    expect(screen.queryByText(/loading plays\.\.\./i)).toBeNull();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Plays settings page — SETTINGS_MANAGEMENT shell', () => {
  it('shows the management shell and loading text while data loads', async () => {
    mockFetchHandlers({ list: [ACTIVE] });
    const { container } = renderPage();

    expect(container.querySelector('.max-w-5xl')).toBeTruthy();
    expect(container.querySelector('.max-w-3xl')).toBeTruthy();
    expect(screen.getByText(/back to journal setup/i)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: /plays/i })).toBeTruthy();
    expect(screen.getByText(/trading setups that appear in the plan trade dropdown/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /new play/i })).toBeTruthy();
    expect(screen.getByText(/loading plays\.\.\./i)).toBeTruthy();
  });

  it('back navigation points to the Journal Setup sub-hub', async () => {
    mockFetchHandlers({ list: [] });
    renderPage();
    await waitLoaded();
    const back = screen.getByRole('link', { name: /back to journal setup/i });
    expect(back.getAttribute('href')).toBe('/settings/journal-setup');
  });

  it('renders the loaded setup list with active presentation and tag/risk metadata', async () => {
    mockFetchHandlers({ list: [ACTIVE] });
    renderPage();
    await waitLoaded();

    expect(screen.getByText('Breakout Pullback')).toBeTruthy();
    expect(screen.getByText('Buy the retest of a broken level.')).toBeTruthy();
    expect(screen.getByText('Risk: 1%')).toBeTruthy();
    expect(screen.getByText('breakout')).toBeTruthy();
    expect(screen.getByText('pullback')).toBeTruthy();
    expect(screen.queryByText(/inactive/i)).toBeNull();
    expect(screen.getByRole('link', { name: /edit/i }).getAttribute('href')).toBe('/settings/plays/setup-1');
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy();
    // No Inactive badge, no Reactivate action for an active play.
    expect(screen.queryByRole('button', { name: /reactivate/i })).toBeNull();
  });

  it('marks inactive setups with an Inactive badge and exposes Reactivate instead of Deactivate', async () => {
    mockFetchHandlers({ list: [ACTIVE, INACTIVE] });
    renderPage();
    await waitLoaded();

    const inactiveCard = screen.getByText('Old Play').closest('div.rounded-lg');
    expect(inactiveCard?.textContent).toContain('Inactive');
    expect(inactiveCard?.textContent).toContain('Reactivate');
    expect(inactiveCard?.textContent).not.toContain('Deactivate');
  });

  it('renders the empty state when no setups exist', async () => {
    mockFetchHandlers({ list: [] });
    renderPage();
    await waitLoaded();
    expect(screen.getByText(/no plays defined yet/i)).toBeTruthy();
  });

  it('renders an error message when the list fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Network request failed'));
    renderPage();
    await waitLoaded();
    expect(screen.getByText('Failed to load setup definitions.')).toBeTruthy();
  });
});

describe('Plays settings page — New Play create flow', () => {
  it('opens the New Play dialog and submits the trimmed name payload, then navigates to the new play', async () => {
    const { calls } = mockFetchHandlers({ list: [ACTIVE], post: { ok: true, json: async () => ({ id: 'setup-new', name: 'Gap Fade' }) } });
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getByRole('button', { name: /new play/i }));
    expect(screen.getByText('Name *')).toBeTruthy();

    const input = screen.getByLabelText('Name *') as HTMLInputElement;
    await userEvent.type(input, '  Gap Fade  ');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/settings/plays/setup-new');
    });

    const createCall = calls.find((c) => c.method === 'POST' && c.url === '/api/setup-definitions');
    expect(createCall).toBeTruthy();
    expect(JSON.parse(createCall!.body!)).toEqual({ name: 'Gap Fade' });
  });

  it('shows the API error and keeps the dialog open when creation fails', async () => {
    mockFetchHandlers({
      list: [ACTIVE],
      post: { ok: false, json: async () => ({ error: 'Name already exists.', details: null }) },
    });
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getByRole('button', { name: /new play/i }));
    await userEvent.type(screen.getByLabelText('Name *'), 'Duplicate');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText('Name already exists.')).toBeTruthy();
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText('Name *')).toBeTruthy();
  });
});

describe('Plays settings page — mutation semantics', () => {
  it('deactivates a play after confirm with PUT isActive:false and reports success', async () => {
    const { calls } = mockFetchHandlers({ list: [ACTIVE] });
    window.confirm = vi.fn(() => true);
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getByRole('button', { name: /deactivate/i }));

    await waitFor(() => {
      expect(screen.getByText('Breakout Pullback deactivated.')).toBeTruthy();
    });
    const putCall = calls.find((c) => c.method === 'PUT' && c.url === '/api/setup-definitions/setup-1');
    expect(putCall).toBeTruthy();
    expect(JSON.parse(putCall!.body!)).toEqual({ isActive: false });
  });

  it('skips deactivation when confirm is dismissed', async () => {
    const { calls } = mockFetchHandlers({ list: [ACTIVE] });
    window.confirm = vi.fn(() => false);
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getByRole('button', { name: /deactivate/i }));
    await new Promise((r) => setTimeout(r, 20));

    expect(calls.filter((c) => c.method === 'PUT').length).toBe(0);
    expect(screen.queryByText(/deactivated/i)).toBeNull();
  });

  it('reactivates a play with PUT isActive:true and reports success', async () => {
    const { calls } = mockFetchHandlers({ list: [INACTIVE] });
    window.confirm = vi.fn(() => true);
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getByRole('button', { name: /reactivate/i }));

    await waitFor(() => {
      expect(screen.getByText('Old Play reactivated.')).toBeTruthy();
    });
    const putCall = calls.find((c) => c.method === 'PUT' && c.url === '/api/setup-definitions/setup-2');
    expect(putCall).toBeTruthy();
    expect(JSON.parse(putCall!.body!)).toEqual({ isActive: true });
  });

  it('permanently deletes a play after the exact confirmation and reports success', async () => {
    const { calls } = mockFetchHandlers({ list: [ACTIVE] });
    window.confirm = vi.fn(() => true);
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(screen.getByText('Breakout Pullback permanently deleted.')).toBeTruthy();
    });
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/setup-definitions/setup-1')).toBe(true);
  });

  it('reports a deactivation failure as an error message', async () => {
    mockFetchHandlers({ list: [ACTIVE], put: { ok: false, json: async () => ({ error: 'Setup is locked.' }) } });
    window.confirm = vi.fn(() => true);
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getByRole('button', { name: /deactivate/i }));

    await waitFor(() => {
      expect(screen.getByText('Setup is locked.')).toBeTruthy();
    });
  });
});
