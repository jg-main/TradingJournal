'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CircleCheck, CircleX, HelpCircle, Loader2, Plug, Unplug } from 'lucide-react';
import type { JSX } from 'react';

// ── Types ───────────────────────────────────────────────────────────────

interface MarketDataSettings {
  id: string;
  activeProvider: string;
  providers: Record<string, ProviderConfig | unknown>;
}

interface ProviderConfig {
  host?: string;
  port?: number;
  user?: string;
  database?: string;
}

// ── Types ───────────────────────────────────────────────────────────────

interface SchwabTokenStatus {
  connected: boolean;
  expiresAt: string | null;
  errorType?: 'not_configured' | 'token_expired';
}

type SchwabDotStatus = 'connected' | 'expiring' | 'disconnected' | 'unknown';

// ── Helpers ─────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'success' | 'error' | null }): JSX.Element {
  if (status === 'success') {
    return <CircleCheck className="size-5 text-emerald-500" aria-hidden />;
  }
  if (status === 'error') {
    return <CircleX className="size-5 text-red-500" aria-hidden />;
  }
  return <HelpCircle className="size-5 text-zinc-300 dark:text-zinc-600" aria-hidden />;
}

/**
 * Derive a 3-state dot status from a SchwabTokenStatus.
 * - 'connected': Token valid and >7 days from expiry (green)
 * - 'expiring':  Token valid but expires within 7 days (amber)
 * - 'disconnected': No valid tokens, expired, or not configured (red)
 * - 'unknown':   Status not yet loaded
 */
function getSchwabDotStatus(status: SchwabTokenStatus | null): SchwabDotStatus {
  if (!status) return 'unknown';
  if (!status.connected) return 'disconnected';

  if (status.expiresAt) {
    const expiresMs = new Date(status.expiresAt).getTime();
    const daysUntilExpiry = (expiresMs - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysUntilExpiry < 7) return 'expiring';
  }

  return 'connected';
}

/**
 * Time until expiry formatted as a human-readable string.
 */
function formatExpiryCountdown(expiresAt: string): string {
  const expiresMs = new Date(expiresAt).getTime();
  const diffMs = expiresMs - Date.now();

  if (diffMs <= 0) return 'Expired';

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) {
    return `${days}d ${hours}h remaining`;
  }
  return `${hours}h remaining`;
}

function SchwabStatusDot({ status }: { status: SchwabDotStatus }): JSX.Element {
  if (status === 'connected') {
    return <CircleCheck className="size-5 text-emerald-500" aria-hidden />;
  }
  if (status === 'expiring') {
    return <AlertTriangle className="size-5 text-amber-500" aria-hidden />;
  }
  if (status === 'unknown') {
    return <HelpCircle className="size-5 text-zinc-300 dark:text-zinc-600" aria-hidden />;
  }
  // disconnected / red
  return <CircleX className="size-5 text-red-500" aria-hidden />;
}

// ── Page ────────────────────────────────────────────────────────────────

export default function MarketDataSettingsPage() {
  const [settings, setSettings] = useState<MarketDataSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [connectionResult, setConnectionResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // ── Form State ──────────────────────────────────────────────────────

  const [activeProvider, setActiveProvider] = useState('clickhouse');
  const [chHost, setChHost] = useState('');
  const [chPort, setChPort] = useState('');
  const [chUser, setChUser] = useState('');
  const [chPassword, setChPassword] = useState('');
  const [chDatabase, setChDatabase] = useState('');

  // ── Schwab State ────────────────────────────────────────────────────

  const [schwabStatus, setSchwabStatus] = useState<SchwabTokenStatus | null>(null);
  const [schwabLoading, setSchwabLoading] = useState(false);
  const [schwabConnecting, setSchwabConnecting] = useState(false);
  const [schwabMessage, setSchwabMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Enrichment State ──────────────────────────────────────────────────

  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<{ enriched: number; errored: number; total: number; timestamp: string } | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  // ── Data Loading ────────────────────────────────────────────────────

  const loadSettings = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setMessage(null);

      const res = await fetch('/api/market-data/settings', { signal });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setMessage({ type: 'error', text: err?.error || 'Failed to load market data settings.' });
        return;
      }

      const data = (await res.json()) as MarketDataSettings;
      setSettings(data);

      if (data && data.id) {
        setActiveProvider(data.activeProvider || 'clickhouse');

        const ch = data.providers?.clickhouse as ProviderConfig | undefined;
        setChHost(ch?.host ?? '');
        setChPort(ch?.port ? String(ch.port) : '');
        setChUser(ch?.user ?? '');
        setChDatabase(ch?.database ?? '');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setMessage({ type: 'error', text: 'Failed to load market data settings.' });
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Schwab Status Loading ───────────────────────────────────────────

  const loadSchwabStatus = useCallback(async () => {
    try {
      setSchwabLoading(true);
      const res = await fetch('/api/schwab/status');
      if (!res.ok) {
        // If 500, just set disconnected rather than blocking the page
        setSchwabStatus({ connected: false, expiresAt: null });
        return;
      }
      const data = (await res.json()) as SchwabTokenStatus;
      setSchwabStatus(data);
    } catch {
      setSchwabStatus({ connected: false, expiresAt: null });
    } finally {
      setSchwabLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSettings(controller.signal);
    void loadSchwabStatus();

    // Parse OAuth callback redirect params from URL
    const params = new URLSearchParams(window.location.search);
    const schwabParam = params.get('schwab');
    if (schwabParam === 'connected') {
      setSchwabMessage({ type: 'success', text: 'Successfully connected to Schwab.' });
      // Clean the URL so reload doesn't re-show the message
      window.history.replaceState({}, '', '/settings/market-data');
    } else if (schwabParam === 'error') {
      const reason = params.get('reason') || 'unknown';
      const reasonLabels: Record<string, string> = {
        missing_code: 'No authorization code received from Schwab.',
        state_mismatch: 'CSRF validation failed. Please try connecting again.',
        connection_failed: 'Could not reach Schwab servers. Please try again.',
        exchange_failed: 'Failed to exchange authorization code for tokens.',
        not_configured: 'Schwab API credentials are missing.',
      };
      const label =
        reasonLabels[reason] || `Connection failed: ${reason.replace(/_/g, ' ')}`;
      setSchwabMessage({ type: 'error', text: label });
      window.history.replaceState({}, '', '/settings/market-data');
    }

    const handleFocus = () => {
      void loadSettings();
      void loadSchwabStatus();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadSettings();
        void loadSchwabStatus();
      }
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
  }, [loadSettings, loadSchwabStatus]);

  // ── Save Provider ───────────────────────────────────────────────────

  const handleSaveProvider = async () => {
    setSaving(true);
    setMessage(null);

    const providers: Record<string, unknown> = {};
    if (activeProvider === 'schwab' && schwabStatus?.connected) {
      providers.schwab = { configured: true };
    }

    try {
      const res = await fetch('/api/market-data/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeProvider, providers }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      const data = (await res.json()) as MarketDataSettings;
      setSettings(data);
      setMessage({ type: 'success', text: `Active provider set to ${activeProvider === 'clickhouse' ? 'ClickHouse' : 'Schwab'}.` });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save provider selection.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Save ClickHouse Config ──────────────────────────────────────────

  const handleSaveClickHouse = async () => {
    setSaving(true);
    setMessage(null);

    const clickhouseConfig: Record<string, unknown> = {};
    if (chHost) clickhouseConfig.host = chHost;
    if (chPort) clickhouseConfig.port = parseInt(chPort, 10);
    if (chUser) clickhouseConfig.user = chUser;
    if (chPassword) clickhouseConfig.password = chPassword;
    if (chDatabase) clickhouseConfig.database = chDatabase;

    try {
      const res = await fetch('/api/market-data/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providers: { clickhouse: clickhouseConfig },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      const data = (await res.json()) as MarketDataSettings;
      setSettings(data);
      setChPassword('');
      setMessage({ type: 'success', text: 'ClickHouse configuration saved.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save ClickHouse configuration.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Test Connection ─────────────────────────────────────────────────

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionResult(null);

    try {
      const res = await fetch('/api/market-data/clickhouse/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: chHost || 'localhost',
          port: chPort ? parseInt(chPort, 10) : 8123,
          user: chUser || 'default',
          password: chPassword || undefined,
          database: chDatabase || 'market',
        }),
      });

      if (res.status === 404) {
        setConnectionResult({ ok: false, error: 'Test connection endpoint not available yet.' });
        return;
      }

      const data = await res.json();
      setConnectionResult({ ok: data.ok, error: data.error });
    } catch {
      setConnectionResult({ ok: false, error: 'Failed to reach test-connection endpoint.' });
    } finally {
      setTesting(false);
    }
  };

  // ── Schwab Connect ──────────────────────────────────────────────────

  const handleConnectSchwab = async () => {
    setSchwabConnecting(true);
    setSchwabMessage(null);

    try {
      const res = await fetch('/api/schwab/auth-url');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'unknown' }));
        if (err.error === 'not_configured') {
          setSchwabMessage({
            type: 'error',
            text: 'Schwab API credentials are not configured. Set SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, and SCHWAB_REDIRECT_URI in your environment.',
          });
        } else {
          setSchwabMessage({
            type: 'error',
            text: err.message || 'Failed to generate authorization URL.',
          });
        }
        setSchwabConnecting(false);
        return;
      }

      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        setSchwabMessage({ type: 'error', text: 'Failed to get authorization URL from Schwab.' });
        setSchwabConnecting(false);
      }
    } catch {
      setSchwabMessage({ type: 'error', text: 'Failed to reach Schwab auth endpoint.' });
      setSchwabConnecting(false);
    }
  };

  // ── Schwab Disconnect ───────────────────────────────────────────────

  const handleDisconnectSchwab = async () => {
    setSchwabMessage(null);

    try {
      const res = await fetch('/api/schwab/disconnect', { method: 'POST' });
      if (!res.ok) {
        setSchwabMessage({ type: 'error', text: 'Failed to disconnect from Schwab.' });
        return;
      }

      setSchwabStatus({ connected: false, expiresAt: null });
      setSchwabMessage({ type: 'success', text: 'Disconnected from Schwab.' });
    } catch {
      setSchwabMessage({ type: 'error', text: 'Failed to reach disconnect endpoint.' });
    }
  };

  // ── Enrich Missing Profiles ──────────────────────────────────────────

  const handleEnrichProfiles = async () => {
    setEnriching(true);
    setEnrichResult(null);
    setEnrichError(null);

    try {
      const res = await fetch('/api/market-data/enrich-profiles', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to enrich profiles' }));
        setEnrichError(err.error || 'Failed to enrich profiles');
        return;
      }
      const data = await res.json();
      setEnrichResult(data);
    } catch {
      setEnrichError('Failed to reach enrichment endpoint.');
    } finally {
      setEnriching(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────

  if (loading && !settings) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Link
          href="/settings"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          Back to Settings
        </Link>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading market data settings...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" />
        Back to Settings
      </Link>

      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Market Data
      </h1>

      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        {/* ── Provider Status ─────────────────────────────────────── */}
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Provider Status</h2>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Active Provider</span>
              <div className="flex items-center gap-2">
                {activeProvider === 'schwab' && (
                  <SchwabStatusDot status={getSchwabDotStatus(schwabStatus)} />
                )}
                <select
                  value={activeProvider}
                  onChange={(e) => { setActiveProvider(e.target.value); }}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="clickhouse">ClickHouse</option>
                  <option value="schwab" disabled={!schwabStatus?.connected}>
                    Schwab{schwabStatus?.connected ? '' : ' (not connected)'}
                  </option>
                </select>
              </div>
            </div>

            {/* Save provider selection */}
            <div className="flex items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={handleSaveProvider}
                disabled={saving}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* ── ClickHouse Configuration ────────────────────────────── */}
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            ClickHouse Configuration
          </h2>
          <p className="mb-4 text-xs text-zinc-600 dark:text-zinc-400">
            Connection settings for market data database. Password is never displayed — re-enter when saving.
          </p>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Host */}
              <div>
                <label htmlFor="chHost" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Host
                </label>
                <input
                  id="chHost"
                  type="text"
                  value={chHost}
                  onChange={(e) => { setChHost(e.target.value); setConnectionResult(null); }}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                  placeholder="localhost"
                />
              </div>

              {/* Port */}
              <div>
                <label htmlFor="chPort" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Port
                </label>
                <input
                  id="chPort"
                  type="number"
                  min="1"
                  max="65535"
                  value={chPort}
                  onChange={(e) => { setChPort(e.target.value); setConnectionResult(null); }}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                  placeholder="8123"
                />
              </div>

              {/* User */}
              <div>
                <label htmlFor="chUser" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  User
                </label>
                <input
                  id="chUser"
                  type="text"
                  value={chUser}
                  onChange={(e) => { setChUser(e.target.value); setConnectionResult(null); }}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                  placeholder="default"
                />
              </div>

              {/* Database */}
              <div>
                <label htmlFor="chDatabase" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Database
                </label>
                <input
                  id="chDatabase"
                  type="text"
                  value={chDatabase}
                  onChange={(e) => { setChDatabase(e.target.value); setConnectionResult(null); }}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                  placeholder="market"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="chPassword" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Password <span className="text-xs text-zinc-400">(stored securely, never displayed)</span>
              </label>
              <input
                id="chPassword"
                type="password"
                value={chPassword}
                onChange={(e) => { setChPassword(e.target.value); setConnectionResult(null); }}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                placeholder="(unchanged)"
                autoComplete="new-password"
              />
            </div>

            {/* Save + Test ClickHouse connection */}
            <div className="flex items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={handleSaveClickHouse}
                disabled={saving}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            {connectionResult && (
              <div className="flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">Test Result</span>
                <span className={`inline-flex items-center gap-1.5 text-sm ${
                  connectionResult.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  {connectionResult.ok ? (
                    <>
                      <CircleCheck className="size-4" />
                      Connected
                    </>
                  ) : (
                    <>
                      <CircleX className="size-4" />
                      {connectionResult.error || 'Connection failed'}
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Schwab Connection ──────────────────────────────────────── */}
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Schwab Connection
          </h2>
          <p className="mb-4 text-xs text-zinc-600 dark:text-zinc-400">
            Connect your Schwab account to use Schwab as a market data provider for OHLC data and quotes.
          </p>

          {schwabMessage && (
            <div
              className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                schwabMessage.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
              }`}
            >
              {schwabMessage.text}
            </div>
          )}

          <div className="space-y-4">
            {/* Status row */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Status</span>
              <div className="flex items-center gap-2">
                {schwabLoading ? (
                  <Loader2 className="size-4 animate-spin text-zinc-400" aria-hidden />
                ) : (
                  <>
                    <SchwabStatusDot status={getSchwabDotStatus(schwabStatus)} />
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {schwabStatus === null
                        ? '...'
                        : schwabStatus.errorType === 'not_configured'
                          ? 'Not Configured'
                          : schwabStatus.errorType === 'token_expired'
                            ? 'Token Expired'
                            : schwabStatus.connected
                              ? 'Connected'
                              : 'Not Connected'}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Expiry countdown */}
            {schwabStatus?.connected && schwabStatus.expiresAt && (
              <div className="flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">Token Expiry</span>
                <span className={`text-sm font-medium ${
                  getSchwabDotStatus(schwabStatus) === 'expiring'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-zinc-700 dark:text-zinc-300'
                }`}>
                  {formatExpiryCountdown(schwabStatus.expiresAt)}
                </span>
              </div>
            )}

            {/* Configured but not connected message */}
            {schwabStatus?.errorType === 'not_configured' && (
              <div className="border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                Set <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">SCHWAB_CLIENT_ID</code>,{' '}
                <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">SCHWAB_CLIENT_SECRET</code>, and{' '}
                <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">SCHWAB_REDIRECT_URI</code>{' '}
                environment variables to enable Schwab market data.
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              {schwabStatus?.connected ? (
                <button
                  type="button"
                  onClick={handleDisconnectSchwab}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Unplug className="size-4" />
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectSchwab}
                  disabled={schwabConnecting || schwabStatus?.errorType === 'not_configured'}
                  className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {schwabConnecting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Plug className="size-4" />
                      Connect Schwab
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Enrich Missing Profiles ──────────────────────────────────── */}
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Enrich Missing Profiles
          </h2>
          <p className="mb-4 text-xs text-zinc-600 dark:text-zinc-400">
            Fetch sector and industry data from Yahoo Finance for position price snapshots missing this information.
          </p>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleEnrichProfiles}
                disabled={enriching}
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {enriching ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Enriching...
                  </>
                ) : (
                  'Enrich Missing Profiles'
                )}
              </button>
            </div>

            {enrichResult && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                <p className="font-medium">Enrichment complete</p>
                <p className="mt-1">
                  Enriched: {enrichResult.enriched} | Errors: {enrichResult.errored} | Total: {enrichResult.total} symbols
                </p>
              </div>
            )}

            {enrichError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
                {enrichError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
