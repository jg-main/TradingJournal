/**
 * Characterization tests for the Backup settings page (M004 Task 15).
 *
 * Backup is an action-rich operational configuration surface migrated onto
 * SettingsChildPage WITHOUT changing any backup behavior. These tests pin:
 * - the initial-loading shell contract (Back + title + description + loading
 *   text, no body sections);
 * - the critical loading distinction: a BACKGROUND refresh (loading=true with
 *   settings already present) must keep the loaded surface visible;
 * - the initial three-resource acquisition;
 * - the presence of every existing section/control;
 * - one representative action regression (Backup Now).
 *
 * Run: npx vitest run "src/app/(legacy)/settings/backup/__tests__/page.test.tsx"
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ComponentType } from 'react';

let BackupPage: ComponentType;

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => React.createElement('a', { href }, children),
}));

// Mock RestoreModal at the page-test boundary (its own suite is untouched).
vi.mock('@/components/restore-modal', () => ({
  default: ({ initialFile }: { initialFile?: { filename?: string } }) =>
    React.createElement('div', { 'data-testid': 'restore-modal' }, initialFile?.filename ?? 'upload'),
  formatBackupDate: (iso: string) => iso ?? '',
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/backup/page');
  BackupPage = mod.default;
});

// ── Fixtures ────────────────────────────────────────────────────────────

const SETTINGS = {
  id: 'sett-001',
  backupEnabled: true,
  backupRetentionCount: 7,
  backupLastRunAt: '2026-08-30T10:00:00.000Z',
  backupLastRunStatus: 'success',
  backupCronTime: '02:00',
};

const STATUS = {
  lastRunAt: '2026-08-30T10:00:00.000Z',
  lastRunStatus: 'success',
  nextScheduledAt: '2026-08-31T02:00:00.000Z',
  schedulerActive: true,
  schedulerStatus: 'active',
  schedulerNodeEnv: 'production',
  backupCronTime: '02:00',
  cronExpression: '0 2 * * *',
  appTimezone: 'America/New_York',
  backupDir: '/data/backups',
};

const FILES = [{ filename: 'journal-backup.zip', isoDate: '2026-08-29T00:00:00.000Z', sizeHuman: '1.2 MB' }];

type FetchCall = { url: string; method: string };

/** Route fetch by `${METHOD} ${url}`; unknown routes reject. */
function installRouter(
  routes: Record<string, unknown>,
  calls: FetchCall[] = [],
): { calls: FetchCall[]; fn: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    calls.push({ url, method: init?.method ?? 'GET' });
    if (!(key in routes)) throw new Error(`unmocked: ${key}`);
    return { ok: true, json: () => Promise.resolve(routes[key]) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

const INITIAL_ROUTES = {
  'GET /api/settings': SETTINGS,
  'GET /api/backup/status': STATUS,
  'GET /api/backup/files': FILES,
};

afterEach(() => {
  vi.unstubAllGlobals();
  mockPush.mockClear();
  cleanup();
});

const SECTIONS = ['Status', 'Automatic Backups', 'Retention Count', 'Scheduled Backups', 'Manual Backup & Restore'];

// ── Tests ───────────────────────────────────────────────────────────────

describe('Backup settings page (SettingsChildPage adoption)', () => {
  it('keeps Back, title, description, and loading text during initial loading, with no body sections', async () => {
    // Hold every request so the page stays in the initial loading state.
    const gate = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', gate);

    const { container } = render(<BackupPage />);

    expect(screen.getByText('Back to Settings')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Backup' })).toBeTruthy();
    expect(screen.getByText('Configure automated backups, retention, and restore options.')).toBeTruthy();
    expect(container.textContent).toContain('Loading backup settings...');

    for (const section of SECTIONS) {
      expect(screen.queryByText(section)).toBeNull();
    }
  });

  it('acquires exactly the three expected resources and renders every section', async () => {
    const { calls } = installRouter(INITIAL_ROUTES);
    render(<BackupPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Status' })).toBeTruthy();
    });

    const urls = calls.map((c) => c.url).sort();
    expect(urls).toEqual(['/api/backup/files', '/api/backup/status', '/api/settings']);

    for (const section of SECTIONS) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeTruthy();
    }
    expect(screen.queryByText('Loading backup settings...')).toBeNull();
  });

  it('renders Back to Settings pointing to /settings', async () => {
    installRouter(INITIAL_ROUTES);
    render(<BackupPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Status' })).toBeTruthy();
    });
    const back = screen.getByRole('link', { name: /back to settings/i });
    expect(back.getAttribute('href')).toBe('/settings');
  });

  it('renders status data, the switch, time, retention, and action controls after load', async () => {
    installRouter(INITIAL_ROUTES);
    const { container } = render(<BackupPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Status' })).toBeTruthy();
    });

    expect(screen.getByText('Last Run')).toBeTruthy();
    expect(screen.getByText('Next Scheduled Run')).toBeTruthy();

    const toggle = screen.getByRole('switch') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    const timeInput = screen.getByLabelText('Backup Time (24h)') as HTMLInputElement;
    expect(timeInput.value).toBe('02:00');

    const retention = container.querySelector('#retentionCount') as HTMLSelectElement;
    expect(retention).toBeTruthy();
    expect(retention.value).toBe('7');

    expect(screen.getByRole('button', { name: /backup now/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /download backup/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /upload backup/i })).toBeTruthy();

    // Scheduled Backups renders the loaded file row (formatBackupDate output).
    expect(screen.getByText('2026-08-29T00:00:00.000Z')).toBeTruthy();
  });

  it('renders the action controls through the shared Button primitive (M004 micro-fix)', async () => {
    installRouter(INITIAL_ROUTES);
    render(<BackupPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Backup Now' })).toBeTruthy();
    });

    // Primary commitments (Backup Now, Save Time, retention Save, Restore,
    // Upload) use the default Button variant; Download is the outline
    // secondary action in the same group. All render through the shared
    // primitive (data-slot="button") with the exact names preserved.
    const primary = ['Backup Now', 'Save Time', 'Save', 'Restore', 'Upload Backup'];
    for (const name of primary) {
      const btn = screen.getByRole('button', { name });
      expect(btn.getAttribute('data-slot'), `Backup action ${name}`).toBe('button');
    }
    const download = screen.getByRole('button', { name: 'Download Backup' });
    expect(download.getAttribute('data-slot')).toBe('button');
    expect(download.getAttribute('data-variant')).toBe('outline');
    const upload = screen.getByRole('button', { name: 'Upload Backup' });
    expect(upload.getAttribute('data-variant')).toBe('default');
    // The destructive delete row action keeps destructive styling, not primary.
    const del = screen.getByRole('button', { name: /delete backup/i });
    expect(del.getAttribute('data-slot')).toBe('button');
    expect(del.getAttribute('data-variant')).toBe('ghost');
  });

  it('shows the Scheduled Backups empty state when files=[]', async () => {
    installRouter({
      ...INITIAL_ROUTES,
      'GET /api/backup/files': [],
    });
    render(<BackupPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Scheduled Backups' })).toBeTruthy();
    });
    expect(screen.getByText(/no backup files yet/i)).toBeTruthy();
  });

  it('a background refresh keeps the loaded content visible and never shows initial-loading text', async () => {
    // Phase 1: normal initial acquisition.
    installRouter(INITIAL_ROUTES);
    const result = render(<BackupPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Status' })).toBeTruthy();
    });
    expect(screen.getByRole('switch')).toBeTruthy();

    // Phase 2: background refresh (focus) whose requests stay pending.
    const pending: Array<{ url: string; resolve: (v: Response) => void }> = [];
    const holdFetch = vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          pending.push({ url, resolve });
        }),
    );
    vi.stubGlobal('fetch', holdFetch);

    window.dispatchEvent(new Event('focus'));

    // While the refresh is pending, settings exists → the loaded surface must
    // remain fully visible with NO initial-loading text.
    expect(screen.getByRole('heading', { level: 1, name: 'Backup' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Status' })).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy();
    expect(result.container.textContent).not.toContain('Loading backup settings...');

    // Resolve each refresh request with the correct payload; the surface stays.
    const refreshRoutes: Record<string, unknown> = {
      '/api/settings': SETTINGS,
      '/api/backup/status': STATUS,
      '/api/backup/files': FILES,
    };
    for (const entry of pending) {
      entry.resolve({
        ok: true,
        json: () => Promise.resolve(refreshRoutes[entry.url]),
      } as unknown as Response);
    }

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Status' })).toBeTruthy();
    });
    expect(screen.getByRole('switch')).toBeTruthy();
    expect(result.container.textContent).not.toContain('Loading backup settings...');
  });

  it('Backup Now posts, shows the success message, and refreshes status', async () => {
    const calls: FetchCall[] = [];
    installRouter(
      {
        ...INITIAL_ROUTES,
        'POST /api/backup/now': { success: true },
      },
      calls,
    );
    const user = userEvent.setup();
    render(<BackupPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /backup now/i })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /backup now/i }));

    await waitFor(() => {
      expect(screen.getByText('Backup completed successfully.')).toBeTruthy();
    });

    // POST now + a status refresh afterwards.
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/backup/now')).toBe(true);
    const statusCalls = calls.filter((c) => c.method === 'GET' && c.url === '/api/backup/status');
    expect(statusCalls.length).toBeGreaterThanOrEqual(2);
  });
});
