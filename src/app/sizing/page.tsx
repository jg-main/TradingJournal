'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Calculator, Loader2, AlertCircle, TrendingUp, TrendingDown, CheckCircle, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/empty-state';
import { calculatePositionSize, type Direction, type PositionSizingResult } from '@/lib/position-sizing';

// ── Types ──────────────────────────────────────────────────────────────

interface SettingsData {
  id: string;
  startingAccountValue: number | null;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
  defaultAccountId: string | null;
  currency: string | null;
  journalStartDate: string | null;
}

interface CreatedTrade {
  id: string;
  tradeCode: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  const abs = Math.abs(v);
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v >= 0 ? `$${formatted}` : `-$${formatted}`;
}

// ── Page ───────────────────────────────────────────────────────────────

export default function SizingPage() {
  // ── Settings state ──────────────────────────────────────────────────
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // ── Form state ──────────────────────────────────────────────────────
  const [accountEquity, setAccountEquity] = useState('');
  const [riskPerTradePct, setRiskPerTradePct] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [direction, setDirection] = useState<Direction>('long');
  const [targetPrice, setTargetPrice] = useState('');

  // ── Results state ───────────────────────────────────────────────────
  const [result, setResult] = useState<PositionSizingResult | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);

  // ── Create trade state ──────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [createdTrade, setCreatedTrade] = useState<CreatedTrade | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Load settings ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setSettingsLoading(true);
      setSettingsError(null);

      try {
        const res = await fetch('/api/settings');
        if (cancelled) return;

        if (res.ok) {
          const data: SettingsData = await res.json();
          if (!cancelled) {
            setSettings(data);
            if (data.startingAccountValue != null) {
              setAccountEquity(String(data.startingAccountValue));
            }
            if (data.maxRiskPerTradePct != null) {
              setRiskPerTradePct(String(data.maxRiskPerTradePct));
            }
          }
        } else {
          // 200 with message means no settings — that's fine, user enters manually
          if (res.status !== 200) {
            setSettingsError('Failed to load settings.');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setSettingsError(String(err));
        }
      } finally {
        if (!cancelled) {
          setSettingsLoading(false);
        }
      }
    }

    loadSettings();
    return () => { cancelled = true; };
  }, []);

  // ── Calculate handler ──────────────────────────────────────────────

  function handleCalculate() {
    setCalcError(null);
    setResult(null);
    setCreatedTrade(null);
    setCreateError(null);

    const equity = parseFloat(accountEquity);
    const riskPct = parseFloat(riskPerTradePct);
    const entry = parseFloat(entryPrice);
    const stop = parseFloat(stopPrice);
    const target = targetPrice.trim() !== '' ? parseFloat(targetPrice) : undefined;

    if (isNaN(equity) || equity <= 0) {
      setCalcError('Account equity must be a positive number.');
      return;
    }
    if (isNaN(riskPct) || riskPct <= 0) {
      setCalcError('Risk per trade percentage must be a positive number.');
      return;
    }
    if (isNaN(entry) || entry <= 0) {
      setCalcError('Entry price must be a positive number.');
      return;
    }
    if (isNaN(stop) || stop <= 0) {
      setCalcError('Stop price must be a positive number.');
      return;
    }
    if (entry === stop) {
      setCalcError('Entry and stop prices must differ.');
      return;
    }
    if (target !== undefined && (isNaN(target) || target <= 0)) {
      setCalcError('Target price must be a positive number if provided.');
      return;
    }

    try {
      const r = calculatePositionSize({
        accountEquity: equity,
        riskPerTradePct: riskPct,
        entryPrice: entry,
        stopPrice: stop,
        direction,
        targetPrice: target,
      });
      setResult(r);
    } catch (err) {
      setCalcError(String(err));
    }
  }

  // ── Create Planned Trade handler ────────────────────────────────────

  async function handleCreatePlannedTrade() {
    if (!result) return;

    setCreating(true);
    setCreateError(null);
    setCreatedTrade(null);

    try {
      const entry = parseFloat(entryPrice);
      const stop = parseFloat(stopPrice);
      const target = targetPrice.trim() !== '' ? parseFloat(targetPrice) : undefined;

      const preTradePlan = [
        `Position sizing: ${formatCurrency(result.riskAmount)} risk`,
        `(${riskPerTradePct}% of ${formatCurrency(parseFloat(accountEquity))})`,
        `on ${result.positionSize.toFixed(2)} shares at ${formatPrice(entry)}/${formatPrice(stop)}`,
        result.rewardRiskRatio != null ? `R:R ${result.rewardRiskRatio.toFixed(2)}` : '',
        target !== undefined ? `target ${formatPrice(target)}` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'TBD',
          direction,
          plannedEntry: entry,
          plannedStop: stop,
          plannedTarget1: target ?? null,
          preTradePlan,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCreateError(data.error ?? 'Failed to create trade.');
        return;
      }

      setCreatedTrade({ id: data.id, tradeCode: data.tradeCode });
    } catch (err) {
      setCreateError(String(err));
    } finally {
      setCreating(false);
    }
  }

  // ── Render: Settings Loading ────────────────────────────────────────

  if (settingsLoading) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center px-8 py-20">
        <Loader2 className="mr-2 size-5 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500">Loading settings...</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Position Sizing
      </h1>

      {/* Calculator Card */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="size-4 text-zinc-500" />
            Position Size Calculator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Account Equity */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Account Equity ($)
              </label>
              <Input
                type="number"
                step="any"
                min="0"
                placeholder="e.g. 10000"
                value={accountEquity}
                onChange={(e) => { setAccountEquity(e.target.value); setResult(null); setCreatedTrade(null); }}
              />
            </div>

            {/* Risk Per Trade (%) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Risk Per Trade (%)
              </label>
              <Input
                type="number"
                step="any"
                min="0"
                max="100"
                placeholder="e.g. 1"
                value={riskPerTradePct}
                onChange={(e) => { setRiskPerTradePct(e.target.value); setResult(null); setCreatedTrade(null); }}
              />
            </div>

            {/* Entry Price */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Entry Price ($)
              </label>
              <Input
                type="number"
                step="any"
                min="0"
                placeholder="e.g. 100.00"
                value={entryPrice}
                onChange={(e) => { setEntryPrice(e.target.value); setResult(null); setCreatedTrade(null); }}
              />
            </div>

            {/* Stop Price */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Stop Price ($)
              </label>
              <Input
                type="number"
                step="any"
                min="0"
                placeholder="e.g. 95.00"
                value={stopPrice}
                onChange={(e) => { setStopPrice(e.target.value); setResult(null); setCreatedTrade(null); }}
              />
            </div>

            {/* Direction */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Direction
              </label>
              <Select
                value={direction}
                onValueChange={(v: Direction) => { setDirection(v); setResult(null); setCreatedTrade(null); }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">
                    <span className="inline-flex items-center gap-1.5">
                      <TrendingUp className="size-3.5 text-emerald-500" />
                      Long
                    </span>
                  </SelectItem>
                  <SelectItem value="short">
                    <span className="inline-flex items-center gap-1.5">
                      <TrendingDown className="size-3.5 text-red-500" />
                      Short
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Target Price (optional) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Target Price ($) <span className="text-zinc-400 dark:text-zinc-500">(optional)</span>
              </label>
              <Input
                type="number"
                step="any"
                min="0"
                placeholder="e.g. 115.00"
                value={targetPrice}
                onChange={(e) => { setTargetPrice(e.target.value); setResult(null); setCreatedTrade(null); }}
              />
            </div>
          </div>

          {/* Settings context */}
          {settings && (
            <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
              Defaults from settings: equity={formatCurrency(settings.startingAccountValue)},
              risk={settings.maxRiskPerTradePct ?? '-'}%
            </p>
          )}
          {settingsError && (
            <p className="mt-4 text-xs text-amber-600 dark:text-amber-400">
              Note: {settingsError} Using manual entry.
            </p>
          )}

          {/* Calculate button */}
          <div className="mt-6">
            <Button onClick={handleCalculate} size="lg">
              <Calculator className="size-4" />
              Calculate
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {calcError && (
        <div className="mb-8 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800/30 dark:bg-red-900/10 dark:text-red-400">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{calcError}</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="size-4 text-emerald-500" />
              Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Risk Per Share</div>
                <div className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                  {formatPrice(result.riskPerShare)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Position Size</div>
                <div className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                  {result.positionSize.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                  <span className="text-xs text-zinc-400">shares</span>
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Risk Amount</div>
                <div className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(result.riskAmount)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Reward:Risk</div>
                <div className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                  {result.rewardRiskRatio != null ? (
                    <span>
                      {result.rewardRiskRatio.toFixed(2)}
                      {result.rewardRiskRatio >= 2 && (
                        <Badge variant="secondary" className="ml-2 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          Good
                        </Badge>
                      )}
                      {result.rewardRiskRatio >= 1 && result.rewardRiskRatio < 2 && (
                        <Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          Fair
                        </Badge>
                      )}
                      {result.rewardRiskRatio < 1 && (
                        <Badge variant="secondary" className="ml-2 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          Poor
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="text-zinc-400">N/A (no target)</span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              onClick={handleCreatePlannedTrade}
              disabled={creating}
              variant="default"
            >
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating...
                </>
              ) : createdTrade ? (
                <>
                  <CheckCircle className="size-4" />
                  Trade Created
                </>
              ) : (
                <>
                  <TrendingUp className="size-4" />
                  Create Planned Trade
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Trade created link */}
      {createdTrade && (
        <Card className="mb-8 border-emerald-200 dark:border-emerald-800/30">
          <CardContent className="flex items-center gap-3 pt-4">
            <CheckCircle className="size-5 text-emerald-500" />
            <div className="flex-1 text-sm">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {createdTrade.tradeCode}
              </span>{' '}
              <span className="text-zinc-500 dark:text-zinc-400">
                created successfully.
              </span>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/trades/${createdTrade.id}`}>
                View Trade
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create error */}
      {createError && (
        <div className="mb-8 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800/30 dark:bg-red-900/10 dark:text-red-400">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{createError}</span>
        </div>
      )}
    </div>
  );
}
