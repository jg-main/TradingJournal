'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { HelpTooltip } from '@/components/help-tooltip';

interface AiSettings {
  id: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  timeoutMs: number | null;
  temperature: number | null;
  maxTokens: number | null;
  systemPrompt: string | null;
  isActive: number | null;
  clickhouseHost: string | null;
  clickhousePort: number | null;
  clickhouseUser: string | null;
  clickhouseDatabase: string | null;
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: '', model: 'gpt-4' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' },
  anthropic: { baseUrl: '', model: 'claude-3-5-sonnet-20241022' },
  google: { baseUrl: '', model: 'gemini-1.5-pro' },
  custom: { baseUrl: '', model: '' },
};

export default function AiSettingsPage() {
  const router = useRouter();
  const [, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const [form, setForm] = useState({
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    timeoutMs: '30000',
    temperature: '0.7',
    maxTokens: '4096',
    systemPrompt: '',
    isActive: true,
    clickhouseHost: 'localhost',
    clickhousePort: '8123',
    clickhouseUser: 'default',
    clickhousePassword: '',
    clickhouseDatabase: 'market',
  });

  useEffect(() => {
    document.title = 'AI Settings — Trading Journal';
  }, []);

  useEffect(() => {
    fetch('/api/ai-settings')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.id) {
          setSettings(data);
          setForm({
            provider: data.provider ?? 'openai',
            baseUrl: data.baseUrl ?? '',
            apiKey: '',
            model: data.model ?? '',
            timeoutMs: data.timeoutMs?.toString() ?? '30000',
            temperature: data.temperature?.toString() ?? '0.7',
            maxTokens: data.maxTokens?.toString() ?? '4096',
            systemPrompt: data.systemPrompt ?? '',
            isActive: data.isActive === null || data.isActive === undefined ? true : Boolean(data.isActive),
            clickhouseHost: data.clickhouseHost ?? 'localhost',
            clickhousePort: data.clickhousePort?.toString() ?? '8123',
            clickhouseUser: data.clickhouseUser ?? 'default',
            clickhousePassword: '',
            clickhouseDatabase: data.clickhouseDatabase ?? 'market',
          });
        } else {
          // No existing settings — apply provider defaults
          const defs = PROVIDER_DEFAULTS.openai;
          setForm((prev) => ({
            ...prev,
            baseUrl: defs.baseUrl,
            model: defs.model,
          }));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Update defaults when provider changes
  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value;
    const defs = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.custom;
    setForm((prev) => ({
      ...prev,
      provider,
      baseUrl: defs.baseUrl,
      model: prev.model || defs.model,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const payload: Record<string, unknown> = {
      provider: form.provider,
      model: form.model,
      timeoutMs: parseInt(form.timeoutMs, 10) || 30000,
      temperature: parseFloat(form.temperature),
      maxTokens: parseInt(form.maxTokens, 10) || 4096,
    };

    if (form.apiKey) payload.apiKey = form.apiKey;
    if (form.systemPrompt) payload.systemPrompt = form.systemPrompt;
    payload.isActive = form.isActive;

    // ClickHouse config — always send if settings exist
    payload.clickhouseHost = form.clickhouseHost || 'localhost';
    payload.clickhousePort = parseInt(form.clickhousePort, 10) || 8123;
    payload.clickhouseUser = form.clickhouseUser || 'default';
    payload.clickhouseDatabase = form.clickhouseDatabase || 'market';
    if (form.clickhousePassword) {
      payload.clickhousePassword = form.clickhousePassword;
    }

    // Only send baseUrl if provider needs one (ollama/custom)
    if (form.provider === 'ollama' || form.provider === 'custom') {
      if (form.baseUrl) payload.baseUrl = form.baseUrl;
    }

    try {
      const res = await fetch('/api/ai-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }

      const data = await res.json();
      setSettings(data);
      setMessage({ type: 'success', text: 'AI settings saved. Returning to Settings…' });
      // Clear apiKey from form after save so it's not shown
      setForm((prev) => ({ ...prev, apiKey: '' }));
      setTimeout(() => router.push('/settings'), 1200);
    } catch {
      setMessage({ type: 'error', text: 'Failed to save AI settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    // Clear connection result when any ClickHouse field changes
    if (field.startsWith('clickhouse')) {
      setConnectionResult(null);
    }
  };

  const handleToggle = () => {
    setForm((prev) => ({ ...prev, isActive: !prev.isActive }));
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);

    try {
      const res = await fetch('/api/ai-settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clickhouseHost: form.clickhouseHost || undefined,
          clickhousePort: form.clickhousePort ? parseInt(form.clickhousePort, 10) : undefined,
          clickhouseUser: form.clickhouseUser || undefined,
          clickhousePassword: form.clickhousePassword || undefined,
          clickhouseDatabase: form.clickhouseDatabase || undefined,
        }),
      });
      const data = await res.json();
      setConnectionResult({ ok: data.ok, error: data.error });
    } catch {
      setConnectionResult({ ok: false, error: 'Failed to reach test-connection endpoint.' });
    } finally {
      setTestingConnection(false);
    }
  };

  const showEndpointUrl = form.provider === 'ollama' || form.provider === 'custom';

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-zinc-500">Loading AI settings...</p>
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
        AI Settings
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

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          {/* Provider */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="provider" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Provider
              </label>
              <HelpTooltip content="Which AI service to use for trade analysis and grading. Changes take effect on save." />
            </div>
            <select
              id="provider"
              value={form.provider}
              onChange={handleProviderChange}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Endpoint URL (conditional) */}
          {showEndpointUrl && (
            <div>
              <div className="mb-1 flex items-center gap-1">
                <label htmlFor="baseUrl" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Endpoint URL
                </label>
                <HelpTooltip content="Custom API endpoint URL for your LLM provider. Required for Ollama and custom providers." />
              </div>
              <input
                id="baseUrl"
                type="url"
                value={form.baseUrl}
                onChange={handleChange('baseUrl')}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                placeholder={
                  form.provider === 'ollama'
                    ? 'http://localhost:11434/v1'
                    : 'https://your-custom-endpoint.com/v1'
                }
              />
            </div>
          )}

          {/* API Key */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="apiKey" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                API Key <span className="text-xs text-zinc-400">(stored securely, never displayed)</span>
              </label>
              <HelpTooltip content="Your API key is stored securely and never displayed after saving." />
            </div>
            <div className="relative">
              <input
                id="apiKey"
                type={showApiKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={handleChange('apiKey')}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 pr-10 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                placeholder="sk-..."
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Model */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="model" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Model
              </label>
              <HelpTooltip content="Model identifier for generating trade analysis (e.g. gpt-4, claude-3-opus, qwen2.5-coder:7b)" />
            </div>
            <input
              id="model"
              type="text"
              value={form.model}
              onChange={handleChange('model')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              placeholder="e.g. gpt-4, qwen2.5-coder:7b"
            />
          </div>

          {/* Timeout */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="timeoutMs" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Timeout (ms)
              </label>
              <HelpTooltip content="Maximum time to wait for an AI response before the request times out." />
            </div>
            <input
              id="timeoutMs"
              type="number"
              min="1000"
              step="1000"
              value={form.timeoutMs}
              onChange={handleChange('timeoutMs')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
            />
          </div>

          {/* Temperature */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="temperature" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Temperature: {form.temperature}
              </label>
              <HelpTooltip content="Controls output randomness. Lower values produce more deterministic, consistent results." />
            </div>
            <input
              id="temperature"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={form.temperature}
              onChange={handleChange('temperature')}
              className="w-full accent-zinc-900 dark:accent-zinc-100"
            />
          </div>

          {/* Max Tokens */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="maxTokens" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Max Tokens
              </label>
              <HelpTooltip content="Maximum length of the AI-generated response." />
            </div>
            <input
              id="maxTokens"
              type="number"
              min="1"
              step="1"
              value={form.maxTokens}
              onChange={handleChange('maxTokens')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
            />
          </div>

          {/* System Prompt */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="systemPrompt" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                System Prompt
              </label>
              <HelpTooltip content="Base instructions that define the AI assistant's behavior and expertise context for trade analysis." />
            </div>
            <textarea
              id="systemPrompt"
              rows={4}
              value={form.systemPrompt}
              onChange={handleChange('systemPrompt')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              placeholder="You are a helpful trading assistant that analyzes trade quality..."
            />
          </div>

          {/* AI Provider Active Toggle */}
          <div className="flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Enable AI Provider</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {form.isActive ? 'Provider is active and ready to accept requests.' : 'Provider is disabled — no AI features will function.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.isActive}
              aria-label="Toggle AI provider"
              onClick={handleToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 ${
                form.isActive
                  ? 'bg-zinc-900 dark:bg-zinc-100'
                  : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block size-5 transform rounded-full bg-white shadow-sm ring-0 transition-transform ${
                  form.isActive ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* ── ClickHouse Configuration ── */}
        <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">ClickHouse Configuration</h2>
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
              Connection settings for market data database. Password is never displayed — re-enter when changing other fields.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Host */}
            <div>
              <label htmlFor="clickhouseHost" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Host
              </label>
              <input
                id="clickhouseHost"
                type="text"
                value={form.clickhouseHost}
                onChange={handleChange('clickhouseHost')}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                placeholder="localhost"
              />
            </div>

            {/* Port */}
            <div>
              <label htmlFor="clickhousePort" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Port
              </label>
              <input
                id="clickhousePort"
                type="number"
                min="1"
                max="65535"
                value={form.clickhousePort}
                onChange={handleChange('clickhousePort')}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                placeholder="8123"
              />
            </div>

            {/* User */}
            <div>
              <label htmlFor="clickhouseUser" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                User
              </label>
              <input
                id="clickhouseUser"
                type="text"
                value={form.clickhouseUser}
                onChange={handleChange('clickhouseUser')}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                placeholder="default"
              />
            </div>

            {/* Database */}
            <div>
              <label htmlFor="clickhouseDatabase" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Database
              </label>
              <input
                id="clickhouseDatabase"
                type="text"
                value={form.clickhouseDatabase}
                onChange={handleChange('clickhouseDatabase')}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                placeholder="market"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label htmlFor="clickhousePassword" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Password <span className="text-xs text-zinc-400">(stored securely, never displayed)</span>
            </label>
            <input
              id="clickhousePassword"
              type="password"
              value={form.clickhousePassword}
              onChange={handleChange('clickhousePassword')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              placeholder="(unchanged)"
              autoComplete="new-password"
            />
          </div>

          {/* Test Connection */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={testingConnection}
              onClick={handleTestConnection}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </button>

            {connectionResult && (
              <span className={`inline-flex items-center gap-1.5 text-sm ${
                connectionResult.ok
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {connectionResult.ok ? (
                  <>
                    <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                    Connected
                  </>
                ) : (
                  <>
                    <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                    </svg>
                    {connectionResult.error || 'Connection failed'}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {saving ? 'Saving...' : 'Save AI Settings'}
          </button>
          {message?.type === 'success' && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>
          )}
        </div>
      </form>
    </div>
  );
}
