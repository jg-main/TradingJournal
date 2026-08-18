'use client';

// WatchlistPanel — terminal-dense enhanced watchlist table.
//
// Replaces S01's placeholder 4-column watchlist (Symbol, Dir, Status, Trigger)
// with an enhanced 7-column table showing symbol, direction, last price,
// gap %, trigger price, distance-to-trigger %, and status. Merges watchlist
// items from context with per-symbol price data from the extended fixture
// system (T01).
//
// M024/S01: live mode gains full CRUD — a header '+ Add' action, per-row
// Edit / Remove actions, and an add/edit dialog (symbol, direction, trigger
// price, key level, status) wired to POST/PUT/DELETE /api/watchlist followed
// by refreshLiveData() so the panel reflects each mutation without a page
// reload. Fixture mode (liveMode=false) keeps the read-only table exactly as
// before: no actions render, empty state stays text-only.
//
// Visual indicators:
//   ws-pos / ws-neg — gap direction color (green/red, same as KPI strip)
//   ws-approaching — distance < 2% from trigger (amber)
//   ws-urgent      — distance < 0.5% from trigger (bright orange)
//   ws-dir-long / ws-dir-short — direction color coding on the "Dir" column
//
// The component renders its own Panel chrome (header + body) with a
// MarketStrip sub-ribbon inside the panel body, so T04 can drop
// <WatchlistPanel /> directly into the grid without wrapping.

import { useState, type FormEvent } from 'react';
import { useWorkstation } from './workstation-context';
import { MarketStrip } from './market-strip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { WorkstationWatchlistItem } from '@/lib/workstation-fixtures';

// ── Formatters ──────────────────────────────────────────────────────────

function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtSignedPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function fmtAbsPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(2)}%`;
}

function gapClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n > 0) return 'ws-pos';
  if (n < 0) return 'ws-neg';
  return '';
}

function proximityClass(distancePct: number | null | undefined): string {
  if (distancePct === null || distancePct === undefined) return '';
  if (distancePct < 0.5) return 'ws-urgent';
  if (distancePct < 2.0) return 'ws-approaching';
  return '';
}

function dirClass(direction: 'long' | 'short'): string {
  return direction === 'long' ? 'ws-dir-long' : 'ws-dir-short';
}

function dirLabel(direction: 'long' | 'short'): string {
  return direction === 'long' ? 'L' : 'S';
}

// ── CRUD domain types (mirror the API contracts from T01) ───────────────

type WatchlistDirection = 'long' | 'short';
type WatchlistStatus =
  | 'pending'
  | 'watching'
  | 'triggered'
  | 'skipped'
  | 'expired';

const WATCHLIST_DIRECTIONS: readonly WatchlistDirection[] = ['long', 'short'];
const WATCHLIST_STATUSES: readonly WatchlistStatus[] = [
  'pending',
  'watching',
  'triggered',
  'skipped',
  'expired',
];

/** Editable dialog fields. triggerPrice/keyLevel are kept as strings so the
 *  dialog can distinguish an empty input (→ null) from a typed value. */
interface WatchlistFormState {
  symbol: string;
  direction: WatchlistDirection;
  triggerPrice: string;
  keyLevel: string;
  status: WatchlistStatus;
}

const EMPTY_FORM: WatchlistFormState = {
  symbol: '',
  direction: 'long',
  triggerPrice: '',
  keyLevel: '',
  status: 'pending',
};

/** Parse a dialog price field: empty → null, else a finite number. */
function parsePriceField(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

/** Best-effort extraction of the first zod field error for inline display. */
function firstFieldError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const details = (body as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== 'object') return null;
  for (const messages of Object.values(fieldErrors as Record<string, unknown>)) {
    if (Array.isArray(messages) && messages.length > 0) {
      const first = messages[0];
      if (typeof first === 'string') return first;
    }
  }
  return null;
}

export function WatchlistPanel() {
  const { fixtures, liveMode, refreshLiveData } = useWorkstation();
  const { watchlist, symbolPrices } = fixtures;

  // ── CRUD dialog state ────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkstationWatchlistItem | null>(null);
  const [form, setForm] = useState<WatchlistFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] =
    useState<WorkstationWatchlistItem | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (item: WorkstationWatchlistItem) => {
    setEditing(item);
    setForm({
      symbol: item.symbol,
      direction: item.direction,
      triggerPrice: item.triggerPrice === null ? '' : String(item.triggerPrice),
      keyLevel: item.keyLevel === null ? '' : String(item.keyLevel),
      status: item.status,
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const setField = <K extends keyof WatchlistFormState>(
    key: K,
    value: WatchlistFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // ── Add / edit submission ────────────────────────────────────────────
  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const symbol = form.symbol.trim();
    if (!symbol) {
      setFormError('Symbol is required');
      return;
    }

    const triggerPrice = parsePriceField(form.triggerPrice);
    const keyLevel = parsePriceField(form.keyLevel);
    if (triggerPrice !== null && Number.isNaN(triggerPrice)) {
      setFormError('Trigger price must be a valid number');
      return;
    }
    if (keyLevel !== null && Number.isNaN(keyLevel)) {
      setFormError('Key level must be a valid number');
      return;
    }

    const payload = {
      symbol,
      direction: form.direction,
      triggerPrice,
      keyLevel,
      status: form.status,
    };

    setSubmitting(true);
    try {
      const url = editing ? `/api/watchlist/${editing.id}` : '/api/watchlist';
      const response = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = `Failed to ${editing ? 'update' : 'add'} watchlist item`;
        try {
          const body = (await response.json()) as unknown;
          const fieldError = firstFieldError(body);
          if (fieldError) message = fieldError;
          else if (
            body &&
            typeof body === 'object' &&
            typeof (body as { error?: unknown }).error === 'string'
          ) {
            message = (body as { error: string }).error;
          }
        } catch {
          // non-JSON failure body — keep the default message
        }
        setFormError(message);
        return;
      }

      // Close and refetch: the context owns the data, the panel only mutates.
      setDialogOpen(false);
      refreshLiveData();
    } catch (error) {
      console.error('[watchlist] add/edit mutation failed:', error);
      setFormError('Network error — could not reach the watchlist API');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete (soft-delete via the API, then refetch) ───────────────────
  const confirmRemove = async () => {
    if (!confirmingDelete) return;
    const { id, symbol } = confirmingDelete;
    setConfirmingDelete(null);
    setMutationError(null);

    try {
      const response = await fetch(`/api/watchlist/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        let message = `Failed to remove ${symbol}`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // keep default message
        }
        setMutationError(message);
        return;
      }

      refreshLiveData();
    } catch (error) {
      console.error('[watchlist] delete mutation failed:', error);
      setMutationError(`Network error — could not remove ${symbol}`);
    }
  };

  // ── Empty state (fixture mode: text only; live mode: + Add) ──────────
  if (watchlist.length === 0) {
    return (
      <section
        className="ws-panel"
        style={{ gridArea: 'watchlist' }}
        data-testid="ws-panel-watchlist"
      >
        <div className="ws-panel-header">
          <span>Watchlist</span>
          {liveMode && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              data-testid="ws-watchlist-add"
              onClick={openAdd}
            >
              + Add
            </Button>
          )}
        </div>
        <div className="ws-panel-body">
          {liveMode && mutationError && (
            <div
              className="ws-watchlist-error text-destructive"
              data-testid="ws-watchlist-mutation-error"
              role="alert"
            >
              {mutationError}
            </div>
          )}
          <div className="ws-empty" data-testid="ws-watchlist-empty">
            Watchlist is empty
          </div>
          {liveMode && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="ws-watchlist-empty-add"
                onClick={openAdd}
              >
                + Add symbol
              </Button>
            </div>
          )}
        </div>
      </section>
    );
  }

  // ── Populated state ──────────────────────────────────────────────────
  return (
    <section
      className="ws-panel"
      style={{ gridArea: 'watchlist' }}
      data-testid="ws-panel-watchlist"
    >
      <div className="ws-panel-header">
        <span>Watchlist</span>
        <span className="ws-panel-meta ws-mono">{watchlist.length} items</span>
        {liveMode && (
          <Button
            variant="outline"
            size="sm"
            data-testid="ws-watchlist-add"
            onClick={openAdd}
          >
            + Add
          </Button>
        )}
      </div>
      <div className="ws-panel-body">
        <MarketStrip />
        {liveMode && mutationError && (
          <div
            className="ws-watchlist-error text-destructive"
            data-testid="ws-watchlist-mutation-error"
            role="alert"
          >
            {mutationError}
          </div>
        )}
        <table className="ws-table" data-testid="ws-watchlist-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Dir</th>
              <th className="ws-num">Last</th>
              <th className="ws-num">Gap%</th>
              <th className="ws-num">Trigger</th>
              <th className="ws-num">Dist%</th>
              <th>Status</th>
              {liveMode && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {watchlist.map((item) => {
              const price = symbolPrices[item.symbol];
              const gapCls = price ? gapClass(price.gapPct) : '';
              const proxCls = price
                ? proximityClass(price.distanceToTriggerPct)
                : '';

              return (
                <tr
                  key={item.id}
                  data-testid={`ws-watchlist-row-${item.symbol}`}
                >
                  <td className="ws-mono">{item.symbol}</td>
                  <td className={dirClass(item.direction)}>
                    {dirLabel(item.direction)}
                  </td>
                  <td className="ws-num">
                    {price ? fmtPrice(price.lastPrice) : '—'}
                  </td>
                  <td className={`ws-num ${gapCls}`}>
                    {price ? fmtSignedPct(price.gapPct) : '—'}
                  </td>
                  <td className="ws-num">
                    {item.triggerPrice !== null
                      ? fmtPrice(item.triggerPrice)
                      : '—'}
                  </td>
                  <td className={`ws-num ${proxCls}`}>
                    {price
                      ? fmtAbsPct(price.distanceToTriggerPct)
                      : '—'}
                  </td>
                  <td>
                    <span
                      className={`ws-status ws-status-${item.status}`}
                      data-testid={`ws-status-${item.symbol}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  {liveMode && (
                    <td>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          data-testid={`ws-watchlist-row-${item.symbol}-edit`}
                          onClick={() => openEdit(item)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          data-testid={`ws-watchlist-row-${item.symbol}-remove`}
                          onClick={() => {
                            setMutationError(null);
                            setConfirmingDelete(item);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Add / edit dialog ───────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="ws-watchlist-dialog">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.symbol}` : 'Add to watchlist'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update direction, trigger, key level, or status.'
                : 'Add a symbol to watch for a setup.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={submitForm}
            data-testid="ws-watchlist-form"
            noValidate
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="ws-watchlist-form-symbol"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Symbol
                </label>
                <Input
                  id="ws-watchlist-form-symbol"
                  data-testid="ws-watchlist-form-symbol"
                  placeholder="e.g. NVDA"
                  value={form.symbol}
                  onChange={(e) => setField('symbol', e.target.value)}
                  maxLength={20}
                  disabled={submitting}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="ws-watchlist-form-direction"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Direction
                </label>
                <Select
                  value={form.direction}
                  onValueChange={(v) =>
                    setField('direction', v as WatchlistDirection)
                  }
                  disabled={submitting}
                >
                  <SelectTrigger
                    id="ws-watchlist-form-direction"
                    className="w-full"
                    data-testid="ws-watchlist-form-direction"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WATCHLIST_DIRECTIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d === 'long' ? 'Long' : 'Short'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="ws-watchlist-form-trigger"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Trigger price
                </label>
                <Input
                  id="ws-watchlist-form-trigger"
                  data-testid="ws-watchlist-form-trigger"
                  type="text"
                  inputMode="decimal"
                  placeholder="Optional"
                  value={form.triggerPrice}
                  onChange={(e) => setField('triggerPrice', e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="ws-watchlist-form-keylevel"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Key level
                </label>
                <Input
                  id="ws-watchlist-form-keylevel"
                  data-testid="ws-watchlist-form-keylevel"
                  type="text"
                  inputMode="decimal"
                  placeholder="Optional"
                  value={form.keyLevel}
                  onChange={(e) => setField('keyLevel', e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="ws-watchlist-form-status"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Status
                </label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setField('status', v as WatchlistStatus)}
                  disabled={submitting}
                >
                  <SelectTrigger
                    id="ws-watchlist-form-status"
                    className="w-full"
                    data-testid="ws-watchlist-form-status"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WATCHLIST_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {formError && (
                <div
                  className="text-sm text-destructive"
                  data-testid="ws-watchlist-form-error"
                  role="alert"
                >
                  {formError}
                </div>
              )}
            </div>

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                data-testid="ws-watchlist-form-cancel"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-testid="ws-watchlist-form-submit"
                disabled={submitting}
              >
                {submitting
                  ? 'Saving…'
                  : editing
                    ? 'Save changes'
                    : 'Add to watchlist'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ──────────────────────────────────────── */}
      <ConfirmDialog
        open={confirmingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmingDelete(null);
        }}
        onConfirm={() => {
          void confirmRemove();
        }}
        title={`Remove ${confirmingDelete?.symbol ?? ''}?`}
        description="The symbol will be marked as expired and removed from the watchlist."
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        contentTestId="ws-watchlist-confirm-delete"
        confirmTestId="ws-watchlist-confirm-delete-yes"
        cancelTestId="ws-watchlist-confirm-delete-no"
      />
    </section>
  );
}
