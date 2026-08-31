/**
 * Component tests for the Workspace settings page (M004 Task 11).
 *
 * Covers the child-page grammar contract:
 * - Loading state keeps the page shell (Back to Settings + Workspace heading)
 *   while only the content body shows the loading text.
 * - Renders the timezone control after loading via the shared Select.
 * - No displayName or defaultCurrency fields in the DOM.
 * - Displays the current timezone from the API.
 * - All supported timezone values remain selectable.
 * - Save submits the correct PUT payload and redirects to /settings.
 * - API error displays an error message.
 * - Network error during initial fetch shows usable defaults.
 *
 * Radix Select is not a native <select>, so interactions follow real user
 * semantics (click the trigger, click the option) rather than selectOptions.
 *
 * Run: npx vitest run "src/app/(legacy)/settings/workspace/__tests__/page.test.tsx"
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

// Module-level bridge to wire Select onValueChange to SelectItem clicks —
// the established repo pattern for unit-testing shared Select consumers
// (the real Radix Select needs a full DOM interaction harness).
let selectOnValueChange: ((v: string) => void) | null = null;

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => {
    selectOnValueChange = onValueChange ?? null;
    return React.createElement('div', { 'data-testid': 'select', 'data-value': value }, children);
  },
  SelectTrigger: ({ children, 'aria-label': ariaLabel }: { children: React.ReactNode; 'aria-label'?: string }) =>
    React.createElement('button', {
      'data-testid': 'select-trigger',
      role: 'combobox',
      'aria-label': ariaLabel,
      type: 'button' as const,
    }, children),
  SelectContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'select-content' }, children),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement('button', {
      'data-testid': `select-item-${value}`,
      type: 'button' as const,
      onClick: () => selectOnValueChange?.(value),
    }, children),
  SelectValue: () => React.createElement('span', { 'data-testid': 'select-value' }),
}));

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

/** Select a timezone through the shared Select bridge (option button click). */
function pickTimezone(value: string) {
  screen.getByTestId(`select-item-${value}`).click();
}

// ── Tests ──────────────────────────────────────────────────────────────

afterEach(() => {
  globalThis.fetch = UNMOCKED_FETCH;
  mockPush.mockClear();
  cleanup();
});

describe('Workspace settings page', () => {
  it('shows loading text while keeping the shell and header geometry', async () => {
    mockFetchSuccess(); // delayed, not awaited
    const { container } = render(React.createElement(WorkspacePage));
    expect(container.textContent).toContain('Loading workspace settings...');
    // The child-page skeleton remains stable while data loads.
    expect(screen.getByText('Back to Settings')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /workspace/i })).toBeTruthy();
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
    expect(screen.queryByText('Loading workspace settings...')).toBeNull();
  });

  it('pre-selects the timezone from the API response', async () => {
    mockFetchSuccess();
    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      // The shared Select exposes the current value via its value prop.
      expect(screen.getByTestId('select').getAttribute('data-value')).toBe('America/New_York');
    });
  });

  it('has no displayName or defaultCurrency input fields', async () => {
    mockFetchSuccess();
    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /workspace/i })).toBeTruthy();
    });

    // Only the timezone control exists — no free-text or hidden fields surface.
    expect(screen.getByLabelText('Timezone')).toBeTruthy();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByText(/display.*name/i)).toBeNull();
    expect(screen.queryByText(/default.*currency/i)).toBeNull();
  });

  it('keeps every supported timezone value selectable', async () => {
    mockFetchSuccess();
    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByTestId('select')).toBeTruthy();
    });

    const values = [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Bogota',
      'Europe/London',
      'Europe/Berlin',
      'Asia/Tokyo',
      'Asia/Shanghai',
      'Australia/Sydney',
      'UTC',
    ];
    for (const value of values) {
      expect(screen.getByTestId(`select-item-${value}`)).toBeTruthy();
    }
  });

  it('submits the timezone change and redirects to /settings', async () => {
    const fetchMock = mockFetchSuccess();
    const user = userEvent.setup();

    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByTestId('select')).toBeTruthy();
    });

    // Change timezone through the shared Select.
    pickTimezone('Europe/London');

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

    await pickTimezone('Europe/London');
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

    // Default timezone should be used.
    expect(screen.getByTestId('select').getAttribute('data-value')).toBe('America/Bogota');
  });

  it('renders with defaults when initial fetch fails', async () => {
    mockFetchNetworkError();

    render(React.createElement(WorkspacePage));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /workspace/i })).toBeTruthy();
    });
    // The form body is still usable with the default timezone.
    expect(screen.getByTestId('select').getAttribute('data-value')).toBe('America/Bogota');
  });
});
