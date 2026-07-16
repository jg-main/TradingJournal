'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CircleCheck,
  CircleDashed,
  Database,
  Gamepad2,
  HardDrive,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
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

type ResetStep = 'warning' | 'confirm' | 'resetting' | 'success' | 'error';

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
    title: 'AI',
    description: 'Configure AI provider for trade quality assessments.',
    href: '/settings/ai',
    icon: <Sparkles className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
  {
    title: 'Accounts',
    description: 'Manage your brokerage accounts, deposits, and withdrawals.',
    href: '/settings/accounts',
    icon: <Building2 className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
  {
    title: 'Mistake Types',
    description: 'Manage mistake categories for trade reviews.',
    href: '/settings/mistake-types',
    icon: <AlertTriangle className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
  {
    title: 'Market Data',
    description: 'Configure market data providers and connection settings.',
    href: '/settings/market-data',
    icon: <Database className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
  {
    title: 'Backup',
    description: 'Download backups, schedule automatic backups, and restore from backup files.',
    href: '/settings/backup',
    icon: <HardDrive className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
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


        </div>
      )}

      {/* ── Data Integrity & Backup Guidance ───────────────────────── */}
      <section className="mt-10 mb-10">
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start gap-3">
            <BookOpen className="mt-0.5 size-5 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Data Integrity &amp; Backup Guide
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                How accounting data, corrections, and backup/restore work together.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {/* Corrections */}
            <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/40">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Execution Corrections
              </h3>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Posted executions are immutable and cannot be edited or deleted. To correct a
                mistake, use the <strong>Correct</strong> button on the execution row in the
                account detail page. This creates an auditable reversal (opposite action, same
                values) and a replacement (corrected values). The original execution remains
                unchanged. FIFO positions and performance projections are rebuilt automatically.
              </p>
            </div>

            {/* Backup / Restore */}
            <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/40">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Backup &amp; Restore Safety
              </h3>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Backups include all accounting data: correction lineage, ledger entries, FIFO
                lots, positions, valuations, performance projections, and reconciliation state.
                When you restore a backup, the system validates the archive integrity before
                making any changes. It checks manifest completeness, schema versions, checksums,
                and ledger balance integrity. If validation fails, the live database is not
                modified. A pre-restore snapshot is saved so you can recover if needed.
                <span className="mt-1 block">
                  Navigate to{' '}
                  <Link href="/settings/backup" className="font-medium text-zinc-800 underline dark:text-zinc-200">
                    Backup Settings
                  </Link>
                  {' '}to create, download, or upload backups.
                </span>
              </p>
            </div>

            {/* Reconciliation Cutover */}
            <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/40">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Reconciliation &amp; Cutover
              </h3>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Account metrics can be sourced either from legacy calculations or from the
                accounting ledger. Active account views use ledger-derived metrics when
                available. The reconciliation status (eligible / stale / blocked) appears as
                a banner on the account detail page. A cutover is blocked when there are
                unmatched records or missing price data. Use the Reconciliation Summary
                section on the account page to review comparison totals.
              </p>
            </div>

            {/* Legacy Audit Boundary */}
            <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/40">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Legacy Read-Only Boundary
              </h3>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Journal trade attribution, legacy migration data, and audit records remain
                preserved and read-only. They are not modified by the accounting engine.
                Active account and dashboard metrics use the accounting ledger when
                reconciliation is complete. The Journal Attribution badge on the account
                page shows how many executions are linked to journal trades versus direct
                account-only entries.
              </p>
            </div>
          </div>
        </div>
      </section>

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

      {/* Reset Dialog */}
      {showResetDialog && <ResetDialog onClose={() => setShowResetDialog(false)} />}
    </div>
  );
}
