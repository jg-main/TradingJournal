/**
 * Component tests for the Mistake Types settings page (M004 Task 21).
 *
 * Characterizes the second SETTINGS_MANAGEMENT proof:
 * - Settings-family outer shell (max-w-5xl keyline) with a left-aligned
 *   max-w-3xl management body and Back to Journal Setup navigation.
 * - GET /api/lookups?type=mistake_type loading/empty/table states.
 * - Add Mistake Type dialog with Zod validation and the create/edit
 *   distinction (POST vs PUT /api/lookups).
 * - Soft delete with exact confirmation semantics.
 * - Success/error message semantics and router.refresh on save.
 * - Hover-reveal row actions stay present (with the md:hidden fallback).
 *
 * Run: npx vitest run --reporter verbose src/app/\(legacy\)/settings/mistake-types/__tests__/page.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ComponentType } from 'react';

let MistakeTypesPage: ComponentType;

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
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
  const mod = await import('@/app/(legacy)/settings/mistake-types/page');
  MistakeTypesPage = mod.default;
});

// ── Fixtures ────────────────────────────────────────────────────────────

interface MistakeType {
  id: string;
  type: string;
  value: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function mistakeTypeRow(overrides: Partial<MistakeType> = {}): MistakeType {
  return {
    id: 'mt-1',
    type: 'mistake_type',
    value: 'fomo_entry',
    description: 'Entering after an extended move without confirmation.',
    sortOrder: 0,
    isActive: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
}

function mockFetchHandlers(options: {
  list?: MistakeType[];
  save?: { ok: boolean; json: () => Promise<unknown> };
  del?: { ok: boolean; json: () => Promise<unknown> };
}) {
  const calls: FetchCall[] = [];
  const mockFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: (init?.body as string | null) ?? null });

    if (method === 'GET' && url === '/api/lookups?type=mistake_type') {
      return { ok: true, json: async () => options.list ?? [] } as Response;
    }
    if ((method === 'POST' || method === 'PUT') && (url === '/api/lookups' || url.startsWith('/api/lookups/'))) {
      return (options.save ?? { ok: true, json: async () => ({ data: { success: true } }) }) as Response;
    }
    if (method === 'DELETE' && url.startsWith('/api/lookups/')) {
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
  mockRefresh.mockClear();
  cleanup();
});

function renderPage() {
  return render(React.createElement(MistakeTypesPage));
}

async function waitLoaded() {
  await waitFor(() => {
    expect(screen.queryByText(/loading mistake types\.\.\./i)).toBeNull();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Mistake Types settings page — SETTINGS_MANAGEMENT shell', () => {
  it('shows the management shell, Back to Journal Setup, and loading text', async () => {
    mockFetchHandlers({ list: [mistakeTypeRow()] });
    const { container } = renderPage();

    expect(container.querySelector('.max-w-5xl')).toBeTruthy();
    expect(container.querySelector('.max-w-3xl')).toBeTruthy();
    expect(screen.getByText(/loading mistake types\.\.\./i)).toBeTruthy();
    expect(screen.getByText(/back to journal setup/i)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: /mistake types/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /add mistake type/i })).toBeTruthy();
  });

  it('back navigation points to the Journal Setup sub-hub', async () => {
    mockFetchHandlers({ list: [] });
    renderPage();
    await waitLoaded();
    const back = screen.getByRole('link', { name: /back to journal setup/i });
    expect(back.getAttribute('href')).toBe('/settings/journal-setup');
  });

  it('renders the loaded table with value, description, and row actions', async () => {
    mockFetchHandlers({ list: [mistakeTypeRow(), mistakeTypeRow({ id: 'mt-2', value: 'overtrading', description: 'Taking more trades than the plan allows.' })] });
    renderPage();
    await waitLoaded();

    expect(screen.getByText('fomo_entry')).toBeTruthy();
    expect(screen.getByText('Entering after an extended move without confirmation.')).toBeTruthy();
    expect(screen.getByText('overtrading')).toBeTruthy();

    const rows = screen.getAllByRole('row');
    const dataRow = rows.find((r) => r.textContent?.includes('fomo_entry'));
    expect(dataRow).toBeTruthy();
    // Hover-reveal actions plus the md:hidden touch fallback keep Edit/Delete present.
    expect(within(dataRow!).getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThanOrEqual(1);
    expect(within(dataRow!).getAllByRole('button', { name: /^delete$/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty state when no mistake types exist', async () => {
    mockFetchHandlers({ list: [] });
    renderPage();
    await waitLoaded();
    expect(screen.getByText(/no mistake types defined yet/i)).toBeTruthy();
  });

  it('shows an error message when the fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Network request failed'));
    renderPage();
    await waitLoaded();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });
});

describe('Mistake Types settings page — create/edit/delete flows', () => {
  it('opens the Add dialog and POSTs a mistake type, then refreshes and closes the dialog', async () => {
    const { calls } = mockFetchHandlers({ list: [] });
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getByRole('button', { name: /add mistake type/i }));
    expect(screen.getByRole('heading', { name: /add mistake type/i })).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Value *'), 'revenge_trade');
    await userEvent.type(screen.getByLabelText('Description *'), 'Trying to win back a loss immediately.');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
    const createCall = calls.find((c) => c.method === 'POST' && c.url === '/api/lookups');
    expect(createCall).toBeTruthy();
    expect(JSON.parse(createCall!.body!)).toEqual({
      type: 'mistake_type',
      value: 'revenge_trade',
      description: 'Trying to win back a loss immediately.',
      sortOrder: 0,
    });
    // The dialog closes and the list is re-fetched after a successful save.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /add mistake type/i })).toBeNull();
    });
    // Success feedback survives the mutation-driven list refresh (M004 micro-fix).
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/lookups?type=mistake_type').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Mistake type created.')).toBeTruthy();
    });
  });

  it('keeps the Create button disabled until both fields are filled', async () => {
    const { calls } = mockFetchHandlers({ list: [] });
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getByRole('button', { name: /add mistake type/i }));
    const create = screen.getByRole('button', { name: /^create$/i }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('Value *'), 'overtrading');
    expect(create.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('Description *'), 'Too many trades.');
    expect(create.disabled).toBe(false);

    await userEvent.click(create);
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
  });

  it('opens the Edit dialog prefilled and PUTs the update', async () => {
    const { calls } = mockFetchHandlers({ list: [mistakeTypeRow()] });
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    expect(screen.getByRole('heading', { name: /edit mistake type/i })).toBeTruthy();

    const valueInput = screen.getByLabelText('Value *') as HTMLInputElement;
    const descInput = screen.getByLabelText('Description *') as HTMLTextAreaElement;
    expect(valueInput.value).toBe('fomo_entry');
    expect(descInput.value).toBe('Entering after an extended move without confirmation.');

    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, 'fomo_retest');
    await userEvent.click(screen.getByRole('button', { name: /^update$/i }));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
    const putCall = calls.find((c) => c.method === 'PUT' && c.url === '/api/lookups/mt-1');
    expect(putCall).toBeTruthy();
    expect(JSON.parse(putCall!.body!)).toEqual({
      value: 'fomo_retest',
      description: 'Entering after an extended move without confirmation.',
    });
    // Success feedback survives the mutation-driven list refresh (M004 micro-fix).
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/lookups?type=mistake_type').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Mistake type updated.')).toBeTruthy();
    });
  });

  it('soft-deletes after the exact confirmation and reports success', async () => {
    const { calls } = mockFetchHandlers({ list: [mistakeTypeRow()] });
    window.confirm = vi.fn(() => true);
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    expect(window.confirm).toHaveBeenCalledWith(
      'Deactivate mistake type "fomo_entry"? It will be hidden from trade forms but existing records are preserved.',
    );

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/lookups/mt-1')).toBe(true);
    });
    // Success feedback survives the mutation-driven list refresh (M004 micro-fix).
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/lookups?type=mistake_type').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('"fomo_entry" deactivated.')).toBeTruthy();
    });
  });

  it('skips deletion when the confirmation is dismissed', async () => {
    const { calls } = mockFetchHandlers({ list: [mistakeTypeRow()] });
    window.confirm = vi.fn(() => false);
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.method === 'DELETE').length).toBe(0);
  });

  it('surfaces a save API error as an error message', async () => {
    mockFetchHandlers({ list: [], save: { ok: false, json: async () => ({ error: 'Lookup value must be unique.' }) } });
    renderPage();
    await waitLoaded();

    await userEvent.click(screen.getByRole('button', { name: /add mistake type/i }));
    await userEvent.type(screen.getByLabelText('Value *'), 'duplicate');
    await userEvent.type(screen.getByLabelText('Description *'), 'Already exists.');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText('Lookup value must be unique.')).toBeTruthy();
    });
  });
});
