'use client';

import { useEffect, useState, Fragment } from 'react';
import { Star, CalendarPlus, ChevronDown, ChevronRight, RotateCcw, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

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

function formatDate(d: string | null): string {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return d;
  }
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString(undefined, opts)} — ${e.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
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
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'B':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'C':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'D':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
    default:
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  }
}

function actionStatusBadgeClass(status: ActionItem['status']): string {
  switch (status) {
    case 'open':
      return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
    case 'in_progress':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'done':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'cancelled':
      return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
  }
}

function pnlBadgeClass(pnl: number): string {
  if (pnl > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (pnl < 0) return 'text-red-600 dark:text-red-400';
  return 'text-zinc-500 dark:text-zinc-400';
}

// ── Dashboard Helpers ──────────────────────────────────────────────────

function sampleSizeBadgeClass(level: DashboardSetupPerformance['sampleSizeWarning']): string {
  switch (level) {
    case 'very_small':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'small':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'moderate':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'adequate':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
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
        <p className="text-sm text-zinc-500">Loading reviews...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Reviews
        </h1>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setMessage(null); }}>
          <DialogTrigger asChild>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
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
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
                {message.text}
              </div>
            )}

            <div className="py-2">
              <label htmlFor="weekStart" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Week of (Monday)
              </label>
              <input
                id="weekStart"
                type="date"
                value={weekDate}
                onChange={(e) => setWeekDate(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                Only trades closed between this Monday and the following Sunday
                will be included.
              </p>
            </div>

            <DialogFooter>
              <div className="flex w-full justify-end gap-2">
                <DialogClose asChild>
                  <button
                    type="button"
                    className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                </DialogClose>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
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
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
          {message.text}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 ? (
        <EmptyState
          icon={<Star className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
          title="No reviews completed"
          description="Weekly reviews help you spot patterns in your trading behavior and track your improvement over time. Generate your first review to see aggregated metrics from a week of closed trades."
          action={
            <button
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <CalendarPlus className="size-4" />
              Generate Review
            </button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
                  Week
                </th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Trades
                </th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Net P&amp;L
                </th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Win Rate
                </th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Avg R
                </th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500 dark:text-zinc-400">
                  Grade
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {items.map((review) => {
                const grade = gradeLabelFromScore(review.avgProcessScore);
                const isExpanded = expandedReviewId === review.id;
                const actionItems = actionItemsMap[review.id] ?? [];
                const loadingActions = loadingActionItems[review.id] ?? false;

                return (
                  <Fragment key={review.id}>
                    {/* Main review row */}
                    <tr
                      className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                      onClick={() => toggleExpand(review.id)}
                    >
                      <td className="px-2 py-3">
                        <button
                          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          onClick={(e) => { e.stopPropagation(); toggleExpand(review.id); }}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                        {formatWeekRange(review.weekStart, review.weekEnd)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        {review.closedTrades}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${pnlBadgeClass(review.netPnl)}`}>
                        {formatCurrency(review.netPnl)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                        {formatPercent(review.winRate)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
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
                        <td colSpan={7} className="bg-zinc-50 px-4 py-3 dark:bg-zinc-900/30">
                          {loadingActions ? (
                            <p className="text-xs text-zinc-400">Loading action items...</p>
                          ) : actionItems.length === 0 ? (
                            <p className="text-xs text-zinc-400 dark:text-zinc-500">
                              No action items for this review.
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                Action Items
                              </p>
                              {actionItems.map((ai) => (
                                <div
                                  key={ai.id}
                                  className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
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
                                  <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">
                                    {ai.actionText}
                                  </span>
                                  {ai.dueDate && (
                                    <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                                      Due {formatDate(ai.dueDate)}
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
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{dashboardError}</span>
          </div>
        </div>
      )}

      {dashboardLoading && !dashboardData && (
        <div className="mt-6">
          <p className="text-sm text-zinc-400">Loading dashboard data...</p>
        </div>
      )}

      {dashboardData && (
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Setup Performance */}
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Setup Performance
            </h2>
            {dashboardData.setupPerformance.length === 0 ? (
              <p className="text-xs text-zinc-400">No setup data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800">
                      <th className="px-2 py-1.5 text-left font-medium text-zinc-500">Setup</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Trades</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Win Rate</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Avg R</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Score</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Sample</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {dashboardData.setupPerformance.map((setup) => (
                      <tr key={setup.setupId ?? 'unknown'} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/30">
                        <td className="px-2 py-1.5 font-medium text-zinc-800 dark:text-zinc-200">
                          {setup.setupName}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {setup.count}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {formatPercent(setup.winRate)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {formatDecimal(setup.avgR)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
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
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Grade Trends
            </h2>
            {items.filter((r) => r.avgProcessScore != null).length === 0 ? (
              <p className="text-xs text-zinc-400">No grade data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800">
                      <th className="px-2 py-1.5 text-left font-medium text-zinc-500">Week</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Score</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {items
                      .filter((r) => r.avgProcessScore != null)
                      .map((review) => {
                        const grade = gradeLabelFromScore(review.avgProcessScore);
                        return (
                          <tr key={review.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/30">
                            <td className="px-2 py-1.5 text-zinc-800 dark:text-zinc-200">
                              {formatWeekRange(review.weekStart, review.weekEnd)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
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
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Mistake Frequency
            </h2>
            {dashboardData.mistakeFrequency.length === 0 ? (
              <p className="text-xs text-zinc-400">No mistake data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800">
                      <th className="px-2 py-1.5 text-left font-medium text-zinc-500">Type</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Minor</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Mod</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Major</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Crit</th>
                      <th className="px-2 py-1.5 text-right font-medium text-zinc-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {dashboardData.mistakeFrequency.map((mf) => (
                      <tr key={mf.mistakeType} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/30">
                        <td className="px-2 py-1.5 font-medium text-zinc-800 dark:text-zinc-200">
                          {mf.mistakeType}
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${mf.minor > 0 ? 'text-zinc-600 dark:text-zinc-400' : 'text-zinc-300 dark:text-zinc-600'}`}>
                          {mf.minor}
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${mf.moderate > 0 ? 'text-zinc-600 dark:text-zinc-400' : 'text-zinc-300 dark:text-zinc-600'}`}>
                          {mf.moderate}
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${mf.major > 0 ? 'text-zinc-600 dark:text-zinc-400' : 'text-zinc-300 dark:text-zinc-600'}`}>
                          {mf.major}
                        </td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${mf.critical > 0 ? 'text-zinc-600 dark:text-zinc-400' : 'text-zinc-300 dark:text-zinc-600'}`}>
                          {mf.critical}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium text-zinc-700 dark:text-zinc-300">
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
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="mb-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Quick Actions
            </h2>
            {dashboardData.ungradedTrades.length === 0 ? (
              <p className="text-xs text-zinc-400">All trades have been graded.</p>
            ) : (
              <div className="space-y-1.5">
                {dashboardData.ungradedTrades.slice(0, 10).map((trade) => (
                  <Link
                    key={trade.id}
                    href={`/trades/${trade.id}`}
                    className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:bg-zinc-800"
                  >
                    <span className="font-mono text-zinc-500">{trade.tradeCode}</span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{trade.symbol}</span>
                    <span className={`text-[10px] ${trade.direction === 'long' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {trade.direction === 'long' ? 'LONG' : 'SHORT'}
                    </span>
                    <span className="ml-auto text-zinc-400">Grade &rarr;</span>
                  </Link>
                ))}
                {dashboardData.ungradedTrades.length > 10 && (
                  <p className="pt-1 text-center text-xs text-zinc-400">
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


