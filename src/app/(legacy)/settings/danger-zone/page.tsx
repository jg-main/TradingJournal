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
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Danger Zone
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Destructive actions that permanently alter your journal data.
        </p>
      </div>

      {/* Reset flow card */}
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
        {/* ── Warning Step ──────────────────────── */}
        {step === 'warning' && (
          <div>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-6 shrink-0 text-destructive" />
              <div>
                <h2 className="text-lg font-semibold text-destructive">Factory Reset</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  This will permanently delete ALL your journal data, including trades, accounts,
                  settings, and preferences. This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
              <p className="text-sm font-medium text-warning">
                Backup required before reset
              </p>
              <p className="mt-1 text-xs text-warning">
                You must download a backup before proceeding. The reset button will only become
                active after you have saved a backup to your device.
              </p>
            </div>

            <a
              href="/api/backup"
              download
              onClick={handleDownloadBackup}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Download Backup
            </a>

            {backupDownloaded && (
              <div className="mt-3 flex items-center gap-2 text-sm text-positive">
                <CircleCheck className="size-4" />
                <span>I have downloaded and saved a backup</span>
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <Link
                href="/settings"
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </Link>
              <button
                onClick={handleNext}
                disabled={!backupDownloaded}
                className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* ── Confirm Step ──────────────────────── */}
        {step === 'confirm' && (
          <div>
            <h2 className="text-lg font-semibold text-destructive">Type RESET to confirm</h2>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                This will permanently delete ALL data in your journal. This action cannot be undone.
              </span>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              Type <span className="font-mono font-bold text-foreground">RESET</span> to confirm:
            </p>
            <input
              ref={confirmInputRef}
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type RESET to confirm"
              className="mt-2 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive/30"
              autoComplete="off"
              spellCheck={false}
            />

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={handleCancelToWarning}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={confirmText !== 'RESET'}
                className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        )}

        {/* ── Resetting Step ────────────────────── */}
        {step === 'resetting' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="size-10 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm font-medium text-foreground">Resetting your journal...</p>
            <p className="mt-1 text-xs text-muted-foreground">Please wait while your data is being cleared.</p>
          </div>
        )}

        {/* ── Success Step ──────────────────────── */}
        {step === 'success' && (
          <div className="flex flex-col items-center py-8">
            <CircleCheck className="size-12 text-positive" />
            <p className="mt-4 text-sm font-medium text-foreground">Reset Complete</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your journal has been reset. Redirecting to setup...
            </p>
          </div>
        )}

        {/* ── Error Step ────────────────────────── */}
        {step === 'error' && (
          <div>
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold text-destructive">Reset Failed</h2>
              <button
                onClick={handleClose}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage || 'An unexpected error occurred during reset.'}</span>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={handleClose}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Close
              </button>
              <button
                onClick={handleRetry}
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
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
