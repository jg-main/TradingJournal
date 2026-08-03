'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { Star, CalendarPlus, ChevronDown, ChevronRight, RotateCcw, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { useAppTimezone } from '@/lib/timezone-context';

import { EmptyState } from '@/components/empty-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';

// ── Types ──────────────────────────────────────────────────────────────

interface WeeklyReview {
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

interface ActionItem {
  id: string;
  sourceType: 'weekly_review' | 'trade_review' | 'general';
  sourceId: string | null;
  actionText: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  dueDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ── Dashboard Types ─────────────────────────────────────────────────

interface DashboardSetupPerformance {
  setupName: string;
  setupId: string | null;
  count: number;
  winRate: number | null;
  avgR: number | null;
  avgProcessScore: number | null;
  sampleSizeWarning: 'very_small' | 'small' | 'moderate' | 'adequate';
}

interface DashboardMistakeFrequency {
  mistakeType: string;
  minor: number;
  moderate: number;
  major: number;
  critical: number;
  total: number;
}

interface DashboardUngradedTrade {
  id: string;
  tradeCode: string;
  symbol: string;
  direction: string;
  closedAt: string | null;
}

interface DashboardData {
  setupPerformance: DashboardSetupPerformance[];
  totalTrades: number;
  ungroupedTrades: number;
  mistakeFrequency: DashboardMistakeFrequency[];
  ungradedTrades: DashboardUngradedTrade[];
}

const GRADE_RUBRIC: { min: number; label: string }[] = [
  { min: 54, label: 'A' },
  { min: 42, label: 'B' },
  { min: 30, label: 'C' },
  { min: 18, label: 'D' },
];

const ACTION_ITEM_STATUS_ORDER: ActionItem['status'][] = [
  'open',
  'in_progress',
  'done',
  'cancelled',
];

// ── Helpers ────────────────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return `${(v * 100).toFixed(1)}%`;
}

function formatDecimal(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return '-';
  return v.toFixed(digits);
}

function gradeLabelFromScore(score: number | null): string {
  if (score === null || score === undefined) return '-';
  for (const tier of GRADE_RUBRIC) {
    if (score >= tier.min) return tier.label;
  }
  return 'F';
}

function gradeBadgeClass(grade: string): string {
  switch (grade) {
    case 'A':
      return 'bg-positive/10 text-positive';
    case 'B':
      return 'bg-info/10 text-info';
    case 'C':
      return 'bg-warning/10 text-warning';
    case 'D':
      return 'bg-warning/10 text-warning';
    default:
      return 'bg-destructive/10 text-destructive';
  }
}

function actionStatusBadgeClass(status: ActionItem['status']): string {
  switch (status) {
    case 'open':
      return 'bg-muted text-muted-foreground';
    case 'in_progress':
      return 'bg-info/10 text-info';
    case 'done':
      return 'bg-positive/10 text-positive';
    case 'cancelled':
      return 'bg-muted text-muted-foreground';
  }
}

function pnlBadgeClass(pnl: number): string {
  if (pnl > 0) return 'text-positive';
  if (pnl < 0) return 'text-negative';
  return 'text-muted-foreground';
}

// ── Dashboard Helpers ──────────────────────────────────────────────────

function sampleSizeBadgeClass(level: DashboardSetupPerformance['sampleSizeWarning']): string {
  switch (level) {
    case 'very_small':
      return 'bg-destructive/10 text-destructive';
    case 'small':
      return 'bg-warning/10 text-warning';
    case 'moderate':
      return 'bg-info/10 text-info';
    case 'adequate':
      return 'bg-positive/10 text-positive';
  }
}

function sampleSizeLabel(level: DashboardSetupPerformance['sampleSizeWarning']): string {
  switch (level) {
    case 'very_small': return 'Very Small';
    case 'small': return 'Small';
    case 'moderate': return 'Moderate';
    case 'adequate': return 'Adequate';
  }
}

// ── Page ───────────────────────────────────────────────────────────────

export default function ReviewsPage() {
  useEffect(() => { document.title = "Reviews — Trading Journal"; }, []);
  const { timezone, formatDate: tzFormatDate } = useAppTimezone();
  const tzFormatWeekRange = useCallback((start: string, end: string): string => {
    const s = new Date(start);
    const e = new Date(end);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: timezone };
    const endOpts: Intl.DateTimeFormatOptions = { ...opts, year: 'numeric' };
    try {
      return `${s.toLocaleDateString(undefined, opts)} — ${e.toLocaleDateString(undefined, endOpts)}`;
    } catch {
      return `${start} — ${end}`;
    }
  }, [timezone]);
  const [items, setItems] = useState<WeeklyReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [weekDate, setWeekDate] = useState(() => {
    const monday = getMonday(new Date());
    return monday.toISOString().split('T')[0];
  });
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [actionItemsMap, setActionItemsMap] = useState<Record<string, ActionItem[]>>({});
  const [loadingActionItems, setLoadingActionItems] = useState<Record<string, boolean>>({});

  // ── Dashboard state ──────────────────────────────────────────────────

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // ── Fetch reviews ────────────────────────────────────────────────────

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/reviews/weekly');
      const data = await res.json();
      if (Array.isArray(data)) {
        setItems(data as WeeklyReview[]);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load reviews.' });
    } finally {
      setLoading(false);
    }
  };

  // ── Fetch dashboard data ────────────────────────────────────────────

  const fetchDashboardData = async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const res = await fetch('/api/reviews/dashboard?accountId=default');
      if (!res.ok) {
        throw new Error('Failed to fetch dashboard data');
      }
      const data = await res.json();
      setDashboardData(data as DashboardData);
    } catch {
      setDashboardError('Dashboard data unavailable.');
      setDashboardData(null);
    } finally {
      setDashboardLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchItems();
    fetchDashboardData();
  }, []);

  // ── Generate review ─────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/reviews/weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart: weekDate, accountId: 'default' }),
      });
      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error ?? 'Failed to generate review.' });
        return;
      }
      setMessage({ type: 'success', text: 'Weekly review generated.' });
      setDialogOpen(false);
      fetchItems();
    } catch {
      setMessage({ type: 'error', text: 'Failed to generate review.' });
    } finally {
      setGenerating(false);
    }
  };

  // ── Fetch action items for a review ────────────────────────────────

  const fetchActionItems = async (reviewId: string) => {
    if (actionItemsMap[reviewId]) return; // Already loaded

    setLoadingActionItems((prev) => ({ ...prev, [reviewId]: true }));
    try {
      const res = await fetch(
        `/api/reviews/action-items?sourceType=weekly_review&sourceId=${reviewId}`
      );
      const data = await res.json();
      if (Array.isArray(data)) {
        setActionItemsMap((prev) => ({ ...prev, [reviewId]: data as ActionItem[] }));
      }
    } catch {
      // Silent fail for action items
    } finally {
      setLoadingActionItems((prev) => ({ ...prev, [reviewId]: false }));
    }
  };

  // ── Toggle action item status ───────────────────────────────────────

  const cycleActionStatus = async (actionId: string, currentStatus: ActionItem['status'], reviewId: string) => {
    const idx = ACTION_ITEM_STATUS_ORDER.indexOf(currentStatus);
    const nextStatus = ACTION_ITEM_STATUS_ORDER[(idx + 1) % ACTION_ITEM_STATUS_ORDER.length];

    try {
      const res = await fetch(`/api/reviews/action-items/${actionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) return;

      // Update local state
      setActionItemsMap((prev) => {
        const items = prev[reviewId];
        if (!items) return prev;
        return {
          ...prev,
          [reviewId]: items.map((ai) =>
            ai.id === actionId ? { ...ai, status: nextStatus } : ai
          ),
        };
      });
    } catch {
      // Silent fail
    }
  };

  // ── Toggle expand ───────────────────────────────────────────────────

  const toggleExpand = (reviewId: string) => {
    if (expandedReviewId === reviewId) {
      setExpandedReviewId(null);
    } else {
      setExpandedReviewId(reviewId);
      fetchActionItems(reviewId);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <p className="text-sm text-muted-foreground">Loading reviews...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Reviews
        </h1>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setMessage(null); }}>
          <DialogTrigger asChild>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
            >
              <CalendarPlus className="size-4" />
              Generate Review
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Generate Weekly Review</DialogTitle>
              <DialogDescription>
                Select the Monday of the week to review. Metrics will be
                auto-populated from closed trades in that week.
              </DialogDescription>
            </DialogHeader>

            {message && message.type === 'error' && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {message.text}
              </div>
            )}

            <div className="py-2">
              <label htmlFor="weekStart" className="mb-1.5 block text-sm font-medium text-foreground">
                Week of (Monday)
              </label>
              <input
                id="weekStart"
                type="date"
                value={weekDate}
                onChange={(e) => setWeekDate(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Only trades closed between this Monday and the following Sunday
                will be included.
              </p>
            </div>

            <DialogFooter>
              <div className="flex w-full justify-end gap-2">
                <DialogClose asChild>
                  <button
                    type="button"
                    className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                </DialogClose>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
                >
                  {generating ? (
                    <>
                      <RotateCcw className="size-3.5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'Generate'
                  )}
                </button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Success message */}
      {message && message.type === 'success' && (
        <div className="mb-6 rounded-lg border border-positive/30 bg-positive/10 px-4 py-3 text-sm text-positive">
          {message.text}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 ? (
        <EmptyState
          icon={<Star className="size-12 text-muted-foreground" strokeWidth={1} />}
          title="No reviews completed"
          description="Weekly reviews help you spot patterns in your trading behavior and track your improvement over time. Generate your first review to see aggregated metrics from a week of closed trades."
          action={
            <button
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
            >
              <CalendarPlus className="size-4" />
              Generate Review
            </button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Week
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Trades
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Net P&amp;L
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Win Rate
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Avg R
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Grade
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((review) => {
                const grade = gradeLabelFromScore(review.avgProcessScore);
                const isExpanded = expandedReviewId === review.id;
                const actionItems = actionItemsMap[review.id] ?? [];
                const loadingActions = loadingActionItems[review.id] ?? false;

                return (
                  <Fragment key={review.id}>
                    {/* Main review row */}
                    <tr
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleExpand(review.id)}
                    >
                      <td className="px-2 py-3">
                        <button
                          className="text-muted-foreground hover:text-foreground"
                          onClick={(e) => { e.stopPropagation(); toggleExpand(review.id); }}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {tzFormatWeekRange(review.weekStart, review.weekEnd)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {review.closedTrades}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${pnlBadgeClass(review.netPnl)}`}>
                        {formatCurrency(review.netPnl)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {formatPercent(review.winRate)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {formatDecimal(review.avgR)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${gradeBadgeClass(grade)}`}
                        >
                          {grade}
                        </span>
                      </td>
                    </tr>

                    {/* Expanded action items row */}
                    {isExpanded && (
                      <tr key={`${review.id}-actions`}>
                        <td colSpan={7} className="bg-muted/50 px-4 py-3">
                          {loadingActions ? (
                            <p className="text-xs text-muted-foreground">Loading action items...</p>
                          ) : actionItems.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No action items for this review.
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              <p className="mb-2 text-xs font-medium text-muted-foreground">
                                Action Items
                              </p>
                              {actionItems.map((ai) => (
                                <div
                                  key={ai.id}
                                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                                >
                                  <button
                                    onClick={() =>
                                      cycleActionStatus(ai.id, ai.status, review.id)
                                    }
                                    className="shrink-0 text-left"
                                    title={`Status: ${ai.status}. Click to cycle.`}
                                  >
                                    <span
                                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${actionStatusBadgeClass(ai.status)}`}
                                    >
                                      {ai.status === 'in_progress' ? 'In Progress' : ai.status.charAt(0).toUpperCase() + ai.status.slice(1)}
                                    </span>
                                  </button>
                                  <span className="flex-1 text-sm text-foreground">
                                    {ai.actionText}
                                  </span>
                                  {ai.dueDate && (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      Due {tzFormatDate(ai.dueDate)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dashboard Sections */}
      {dashboardError && (
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{dashboardError}</span>
          </div>
        </div>
      )}

      {dashboardLoading && !dashboardData && (
        <div className="mt-6">
          <p className="text-sm text-muted-foreground">Loading dashboard data...</p>
        </div>
      )}

      {dashboardData && (
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Setup Performance */}
          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-base font-semibold text-foreground">
              Setup Performance
            </h2>
            {dashboardData.setupPerformance.length === 0 ? (
              <p className="text-xs text-muted-foreground">No setup data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Setup</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Trades</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Win Rate</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Avg R</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Score</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Sample</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dashboardData.setupPerformance.map((setup) => (
                      <tr key={setup.setupId ?? 'unknown'} className="hover:bg-muted/50">
                        <td className="px-2 py-1.5 font-medium text-foreground">
                          {setup.setupName}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {setup.count}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {formatPercent(setup.winRate)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {formatDecimal(setup.avgR)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {formatDecimal(setup.avgProcessScore, 1)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${sampleSizeBadgeClass(setup.sampleSizeWarning)}`}>
                            {sampleSizeLabel(setup.sampleSizeWarning)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Grade Trends */}
          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-base font-semibold text-foreground">
              Grade Trends
            </h2>
            {items.filter((r) => r.avgProcessScore != null).length === 0 ? (
              <p className="text-xs text-muted-foreground">No grade data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Week</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Score</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items
                      .filter((r) => r.avgProcessScore != null)
                      .map((review) => {
                        const grade = gradeLabelFromScore(review.avgProcessScore);
                        return (
                          <tr key={review.id} className="hover:bg-muted/50">
                            <td className="px-2 py-1.5 text-foreground">
                              {tzFormatWeekRange(review.weekStart, review.weekEnd)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                              {formatDecimal(review.avgProcessScore, 1)}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${gradeBadgeClass(grade)}`}>
                                {grade}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Mistake Frequency */}
          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-base font-semibold text-foreground">
              Mistake Frequency
            </h2>
            {dashboardData.mistakeFrequency.length === 0 ? (
              <p className="text-xs text-muted-foreground">No mistake data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Type</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Minor</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Mod</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Major</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Crit</th>
                      <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dashboardData.mistakeFrequency.map((mf) => (
                      <tr key={mf.mistakeType} className="hover:bg-muted/50">
                        <td className="px-2 py-1.5 font-medium text-foreground">
                          {mf.mistakeType}
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${mf.minor > 0 ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
                          {mf.minor}
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${mf.moderate > 0 ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
                          {mf.moderate}
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${mf.major > 0 ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
                          {mf.major}
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${mf.critical > 0 ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
                          {mf.critical}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium text-foreground">
                          {mf.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-base font-semibold text-foreground">
              Quick Actions
            </h2>
            {dashboardData.ungradedTrades.length === 0 ? (
              <p className="text-xs text-muted-foreground">All trades have been graded.</p>
            ) : (
              <div className="space-y-1.5">
                {dashboardData.ungradedTrades.slice(0, 10).map((trade) => (
                  <Link
                    key={trade.id}
                    href={`/trades/${trade.id}`}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-muted"
                  >
                    <span className="font-mono text-muted-foreground">{trade.tradeCode}</span>
                    <span className="font-medium text-foreground">{trade.symbol}</span>
                    <span className={`text-[10px] ${trade.direction === 'long' ? 'text-positive' : 'text-negative'}`}>
                      {trade.direction === 'long' ? 'LONG' : 'SHORT'}
                    </span>
                    <span className="ml-auto text-muted-foreground">Grade &rarr;</span>
                  </Link>
                ))}
                {dashboardData.ungradedTrades.length > 10 && (
                  <p className="pt-1 text-center text-xs text-muted-foreground">
                    +{dashboardData.ungradedTrades.length - 10} more ungraded trades
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


