'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Receipt,
  Filter,
  ArrowLeft,
  ArrowRight,
  Layers,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────

/** Mirror of the API response types for the ledger component. */

interface EventStatusDisplay {
  hasEntry: boolean;
  isBalanced: boolean;
  postingCount: number;
}

interface PostingDisplay {
  id: string;
  side: 'debit' | 'credit';
  amount: string;
  amountMicros: number;
  currency: string;
  sequence: number;
}

interface PostingPairDisplay {
  debit: PostingDisplay;
  credit: PostingDisplay;
}

interface CorrectionGroupDisplay {
  correctionId: string;
  originalEventId: string;
  reversalEventId: string;
  replacementEventId: string;
  reason: string | null;
  correctedAt: string;
}

interface LedgerRowDisplay {
  eventId: string;
  eventType: string;
  postedAt: string;
  description: string | null;
  category: string;
  cashImpact: string | null;
  status: EventStatusDisplay;
  postings: PostingPairDisplay | null;
  idempotencyKey: string | null;
  correctionGroup: CorrectionGroupDisplay | null;
  tradeId?: string | null;
}

interface LedgerProjectionResponse {
  events: LedgerRowDisplay[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Category Filter Definitions ─────────────────────────────────────────

interface CategoryFilterOption {
  label: string;
  eventTypes: string[];
}

const CATEGORY_FILTERS: Record<string, CategoryFilterOption> = {
  all: { label: 'All', eventTypes: [] },
  opening_balance: { label: 'Opening', eventTypes: ['opening_balance'] },
  cash: { label: 'Cash', eventTypes: ['deposit', 'withdrawal', 'dividend', 'interest'] },
  trade: { label: 'Trade', eventTypes: ['trade_execution'] },
  fee_tax: { label: 'Fee/Tax', eventTypes: ['fee', 'tax'] },
  adjustment: { label: 'Adjustment', eventTypes: ['adjustment', 'manual_adjustment'] },
  transfer: { label: 'Transfer', eventTypes: ['transfer'] },
  corporate_action: { label: 'Corp. Action', eventTypes: ['stock_split'] },
};

const FILTER_ORDER = ['all', 'opening_balance', 'cash', 'trade', 'fee_tax', 'adjustment', 'transfer', 'corporate_action'] as const;

// ── Props ───────────────────────────────────────────────────────────────

interface AccountLedgerProps {
  /** Account ID used to fetch the ledger endpoint. */
  accountId: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getEventTypeBadge(eventType: string): { label: string; className: string } {
  switch (eventType) {
    case 'opening_balance':
      return { label: 'Opening', className: 'bg-info/10 text-info' };
    case 'deposit':
      return { label: 'Deposit', className: 'bg-positive/10 text-positive' };
    case 'withdrawal':
      return { label: 'Withdrawal', className: 'bg-negative/10 text-negative' };
    case 'dividend':
      return { label: 'Dividend', className: 'bg-positive/10 text-positive' };
    case 'interest':
      return { label: 'Interest', className: 'bg-positive/10 text-positive' };
    case 'fee':
      return { label: 'Fee', className: 'bg-warning/10 text-warning' };
    case 'tax':
      return { label: 'Tax', className: 'bg-negative/10 text-negative' };
    case 'trade_execution':
      return { label: 'Trade', className: 'bg-info/10 text-info' };
    case 'adjustment':
    case 'manual_adjustment':
      return { label: 'Adjust', className: 'bg-muted text-muted-foreground' };
    case 'transfer':
      return { label: 'Transfer', className: 'bg-info/10 text-info' };
    case 'stock_split':
      return { label: 'Split', className: 'bg-info/10 text-info' };
    default:
      return { label: eventType, className: 'bg-muted text-muted-foreground' };
  }
}

function getCashImpactClass(cashImpact: string | null): string {
  if (cashImpact === null) return 'text-muted-foreground';
  return cashImpact.startsWith('-')
    ? 'text-negative'
    : 'text-positive';
}

function getStatusIcon(status: EventStatusDisplay): React.ReactNode {
  if (status.hasEntry && status.isBalanced) {
    return <CheckCircle2 className="size-3.5 text-positive" aria-hidden="true" />;
  }
  return <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />;
}

function getStatusLabel(status: EventStatusDisplay): string {
  if (!status.hasEntry) return 'Unposted';
  if (!status.isBalanced) return 'Unbalanced';
  return 'Posted';
}

// ── Row Expansion Sub-Component ─────────────────────────────────────────

interface ExpandedPostingsProps {
  postings: PostingPairDisplay | null;
  idempotencyKey: string | null;
  correctionGroup: CorrectionGroupDisplay | null;
}

/** Expanded posting details shown below a ledger row. */
function ExpandedPostings({ postings, idempotencyKey, correctionGroup }: ExpandedPostingsProps) {
  return (
    <div className="border-t border-border bg-muted/50 px-4 py-3">
      {/* ── Posting Pairs ─────────────────────────────────────────── */}
      {postings && (
        <div className="mb-2">
          <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Postings
          </p>
          <div className="grid grid-cols-2 gap-3">
            {/* Debit */}
            <div className="rounded border border-border bg-card px-3 py-2">
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Debit</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {formatCurrency(postings.debit.amount)} {postings.debit.currency}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Seq {postings.debit.sequence} · ID: {postings.debit.id.slice(0, 8)}…
              </p>
            </div>

            {/* Credit */}
            <div className="rounded border border-border bg-card px-3 py-2">
              <p className="text-[10px] font-medium text-muted-foreground uppercase">Credit</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {formatCurrency(postings.credit.amount)} {postings.credit.currency}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Seq {postings.credit.sequence} · ID: {postings.credit.id.slice(0, 8)}…
              </p>
            </div>
          </div>

          {/* Balance indicator */}
          {postings.debit.amountMicros === postings.credit.amountMicros ? (
            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-positive">
              <CheckCircle2 className="size-3" aria-hidden="true" />
              Balanced
            </p>
          ) : (
            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-negative">
              <AlertTriangle className="size-3" aria-hidden="true" />
              Unbalanced
            </p>
          )}
        </div>
      )}

      {/* ── Idempotency Key ───────────────────────────────────────── */}
      {idempotencyKey && (
        <div className="mb-2">
          <p className="mb-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Idempotency Key
          </p>
          <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {idempotencyKey}
          </code>
        </div>
      )}

      {/* ── Correction Lineage ────────────────────────────────────── */}
      {correctionGroup && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Correction Lineage
          </p>
          <div className="space-y-1 rounded border border-warning/30 bg-warning/10 px-3 py-2">
            <CorrectionLineageRow label="Original" eventId={correctionGroup.originalEventId} />
            <CorrectionLineageRow label="Reversal" eventId={correctionGroup.reversalEventId} />
            <CorrectionLineageRow label="Replacement" eventId={correctionGroup.replacementEventId} />
            {correctionGroup.reason && (
              <p className="mt-1 text-[10px] italic text-muted-foreground">
                Reason: {correctionGroup.reason}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              Corrected: {formatDateTime(correctionGroup.correctedAt)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** A single row in the correction lineage section. */
function CorrectionLineageRow({ label, eventId }: { label: string; eventId: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 shrink-0 font-medium text-muted-foreground">{label}:</span>
      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
        {eventId.slice(0, 12)}…
      </code>
    </div>
  );
}

// ── Correction Badge ────────────────────────────────────────────────────

interface CorrectionBadgeProps {
  reason: string | null;
  correctedAt: string;
}

function CorrectionBadge({ reason, correctedAt }: CorrectionBadgeProps) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
      title={reason ?? `Corrected ${formatDateTime(correctedAt)}`}
    >
      <Layers className="size-2.5" aria-hidden="true" />
      Corrected
    </span>
  );
}

// ── Empty States ────────────────────────────────────────────────────────

function EmptyLedgerState({ isFiltered, onClearFilter }: { isFiltered: boolean; onClearFilter: () => void }) {
  if (isFiltered) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <Filter className="mx-auto mb-2 size-6 text-muted-foreground" />
        <p className="text-sm text-foreground">No matching events.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          No events match the current filter selection.
        </p>
        <button
          onClick={onClearFilter}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          Clear filter
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <Receipt className="mx-auto mb-2 size-6 text-muted-foreground" />
      <p className="text-sm text-foreground">No ledger events yet.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Post financial events or executions to see activity here.
      </p>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

/**
 * AccountLedger — full financial event ledger workspace.
 *
 * Fetches paginated, filterable ledger data from the API and displays it
 * with expandable posting pairs, correction group lineage, and accessible
 * row expansion controls.
 */
export default function AccountLedger({ accountId }: AccountLedgerProps) {
  const [data, setData] = useState<LedgerProjectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [fetchKey, setFetchKey] = useState(0);

  const pageLimit = 25;

  const buildQueryString = useCallback((category: string, pageNum: number): string => {
    const params = new URLSearchParams();
    params.set('page', String(pageNum));
    params.set('limit', String(pageLimit));

    const filter = CATEGORY_FILTERS[category];
    if (filter && filter.eventTypes.length > 0) {
      params.set('eventTypes', filter.eventTypes.join(','));
    }

    return params.toString();
  }, []);

  /** Pure data fetcher — no state side effects. */
  const loadLedgerData = useCallback(
    async (category: string, pageNum: number): Promise<LedgerProjectionResponse> => {
      const qs = buildQueryString(category, pageNum);
      const res = await fetch(`/api/accounts/${accountId}/ledger?${qs}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch ledger' }));
        throw new Error(err.error ?? 'Failed to fetch account ledger');
      }
      return res.json() as Promise<LedgerProjectionResponse>;
    },
    [accountId, buildQueryString],
  );

  // Fetch on mount and on category/page/fetchKey changes.
  // Uses a local cancellation flag so stale responses do not overwrite newer results.
  // Loading/error state transitions are deferred to a microtask to avoid calling
  // setState synchronously within the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;

    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    loadLedgerData(activeCategory, page)
      .then((ledgerData) => {
        if (!cancelled) {
          setData(ledgerData);
          setExpandedRows(new Set());
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'An error occurred');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadLedgerData, activeCategory, page, fetchKey]);

  // ── Handlers ──────────────────────────────────────────────────────

  const handleCategoryChange = useCallback((category: string) => {
    setActiveCategory(category);
    setPage(1);
  }, []);

  const handleClearFilter = useCallback(() => {
    setActiveCategory('all');
    setPage(1);
  }, []);

  const handleRetry = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  const handlePrevPage = useCallback(() => {
    setPage((p) => Math.max(1, p - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    if (!data) return;
    setPage((p) => Math.min(data.totalPages, p + 1));
  }, [data]);

  const toggleRowExpansion = useCallback((eventId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  // ── Loading State ──────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <RefreshCw className="mx-auto mb-2 size-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading ledger...</p>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 size-5 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={handleRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
        >
          <RefreshCw className="size-3" />
          Retry
        </button>
      </div>
    );
  }

  // ── Guard ──────────────────────────────────────────────────────────
  if (!data) return null;

  const { events, total, totalPages } = data;
  const isFiltered = activeCategory !== 'all';
  const hasResults = events.length > 0;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Filter Controls ─────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Event category filter">
        {FILTER_ORDER.map((key) => {
          const option = CATEGORY_FILTERS[key];
          return (
            <button
              key={key}
              onClick={() => handleCategoryChange(key)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                activeCategory === key
                  ? 'bg-foreground text-background dark:bg-secondary dark:text-secondary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
              aria-pressed={activeCategory === key}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* ── Results Info ─────────────────────────────────────────────── */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {total === 0
            ? 'No events'
            : `${total} event${total !== 1 ? 's' : ''}${isFiltered ? ' (filtered)' : ''}`}
        </p>
        {totalPages > 1 && (
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
        )}
      </div>

      {/* ── Empty States ─────────────────────────────────────────────── */}
      {!hasResults && (
        <EmptyLedgerState isFiltered={isFiltered} onClearFilter={handleClearFilter} />
      )}

      {/* ── Ledger Table ─────────────────────────────────────────────── */}
      {hasResults && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Date
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Type
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Description
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Cash Impact
                </th>
                <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="w-16 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((evt) => {
                const isExpanded = expandedRows.has(evt.eventId);
                const badge = getEventTypeBadge(evt.eventType);
                const hasDetail = evt.postings !== null || evt.idempotencyKey !== null || evt.correctionGroup !== null;
                const expandSectionId = `ledger-detail-${evt.eventId}`;

                return (
                  <tr key={evt.eventId} className="group">
                    {/* Primary Row */}
                    <td colSpan={7} className="p-0">
                      <div className="divide-y divide-border">
                        {/* Main row content */}
                        <div
                          className={cn(
                            'flex items-center px-2 py-2 transition-colors',
                            evt.correctionGroup
                              ? 'bg-warning/10'
                              : 'hover:bg-muted/50',
                          )}
                        >
                          {/* Expand button */}
                          <div className="w-8 shrink-0">
                            {hasDetail && (
                              <button
                                onClick={() => toggleRowExpansion(evt.eventId)}
                                className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                                aria-expanded={isExpanded}
                                aria-controls={expandSectionId}
                                aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="size-4" aria-hidden="true" />
                                ) : (
                                  <ChevronRight className="size-4" aria-hidden="true" />
                                )}
                              </button>
                            )}
                          </div>

                          {/* Date */}
                          <div className="w-36 shrink-0 px-3">
                            <p className="text-xs tabular-nums text-muted-foreground">
                              {formatDateTime(evt.postedAt)}
                            </p>
                          </div>

                          {/* Type badge */}
                          <div className="w-24 shrink-0 px-3">
                            <span
                              className={cn(
                                'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium',
                                badge.className,
                              )}
                            >
                              {badge.label}
                            </span>
                          </div>

                          {/* Description */}
                          <div className="min-w-0 flex-1 px-3">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm text-foreground">
                                {evt.description ?? (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </p>
                              {/* Correction badge for grouped corrections */}
                              {evt.correctionGroup && (
                                <CorrectionBadge
                                  reason={evt.correctionGroup.reason}
                                  correctedAt={evt.correctionGroup.correctedAt}
                                />
                              )}
                              {/* Trade navigation link — visible for trade_execution events with a trade association */}
                              {evt.tradeId && evt.eventType === 'trade_execution' && (
                                <Link
                                  href={`/trades/${evt.tradeId}`}
                                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-info underline hover:text-info"
                                  aria-label={`View trade ${evt.tradeId.slice(0, 8)}`}
                                >
                                  <ExternalLink className="size-2.5" aria-hidden="true" />
                                  Trade
                                </Link>
                              )}
                            </div>
                          </div>

                          {/* Cash Impact */}
                          <div className="w-28 shrink-0 px-3 text-right">
                            {evt.cashImpact !== null ? (
                              <p className={cn('text-sm font-semibold tabular-nums', getCashImpactClass(evt.cashImpact))}>
                                {evt.cashImpact.startsWith('-')
                                  ? `-$${formatCurrency(evt.cashImpact.slice(1))}`
                                  : `$${formatCurrency(evt.cashImpact)}`}
                              </p>
                            ) : (
                              <p className="text-sm text-muted-foreground">—</p>
                            )}
                          </div>

                          {/* Status */}
                          <div className="w-20 shrink-0 px-3 text-center">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 text-xs font-medium',
                                evt.status.hasEntry && evt.status.isBalanced
                                  ? 'text-positive'
                                  : 'text-warning',
                              )}
                            >
                              {getStatusIcon(evt.status)}
                              {getStatusLabel(evt.status)}
                            </span>
                          </div>

                          {/* Right spacer */}
                          <div className="w-4 shrink-0" />
                        </div>

                        {/* Expanded detail section */}
                        {isExpanded && hasDetail && (
                          <div id={expandSectionId} role="region" aria-label={`Details for ${evt.description ?? evt.eventType} event`}>
                            <ExpandedPostings
                              postings={evt.postings}
                              idempotencyKey={evt.idempotencyKey}
                              correctionGroup={evt.correctionGroup}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination Controls ───────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * pageLimit + 1}–{Math.min(page * pageLimit, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={page <= 1}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                page <= 1
                  ? 'border-border text-muted-foreground'
                  : 'border-input text-muted-foreground hover:bg-muted',
              )}
              aria-label="Previous page"
            >
              <ArrowLeft className="size-3" aria-hidden="true" />
              Prev
            </button>
            <button
              onClick={handleNextPage}
              disabled={page >= totalPages}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                page >= totalPages
                  ? 'border-border text-muted-foreground'
                  : 'border-input text-muted-foreground hover:bg-muted',
              )}
              aria-label="Next page"
            >
              Next
              <ArrowRight className="size-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
