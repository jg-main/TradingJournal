'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Building2,
  ChartNoAxesCombined,
  CircleCheck,
  CircleDashed,
  Gamepad2,
  List,
  Loader2,
  Play,
  ShieldCheck,
  Upload,
  User,
  X,
} from 'lucide-react';
import type { ReadinessState } from '@/lib/readiness';

// ── Types ───────────────────────────────────────────────────────────────

interface HubCard {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  onClick?: () => void;
}

interface BackupManifest {
  schemaVersion: number;
  backupTimestamp: string;
  appVersion: string;
  tables: Record<string, number>;
}

type RestoreStep = 'upload' | 'preview' | 'confirm' | 'restoring' | 'success' | 'error';
type ResetStep = 'warning' | 'confirm' | 'resetting' | 'success' | 'error';

// ── Constants ───────────────────────────────────────────────────────────

const TABLE_LABELS: Record<string, string> = {
  app_profile: 'App Profile',
  accounts: 'Accounts',
  settings: 'Settings',
  lookup_values: 'Lookup Values',
  setup_definitions: 'Setup Definitions',
  trades: 'Trades',
  trade_executions: 'Trade Executions',
  trade_risk_snapshots: 'Trade Risk Snapshots',
  trade_stop_adjustments: 'Trade Stop Adjustments',
  trade_assets: 'Trade Assets',
  trade_grades: 'Trade Grades',
  trade_mistakes: 'Trade Mistakes',
  watchlist_items: 'Watchlist Items',
  account_transactions: 'Account Transactions',
  account_rollforward: 'Account Rollforward',
  weekly_reviews: 'Weekly Reviews',
  review_action_items: 'Review Action Items',
};

function formatBackupDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Cards (Link-based) ──────────────────────────────────────────────────

const cards: HubCard[] = [
  {
    title: 'Plays',
    description: 'Manage trading setups that appear in the Plan Trade dropdown.',
    href: '/settings/plays',
    icon: <Gamepad2 className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
  {
    title: 'App Preferences',
    description: 'Configure display name, timezone, and default currency.',
    href: '/settings/app',
    icon: <User className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
  {
    title: 'Risk Settings',
    description: 'Set max risk per trade, default commission, and starting account value.',
    href: '/settings/risk',
    icon: <ShieldCheck className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
  {
    title: 'Accounts',
    description: 'Manage your brokerage accounts, deposits, and withdrawals.',
    href: '/settings/accounts',
    icon: <Building2 className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
  {
    title: 'Lookup Values',
    description: 'Manage reference values: mistake types, sectors, market conditions, and more.',
    href: '/lookups',
    icon: <List className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
  {
    title: 'Export & Backup',
    description: 'Download a full backup of your journal as versioned JSON files.',
    href: '#',
    onClick: () => {
      const a = document.createElement('a');
      a.href = '/api/backup';
      a.download = 'trading-journal-backup.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    icon: <ChartNoAxesCombined className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
];

// ── Skeleton ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 size-8 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
      <div className="mb-2 h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-3 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
      <div className="mt-2 h-3 w-5/6 rounded bg-zinc-100 dark:bg-zinc-800" />
    </div>
  );
}

// ── Setup Checklist ────────────────────────────────────────────────────

function SetupChecklist({ readiness }: { readiness: ReadinessState }) {
  const steps = readiness.missing;
  const nextStep = steps[0] ?? null;
  const stepMap = new Map(steps.map((step, index) => [step.id, { ...step, stepNumber: index + 1 }]));

  const orderedSteps = [
    { id: 'app_profile', label: 'App Profile', href: '/settings/app' },
    { id: 'settings', label: 'Risk Settings', href: '/settings/risk' },
    { id: 'accounts', label: 'Accounts', href: '/settings/accounts' },
    { id: 'setups', label: 'Trading Setups', href: '/settings/plays' },
  ].map((step, index) => {
    const missing = stepMap.get(step.id);
    return {
      ...step,
      stepNumber: index + 1,
      isMissing: Boolean(missing),
      description:
        step.id === 'app_profile'
          ? 'Set your display name and profile details.'
          : step.id === 'settings'
            ? 'Choose your journal start date and risk defaults.'
            : step.id === 'accounts'
              ? 'Add at least one active brokerage account.'
              : 'Create at least one active trading setup.',
    };
  });

  return (
    <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Setup your journal</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Complete these steps to get started.
          </p>
        </div>
        {nextStep && (
          <Link
            href={nextStep.href}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Play className="size-3.5" />
            Continue setup
          </Link>
        )}
      </div>

      <div className="space-y-3">
        {orderedSteps.map((step) => (
          <div
            key={step.id}
            className={`flex items-start gap-4 rounded-lg border p-4 ${
              step.isMissing
                ? 'border-dashed border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/40'
                : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-900/10'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {step.isMissing ? (
                <CircleDashed className="size-5 text-zinc-500 dark:text-zinc-400" />
              ) : (
                <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                  Step {step.stepNumber}
                </span>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{step.label}</h3>
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{step.description}</p>
            </div>
            <Link
              href={step.href}
              aria-label={`Setup ${step.label}`}
              title={`Setup ${step.label}`}
              className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Set up
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Restore Modal ───────────────────────────────────────────────────────

function RestoreModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [step, setStep] = useState<RestoreStep>('upload');
  const [previewData, setPreviewData] = useState<{ manifest: BackupManifest } | null>(null);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-focus the confirm input when step changes to 'confirm'
  useEffect(() => {
    if (step === 'confirm' && confirmInputRef.current) {
      confirmInputRef.current.focus();
    }
  }, [step]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBackupFile(file);
    setErrorMessage('');
    setIsUploading(true);

    const formData = new FormData();
    formData.append('backup', file);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/restore/preview', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to preview backup');
        setIsUploading(false);
        return;
      }

      setPreviewData(data);
      setStep('preview');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setErrorMessage(err instanceof Error ? err.message : 'Network error during upload');
    } finally {
      setIsUploading(false);
      abortRef.current = null;
    }
  };

  const handleRestore = async () => {
    if (!backupFile) return;

    setStep('restoring');
    setErrorMessage('');

    const formData = new FormData();
    formData.append('backup', backupFile);

    try {
      const res = await fetch('/api/restore', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Restore failed');
        setStep('error');
        return;
      }

      setStep('success');

      // Redirect to dashboard after a brief pause to show success state
      setTimeout(() => {
        router.push('/');
      }, 2000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error during restore');
      setStep('error');
    }
  };

  const handleRetry = () => {
    setStep('upload');
    setErrorMessage('');
    setPreviewData(null);
    setBackupFile(null);
    setConfirmText('');
  };

  const handleGoBack = () => {
    if (step === 'confirm') {
      setStep('preview');
      setConfirmText('');
    } else if (step === 'error') {
      handleRetry();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Restore backup"
    >
      <div className="relative w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label="Close restore modal"
        >
          <X className="size-5" />
        </button>

        {/* ── Upload Step ─────────────────────────── */}
        {step === 'upload' && (
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Restore from Backup</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Upload a backup ZIP file to restore your journal data. This will replace all existing data.
            </p>

            {errorMessage && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span className="flex-1">{errorMessage}</span>
                <button
                  onClick={handleRetry}
                  className="shrink-0 text-xs font-medium text-red-600 underline underline-offset-2 hover:text-red-500 dark:text-red-300"
                >
                  Retry
                </button>
              </div>
            )}

            {isUploading ? (
              <div className="mt-6 flex flex-col items-center gap-3 py-8">
                <Loader2 className="size-8 animate-spin text-zinc-400" />
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Uploading and validating backup...</p>
              </div>
            ) : (
              <div className="mt-6">
                <label className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-zinc-300 px-6 py-8 text-center hover:border-zinc-400 dark:border-zinc-600 dark:hover:border-zinc-500">
                  <Upload className="size-10 text-zinc-400" strokeWidth={1.5} />
                  <div>
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Choose a backup ZIP file
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">Only .zip files exported from this journal are supported</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip"
                    onChange={handleFileChange}
                    className="sr-only"
                    aria-label="Select backup ZIP file"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {/* ── Preview Step ────────────────────────── */}
        {step === 'preview' && previewData && (
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Backup Preview</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Review the backup contents before restoring.
            </p>

            {/* Backup metadata */}
            <div className="mt-4 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Backup Date</span>
                <span className="text-sm text-zinc-900 dark:text-zinc-100">
                  {formatBackupDate(previewData.manifest.backupTimestamp)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Schema Version</span>
                <span className="text-sm text-zinc-900 dark:text-zinc-100">
                  v{previewData.manifest.schemaVersion}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">App Version</span>
                <span className="text-sm text-zinc-900 dark:text-zinc-100">
                  {previewData.manifest.appVersion}
                </span>
              </div>
            </div>

            {/* Table row counts */}
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300">Table</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-zinc-600 dark:text-zinc-300">Rows</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {Object.entries(previewData.manifest.tables).map(([tableName, count]) => (
                    <tr key={tableName} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">
                        {TABLE_LABELS[tableName] ?? tableName}
                      </td>
                      <td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">
                        {count < 0 ? 'Error' : count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={handleClose}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('confirm')}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Restore
              </button>
            </div>
          </div>
        )}

        {/* ── Confirm Step ───────────────────────── */}
        {step === 'confirm' && (
          <div>
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Confirm Restore</h2>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                This will permanently replace ALL existing data in your journal with the data from the backup. This action cannot be undone.
              </span>
            </div>

            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              Type <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">RESTORE</span> to confirm:
            </p>
            <input
              ref={confirmInputRef}
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type RESTORE to confirm"
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-red-500 dark:focus:ring-red-900/30"
              autoComplete="off"
              spellCheck={false}
            />

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={handleGoBack}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={handleRestore}
                disabled={confirmText !== 'RESTORE'}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
              >
                Confirm Restore
              </button>
            </div>
          </div>
        )}

        {/* ── Restoring Step ──────────────────────── */}
        {step === 'restoring' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="size-10 animate-spin text-zinc-400" />
            <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">Restoring...</p>
            <p className="mt-1 text-xs text-zinc-400">Please wait while your journal data is being restored.</p>
          </div>
        )}

        {/* ── Success Step ────────────────────────── */}
        {step === 'success' && (
          <div className="flex flex-col items-center py-8">
            <CircleCheck className="size-12 text-emerald-600 dark:text-emerald-400" />
            <p className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-50">Restore Complete</p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              Your journal has been restored. Redirecting to dashboard...
            </p>
          </div>
        )}

        {/* ── Error Step ──────────────────────────── */}
        {step === 'error' && (
          <div>
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Restore Failed</h2>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage || 'An unexpected error occurred during restore.'}</span>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={handleClose}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Close
              </button>
              <button
                onClick={handleRetry}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reset Dialog ───────────────────────────────────────────

function ResetDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [step, setStep] = useState<ResetStep>('warning');
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-focus the confirm input when step changes to 'confirm'
  useEffect(() => {
    if (step === 'confirm' && confirmInputRef.current) {
      confirmInputRef.current.focus();
    }
  }, [step]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const handleDownloadBackup = () => {
    setBackupDownloaded(true);
  };

  const handleNext = () => {
    if (!backupDownloaded) return;
    setStep('confirm');
    setBackupDownloaded(false);
  };

  const handleCancelToWarning = () => {
    setStep('warning');
    setBackupDownloaded(false);
    setConfirmText('');
  };

  const handleReset = async () => {
    if (confirmText !== 'RESET') return;

    setStep('resetting');
    setErrorMessage('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/reset', {
        method: 'POST',
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.error || 'Reset failed');
        setStep('error');
        return;
      }

      setStep('success');

      // Redirect to dashboard after a brief pause to show success state
      setTimeout(() => {
        router.push('/');
      }, 2000);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setErrorMessage(err instanceof Error ? err.message : 'Network error during reset');
      setStep('error');
    } finally {
      abortRef.current = null;
    }
  };

  const handleRetry = () => {
    setStep('warning');
    setBackupDownloaded(false);
    setConfirmText('');
    setErrorMessage('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Factory reset"
    >
      <div className="relative w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label="Close reset dialog"
        >
          <X className="size-5" />
        </button>

        {/* ── Warning Step ──────────────────────── */}
        {step === 'warning' && (
          <div>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-6 shrink-0 text-red-500 dark:text-red-400" />
              <div>
                <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Factory Reset</h2>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  This will permanently delete ALL your journal data, including trades, accounts,
                  settings, and preferences. This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Backup required before reset
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                You must download a backup before proceeding. The reset button will only become
                active after you have saved a backup to your device.
              </p>
            </div>

            <a
              href="/api/backup"
              download
              onClick={handleDownloadBackup}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Download Backup
            </a>

            {backupDownloaded && (
              <div className="mt-3 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <CircleCheck className="size-4" />
                <span>I have downloaded and saved a backup</span>
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={handleClose}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={handleNext}
                disabled={!backupDownloaded}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* ── Confirm Step ──────────────────────── */}
        {step === 'confirm' && (
          <div>
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Type RESET to confirm</h2>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                This will permanently delete ALL data in your journal. This action cannot be undone.
              </span>
            </div>

            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              Type <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">RESET</span> to confirm:
            </p>
            <input
              ref={confirmInputRef}
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type RESET to confirm"
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-red-500 dark:focus:ring-red-900/30"
              autoComplete="off"
              spellCheck={false}
            />

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={handleCancelToWarning}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={confirmText !== 'RESET'}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        )}

        {/* ── Resetting Step ────────────────────── */}
        {step === 'resetting' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="size-10 animate-spin text-zinc-400" />
            <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">Resetting your journal...</p>
            <p className="mt-1 text-xs text-zinc-400">Please wait while your data is being cleared.</p>
          </div>
        )}

        {/* ── Success Step ──────────────────────── */}
        {step === 'success' && (
          <div className="flex flex-col items-center py-8">
            <CircleCheck className="size-12 text-emerald-600 dark:text-emerald-400" />
            <p className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-50">Reset Complete</p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              Your journal has been reset. Redirecting to setup...
            </p>
          </div>
        )}

        {/* ── Error Step ────────────────────────── */}
        {step === 'error' && (
          <div>
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Reset Failed</h2>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage || 'An unexpected error occurred during reset.'}</span>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={handleClose}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Close
              </button>
              <button
                onClick={handleRetry}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────

export default function SettingsHubPage() {
  useEffect(() => { document.title = "Settings — Trading Journal"; }, []);
  const [readiness, setReadiness] = useState<ReadinessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  const loadReadiness = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/readiness', { signal });
      const data = (await res.json().catch(() => null)) as ReadinessState | { error?: string } | null;

      if (!res.ok) {
        throw new Error((data && 'error' in data && data.error) || 'Failed to load readiness');
      }

      setReadiness((data && 'ready' in data ? data : null) as ReadinessState | null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load readiness');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReadiness(controller.signal);

    const handleFocus = () => void loadReadiness();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadReadiness();
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
  }, [loadReadiness]);

  const shouldShowChecklist = readiness !== null && readiness.ready === false;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Settings
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Manage your trading journal preferences, risk parameters, and trading setups.
          </p>
        </div>
        {!loading && readiness?.ready && (
          <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-400">
            All set
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {shouldShowChecklist && readiness && <SetupChecklist readiness={readiness} />}

      {!loading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) =>
            card.onClick ? (
              <button
                key={card.title}
                onClick={card.onClick}
                className="group rounded-lg border border-zinc-200 bg-white p-6 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
              >
                <div className="mb-3">{card.icon}</div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{card.title}</h2>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{card.description}</p>
              </button>
            ) : (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-lg border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
            >
              <div className="mb-3">{card.icon}</div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{card.title}</h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{card.description}</p>
            </Link>
          ))}

          {/* Restore card (non-Link, opens modal) */}
          <button
            onClick={() => setShowRestoreModal(true)}
            className="group rounded-lg border border-zinc-200 bg-white p-6 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
          >
            <div className="mb-3">
              <Upload className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />
            </div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Restore</h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              Upload a backup ZIP to restore your journal data.
            </p>
          </button>
        </div>
      )}

      {/* Danger Zone */}
      <section className="mt-12 rounded-xl border border-red-200 bg-red-50/40 p-6 dark:border-red-900/50 dark:bg-red-950/20">
        <div className="flex items-start gap-4">
          <AlertTriangle className="mt-0.5 size-6 shrink-0 text-red-500 dark:text-red-400" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">Danger Zone</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              Destructive actions that permanently alter your journal data.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-red-200 bg-white p-4 dark:border-red-800 dark:bg-red-950/30">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Factory Reset</h3>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">
              Wipe all journal data and start fresh. A backup will be required before reset.
            </p>
          </div>
          <button
            onClick={() => setShowResetDialog(true)}
            className="shrink-0 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900/50"
          >
            Reset Journal
          </button>
        </div>
      </section>

      {/* Restore Modal */}
      {showRestoreModal && <RestoreModal onClose={() => setShowRestoreModal(false)} />}

      {/* Reset Dialog */}
      {showResetDialog && <ResetDialog onClose={() => setShowResetDialog(false)} />}
    </div>
  );
}
