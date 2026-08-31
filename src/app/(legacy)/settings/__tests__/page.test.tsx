/**
 * Characterization tests for the /settings hub page (M004 Task 10).
 *
 * The Settings hub is the canonical CONSTRAINED_CONFIGURATION page. These
 * tests pin the functional contract that the structural polish must preserve:
 * title, canonical subtitle, readiness-driven Setup status, the
 * readiness-dependent checklist, and all configuration destinations.
 *
 * Visual geometry is intentionally NOT asserted here — it belongs to browser
 * evidence, not brittle class assertions.
 *
 * Run: npx vitest run "src/app/(legacy)/settings/__tests__/page.test.tsx"
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import React, { type ComponentType } from 'react';

let SettingsPage: ComponentType;

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    'aria-label': ariaLabel,
    title,
  }: {
    children: React.ReactNode;
    href: string;
    'aria-label'?: string;
    title?: string;
  }) => React.createElement('a', { href, 'aria-label': ariaLabel, title }, children),
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/page');
  SettingsPage = mod.default;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Readiness when the journal has not been set up yet. */
const NOT_READY = {
  ready: false,
  missing: [
    { id: 'app_profile', label: 'Workspace', href: '/settings/workspace' },
    { id: 'settings', label: 'Risk Defaults', href: '/settings/risk-defaults' },
    { id: 'setups', label: 'Trading Setups', href: '/settings/plays' },
  ],
};

const READY = { ready: true, missing: [] };

function stubReadiness(data: unknown, deferred?: { resolve: (v: unknown) => void }) {
  const mock = vi.fn().mockReturnValue(
    new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      const settle = () =>
        resolve({ ok: true, json: () => Promise.resolve(data) });
      if (deferred) {
        deferred.resolve = settle;
      } else {
        settle();
      }
    }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

function deferredResolve(): { resolve: (v: unknown) => void } {
  return { resolve: () => {} };
}

describe('Settings hub page (CONSTRAINED_CONFIGURATION)', () => {
  it('renders the Settings title and the canonical configuration subtitle', async () => {
    stubReadiness(READY);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    });
    expect(screen.getByText('Configure your trading journal')).toBeTruthy();
  });

  it('renders all configuration destinations as links', async () => {
    stubReadiness(READY);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    });

    const destinations: Array<[string, string]> = [
      ['Workspace', '/settings/workspace'],
      ['Accounts', '/settings/accounts'],
      ['Risk Defaults', '/settings/risk-defaults'],
      ['Journal Setup', '/settings/journal-setup'],
      ['Integrations', '/settings/integrations'],
      ['Backup', '/settings/backup'],
      ['Danger Zone', '/settings/danger-zone'],
    ];
    for (const [title, href] of destinations) {
      // The card accessible name begins with its title; anchor to the exact
      // start so descriptions mentioning the same word never collide.
      const link = screen.getByRole('link', { name: new RegExp(`^${title}`) });
      expect(link.getAttribute('href')).toBe(href);
    }
  });

  it('shows the Setup status badge when readiness resolves ready and hides the checklist', async () => {
    stubReadiness(READY);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('All set')).toBeTruthy();
    });
    expect(screen.queryByText('Setup your journal')).toBeNull();
  });

  it('shows the readiness-dependent checklist when setup is incomplete and no All set status', async () => {
    stubReadiness(NOT_READY);
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Setup your journal')).toBeTruthy();
    });
    // The three ordered steps from the incomplete readiness payload — they
    // are h3 step headings (distinct from the h2 destination card titles).
    expect(screen.getByRole('heading', { level: 3, name: 'Workspace' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Risk Defaults' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Trading Setups' })).toBeTruthy();
    expect(screen.queryByText('All set')).toBeNull();
  });

  it('keeps loading geometry before readiness resolves (no premature status or cards)', async () => {
    const gate = deferredResolve();
    stubReadiness(READY, gate);
    render(<SettingsPage />);

    // While readiness is pending: no status badge, no destination cards yet.
    expect(screen.queryByText('All set')).toBeNull();
    expect(screen.queryByText('Setup your journal')).toBeNull();

    await act(async () => {
      gate.resolve(undefined);
    });
    await waitFor(() => {
      expect(screen.getByText('All set')).toBeTruthy();
    });
  });
});
