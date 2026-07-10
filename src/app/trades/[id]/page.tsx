'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import type { CheckResult, MtmData } from '@/components/trade-detail/types';
import { EmptyState } from '@/components/empty-state';

import {
  calculatePnL,
  calculateRMultiple,
  deriveTradeStatus,
  type ExecutionData,
} from '@/lib/trade-calc';
import { computePerfMetrics, type PerfMetrics } from '@/lib/perf-metrics';
import type { GradeFormPayload } from '@/components/trade-detail/trade-grade-card';

import PlannedPhaseView from '@/components/trade-detail/planned-phase-view';
import ActivePhaseView from '@/components/trade-detail/active-phase-view';
import ClosedPhaseView from '@/components/trade-detail/closed-phase-view';
import DeletedPhaseView from '@/components/trade-detail/deleted-phase-view';
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

function formatDate(d: string | null): string {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString(undefined, {
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

function toExecutionData(executions: Execution[]): ExecutionData[] {
  return executions.map((e) => ({
    action: e.action,
    quantity: e.quantity,
    price: e.price,
    fees: e.fees ?? 0,
    executedAt: e.executedAt ?? e.createdAt ?? '',
  }));
}

/**
 * Fetch MTM (mark-to-market) data for a single trade from the API.
 * Used on mount and after manual price refresh.
 */
async function fetchMtmData(tradeId: string, setter: (data: MtmData) => void): Promise<void> {
  setter({ price: null, marketState: null, fetchedAt: null, source: null, loading: true, error: null });
  try {
    const res = await fetch(`/api/trades/${tradeId}/mtm`);
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      setter({
        price: null,
        marketState: null,
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
      fetchedAt: data.fetchedAt ?? null,
      source: data.source ?? null,
      loading: false,
      error: null,
    });
  } catch (err) {
    setter({
      price: null,
      marketState: null,
      fetchedAt: null,
      source: null,
      loading: false,
      error: String(err),
    });
  }
}

// ── Page ───────────────────────────────────────────────────────────────

export default function TradeDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [trade, setTrade] = useState<Trade | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [riskSnapshot, setRiskSnapshot] = useState<RiskSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stopAdjustments, setStopAdjustments] = useState<StopAdjustment[]>([]);
  const [mtmData, setMtmData] = useState<MtmData>({
    price: null,
    marketState: null,
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

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const [tradeRes, executionsRes, riskRes, adjustmentsRes] = await Promise.all([
          fetch(`/api/trades/${id}`), fetch(`/api/trades/${id}/executions`),
          fetch(`/api/trades/${id}/risk-snapshot`), fetch(`/api/trades/${id}/stop-adjustments`),
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

  const execData = trade ? toExecutionData(executions) : [];
  const pnlResult = trade && executions.length > 0 ? calculatePnL(execData, trade.direction) : null;
  const rMultiple = pnlResult && riskSnapshot?.initialRiskAmount
    ? calculateRMultiple(pnlResult.totalRealizedPnL, riskSnapshot.initialRiskAmount)
    : null;
  const derivedStatus = trade && executions.length > 0
    ? deriveTradeStatus(execData, trade.direction)
    : null;

  const perfMetrics: PerfMetrics | null = trade && executions.length > 0 && pnlResult
    ? computePerfMetrics(
        execData,
        trade.openedAt ?? null,
        trade.status === 'open' ? new Date().toISOString() : (trade.closedAt ?? null),
        pnlResult.totalRealizedPnL,
        pnlResult.avgEntryPrice,
        pnlResult.totalEntryQty,
      )
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

  const handleAdjustmentAdded = async () => { const res = await fetch(`/api/trades/${id}/stop-adjustments`); if (res.ok) setStopAdjustments(await res.json()); };
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

  if (loading) return (
    <div className="mx-auto flex max-w-4xl items-center justify-center px-8 py-20">
      <Loader2 className="mr-2 size-5 animate-spin text-zinc-400" />
      <p className="text-sm text-zinc-500">Loading trade details...</p>
    </div>
  );

  if (error || !trade) return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link href="/trades" className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"><ArrowLeft className="size-4" />Back to Trade Log</Link>
      <EmptyState icon={<AlertCircle className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />} title={error ?? 'Trade not found'} description="The trade you are looking for does not exist or could not be loaded." action={<Link href="/trades" className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"><ArrowLeft className="size-4" />Back to Trade Log</Link>} />
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/trades" className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
          <ArrowLeft className="size-4" />
          Back to Trade Log
        </Link>
        {trade.status !== 'deleted' && (
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
            </svg>
            Edit
          </button>
        )}
      </div>

      {trade.status === 'planned' && <PlannedPhaseView trade={trade} assets={assets} onAssetsChanged={handleAssetsChanged} onExecute={handleExecute} />}
      {trade.status === 'open' && <ActivePhaseView trade={trade} executions={executions} riskSnapshot={riskSnapshot} stopAdjustments={stopAdjustments} assets={assets} derivedStatus={derivedStatus} pnlResult={pnlResult} rMultiple={rMultiple} perfMetrics={perfMetrics} checkResults={checkResults} onAdjustmentAdded={handleAdjustmentAdded} onAssetsChanged={handleAssetsChanged} onExecutionAdded={handleExecutionAdded} mtmData={mtmData} onRefreshPrice={handleRefreshPrice} />}
      {trade.status === 'closed' && <ClosedPhaseView trade={trade} executions={executions} riskSnapshot={riskSnapshot} grade={grade} mistakes={mistakes} mistakeTypes={mistakeTypes} assets={assets} derivedStatus={derivedStatus} pnlResult={pnlResult} rMultiple={rMultiple} perfMetrics={perfMetrics} stopAdjustments={stopAdjustments} checkResults={checkResults} onAdjustmentAdded={handleAdjustmentAdded} onAssetsChanged={handleAssetsChanged} onMistakesChanged={handleMistakesChanged} onGradeSave={handleGradeSave} onExecutionAdded={handleExecutionAdded} mtmData={mtmData} onRefreshPrice={handleRefreshPrice} />}
      {trade.status === 'deleted' && <DeletedPhaseView trade={trade} />}

      {executeData && (
        <ExecuteDialog
          trade={executeData}
          open={executeOpen}
          onOpenChange={handleExecuteClose}
          onComplete={handleExecutionAdded}
        />
      )}

      <EditTradeDialog
        key={trade.id}
        open={editOpen}
        onOpenChange={setEditOpen}
        trade={{
          id: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
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
        onSaved={() => setRefetchTrigger((n) => n + 1)}
        setupName={trade.setupName ?? null}
      />

      <p className="mt-8 text-xs text-zinc-400 dark:text-zinc-600">Created {formatDate(trade.createdAt)}{trade.updatedAt && ` · Updated ${formatDate(trade.updatedAt)}`}</p>
    </div>
  );
}
