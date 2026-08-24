'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Loader2, Plus, X, Check, ArrowLeft } from 'lucide-react';
import { useAppTimezone } from '@/lib/timezone-context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Types ──────────────────────────────────────────────────────────────

export interface ExecuteTradeData {
  id: string;
  tradeCode: string;
  symbol: string;
  direction: 'long' | 'short';
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
  plannedQuantity: number | null;
  accountId: string | null;
  setupId: string | null;
}

type DialogStep = 'loading' | 'setup-picker' | 'checklist' | 'entry-form';

interface SetupDefinition {
  id: string;
  name: string;
  description: string | null;
}

interface ChecklistItem {
  id: string;
  description: string;
  sortOrder: number | null;
}

interface ExecuteDialogProps {
  trade: ExecuteTradeData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

interface FormState {
  entryPrice: string;
  stopPrice: string;
  entryQuantity: string;
  exit1Price: string;
  exit1Quantity: string;
  showExit2: boolean;
  exit2Price: string;
  exit2Quantity: string;
  executedAt: string;
  fees: string;
}

// ── Constants ──────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring';

const labelClass =
  'mb-1 block text-sm font-medium text-foreground';

// ── Helpers ────────────────────────────────────────────────────────────

function getInitialStep(trade: ExecuteTradeData): DialogStep {
  if (!trade.accountId) return 'entry-form';
  if (!trade.setupId) return 'setup-picker';
  return 'loading';
}

function buildInitialState(trade: ExecuteTradeData, executedAt: string): FormState {
  return {
    entryPrice: trade.plannedEntry?.toString() ?? '',
    stopPrice: trade.plannedStop?.toString() ?? '',
    entryQuantity: trade.plannedQuantity?.toString() ?? '',
    exit1Price: '',
    exit1Quantity: '',
    showExit2: false,
    exit2Price: '',
    exit2Quantity: '',
    executedAt,
    fees: '0',
  };
}

// ── Component ──────────────────────────────────────────────────────────

export function ExecuteDialog({
  trade,
  open,
  onOpenChange,
  onComplete,
}: ExecuteDialogProps) {
  const { nowDatetimeLocal } = useAppTimezone();
  // ── Form state (entry form step) ───────────────────────────────────
  const [form, setForm] = useState<FormState>(() => buildInitialState(trade, nowDatetimeLocal()));
  const [submitting, setSubmitting] = useState(false);

  // ── Step state ─────────────────────────────────────────────────────
  const [step, setStep] = useState<DialogStep>(() => getInitialStep(trade));
  const [error, setError] = useState<string | null>(null);

  const [setupDefinitions, setSetupDefinitions] = useState<SetupDefinition[]>([]);
  const [loadingSetups, setLoadingSetups] = useState(false);
  const [selectedSetupId, setSelectedSetupId] = useState<string | null>(null);
  const [savingSetup, setSavingSetup] = useState(false);

  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loadingChecklist, setLoadingChecklist] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // True when the trade originally had no setupId — controls Back button visibility
  const originalSetupWasNull = trade.setupId === null;

  // ── Derived state ──────────────────────────────────────────────────

  const exit1QuantityValue = parseFloat(form.exit1Quantity) || 0;
  const exit2QuantityValue = parseFloat(form.exit2Quantity) || 0;
  const entryQuantityValue = parseFloat(form.entryQuantity) || 0;
  const totalExitQty = exit1QuantityValue + exit2QuantityValue;

  const allChecksChecked =
    checklist.length > 0 && checkedIds.size === checklist.length;

  // ── API helpers ────────────────────────────────────────────────────

  const fetchSetupDefinitions = useCallback(async () => {
    setLoadingSetups(true);
    setError(null);
    try {
      const res = await fetch('/api/setup-definitions');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to load setup definitions');
      }
      const json = await res.json();
      setSetupDefinitions(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load setup definitions');
    } finally {
      setLoadingSetups(false);
    }
  }, []);

  const fetchMergedChecklist = useCallback(
    async (accountId: string, setupId: string) => {
      setLoadingChecklist(true);
      setError(null);
      try {
        const params = new URLSearchParams({ accountId, setupId });
        const res = await fetch(`/api/checks/merged?${params}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? 'Failed to load checklist');
        }
        const rows: ChecklistItem[] = await res.json();
        setChecklist(rows);
        setCheckedIds(new Set());
        return rows;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load checklist');
        return [] as ChecklistItem[];
      } finally {
        setLoadingChecklist(false);
      }
    },
    [],
  );

  // ── Initialize on mount (async checklist fetch) ───────────────────
  // Synchronous initial step is already set by getInitialStep() in useState.
  // This effect only handles the async checklist fetch when step is 'loading'
  // (meaning both accountId and setupId exist). The fetch and state updates
  // are chained in .then() callbacks to keep the effect body clear of synchronous
  // setState.
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    if (!trade.accountId || !trade.setupId) return;

    const params = new URLSearchParams({
      accountId: trade.accountId,
      setupId: trade.setupId,
    });

    fetch(`/api/checks/merged?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Checklist fetch failed'))))
      .then((rows: ChecklistItem[]) => {
        setChecklist(rows);
        setCheckedIds(new Set());
        setStep(rows.length === 0 ? 'entry-form' : 'checklist');
      })
      .catch(() => {
        setError('Failed to load checklist — proceeding without gating.');
        setStep('entry-form');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Validation ─────────────────────────────────────────────────────

  const validate = useCallback((): string | null => {
    const ep = parseFloat(form.entryPrice);
    const eq = parseFloat(form.entryQuantity);
    if (!ep || ep <= 0) return 'Entry price must be greater than 0.';
    if (!eq || eq <= 0) return 'Entry quantity must be greater than 0.';

    const e1p = form.exit1Price.trim();
    const e1q = form.exit1Quantity.trim();
    const hasExit1 = e1p !== '';
    if (hasExit1) {
      const p = parseFloat(e1p);
      const q = parseFloat(e1q);
      if (!p || p <= 0) return 'Exit 1 price must be greater than 0.';
      if (!q || q <= 0) return 'Exit 1 quantity must be greater than 0.';
    }

    if (form.showExit2) {
      const e2p = parseFloat(form.exit2Price);
      const e2q = parseFloat(form.exit2Quantity);
      if (!e2p || e2p <= 0) return 'Exit 2 price must be greater than 0.';
      if (!e2q || e2q <= 0) return 'Exit 2 quantity must be greater than 0.';
    }

    if (totalExitQty > entryQuantityValue) {
      return 'Total exit quantity exceeds entry quantity.';
    }

    const fee = parseFloat(form.fees);
    if (isNaN(fee) || fee < 0) return 'Fees must be 0 or greater.';

    return null;
  }, [form, totalExitQty, entryQuantityValue]);

  // ── Step: Setup picker ─────────────────────────────────────────────

  const handleSetupSelect = useCallback(
    async (setupDefId: string) => {
      setSavingSetup(true);
      setError(null);
      try {
        const res = await fetch(`/api/trades/${trade.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setupId: setupDefId }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? 'Failed to save setup');
        }

        setSelectedSetupId(setupDefId);

        // If no account, skip checklist
        if (!trade.accountId) {
          setStep('entry-form');
          return;
        }

        // Fetch merged checklist and transition
        const rows = await fetchMergedChecklist(trade.accountId, setupDefId);
        if (rows.length === 0) {
          setStep('entry-form');
        } else {
          setStep('checklist');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save setup');
      } finally {
        setSavingSetup(false);
      }
    },
    [trade.id, trade.accountId, fetchMergedChecklist],
  );

  // ── Step: Checklist ────────────────────────────────────────────────

  const toggleCheck = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleProceedToEntry = useCallback(() => {
    setStep('entry-form');
  }, []);

  // ── Step: Entry form submit ────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        entryPrice: parseFloat(form.entryPrice),
        entryQuantity: parseFloat(form.entryQuantity),
        fees: parseFloat(form.fees) || 0,
      };

      // One idempotency key per submit attempt (S03): retrying the same
      // bulk request with the same key is replay-safe through the P1 adapter
      // (derives :entry/:exit1/:exit2 keys) and the canonical engine.
      body.idempotencyKey = crypto.randomUUID();

      if (form.stopPrice.trim()) {
        body.stopPrice = parseFloat(form.stopPrice);
      }

      if (form.executedAt.trim()) {
        body.executedAt = form.executedAt;
      }

      const e1p = form.exit1Price.trim();
      const e1q = form.exit1Quantity.trim();
      if (e1p) {
        body.exit1Price = parseFloat(e1p);
        body.exit1Quantity = e1q ? parseFloat(e1q) : parseFloat(form.entryQuantity);
      }

      if (form.showExit2) {
        const e2p = form.exit2Price.trim();
        const e2q = form.exit2Quantity.trim();
        if (e2p && e2q) {
          body.exit2Price = parseFloat(e2p);
          body.exit2Quantity = parseFloat(e2q);
        }
      }

      // Include checkResults if we went through checklist gating
      if (checklist.length > 0) {
        body.checkResults = Array.from(checkedIds).map((id) => ({
          checklistDefinitionId: id,
          passed: true,
        }));
      }

      const res = await fetch(`/api/trades/${trade.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        const detailMsg = err.details
          ? typeof err.details === 'string'
            ? err.details
            : JSON.stringify(err.details)
          : err.error ?? 'Execution failed.';
        setError(detailMsg);
        setSubmitting(false);
        return;
      }

      onComplete();
      handleOpenChange(false);
      setForm(buildInitialState(trade, nowDatetimeLocal()));
      setError(null);
    } catch {
      setError('Failed to execute trade. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Field updater ──────────────────────────────────────────────────

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  // ── Reset on dialog close ──────────────────────────────────────────

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setForm(buildInitialState(trade, nowDatetimeLocal()));
      setError(null);
      setStep('loading');
      setChecklist([]);
      setCheckedIds(new Set());
      setSetupDefinitions([]);
      setSelectedSetupId(null);
      setSavingSetup(false);
      setLoadingSetups(false);
      setLoadingChecklist(false);
      setSubmitting(false);
    }
    onOpenChange(open);
  };

  // ── Step descriptions ──────────────────────────────────────────────

  const stepDescription: Record<DialogStep, string> = {
    loading: 'Loading...',
    'setup-picker': 'Select a setup for this trade before proceeding with execution.',
    checklist: 'Complete all pre-execution checklist items.',
    'entry-form': `Record entry and optional exit(s) for trade ${trade.tradeCode}.`,
  };

  // ── Render: Loading ────────────────────────────────────────────────

  if (step === 'loading') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Execute {trade.direction === 'long' ? 'Long' : 'Short'}: {trade.symbol}
            </DialogTitle>
            <DialogDescription>Loading...</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Render: Setup Picker ───────────────────────────────────────────

  if (step === 'setup-picker') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Execute {trade.direction === 'long' ? 'Long' : 'Short'}: {trade.symbol}
            </DialogTitle>
            <DialogDescription>{stepDescription['setup-picker']}</DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className={labelClass}>Setup</label>
              {loadingSetups ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading setups...
                </div>
              ) : setupDefinitions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No setup definitions found. Create one first.
                </p>
              ) : (
                <Select
                  value={selectedSetupId ?? ''}
                  onValueChange={handleSetupSelect}
                  disabled={savingSetup}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a setup..." />
                  </SelectTrigger>
                  <SelectContent>
                    {setupDefinitions.map((sd) => (
                      <SelectItem key={sd.id} value={sd.id}>
                        {sd.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {savingSetup && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Saving setup...
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Render: Checklist ──────────────────────────────────────────────

  if (step === 'checklist') {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Execute {trade.direction === 'long' ? 'Long' : 'Short'}: {trade.symbol}
            </DialogTitle>
            <DialogDescription>{stepDescription.checklist}</DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {loadingChecklist ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="mb-1 text-sm font-semibold text-foreground">
                  Pre-Execution Checklist
                </h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  All items must be checked before proceeding.
                </p>
                <div className="space-y-2">
                  {checklist.map((item) => (
                    <label
                      key={item.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2.5 hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={checkedIds.has(item.id)}
                        onChange={() => toggleCheck(item.id)}
                        className="mt-0.5 size-4 accent-foreground"
                      />
                      <span className="text-sm text-foreground">
                        {item.description}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex gap-2">
                {originalSetupWasNull && (
                  <button
                    type="button"
                    onClick={() => {
                      setStep('setup-picker');
                      fetchSetupDefinitions();
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    <ArrowLeft className="size-3.5" />
                    Back
                  </button>
                )}
                <DialogClose asChild>
                  <button
                    type="button"
                    className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                </DialogClose>
              </div>
              <button
                type="button"
                onClick={handleProceedToEntry}
                disabled={!allChecksChecked}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 disabled:opacity-50 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
              >
                <Check className="size-3.5" />
                Proceed
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Render: Entry Form ────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Execute {trade.direction === 'long' ? 'Long' : 'Short'}: {trade.symbol}
          </DialogTitle>
          <DialogDescription>{stepDescription['entry-form']}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ── Entry / Stop row ────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="entryPrice" className={labelClass}>
                Entry Price *
              </label>
              <input
                id="entryPrice"
                type="number"
                step="any"
                value={form.entryPrice}
                onChange={set('entryPrice')}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="stopPrice" className={labelClass}>
                Stop Price
              </label>
              <input
                id="stopPrice"
                type="number"
                step="any"
                value={form.stopPrice}
                onChange={set('stopPrice')}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="entryQuantity" className={labelClass}>
                Size *
              </label>
              <input
                id="entryQuantity"
                type="number"
                step="any"
                value={form.entryQuantity}
                onChange={set('entryQuantity')}
                className={inputClass}
                placeholder="0"
              />
            </div>
          </div>

          {/* ── Fees / Date ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fees" className={labelClass}>
                Fees
              </label>
              <input
                id="fees"
                type="number"
                step="any"
                min="0"
                value={form.fees}
                onChange={set('fees')}
                className={inputClass}
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="executedAt" className={labelClass}>
                Executed At
              </label>
              <input
                id="executedAt"
                type="datetime-local"
                value={form.executedAt}
                onChange={set('executedAt')}
                className={inputClass}
              />
            </div>
          </div>

          {/* ── Divider ────────────────────────────────────────────── */}
          <hr className="border-border" />

          {/* ── Exit 1 ─────────────────────────────────────────────── */}
          <div>
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">
              Exit 1
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="exit1Price" className={labelClass}>
                  Exit 1 Price
                </label>
                <input
                  id="exit1Price"
                  type="number"
                  step="any"
                  value={form.exit1Price}
                  onChange={set('exit1Price')}
                  className={inputClass}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label htmlFor="exit1Quantity" className={labelClass}>
                  Exit 1 Quantity
                </label>
                <input
                  id="exit1Quantity"
                  type="number"
                  step="any"
                  value={form.exit1Quantity}
                  onChange={set('exit1Quantity')}
                  className={inputClass}
                  placeholder="Defaults to entry size"
                />
              </div>
            </div>
          </div>

          {/* ── Exit 2 toggle + fields ─────────────────────────────── */}
          {form.showExit2 ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Exit 2
                </h4>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      showExit2: false,
                      exit2Price: '',
                      exit2Quantity: '',
                    }))
                  }
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="exit2Price" className={labelClass}>
                    Exit 2 Price *
                  </label>
                  <input
                    id="exit2Price"
                    type="number"
                    step="any"
                    value={form.exit2Price}
                    onChange={set('exit2Price')}
                    className={inputClass}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label htmlFor="exit2Quantity" className={labelClass}>
                    Exit 2 Quantity *
                  </label>
                  <input
                    id="exit2Quantity"
                    type="number"
                    step="any"
                    value={form.exit2Quantity}
                    onChange={set('exit2Quantity')}
                    className={inputClass}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                setForm((prev) => ({ ...prev, showExit2: true }))
              }
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-4" />
              Add Exit 2
            </button>
          )}

          {/* ── Total exit indicator ───────────────────────────────── */}
          {(form.exit1Price.trim() || form.showExit2) && entryQuantityValue > 0 && (
            <p className="text-xs text-muted-foreground">
              Exit total: {totalExitQty.toFixed(4)} of {entryQuantityValue.toFixed(4)} shares
              {totalExitQty > entryQuantityValue ? (
                <span className="ml-1 text-destructive">(exceeds entry!)</span>
              ) : totalExitQty === entryQuantityValue ? (
                <span className="ml-1 text-positive">(full exit)</span>
              ) : (
                <span className="ml-1 text-warning">(partial exit)</span>
              )}
            </p>
          )}

          {/* ── Footer ──────────────────────────────────────────────── */}
          <DialogFooter>
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex gap-2">
                {checklist.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep('checklist')}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    <ArrowLeft className="size-3.5" />
                    Back
                  </button>
                )}
                <DialogClose asChild>
                  <button
                    type="button"
                    className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                </DialogClose>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 disabled:opacity-50 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
              >
                {submitting && <Loader2 className="size-3.5 animate-spin" />}
                {submitting ? 'Executing...' : 'Execute'}
              </button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
