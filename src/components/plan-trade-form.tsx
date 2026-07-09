'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { HelpTooltip } from '@/components/help-tooltip';

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Types ──────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isActive: boolean;
  maxRiskPerTradePct: number | null;
  defaultCommission: number | null;
  startingBalance: number | null;
}

export interface SetupDefinition {
  id: string;
  name: string;
  description: string | null;
  howToPlay: string | null;
  entryRules: string | null;
  exitRules: string | null;
  isActive: boolean;
}

export interface PlanTradeFormProps {
  accounts: Account[];
  setups: SetupDefinition[];
  defaultAccountId: string | null;
  onSuccess: (tradeId: string) => void;
  onCancel: () => void;
}

interface TradeForm {
  symbol: string;
  direction: 'long' | 'short';
  accountId: string;
  setup: string;
  thesis: string;
  plannedEntry: string;
  plannedStop: string;
  plannedTarget1: string;
  plannedQuantity: string;
  invalidationCondition: string;
  preTradePlan: string;
}

const EMPTY_FORM: TradeForm = {
  symbol: '',
  direction: 'long',
  accountId: '',
  setup: '',
  thesis: '',
  plannedEntry: '',
  plannedStop: '',
  plannedTarget1: '',
  plannedQuantity: '',
  invalidationCondition: '',
  preTradePlan: '',
};

// ── Component ──────────────────────────────────────────────────────────

export default function PlanTradeForm({
  accounts,
  setups,
  defaultAccountId,
  onSuccess,
  onCancel,
}: PlanTradeFormProps) {
  const [form, setForm] = useState<TradeForm>(() => ({
    ...EMPTY_FORM,
    accountId: defaultAccountId ?? '',
  }));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeAccounts = accounts.filter((a) => a.isActive);
  const activeSetups = setups.filter((s) => s.isActive);

  const updateField = <K extends keyof TradeForm>(
    field: K,
    value: TradeForm[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.symbol.trim()) {
      setError('Symbol is required.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: form.symbol.trim().toUpperCase(),
          direction: form.direction,
          accountId: form.accountId || null,
          setup: form.setup.trim() || null,
          thesis: form.thesis.trim() || null,
          plannedEntry: form.plannedEntry ? parseFloat(form.plannedEntry) : null,
          plannedStop: form.plannedStop ? parseFloat(form.plannedStop) : null,
          plannedTarget1: form.plannedTarget1 ? parseFloat(form.plannedTarget1) : null,
          plannedQuantity: form.plannedQuantity ? parseFloat(form.plannedQuantity) : null,
          invalidationCondition: form.invalidationCondition.trim() || null,
          preTradePlan: form.preTradePlan.trim() || null,
        }),
      });

      if (!res.ok) {
        let errMsg = 'Failed to create trade.';
        try {
          const errBody = await res.json();
          if (errBody.error) errMsg = errBody.error;
          if (errBody.details?.fieldErrors) {
            const fieldMsgs = Object.entries(errBody.details.fieldErrors as Record<string, string[]>)
              .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
              .join('; ');
            if (fieldMsgs) errMsg = fieldMsgs;
          }
        } catch {
          // Use default error message
        }
        setError(errMsg);
        setSubmitting(false);
        return;
      }

      const trade = await res.json();
      onSuccess(trade.id);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : 'Network error. Please try again.'));
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Plan Trade</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Symbol + Direction */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Symbol
                </label>
                <HelpTooltip content="Ticker symbol of the asset you plan to trade (e.g. AAPL, MSFT)" />
              </div>
              <Input
                placeholder="e.g. AAPL"
                value={form.symbol}
                onChange={(e) => updateField('symbol', e.target.value)}
                autoFocus
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Direction
                </label>
                <HelpTooltip content="Long = buy expecting price increase. Short = sell expecting price decrease." />
              </div>
              <Select
                value={form.direction}
                onValueChange={(v: 'long' | 'short') => updateField('direction', v)}
                disabled={submitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">Long</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Account */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Account
              </label>
              <HelpTooltip content="The brokerage account this trade will be executed in" />
            </div>
            <Select
              value={form.accountId}
              onValueChange={(v) => updateField('accountId', v)}
              disabled={submitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {activeAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}{a.broker ? ` (${a.broker})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Setup */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Setup
              </label>
              <HelpTooltip content="The trading setup or strategy pattern that triggered this trade idea" />
            </div>
            <Select
              value={form.setup}
              onValueChange={(v) => updateField('setup', v)}
              disabled={submitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select setup" />
              </SelectTrigger>
              <SelectContent>
                {activeSetups.map((s) => (
                  <SelectItem key={s.id} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Price fields in 2x2 grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Planned Entry
                </label>
                <HelpTooltip content="Your intended entry price for this trade" />
              </div>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={form.plannedEntry}
                onChange={(e) => updateField('plannedEntry', e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Stop Loss
                </label>
                <HelpTooltip content="Maximum acceptable loss level to limit downside risk" />
              </div>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={form.plannedStop}
                onChange={(e) => updateField('plannedStop', e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Target 1
                </label>
                <HelpTooltip content="First profit-taking level for this trade" />
              </div>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={form.plannedTarget1}
                onChange={(e) => updateField('plannedTarget1', e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Qty
                </label>
                <HelpTooltip content="Number of shares or contracts to trade" />
              </div>
              <Input
                type="number"
                step="any"
                placeholder="0"
                value={form.plannedQuantity}
                onChange={(e) => updateField('plannedQuantity', e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {/* Thesis */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Thesis
              </label>
              <HelpTooltip content="Your reasoning and analysis supporting this trade idea" />
            </div>
            <textarea
              rows={2}
              placeholder="Why are you taking this trade?"
              value={form.thesis}
              onChange={(e) => updateField('thesis', e.target.value)}
              disabled={submitting}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 resize-none"
            />
          </div>

          {/* Invalidation Condition */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Invalidation Condition
              </label>
              <HelpTooltip content="What market conditions or price levels would invalidate this trade idea" />
            </div>
            <textarea
              rows={2}
              placeholder="What would prove this trade idea wrong?"
              value={form.invalidationCondition}
              onChange={(e) => updateField('invalidationCondition', e.target.value)}
              disabled={submitting}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 resize-none"
            />
          </div>

          {/* Pre-Trade Plan */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Pre-Trade Plan
              </label>
              <HelpTooltip content="Your step-by-step plan: entry criteria, position sizing, risk management approach, and trade management rules" />
            </div>
            <textarea
              rows={3}
              placeholder="What is your execution plan for this trade?"
              value={form.preTradePlan}
              onChange={(e) => updateField('preTradePlan', e.target.value)}
              disabled={submitting}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 resize-none"
            />
          </div>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-1 size-4 animate-spin" />
                Planning...
              </>
            ) : (
              'Plan Trade'
            )}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
