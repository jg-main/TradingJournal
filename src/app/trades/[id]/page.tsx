'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';

import {
  calculatePnL,
  calculateRMultiple,
  deriveTradeStatus,
  type ExecutionData,
} from '@/lib/trade-calc';
import type { GradeFormPayload } from '@/components/trade-detail/trade-grade-card';

import PlannedPhaseView from '@/components/trade-detail/planned-phase-view';
import ActivePhaseView from '@/components/trade-detail/active-phase-view';
import ClosedPhaseView from '@/components/trade-detail/closed-phase-view';
import DeletedPhaseView from '@/components/trade-detail/deleted-phase-view';

// ── Types ──────────────────────────────────────────────────────────────

interface Trade {
  id: string;
  tradeCode: string;
  symbol: string;
  direction: 'long' | 'short';
  setupId: string | null;
  marketConditionId: string | null;
  status: 'planned' | 'open' | 'closed' | 'deleted';
  plannedEntry: number | null;
  plannedStop: number | null;
  plannedTarget1: number | null;
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
  const [assets, setAssets] = useState<TradeAsset[]>([]);
  const [grade, setGrade] = useState<TradeGrade | null>(null);
  const [mistakes, setMistakes] = useState<TradeMistake[]>([]);
  const [mistakeTypes, setMistakeTypes] = useState<LookupValue[]>([]);

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
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, [id]);

  const execData = trade ? toExecutionData(executions) : [];
  const pnlResult = trade && executions.length > 0 ? calculatePnL(execData, trade.direction) : null;
  const rMultiple = pnlResult && riskSnapshot?.initialRiskAmount
    ? calculateRMultiple(pnlResult.totalRealizedPnL, riskSnapshot.initialRiskAmount)
    : null;
  const derivedStatus = trade && executions.length > 0
    ? deriveTradeStatus(execData, trade.direction)
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

  if (loading) return (
    <div className="mx-auto flex max-w-4xl items-center justify-center px-8 py-20">
      <Loader2 className="mr-2 size-5 animate-spin text-zinc-400" />
      <p className="text-sm text-zinc-500">Loading trade details...</p>
    </div>
  );

  if (error || !trade) return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link href="/trades" className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"><ArrowLeft className="size-4" />Back to Trade Log</Link>
      <EmptyState icon={<AlertCircle className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />} title={error ?? 'Trade not found'} description="The trade you are looking for does not exist or could not be loaded." action={<Link href="/trades" className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"><ArrowLeft className="size-4" />Back to Trade Log</Link>} />
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link href="/trades" className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"><ArrowLeft className="size-4" />Back to Trade Log</Link>

      {trade.status === 'planned' && <PlannedPhaseView trade={trade} assets={assets} onAssetsChanged={handleAssetsChanged} />}
      {trade.status === 'open' && <ActivePhaseView trade={trade} executions={executions} riskSnapshot={riskSnapshot} stopAdjustments={stopAdjustments} assets={assets} derivedStatus={derivedStatus} pnlResult={pnlResult} rMultiple={rMultiple} onAdjustmentAdded={handleAdjustmentAdded} onAssetsChanged={handleAssetsChanged} onRiskSnapshotSave={handleRiskSnapshotSave} />}
      {trade.status === 'closed' && <ClosedPhaseView trade={trade} executions={executions} grade={grade} mistakes={mistakes} mistakeTypes={mistakeTypes} assets={assets} derivedStatus={derivedStatus} pnlResult={pnlResult} rMultiple={rMultiple} stopAdjustments={stopAdjustments} onAdjustmentAdded={handleAdjustmentAdded} onAssetsChanged={handleAssetsChanged} onMistakesChanged={handleMistakesChanged} onGradeSave={handleGradeSave} />}
      {trade.status === 'deleted' && <DeletedPhaseView trade={trade} />}

      <p className="mt-8 text-xs text-zinc-400 dark:text-zinc-600">Created {formatDate(trade.createdAt)}{trade.updatedAt && ` · Updated ${formatDate(trade.updatedAt)}`}</p>
    </div>
  );
}
