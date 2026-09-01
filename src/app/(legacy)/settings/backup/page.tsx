'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CircleCheck,
  CircleX,
  HelpCircle,
  Loader2,
  Play,
  Trash2,
  Upload,
} from 'lucide-react';
import type { JSX } from 'react';
import RestoreModal, { type BackupFileEntry, formatBackupDate } from '@/components/restore-modal';
import { Button } from '@/components/ui/button';
import { SettingsChildPage } from '@/components/settings/settings-child-page';

// ── Types ───────────────────────────────────────────────────────────────

interface Settings {
  id: string;
  backupEnabled: boolean | null;
  backupRetentionCount: number | null;
  backupLastRunAt: string | null;
  backupLastRunStatus: 'success' | 'error' | null;
  backupCronTime: string | null;
}

interface BackupStatus {
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'error' | null;
  nextScheduledAt: string | null;
  schedulerActive: boolean;
  schedulerStatus: string;
  schedulerNodeEnv: string;
  backupCronTime: string;
  cronExpression: string;
  appTimezone: string;
  backupDir: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatTimestamp(iso: string | null, timezone?: string): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(timezone ? { timeZone: timezone } : {}),
    });
  } catch {
    return iso;
  }
}

function formatTimeHHMM(time: string | null): string {
  if (!time) return '02:00';
  // Already HH:MM — display directly
  return time;
}

function StatusDot({ status }: { status: 'success' | 'error' | null }): JSX.Element {
  if (status === 'success') {
    return <CircleCheck className="size-5 text-positive" aria-hidden />;
  }
  if (status === 'error') {
    return <CircleX className="size-5 text-destructive" aria-hidden />;
  }
  return <HelpCircle className="size-5 text-muted-foreground" aria-hidden />;
}

// ── Page ────────────────────────────────────────────────────────────────

export default function BackupsSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreFile, setRestoreFile] = useState<BackupFileEntry | undefined>(undefined);
  const [serverFiles, setServerFiles] = useState<BackupFileEntry[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupCronTime, setBackupCronTime] = useState('02:00');
  const [retentionCount, setRetentionCount] = useState(7);
  const [deletingFiles, setDeletingFiles] = useState<Set<string>>(new Set());
  const [appTimezone, setAppTimezone] = useState('America/Bogota');

  // ── Data loading ────────────────────────────────────────────────────

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setMessage(null);

      const [settingsRes, statusRes, filesRes] = await Promise.all([
        fetch('/api/settings', { signal }),
        fetch('/api/backup/status', { signal }),
        fetch('/api/backup/files', { signal }),
      ]);

      if (settingsRes.ok) {
        const settingsData = (await settingsRes.json()) as Settings;
        if (settingsData && settingsData.id) {
          setSettings(settingsData);
          setBackupEnabled(settingsData.backupEnabled ?? false);
          setBackupCronTime(settingsData.backupCronTime ?? '02:00');
          setRetentionCount(settingsData.backupRetentionCount ?? 7);
        }
      }

      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as BackupStatus;
        setBackupStatus(statusData);
        if (statusData.appTimezone) setAppTimezone(statusData.appTimezone);
      }

      if (filesRes.ok) {
        const files = (await filesRes.json()) as BackupFileEntry[];
        setServerFiles(files ?? []);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setMessage({ type: 'error', text: 'Failed to load backup settings.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    // Inline the initial data fetch to avoid synchronous setState in the effect body
    // (loading is already true from initial state, so no setLoading(true) needed here)
    const initialLoad = async () => {
      try {
        const [settingsRes, statusRes, filesRes] = await Promise.all([
          fetch('/api/settings', { signal: controller.signal }),
          fetch('/api/backup/status', { signal: controller.signal }),
          fetch('/api/backup/files', { signal: controller.signal }),
        ]);

        if (settingsRes.ok) {
          const settingsData = (await settingsRes.json()) as Settings;
          if (settingsData && settingsData.id) {
            setSettings(settingsData);
            setBackupEnabled(settingsData.backupEnabled ?? false);
            setBackupCronTime(settingsData.backupCronTime ?? '02:00');
            setRetentionCount(settingsData.backupRetentionCount ?? 7);
          }
        }

        if (statusRes.ok) {
          const statusData = (await statusRes.json()) as BackupStatus;
          setBackupStatus(statusData);
          if (statusData.appTimezone) setAppTimezone(statusData.appTimezone);
        }

        if (filesRes.ok) {
          const files = (await filesRes.json()) as BackupFileEntry[];
          setServerFiles(files ?? []);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setMessage({ type: 'error', text: 'Failed to load backup settings.' });
      } finally {
        setLoading(false);
      }
    };

    initialLoad();

    const handleFocus = () => void loadData();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadData();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      controller.abort();
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadData]);

  // ── Toggle change (immediate save) ──────────────────────────────────

  const handleToggle = async () => {
    const next = !backupEnabled;
    setBackupEnabled(next);
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupEnabled: next, backupCronTime }),
      });

      if (!res.ok) {
        const err = await res.json();
        setBackupEnabled(!next); // revert on failure
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      const data = (await res.json()) as Settings;
      setSettings(data);
      setMessage({ type: 'success', text: 'Backup schedule updated.' });

      // Refresh status since scheduler state may have changed
      const statusRes = await fetch('/api/backup/status');
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as BackupStatus;
        setBackupStatus(statusData);
      }
    } catch {
      setBackupEnabled(!next); // revert on network error
      setMessage({ type: 'error', text: 'Failed to update backup setting.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Cron time change (separate save) ────────────────────────────────

  const handleCronTimeChange = async (newTime: string) => {
    setBackupCronTime(newTime);
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupCronTime: newTime }),
      });

      if (!res.ok) {
        const err = await res.json();
        setBackupCronTime(settings?.backupCronTime ?? '02:00'); // revert
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      const data = (await res.json()) as Settings;
      setSettings(data);
      setMessage({ type: 'success', text: `Backup time changed to ${newTime}.` });

      // Refresh status since scheduler may have rescheduled
      const statusRes = await fetch('/api/backup/status');
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as BackupStatus;
        setBackupStatus(statusData);
      }
    } catch {
      setBackupCronTime(settings?.backupCronTime ?? '02:00'); // revert
      setMessage({ type: 'error', text: 'Failed to update backup time.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Backup Now ────────────────────────────────────────────────────

  const handleBackupNow = async () => {
    setBackingUp(true);
    setMessage(null);

    try {
      const res = await fetch('/api/backup/now', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Backup failed.' });
      } else {
        setMessage({ type: 'success', text: 'Backup completed successfully.' });
      }

      // Refresh status to show updated last-run
      const statusRes = await fetch('/api/backup/status');
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as BackupStatus;
        setBackupStatus(statusData);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to trigger backup.' });
    } finally {
      setBackingUp(false);
    }
  };

  // ── Retention count save ────────────────────────────────────────────

  const handleRetentionSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupRetentionCount: retentionCount }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      const data = (await res.json()) as Settings;
      setSettings(data);
      setMessage({ type: 'success', text: 'Retention count saved.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save retention count.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete backup file ──────────────────────────────────────────────

  const handleDeleteFile = async (filename: string) => {
    if (!window.confirm(`Delete "${filename}"? This cannot be undone.`)) return;

    setDeletingFiles((prev) => new Set(prev).add(filename));
    setMessage(null);

    try {
      const res = await fetch(`/api/backup/files/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        setMessage({ type: 'error', text: data.error || 'Failed to delete backup file.' });
      } else {
        setServerFiles((prev) => prev.filter((f) => f.filename !== filename));
        setMessage({ type: 'success', text: `Deleted "${filename}".` });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to delete backup file.' });
    } finally {
      setDeletingFiles((prev) => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────
  // Initial loading is ONLY loading && !settings. Background refreshes
  // (focus/pageshow/visibility) set loading=true while settings already
  // exist — the loaded Backup surface must remain visible then, so the
  // shared child shell receives the derived initialLoading gate (M004/T15).
  const initialLoading = loading && !settings;

  return (
    <>
      <SettingsChildPage
        title="Backup"
        description="Configure automated backups, retention, and restore options."
        loading={initialLoading}
        loadingText="Loading backup settings..."
        message={message}
      >
        <div className="space-y-6">
          {/* ── Status Indicator ─────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Status</h2>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last Run</span>
              <div className="flex items-center gap-2">
                <StatusDot status={backupStatus?.lastRunStatus ?? settings?.backupLastRunStatus ?? null} />
                <span className="text-sm text-foreground">
                  {formatTimestamp(backupStatus?.lastRunAt ?? settings?.backupLastRunAt ?? null, appTimezone)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Next Scheduled Run</span>
              <span className="text-sm text-foreground">
                {backupStatus?.nextScheduledAt
                  ? formatTimestamp(backupStatus.nextScheduledAt, appTimezone)
                  : backupEnabled
                    ? backupStatus && !backupStatus.schedulerActive
                      ? 'Scheduler not active — see diagnostics below'
                      : 'Schedule pending'
                    : '—'}
              </span>
            </div>

            {/* ── Scheduler diagnostics ───────────────────────────── */}
            {backupEnabled && backupStatus && !backupStatus.schedulerActive && (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <p className="mb-1 font-medium">Scheduler Diagnostics</p>
                <ul className="space-y-0.5">
                  <li>
                    NODE_ENV: <code className="rounded bg-warning/10 px-1">{backupStatus.schedulerNodeEnv}</code>
                    {' — '}
                    {backupStatus.schedulerNodeEnv === 'production'
                      ? 'Environment correct.'
                      : 'Must be "production" for the scheduler to run.'}
                  </li>
                  <li>
                    Scheduler status: <code className="rounded bg-warning/10 px-1">{backupStatus.schedulerStatus}</code>
                  </li>
                  <li>
                    Cron expression: <code className="rounded bg-warning/10 px-1">{backupStatus.cronExpression}</code>
                  </li>
                  {backupStatus.schedulerNodeEnv !== 'production' && (
                    <li className="mt-1 font-medium">
                      {backupStatus.schedulerNodeEnv === 'development'
                        ? 'Scheduled backups are disabled in dev mode by design. In production (Docker), the scheduler starts automatically when backups are enabled.'
                        : <>
                            Fix: Restart the container with{' '}
                            <code className="rounded bg-warning/10 px-1">NODE_ENV=production</code>
                            {' '}set in the environment. The Docker image already includes this,
                            but your compose file or runtime may be overriding it.
                          </>
                      }
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm text-muted-foreground">Backup Now</span>
              <Button
                type="button"
                onClick={handleBackupNow}
                disabled={backingUp}
                size="sm"
              >
                {backingUp ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Backing up...
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" />
                    Backup Now
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Enable/Disable Toggle + Schedule Time ────────────────── */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-semibold text-foreground">
            Automatic Backups
          </h2>

          <div className="space-y-4">
            {/* Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">
                  {backupEnabled ? 'Scheduled backups are enabled' : 'Scheduled backups are disabled'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {backupEnabled
                    ? `Backups will run daily at ${formatTimeHHMM(backupCronTime)}.`
                    : 'Enable to automatically create daily backups.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={backupEnabled}
                onClick={handleToggle}
                disabled={saving}
                className={`relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                  backupEnabled
                    ? 'bg-foreground dark:bg-secondary'
                    : 'bg-input'
                }`}
              >
                <span
                  className={`inline-block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
                    backupEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Time picker */}
            <div className="flex items-center gap-3 border-t border-border pt-4">
              <div>
                <label htmlFor="backupCronTime" className="text-xs font-medium text-muted-foreground">
                  Backup Time (24h)
                </label>
                <p className="text-xs text-muted-foreground">
                  Daily backup at this time ({appTimezone.replace('_', ' ')})
                </p>
              </div>
              <input
                id="backupCronTime"
                type="time"
                value={backupCronTime}
                onChange={(e) => setBackupCronTime(e.target.value)}
                className="rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                type="button"
                onClick={() => handleCronTimeChange(backupCronTime)}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Time'}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Retention Count ───────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            Retention Count
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Number of backup files to keep before removing the oldest. Minimum 1, maximum 30.
          </p>

          <div className="flex items-center gap-3">
            <select
              id="retentionCount"
              value={retentionCount}
              onChange={(e) => setRetentionCount(Number(e.target.value))}
              className="rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Button
              type="button"
              onClick={handleRetentionSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>

        {/* ── Scheduled Backups ────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            Scheduled Backups
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Backup files created by the scheduler. Click Restore to recover data from any file.
          </p>
          {backupStatus?.backupDir && (
            <p className="mb-4 text-xs text-muted-foreground">
              Storage path: <code className="rounded bg-muted px-1 text-xs">{backupStatus.backupDir}</code>
            </p>
          )}

          {serverFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No backup files yet. Enable automatic backups above or use Backup Now to create one.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Backup Date</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Size</th>
                    <th className="w-28 px-3 py-2 text-right text-xs font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {serverFiles.map((file) => (
                    <tr key={file.filename} className="hover:bg-muted/50">
                      <td className="px-3 py-2.5 text-foreground">{formatBackupDate(file.isoDate)}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{file.sizeHuman}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            onClick={() => { setRestoreFile(file); setShowRestoreModal(true); }}
                            size="sm"
                          >
                            Restore
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => void handleDeleteFile(file.filename)}
                            disabled={deletingFiles.has(file.filename)}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Delete backup"
                            aria-label={`Delete backup ${file.filename}`}
                          >
                            {deletingFiles.has(file.filename) ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Manual: Download & Upload ──────────────────────────── */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-1 text-sm font-semibold text-foreground">
            Manual Backup &amp; Restore
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Download a backup to your computer or upload one to restore.
          </p>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const a = document.createElement('a');
                a.href = '/api/backup';
                a.download = `trading-journal-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }}
            >
              Download Backup
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => { setRestoreFile(undefined); setShowRestoreModal(true); }}
            >
              <Upload className="size-3.5" />
              Upload Backup
            </Button>
          </div>
        </div>
      </div>
      </SettingsChildPage>

      {showRestoreModal && <RestoreModal onClose={() => setShowRestoreModal(false)} initialFile={restoreFile} />}
    </>
  );
}
