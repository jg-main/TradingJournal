'use client';

import { useEffect, useState, use } from 'react';
import { ArrowLeft, Save, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import ChecklistManager from '@/components/checklist-manager';

interface SetupDetail {
  id: string;
  name: string;
  description: string | null;
  howToPlay: string | null;
  entryRules: string | null;
  exitRules: string | null;
  tags: string | null;
  defaultRiskPct: number | null;
  positionSizingRules: string | null;
  chartPatterns: string | null;
  analysisConfig: string | null;
  isActive: boolean;
}

export default function PlayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [setup, setSetup] = useState<SetupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showRawConfig, setShowRawConfig] = useState(false);

  const [featureMode, setFeatureMode] = useState<'all' | 'custom'>('all');
  const [customFeatures, setCustomFeatures] = useState('');

  // ── Form fields ──────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [howToPlay, setHowToPlay] = useState('');
  const [entryRules, setEntryRules] = useState('');
  const [exitRules, setExitRules] = useState('');
  const [tags, setTags] = useState('');
  const [defaultRiskPct, setDefaultRiskPct] = useState('');
  const [positionSizingRules, setPositionSizingRules] = useState('');
  const [chartPatterns, setChartPatterns] = useState('');

  // ── Fetch setup data ─────────────────────────────────────────────
  const fetchSetup = async () => {
    try {
      const res = await fetch(`/api/setup-definitions/${id}?t=${Date.now()}`);
      if (!res.ok) { setLoading(false); return; }
      const data: SetupDetail = await res.json();
      setSetup(data);
      setName(data.name);
      setDescription(data.description ?? '');
      setHowToPlay(data.howToPlay ?? '');
      setEntryRules(data.entryRules ?? '');
      setExitRules(data.exitRules ?? '');
      setTags(data.tags ?? '');
      setDefaultRiskPct(data.defaultRiskPct?.toString() ?? '');
      setPositionSizingRules(data.positionSizingRules ?? '');
      setChartPatterns(data.chartPatterns ?? '');

      // Parse analysis config
      let parsedConfig: { featureMode?: string; features?: Array<{ id: string }> } | null = null;
      try {
        if (data.analysisConfig) parsedConfig = JSON.parse(data.analysisConfig);
      } catch { /* ignore */ }
      setFeatureMode(parsedConfig?.featureMode === 'custom' ? 'custom' : 'all');
      if (parsedConfig?.features) {
        setCustomFeatures(JSON.stringify(parsedConfig.features, null, 2));
      } else {
        setCustomFeatures('[]');
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Save ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    const analysisConfig = JSON.stringify({
      ohlcYears: 1,
      featureMode,
      includeRawOhlcv: true,
      features: featureMode === 'custom' ? (() => {
        try { return JSON.parse(customFeatures); } catch { return []; }
      })() : [],
    });

    // Only send fields that have content — null values would overwrite
    // existing values in the DB. The server updates only what's provided.
    const payload: Record<string, unknown> = {
      name,
      analysisConfig,
    };
    if (description) payload.description = description;
    if (howToPlay) payload.howToPlay = howToPlay;
    if (entryRules) payload.entryRules = entryRules;
    if (exitRules) payload.exitRules = exitRules;
    if (tags) payload.tags = tags;
    if (defaultRiskPct) payload.defaultRiskPct = parseFloat(defaultRiskPct);
    if (positionSizingRules) payload.positionSizingRules = positionSizingRules;
    if (chartPatterns) payload.chartPatterns = chartPatterns;

    try {
      const res = await fetch(`/api/setup-definitions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.details ? JSON.stringify(err.details) : err.error });
        return;
      }
      setMessage({ type: 'success', text: 'Play updated.' });
      await fetchSetup();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save.' });
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-red-500">Play not found.</p>
        <Link href="/settings/plays" className="mt-2 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800">
          <ArrowLeft className="size-4" /> Back to Plays
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* ── Header ─────────────────────────────────────────────── */}
      <Link href="/settings/plays" className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
        <ArrowLeft className="size-4" />
        Back to Plays
      </Link>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{setup.name}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Configure trading setup rules, risk parameters, and AI assessment data.</p>
        </div>
        <div className="flex items-center gap-2">
          {setup.isActive ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Active</span>
          ) : (
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">Inactive</span>
          )}
        </div>
      </div>

      {message && (
        <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
          message.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
            : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        {/* ── Description & Rules ──────────────────────────────────── */}
        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">Description &amp; Rules</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
              <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Entry Rules</label>
                <textarea rows={4} value={entryRules} onChange={e => setEntryRules(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Exit Rules</label>
                <textarea rows={4} value={exitRules} onChange={e => setExitRules(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">How to Play</label>
              <textarea rows={3} value={howToPlay} onChange={e => setHowToPlay(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
            </div>
          </div>
        </section>

        {/* ── Tags & Patterns ──────────────────────────────────────── */}
        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">Tags &amp; Patterns</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags (JSON)</label>
              <input type="text" value={tags} onChange={e => setTags(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder='["breakout","trend"]' />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Chart Patterns</label>
              <input type="text" value={chartPatterns} onChange={e => setChartPatterns(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder="Flag, Pennant, Cup & Handle" />
            </div>
          </div>
        </section>

        {/* ── Risk & Sizing ────────────────────────────────────────── */}
        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">Risk &amp; Sizing</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Default Risk %</label>
              <input type="number" step="0.1" min="0" max="100" value={defaultRiskPct} onChange={e => setDefaultRiskPct(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Position Sizing Rules</label>
            <textarea rows={3} value={positionSizingRules} onChange={e => setPositionSizingRules(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100" />
          </div>
        </section>

        {/* ── AI Assessment Data ───────────────────────────────────── */}
        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">AI Assessment Data</h2>
              <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                Controls what market data is sent to the AI when assessing trades using this setup.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRawConfig(!showRawConfig)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              {showRawConfig ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              {showRawConfig ? 'Hide' : 'Show'} raw config
            </button>
          </div>

          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setFeatureMode('all')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                featureMode === 'all'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
              }`}
            >
              All Features (~114K tok)
            </button>
            <button
              type="button"
              onClick={() => setFeatureMode('custom')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                featureMode === 'custom'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
              }`}
            >
              Custom Subset
            </button>
          </div>

          {featureMode === 'custom' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Feature IDs (JSON array)</label>
              <textarea rows={4} value={customFeatures} onChange={e => setCustomFeatures(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-mono text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder='[{"id":"sma_20","label":"SMA(20)","source":"clickhouse"}]' />
            </div>
          )}

          {showRawConfig && (
            <div className="mt-3 rounded-md bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <pre className="overflow-auto text-xs text-zinc-600 dark:text-zinc-400">
                {JSON.stringify({
                  ohlcYears: 1,
                  featureMode,
                  includeRawOhlcv: true,
                  features: featureMode === 'custom' ? (() => {
                    try { return JSON.parse(customFeatures); } catch { return []; }
                  })() : [],
                }, null, 2)}
              </pre>
            </div>
          )}
        </section>

        {/* ── Checklist ────────────────────────────────────────────── */}
        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">Entry Checks</h2>
          <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">
            Checklist items that must be verified before executing a trade with this setup.
          </p>
          <ChecklistManager parentId={id} scope="setup" />
        </section>

        {/* ── Save ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            <Save className="mr-1.5 size-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
          {message?.type === 'success' && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>
          )}
        </div>
      </div>
    </div>
  );
}
