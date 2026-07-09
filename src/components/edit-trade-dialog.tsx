'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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

export interface EditableTrade {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  accountId: string;
  setupId: string | null;
  thesis: string | null;
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
  plannedTarget2: number | null;
  plannedQuantity: number | null;
  invalidationCondition: string | null;
  preTradePlan: string | null;
}

interface SetupOption {
  id: string;
  name: string;
}

interface EditTradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trade: EditableTrade;
  onSaved: () => void;
  setupName?: string | null;
}

// ── Component ──────────────────────────────────────────────────────────

export default function EditTradeDialog({
  open,
  onOpenChange,
  trade,
  onSaved,
  setupName,
}: EditTradeDialogProps) {
  const [symbol, setSymbol] = useState(trade.symbol);
  const [direction, setDirection] = useState(trade.direction);
  const [setup, setSetup] = useState(setupName ?? '');
  const [setupOptions, setSetupOptions] = useState<SetupOption[]>([]);
  const [thesis, setThesis] = useState(trade.thesis ?? '');
  const [plannedEntry, setPlannedEntry] = useState(
    trade.plannedEntry?.toString() ?? '',
  );
  const [plannedStop, setPlannedStop] = useState(
    trade.plannedStop?.toString() ?? '',
  );
  const [plannedTarget1, setPlannedTarget1] = useState(
    trade.plannedTarget1?.toString() ?? '',
  );
  const [plannedTarget2, setPlannedTarget2] = useState(
    trade.plannedTarget2?.toString() ?? '',
  );
  const [plannedQuantity, setPlannedQuantity] = useState(
    trade.plannedQuantity?.toString() ?? '',
  );
  const [invalidationCondition, setInvalidationCondition] = useState(
    trade.invalidationCondition ?? '',
  );
  const [preTradePlan, setPreTradePlan] = useState(
    trade.preTradePlan ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch setup options when dialog opens
  useEffect(() => {
    if (open) {
      fetch('/api/setup-definitions')
        .then((r) => r.json())
        .then((result: { data?: SetupOption[] }) =>
          setSetupOptions(Array.isArray(result) ? result : (result.data ?? [])),
        )
        .catch(() => {
          // Silently fail — setup field will just have no options
        });
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!symbol.trim()) {
      setError('Symbol is required.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          direction,
          setup: setup === '__none__' ? null : (setup.trim() || null),
          thesis: thesis.trim() || null,
          plannedEntry: plannedEntry ? parseFloat(plannedEntry) : null,
          plannedStop: plannedStop ? parseFloat(plannedStop) : null,
          plannedTarget1: plannedTarget1 ? parseFloat(plannedTarget1) : null,
          plannedTarget2: plannedTarget2 ? parseFloat(plannedTarget2) : null,
          plannedQuantity: plannedQuantity ? parseFloat(plannedQuantity) : null,
          invalidationCondition: invalidationCondition.trim() || null,
          preTradePlan: preTradePlan.trim() || null,
        }),
      });

      if (!res.ok) {
        let errMsg = 'Failed to update trade.';
        try {
          const errBody = await res.json();
          if (errBody.error) errMsg = errBody.error;
          if (errBody.details?.fieldErrors) {
            const fieldMsgs = Object.entries(
              errBody.details.fieldErrors as Record<string, string[]>,
            )
              .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
              .join('; ');
            if (fieldMsgs) errMsg = fieldMsgs;
          }
        } catch {
          // Use default
        }
        setError(errMsg);
        setSubmitting(false);
        return;
      }

      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Network error. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Trade — {trade.symbol}</DialogTitle>
          <DialogDescription>
            Update the trade details below. Changes apply at any stage.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Symbol + Direction */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Symbol
              </label>
              <Input
                placeholder="e.g. AAPL"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Direction
              </label>
              <Select
                value={direction}
                onValueChange={(v: 'long' | 'short') => setDirection(v)}
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

          {/* Setup */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Setup
            </label>
            <Select
              value={setup}
              onValueChange={(v) => setSetup(v)}
              disabled={submitting}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select setup" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {setupOptions.map((s) => (
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
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Planned Entry
              </label>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={plannedEntry}
                onChange={(e) => setPlannedEntry(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Stop Loss
              </label>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={plannedStop}
                onChange={(e) => setPlannedStop(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Target 1
              </label>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={plannedTarget1}
                onChange={(e) => setPlannedTarget1(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Target 2
              </label>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={plannedTarget2}
                onChange={(e) => setPlannedTarget2(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {/* Quantity */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Quantity
            </label>
            <Input
              type="number"
              step="any"
              placeholder="0"
              value={plannedQuantity}
              onChange={(e) => setPlannedQuantity(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Thesis */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Thesis
            </label>
            <textarea
              rows={2}
              placeholder="Why are you taking this trade?"
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              disabled={submitting}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 resize-none"
            />
          </div>

          {/* Invalidation Condition */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Invalidation Condition
            </label>
            <textarea
              rows={2}
              placeholder="What would invalidate this trade idea?"
              value={invalidationCondition}
              onChange={(e) => setInvalidationCondition(e.target.value)}
              disabled={submitting}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 resize-none"
            />
          </div>

          {/* Pre-Trade Plan */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Pre-Trade Plan
            </label>
            <textarea
              rows={2}
              placeholder="Your plan before executing this trade"
              value={preTradePlan}
              onChange={(e) => setPreTradePlan(e.target.value)}
              disabled={submitting}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 resize-none"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1 size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
