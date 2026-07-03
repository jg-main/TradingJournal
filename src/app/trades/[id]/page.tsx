'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, Loader2, TrendingUp, TrendingDown, Target, DollarSign, Activity, Pencil, Star, ImageIcon, LinkIcon, Trash2, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/empty-state';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import {
  calculatePnL,
  calculateRMultiple,
  deriveTradeStatus,
  type ExecutionData,
} from '@/lib/trade-calc';
import { calculateGrade, type GradeScores } from '@/lib/grading';

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
  plannedTarget2: number | null;
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

function statusBadgeVariant(status: Trade['status']): {
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className: string;
} {
  switch (status) {
    case 'planned':
      return { variant: 'secondary', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    case 'open':
      return { variant: 'default', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
    case 'closed':
      return { variant: 'outline', className: 'text-zinc-500 dark:text-zinc-400' };
    case 'deleted':
      return { variant: 'outline', className: 'text-zinc-500 dark:text-zinc-400 line-through' };
  }
}

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  const abs = Math.abs(v);
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v >= 0 ? `$${formatted}` : `-$${formatted}`;
}

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

function formatAction(action: string): string {
  const labels: Record<string, string> = {
    buy: 'Buy',
    sell: 'Sell',
    buy_to_cover: 'Buy to Cover',
    sell_short: 'Sell Short',
    add: 'Add',
    reduce: 'Reduce',
  };
  return labels[action] ?? action;
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

function statusLabel(status: Trade['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ── Page ───────────────────────────────────────────────────────────────

export default function TradeDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [trade, setTrade] = useState<Trade | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [riskSnapshot, setRiskSnapshot] = useState<RiskSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stopAdjustments, setStopAdjustments] = useState<StopAdjustment[]>([]);
  const [adjustmentMessage, setAdjustmentMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [riskSnapshotEditMode, setRiskSnapshotEditMode] = useState(false);
  const [riskSnapshotForm, setRiskSnapshotForm] = useState({
    accountEquityAtOpen: '',
    initialEntryPrice: '',
    initialStopPrice: '',
    initialQuantity: '',
    riskPerShare: '',
    initialRiskAmount: '',
    accountRiskPct: '',
    plannedRewardRisk: '',
  });
  const [adjustmentForm, setAdjustmentForm] = useState({
    previousStop: '',
    newStop: '',
    reason: '',
    ruleBased: false,
  });

  // ── Asset State ────────────────────────────────────────────────

  const [assets, setAssets] = useState<TradeAsset[]>([]);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [assetFormMode, setAssetFormMode] = useState<'upload' | 'link'>('upload');
  const [assetMessage, setAssetMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [assetPhase, setAssetPhase] = useState<string>('pre_trade');
  const [assetLabel, setAssetLabel] = useState('');
  const [assetUrl, setAssetUrl] = useState('');
  const [linkPhase, setLinkPhase] = useState<string>('pre_trade');
  const [linkLabel, setLinkLabel] = useState('');

  // ── Grade State ────────────────────────────────────────────────

  const [grade, setGrade] = useState<TradeGrade | null>(null);
  const [gradeEditMode, setGradeEditMode] = useState(false);
  const [gradeForm, setGradeForm] = useState({
    setupScore: 5,
    riskScore: 5,
    entryScore: 5,
    managementScore: 5,
    exitScore: 5,
    reviewScore: 5,
    followedPlan: false,
    ruleViolation: false,
  });

  // ── Mistakes State ─────────────────────────────────────────────

  const [mistakes, setMistakes] = useState<TradeMistake[]>([]);
  const [mistakeTypes, setMistakeTypes] = useState<LookupValue[]>([]);
  const [showMistakeForm, setShowMistakeForm] = useState(false);
  const [mistakeMessage, setMistakeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [mistakeForm, setMistakeForm] = useState({
    mistakeType: '',
    phase: 'entry' as string,
    severity: 'minor' as string,
    rootCause: '',
    correctiveAction: '',
    status: 'open' as string,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const [tradeRes, executionsRes, riskRes, adjustmentsRes] = await Promise.all([
          fetch(`/api/trades/${id}`),
          fetch(`/api/trades/${id}/executions`),
          fetch(`/api/trades/${id}/risk-snapshot`),
          fetch(`/api/trades/${id}/stop-adjustments`),
        ]);

        if (cancelled) return;

        // Handle trade not found
        if (!tradeRes.ok) {
          if (tradeRes.status === 404) {
            setError('Trade not found.');
          } else {
            const err = await tradeRes.json().catch(() => ({}));
            setError(err.error ?? 'Failed to load trade.');
          }
          return;
        }

        const tradeData: Trade = await tradeRes.json();
        setTrade(tradeData);

        // Executions — 404 means none exist, which is valid
        if (executionsRes.ok) {
          const execData: Execution[] = await executionsRes.json();
          setExecutions(execData);
        }

        // Risk snapshot — 404 means none exists (trade not yet executed), which is valid
        if (riskRes.ok) {
          const riskData: RiskSnapshot = await riskRes.json();
          setRiskSnapshot(riskData);
        }

        // Stop adjustments — 404 means none exist, which is valid
        if (adjustmentsRes.ok) {
          const adjData: StopAdjustment[] = await adjustmentsRes.json();
          setStopAdjustments(adjData);
        }

        // Assets — 404 means none exist, which is valid
        const assetsRes = await fetch(`/api/trades/${id}/assets`);
        if (!cancelled && assetsRes.ok) {
          const assetData: TradeAsset[] = await assetsRes.json();
          setAssets(assetData);
        }

        // Grade — only fetch for closed trades; 404 means not yet graded
        if (tradeData.status === 'closed') {
          const gradeRes = await fetch(`/api/trades/${id}/grade`);
          if (!cancelled && gradeRes.ok) {
            const gradeData: TradeGrade = await gradeRes.json();
            setGrade(gradeData);
          }
        }

        // Mistakes — 404 means none exist, which is valid
        const mistakesRes = await fetch(`/api/trades/${id}/mistakes`);
        if (!cancelled && mistakesRes.ok) {
          const mistakeData: TradeMistake[] = await mistakesRes.json();
          setMistakes(mistakeData);
        }

        // Mistake type lookup values for dropdown
        if (!cancelled) {
          const lookupRes = await fetch('/api/lookups?type=mistake_type');
          if (lookupRes.ok) {
            const lookupData: LookupValue[] = await lookupRes.json();
            setMistakeTypes(lookupData);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, [id]);

  // ── Stop Adjustment Form Handler ──────────────────────────────────

  const handleAddAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdjustmentMessage(null);

    if (!adjustmentForm.previousStop || !adjustmentForm.newStop) {
      setAdjustmentMessage({ type: 'error', text: 'Previous Stop and New Stop are required.' });
      return;
    }

    try {
      const res = await fetch(`/api/trades/${id}/stop-adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previousStop: parseFloat(adjustmentForm.previousStop),
          newStop: parseFloat(adjustmentForm.newStop),
          reason: adjustmentForm.reason.trim() || null,
          ruleBased: adjustmentForm.ruleBased,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setAdjustmentMessage({
          type: 'error',
          text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Failed to save.'),
        });
        return;
      }

      setAdjustmentMessage({ type: 'success', text: 'Stop adjustment added.' });
      setAdjustmentForm({ previousStop: '', newStop: '', reason: '', ruleBased: false });
      setShowAdjustmentForm(false);

      // Refetch adjustments
      const adjustmentsRes = await fetch(`/api/trades/${id}/stop-adjustments`);
      if (adjustmentsRes.ok) {
        const adjData: StopAdjustment[] = await adjustmentsRes.json();
        setStopAdjustments(adjData);
      }
    } catch {
      setAdjustmentMessage({ type: 'error', text: 'Failed to save stop adjustment.' });
    }
  };

  // ── Asset Handlers ────────────────────────────────────────────────

  const handleAssetUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setAssetMessage(null);

    if (!assetFile) {
      setAssetMessage({ type: 'error', text: 'Please select a file to upload.' });
      return;
    }

    const formData = new FormData();
    formData.append('file', assetFile);
    formData.append('phase', assetPhase);
    if (assetLabel.trim()) formData.append('label', assetLabel.trim());

    try {
      const res = await fetch(`/api/trades/${id}/assets`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        setAssetMessage({
          type: 'error',
          text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Upload failed.'),
        });
        return;
      }

      setAssetMessage({ type: 'success', text: 'Screenshot uploaded.' });
      setAssetFile(null);
      setAssetLabel('');

      // Refetch assets
      const assetsRes = await fetch(`/api/trades/${id}/assets`);
      if (assetsRes.ok) setAssets(await assetsRes.json());
    } catch {
      setAssetMessage({ type: 'error', text: 'Upload failed.' });
    }
  };

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setAssetMessage(null);

    if (!assetUrl.trim()) {
      setAssetMessage({ type: 'error', text: 'URL is required.' });
      return;
    }

    try {
      const res = await fetch(`/api/trades/${id}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetType: 'link',
          phase: linkPhase,
          externalUrl: assetUrl.trim(),
          label: linkLabel.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setAssetMessage({
          type: 'error',
          text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Failed to add link.'),
        });
        return;
      }

      setAssetMessage({ type: 'success', text: 'Link added.' });
      setAssetUrl('');
      setLinkLabel('');

      // Refetch assets
      const assetsRes = await fetch(`/api/trades/${id}/assets`);
      if (assetsRes.ok) setAssets(await assetsRes.json());
    } catch {
      setAssetMessage({ type: 'error', text: 'Failed to add link.' });
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    try {
      const res = await fetch(`/api/trades/${id}/assets?id=${assetId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('Failed to delete asset', err);
        return;
      }

      setAssets((prev) => prev.filter((a) => a.id !== assetId));
    } catch (err) {
      console.error('Failed to delete asset', err);
    }
  };

  // ── Risk Snapshot Edit Handlers ────────────────────────────────────

  const enterEditMode = () => {
    setRiskSnapshotForm({
      accountEquityAtOpen: riskSnapshot?.accountEquityAtOpen?.toString() ?? '',
      initialEntryPrice: riskSnapshot?.initialEntryPrice?.toString() ?? '',
      initialStopPrice: riskSnapshot?.initialStopPrice?.toString() ?? '',
      initialQuantity: riskSnapshot?.initialQuantity?.toString() ?? '',
      riskPerShare: riskSnapshot?.riskPerShare?.toString() ?? '',
      initialRiskAmount: riskSnapshot?.initialRiskAmount?.toString() ?? '',
      accountRiskPct: riskSnapshot?.accountRiskPct?.toString() ?? '',
      plannedRewardRisk: riskSnapshot?.plannedRewardRisk?.toString() ?? '',
    });
    setRiskSnapshotEditMode(true);
  };

  const handleRiskSnapshotSave = async () => {
    const payload: Record<string, number | null> = {};
    const fields: (keyof typeof riskSnapshotForm)[] = [
      'accountEquityAtOpen',
      'initialEntryPrice',
      'initialStopPrice',
      'initialQuantity',
      'riskPerShare',
      'initialRiskAmount',
      'accountRiskPct',
      'plannedRewardRisk',
    ];

    for (const field of fields) {
      const val = riskSnapshotForm[field];
      payload[field] = val === '' ? null : parseFloat(val);
    }

    try {
      const res = await fetch(`/api/trades/${id}/risk-snapshot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error('Failed to save risk snapshot', await res.text());
        return;
      }

      const updated: RiskSnapshot = await res.json();
      setRiskSnapshot(updated);
      setRiskSnapshotEditMode(false);
    } catch (err) {
      console.error('Failed to save risk snapshot', err);
    }
  };

  const cancelEditMode = () => {
    setRiskSnapshotEditMode(false);
  };

  // ── Grade Edit Handlers ──────────────────────────────────────────

  const enterGradeEditMode = () => {
    setGradeForm({
      setupScore: grade?.setupQualityScore ?? 5,
      riskScore: grade?.riskQualityScore ?? 5,
      entryScore: grade?.entryQualityScore ?? 5,
      managementScore: grade?.managementQualityScore ?? 5,
      exitScore: grade?.exitQualityScore ?? 5,
      reviewScore: grade?.reviewQualityScore ?? 5,
      followedPlan: grade?.followedPlan ?? false,
      ruleViolation: grade?.ruleViolation ?? false,
    });
    setGradeEditMode(true);
  };

  const handleGradeSave = async () => {
    try {
      const res = await fetch(`/api/trades/${id}/grade`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupScore: gradeForm.setupScore,
          riskScore: gradeForm.riskScore,
          entryScore: gradeForm.entryScore,
          managementScore: gradeForm.managementScore,
          exitScore: gradeForm.exitScore,
          reviewScore: gradeForm.reviewScore,
          followedPlan: gradeForm.followedPlan,
          ruleViolation: gradeForm.ruleViolation,
        }),
      });

      if (!res.ok) {
        console.error('Failed to save grade', await res.text());
        return;
      }

      const updated: TradeGrade = await res.json();
      setGrade(updated);
      setGradeEditMode(false);
    } catch (err) {
      console.error('Failed to save grade', err);
    }
  };

  const cancelGradeEdit = () => {
    setGradeEditMode(false);
  };

  // ── Mistake Form Handlers ─────────────────────────────────────────

  const handleAddMistake = async (e: React.FormEvent) => {
    e.preventDefault();
    setMistakeMessage(null);

    if (!mistakeForm.mistakeType) {
      setMistakeMessage({ type: 'error', text: 'Mistake type is required.' });
      return;
    }

    if (!mistakeForm.rootCause.trim()) {
      setMistakeMessage({ type: 'error', text: 'Root cause is required.' });
      return;
    }

    if (!mistakeForm.correctiveAction.trim()) {
      setMistakeMessage({ type: 'error', text: 'Corrective action is required.' });
      return;
    }

    try {
      const res = await fetch(`/api/trades/${id}/mistakes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mistakeType: mistakeForm.mistakeType,
          phase: mistakeForm.phase,
          severity: mistakeForm.severity,
          rootCause: mistakeForm.rootCause.trim(),
          correctiveAction: mistakeForm.correctiveAction.trim(),
          status: mistakeForm.status,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMistakeMessage({
          type: 'error',
          text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Failed to save mistake.'),
        });
        return;
      }

      setMistakeMessage({ type: 'success', text: 'Mistake recorded.' });
      setMistakeForm({ mistakeType: '', phase: 'entry', severity: 'minor', rootCause: '', correctiveAction: '', status: 'open' });
      setShowMistakeForm(false);

      // Refetch mistakes
      const mistakesRes = await fetch(`/api/trades/${id}/mistakes`);
      if (mistakesRes.ok) {
        const mistakeData: TradeMistake[] = await mistakesRes.json();
        setMistakes(mistakeData);
      }
    } catch {
      setMistakeMessage({ type: 'error', text: 'Failed to save mistake.' });
    }
  };

  const handleDeleteMistake = async (mistakeId: string) => {
    try {
      const res = await fetch(`/api/trades/${id}/mistakes?id=${mistakeId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('Failed to delete mistake', err);
        return;
      }

      setMistakes((prev) => prev.filter((m) => m.id !== mistakeId));
    } catch (err) {
      console.error('Failed to delete mistake', err);
    }
  };

  // ── Derived P&L-R ──────────────────────────────────────────────────

  let pnlResult: ReturnType<typeof calculatePnL> | null = null;
  let rMultiple: ReturnType<typeof calculateRMultiple> | null = null;

  if (trade && executions.length > 0) {
    const execData = toExecutionData(executions);
    pnlResult = calculatePnL(execData, trade.direction);

    const riskAmount = riskSnapshot?.initialRiskAmount ?? null;
    rMultiple = calculateRMultiple(pnlResult.totalRealizedPnL, riskAmount);
  }

  // ── Derived lifecycle status ───────────────────────────────────────

  let derivedStatus: ReturnType<typeof deriveTradeStatus> | null = null;
  if (trade && executions.length > 0) {
    const execData = toExecutionData(executions);
    derivedStatus = deriveTradeStatus(execData, trade.direction);
  }

  // ── Render: Loading ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center px-8 py-20">
        <Loader2 className="mr-2 size-5 animate-spin text-zinc-400" />
        <p className="text-sm text-zinc-500">Loading trade details...</p>
      </div>
    );
  }

  // ── Render: Error ──────────────────────────────────────────────────

  if (error || !trade) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <Link
          href="/trades"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          Back to Trade Log
        </Link>
        <EmptyState
          icon={<AlertCircle className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
          title={error ?? 'Trade not found'}
          description="The trade you are looking for does not exist or could not be loaded."
          action={
            <Link
              href="/trades"
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Back to Trade Log
            </Link>
          }
        />
      </div>
    );
  }

  // ── Render: Trade Detail ───────────────────────────────────────────

  const badgeInfo = statusBadgeVariant(trade.status);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      {/* Back link */}
      <Link
        href="/trades"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="size-4" />
        Back to Trade Log
      </Link>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {trade.symbol}
            </h1>
            <Badge variant={badgeInfo.variant} className={badgeInfo.className}>
              {statusLabel(trade.status)}
            </Badge>
            {trade.direction === 'long' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <TrendingUp className="size-3" />
                Long
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                <TrendingDown className="size-3" />
                Short
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
            {trade.tradeCode}
          </p>
        </div>
      </div>

      {/* Lifecycle Stepper */}
      <div className="mb-8">
        <LifecycleStepper
          status={trade.status}
          direction={trade.direction}
          openedAt={trade.openedAt}
          exitNotes={trade.exitNotes}
          lesson={trade.lesson}
        />
      </div>

      {/* Grid: Trade Metadata + Risk Snapshot */}
      <div className="mb-8 grid gap-6 md:grid-cols-2">
        {/* Trade Metadata Card */}
        <Card>
          <CardHeader>
            <CardTitle>Trade Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="text-zinc-500 dark:text-zinc-400">Planned Entry</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatPrice(trade.plannedEntry)}
              </div>

              <div className="text-zinc-500 dark:text-zinc-400">Planned Stop</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatPrice(trade.plannedStop)}
              </div>

              <div className="text-zinc-500 dark:text-zinc-400">Target 1</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatPrice(trade.plannedTarget1)}
              </div>

              <div className="text-zinc-500 dark:text-zinc-400">Target 2</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {formatPrice(trade.plannedTarget2)}
              </div>
            </div>

            {trade.thesis && (
              <div>
                <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Thesis</div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.thesis}</p>
              </div>
            )}

            {trade.invalidationCondition && (
              <div>
                <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Invalidation</div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.invalidationCondition}</p>
              </div>
            )}

            {trade.preTradePlan && (
              <div>
                <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Pre-Trade Plan</div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.preTradePlan}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Risk Snapshot Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Target className="size-4 text-zinc-500" />
                Risk Snapshot
              </CardTitle>
              {riskSnapshot && !riskSnapshotEditMode && (
                <button
                  onClick={enterEditMode}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  <Pencil className="size-3" />
                  Edit
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {riskSnapshotEditMode && riskSnapshot ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Equity at Open
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={riskSnapshotForm.accountEquityAtOpen}
                      onChange={(e) => setRiskSnapshotForm((f) => ({ ...f, accountEquityAtOpen: e.target.value }))}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Initial Entry
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={riskSnapshotForm.initialEntryPrice}
                      onChange={(e) => setRiskSnapshotForm((f) => ({ ...f, initialEntryPrice: e.target.value }))}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Initial Stop
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={riskSnapshotForm.initialStopPrice}
                      onChange={(e) => setRiskSnapshotForm((f) => ({ ...f, initialStopPrice: e.target.value }))}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Initial Qty
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={riskSnapshotForm.initialQuantity}
                      onChange={(e) => setRiskSnapshotForm((f) => ({ ...f, initialQuantity: e.target.value }))}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Risk/Share
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={riskSnapshotForm.riskPerShare}
                      onChange={(e) => setRiskSnapshotForm((f) => ({ ...f, riskPerShare: e.target.value }))}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Risk Amount
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={riskSnapshotForm.initialRiskAmount}
                      onChange={(e) => setRiskSnapshotForm((f) => ({ ...f, initialRiskAmount: e.target.value }))}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Account Risk %
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={riskSnapshotForm.accountRiskPct}
                      onChange={(e) => setRiskSnapshotForm((f) => ({ ...f, accountRiskPct: e.target.value }))}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Planned R:R
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={riskSnapshotForm.plannedRewardRisk}
                      onChange={(e) => setRiskSnapshotForm((f) => ({ ...f, plannedRewardRisk: e.target.value }))}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleRiskSnapshotSave}
                    className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Save
                  </button>
                  <button
                    onClick={cancelEditMode}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : riskSnapshot ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="text-zinc-500 dark:text-zinc-400">Initial Entry</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(riskSnapshot.initialEntryPrice)}
                </div>

                <div className="text-zinc-500 dark:text-zinc-400">Initial Stop</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(riskSnapshot.initialStopPrice)}
                </div>

                <div className="text-zinc-500 dark:text-zinc-400">Initial Qty</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {riskSnapshot.initialQuantity?.toLocaleString() ?? '-'}
                </div>

                <div className="text-zinc-500 dark:text-zinc-400">Risk/Share</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(riskSnapshot.riskPerShare)}
                </div>

                <div className="text-zinc-500 dark:text-zinc-400">Risk Amount</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(riskSnapshot.initialRiskAmount)}
                </div>

                <div className="text-zinc-500 dark:text-zinc-400">Account Risk</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {riskSnapshot.accountRiskPct != null
                    ? `${riskSnapshot.accountRiskPct.toFixed(2)}%`
                    : '-'}
                </div>

                {riskSnapshot.plannedRewardRisk != null && (
                  <>
                    <div className="text-zinc-500 dark:text-zinc-400">Planned R:R</div>
                    <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                      {riskSnapshot.plannedRewardRisk.toFixed(2)}
                    </div>
                  </>
                )}

                {riskSnapshot.accountEquityAtOpen != null && (
                  <>
                    <div className="text-zinc-500 dark:text-zinc-400">Equity at Open</div>
                    <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                      {formatCurrency(riskSnapshot.accountEquityAtOpen)}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">
                No risk snapshot recorded. Executions have not been added yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lifecycle Timeline Card */}
      {derivedStatus && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-zinc-500" />
              Lifecycle Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Status</div>
                <div className="font-medium text-zinc-900 dark:text-zinc-100">
                  {statusLabel(trade.status)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Opened At</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatDate(trade.openedAt ?? derivedStatus.openedAt)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Closed At</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatDate(trade.closedAt ?? derivedStatus.closedAt)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Open Qty</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {derivedStatus.openQuantity.toLocaleString()}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* P&L-R Metrics Card */}
      {pnlResult && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="size-4 text-zinc-500" />
              P&amp;L-R Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Realized P&amp;L</div>
                <div
                  className={`tabular-nums font-medium ${
                    pnlResult.totalRealizedPnL >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatCurrency(pnlResult.totalRealizedPnL)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">R Multiple</div>
                <div
                  className={`tabular-nums font-medium ${
                    rMultiple?.rMultiple != null
                      ? rMultiple.rMultiple >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                      : ''
                  }`}
                >
                  {rMultiple?.rMultiple != null ? rMultiple.rMultiple.toFixed(2) : '-'}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Avg Entry Price</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatPrice(pnlResult.avgEntryPrice)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 dark:text-zinc-400">Total Qty</div>
                <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {pnlResult.totalEntryQty.toLocaleString()} / {pnlResult.totalExitQty.toLocaleString()}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grade Card */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Star className="size-4 text-zinc-500" />
              Trade Grade
            </CardTitle>
            {trade.status === 'closed' && !gradeEditMode && (
              <button
                onClick={enterGradeEditMode}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <Pencil className="size-3" />
                {grade ? 'Edit' : 'Add Grade'}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {trade.status !== 'closed' ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              Grading is only available for closed trades.
            </p>
          ) : gradeEditMode ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Setup Score
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={gradeForm.setupScore}
                    onChange={(e) =>
                      setGradeForm((f) => ({ ...f, setupScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Risk Score
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={gradeForm.riskScore}
                    onChange={(e) =>
                      setGradeForm((f) => ({ ...f, riskScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Entry Score
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={gradeForm.entryScore}
                    onChange={(e) =>
                      setGradeForm((f) => ({ ...f, entryScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Management Score
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={gradeForm.managementScore}
                    onChange={(e) =>
                      setGradeForm((f) => ({ ...f, managementScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Exit Score
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={gradeForm.exitScore}
                    onChange={(e) =>
                      setGradeForm((f) => ({ ...f, exitScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Review Score
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={gradeForm.reviewScore}
                    onChange={(e) =>
                      setGradeForm((f) => ({ ...f, reviewScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
              </div>
              <div className="flex gap-4 pt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={gradeForm.followedPlan}
                    onChange={(e) => setGradeForm((f) => ({ ...f, followedPlan: e.target.checked }))}
                    className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-700"
                  />
                  <span className="text-zinc-700 dark:text-zinc-300">Followed Plan</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={gradeForm.ruleViolation}
                    onChange={(e) => setGradeForm((f) => ({ ...f, ruleViolation: e.target.checked }))}
                    className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-700"
                  />
                  <span className="text-zinc-700 dark:text-zinc-300">Rule Violation</span>
                </label>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleGradeSave}
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Save
                </button>
                <button
                  onClick={cancelGradeEdit}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : grade ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-zinc-500 dark:text-zinc-400">Setup</div>
                  <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                    {grade.setupQualityScore}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 dark:text-zinc-400">Risk</div>
                  <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                    {grade.riskQualityScore}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 dark:text-zinc-400">Entry</div>
                  <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                    {grade.entryQualityScore}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 dark:text-zinc-400">Management</div>
                  <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                    {grade.managementQualityScore}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 dark:text-zinc-400">Exit</div>
                  <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                    {grade.exitQualityScore}
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 dark:text-zinc-400">Review</div>
                  <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                    {grade.reviewQualityScore}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-6 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Total</div>
                  <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {grade.totalScore}/60
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Grade</div>
                  <div
                    className={`text-lg font-bold tabular-nums ${
                      grade.gradeLabel === 'A'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : grade.gradeLabel === 'B'
                          ? 'text-blue-600 dark:text-blue-400'
                          : grade.gradeLabel === 'C'
                            ? 'text-amber-600 dark:text-amber-400'
                            : grade.gradeLabel === 'D'
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {grade.gradeLabel}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Followed Plan</div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {grade.followedPlan === true
                      ? 'Yes'
                      : grade.followedPlan === false
                        ? 'No'
                        : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Rule Violation</div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {grade.ruleViolation === true
                      ? 'Yes'
                      : grade.ruleViolation === false
                        ? 'No'
                        : '-'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              No grade recorded yet. Click &quot;Add Grade&quot; to evaluate this trade.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Mistakes Card */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="size-4 text-zinc-500" />
              Mistakes
            </CardTitle>
            <button
              onClick={() => setShowMistakeForm((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {showMistakeForm ? 'Cancel' : '+ Add Mistake'}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Collapsible form */}
          {showMistakeForm && (
            <form onSubmit={handleAddMistake} className="mb-6 space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              {mistakeMessage && (
                <div
                  className={`rounded-md border px-3 py-2 text-xs ${
                    mistakeMessage.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
                  }`}
                >
                  {mistakeMessage.text}
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Mistake Type *
                  </label>
                  <Select
                    value={mistakeForm.mistakeType}
                    onValueChange={(v) => setMistakeForm((f) => ({ ...f, mistakeType: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {mistakeTypes.map((mt) => (
                        <SelectItem key={mt.id} value={mt.value}>
                          {mt.description ?? mt.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Phase *
                  </label>
                  <Select
                    value={mistakeForm.phase}
                    onValueChange={(v) => setMistakeForm((f) => ({ ...f, phase: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select phase" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pre_trade">Pre-Trade</SelectItem>
                      <SelectItem value="entry">Entry</SelectItem>
                      <SelectItem value="management">Management</SelectItem>
                      <SelectItem value="exit">Exit</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Severity *
                  </label>
                  <Select
                    value={mistakeForm.severity}
                    onValueChange={(v) => setMistakeForm((f) => ({ ...f, severity: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select severity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minor">Minor</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="major">Major</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Status *
                  </label>
                  <Select
                    value={mistakeForm.status}
                    onValueChange={(v) => setMistakeForm((f) => ({ ...f, status: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="addressed">Addressed</SelectItem>
                      <SelectItem value="improved">Improved</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Root Cause *
                </label>
                <input
                  type="text"
                  value={mistakeForm.rootCause}
                  onChange={(e) => setMistakeForm((f) => ({ ...f, rootCause: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="What caused this mistake?"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Corrective Action *
                </label>
                <input
                  type="text"
                  value={mistakeForm.correctiveAction}
                  onChange={(e) => setMistakeForm((f) => ({ ...f, correctiveAction: e.target.value }))}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="How will you prevent this in the future?"
                />
              </div>
              <button
                type="submit"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Add Mistake
              </button>
            </form>
          )}

          {/* Mistakes table */}
          {mistakes.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              No mistakes recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Phase</th>
                    <th className="py-2 pr-4">Severity</th>
                    <th className="py-2 pr-4">Root Cause</th>
                    <th className="py-2 pr-4">Corrective Action</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mistakes.map((m) => {
                    const typeInfo = mistakeTypes.find((mt) => mt.id === m.mistakeTypeId);
                    const severityColors: Record<string, string> = {
                      minor: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
                      moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                      major: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
                      critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                    };
                    const statusColors: Record<string, string> = {
                      open: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                      addressed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                      improved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                      resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                    };
                    return (
                      <tr key={m.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="py-2.5 pr-4 text-zinc-900 dark:text-zinc-100">
                          {typeInfo?.description ?? typeInfo?.value ?? m.mistakeTypeId ?? '-'}
                        </td>
                        <td className="py-2.5 pr-4 capitalize text-zinc-600 dark:text-zinc-400">
                          {m.phase.replace('_', ' ')}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${severityColors[m.severity] ?? 'bg-zinc-100 text-zinc-600'}`}
                          >
                            {m.severity.charAt(0).toUpperCase() + m.severity.slice(1)}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 max-w-[200px] truncate text-zinc-700 dark:text-zinc-300" title={m.rootCause ?? ''}>
                          {m.rootCause ?? '-'}
                        </td>
                        <td className="py-2.5 pr-4 max-w-[200px] truncate text-zinc-700 dark:text-zinc-300" title={m.correctiveAction ?? ''}>
                          {m.correctiveAction ?? '-'}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[m.status] ?? 'bg-zinc-100 text-zinc-600'}`}
                          >
                            {m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => handleDeleteMistake(m.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-900/30"
                            aria-label="Delete mistake"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Executions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Executions</CardTitle>
        </CardHeader>
        <CardContent>
          {executions.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              No executions recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((exec) => (
                  <TableRow key={exec.id}>
                    <TableCell className="tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatDate(exec.executedAt)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          exec.action === 'buy' || exec.action === 'add'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : exec.action === 'sell' || exec.action === 'reduce'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : exec.action === 'sell_short'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        }`}
                      >
                        {formatAction(exec.action)}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                      {exec.quantity.toLocaleString()}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                      {formatPrice(exec.price)}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-500 dark:text-zinc-400">
                      {exec.fees != null ? formatCurrency(exec.fees) : '-'}
                    </TableCell>
                    <TableCell className="text-zinc-500 dark:text-zinc-400">
                      {exec.notes ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Stop Adjustments */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Stop Adjustments</CardTitle>
            <button
              onClick={() => setShowAdjustmentForm((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {showAdjustmentForm ? 'Cancel' : '+ Add Adjustment'}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Collapsible form */}
          {showAdjustmentForm && (
            <form onSubmit={handleAddAdjustment} className="mb-6 space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              {adjustmentMessage && (
                <div
                  className={`rounded-md border px-3 py-2 text-xs ${
                    adjustmentMessage.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
                  }`}
                >
                  {adjustmentMessage.text}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Previous Stop *
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={adjustmentForm.previousStop}
                    onChange={(e) => setAdjustmentForm((f) => ({ ...f, previousStop: e.target.value }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    New Stop *
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={adjustmentForm.newStop}
                    onChange={(e) => setAdjustmentForm((f) => ({ ...f, newStop: e.target.value }))}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Reason
                </label>
                <textarea
                  value={adjustmentForm.reason}
                  onChange={(e) => setAdjustmentForm((f) => ({ ...f, reason: e.target.value }))}
                  rows={2}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="Why is the stop being adjusted?"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ruleBased"
                  checked={adjustmentForm.ruleBased}
                  onChange={(e) => setAdjustmentForm((f) => ({ ...f, ruleBased: e.target.checked }))}
                  className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-700"
                />
                <label htmlFor="ruleBased" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Rule-based adjustment (e.g. trailing stop, volatility-based)
                </label>
              </div>
              <button
                type="submit"
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Add Stop Adjustment
              </button>
            </form>
          )}

          {/* Adjustments table */}
          {stopAdjustments.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              No stop adjustments recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Previous Stop</TableHead>
                  <TableHead className="text-right">New Stop</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Rule-Based</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stopAdjustments.map((adj) => {
                  const change =
                    adj.previousStop != null && adj.newStop != null
                      ? adj.newStop - adj.previousStop
                      : null;
                  return (
                    <TableRow key={adj.id}>
                      <TableCell className="tabular-nums text-zinc-500 dark:text-zinc-400">
                        {formatDate(adj.adjustedAt ?? adj.createdAt)}
                      </TableCell>
                      <TableCell className="tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                        {formatPrice(adj.previousStop)}
                      </TableCell>
                      <TableCell className="tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                        {formatPrice(adj.newStop)}
                      </TableCell>
                      <TableCell
                        className={`tabular-nums text-right ${
                          change != null
                            ? change > 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : change < 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-zinc-500 dark:text-zinc-400'
                            : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {change != null
                          ? `${change >= 0 ? '+' : ''}${change.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-zinc-500 dark:text-zinc-400">
                        {adj.reason ?? '-'}
                      </TableCell>
                      <TableCell>
                        {adj.ruleBased != null ? (
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              adj.ruleBased
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                            }`}
                          >
                            {adj.ruleBased ? 'Auto' : 'Manual'}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Assets */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-4 text-zinc-500" />
              Assets
            </CardTitle>
            <button
              onClick={() => setShowAssetForm((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              {showAssetForm ? 'Cancel' : '+ Add Asset'}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Asset form — collapsible */}
          {showAssetForm && (
            <div className="mb-6 space-y-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              {assetMessage && (
                <div
                  className={`rounded-md border px-3 py-2 text-xs ${
                    assetMessage.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
                  }`}
                >
                  {assetMessage.text}
                </div>
              )}

              {/* Mode toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAssetFormMode('upload')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
                    assetFormMode === 'upload'
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Upload className="size-3" />
                  Upload Screenshot
                </button>
                <button
                  type="button"
                  onClick={() => setAssetFormMode('link')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
                    assetFormMode === 'link'
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'
                  }`}
                >
                  <LinkIcon className="size-3" />
                  Add Link
                </button>
              </div>

              {assetFormMode === 'upload' ? (
                <form onSubmit={handleAssetUpload} className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Screenshot File
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setAssetFile(e.target.files?.[0] ?? null)}
                      className="w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-300 dark:text-zinc-400 dark:file:bg-zinc-700 dark:file:text-zinc-300 dark:hover:file:bg-zinc-600"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Phase
                    </label>
                    <div className="inline-block">
                      <Select value={assetPhase} onValueChange={setAssetPhase}>
                        <SelectTrigger className="w-36">
                          <SelectValue placeholder="Select phase" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pre_trade">Pre-Trade</SelectItem>
                          <SelectItem value="entry">Entry</SelectItem>
                          <SelectItem value="management">Management</SelectItem>
                          <SelectItem value="exit">Exit</SelectItem>
                          <SelectItem value="review">Review</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Label{' '}
                      <span className="text-zinc-400 dark:text-zinc-500">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={assetLabel}
                      onChange={(e) => setAssetLabel(e.target.value)}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="Chart setup screenshot"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Upload
                  </button>
                </form>
              ) : (
                <form onSubmit={handleAddLink} className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      URL *
                    </label>
                    <input
                      type="url"
                      value={assetUrl}
                      onChange={(e) => setAssetUrl(e.target.value)}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="https://www.tradingview.com/chart/..."
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Phase
                    </label>
                    <div className="inline-block">
                      <Select value={linkPhase} onValueChange={setLinkPhase}>
                        <SelectTrigger className="w-36">
                          <SelectValue placeholder="Select phase" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pre_trade">Pre-Trade</SelectItem>
                          <SelectItem value="entry">Entry</SelectItem>
                          <SelectItem value="management">Management</SelectItem>
                          <SelectItem value="exit">Exit</SelectItem>
                          <SelectItem value="review">Review</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Label{' '}
                      <span className="text-zinc-400 dark:text-zinc-500">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={linkLabel}
                      onChange={(e) => setLinkLabel(e.target.value)}
                      className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      placeholder="TradingView chart analysis"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Add Link
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Asset gallery — grouped by phase */}
          {assets.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              No assets attached to this trade yet.
            </p>
          ) : (
            <div className="space-y-6">
              {(['pre_trade', 'entry', 'management', 'exit', 'review'] as const).map(
                (phase) => {
                  const phaseAssets = assets.filter((a) => a.phase === phase);
                  if (phaseAssets.length === 0) return null;

                  const phaseLabel: Record<string, string> = {
                    pre_trade: 'Pre-Trade',
                    entry: 'Entry',
                    management: 'Management',
                    exit: 'Exit',
                    review: 'Review',
                  };

                  return (
                    <div key={phase}>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        {phaseLabel[phase]}
                      </h4>
                      <div className="flex flex-wrap gap-3">
                        {phaseAssets.map((asset) => (
                          <div
                            key={asset.id}
                            className="group relative w-40 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800/50"
                          >
                            {/* Delete button */}
                            <button
                              onClick={() => handleDeleteAsset(asset.id)}
                              className="absolute -right-1.5 -top-1.5 z-10 flex size-5 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 opacity-0 shadow-sm transition-colors hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-red-900/30"
                              aria-label={`Delete ${asset.label ?? 'asset'}`}
                            >
                              <Trash2 className="size-3" />
                            </button>

                            {asset.filePath ? (
                              /* Screenshot thumbnail */
                              <>
                                <img
                                  src={asset.filePath}
                                  alt={asset.label ?? 'Screenshot'}
                                  className="mb-1 h-20 w-full rounded object-cover"
                                />
                                {asset.label && (
                                  <p className="truncate text-xs text-zinc-700 dark:text-zinc-300">
                                    {asset.label}
                                  </p>
                                )}
                              </>
                            ) : asset.externalUrl ? (
                              /* Link card */
                              <a
                                href={asset.externalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mb-1 flex h-20 w-full flex-col items-center justify-center rounded bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                              >
                                <LinkIcon className="mb-1 size-5" />
                                <span className="max-w-[120px] truncate text-[10px]">
                                  {new URL(asset.externalUrl).hostname}
                                </span>
                              </a>
                            ) : null}

                            {asset.label && !asset.filePath && (
                              <p className="truncate text-xs text-zinc-700 dark:text-zinc-300">
                                {asset.label}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exit notes and lesson */}
      {(trade.exitNotes || trade.lesson) && (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {trade.exitNotes && (
            <Card>
              <CardHeader>
                <CardTitle>Exit Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.exitNotes}</p>
              </CardContent>
            </Card>
          )}
          {trade.lesson && (
            <Card>
              <CardHeader>
                <CardTitle>Lesson</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{trade.lesson}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Created/Updated timestamps */}
      <p className="mt-8 text-xs text-zinc-400 dark:text-zinc-600">
        Created {formatDate(trade.createdAt)}
        {trade.updatedAt && ` · Updated ${formatDate(trade.updatedAt)}`}
      </p>
    </div>
  );
}
