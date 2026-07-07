'use client';

import { useState } from 'react';
import { Star, Pencil } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import type { Trade, TradeGrade } from './types';

export interface GradeFormPayload {
  setupScore: number;
  riskScore: number;
  entryScore: number;
  managementScore: number;
  exitScore: number;
  reviewScore: number;
  followedPlan: boolean;
  ruleViolation: boolean;
}

interface TradeGradeCardProps {
  grade: TradeGrade | null;
  tradeStatus: Trade['status'];
  onSave: (payload: GradeFormPayload) => Promise<void>;
}

const defaultForm: GradeFormPayload = {
  setupScore: 5,
  riskScore: 5,
  entryScore: 5,
  managementScore: 5,
  exitScore: 5,
  reviewScore: 5,
  followedPlan: false,
  ruleViolation: false,
};

function gradeLetterColor(letter: string): string {
  switch (letter) {
    case 'A':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'B':
      return 'text-blue-600 dark:text-blue-400';
    case 'C':
      return 'text-amber-600 dark:text-amber-400';
    case 'D':
      return 'text-orange-600 dark:text-orange-400';
    default:
      return 'text-red-600 dark:text-red-400';
  }
}

export default function TradeGradeCard({ grade, tradeStatus, onSave }: TradeGradeCardProps) {
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<GradeFormPayload>({ ...defaultForm });

  const enterEditMode = () => {
    setForm({
      setupScore: grade?.setupQualityScore ?? 5,
      riskScore: grade?.riskQualityScore ?? 5,
      entryScore: grade?.entryQualityScore ?? 5,
      managementScore: grade?.managementQualityScore ?? 5,
      exitScore: grade?.exitQualityScore ?? 5,
      reviewScore: grade?.reviewQualityScore ?? 5,
      followedPlan: grade?.followedPlan ?? false,
      ruleViolation: grade?.ruleViolation ?? false,
    });
    setEditMode(true);
  };

  const handleSave = async () => {
    try {
      await onSave(form);
      setEditMode(false);
    } catch {
      // Stay in edit mode on error
    }
  };

  // ── Non-closed trades ───────────────────────────────────────────

  if (tradeStatus !== 'closed') {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="size-4 text-zinc-500" />
            Trade Grade
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Grading is only available for closed trades.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Edit Mode ───────────────────────────────────────────────────

  if (editMode) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="size-4 text-zinc-500" />
            Trade Grade
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                  value={form.setupScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, setupScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
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
                  value={form.riskScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, riskScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
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
                  value={form.entryScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, entryScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
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
                  value={form.managementScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, managementScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
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
                  value={form.exitScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, exitScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
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
                  value={form.reviewScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, reviewScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                  }
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            </div>
            <div className="flex gap-4 pt-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.followedPlan}
                  onChange={(e) => setForm((f) => ({ ...f, followedPlan: e.target.checked }))}
                  className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-700"
                />
                <span className="text-zinc-700 dark:text-zinc-300">Followed Plan</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.ruleViolation}
                  onChange={(e) => setForm((f) => ({ ...f, ruleViolation: e.target.checked }))}
                  className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-700"
                />
                <span className="text-zinc-700 dark:text-zinc-300">Rule Violation</span>
              </label>
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

  // ── Closed trade without grade ──────────────────────────────────

  if (!grade) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Star className="size-4 text-zinc-500" />
              Trade Grade
            </CardTitle>
            <button
              onClick={enterEditMode}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <Pencil className="size-3" />
              Add Grade
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No grade recorded yet. Click &quot;Add Grade&quot; to evaluate this trade.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Closed trade with grade, read mode ──────────────────────────

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Star className="size-4 text-zinc-500" />
            Trade Grade
          </CardTitle>
          <button
            onClick={enterEditMode}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <Pencil className="size-3" />
            Edit
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <div className="text-zinc-600 dark:text-zinc-300">Setup</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {grade.setupQualityScore}
              </div>
            </div>
            <div>
              <div className="text-zinc-600 dark:text-zinc-300">Risk</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {grade.riskQualityScore}
              </div>
            </div>
            <div>
              <div className="text-zinc-600 dark:text-zinc-300">Entry</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {grade.entryQualityScore}
              </div>
            </div>
            <div>
              <div className="text-zinc-600 dark:text-zinc-300">Management</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {grade.managementQualityScore}
              </div>
            </div>
            <div>
              <div className="text-zinc-600 dark:text-zinc-300">Exit</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {grade.exitQualityScore}
              </div>
            </div>
            <div>
              <div className="text-zinc-600 dark:text-zinc-300">Review</div>
              <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
                {grade.reviewQualityScore}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-6 border-t border-zinc-200 pt-3 dark:border-zinc-700">
            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-300">Total</div>
              <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {grade.totalScore}/60
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-300">Grade</div>
              <div className={`text-lg font-bold tabular-nums ${gradeLetterColor(grade.gradeLabel)}`}>
                {grade.gradeLabel}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-300">Followed Plan</div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {grade.followedPlan === true
                  ? 'Yes'
                  : grade.followedPlan === false
                    ? 'No'
                    : '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-300">Rule Violation</div>
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
      </CardContent>
    </Card>
  );
}
