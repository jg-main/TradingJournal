'use client';

import { useEffect, useState } from 'react';
import {
  NotebookPen,
  TrendingUp,
  Target,
  Star,
  TrendingDown,
  Wallet,
  AlertTriangle,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { DashboardChart } from '@/components/dashboard-chart';
import type { EquityDataPoint, DrawdownDataPoint } from '@/lib/equity';

// ── Types ──────────────────────────────────────────────────────────────

interface KpiMetrics {
  totalTrades: number;
  openTrades: number;
  winRate: number | null;
  netPnl: number;
  avgR: number | null;
  avgGrade: number | null;
  currentDrawdown: number | null;
  currentDrawdownPct: number | null;
  accountValue: number | null;
}

interface DashboardResponse {
  kpis: KpiMetrics;
  equityCurve: EquityDataPoint[];
  drawdown: DrawdownDataPoint[];
}

// ── Grade Rubric (matches reviews page) ────────────────────────────────

const GRADE_RUBRIC: { min: number; label: string }[] = [
  { min: 54, label: 'A' },
  { min: 42, label: 'B' },
  { min: 30, label: 'C' },
  { min: 18, label: 'D' },
];

// ── Formatting Helpers (follow reviews page patterns) ──────────────────

function formatCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return '--';
  return `${(v * 100).toFixed(1)}%`;
}

function formatDecimal(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return '--';
  return v.toFixed(digits);
}

function gradeLabelFromScore(score: number | null): string {
  if (score === null || score === undefined) return '--';
  for (const tier of GRADE_RUBRIC) {
    if (score >= tier.min) return tier.label;
  }
  return 'F';
}

// ── Color helpers ──────────────────────────────────────────────────────

function pnlColorClass(v: number): string {
  if (v > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (v < 0) return 'text-red-600 dark:text-red-400';
  return 'text-zinc-500 dark:text-zinc-400';
}

// ── KPI Card Layout ────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  iconBg: string;
  value: React.ReactNode;
  label: string;
  valueClassName?: string;
}

function KpiCard({ icon, iconBg, value, label, valueClassName }: KpiCardProps) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-0 p-5">
        <div className={`mb-3 flex size-9 items-center justify-center rounded-lg ${iconBg}`}>
          {icon}
        </div>
        <p
          className={`text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100 ${valueClassName ?? ''}`}
        >
          {value}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      </CardContent>
    </Card>
  );
}

// ── Skeleton Card ──────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 size-9 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
      <div className="mb-1 h-7 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-3 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default function Home() {
  const [kpis, setKpis] = useState<KpiMetrics | null>(null);
  const [equityCurve, setEquityCurve] = useState<EquityDataPoint[]>([]);
  const [drawdown, setDrawdown] = useState<DrawdownDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to load dashboard');
      }
      const data: DashboardResponse = await res.json();
      setKpis(data.kpis);
      setEquityCurve(data.equityCurve);
      setDrawdown(data.drawdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      setKpis(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  // Detect empty state: all measurable fields are at empty/null baseline
  const isEmpty =
    kpis !== null &&
    kpis.totalTrades === 0 &&
    kpis.winRate === null &&
    kpis.netPnl === 0 &&
    kpis.avgR === null &&
    kpis.avgGrade === null &&
    kpis.currentDrawdown === null &&
    kpis.accountValue === null;

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Dashboard
      </h1>
      <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
        Overview of your trading performance and activity.
      </p>

      {/* Error state — shown inline below header, keeps rest of page visible */}
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state — pulse-animated skeleton rectangles */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* KPI cards grid */}
      {!loading && kpis !== null && !isEmpty && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 1. Total Trades */}
          <KpiCard
            icon={<NotebookPen className="size-4 text-emerald-600 dark:text-emerald-400" />}
            iconBg="bg-emerald-100 dark:bg-emerald-900/30"
            value={kpis.totalTrades}
            label="Total Trades"
          />

          {/* 2. Win Rate */}
          <KpiCard
            icon={<TrendingUp className="size-4 text-blue-600 dark:text-blue-400" />}
            iconBg="bg-blue-100 dark:bg-blue-900/30"
            value={formatPercent(kpis.winRate)}
            label="Win Rate"
          />

          {/* 3. Net P&L */}
          <KpiCard
            icon={<Target className="size-4 text-amber-600 dark:text-amber-400" />}
            iconBg="bg-amber-100 dark:bg-amber-900/30"
            value={formatCurrency(kpis.netPnl)}
            valueClassName={pnlColorClass(kpis.netPnl)}
            label="Net P&amp;L"
          />

          {/* 4. Avg R */}
          <KpiCard
            icon={<Star className="size-4 text-purple-600 dark:text-purple-400" />}
            iconBg="bg-purple-100 dark:bg-purple-900/30"
            value={formatDecimal(kpis.avgR)}
            label="Avg R"
          />

          {/* 5. Avg Grade */}
          <KpiCard
            icon={<Star className="size-4 text-zinc-600 dark:text-zinc-400" />}
            iconBg="bg-zinc-100 dark:bg-zinc-800"
            value={
              kpis.avgGrade !== null
                ? `${formatDecimal(kpis.avgGrade)} (${gradeLabelFromScore(kpis.avgGrade)})`
                : '--'
            }
            label="Avg Grade"
          />

          {/* 6. Current Drawdown */}
          <KpiCard
            icon={<TrendingDown className="size-4 text-red-600 dark:text-red-400" />}
            iconBg="bg-red-100 dark:bg-red-900/30"
            value={
              kpis.currentDrawdown !== null
                ? `${formatCurrency(Math.abs(kpis.currentDrawdown))}${kpis.currentDrawdownPct !== null ? ` (${formatPercent(Math.abs(kpis.currentDrawdownPct))})` : ''}`
                : '--'
            }
            valueClassName="text-red-600 dark:text-red-400"
            label="Current Drawdown"
          />

          {/* 7. Account Value */}
          <KpiCard
            icon={<Wallet className="size-4 text-emerald-600 dark:text-emerald-400" />}
            iconBg="bg-emerald-100 dark:bg-emerald-900/30"
            value={formatCurrency(kpis.accountValue)}
            label="Account Value"
          />
        </div>
      )}

      {/* Empty state — when no trades exist or error occurred */}
      {!loading && (kpis === null || isEmpty) && (
        <EmptyState
          icon={
            <NotebookPen
              className="size-12 text-zinc-300 dark:text-zinc-600"
              strokeWidth={1}
            />
          }
          title="No trades yet"
          description="Start logging trades to see your dashboard come to life."
        />
      )}

      {/* Charts section — equity curve and drawdown */}
      {!loading && kpis !== null && !isEmpty && (
        <section className="mt-8">
          <h2 className="mb-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Performance Charts
          </h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Equity Curve Panel */}
            <Card>
              <CardHeader>
                <CardTitle>Equity Curve</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {equityCurve.length === 0 ? (
                  <div className="px-(--card-spacing) pb-(--card-spacing)">
                    <EmptyState
                      icon={
                        <TrendingUp
                          className="size-10 text-zinc-300 dark:text-zinc-600"
                          strokeWidth={1}
                        />
                      }
                      title="No equity data available"
                      description="Start trading to see your equity curve."
                    />
                  </div>
                ) : (
                  <DashboardChart
                    option={{
                      xAxis: { type: 'time' } as const,
                      yAxis: { type: 'value', axisLabel: { formatter: '${value}' } },
                      series: [{
                        type: 'line',
                        smooth: true,
                        showSymbol: false,
                        lineStyle: { width: 2 },
                        color: '#2563eb',
                        areaStyle: {
                          color: {
                            type: 'linear',
                            x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [
                              { offset: 0, color: 'rgba(37, 99, 235, 0.25)' },
                              { offset: 1, color: 'rgba(37, 99, 235, 0.01)' },
                            ],
                          },
                        },
                        data: equityCurve.map(
                          (dp) => [Date.parse(dp.date), dp.equity] as [number, number],
                        ),
                      }],
                      tooltip: {
                        trigger: 'axis',
                        valueFormatter: (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                      },
                      grid: { left: '10%', right: '5%', top: 20, bottom: 25 },
                    }}
                  />
                )}
              </CardContent>
            </Card>

            {/* Drawdown Panel */}
            <Card>
              <CardHeader>
                <CardTitle>Drawdown</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {drawdown.length === 0 ? (
                  <div className="px-(--card-spacing) pb-(--card-spacing)">
                    <EmptyState
                      icon={
                        <TrendingDown
                          className="size-10 text-zinc-300 dark:text-zinc-600"
                          strokeWidth={1}
                        />
                      }
                      title="No drawdown data available"
                      description="Your drawdown chart will appear here after you start trading."
                    />
                  </div>
                ) : (
                  <DashboardChart
                    option={{
                      xAxis: { type: 'time' } as const,
                      yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
                      series: [{
                        type: 'line',
                        smooth: true,
                        showSymbol: false,
                        lineStyle: { width: 2 },
                        color: '#ef4444',
                        areaStyle: { color: 'rgba(239, 68, 68, 0.15)' },
                        data: drawdown.map(
                          (dp) => [Date.parse(dp.date), dp.drawdownPct * 100] as [number, number],
                        ),
                      }],
                      tooltip: {
                        trigger: 'axis',
                        valueFormatter: (v: number) => `${v.toFixed(1)}%`,
                      },
                      grid: { left: '10%', right: '5%', top: 20, bottom: 25 },
                    }}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Charts loading skeleton — pulse-animated rectangles during data fetch */}
      {loading && (
        <section className="mt-8">
          <div className="mb-4 h-5 w-40 rounded bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-[300px] w-full rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
            <div className="animate-pulse rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-[300px] w-full rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
