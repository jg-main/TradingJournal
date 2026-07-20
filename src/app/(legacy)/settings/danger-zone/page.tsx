'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CircleCheck,
  Loader2,
  X,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────

type ResetStep = 'warning' | 'confirm' | 'resetting' | 'success' | 'error';

// ── Page ────────────────────────────────────────────────────────────────

export default function DangerZonePage() {
  const router = useRouter();
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [step, setStep] = useState<ResetStep>('warning');
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Document title
  useEffect(() => {
    document.title = 'Danger Zone — Settings — Trading Journal';
  }, []);

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

  const handleClose = () => {
    abortRef.current?.abort();
    router.push('/settings');
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
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/settings"
          className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          Back to Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Danger Zone
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          Destructive actions that permanently alter your journal data.
        </p>
      </div>

      {/* Reset flow card */}
      <div className="rounded-xl border border-red-200 bg-red-50/40 p-6 dark:border-red-900/50 dark:bg-red-950/20">
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
              <Link
                href="/settings"
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </Link>
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
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Reset Failed</h2>
              <button
                onClick={handleClose}
                className="rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
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
