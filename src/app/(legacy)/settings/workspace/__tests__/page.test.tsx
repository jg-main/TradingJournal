/**
 * Component tests for the Workspace settings page.
 *
 * Covers:
 * - Loading state shows loading text
 * - Renders timezone selector after loading
 * - No displayName or defaultCurrency fields in the DOM
 * - Displays current timezone from API
 * - Save submits correct data and redirects
 * - API error displays error message
 * - Network error during initial fetch shows fallback
 *
 * Run: npx vitest run --reporter verbose src/app/settings/workspace/__tests__/page.test.tsx
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ComponentType } from 'react';

let WorkspacePage: ComponentType;

const mockPush = vi.fn();

// Mock next/navigation before importing the page
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link to render a simple anchor
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) =>
    React.createElement(
      'a',
      { href, className },
      children,
    ),
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/workspace/page');
  WorkspacePage = mod.default;
});

// ── Helpers ────────────────────────────────────────────────────────────

const UNMOCKED_FETCH = globalThis.fetch;
const DEFAULT_PROFILE = {
  id: 'prof-001',
  displayName: 'Test Trader',
  timezone: 'America/New_York',
  defaultCurrency: 'USD',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-15T00:00:00.000Z',
};

function mockFetchSuccess(data: unknown = DEFAULT_PROFILE) {
  const mockFn = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
  globalThis.fetch = mockFn;
  return mockFn;
}

function mockFetchNetworkError() {
  const mockFn = vi.fn().mockRejectedValue(new TypeError('Network request failed'));
  globalThis.fetch = mockFn;
  return mockFn;
}

// ── Tests ──────────────────────────────────────────────────────────────

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  mockPush.mockClear();
  cleanup();
});

describe('Workspace settings page', () => {
  it('shows loading state initially', async () => {
    mockFetchSuccess(); // delayed, not awaited
    const { container } = render(React.createElement(WorkspacePage));
    expect(container.textContent).toContain('Loading workspace settings...');
  });

  it('renders timezone selector and heading after load', async () => {
    mockFetchSuccess();
    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /workspace/i })).toBeTruthy();
    });

    expect(screen.getByText('Back to Settings')).toBeTruthy();
    expect(screen.getByLabelText('Timezone')).toBeTruthy();
    expect(screen.getByText('Save Workspace')).toBeTruthy();
  });

  it('pre-selects the timezone from the API response', async () => {
    mockFetchSuccess();
    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      const select = screen.getByLabelText('Timezone') as HTMLSelectElement;
      expect(select.value).toBe('America/New_York');
    });
  });

  it('has no displayName or defaultCurrency input fields', async () => {
    mockFetchSuccess();
    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /workspace/i })).toBeTruthy();
    });

    // Should only have the timezone field
    const visibleInputs = screen.queryAllByRole('combobox');
    expect(visibleInputs).toHaveLength(1);
    expect(screen.queryByText(/display.*name/i)).toBeNull();
    expect(screen.queryByText(/default.*currency/i)).toBeNull();
  });

  it('submits timezone change and redirects to /settings', async () => {
    const fetchMock = mockFetchSuccess();
    const user = userEvent.setup();

    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByLabelText('Timezone')).toBeTruthy();
    });

    // Change timezone
    const select = screen.getByLabelText('Timezone');
    await user.selectOptions(select, 'Europe/London');

    // Click save
    await user.click(screen.getByText('Save Workspace'));

    await waitFor(() => {
      // First call is GET on mount, second call is PUT on save
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const putCall = fetchMock.mock.calls[1];
    expect(putCall[0]).toBe('/api/app-profile');
    expect(putCall[1]?.method).toBe('PUT');

    const putBody = JSON.parse(putCall[1]?.body as string);
    expect(putBody).toMatchObject({
      timezone: 'Europe/London',
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/settings');
    });
  });

  it('displays error message when save fails', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(DEFAULT_PROFILE),
        });
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'Timezone validation failed' }),
      });
    });
    globalThis.fetch = fetchMock;

    const user = userEvent.setup();
    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByLabelText('Timezone')).toBeTruthy();
    });

    await user.click(screen.getByText('Save Workspace'));

    await waitFor(() => {
      expect(screen.getByText('Timezone validation failed')).toBeTruthy();
    });
  });

  it('shows success message after save', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            callCount === 1
              ? DEFAULT_PROFILE
              : { ...DEFAULT_PROFILE, timezone: 'Europe/London' },
          ),
      });
    });
    globalThis.fetch = fetchMock;

    const user = userEvent.setup();
    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByLabelText('Timezone')).toBeTruthy();
    });

    await user.selectOptions(screen.getByLabelText('Timezone'), 'Europe/London');
    await user.click(screen.getByText('Save Workspace'));

    await waitFor(() => {
      expect(screen.getByText(/Workspace settings saved/i)).toBeTruthy();
    });
  });

  it('falls back gracefully when no profile exists yet', async () => {
    mockFetchSuccess({
      message: 'No app profile configured yet. Use PUT to create.',
    });

    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /workspace/i })).toBeTruthy();
    });

    // Default timezone should be used
    const select = screen.getByLabelText('Timezone') as HTMLSelectElement;
    expect(select.value).toBe('America/Bogota');
  });

  it('renders with defaults when initial fetch fails', async () => {
    mockFetchNetworkError();

    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /workspace/i })).toBeTruthy();
    });
  });
});
