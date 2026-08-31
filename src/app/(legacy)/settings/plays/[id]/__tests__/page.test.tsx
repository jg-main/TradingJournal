/**
 * Component tests for the Play Detail settings page (M004 Task 23).
 *
 * Characterizes the DENSE_SETTINGS_DETAIL surface:
 * - Settings-family outer shell (max-w-5xl keyline) with a left-aligned
 *   max-w-3xl dense body and Back to Plays navigation (NOT the management
 *   shell — 768px dense configuration body is intentional).
 * - Loading and not-found states with the same family geometry.
 * - Loaded state: title, Active/Inactive badge, all dense sections, Save.
 * - GET /api/setup-definitions/<id> fetch and analysisConfig parsing
 *   (featureMode / features / dataProvider prefill).
 * - PUT save semantics: name + analysisConfig always sent; other fields only
 *   when non-empty; success message.
 *
 * Run: npx vitest run --reporter verbose src/app/\(legacy\)/settings/plays/\[id\]/__tests__/page.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { Suspense, type ComponentType } from 'react';

let PlayDetailPage: ComponentType<{ params: Promise<{ id: string }> }>;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

vi.mock('@/components/checklist-manager', () => ({
  default: () => React.createElement('div', { 'data-testid': 'checklist-manager' }),
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/plays/[id]/page');
  PlayDetailPage = mod.default;
});

// ── Fixtures ────────────────────────────────────────────────────────────

function setupDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'setup-1',
    name: 'Breakout Pullback',
    description: 'Buy the retest of a broken level.',
    howToPlay: null,
    entryRules: null,
    exitRules: null,
    tags: null,
    defaultRiskPct: 1,
    positionSizingRules: null,
    chartPatterns: null,
    analysisConfig: JSON.stringify({
      ohlcYears: 1,
      featureMode: 'custom',
      includeRawOhlcv: true,
      features: [{ id: 'sma_20' }],
      dataProvider: 'schwab',
    }),
    isActive: true,
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
}

function mockFetchHandlers(options: {
  detail?: Record<string, unknown> | null;
  put?: { ok: boolean; json: () => Promise<unknown> };
}) {
  const calls: FetchCall[] = [];
  const mockFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: (init?.body as string | null) ?? null });

    if (method === 'GET' && url.startsWith('/api/setup-definitions/setup-1')) {
      if (options.detail === null) return { ok: false, json: async () => ({ error: 'Not found' }) } as Response;
      return { ok: true, json: async () => options.detail ?? setupDetail() } as Response;
    }
    if (method === 'PUT' && url.startsWith('/api/setup-definitions/setup-1')) {
      return (options.put ?? { ok: true, json: async () => ({ data: { success: true } }) }) as Response;
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  globalThis.fetch = mockFn;
  return { mockFn, calls };
}

const UNMOCKED_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  cleanup();
});

async function renderPage() {
  let container!: HTMLElement;
  await act(async () => {
    container = render(
      <Suspense fallback={<div data-testid="suspended" />}>
        <PlayDetailPage params={Promise.resolve({ id: 'setup-1' })} />
      </Suspense>,
    ).container;
  });
  return container;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Play Detail settings page — DENSE_SETTINGS_DETAIL shell', () => {
  it('shows the loading state inside the Settings-family geometry', async () => {
    // Deferred fetch keeps the loading branch visible until we resolve it.
    let resolveFetch!: (value: Response) => void;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    const container = await renderPage();
    // The dense body keeps the family outer shell + left-aligned 768px boundary.
    expect(container.querySelector('.max-w-5xl')).toBeTruthy();
    expect(container.querySelector('.max-w-3xl')).toBeTruthy();
    expect(screen.getByText(/loading\.\.\./i)).toBeTruthy();
    resolveFetch({ ok: true, json: async () => setupDetail() } as Response);
    await waitFor(() => {
      expect(screen.queryByText(/loading\.\.\./i)).toBeNull();
    });
  });

  it('renders the not-found state with Back to Plays navigation', async () => {
    mockFetchHandlers({ detail: null });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText(/play not found/i)).toBeTruthy();
    });
    const back = screen.getByRole('link', { name: /back to plays/i });
    expect(back.getAttribute('href')).toBe('/settings/plays');
  });

  it('renders the dense editor with title, status badge, sections, and Save', async () => {
    mockFetchHandlers({ detail: setupDetail() });
    const container = await renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /breakout pullback/i })).toBeTruthy();
    });

    expect(container.querySelector('.max-w-5xl')).toBeTruthy();
    expect(container.querySelector('.max-w-3xl')).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to plays/i }).getAttribute('href')).toBe('/settings/plays');
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /description & rules/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /tags & patterns/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /risk & sizing/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /ai assessment data/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /entry checks/i })).toBeTruthy();
    expect(screen.getByTestId('checklist-manager')).toBeTruthy();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy();
  });

  it('renders the Inactive badge for inactive setups', async () => {
    mockFetchHandlers({ detail: setupDetail({ isActive: false }) });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeTruthy();
    });
  });

  it('prefills form state from the API including analysisConfig', async () => {
    mockFetchHandlers({ detail: setupDetail() });
    await renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeTruthy();
    });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Breakout Pullback');
    expect((screen.getByLabelText('Default Risk %') as HTMLInputElement).value).toBe('1');
    // analysisConfig parsing: custom feature mode + schwab provider.
    expect(screen.getByRole('button', { name: /custom subset/i })).toHaveProperty('className');
    expect((screen.getByLabelText('Feature IDs (JSON array)') as HTMLTextAreaElement).value).toContain('sma_20');
    expect((screen.getByLabelText('Market Data Provider') as HTMLSelectElement).value).toBe('schwab');
  });
});

describe('Play Detail settings page — save semantics', () => {
  it('PUTs name + analysisConfig and reports success', async () => {
    // Empty optional fields (null in the API) must be omitted from the PUT
    // payload so existing DB values are not overwritten.
    const { calls } = mockFetchHandlers({
      detail: setupDetail({ description: null, defaultRiskPct: null, tags: null, howToPlay: null, entryRules: null, exitRules: null, positionSizingRules: null, chartPatterns: null }),
    });
    await renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeTruthy();
    });
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText('Play updated.')).toBeTruthy();
    });
    const putCall = calls.find((c) => c.method === 'PUT' && c.url === '/api/setup-definitions/setup-1');
    expect(putCall).toBeTruthy();
    const payload = JSON.parse(putCall!.body!);
    expect(payload.name).toBe('Breakout Pullback');
    const config = JSON.parse(payload.analysisConfig);
    expect(config.ohlcYears).toBe(1);
    expect(config.featureMode).toBe('custom');
    expect(config.includeRawOhlcv).toBe(true);
    expect(config.dataProvider).toBe('schwab');
    expect(Array.isArray(config.features)).toBe(true);
    // Empty optional fields must not overwrite existing DB values.
    expect(payload.description).toBeUndefined();
    expect(payload.defaultRiskPct).toBeUndefined();
    expect(payload.tags).toBeUndefined();
  });

  it('shows an error message when the save fails', async () => {
    mockFetchHandlers({ detail: setupDetail(), put: { ok: false, json: async () => ({ error: 'Inactive plays cannot be edited.' }) } });
    await renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeTruthy();
    });
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText('Inactive plays cannot be edited.')).toBeTruthy();
    });
  });
});
