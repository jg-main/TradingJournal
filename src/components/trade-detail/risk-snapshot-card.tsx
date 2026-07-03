'use client';

import { useState, useEffect } from 'react';
import { Target, Pencil } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatPrice, formatCurrency } from './helpers';
import type { RiskSnapshot } from './types';

interface RiskSnapshotCardProps {
  riskSnapshot: RiskSnapshot | null;
  onSave: (payload: Record<string, number | null>) => Promise<void>;
}

const defaultForm: Record<string, string> = {
  accountEquityAtOpen: '',
  initialEntryPrice: '',
  initialStopPrice: '',
  initialQuantity: '',
  riskPerShare: '',
  initialRiskAmount: '',
  accountRiskPct: '',
  plannedRewardRisk: '',
};

export default function RiskSnapshotCard({ riskSnapshot, onSave }: RiskSnapshotCardProps) {
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ ...defaultForm });

  useEffect(() => {
    if (!editMode && riskSnapshot) {
      setForm({
        accountEquityAtOpen: riskSnapshot.accountEquityAtOpen?.toString() ?? '',
        initialEntryPrice: riskSnapshot.initialEntryPrice?.toString() ?? '',
        initialStopPrice: riskSnapshot.initialStopPrice?.toString() ?? '',
        initialQuantity: riskSnapshot.initialQuantity?.toString() ?? '',
        riskPerShare: riskSnapshot.riskPerShare?.toString() ?? '',
        initialRiskAmount: riskSnapshot.initialRiskAmount?.toString() ?? '',
        accountRiskPct: riskSnapshot.accountRiskPct?.toString() ?? '',
        plannedRewardRisk: riskSnapshot.plannedRewardRisk?.toString() ?? '',
      });
    }
  }, [riskSnapshot, editMode]);

  const handleSave = async () => {
    const payload: Record<string, number | null> = {};
    const fields: string[] = [
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
      const val = form[field];
      payload[field] = val === '' ? null : parseFloat(val);
    }

    try {
      await onSave(payload);
      setEditMode(false);
    } catch {
      // Stay in edit mode on error
    }
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // ── Empty State ─────────────────────────────────────────────────

  if (!riskSnapshot && !editMode) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="size-4 text-zinc-500" />
            Risk Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No risk snapshot recorded.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Edit Mode ───────────────────────────────────────────────────

  if (editMode && riskSnapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="size-4 text-zinc-500" />
            Risk Snapshot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Equity at Open
                </label>
                <input
                  type="number"
                  step="any"
                  value={form.accountEquityAtOpen}
                  onChange={(e) => updateField('accountEquityAtOpen', e.target.value)}
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
                  value={form.initialEntryPrice}
                  onChange={(e) => updateField('initialEntryPrice', e.target.value)}
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
                  value={form.initialStopPrice}
                  onChange={(e) => updateField('initialStopPrice', e.target.value)}
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
                  value={form.initialQuantity}
                  onChange={(e) => updateField('initialQuantity', e.target.value)}
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
                  value={form.riskPerShare}
                  onChange={(e) => updateField('riskPerShare', e.target.value)}
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
                  value={form.initialRiskAmount}
                  onChange={(e) => updateField('initialRiskAmount', e.target.value)}
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
                  value={form.accountRiskPct}
                  onChange={(e) => updateField('accountRiskPct', e.target.value)}
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
                  value={form.plannedRewardRisk}
                  onChange={(e) => updateField('plannedRewardRisk', e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Save
              </button>
              <button
                onClick={() => setEditMode(false)}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Read Mode ───────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Target className="size-4 text-zinc-500" />
            Risk Snapshot
          </CardTitle>
          <button
            onClick={() => setEditMode(true)}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <Pencil className="size-3" />
            Edit
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="text-zinc-500 dark:text-zinc-400">Initial Entry</div>
          <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatPrice(riskSnapshot!.initialEntryPrice)}
          </div>

          <div className="text-zinc-500 dark:text-zinc-400">Initial Stop</div>
          <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatPrice(riskSnapshot!.initialStopPrice)}
          </div>

          <div className="text-zinc-500 dark:text-zinc-400">Initial Qty</div>
          <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
            {riskSnapshot!.initialQuantity?.toLocaleString() ?? '-'}
          </div>

          <div className="text-zinc-500 dark:text-zinc-400">Risk/Share</div>
          <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatPrice(riskSnapshot!.riskPerShare)}
          </div>

          <div className="text-zinc-500 dark:text-zinc-400">Risk Amount</div>
          <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCurrency(riskSnapshot!.initialRiskAmount)}
          </div>

          <div className="text-zinc-500 dark:text-zinc-400">Account Risk</div>
          <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
            {riskSnapshot!.accountRiskPct != null
              ? `${riskSnapshot!.accountRiskPct.toFixed(2)}%`
              : '-'}
          </div>

          {riskSnapshot!.plannedRewardRisk != null && (
            <>
              <div className="text-zinc-500 dark:text-zinc-400">Planned R:R</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {riskSnapshot!.plannedRewardRisk.toFixed(2)}
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
