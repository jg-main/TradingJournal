'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff, FileText, ScrollText } from 'lucide-react';
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

  // ── Prompt Preview ─────────────────────────────────────────────────
  type PromptPreviewTab = 'pre-trade' | 'after-exit';
  const [previewActiveTab, setPreviewActiveTab] = useState<PromptPreviewTab>('pre-trade');
  const [previewResult, setPreviewResult] = useState<{
    systemMessage: string;
    userMessage: string;
    sectionCount: number;
    totalChars: number;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const fetchPromptPreview = async (assessmentType: 'ai_quality' | 'ai_review') => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResult(null);

    try {
      const res = await fetch('/api/ai-settings/prompt-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentType,
          systemPrompt: form.systemPrompt,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setPreviewError(err.error || err.details?.formErrors?.[0] || 'Failed to generate prompt preview');
        return;
      }

      const data = await res.json();
      setPreviewResult(data);
    } catch {
      setPreviewError('Failed to generate prompt preview — network error.');
    } finally {
      setPreviewLoading(false);
    }
  };

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

  const handleToggle = () => {
    setForm((prev) => ({ ...prev, isActive: !prev.isActive }));
  };

  const showEndpointUrl = form.provider === 'ollama' || form.provider === 'custom';

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-muted-foreground">Loading AI settings...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Settings
      </Link>

      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-foreground">
        AI Settings
      </h1>

      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          {/* Provider */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="provider" className="block text-sm font-medium text-foreground">
                Provider
              </label>
              <HelpTooltip content="Which AI service to use for trade analysis and grading. Changes take effect on save." />
            </div>
            <select
              id="provider"
              value={form.provider}
              onChange={handleProviderChange}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
                <label htmlFor="baseUrl" className="block text-sm font-medium text-foreground">
                  Endpoint URL
                </label>
                <HelpTooltip content="Custom API endpoint URL for your LLM provider. Required for Ollama and custom providers." />
              </div>
              <input
                id="baseUrl"
                type="url"
                value={form.baseUrl}
                onChange={handleChange('baseUrl')}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
              <label htmlFor="apiKey" className="block text-sm font-medium text-foreground">
                API Key <span className="text-xs text-muted-foreground">(stored securely, never displayed)</span>
              </label>
              <HelpTooltip content="Your API key is stored securely and never displayed after saving." />
            </div>
            <div className="relative">
              <input
                id="apiKey"
                type={showApiKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={handleChange('apiKey')}
                className="w-full rounded-md border border-input bg-card px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="sk-..."
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
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
              <label htmlFor="model" className="block text-sm font-medium text-foreground">
                Model
              </label>
              <HelpTooltip content="Model identifier for generating trade analysis (e.g. gpt-4, claude-3-opus, qwen2.5-coder:7b)" />
            </div>
            <input
              id="model"
              type="text"
              value={form.model}
              onChange={handleChange('model')}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="e.g. gpt-4, qwen2.5-coder:7b"
            />
          </div>

          {/* Timeout */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="timeoutMs" className="block text-sm font-medium text-foreground">
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
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Temperature */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="temperature" className="block text-sm font-medium text-foreground">
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
              className="w-full accent-primary"
            />
          </div>

          {/* Max Tokens */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="maxTokens" className="block text-sm font-medium text-foreground">
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
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* System Prompt */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <label htmlFor="systemPrompt" className="block text-sm font-medium text-foreground">
                System Prompt
              </label>
              <HelpTooltip content="Base instructions that define the AI assistant's behavior and expertise context for trade analysis." />
            </div>
            <textarea
              id="systemPrompt"
              rows={4}
              value={form.systemPrompt}
              onChange={handleChange('systemPrompt')}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="You are a helpful trading assistant that analyzes trade quality..."
            />
          </div>

          {/* AI Provider Active Toggle */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              <p className="text-sm font-medium text-foreground">Enable AI Provider</p>
              <p className="text-xs text-muted-foreground">
                {form.isActive ? 'Provider is active and ready to accept requests.' : 'Provider is disabled — no AI features will function.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.isActive}
              aria-label="Toggle AI provider"
              onClick={handleToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                form.isActive
                  ? 'bg-foreground dark:bg-secondary'
                  : 'bg-input'
              }`}
            >
              <span
                className={`inline-block size-5 transform rounded-full bg-card shadow-sm ring-0 transition-transform ${
                  form.isActive ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* ── Prompt Preview ── */}
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">Prompt Preview</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Preview the full composed AI prompt using static sample trade data. System Prompt override
              from the form above is reflected in the preview.
            </p>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => {
                setPreviewActiveTab('pre-trade');
                fetchPromptPreview('ai_quality');
              }}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                previewActiveTab === 'pre-trade'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="size-4" />
              Pre-Trade Assessment
            </button>
            <button
              type="button"
              onClick={() => {
                setPreviewActiveTab('after-exit');
                fetchPromptPreview('ai_review');
              }}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                previewActiveTab === 'after-exit'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ScrollText className="size-4" />
              After-Exit Assessment
            </button>
          </div>

          {/* Preview content */}
          <div className="min-h-[200px]">
            {previewLoading && (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-muted-foreground">Generating prompt preview...</p>
              </div>
            )}

            {previewError && !previewLoading && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {previewError}
              </div>
            )}

            {previewResult && !previewLoading && !previewError && (
              <div className="space-y-4">
                {/* Metadata badges */}
                <div className="flex gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                    {previewResult.sectionCount} sections
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                    {previewResult.totalChars.toLocaleString()} characters
                  </span>
                </div>

                {/* System message */}
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    System Message
                  </h3>
                  <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
                    {previewResult.systemMessage}
                  </pre>
                </div>

                {/* User message */}
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    User Message
                  </h3>
                  <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
                    {previewResult.userMessage}
                  </pre>
                </div>
              </div>
            )}

            {!previewResult && !previewLoading && !previewError && (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-muted-foreground">
                  Click a tab above to generate a prompt preview.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
          >
            {saving ? 'Saving...' : 'Save AI Settings'}
          </button>
          {message?.type === 'success' && (
            <span className="text-sm text-positive">Saved.</span>
          )}
        </div>
      </form>
    </div>
  );
}
