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
  const [dataProvider, setDataProvider] = useState<'clickhouse' | 'schwab'>('clickhouse');

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
      let parsedConfig: { featureMode?: string; features?: Array<{ id: string }>; dataProvider?: string } | null = null;
      try {
        if (data.analysisConfig) parsedConfig = JSON.parse(data.analysisConfig);
      } catch { /* ignore */ }
      setFeatureMode(parsedConfig?.featureMode === 'custom' ? 'custom' : 'all');
      if (parsedConfig?.features) {
        setCustomFeatures(JSON.stringify(parsedConfig.features, null, 2));
      } else {
        setCustomFeatures('[]');
      }
      setDataProvider(parsedConfig?.dataProvider === 'schwab' ? 'schwab' : 'clickhouse');
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
      dataProvider,
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
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-destructive">Play not found.</p>
        <Link href="/settings/plays" className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to Plays
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* ── Header ─────────────────────────────────────────────── */}
      <Link href="/settings/plays" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to Plays
      </Link>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{setup.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure trading setup rules, risk parameters, and AI assessment data.</p>
        </div>
        <div className="flex items-center gap-2">
          {setup.isActive ? (
            <span className="rounded-full bg-positive/10 px-3 py-1 text-xs font-medium text-positive">Active</span>
          ) : (
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Inactive</span>
          )}
        </div>
      </div>

      {message && (
        <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
          message.type === 'success'
            ? 'border-positive/30 bg-positive/10 text-positive'
            : 'border-destructive/30 bg-destructive/10 text-destructive'
        }`}>
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        {/* ── Description & Rules ──────────────────────────────────── */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-base font-semibold text-card-foreground">Description &amp; Rules</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="play-name" className="mb-1 block text-sm font-medium text-muted-foreground">Name</label>
              <input id="play-name" type="text" value={name} onChange={e => setName(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div>
              <label htmlFor="play-description" className="mb-1 block text-sm font-medium text-muted-foreground">Description</label>
              <textarea id="play-description" rows={2} value={description} onChange={e => setDescription(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="play-entryRules" className="mb-1 block text-sm font-medium text-muted-foreground">Entry Rules</label>
                <textarea id="play-entryRules" rows={4} value={entryRules} onChange={e => setEntryRules(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div>
                <label htmlFor="play-exitRules" className="mb-1 block text-sm font-medium text-muted-foreground">Exit Rules</label>
                <textarea id="play-exitRules" rows={4} value={exitRules} onChange={e => setExitRules(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
            </div>
            <div>
              <label htmlFor="play-howToPlay" className="mb-1 block text-sm font-medium text-muted-foreground">How to Play</label>
              <textarea id="play-howToPlay" rows={3} value={howToPlay} onChange={e => setHowToPlay(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
        </section>

        {/* ── Tags & Patterns ──────────────────────────────────────── */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-base font-semibold text-card-foreground">Tags &amp; Patterns</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="play-tags" className="mb-1 block text-sm font-medium text-muted-foreground">Tags (JSON)</label>
              <input id="play-tags" type="text" value={tags} onChange={e => setTags(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder='["breakout","trend"]' />
            </div>
            <div>
              <label htmlFor="play-chartPatterns" className="mb-1 block text-sm font-medium text-muted-foreground">Chart Patterns</label>
              <input id="play-chartPatterns" type="text" value={chartPatterns} onChange={e => setChartPatterns(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Flag, Pennant, Cup & Handle" />
            </div>
          </div>
        </section>

        {/* ── Risk & Sizing ────────────────────────────────────────── */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-base font-semibold text-card-foreground">Risk &amp; Sizing</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="play-defaultRiskPct" className="mb-1 block text-sm font-medium text-muted-foreground">Default Risk %</label>
              <input id="play-defaultRiskPct" type="number" step="0.1" min="0" max="100" value={defaultRiskPct} onChange={e => setDefaultRiskPct(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
          <div className="mt-4">
            <label htmlFor="play-positionSizingRules" className="mb-1 block text-sm font-medium text-muted-foreground">Position Sizing Rules</label>
            <textarea id="play-positionSizingRules" rows={3} value={positionSizingRules} onChange={e => setPositionSizingRules(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
        </section>

        {/* ── AI Assessment Data ───────────────────────────────────── */}
        <section className="rounded-lg border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-card-foreground">AI Assessment Data</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Controls what market data is sent to the AI when assessing trades using this setup.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRawConfig(!showRawConfig)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
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
                  ? 'bg-foreground text-background dark:bg-secondary dark:text-secondary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              All Features (~114K tok)
            </button>
            <button
              type="button"
              onClick={() => setFeatureMode('custom')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                featureMode === 'custom'
                  ? 'bg-foreground text-background dark:bg-secondary dark:text-secondary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              Custom Subset
            </button>
          </div>

          {featureMode === 'custom' && (
            <div>
              <label htmlFor="play-customFeatures" className="mb-1 block text-xs font-medium text-muted-foreground">Feature IDs (JSON array)</label>
              <textarea id="play-customFeatures" rows={4} value={customFeatures} onChange={e => setCustomFeatures(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-xs font-mono text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder='[{"id":"sma_20","label":"SMA(20)","source":"clickhouse"}]' />
            </div>
          )}

          <div className="mt-4">
            <label htmlFor="play-dataProvider" className="mb-1 block text-xs font-medium text-muted-foreground">Market Data Provider</label>
            <select
              id="play-dataProvider"
              value={dataProvider}
              onChange={e => setDataProvider(e.target.value as 'clickhouse' | 'schwab')}
              className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="clickhouse">ClickHouse (EOD, full indicator support)</option>
              <option value="schwab">Schwab (intraday 10m, limited indicators)</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {dataProvider === 'schwab'
                ? 'Schwab supplies 10min OHLC data for intraday precision. Feature indicators are limited compared to ClickHouse.'
                : 'ClickHouse is recommended — full indicator support with pre-computed feature columns.'}
            </p>
          </div>

          {showRawConfig && (
            <div className="mt-3 rounded-md bg-muted p-3">
              <pre className="overflow-auto text-xs text-muted-foreground">
                {JSON.stringify({
                  ohlcYears: 1,
                  featureMode,
                  includeRawOhlcv: true,
                  features: featureMode === 'custom' ? (() => {
                    try { return JSON.parse(customFeatures); } catch { return []; }
                  })() : [],
                  dataProvider,
                }, null, 2)}
              </pre>
            </div>
          )}
        </section>

        {/* ── Checklist ────────────────────────────────────────────── */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-base font-semibold text-card-foreground">Entry Checks</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Checklist items that must be verified before executing a trade with this setup.
          </p>
          <ChecklistManager parentId={id} scope="setup" />
        </section>

        {/* ── Save ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 border-t pt-6">
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            <Save className="mr-1.5 size-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
          {message?.type === 'success' && (
            <span className="text-sm text-positive">Saved.</span>
          )}
        </div>
      </div>
    </div>
  );
}
