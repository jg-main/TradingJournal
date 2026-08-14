'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppTimezone } from '@/lib/timezone-context';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import type { CheckResult, MtmData } from '@/components/trade-detail/types';
import { EmptyState } from '@/components/empty-state';
import { ConfirmDialog } from '@/components/confirm-dialog';

import type { TradeMetricsResult } from '@/lib/trade-metrics';
import type { PerfMetrics } from '@/lib/perf-metrics';
import { useVisibilityPolling } from '@/hooks/use-visibility-polling';
import { useMtmRefreshInterval } from '@/hooks/use-mtm-refresh-interval';
import type { GradeFormPayload } from '@/components/trade-detail/trade-grade-card';

import PlannedPhaseView from '@/components/trade-detail/planned-phase-view';
import ActivePhaseView from '@/components/trade-detail/active-phase-view';
import ClosedPhaseView from '@/components/trade-detail/closed-phase-view';
import DeletedPhaseView from '@/components/trade-detail/deleted-phase-view';
import type { LevelHistoryEvent } from '@/components/trade-detail/trade-history-feed';
import { AddFillDialog } from '@/components/trade-detail/add-fill-dialog';
import { ExecuteDialog, type ExecuteTradeData } from '@/components/execute-dialog';
import EditTradeDialog from '@/components/edit-trade-dialog';

// ── Types ──────────────────────────────────────────────────────────────

interface Trade {
  id: string;
  tradeCode: string;
  symbol: string;
  direction: 'long' | 'short';
  accountId: string;
  setupId: string | null;
  setupName: string | null;
  marketConditionId: string | null;
  status: 'planned' | 'open' | 'closed' | 'deleted';
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
  plannedTarget2: number | null;
  plannedQuantity: number | null;
  thesis: string | null;
  invalidationCondition: string | null;
  preTradePlan: string | null;
  openedAt: string | null;
  closedAt: string | null;
  exitNotes: string | null;
  lesson: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface Execution {
  id: string;
  tradeId: string;
  action: string;
  quantity: number;
  price: number;
  fees: number | null;
  executedAt: string | null;
  reasonId: string | null;
  notes: string | null;
  createdAt: string | null;
}

interface RiskSnapshot {
  id: string;
  tradeId: string;
  accountEquityAtOpen: number | null;
  initialEntryPrice: number | null;
  initialStopPrice: number | null;
  initialQuantity: number | null;
  riskPerShare: number | null;
  initialRiskAmount: number | null;
  accountRiskPct: number | null;
  plannedRewardRisk: number | null;
  createdAt: string | null;
}

interface StopAdjustment {
  id: string;
  tradeId: string;
  adjustedAt: string | null;
  previousStop: number | null;
  newStop: number | null;
  reason: string | null;
  ruleBased: boolean | null;
  notes: string | null;
  createdAt: string | null;
}

interface TargetAdjustment {
  id: string;
  tradeId: string;
  /** Which planned target level this adjustment rewrites: 1 = target 1, 2 = target 2. */
  targetIndex: 1 | 2;
  adjustedAt: string | null;
  previousTarget: number | null;
  newTarget: number | null;
  reason: string | null;
  ruleBased: boolean | null;
  notes: string | null;
  createdAt: string | null;
}

interface TradeAsset {
  id: string;
  tradeId: string;
  assetType: 'screenshot' | 'document' | 'link' | 'image' | 'other';
  phase: 'pre_trade' | 'entry' | 'management' | 'exit' | 'review';
  label: string | null;
  filePath: string | null;
  externalUrl: string | null;
  notes: string | null;
  createdAt: string;
}

interface TradeGrade {
  id: string;
  tradeId: string;
  setupQualityScore: number;
  riskQualityScore: number;
  entryQualityScore: number;
  managementQualityScore: number;
  exitQualityScore: number;
  reviewQualityScore: number;
  totalScore: number;
  gradeLabel: string;
  followedPlan: boolean | null;
  ruleViolation: boolean | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TradeMistake {
  id: string;
  tradeId: string;
  mistakeTypeId: string | null;
  phase: 'pre_trade' | 'entry' | 'management' | 'exit' | 'review';
  severity: 'minor' | 'moderate' | 'major' | 'critical';
  rootCause: string | null;
  correctiveAction: string | null;
  status: 'open' | 'addressed' | 'improved' | 'resolved';
  createdAt: string | null;
  updatedAt: string | null;
}

interface LookupValue {
  id: string;
  type: string;
  value: string;
  description: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatDate(d: string | null, timezone?: string): string {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString(undefined, { ...(timezone ? { timeZone: timezone } : {}),
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d;
  }
}

/**
 * Fetch MTM (mark-to-market) data for a single trade from the API.
 * Used on mount and after manual price refresh.
 */
async function fetchMtmData(tradeId: string, setter: (data: MtmData) => void): Promise<void> {
  setter({ price: null, marketState: null, shortName: null, quoteType: null, sector: null, industry: null, previousClose: null, dayHigh: null, dayLow: null, change: null, changePercent: null, fetchedAt: null, source: null, loading: true, error: null });
  try {
    const res = await fetch(`/api/trades/${tradeId}/mtm`);
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      setter({
        price: null,
        marketState: null,
        shortName: null,
        quoteType: null,
        sector: null,
        industry: null,
        previousClose: null,
        dayHigh: null,
        dayLow: null,
        change: null,
        changePercent: null,
        fetchedAt: null,
        source: null,
        loading: false,
        error: errorBody.error ?? 'Failed to fetch MTM data',
      });
      return;
    }
    const data = await res.json();
    setter({
      price: data.price ?? null,
      marketState: data.marketState ?? null,
      shortName: data.shortName ?? null,
      sector: data.sector ?? null,
      industry: data.industry ?? null,
      quoteType: data.quoteType ?? null,
      previousClose: data.previousClose ?? null,
      dayHigh: data.dayHigh ?? null,
      dayLow: data.dayLow ?? null,
      change: data.change ?? null,
      changePercent: data.changePercent ?? null,
      fetchedAt: data.fetchedAt ?? null,
      source: data.source ?? null,
      loading: false,
      error: null,
    });
  } catch (err) {
    setter({
      price: null,
      marketState: null,
      shortName: null,
      quoteType: null,
      sector: null,
      industry: null,
      previousClose: null,
      dayHigh: null,
      dayLow: null,
      change: null,
      changePercent: null,
      fetchedAt: null,
      source: null,
      loading: false,
      error: String(err),
    });
  }
}

// ── Page ───────────────────────────────────────────────────────────────

export default function TradeDetailPage() {
  const { timezone } = useAppTimezone();
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();

  const [trade, setTrade] = useState<Trade | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  // M019/S03: unified history feed input — stop/target adjustments from the S01
  // level-history API (the feed also merges executions from the existing fetch).
  const [levelHistory, setLevelHistory] = useState<LevelHistoryEvent[]>([]);
  const [riskSnapshot, setRiskSnapshot] = useState<RiskSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stopAdjustments, setStopAdjustments] = useState<StopAdjustment[]>([]);
  const [targetAdjustments, setTargetAdjustments] = useState<TargetAdjustment[]>([]);
  const [mtmData, setMtmData] = useState<MtmData>({
    price: null,
    marketState: null,
    shortName: null,
    quoteType: null,
    fetchedAt: null,
    source: null,
    loading: false,
    error: null,
  });
  const [assets, setAssets] = useState<TradeAsset[]>([]);
  const [grade, setGrade] = useState<TradeGrade | null>(null);
  const [mistakes, setMistakes] = useState<TradeMistake[]>([]);
  const [mistakeTypes, setMistakeTypes] = useState<LookupValue[]>([]);
  const [checkResults, setCheckResults] = useState<CheckResult[]>([]);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const [executeOpen, setExecuteOpen] = useState(false);
  const [executeData, setExecuteData] = useState<ExecuteTradeData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  // M019/S04/T02: the page owns the AddFillDialog open state; the open trigger
  // threads down (ActivePhaseView/ClosedPhaseView → RiskSnapshotCard →
  // TradeDetailsCard "Add Fill" button) and onComplete reuses the
  // handleExecutionAdded refetch path so executions + the unified history feed
  // (TradeHistoryFeed) stay current after a fill (must-have #6).
  const [addFillOpen, setAddFillOpen] = useState(false);
  const mtmRefreshIntervalMs = useMtmRefreshInterval();
  // Trade awaiting scratch confirmation (M015/S02/T02). The page owns the
  // ConfirmDialog and the DELETE /api/trades/[id] call; PlannedPhaseView only
  // triggers the request via its onScratch callback.
  const [scratchOpen, setScratchOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const [tradeRes, executionsRes, riskRes, adjustmentsRes, targetAdjustmentsRes, levelHistoryRes] = await Promise.all([
          fetch(`/api/trades/${id}`), fetch(`/api/trades/${id}/executions`),
          fetch(`/api/trades/${id}/risk-snapshot`), fetch(`/api/trades/${id}/stop-adjustments`),
          fetch(`/api/trades/${id}/target-adjustments`),
          fetch(`/api/trades/${id}/level-history`),
        ]);

        // Fetch MTM data in parallel (non-blocking for trade detail)
        if (!cancelled) {
          fetchMtmData(id, setMtmData);
        }
        if (cancelled) return;
        if (!tradeRes.ok) {
          setError(tradeRes.status === 404 ? 'Trade not found.' : (await tradeRes.json().catch(() => ({}))).error ?? 'Failed to load trade.');
          return;
        }
        const tradeData: Trade = await tradeRes.json();
        setTrade(tradeData);
        if (executionsRes.ok) setExecutions(await executionsRes.json());
        if (riskRes.ok) setRiskSnapshot(await riskRes.json());
        if (adjustmentsRes.ok) setStopAdjustments(await adjustmentsRes.json());
        if (targetAdjustmentsRes.ok) setTargetAdjustments(await targetAdjustmentsRes.json());
        if (levelHistoryRes.ok) setLevelHistory(await levelHistoryRes.json());
        const assetsRes = await fetch(`/api/trades/${id}/assets`);
        if (!cancelled && assetsRes.ok) setAssets(await assetsRes.json());
        if (tradeData.status === 'closed') {
          const gradeRes = await fetch(`/api/trades/${id}/grade`);
          if (!cancelled && gradeRes.ok) setGrade(await gradeRes.json());
        }
        const mistakesRes = await fetch(`/api/trades/${id}/mistakes`);
        if (!cancelled && mistakesRes.ok) setMistakes(await mistakesRes.json());
        if (!cancelled) {
          const lookupRes = await fetch('/api/lookups?type=mistake_type');
          if (lookupRes.ok) setMistakeTypes(await lookupRes.json());
        }
        if (tradeData.status !== 'planned') {
          const checkRes = await fetch(`/api/trades/${id}/check-results`);
          if (!cancelled && checkRes.ok) setCheckResults(await checkRes.json());
        }
      } catch (err) {
        if (!cancelled) {
          // Detect transient navigation aborts — not real errors
          if (
            (err instanceof DOMException && err.name === 'AbortError') ||
            (err instanceof TypeError && /abort/i.test(err.message)) ||
            (err instanceof TypeError && /cancelled/i.test(err.message))
          ) {
            return;
          }
          setError(String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, [id, refetchTrigger]);

  // Initial batch MTM refresh on mount for open trades
  useEffect(() => {
    if (trade?.status !== 'open') return;
    fetch('/api/trades/mtm/refresh', { method: 'POST' })
      .then(() => fetchMtmData(id, setMtmData))
      .catch(() => {});
  }, [trade?.status, id]);

  // Continuous visibility-aware polling at the configured mark-refresh cadence.
  useVisibilityPolling(
    () => {
      fetch('/api/trades/mtm/refresh', { method: 'POST' })
        .then(() => fetchMtmData(id, setMtmData))
        .catch(() => {});
    },
    mtmRefreshIntervalMs,
    trade?.status === 'open',
  );

  /** Derive duration in ms from position timestamps (enriched inline, no computePerfMetrics).
   *  For open trade, uses Date.now() — matching the previous computePerfMetrics(closedAt = now) behavior. */
  function deriveDuration(openedAt: string | null, closedAt: string | null): number | null {
    if (!openedAt) return null;
    const closeTime = closedAt ? new Date(closedAt).getTime() : Date.now();
    const openTime = new Date(openedAt).getTime();
    if (isNaN(openTime) || isNaN(closeTime)) return null;
    return closeTime - openTime;
  }

  // Derived from canonical API metrics (no duplicate computeTradeMetrics/computePerfMetrics)
  const apiMetrics = (trade as { metrics?: TradeMetricsResult })?.metrics ?? null;
  const hasExecutionData = apiMetrics != null && apiMetrics.size.entryQuantity > 0;
  const metrics = hasExecutionData ? apiMetrics : null;

  const derivedStatus = metrics
    ? {
        status: metrics.position.status,
        openedAt: metrics.position.openedAt,
        closedAt: metrics.position.closedAt,
        openQuantity: metrics.size.openQuantity,
        totalEntryQty: metrics.size.entryQuantity,
        totalExitQty: metrics.size.exitQuantity,
      }
    : null;
  const pnlResult = metrics
    ? {
        totalRealizedPnL: metrics.realizedPnl.netRealizedPnl,
        avgEntryPrice: metrics.averagePrices.avgEntryPrice,
        totalEntryQty: metrics.size.entryQuantity,
        totalExitQty: metrics.size.exitQuantity,
      }
    : null;
  const rMultiple = metrics
    ? { rMultiple: metrics.returnMetrics.rMultiple, initialRiskUsed: metrics.risk.initialRisk != null }
    : null;

  // Derive unrealized values from canonical metrics (FIFO-aware, partial-exit accurate)
  const unrealizedPnl = hasExecutionData ? apiMetrics.unrealizedPnl.grossUnrealizedPnl ?? null : null;
  const unrealizedReturnPct =
    hasExecutionData &&
    unrealizedPnl != null &&
    apiMetrics.averagePrices.openAvgCost != null &&
    apiMetrics.size.openQuantity > 0
      ? (unrealizedPnl / (apiMetrics.averagePrices.openAvgCost * apiMetrics.size.openQuantity)) * 100
      : null;
  const unrealizedRMultiple =
    hasExecutionData &&
    unrealizedPnl != null &&
    apiMetrics.risk.initialRisk != null &&
    apiMetrics.risk.initialRisk > 0
      ? unrealizedPnl / apiMetrics.risk.initialRisk
      : null;

  // Derive duration from canonical position timestamps (inline, no computePerfMetrics)
  const perfMetrics: PerfMetrics | null = metrics
    ? {
        duration: deriveDuration(metrics.position.openedAt, metrics.position.closedAt),
        // Canonical trade metrics expose a decimal fraction (0.0552), while
        // TradePnlCard formats percentage points (5.52).
        returnPercent:
          metrics.returnMetrics.returnPct == null
            ? null
            : metrics.returnMetrics.returnPct * 100,
        totalFees: metrics.fees.totalFees,
      }
    : null;

  const handleRiskSnapshotSave = async (payload: Record<string, number | null>) => {
    const res = await fetch(`/api/trades/${id}/risk-snapshot`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('Failed to save risk snapshot');
    setRiskSnapshot(await res.json());
  };

  const handleGradeSave = async (payload: GradeFormPayload) => {
    const res = await fetch(`/api/trades/${id}/grade`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('Failed to save grade');
    setGrade(await res.json());
  };

  // M019/S02: both adjustment chains are refetched together so the Trade Details
  // card's derived Current values stay consistent after any edit (stop or target).
  // M019/S03: the level-history feed is refetched in the same pass so the unified
  // History feed reflects the new adjustment immediately.
  const handleAdjustmentAdded = async () => {
    const [sRes, tRes, lRes] = await Promise.all([
      fetch(`/api/trades/${id}/stop-adjustments`),
      fetch(`/api/trades/${id}/target-adjustments`),
      fetch(`/api/trades/${id}/level-history`),
    ]);
    if (sRes.ok) setStopAdjustments(await sRes.json());
    if (tRes.ok) setTargetAdjustments(await tRes.json());
    if (lRes.ok) setLevelHistory(await lRes.json());
  };
  const handleAssetsChanged = async () => { const res = await fetch(`/api/trades/${id}/assets`); if (res.ok) setAssets(await res.json()); };
  const handleMistakesChanged = async () => { const [mR, tR] = await Promise.all([fetch(`/api/trades/${id}/mistakes`), fetch('/api/lookups?type=mistake_type')]); if (mR.ok) setMistakes(await mR.json()); if (tR.ok) setMistakeTypes(await tR.json()); };

  const handleExecutionAdded = async () => {
    const res = await fetch(`/api/trades/${id}/executions`);
    if (res.ok) setExecutions(await res.json());
    setRefetchTrigger((n) => n + 1);
  };

  const handleExecute = useCallback(() => {
    if (!trade) return;
    setExecuteData({
      id: trade.id,
      tradeCode: trade.tradeCode,
      symbol: trade.symbol,
      direction: trade.direction,
      plannedEntry: trade.plannedEntry,
      plannedStop: trade.plannedStop,
      plannedTarget1: trade.plannedTarget1,
      plannedQuantity: trade.plannedQuantity,
      accountId: trade.accountId,
      setupId: trade.setupId,
    });
    setExecuteOpen(true);
  }, [trade]);

  const handleExecuteClose = useCallback((open: boolean) => {
    if (!open) {
      setExecuteOpen(false);
      setExecuteData(null);
    }
    setExecuteOpen(open);
  }, []);

  /** Opens the page-owned AddFillDialog (TradeDetailsCard "Add Fill" button). */
  const openAddFill = useCallback(() => setAddFillOpen(true), []);

  const handleRefreshPrice = useCallback(async () => {
    setMtmData((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const refreshRes = await fetch('/api/trades/mtm/refresh', { method: 'POST' });
      if (!refreshRes.ok) {
        if (refreshRes.status === 429) {
          const body = await refreshRes.json().catch(() => ({}));
          const retryAfter = body.retryAfter ?? 10;
          setMtmData((prev) => ({
            ...prev,
            loading: false,
            error: `Rate limited — try again in ${retryAfter}s`,
          }));
          return;
        }
        setMtmData((prev) => ({ ...prev, loading: false, error: 'Failed to refresh price' }));
        return;
      }
      // After successful batch refresh, refetch MTM data for this trade
      await fetchMtmData(id, setMtmData);
    } catch (err) {
      setMtmData((prev) => ({ ...prev, loading: false, error: String(err) }));
    }
  }, [id]);

  /** Scratch (planned-only soft-delete, R027/D057) — DELETE, then navigate to /trades. */
  const handleConfirmScratch = useCallback(async () => {
    try {
      const res = await fetch(`/api/trades/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        // Error states are logged (app pattern — no toast system); the user
        // stays on the detail page with the trade still planned.
        const errBody = await res.json().catch(() => ({}));
        console.error('Scratch trade failed:', res.status, errBody.error ?? res.statusText);
        return;
      }
      // Success — the trade is now 'deleted'. Navigate back to the trades
      // list: DeletedPhaseView is a terminal informational view with only a
      // "Back to Trades" link, so there is nothing useful to do here.
      router.push('/trades');
    } catch (err) {
      console.error('Scratch trade failed:', err);
    } finally {
      setScratchOpen(false);
    }
  }, [id, router]);

  if (loading) return (
    <div className="mx-auto flex max-w-4xl items-center justify-center px-8 py-20">
      <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading trade details...</p>
    </div>
  );

  if (error || !trade) return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link href="/trades" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to Trades</Link>
      <EmptyState icon={<AlertCircle className="size-12 text-muted-foreground" strokeWidth={1} />} title={error ?? 'Trade not found'} description="The trade you are looking for does not exist or could not be loaded." action={<Link href="/trades" className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"><ArrowLeft className="size-4" />Back to Trades</Link>} />
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/trades" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Back to Trades
        </Link>
      </div>

      {trade.status === 'planned' && <PlannedPhaseView trade={trade} assets={assets} onAssetsChanged={handleAssetsChanged} onExecute={handleExecute} onEdit={() => setEditOpen(true)} onScratch={() => setScratchOpen(true)} />}
      {trade.status === 'open' && <ActivePhaseView trade={trade} executions={executions} levelHistoryEvents={levelHistory} riskSnapshot={riskSnapshot} stopAdjustments={stopAdjustments} targetAdjustments={targetAdjustments} assets={assets} derivedStatus={derivedStatus} pnlResult={pnlResult} rMultiple={rMultiple} perfMetrics={perfMetrics} checkResults={checkResults} onAdjustmentsChanged={handleAdjustmentAdded} onAssetsChanged={handleAssetsChanged} onExecutionAdded={handleExecutionAdded} mtmData={mtmData} onRefreshPrice={handleRefreshPrice} unrealizedPnl={unrealizedPnl} unrealizedReturnPct={unrealizedReturnPct} unrealizedRMultiple={unrealizedRMultiple} onEdit={() => setEditOpen(true)} onAddFill={openAddFill} />}
      {trade.status === 'closed' && <ClosedPhaseView trade={trade} executions={executions} levelHistoryEvents={levelHistory} riskSnapshot={riskSnapshot} grade={grade} mistakes={mistakes} mistakeTypes={mistakeTypes} assets={assets} derivedStatus={derivedStatus} pnlResult={pnlResult} rMultiple={rMultiple} perfMetrics={perfMetrics} stopAdjustments={stopAdjustments} targetAdjustments={targetAdjustments} checkResults={checkResults} onAdjustmentsChanged={handleAdjustmentAdded} onAssetsChanged={handleAssetsChanged} onMistakesChanged={handleMistakesChanged} onGradeSave={handleGradeSave} onExecutionAdded={handleExecutionAdded} mtmData={mtmData} onRefreshPrice={handleRefreshPrice} onEdit={() => setEditOpen(true)} onAddFill={openAddFill} />}
      {trade.status === 'deleted' && <DeletedPhaseView trade={trade} />}

      {executeData && (
        <ExecuteDialog
          trade={executeData}
          open={executeOpen}
          onOpenChange={handleExecuteClose}
          onComplete={handleExecutionAdded}
        />
      )}

      {/* M019/S04/T02: Add Fill (new entry/exit execution) — page owns the open
          state; onComplete routes to handleExecutionAdded so executions and the
          unified history feed refetch after a successful fill (must-have #6). */}
      <AddFillDialog
        trade={{
          id: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          plannedQuantity: trade.plannedQuantity,
        }}
        open={addFillOpen}
        onOpenChange={setAddFillOpen}
        onComplete={handleExecutionAdded}
      />

      <EditTradeDialog
        key={trade.id}
        open={editOpen}
        onOpenChange={setEditOpen}
        trade={{
          id: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          status: trade.status,
          accountId: trade.accountId,
          setupId: trade.setupId,
          thesis: trade.thesis,
          plannedEntry: trade.plannedEntry,
          plannedStop: trade.plannedStop,
          plannedTarget1: trade.plannedTarget1,
          plannedTarget2: trade.plannedTarget2,
          plannedQuantity: trade.plannedQuantity,
          invalidationCondition: trade.invalidationCondition,
          preTradePlan: trade.preTradePlan,
        }}
        onSaved={() => {
          setRefetchTrigger((n) => n + 1);
          // Refresh profile data for the (possibly changed) ticker
          fetch(`/api/trades/${id}/mtm`, { method: 'POST' })
            .then(() => fetchMtmData(id, setMtmData))
            .catch(() => {});
        }}
        setupName={trade.setupName ?? null}
      />

      {/* Scratch confirmation (M015/S02/T02) — destructive, closes before DELETE */}
      <ConfirmDialog
        open={scratchOpen}
        onOpenChange={setScratchOpen}
        onConfirm={handleConfirmScratch}
        title={trade ? `Scratch ${trade.symbol}?` : 'Scratch this trade?'}
        description={
          trade
            ? `${trade.tradeCode} will be removed from your Planned tab and marked as scratched.`
            : 'The planned trade will be removed from your Planned tab and marked as scratched.'
        }
        confirmLabel="Scratch"
        destructive
      />

      <p className="mt-8 text-xs text-muted-foreground">Created {formatDate(trade.createdAt, timezone)}{trade.updatedAt && ` · Updated ${formatDate(trade.updatedAt, timezone)}`}</p>
    </div>
  );
}
