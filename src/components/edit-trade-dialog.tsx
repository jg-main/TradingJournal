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
  status: 'planned' | 'open' | 'closed' | 'deleted';
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
  /**
   * M002-A4: true once the trade has any accepted economic execution history.
   * The complete pre-trade context (geometry + thesis + invalidation +
   * pre-trade plan) is then historical evidence and rendered read-only.
   */
  preTradeFrozen: boolean;
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

  // M002-A4: the complete pre-trade context is immutable once the trade has
  // any accepted economic execution history (execution-history predicate from
  // the API — NOT derived status, so a correction-reopened trade stays
  // frozen). Planning geometry AND thesis / invalidationCondition /
  // preTradePlan render read-only and are omitted from the PUT body; the
  // backend independently enforces the same contract.
  const planningLocked = trade.preTradeFrozen;

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
          // The complete pre-trade context (geometry + thesis + invalidation +
          // pre-trade plan) is frozen once the trade has execution history
          // (M002-A4): the backend rejects any of these fields for an executed
          // trade, so omit them client-side entirely.
          ...(planningLocked
            ? {}
            : {
                symbol: symbol.trim().toUpperCase(),
                direction,
                setup: setup === '__none__' ? null : (setup.trim() || null),
                plannedEntry: plannedEntry ? parseFloat(plannedEntry) : null,
                plannedStop: plannedStop ? parseFloat(plannedStop) : null,
                plannedTarget1: plannedTarget1 ? parseFloat(plannedTarget1) : null,
                plannedTarget2: plannedTarget2 ? parseFloat(plannedTarget2) : null,
                plannedQuantity: plannedQuantity ? parseFloat(plannedQuantity) : null,
                thesis: thesis.trim() || null,
                invalidationCondition: invalidationCondition.trim() || null,
                preTradePlan: preTradePlan.trim() || null,
              }),
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
            {planningLocked
              ? trade.status === 'open'
                ? 'Update trade details. Planning fields are locked after the first fill; the active stop is managed through Adjust Stop.'
                : 'Update trade details. Planning fields are historical and locked after the first fill.'
              : 'Update the trade details below. Changes apply at any stage.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {planningLocked && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              The complete pre-trade context (planning geometry, thesis,
              invalidation condition, pre-trade plan) is frozen historical
              evidence after the first fill. Post-entry notes belong in exit
              notes, lesson, and review.
            </div>
          )}

          {/* Symbol + Direction */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Symbol
              </label>
              <Input
                placeholder="e.g. AAPL"
                value={planningLocked ? trade.symbol : symbol}
                onChange={(e) => setSymbol(e.target.value)}
                readOnly={planningLocked}
                aria-readonly={planningLocked ? 'true' : undefined}
                disabled={submitting}
                className={
                  planningLocked
                    ? 'cursor-not-allowed bg-input/50 opacity-60'
                    : undefined
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Direction
              </label>
              <Select
                value={planningLocked ? trade.direction : direction}
                onValueChange={(v: 'long' | 'short') => setDirection(v)}
                disabled={submitting || planningLocked}
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
            <label className="text-xs font-medium text-muted-foreground">
              Setup
            </label>
            <Select
              value={setup}
              onValueChange={(v) => setSetup(v)}
              disabled={submitting || planningLocked}
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
              <label className="text-xs font-medium text-muted-foreground">
                Planned Entry
              </label>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={
                  planningLocked
                    ? (trade.plannedEntry?.toString() ?? '')
                    : plannedEntry
                }
                onChange={(e) => setPlannedEntry(e.target.value)}
                readOnly={planningLocked}
                aria-readonly={planningLocked ? 'true' : undefined}
                disabled={submitting}
                className={
                  planningLocked
                    ? 'cursor-not-allowed bg-input/50 opacity-60'
                    : undefined
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {planningLocked ? 'Original Planned Stop' : 'Stop Loss'}
              </label>
              {planningLocked ? (
                <>
                  <Input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={trade.plannedStop?.toString() ?? ''}
                    readOnly
                    aria-readonly="true"
                    className="cursor-not-allowed bg-input/50 opacity-60"
                  />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {trade.status === 'open'
                      ? 'Read-only — the active stop is managed through Adjust Stop.'
                      : 'Read-only — planning fields can only be changed while the trade is planned.'}
                  </p>
                </>
              ) : (
                <Input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={plannedStop}
                  onChange={(e) => setPlannedStop(e.target.value)}
                  disabled={submitting}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Target 1
              </label>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={
                  planningLocked
                    ? (trade.plannedTarget1?.toString() ?? '')
                    : plannedTarget1
                }
                onChange={(e) => setPlannedTarget1(e.target.value)}
                readOnly={planningLocked}
                aria-readonly={planningLocked ? 'true' : undefined}
                disabled={submitting}
                className={
                  planningLocked
                    ? 'cursor-not-allowed bg-input/50 opacity-60'
                    : undefined
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Target 2
              </label>
              <Input
                type="number"
                step="any"
                placeholder="0.00"
                value={
                  planningLocked
                    ? (trade.plannedTarget2?.toString() ?? '')
                    : plannedTarget2
                }
                onChange={(e) => setPlannedTarget2(e.target.value)}
                readOnly={planningLocked}
                aria-readonly={planningLocked ? 'true' : undefined}
                disabled={submitting}
                className={
                  planningLocked
                    ? 'cursor-not-allowed bg-input/50 opacity-60'
                    : undefined
                }
              />
            </div>
          </div>

          {/* Quantity */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Quantity
            </label>
            <Input
              type="number"
              step="any"
              placeholder="0"
              value={
                planningLocked
                  ? (trade.plannedQuantity?.toString() ?? '')
                  : plannedQuantity
              }
              onChange={(e) => setPlannedQuantity(e.target.value)}
              readOnly={planningLocked}
              aria-readonly={planningLocked ? 'true' : undefined}
              disabled={submitting}
              className={
                planningLocked
                  ? 'cursor-not-allowed bg-input/50 opacity-60'
                  : undefined
              }
            />
          </div>

          {/* Thesis — pre-trade rationale; frozen once the trade has execution
              history (M002-A4). Review discusses it; it is never rewritten. */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Thesis
            </label>
            <textarea
              rows={2}
              placeholder="Why are you taking this trade?"
              value={planningLocked ? (trade.thesis ?? '') : thesis}
              onChange={(e) => setThesis(e.target.value)}
              disabled={submitting || planningLocked}
              readOnly={planningLocked}
              aria-readonly={planningLocked ? 'true' : undefined}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 resize-none"
            />
          </div>

          {/* Invalidation Condition — records what would prove the idea wrong
              BEFORE the outcome is known; frozen after execution. */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Invalidation Condition
            </label>
            <textarea
              rows={2}
              placeholder="What would invalidate this trade idea?"
              value={planningLocked ? (trade.invalidationCondition ?? '') : invalidationCondition}
              onChange={(e) => setInvalidationCondition(e.target.value)}
              disabled={submitting || planningLocked}
              readOnly={planningLocked}
              aria-readonly={planningLocked ? 'true' : undefined}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 resize-none"
            />
          </div>

          {/* Pre-Trade Plan — intended management before execution; actual
              management is the execution/adjustment stream. Frozen after
              execution so plan vs actual stays distinguishable. */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Pre-Trade Plan
            </label>
            <textarea
              rows={2}
              placeholder="Your plan before executing this trade"
              value={planningLocked ? (trade.preTradePlan ?? '') : preTradePlan}
              onChange={(e) => setPreTradePlan(e.target.value)}
              disabled={submitting || planningLocked}
              readOnly={planningLocked}
              aria-readonly={planningLocked ? 'true' : undefined}
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
