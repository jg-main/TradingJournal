/**
 * Characterization tests for the Danger Zone settings page (M004 Task 19).
 *
 * Danger Zone hosts the destructive Factory Reset workflow on
 * SettingsChildPage. These tests pin the state machine and every frozen
 * contract: the warning backup gate, the exact 'RESET' typed confirmation,
 * autofocus, the POST /api/reset request with its AbortController, the
 * 2000ms success redirect, API/network failure handling, retry, and close.
 *
 * Run: npx vitest run "src/app/(legacy)/settings/danger-zone/__tests__/page.test.tsx"
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import React, { type ComponentType } from 'react';

let DangerZonePage: ComponentType;

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/danger-zone/page');
  DangerZonePage = mod.default;
});

type ResetCall = { method: string; url: string; hasSignal: boolean };

function installResetRouter(responses: unknown[]): { calls: ResetCall[] } {
  const calls: ResetCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, hasSignal: Boolean(init?.signal) });
    const value = responses.shift();
    if (typeof value === 'function') return value();
    if (value && typeof value === 'object' && typeof (value as { json?: unknown }).json === 'function') {
      return Promise.resolve(value as unknown as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(value) } as unknown as Response);
  });
  vi.stubGlobal('fetch', fn);
  return { calls };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Walk the flow: download backup → Next → type into the confirm input. */
async function walkToConfirm(inputValue: string) {
  fireEvent.click(screen.getByText('Download Backup'));
  fireEvent.click(screen.getByText('Next'));
  const input = screen.getByPlaceholderText('Type RESET to confirm') as HTMLInputElement;
  fireEvent.change(input, { target: { value: inputValue } });
  return input;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mockPush.mockClear();
  cleanup();
});

describe('Danger Zone settings page (SettingsChildPage adoption)', () => {
  it('renders the initial warning state with Back, title, description, and disabled Next', () => {
    installResetRouter([]);
    render(<DangerZonePage />);

    expect(screen.getByRole('link', { name: /back to settings/i }).getAttribute('href')).toBe('/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'Danger Zone' })).toBeTruthy();
    expect(screen.getByText('Destructive actions that permanently alter your journal data.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Factory Reset' })).toBeTruthy();

    const download = screen.getByText('Download Backup') as HTMLAnchorElement;
    expect(download.getAttribute('href')).toBe('/api/backup');
    expect(download.hasAttribute('download')).toBe(true);

    const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('sets the exact document title', () => {
    installResetRouter([]);
    render(<DangerZonePage />);
    expect(document.title).toBe('Danger Zone — Settings — Trading Journal');
  });

  it('enables Next after downloading a backup, then transitions to confirm and clears the gate', async () => {
    installResetRouter([]);
    render(<DangerZonePage />);

    expect(screen.queryByText('I have downloaded and saved a backup')).toBeNull();
    fireEvent.click(screen.getByText('Download Backup'));

    expect(screen.getByText('I have downloaded and saved a backup')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Type RESET to confirm' })).toBeTruthy();
    });
    expect(screen.queryByText('I have downloaded and saved a backup')).toBeNull();
  });

  it('focuses the confirm input on entering the confirm step', async () => {
    installResetRouter([]);
    render(<DangerZonePage />);

    fireEvent.click(screen.getByText('Download Backup'));
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Type RESET to confirm'));
    });
  });

  it('enables Confirm Reset only for the exact uppercase RESET', async () => {
    installResetRouter([]);
    render(<DangerZonePage />);

    fireEvent.click(screen.getByText('Download Backup'));
    fireEvent.click(screen.getByText('Next'));
    const input = screen.getByPlaceholderText('Type RESET to confirm') as HTMLInputElement;

    for (const value of ['', 'reset', ' RESET', 'RESET ']) {
      fireEvent.change(input, { target: { value } });
      expect((screen.getByRole('button', { name: 'Confirm Reset' }) as HTMLButtonElement).disabled).toBe(true);
    }

    fireEvent.change(input, { target: { value: 'RESET' } });
    expect((screen.getByRole('button', { name: 'Confirm Reset' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('posts /api/reset and redirects to / exactly 2000ms after success', async () => {
    vi.useFakeTimers();
    const { calls } = installResetRouter([{ success: true }]);
    render(<DangerZonePage />);

    await walkToConfirm('RESET');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reset' }));
    await flush();

    expect(calls).toEqual([{ method: 'POST', url: '/api/reset', hasSignal: true }]);
    expect(screen.getByText('Reset Complete')).toBeTruthy();

    // No immediate or early redirect.
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('shows Reset Failed with the API error and Try Again returns to the warning state', async () => {
    installResetRouter([
      { ok: false, status: 400, json: () => Promise.resolve({ success: false, error: 'Reset blocked' }) },
    ]);
    render(<DangerZonePage />);

    await walkToConfirm('RESET');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reset' }));
    await flush();

    expect(screen.getByRole('heading', { level: 2, name: 'Reset Failed' })).toBeTruthy();
    expect(screen.getByText('Reset blocked')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(screen.getByRole('heading', { level: 2, name: 'Factory Reset' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByPlaceholderText('Type RESET to confirm')).toBeNull();
  });

  it('shows a network error and Close routes to /settings', async () => {
    installResetRouter([() => Promise.reject(new Error('network down'))]);
    render(<DangerZonePage />);

    await walkToConfirm('RESET');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reset' }));
    await flush();

    expect(screen.getByRole('heading', { level: 2, name: 'Reset Failed' })).toBeTruthy();
    expect(screen.getByText('network down')).toBeTruthy();

    // The error step has an icon Close (aria-label) and a text Close button —
    // click the text button.
    const closeButton = screen.getByText('Close').closest('button') as HTMLButtonElement;
    fireEvent.click(closeButton);
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
});
