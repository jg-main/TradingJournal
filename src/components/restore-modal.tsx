'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppTimezone } from '@/lib/timezone-context';
import { AlertTriangle, CircleCheck, Clock, Loader2, Upload, X } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────

export type RestoreStep = 'upload' | 'browse' | 'preview' | 'confirm' | 'restoring' | 'success' | 'error';

export interface BackupFileEntry {
  filename: string;
  isoDate: string;
  sizeBytes: number;
  sizeHuman: string;
}

interface BackupManifest {
  schemaVersion: number;
  backupTimestamp: string;
  appVersion: string;
  tables: Record<string, number>;
}

// ── Constants ───────────────────────────────────────────────────────────

const TABLE_LABELS: Record<string, string> = {
  app_profile: 'App Profile',
  ai_settings: 'AI Settings',
  accounts: 'Accounts',
  settings: 'Settings',
  market_data_settings: 'Market Data Settings',
  schwab_tokens: 'Schwab Tokens',
  instruments: 'Instruments',
  accounting_executions: 'Accounting Executions',
  account_positions: 'Account Positions',
  account_performance: 'Account Performance',
  valuation_marks: 'Valuation Marks',
  fifo_lots: 'FIFO Lots',
  financial_events: 'Financial Events',
  ledger_entries: 'Ledger Entries',
  ledger_postings: 'Ledger Postings',
  lot_matches: 'Lot Matches',
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
  alert_log: 'Alert Log',
};

// ── Helpers ─────────────────────────────────────────────────────────────

export function formatBackupDate(iso: string, timezone?: string): string {
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

// ── Component ───────────────────────────────────────────────────────────

export default function RestoreModal({ onClose, initialFile }: { onClose: () => void; initialFile?: BackupFileEntry }) {
  const router = useRouter();
  const { timezone } = useAppTimezone();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [step, setStep] = useState<RestoreStep>(initialFile ? 'confirm' : 'upload');
  const [previewData, setPreviewData] = useState<{ manifest: BackupManifest } | null>(null);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'upload' | 'server'>(initialFile ? 'server' : 'upload');
  const [serverFiles, setServerFiles] = useState<BackupFileEntry[]>([]);
  const [serverFilesLoading, setServerFilesLoading] = useState(false);
  const [serverFilesError, setServerFilesError] = useState('');
  const [selectedServerFile, setSelectedServerFile] = useState<BackupFileEntry | null>(initialFile ?? null);

  const [errorMessage, setErrorMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (step === 'confirm' && confirmInputRef.current) {
      confirmInputRef.current.focus();
    }
  }, [step]);

  useEffect(() => {
    if (step !== 'browse') return;
    let cancelled = false;

    fetch('/api/backup/files')
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error('Failed to fetch backup files');
        return res.json() as Promise<BackupFileEntry[]>;
      })
      .then((files) => {
        if (cancelled) return;
        if (!files) return;
        setServerFiles(files);
        setServerFilesLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setServerFilesError(err instanceof Error ? err.message : 'Failed to load backup files');
        setServerFilesLoading(false);
      });

    return () => { cancelled = true; };
  }, [step]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const previewSelectedFile = useCallback(async (file: File) => {
    setBackupFile(file);
    setErrorMessage('');
    setIsUploading(true);

    const formData = new FormData();
    formData.append('backup', file);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/restore/preview', {
        method: 'POST', body: formData, signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || 'Failed to preview backup';
        setErrorMessage(message);
        setStep('error');
        return;
      }
      setPreviewData(data);
      setStep('confirm');
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Network error during upload';
      console.error('RestoreModal preview error', message);
      setErrorMessage(message);
      setStep('error');
    } finally {
      setIsUploading(false);
      abortRef.current = null;
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void previewSelectedFile(file);
  }, [previewSelectedFile]);

  const handleRestore = async () => {
    if (mode === 'upload') {
      if (!backupFile) return;
      setStep('restoring'); setErrorMessage('');
      const formData = new FormData();
      formData.append('backup', backupFile);
      try {
        const res = await fetch('/api/restore', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) { setErrorMessage(data.error || 'Restore failed'); setStep('error'); return; }
        setStep('success');
        setTimeout(() => router.push('/'), 2000);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Network error during restore');
        setStep('error');
      }
    } else {
      if (!selectedServerFile) return;
      setStep('restoring'); setErrorMessage('');
      try {
        const res = await fetch(`/api/backup/restore/${encodeURIComponent(selectedServerFile.filename)}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { setErrorMessage(data.error || 'Restore failed'); setStep('error'); return; }
        setStep('success');
        setTimeout(() => router.push('/'), 2000);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Network error during restore');
        setStep('error');
      }
    }
  };

  const handleSwitchMode = (newMode: 'upload' | 'server') => {
    if (newMode === mode) return;
    setMode(newMode);
    if (newMode === 'server') { setStep('browse'); setServerFilesLoading(true); setServerFilesError(''); }
    else { setStep('upload'); }
    setErrorMessage(''); setSelectedServerFile(null); setConfirmText('');
  };

  const handleRetry = () => {
    if (mode === 'server') { setStep('browse'); setErrorMessage(''); setSelectedServerFile(null); setConfirmText(''); }
    else { setStep('upload'); setErrorMessage(''); setPreviewData(null); setBackupFile(null); setConfirmText(''); }
  };

  const handleGoBack = () => {
    if (step === 'confirm' && mode === 'upload') { setStep('upload'); setConfirmText(''); }
    else if (step === 'confirm' && mode === 'server') { setStep('browse'); setConfirmText(''); setSelectedServerFile(null); }
    else if (step === 'error') { handleRetry(); }
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
        <button onClick={handleClose} className="absolute right-4 top-4 rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" aria-label="Close restore modal">
          <X className="size-5" />
        </button>

        {/* File input overlaid on the visual button — native click hits input directly,
            preserving user gesture in all browsers including Brave. No programmatic .click() needed. */}
        <div className="mb-4" style={{ display: step === 'upload' ? 'block' : 'none' }}>
          <div className="relative">
            <input
              ref={fileInputRef}
              id="backup-upload-file"
              type="file"
              accept=".zip"
              className="absolute inset-0 z-10 cursor-pointer opacity-0"
              aria-label="Select backup ZIP file"
              onChange={handleFileChange}
            />
            <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-zinc-300 px-6 py-8 text-center hover:border-zinc-400 dark:border-zinc-600 dark:hover:border-zinc-500">
              <Upload className="size-10 text-zinc-400" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Choose a backup ZIP file</p>
                <p className="mt-1 text-xs text-zinc-400">Only .zip files exported from this journal are supported</p>
              </div>
            </div>
          </div>
        </div>


        {(step === 'upload' || step === 'browse') && (
          <div className="mb-5 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            <button onClick={() => handleSwitchMode('upload')} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'upload' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>
              Upload a backup file
            </button>
            <button onClick={() => handleSwitchMode('server')} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'server' ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>
              Browse scheduled backups
            </button>
          </div>
        )}

        {step === 'browse' && (
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Browse Scheduled Backups</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Select a server-side backup file to restore.</p>
            {serverFilesLoading ? (
              <div className="mt-6 flex flex-col items-center gap-3 py-8"><Loader2 className="size-8 animate-spin text-zinc-400" /><p className="text-sm text-zinc-600 dark:text-zinc-300">Loading backup files...</p></div>
            ) : serverFilesError ? (
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span className="flex-1">{serverFilesError}</span></div>
            ) : serverFiles.length === 0 ? (
              <div className="mt-6 flex flex-col items-center gap-2 py-8"><Clock className="size-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1.5} /><p className="text-sm text-zinc-500 dark:text-zinc-400">No scheduled backups found.</p></div>
            ) : (
              <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                    <tr><th className="px-3 py-2 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300">Backup Date</th><th className="px-3 py-2 text-right text-xs font-medium text-zinc-600 dark:text-zinc-300">Size</th><th className="w-20 px-3 py-2 text-right text-xs font-medium text-zinc-600 dark:text-zinc-300">Action</th></tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {serverFiles.map((file) => (
                      <tr key={file.filename} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/30 ${selectedServerFile?.filename === file.filename ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                        <td className="px-3 py-2.5 text-zinc-700 dark:text-zinc-300"><div className="flex items-center gap-2"><Clock className="size-3.5 shrink-0 text-zinc-400" strokeWidth={1.5} /><span>{formatBackupDate(file.isoDate, timezone)}</span></div></td>
                        <td className="px-3 py-2.5 text-right text-zinc-500 dark:text-zinc-400">{file.sizeHuman}</td>
                        <td className="px-3 py-2.5 text-right">
                          <button onClick={() => { setSelectedServerFile(file); setStep('confirm'); setConfirmText(''); }} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200">Restore</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-5 flex items-center justify-end">
              <button onClick={handleClose} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">Close</button>
            </div>
          </div>
        )}

        {step === 'upload' && (
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Restore from Backup</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Upload a backup ZIP file to restore your journal data. This will replace all existing data.</p>

            {errorMessage && (
              <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span className="flex-1">{errorMessage}</span>
                </div>
                <button onClick={handleRetry} className="mt-2 ml-6 text-xs font-medium text-red-600 underline underline-offset-2 hover:text-red-500 dark:text-red-300">Retry</button>
              </div>
            )}
            {isUploading ? (
              <div className="mt-6 flex flex-col items-center gap-3 py-8"><Loader2 className="size-8 animate-spin text-zinc-400" /><p className="text-sm text-zinc-600 dark:text-zinc-300">Uploading and validating backup...</p></div>
            ) : (
              <div className="mt-6">
                <p className="text-xs text-zinc-400">Use the file selector above to choose a backup ZIP file. Only .zip files exported from this journal are supported.</p>
              </div>
            )}
          </div>
        )}

        {step === 'preview' && previewData && (
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Backup Preview</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Review the backup contents before restoring.</p>
            <div className="mt-4 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Backup Date</span><span className="text-sm text-zinc-900 dark:text-zinc-100">{formatBackupDate(previewData.manifest.backupTimestamp, timezone)}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Schema Version</span><span className="text-sm text-zinc-900 dark:text-zinc-100">v{previewData.manifest.schemaVersion}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">App Version</span><span className="text-sm text-zinc-900 dark:text-zinc-100">{previewData.manifest.appVersion}</span></div>
            </div>
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800"><tr><th className="px-3 py-2 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300">Table</th><th className="px-3 py-2 text-right text-xs font-medium text-zinc-600 dark:text-zinc-300">Rows</th></tr></thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {Object.entries(previewData.manifest.tables).map(([tableName, count]) => (
                    <tr key={tableName} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30"><td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">{TABLE_LABELS[tableName] ?? tableName}</td><td className="px-3 py-1.5 text-right text-zinc-600 dark:text-zinc-400">{count < 0 ? 'Error' : count.toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-5 flex items-center justify-end gap-3"><button onClick={handleClose} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button><button onClick={() => setStep('confirm')} className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200">Restore</button></div>
          </div>
        )}

        {step === 'confirm' && (
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Backup uploaded. Confirm restore.</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">The backup ZIP was uploaded and validated successfully.</p>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Restoring will permanently replace ALL existing data in your journal with the data from the backup. This action cannot be undone.</span></div>
            
            {previewData && (
              <div className="mt-3 space-y-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
                <div className="flex items-center justify-between"><span className="text-zinc-500">Backup date</span><span className="text-zinc-700 dark:text-zinc-300">{formatBackupDate(previewData.manifest.backupTimestamp, timezone)}</span></div>
                <div className="flex items-center justify-between"><span className="text-zinc-500">Schema version</span><span className="text-zinc-700 dark:text-zinc-300">v{previewData.manifest.schemaVersion}</span></div>
                <div className="flex items-center justify-between"><span className="text-zinc-500">Tables</span><span className="text-zinc-700 dark:text-zinc-300">{Object.keys(previewData.manifest.tables).length}</span></div>
              </div>
            )}

            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Type <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">RESTORE</span> to confirm:</p>
            <input ref={confirmInputRef} type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type RESTORE to confirm" placeholder="Type RESTORE to confirm" className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-red-500 dark:focus:ring-red-900/30" autoComplete="off" spellCheck={false} />
            <div className="mt-5 flex items-center justify-end gap-3"><button onClick={handleGoBack} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</button><button onClick={handleRestore} disabled={confirmText !== 'RESTORE'} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600">Confirm Restore</button></div>
          </div>
        )}

        {step === 'restoring' && (
          <div className="flex flex-col items-center py-8"><Loader2 className="size-10 animate-spin text-zinc-400" /><p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">Restoring...</p><p className="mt-1 text-xs text-zinc-400">Please wait while your journal data is being restored.</p></div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center py-8"><CircleCheck className="size-12 text-emerald-600 dark:text-emerald-400" /><p className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-50">Restore Complete</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">Your journal has been restored. Redirecting to dashboard...</p></div>
        )}

        {step === 'error' && (
          <div>
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">Restore Failed</h2>
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{errorMessage || 'An unexpected error occurred during restore.'}</span></div>
            {errorMessage != null && errorMessage.includes('Schema version mismatch') && (
              <div role="alert" className="mt-2 ml-6 text-xs text-red-600 dark:text-red-400">
                The database schema has changed since this backup was created.
                Create a new backup from the current app (Backup Now) or upload a newer backup file.
                Run <code className="rounded bg-red-100 px-1 dark:bg-red-900/50">make seed-settings</code> to regenerate the seed file.
              </div>
            )}
            {errorMessage != null && errorMessage.includes('Cannot restore while trades are open') && (
              <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>Close all open trades in the Trade Log first, then try restoring again.</span>
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-3"><button onClick={handleClose} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">Close</button><button onClick={handleRetry} className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200">Try Again</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
