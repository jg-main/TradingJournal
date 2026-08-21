'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Settings,
  TriangleAlert,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { resolveAccountDefault, type EffectiveAccountDefault } from '@/lib/account-defaults';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

// ── Types ───────────────────────────────────────────────────────────────

interface AccountData {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
}

interface GlobalSettings {
  maxRiskPerTradePct?: number | null;
  defaultCommission?: number | null;
}

interface ClosureSummary {
  accountId: string;
  accountName: string;
  startingBalance: number;
  depositsTotal: number;
  withdrawalsTotal: number;
  realizedPnl: number;
  finalBalance: number;
  netReturn: number | null;
  kpis: {
    tradeCount: number;
    netPnl: number;
    winRate: number | null;
    avgR: number | null;
    avgGrade: number | null;
  };
  datesActive: {
    from: string;
    to: string;
  };
  closedAt: string;
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

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isAccountData(value: unknown): value is AccountData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AccountData>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    (typeof candidate.broker === 'string' || candidate.broker === null) &&
    typeof candidate.currency === 'string' &&
    typeof candidate.isActive === 'boolean' &&
    isNullableFiniteNumber(candidate.maxRiskPerTradePct) &&
    isNullableFiniteNumber(candidate.defaultCommission)
  );
}

function EffectiveDefaultStatus({
  label,
  result,
  formatValue,
}: {
  label: string;
  result: EffectiveAccountDefault;
  formatValue: (value: number) => string;
}) {
  const status = result.source === 'overridden'
    ? 'Overridden'
    : result.source === 'inherited'
      ? 'Inherited'
      : 'Unavailable';

  return (
    <div
      role="status"
      aria-label={label}
      className="mt-2 rounded-md border border-border bg-muted px-3 py-2"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">Effective default</span>
        <Badge
          variant="outline"
          className={cn(
            'tabular-nums',
            result.source === 'overridden' && 'border-info/40 text-info',
            result.source === 'inherited' && 'border-positive/40 text-positive',
            result.source === 'unavailable' && 'border-warning/40 text-warning',
          )}
        >
          {status}
        </Badge>
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {result.source === 'unavailable'
          ? 'Effective value unavailable'
          : `Effective value: ${formatValue(result.value)}`}
      </p>
    </div>
  );
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
  const [broker, setBroker] = useState('');
  const [maxRisk, setMaxRisk] = useState('');
  const [commission, setCommission] = useState('');

  // Track whether each nullable field was explicitly cleared (null)
  const [clearMaxRisk, setClearMaxRisk] = useState(false);
  const [clearCommission, setClearCommission] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // ── Data loading ────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    setGlobalSettings(null);

    try {
      const [accountResult, settingsResult] = await Promise.allSettled([
        fetch(`/api/accounts/${accountId}`),
        fetch('/api/settings'),
      ]);

      if (accountResult.status === 'rejected' || !accountResult.value) {
        setError('Failed to load account data.');
        return;
      }

      const acctRes = accountResult.value;
      if (!acctRes.ok) {
        setError(acctRes.status === 404 ? 'Account not found.' : 'Failed to load account data.');
        return;
      }

      const acctData: unknown = await acctRes.json();
      if (!isAccountData(acctData)) {
        setError('Failed to load account data.');
        return;
      }

      setAccount(acctData);
      setName(acctData.name);
      setBroker(acctData.broker ?? '');
      setMaxRisk(acctData.maxRiskPerTradePct !== null ? String(acctData.maxRiskPerTradePct) : '');
      setCommission(acctData.defaultCommission !== null ? String(acctData.defaultCommission) : '');
      setClearMaxRisk(acctData.maxRiskPerTradePct === null);
      setClearCommission(acctData.defaultCommission === null);
      setNameError(null);

      // Global settings are optional context. Account overrides remain useful if
      // this request fails, while inherited fields resolve to Unavailable.
      if (settingsResult.status === 'fulfilled' && settingsResult.value?.ok) {
        try {
          const rawSettings: unknown = await settingsResult.value.json();
          if (rawSettings && typeof rawSettings === 'object') {
            const candidate = rawSettings as Record<string, unknown>;
            const settingsData: GlobalSettings = {};
            if (isNullableFiniteNumber(candidate.maxRiskPerTradePct)) {
              settingsData.maxRiskPerTradePct = candidate.maxRiskPerTradePct;
            }
            if (isNullableFiniteNumber(candidate.defaultCommission)) {
              settingsData.defaultCommission = candidate.defaultCommission;
            }
            setGlobalSettings(settingsData);
          }
        } catch {
          // Per-field Unavailable status is the observable fallback.
        }
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
  const handleToggleDefault = (field: 'maxRisk' | 'commission') => {
    const isClear = field === 'maxRisk' ? clearMaxRisk : clearCommission;

    if (isClear) {
      // Switch back to per-account value (if one exists) or enable manual entry
      const originalValue = field === 'maxRisk'
        ? account?.maxRiskPerTradePct
        : account?.defaultCommission;

      if (field === 'maxRisk') {
        if (originalValue != null) setMaxRisk(String(originalValue));
        setClearMaxRisk(false);
      } else {
        if (originalValue != null) setCommission(String(originalValue));
        setClearCommission(false);
      }
    } else {
      // Clear to use global default
      if (field === 'maxRisk') {
        setMaxRisk('');
        setClearMaxRisk(true);
      } else {
        setCommission('');
        setClearCommission(true);
      }
    }
  };

  const handleFieldChange = (field: 'maxRisk' | 'commission', value: string) => {
    if (field === 'maxRisk') {
      setMaxRisk(value);
      setClearMaxRisk(value === '');
    } else {
      setCommission(value);
      setClearCommission(value === '');
    }
  };

  // ── Lifecycle state ──────────────────────────────────────────────────
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closureSummary, setClosureSummary] = useState<ClosureSummary | null>(null);
  const [actionPending, setActionPending] = useState<'deactivate' | 'reactivate' | 'delete' | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCloseAccount = async () => {
    setIsClosing(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/accounts/${accountId}/close`, { method: 'POST' });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to close account' }));
        setMessage({ type: 'error', text: err.error ?? err.details ?? 'Failed to close account.' });
        setIsClosing(false);
        return;
      }

      const data = (await res.json()) as ClosureSummary;
      setClosureSummary(data);
      setCloseDialogOpen(false);

      // Refresh account data to reflect inactive state
      await fetchData();
    } catch {
      setMessage({ type: 'error', text: 'Failed to close account.' });
    } finally {
      setIsClosing(false);
    }
  };

  const handleReactivateAccount = async () => {
    setActionPending('reactivate');
    setMessage(null);

    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const errMsg =
          typeof data?.error === 'string'
            ? data.error
            : typeof data?.details === 'string'
              ? data.details
              : 'Failed to reactivate account.';
        setMessage({ type: 'error', text: errMsg });
        return;
      }

      setMessage({ type: 'success', text: 'Account reactivated.' });
      await fetchData();
    } catch {
      setMessage({ type: 'error', text: 'Failed to reactivate account.' });
    } finally {
      setActionPending(null);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const errMsg =
          typeof data?.error === 'string'
            ? data.error
            : typeof data?.details === 'string'
              ? data.details
              : 'Failed to delete account.';
        setMessage({ type: 'error', text: errMsg });
        setIsDeleting(false);
        return;
      }

      // Navigate to accounts list after successful deletion
      setDeleteDialogOpen(false);
      window.location.href = '/settings/accounts';
    } catch {
      setMessage({ type: 'error', text: 'Failed to delete account.' });
      setIsDeleting(false);
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

      // Broker is a plain nullable field: empty input clears the reference.
      body.broker = broker.trim() === '' ? null : broker.trim();

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

      const res = await fetch(`/api/accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const errorData = data && typeof data === 'object'
          ? data as Record<string, unknown>
          : null;
        const errMsg =
          typeof errorData?.error === 'string'
            ? errorData.error
            : typeof errorData?.details === 'string'
              ? errorData.details
              : 'Failed to save settings.';
        setMessage({ type: 'error', text: errMsg });
        return;
      }

      if (!isAccountData(data)) {
        setMessage({ type: 'error', text: 'The server returned an invalid account response.' });
        return;
      }

      // Commit persisted state only from the successful validated response.
      setAccount(data);
      setName(data.name);
      setBroker(data.broker ?? '');
      setMaxRisk(data.maxRiskPerTradePct !== null ? String(data.maxRiskPerTradePct) : '');
      setCommission(data.defaultCommission !== null ? String(data.defaultCommission) : '');
      setClearMaxRisk(data.maxRiskPerTradePct === null);
      setClearCommission(data.defaultCommission === null);
      setMessage({ type: 'success', text: 'Settings saved successfully.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-border p-8 text-center"
      >
        <RefreshCw aria-hidden="true" className="mx-auto mb-2 size-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  // ── Error / not-found state ────────────────────────────────────────
  if (!account || error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center"
      >
        <AlertTriangle aria-hidden="true" className="mx-auto mb-2 size-5 text-destructive" />
        <p className="text-sm text-destructive">{error ?? 'Account not found.'}</p>
        <Button type="button" variant="outline" size="sm" onClick={fetchData} className="mt-3">
          <RefreshCw aria-hidden="true" className="size-3" />
          Retry
        </Button>
      </div>
    );
  }

  // ── Derived defaults ───────────────────────────────────────────────
  const effectiveMaxRisk = resolveAccountDefault(
    account.maxRiskPerTradePct,
    globalSettings?.maxRiskPerTradePct,
  );
  const effectiveCommission = resolveAccountDefault(
    account.defaultCommission,
    globalSettings?.defaultCommission,
  );

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Message banner ──────────────────────────────────────────── */}
      {message && (
        <div
          className={cn(
            'mb-6 rounded-lg border px-4 py-3 text-sm',
            message.type === 'success'
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-destructive/30 bg-destructive/10 text-destructive',
          )}
          role={message.type === 'success' ? 'status' : 'alert'}
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
          className="flex items-center gap-2 text-sm font-semibold tracking-wider text-muted-foreground uppercase"
        >
          <Settings className="size-4" />
          Account Identity
        </h2>

        <div className="mt-4 rounded-lg border border-border bg-card p-6">
          {/* Status display */}
          <div className="mb-5 flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">Status:</span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                account.isActive
                  ? 'border border-positive/40 bg-positive/10 text-positive'
                  : 'border border-border bg-muted text-muted-foreground',
              )}
            >
              {account.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* Name field */}
          <div className="mb-5">
            <label
              htmlFor="settings-account-name"
              className="mb-1.5 block text-xs font-medium text-foreground"
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
              <p id="settings-name-error" className="mt-1 text-xs text-destructive" role="alert">
                {nameError}
              </p>
            )}
          </div>

          {/* Broker field */}
          <div className="mb-5">
            <label
              htmlFor="settings-account-broker"
              className="mb-1.5 block text-xs font-medium text-foreground"
            >
              Broker
            </label>
            <Input
              id="settings-account-broker"
              value={broker}
              onChange={(e) => setBroker(e.target.value)}
              placeholder="e.g. Interactive Brokers"
              maxLength={200}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. Saving an empty broker clears the stored reference.
            </p>
          </div>

          {/* Base currency — read-only, set at creation (D4) */}
          <div>
            <label
              htmlFor="settings-account-currency"
              className="mb-1.5 block text-xs font-medium text-foreground"
            >
              Base Currency
            </label>
            <Input
              id="settings-account-currency"
              value={account.currency}
              disabled
              aria-describedby="settings-currency-hint"
            />
            <p id="settings-currency-hint" className="mt-1 text-xs text-muted-foreground">
              Base currency is set when the account is created and cannot be changed from settings.
            </p>
          </div>
        </div>
      </section>

      {/* ── Section: Trading Defaults ────────────────────────────────── */}
      <section className="mb-8" aria-labelledby="settings-defaults-heading">
        <h2
          id="settings-defaults-heading"
          className="flex items-center gap-2 text-sm font-semibold tracking-wider text-muted-foreground uppercase"
        >
          <Settings className="size-4" />
          Trading Defaults
        </h2>

        <div className="mt-4 rounded-lg border border-border bg-card p-6">
          <p className="mb-5 text-xs text-muted-foreground">
            Opening cash is recorded as a cash transaction in the Ledger, not as an account setting.
          </p>

          {/* Max Risk Per Trade */}
          <div className="mb-5">
            <label
              htmlFor="settings-max-risk"
              className="mb-1.5 block text-xs font-medium text-foreground"
            >
              Max Risk Per Trade (%)
            </label>
            <div className="flex items-start gap-3">
              <Input
                id="settings-max-risk"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={maxRisk}
                onChange={(e) => handleFieldChange('maxRisk', e.target.value)}
                placeholder={clearMaxRisk ? '' : 'e.g. 2'}
                aria-describedby="settings-max-risk-effective"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleToggleDefault('maxRisk')}
                className="mt-0.5 shrink-0"
                aria-label={clearMaxRisk
                  ? 'Set max risk account override'
                  : 'Reset max risk to global default'}
              >
                {clearMaxRisk ? 'Set override' : 'Reset to global'}
              </Button>
            </div>
            <div id="settings-max-risk-effective">
              <EffectiveDefaultStatus
                label="Effective max risk per trade"
                result={effectiveMaxRisk}
                formatValue={formatPct}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {clearMaxRisk
                  ? 'Saving will store no account override and use the global value when available.'
                  : 'Saving will store this value as the account override.'}
              </p>
            </div>
          </div>

          {/* Default Commission */}
          <div className="mb-5">
            <label
              htmlFor="settings-default-commission"
              className="mb-1.5 block text-xs font-medium text-foreground"
            >
              Default Commission ($)
            </label>
            <div className="flex items-start gap-3">
              <Input
                id="settings-default-commission"
                type="number"
                step="0.01"
                min="0"
                value={commission}
                onChange={(e) => handleFieldChange('commission', e.target.value)}
                placeholder={clearCommission ? '' : 'e.g. 0.50'}
                aria-describedby="settings-commission-effective"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleToggleDefault('commission')}
                className="mt-0.5 shrink-0"
                aria-label={clearCommission
                  ? 'Set commission account override'
                  : 'Reset commission to global default'}
              >
                {clearCommission ? 'Set override' : 'Reset to global'}
              </Button>
            </div>
            <div id="settings-commission-effective">
              <EffectiveDefaultStatus
                label="Effective default commission"
                result={effectiveCommission}
                formatValue={(value) => `$${formatCurrency(value)}`}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {clearCommission
                  ? 'Saving will store no account override and use the global value when available.'
                  : 'Saving will store this value as the account override.'}
              </p>
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

      {/* ── Lifecycle Controls ───────────────────────────────────────── */}
      <hr className="my-8 border-border" />

      <section aria-labelledby="settings-lifecycle-heading">
        <h2
          id="settings-lifecycle-heading"
          className="flex items-center gap-2 text-sm font-semibold tracking-wider text-muted-foreground uppercase"
        >
          <AlertTriangle className="size-4" />
          Account Lifecycle
        </h2>

        {/* ── Closure Summary (shown after successful close) ────────── */}
        {closureSummary && (
          <div className="mt-4 mb-6 rounded-lg border border-positive/30 bg-positive/10 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-positive" />
              <div className="flex-1">
                <p className="text-sm font-medium text-positive">
                  Account Closed
                </p>
                <p className="mt-1 text-xs text-positive">
                  {closureSummary.accountName} closed at{' '}
                  {new Date(closureSummary.closedAt).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}. Final balance: $
                  {closureSummary.finalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  {closureSummary.netReturn !== null &&
                    ` Net return: ${closureSummary.netReturn.toFixed(2)}%.`}
                </p>
              </div>
              <button
                onClick={() => setClosureSummary(null)}
                className="shrink-0 text-xs text-positive underline hover:text-positive"
              >
                Dismiss
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-positive/30 pt-3">
              <div>
                <p className="text-xs text-positive">Starting Balance</p>
                <p className="text-sm font-semibold tabular-nums text-positive">
                  ${closureSummary.startingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-positive">Deposits</p>
                <p className="text-sm font-semibold tabular-nums text-positive">
                  ${closureSummary.depositsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-positive">Realized P&amp;L</p>
                <p className={`text-sm font-semibold tabular-nums ${
                  closureSummary.realizedPnl >= 0 ? 'text-positive' : 'text-negative'
                }`}>
                  {closureSummary.realizedPnl >= 0 ? '+' : ''}${closureSummary.realizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Active account: Close Account ────────────────────────── */}
        {account.isActive && !closureSummary && (
          <div className="mt-4 rounded-lg border border-border bg-card p-6">
            <p className="mb-3 text-xs font-medium text-muted-foreground">
              Close this account to archive it. A final balance will be computed and the account will be marked inactive.
            </p>
            <Button
              variant="destructive"
              onClick={() => { setCloseDialogOpen(true); setMessage(null); }}
            >
              <TriangleAlert className="size-4" />
              Close Account
            </Button>
          </div>
        )}

        {/* ── Inactive account: Reactivate and Delete ──────────────── */}
        {!account.isActive && (
          <div className="mt-4 rounded-lg border border-border bg-card p-6">
            <p className="mb-4 text-sm font-medium text-foreground">Account Actions</p>
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleReactivateAccount}
                disabled={actionPending === 'reactivate'}
              >
                <RotateCcw className="size-4" />
                Reactivate Account
              </Button>
              <Button
                variant="destructive"
                onClick={() => { setDeleteDialogOpen(true); setMessage(null); }}
                disabled={actionPending === 'delete'}
              >
                <Trash2 className="size-4" />
                Delete Account
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Deleting an account permanently removes it. Only accounts with no trade history can be deleted.
            </p>
          </div>
        )}
      </section>

      {/* ── Close Account Confirmation Dialog ────────────────────────── */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Account</DialogTitle>
            <DialogDescription>
              Are you sure? This will archive the account, compute final balance, and
              generate a closure summary. It cannot be undone for accounts with trade history.
              Accounts with open trades cannot be closed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)} disabled={isClosing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleCloseAccount} disabled={isClosing}>
              {isClosing ? 'Closing...' : 'Confirm Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Account Confirmation Dialog ───────────────────────── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Are you sure? This permanently removes the account and all associated transactions.
              This action cannot be undone. Only accounts with no trade history can be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Confirm Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
