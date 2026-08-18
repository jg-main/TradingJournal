'use client';

// ReviewWriteSheet — panel-anchored weekly review write surface.
//
// Owns the weekly review lifecycle for the current week:
//   1. On open (live mode only) the sheet auto-generates-or-loads the
//      current week's review via POST /api/reviews/weekly with
//      { weekStart, accountId }. The route upserts on the account+week
//      unique key: an existing review keeps its notes/focus-next-week while
//      metrics are recomputed from closed trades; a missing review is
//      created. This is the "generate or load" behavior from S02.
//   2. Displays the auto-computed metrics (closed trades, net P&L, win
//      rate, avg R, avg process score + grade).
//   3. Lets the user edit notes and focus-next-week, saved via
//      PUT /api/reviews/weekly/[id] { notes, focusNextWeek }.
//   4. Calls onSaved(review) after a successful save so the host panel can
//      refresh its summary without a page reload.
//
// Failure surfacing (S02 verification contract):
//   - Load/generate failure → inline alert + Retry inside the sheet.
//   - Save failure → inline form error (role=alert) inside the form.
//   - Console errors tagged [review-sheet] for diagnostics.
//
// Fixture mode (liveMode=false): renders nothing — the write chrome is
// strictly a live-mode surface; the panel stays read-only.
//
// data-testid attributes (used by T03 e2e):
//   ws-review-sheet, ws-review-sheet-loading, ws-review-sheet-error,
//   ws-review-sheet-retry, ws-review-sheet-week, ws-review-sheet-metrics,
//   ws-review-sheet-metric-trades, ws-review-sheet-metric-netpnl,
//   ws-review-sheet-metric-winrate, ws-review-sheet-metric-avgr,
//   ws-review-sheet-metric-grade, ws-review-sheet-notes,
//   ws-review-sheet-focus, ws-review-sheet-save, ws-review-sheet-form-error

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';

import { useWorkstation } from './workstation-context';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { GRADE_RUBRIC } from '@/lib/grading';

// ── Domain types (mirror the /api/reviews/weekly row contract) ─────────

export interface WeeklyReviewRow {
  id: string;
  weekStart: string;
  weekEnd: string;
  accountId: string;
  closedTrades: number;
  netPnl: number;
  avgR: number | null;
  winRate: number;
  avgProcessScore: number | null;
  notes: string | null;
  focusNextWeek: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ReviewWriteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the saved review so the host panel can refresh its
   *  summary without a page reload. */
  onSaved?: (review: WeeklyReviewRow) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Local-time Monday of the given date, as YYYY-MM-DD (UTC date part).
 *  Mirrors the legacy /reviews page week detection so both surfaces agree
 *  on the same week boundary. */
function mondayIsoDate(now: Date): string {
  const date = new Date(now);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().split('T')[0];
}

function fmtCurrency(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pnlClass(value: number): string {
  if (value > 0) return 'ws-pos';
  if (value < 0) return 'ws-neg';
  return '';
}

function fmtPct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return '—';
  return `${(fraction * 100).toFixed(1)}%`;
}

function fmtDecimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(digits);
}

/** Map a process score (0–60) to a letter grade using the canonical
 *  GRADE_RUBRIC from src/lib/grading.ts. */
function gradeLabelFromScore(score: number | null | undefined): string | null {
  if (score === null || score === undefined) return null;
  for (const tier of GRADE_RUBRIC) {
    if (score >= tier.min) return tier.label;
  }
  return 'F';
}

/** Best-effort extraction of an API error message. Routes under
 *  /api/reviews return { error, details?: { fieldErrors } }. Field-level
 *  errors are preferred for specificity (same convention as the watchlist
 *  panel), then the top-level error, then the fallback. */
function extractApiError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const details = (body as { details?: unknown }).details;
  if (details && typeof details === 'object') {
    const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
    if (fieldErrors && typeof fieldErrors === 'object') {
      for (const messages of Object.values(fieldErrors as Record<string, unknown>)) {
        if (Array.isArray(messages) && messages.length > 0 && typeof messages[0] === 'string') {
          return messages[0];
        }
      }
    }
  }
  const maybeError = (body as { error?: unknown }).error;
  if (typeof maybeError === 'string' && maybeError.length > 0) {
    return maybeError;
  }
  return fallback;
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const endOpts: Intl.DateTimeFormatOptions = { ...opts, year: 'numeric' };
  try {
    return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', endOpts)}`;
  } catch {
    return `${start} – ${end}`;
  }
}

// ── Component ───────────────────────────────────────────────────────────

export function ReviewWriteSheet({ open, onOpenChange, onSaved }: ReviewWriteSheetProps) {
  const { activeAccountId, liveMode } = useWorkstation();

  const weekStart = useMemo(() => mondayIsoDate(new Date()), []);

  // ── Load / generate state ──────────────────────────────────────────
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [review, setReview] = useState<WeeklyReviewRow | null>(null);

  // ── Form state ─────────────────────────────────────────────────────
  const [notes, setNotes] = useState('');
  const [focusNextWeek, setFocusNextWeek] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Token guard: a closed/unmounted sheet must never apply a stale load
  // result — the newest load owns the state. Each load bumps the token;
  // any response arriving under an older token discards itself.
  const loadTokenRef = useRef(0);

  // Load-or-generate the current week's review via POST /api/reviews/weekly
  // (upsert: metrics refresh from closed trades; existing notes survive).
  // State transitions live inside a nested async continuation so the effect
  // that invokes this never calls setState synchronously on its own tick
  // (react-hooks/set-state-in-effect) — same pattern as refreshLiveData in
  // workstation-context.tsx.
  const loadOrGenerate = useCallback((): void => {
    if (!activeAccountId) return;
    const token = ++loadTokenRef.current;

    const run = async (): Promise<void> => {
      setLoadState('loading');
      setLoadError(null);
      setFormError(null);
      setReview(null);

      try {
        const response = await fetch('/api/reviews/weekly', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekStart, accountId: activeAccountId }),
        });

        if (token !== loadTokenRef.current) return; // superseded

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as unknown;
          const message = extractApiError(
            body,
            'Failed to load or generate the weekly review',
          );
          console.error(
            `[review-sheet] generate/load failed (${response.status}): ${message}`,
          );
          setLoadError(message);
          setLoadState('error');
          return;
        }

        const row = (await response.json()) as WeeklyReviewRow;
        if (token !== loadTokenRef.current) return;

        console.info(
          `[review-sheet] loaded review ${row.id} for week ${row.weekStart}`,
        );
        setReview(row);
        setNotes(row.notes ?? '');
        setFocusNextWeek(row.focusNextWeek ?? '');
        setLoadState('ready');
      } catch (error) {
        if (token !== loadTokenRef.current) return;
        console.error('[review-sheet] generate/load network failure:', error);
        setLoadError('Network error — could not reach the reviews API');
        setLoadState('error');
      }
    };

    void run();
  }, [activeAccountId, weekStart]);

  // Open the sheet → auto-generate-or-load the current week's review.
  // A retry bumps the token and supersedes the in-flight load; a stale
  // response under an older token never applies state.
  useEffect(() => {
    if (!open || !liveMode || !activeAccountId) return;
    loadOrGenerate();
  }, [open, liveMode, activeAccountId, loadOrGenerate]);

  // Fixture mode: the write chrome is a live-mode-only surface.
  if (!liveMode) return null;

  // ── Save (PUT notes + focus-next-week) ─────────────────────────────
  const handleSave = async (): Promise<void> => {
    if (!review || saving) return;
    setSaving(true);
    setFormError(null);

    try {
      const response = await fetch(`/api/reviews/weekly/${review.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: notes.trim() === '' ? null : notes,
          focusNextWeek: focusNextWeek.trim() === '' ? null : focusNextWeek,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as unknown;
        const message = extractApiError(body, 'Failed to save the weekly review');
        console.error(`[review-sheet] save failed (${response.status}): ${message}`);
        setFormError(message);
        return;
      }

      const row = (await response.json()) as WeeklyReviewRow;
      console.info(`[review-sheet] saved review ${row.id} (notes/focus updated)`);
      setReview(row);
      onSaved?.(row);
      onOpenChange(false);
    } catch (error) {
      console.error('[review-sheet] save network failure:', error);
      setFormError('Network error — could not save the weekly review');
    } finally {
      setSaving(false);
    }
  };

  const grade = review ? gradeLabelFromScore(review.avgProcessScore) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-testid="ws-review-sheet" side="right">
        <SheetHeader>
          <SheetTitle>Weekly Review</SheetTitle>
          <SheetDescription>
            Auto-computed metrics from closed trades this week, with room for
            notes and next-week focus.
          </SheetDescription>
        </SheetHeader>

        {loadState === 'loading' && (
          <div
            className="flex items-center gap-2 px-4 text-sm text-muted-foreground"
            data-testid="ws-review-sheet-loading"
          >
            <Loader2 className="size-4 animate-spin" />
            Generating review…
          </div>
        )}

        {loadState === 'error' && (
          <div
            className="mx-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="ws-review-sheet-error"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <p>{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                data-testid="ws-review-sheet-retry"
                onClick={loadOrGenerate}
              >
                <RotateCcw className="size-3.5" />
                Retry
              </Button>
            </div>
          </div>
        )}

        {loadState === 'ready' && review && (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            {/* ── Week label ─────────────────────────────────────── */}
            <div
              className="text-xs font-medium text-muted-foreground"
              data-testid="ws-review-sheet-week"
            >
              Week of {formatWeekRange(review.weekStart, review.weekEnd)}
            </div>

            {/* ── Auto-computed metrics ──────────────────────────── */}
            <div
              className="rounded-lg border border-border p-3"
              data-testid="ws-review-sheet-metrics"
            >
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Week metrics
              </div>
              <dl className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <dt className="text-sm text-muted-foreground">Closed trades</dt>
                  <dd
                    className="ws-num ws-mono text-sm"
                    data-testid="ws-review-sheet-metric-trades"
                  >
                    {review.closedTrades}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-sm text-muted-foreground">Net P&amp;L</dt>
                  <dd
                    className={`ws-num ws-mono text-sm ${pnlClass(review.netPnl)}`}
                    data-testid="ws-review-sheet-metric-netpnl"
                  >
                    {fmtCurrency(review.netPnl)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-sm text-muted-foreground">Win rate</dt>
                  <dd
                    className="ws-num ws-mono text-sm"
                    data-testid="ws-review-sheet-metric-winrate"
                  >
                    {fmtPct(review.winRate)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-sm text-muted-foreground">Avg R</dt>
                  <dd
                    className="ws-num ws-mono text-sm"
                    data-testid="ws-review-sheet-metric-avgr"
                  >
                    {fmtDecimal(review.avgR)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-sm text-muted-foreground">Process grade</dt>
                  <dd
                    className="ws-num ws-mono text-sm"
                    data-testid="ws-review-sheet-metric-grade"
                  >
                    {review.avgProcessScore === null || review.avgProcessScore === undefined
                      ? '—'
                      : `${grade} (${fmtDecimal(review.avgProcessScore, 1)})`}
                  </dd>
                </div>
              </dl>
            </div>

            {/* ── Editable notes + focus ─────────────────────────── */}
            <form
              className="flex flex-1 flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSave();
              }}
              noValidate
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="ws-review-sheet-notes"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Notes
                </label>
                <textarea
                  id="ws-review-sheet-notes"
                  data-testid="ws-review-sheet-notes"
                  className="h-28 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                  placeholder="How did the week go? What did you notice?"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="ws-review-sheet-focus"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Focus next week
                </label>
                <textarea
                  id="ws-review-sheet-focus"
                  data-testid="ws-review-sheet-focus"
                  className="h-24 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                  placeholder="One thing to focus on next week"
                  value={focusNextWeek}
                  onChange={(e) => setFocusNextWeek(e.target.value)}
                  disabled={saving}
                />
              </div>

              {formError && (
                <div
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  data-testid="ws-review-sheet-form-error"
                  role="alert"
                >
                  {formError}
                </div>
              )}

              <SheetFooter className="mt-auto">
                <Button
                  type="button"
                  variant="outline"
                  data-testid="ws-review-sheet-cancel"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-testid="ws-review-sheet-save"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save review'
                  )}
                </Button>
              </SheetFooter>
            </form>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
