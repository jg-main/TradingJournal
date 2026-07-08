'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';

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

  const [form, setForm] = useState({
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    timeoutMs: '30000',
    temperature: '0.7',
    maxTokens: '4096',
    systemPrompt: '',
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
            <label htmlFor="provider" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Provider
            </label>
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
              <label htmlFor="baseUrl" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Endpoint URL
              </label>
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
            <label htmlFor="apiKey" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              API Key <span className="text-xs text-zinc-400">(stored securely, never displayed)</span>
            </label>
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
            <label htmlFor="model" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Model
            </label>
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
            <label htmlFor="timeoutMs" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Timeout (ms)
            </label>
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
            <label htmlFor="temperature" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Temperature: {form.temperature}
            </label>
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
            <label htmlFor="maxTokens" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Max Tokens
            </label>
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
            <label htmlFor="systemPrompt" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              System Prompt
            </label>
            <textarea
              id="systemPrompt"
              rows={4}
              value={form.systemPrompt}
              onChange={handleChange('systemPrompt')}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              placeholder="You are a helpful trading assistant that analyzes trade quality..."
            />
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
