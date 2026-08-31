/**
 * Characterization tests for the Market Data settings page (M004 Task 17).
 *
 * Market Data is the final PROVIDER-DETAIL page migrated onto SettingsChildPage.
 * These tests pin the structural adoption plus the frozen contracts: dual
 * initial acquisition, the initial-vs-background loading distinction, the
 * provider-save payload and validation, ClickHouse safety, the
 * test-connection contract, and the OAuth callback parsing.
 *
 * Run: npx vitest run "src/app/(legacy)/settings/market-data/__tests__/page.test.tsx"
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ComponentType } from 'react';

let MarketDataPage: ComponentType;

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/market-data/page');
  MarketDataPage = mod.default;
});

// ── Fixtures ────────────────────────────────────────────────────────────

const SETTINGS = {
  id: 'md-1',
  activeProvider: 'clickhouse',
  providers: {
    clickhouse: { host: 'localhost', port: 8123, user: 'default', database: 'market' },
  },
  refreshIntervalSeconds: 30,
};

const SCHWAB_STATUS = { connected: false, expiresAt: null, errorType: 'not_configured' };

const INITIAL_ROUTES: Record<string, unknown> = {
  'GET /api/market-data/settings': SETTINGS,
  'GET /api/schwab/status': SCHWAB_STATUS,
};

type FetchCall = { url: string; method: string; body?: string };

function installRouter(
  routes: Record<string, unknown>,
  calls: FetchCall[] = [],
): { calls: FetchCall[]; fn: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (!(key in routes)) throw new Error(`unmocked: ${key}`);
    const value = routes[key];
    if (value && typeof value === 'object' && typeof (value as { json?: unknown }).json === 'function') {
      return Promise.resolve(value as unknown as Response);
    }
    return { ok: true, json: () => Promise.resolve(value) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

function putBody(calls: FetchCall[]): Record<string, unknown> {
  const put = calls.find((c) => c.method === 'PUT');
  return JSON.parse(put!.body!);
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('Market Data settings page (SettingsChildPage adoption)', () => {
  it('keeps Back, title, description, and loading text during initial loading, hiding sections', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = render(<MarketDataPage />);

    expect(screen.getByText('Back to Settings')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Market Data' })).toBeTruthy();
    expect(screen.getByText('Configure market data providers, connections, and live-mark refresh behavior.')).toBeTruthy();
    expect(container.textContent).toContain('Loading market data settings...');

    for (const section of [
      'Provider Status',
      'ClickHouse Configuration',
      'Schwab Connection',
      'Enrich Missing Profiles',
    ]) {
      expect(screen.queryByText(section)).toBeNull();
    }
  });

  it('acquires settings and Schwab status on mount and renders every section after load', async () => {
    const { calls } = installRouter(INITIAL_ROUTES);
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Provider Status' })).toBeTruthy();
    });

    const requests = calls.map((c) => `${c.method} ${c.url}`).sort();
    expect(requests).toEqual(['GET /api/market-data/settings', 'GET /api/schwab/status']);

    for (const section of [
      'Provider Status',
      'ClickHouse Configuration',
      'Schwab Connection',
      'Enrich Missing Profiles',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeTruthy();
    }
    expect(screen.queryByText('Loading market data settings...')).toBeNull();
  });

  it('populates the loaded settings and keeps the ClickHouse password empty', async () => {
    installRouter(INITIAL_ROUTES);
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('clickhouse');
    expect((screen.getByLabelText('Open-position mark refresh') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('localhost');
    expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('8123');
    expect((screen.getByLabelText('User') as HTMLInputElement).value).toBe('default');
    expect((screen.getByLabelText('Database') as HTMLInputElement).value).toBe('market');
    expect((screen.getByLabelText(/Password/) as HTMLInputElement).value).toBe('');
  });

  it('points Back to Settings at /settings', async () => {
    installRouter(INITIAL_ROUTES);
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Provider Status' })).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: /back to settings/i }).getAttribute('href')).toBe('/settings');
  });

  it('a background refresh keeps the loaded content visible and re-acquires both endpoints', async () => {
    installRouter(INITIAL_ROUTES);
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Provider Status' })).toBeTruthy();
    });

    // Hold the refresh requests pending.
    const pending: Array<{ url: string; resolve: (v: Response) => void }> = [];
    const holdFetch = vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          pending.push({ url, resolve });
        }),
    );
    vi.stubGlobal('fetch', holdFetch);

    window.dispatchEvent(new Event('focus'));

    // While pending, settings exists → the loaded surface stays fully visible.
    expect(screen.getByRole('heading', { level: 1, name: 'Market Data' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Provider Status' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'ClickHouse Configuration' })).toBeTruthy();
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.queryByText('Loading market data settings...')).toBeNull();

    // The refresh must re-request BOTH endpoints.
    expect(pending.map((p) => p.url).sort()).toEqual([
      '/api/market-data/settings',
      '/api/schwab/status',
    ]);

    const refreshRoutes: Record<string, unknown> = {
      '/api/market-data/settings': SETTINGS,
      '/api/schwab/status': SCHWAB_STATUS,
    };
    for (const entry of pending) {
      entry.resolve({
        ok: true,
        json: () => Promise.resolve(refreshRoutes[entry.url]),
      } as unknown as Response);
    }
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Provider Status' })).toBeTruthy();
    });
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('saves a valid provider selection with the frozen PUT payload', async () => {
    const calls: FetchCall[] = [];
    installRouter(
      {
        ...INITIAL_ROUTES,
        'PUT /api/market-data/settings': { ...SETTINGS, refreshIntervalSeconds: 30 },
      },
      calls,
    );
    const user = userEvent.setup();
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    await user.click(screen.getByText('Save market data settings'));

    await waitFor(() => {
      expect(screen.getByText('Market data settings saved.')).toBeTruthy();
    });

    expect(putBody(calls)).toEqual({
      activeProvider: 'clickhouse',
      providers: {},
      refreshIntervalSeconds: 30,
    });
  });

  it('rejects an invalid refresh interval without issuing a PUT', async () => {
    const calls: FetchCall[] = [];
    installRouter(
      {
        ...INITIAL_ROUTES,
        'PUT /api/market-data/settings': SETTINGS,
      },
      calls,
    );
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Open-position mark refresh'), { target: { value: '9' } });
    fireEvent.click(screen.getByText('Save market data settings'));

    await waitFor(() => {
      expect(
        screen.getByText('Mark refresh interval must be a whole number from 10 to 300 seconds.'),
      ).toBeTruthy();
    });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('includes providers.schwab when the active provider is a connected Schwab', async () => {
    const calls: FetchCall[] = [];
    installRouter(
      {
        'GET /api/market-data/settings': { ...SETTINGS, activeProvider: 'schwab' },
        'GET /api/schwab/status': { connected: true, expiresAt: '2099-01-01T00:00:00.000Z' },
        'PUT /api/market-data/settings': { ...SETTINGS, activeProvider: 'schwab' },
      },
      calls,
    );
    const user = userEvent.setup();
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy();
    });

    await user.click(screen.getByText('Save market data settings'));

    await waitFor(() => {
      expect(screen.getByText('Market data settings saved.')).toBeTruthy();
    });

    expect(putBody(calls).providers).toEqual({ schwab: { configured: true } });
  });

  it('saves ClickHouse config with only non-empty fields and clears the password', async () => {
    const calls: FetchCall[] = [];
    installRouter(
      {
        ...INITIAL_ROUTES,
        'PUT /api/market-data/settings': { ...SETTINGS },
      },
      calls,
    );
    const user = userEvent.setup();
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Host')).toBeTruthy();
    });

    const password = screen.getByLabelText(/Password/);
    await user.type(password, 'secret-db-pass');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      expect(screen.getByText('ClickHouse configuration saved.')).toBeTruthy();
    });

    const body = putBody(calls);
    expect(body.providers).toEqual({
      clickhouse: {
        host: 'localhost',
        port: 8123,
        user: 'default',
        database: 'market',
        password: 'secret-db-pass',
      },
    });
    // The password field clears after a successful save.
    expect((screen.getByLabelText(/Password/) as HTMLInputElement).value).toBe('');
  });

  it('Test Connection posts the default contract and renders Connected', async () => {
    const calls: FetchCall[] = [];
    installRouter(
      {
        ...INITIAL_ROUTES,
        'POST /api/market-data/clickhouse/test-connection': { ok: true },
      },
      calls,
    );
    const user = userEvent.setup();
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /test connection/i })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeTruthy();
    });

    const body = JSON.parse(calls.find((c) => c.url.includes('test-connection'))!.body!);
    expect(body).toEqual({
      host: 'localhost',
      port: 8123,
      user: 'default',
      database: 'market',
      password: undefined,
    });
    // JSON.stringify drops undefined keys.
    expect(body).not.toHaveProperty('password');
  });

  it('Test Connection 404 renders the not-available branch', async () => {
    installRouter({
      ...INITIAL_ROUTES,
      'POST /api/market-data/clickhouse/test-connection': {
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      },
    });
    const user = userEvent.setup();
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /test connection/i })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText('Test connection endpoint not available yet.')).toBeTruthy();
    });
  });

  it('parses a successful OAuth callback and cleans the URL', async () => {
    window.history.replaceState({}, '', '/settings/market-data?schwab=connected');
    installRouter(INITIAL_ROUTES);
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByText('Successfully connected to Schwab.')).toBeTruthy();
    });
    expect(window.location.search).toBe('');
  });

  it('parses an OAuth error callback with the mapped reason and cleans the URL', async () => {
    window.history.replaceState({}, '', '/settings/market-data?schwab=error&reason=not_configured');
    installRouter(INITIAL_ROUTES);
    render(<MarketDataPage />);

    await waitFor(() => {
      expect(screen.getByText('Schwab API credentials are missing.')).toBeTruthy();
    });
    expect(window.location.search).toBe('');
  });
});
