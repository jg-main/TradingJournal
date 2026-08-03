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

interface Account {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
  startingBalance: number | null;
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
  useEffect(() => { document.title = "Sizing — Trading Journal"; }, []);
  // ── Settings state ──────────────────────────────────────────────────
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // ── Accounts state ──────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');

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

  // ── Load settings and accounts ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setSettingsLoading(true);
      setSettingsError(null);

      try {
        const [settingsRes, accountsRes] = await Promise.all([
          fetch('/api/settings'),
          fetch('/api/accounts'),
        ]);

        if (cancelled) return;

        // Settings
        if (settingsRes.ok) {
          const data: SettingsData = await settingsRes.json();
          if (!cancelled) {
            setSettings(data);
            if (data.startingAccountValue != null) {
              setAccountEquity(String(data.startingAccountValue));
            }
            if (data.maxRiskPerTradePct != null) {
              setRiskPerTradePct(String(data.maxRiskPerTradePct));
            }
          }
        } else if (settingsRes.status !== 200) {
          if (!cancelled) {
            setSettingsError('Failed to load settings.');
          }
        }

        // Accounts
        if (accountsRes.ok) {
          const data: Account[] = await accountsRes.json();
          if (!cancelled) {
            setAccounts(data ?? []);
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

    loadData();
    return () => { cancelled = true; };
  }, []);

  // ── Account change handler ─────────────────────────────────────────

  function handleAccountChange(accountId: string) {
    setSelectedAccountId(accountId);
    setResult(null);
    setCreatedTrade(null);
    setCreateError(null);

    if (!accountId) {
      // Revert to settings defaults
      if (settings?.startingAccountValue != null) {
        setAccountEquity(String(settings.startingAccountValue));
      } else {
        setAccountEquity('');
      }
      if (settings?.maxRiskPerTradePct != null) {
        setRiskPerTradePct(String(settings.maxRiskPerTradePct));
      } else {
        setRiskPerTradePct('');
      }
      return;
    }

    const account = accounts.find((a) => a.id === accountId);
    if (account) {
      if (account.startingBalance != null) {
        setAccountEquity(String(account.startingBalance));
      } else if (settings?.startingAccountValue != null) {
        setAccountEquity(String(settings.startingAccountValue));
      } else {
        setAccountEquity('');
      }

      if (account.maxRiskPerTradePct != null) {
        setRiskPerTradePct(String(account.maxRiskPerTradePct));
      } else if (settings?.maxRiskPerTradePct != null) {
        setRiskPerTradePct(String(settings.maxRiskPerTradePct));
      } else {
        setRiskPerTradePct('');
      }
    }
  }

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
          accountId: selectedAccountId || null,
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
        <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading position sizing...</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-foreground">
        Sizing
      </h1>

      {/* Calculator Card */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="size-4 text-muted-foreground" />
            Position Size Calculator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Account Equity */}
            <div className="space-y-1.5">
              <label htmlFor="sizing-accountEquity" className="text-xs font-medium text-muted-foreground">
                Account Equity ($)
              </label>
              <Input
                id="sizing-accountEquity"
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
              <label htmlFor="sizing-riskPerTrade" className="text-xs font-medium text-muted-foreground">
                Risk Per Trade (%)
              </label>
              <Input
                id="sizing-riskPerTrade"
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
              <label htmlFor="sizing-entryPrice" className="text-xs font-medium text-muted-foreground">
                Entry Price ($)
              </label>
              <Input
                id="sizing-entryPrice"
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
              <label htmlFor="sizing-stopPrice" className="text-xs font-medium text-muted-foreground">
                Stop Price ($)
              </label>
              <Input
                id="sizing-stopPrice"
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
              <label htmlFor="sizing-direction" className="text-xs font-medium text-muted-foreground">
                Direction
              </label>
              <Select
                value={direction}
                onValueChange={(v: Direction) => { setDirection(v); setResult(null); setCreatedTrade(null); }}
              >
                <SelectTrigger id="sizing-direction" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">
                    <span className="inline-flex items-center gap-1.5">
                      <TrendingUp className="size-3.5 text-positive" />
                      Long
                    </span>
                  </SelectItem>
                  <SelectItem value="short">
                    <span className="inline-flex items-center gap-1.5">
                      <TrendingDown className="size-3.5 text-negative" />
                      Short
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Target Price (optional) */}
            <div className="space-y-1.5">
              <label htmlFor="sizing-targetPrice" className="text-xs font-medium text-muted-foreground">
                Target Price ($) <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="sizing-targetPrice"
                type="number"
                step="any"
                min="0"
                placeholder="e.g. 115.00"
                value={targetPrice}
                onChange={(e) => { setTargetPrice(e.target.value); setResult(null); setCreatedTrade(null); }}
              />
            </div>
          </div>

          {/* Account selector */}
          <div className="mt-4 space-y-1.5">
            <label htmlFor="sizing-account" className="text-xs font-medium text-muted-foreground">
              Account
            </label>
            <Select
              value={selectedAccountId}
              onValueChange={handleAccountChange}
            >
              <SelectTrigger id="sizing-account" className="w-full sm:w-72">
                <SelectValue placeholder="Using global defaults" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Using global defaults</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}{a.broker ? ` (${a.broker})` : ''}
                  </SelectItem>
                ))}
                {accounts.length === 0 && (
                  <SelectItem value="__none__" disabled>
                    No accounts found
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {selectedAccountId && (
              <p className="text-xs text-positive">
                Using account: {accounts.find((a) => a.id === selectedAccountId)?.name ?? 'Unknown'}
              </p>
            )}
            {!selectedAccountId && (
              <p className="text-xs text-muted-foreground">
                Using global defaults from settings
              </p>
            )}
          </div>

          {/* Settings context */}
          {settings && !selectedAccountId && (
            <p className="mt-4 text-xs text-muted-foreground">
              Defaults from settings: equity={formatCurrency(settings.startingAccountValue)},
              risk={settings.maxRiskPerTradePct ?? '-'}%
            </p>
          )}
          {settingsError && (
            <p className="mt-4 text-xs text-warning">
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
        <div className="mb-8 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{calcError}</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="size-4 text-positive" />
              Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">Risk Per Share</div>
                <div className="tabular-nums font-medium text-foreground">
                  {formatPrice(result.riskPerShare)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Position Size</div>
                <div className="tabular-nums font-medium text-foreground">
                  {result.positionSize.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                  <span className="text-xs text-muted-foreground">shares</span>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Risk Amount</div>
                <div className="tabular-nums font-medium text-foreground">
                  {formatCurrency(result.riskAmount)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Reward:Risk</div>
                <div className="tabular-nums font-medium text-foreground">
                  {result.rewardRiskRatio != null ? (
                    <span>
                      {result.rewardRiskRatio.toFixed(2)}
                      {result.rewardRiskRatio >= 2 && (
                        <Badge variant="secondary" className="ml-2 bg-positive/10 text-positive">
                          Good
                        </Badge>
                      )}
                      {result.rewardRiskRatio >= 1 && result.rewardRiskRatio < 2 && (
                        <Badge variant="secondary" className="ml-2 bg-warning/10 text-warning">
                          Fair
                        </Badge>
                      )}
                      {result.rewardRiskRatio < 1 && (
                        <Badge variant="secondary" className="ml-2 bg-negative/10 text-negative">
                          Poor
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">N/A (no target)</span>
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
        <Card className="mb-8 border-positive/30">
          <CardContent className="flex items-center gap-3 pt-4">
            <CheckCircle className="size-5 text-positive" />
            <div className="flex-1 text-sm">
              <span className="font-medium text-foreground">
                {createdTrade.tradeCode}
              </span>{' '}
              <span className="text-muted-foreground">
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
        <div className="mb-8 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{createError}</span>
        </div>
      )}
    </div>
  );
}
