'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CircleCheck, CircleX, HelpCircle, Loader2 } from 'lucide-react';
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

  useEffect(() => {
    const controller = new AbortController();
    void loadSettings(controller.signal);

    const handleFocus = () => void loadSettings();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadSettings();
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
  }, [loadSettings]);

  // ── Save ────────────────────────────────────────────────────────────

  const handleSave = async () => {
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
          activeProvider,
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
      setMessage({ type: 'success', text: 'Market data settings saved.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save market data settings.' });
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
                <StatusDot status={connectionResult?.ok === true ? 'success' : connectionResult ? 'error' : null} />
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {activeProvider === 'clickhouse' ? 'ClickHouse' : activeProvider}
                </span>
              </div>
            </div>

            {connectionResult && (
              <div className="flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">Connection</span>
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

            {/* Actions */}
            <div className="flex items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={handleSave}
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
          </div>
        </div>
      </div>
    </div>
  );
}
