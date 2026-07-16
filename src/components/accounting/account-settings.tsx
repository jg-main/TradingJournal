'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ── Types ───────────────────────────────────────────────────────────────

interface AccountData {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
  startingBalance: number | null;
}

interface GlobalSettings {
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
  startingAccountValue: number | null;
}

interface AccountSettingsProps {
  /** Account ID used to fetch and update account settings. */
  accountId: string;
}

type MessageType = 'success' | 'error' | null;

// ── Helpers ─────────────────────────────────────────────────────────────

function formatCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v}%`;
}

// ── Component ──────────────────────────────────────────────────────────

export default function AccountSettings({ accountId }: AccountSettingsProps) {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: MessageType; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Form state ──────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [maxRisk, setMaxRisk] = useState('');
  const [commission, setCommission] = useState('');
  const [startBal, setStartBal] = useState('');

  // Track whether each nullable field was explicitly cleared (null)
  const [clearMaxRisk, setClearMaxRisk] = useState(false);
  const [clearCommission, setClearCommission] = useState(false);
  const [clearStartBal, setClearStartBal] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // ── Data loading ────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const [acctRes, settingsRes] = await Promise.all([
        fetch(`/api/accounts/${accountId}`),
        fetch('/api/settings'),
      ]);

      // Handle account not found
      if (!acctRes.ok) {
        setError('Account not found.');
        return;
      }

      const acctData = (await acctRes.json()) as AccountData;
      setAccount(acctData);

      // Populate form fields from account data.
      // Nullable fields initialize to "use global default" (clear* = true) when NULL.
      setName(acctData.name);
      setMaxRisk(acctData.maxRiskPerTradePct != null ? String(acctData.maxRiskPerTradePct) : '');
      setCommission(acctData.defaultCommission != null ? String(acctData.defaultCommission) : '');
      setStartBal(acctData.startingBalance != null ? String(acctData.startingBalance) : '');
      setClearMaxRisk(acctData.maxRiskPerTradePct === null);
      setClearCommission(acctData.defaultCommission === null);
      setClearStartBal(acctData.startingBalance === null);
      setNameError(null);

      // Load global settings (best-effort)
      if (settingsRes.ok) {
        const settingsData = (await settingsRes.json()) as GlobalSettings;
        setGlobalSettings(settingsData);
      }
    } catch {
      setError('Failed to load account data.');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);

  // ── Toggle for nullable fields ──────────────────────────────────────
  // When currently in "use global" mode (field is cleared), restore the
  // original account value.  When in per-account mode, clear to use global.
  const handleToggleDefault = (
    field: 'maxRisk' | 'commission' | 'startBal',
  ) => {
    const isClear = field === 'maxRisk' ? clearMaxRisk
      : field === 'commission' ? clearCommission
      : clearStartBal;

    if (isClear) {
      // Switch back to per-account value (if one exists) or enable manual entry
      const originalValue = field === 'maxRisk'
        ? account?.maxRiskPerTradePct
        : field === 'commission'
          ? account?.defaultCommission
          : account?.startingBalance;

      if (field === 'maxRisk') {
        if (originalValue != null) setMaxRisk(String(originalValue));
        setClearMaxRisk(false);
      } else if (field === 'commission') {
        if (originalValue != null) setCommission(String(originalValue));
        setClearCommission(false);
      } else {
        if (originalValue != null) setStartBal(String(originalValue));
        setClearStartBal(false);
      }
    } else {
      // Clear to use global default
      if (field === 'maxRisk') {
        setMaxRisk('');
        setClearMaxRisk(true);
      } else if (field === 'commission') {
        setCommission('');
        setClearCommission(true);
      } else {
        setStartBal('');
        setClearStartBal(true);
      }
    }
  };

  const handleFieldChange = (
    field: 'maxRisk' | 'commission' | 'startBal',
    value: string,
  ) => {
    if (field === 'maxRisk') {
      setMaxRisk(value);
      setClearMaxRisk(value === '');
    } else if (field === 'commission') {
      setCommission(value);
      setClearCommission(value === '');
    } else {
      setStartBal(value);
      setClearStartBal(value === '');
    }
  };

  // ── Save handler ────────────────────────────────────────────────────
  const handleSave = async () => {
    // Validate name
    if (!name.trim()) {
      setNameError('Account name is required.');
      return;
    }
    setNameError(null);
    setSaving(true);
    setMessage(null);

    try {
      const body: Record<string, unknown> = { name: name.trim() };

      // Only include nullable fields when they have a value or were explicitly cleared
      // to avoid sending unnecessary updates.
      if (clearMaxRisk) {
        body.maxRiskPerTradePct = null;
      } else if (maxRisk !== '') {
        body.maxRiskPerTradePct = parseFloat(maxRisk);
      }

      if (clearCommission) {
        body.defaultCommission = null;
      } else if (commission !== '') {
        body.defaultCommission = parseFloat(commission);
      }

      if (clearStartBal) {
        body.startingBalance = null;
      } else if (startBal !== '') {
        body.startingBalance = parseFloat(startBal);
      }

      const res = await fetch(`/api/accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;

      if (!res.ok) {
        const errMsg =
          typeof data?.error === 'string'
            ? data.error
            : typeof data?.details === 'string'
              ? data.details
              : 'Failed to save settings.';
        setMessage({ type: 'error', text: errMsg });
        return;
      }

      setMessage({ type: 'success', text: 'Settings saved successfully.' });

      // Reload the account to reflect saved values
      const updatedRes = await fetch(`/api/accounts/${accountId}`);
      if (updatedRes.ok) {
        const updated = (await updatedRes.json()) as AccountData;
        setAccount(updated);
        setName(updated.name);
        setMaxRisk(updated.maxRiskPerTradePct != null ? String(updated.maxRiskPerTradePct) : '');
        setCommission(updated.defaultCommission != null ? String(updated.defaultCommission) : '');
        setStartBal(updated.startingBalance != null ? String(updated.startingBalance) : '');
        setClearMaxRisk(updated.maxRiskPerTradePct === null);
        setClearCommission(updated.defaultCommission === null);
        setClearStartBal(updated.startingBalance === null);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-200 p-8 text-center dark:border-zinc-800">
        <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading settings...</p>
      </div>
    );
  }

  // ── Error / not-found state ────────────────────────────────────────
  if (!account || error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-900/20">
        <AlertTriangle className="mx-auto mb-2 size-5 text-red-500" />
        <p className="text-sm text-red-700 dark:text-red-400">{error ?? 'Account not found.'}</p>
        <button
          onClick={fetchData}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          <RefreshCw className="size-3" />
          Retry
        </button>
      </div>
    );
  }

  // ── Derived defaults ───────────────────────────────────────────────
  const globalMaxRisk = globalSettings?.maxRiskPerTradePct ?? null;
  const globalCommission = globalSettings?.defaultCommission ?? null;
  const globalStartBal = globalSettings?.startingAccountValue ?? null;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Message banner ──────────────────────────────────────────── */}
      {message && (
        <div
          className={cn(
            'mb-6 rounded-lg border px-4 py-3 text-sm',
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400',
          )}
          role="alert"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <XCircle className="size-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        </div>
      )}

      {/* ── Section: Account Identity ───────────────────────────────── */}
      <section className="mb-8" aria-labelledby="settings-identity-heading">
        <h2
          id="settings-identity-heading"
          className="flex items-center gap-2 text-sm font-semibold tracking-wider text-zinc-600 dark:text-zinc-300 uppercase"
        >
          <Settings className="size-4" />
          Account Identity
        </h2>

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          {/* Status display */}
          <div className="mb-5 flex items-center gap-3">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Status:</span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                account.isActive
                  ? 'border border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'border border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              {account.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* Name field */}
          <div className="mb-5">
            <label
              htmlFor="settings-account-name"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300"
            >
              Account Name
            </label>
            <Input
              id="settings-account-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="e.g. Main Brokerage"
              aria-required="true"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'settings-name-error' : undefined}
            />
            {nameError && (
              <p id="settings-name-error" className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">
                {nameError}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Section: Trading Defaults ────────────────────────────────── */}
      <section className="mb-8" aria-labelledby="settings-defaults-heading">
        <h2
          id="settings-defaults-heading"
          className="flex items-center gap-2 text-sm font-semibold tracking-wider text-zinc-600 dark:text-zinc-300 uppercase"
        >
          <Settings className="size-4" />
          Trading Defaults
        </h2>

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          {/* Max Risk Per Trade */}
          <div className="mb-5">
            <label
              htmlFor="settings-max-risk"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300"
            >
              Max Risk Per Trade (%)
            </label>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <Input
                  id="settings-max-risk"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={maxRisk}
                  onChange={(e) => handleFieldChange('maxRisk', e.target.value)}
                  placeholder={clearMaxRisk ? '' : 'e.g. 2'}
                  aria-describedby={
                    clearMaxRisk && globalMaxRisk !== null
                      ? 'settings-max-risk-default'
                      : undefined
                  }
                />
                {clearMaxRisk && globalMaxRisk !== null && (
                  <p
                    id="settings-max-risk-default"
                    className="mt-1 text-xs text-zinc-500 dark:text-zinc-400"
                  >
                    Using global default: {formatPct(globalMaxRisk)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleToggleDefault('maxRisk')}
                className={cn(
                  'mt-1 shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  clearMaxRisk
                    ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    : 'border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                )}
                aria-label={clearMaxRisk ? 'Switch to per-account value' : 'Clear max risk per trade to use global default'}
              >
                {clearMaxRisk ? 'Per-account value' : 'Use global default'}
              </button>
            </div>
          </div>

          {/* Default Commission */}
          <div className="mb-5">
            <label
              htmlFor="settings-default-commission"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300"
            >
              Default Commission ($)
            </label>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <Input
                  id="settings-default-commission"
                  type="number"
                  step="0.01"
                  min="0"
                  value={commission}
                  onChange={(e) => handleFieldChange('commission', e.target.value)}
                  placeholder={clearCommission ? '' : 'e.g. 0.50'}
                  aria-describedby={
                    clearCommission && globalCommission !== null
                      ? 'settings-commission-default'
                      : undefined
                  }
                />
                {clearCommission && globalCommission !== null && (
                  <p
                    id="settings-commission-default"
                    className="mt-1 text-xs text-zinc-500 dark:text-zinc-400"
                  >
                    Using global default: ${formatCurrency(globalCommission)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleToggleDefault('commission')}
                className={cn(
                  'mt-1 shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  clearCommission
                    ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    : 'border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                )}
                aria-label={clearCommission ? 'Switch to per-account commission' : 'Clear default commission to use global default'}
              >
                {clearCommission ? 'Per-account value' : 'Use global default'}
              </button>
            </div>
          </div>

          {/* Starting Balance */}
          <div className="mb-5">
            <label
              htmlFor="settings-starting-balance"
              className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300"
            >
              Starting Balance ($)
            </label>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <Input
                  id="settings-starting-balance"
                  type="number"
                  step="0.01"
                  min="0"
                  value={startBal}
                  onChange={(e) => handleFieldChange('startBal', e.target.value)}
                  placeholder={clearStartBal ? '' : 'e.g. 50000'}
                  aria-describedby={
                    clearStartBal && globalStartBal !== null
                      ? 'settings-start-bal-default'
                      : undefined
                  }
                />
                {clearStartBal && globalStartBal !== null && (
                  <p
                    id="settings-start-bal-default"
                    className="mt-1 text-xs text-zinc-500 dark:text-zinc-400"
                  >
                    Using global default: ${formatCurrency(globalStartBal)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleToggleDefault('startBal')}
                className={cn(
                  'mt-1 shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  clearStartBal
                    ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    : 'border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                )}
                aria-label={clearStartBal ? 'Switch to per-account starting balance' : 'Clear starting balance to use global default'}
              >
                {clearStartBal ? 'Per-account value' : 'Use global default'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Save Actions ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={saving}
          size="default"
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
        <Button
          variant="outline"
          onClick={fetchData}
          disabled={saving}
          size="default"
        >
          <RefreshCw className="size-3.5" />
          Discard changes
        </Button>
      </div>
    </div>
  );
}
