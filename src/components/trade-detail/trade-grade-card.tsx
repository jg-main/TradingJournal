'use client';

import { useState } from 'react';
import { Star, Pencil } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
      return 'text-positive';
    case 'B':
      return 'text-info';
    case 'C':
      return 'text-warning';
    case 'D':
      return 'text-warning';
    default:
      return 'text-negative';
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
            <Star className="size-4 text-muted-foreground" />
            Trade Grade
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
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
            <Star className="size-4 text-muted-foreground" />
            Trade Grade
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <label htmlFor="grade-setupScore" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Setup Score
                </label>
                <Input
                  id="grade-setupScore"
                  type="number"
                  min={1}
                  max={10}
                  value={form.setupScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, setupScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                  }
                />
              </div>
              <div>
                <label htmlFor="grade-riskScore" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Risk Score
                </label>
                <Input
                  id="grade-riskScore"
                  type="number"
                  min={1}
                  max={10}
                  value={form.riskScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, riskScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                  }
                />
              </div>
              <div>
                <label htmlFor="grade-entryScore" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Entry Score
                </label>
                <Input
                  id="grade-entryScore"
                  type="number"
                  min={1}
                  max={10}
                  value={form.entryScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, entryScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                  }
                />
              </div>
              <div>
                <label htmlFor="grade-managementScore" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Management Score
                </label>
                <Input
                  id="grade-managementScore"
                  type="number"
                  min={1}
                  max={10}
                  value={form.managementScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, managementScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                  }
                />
              </div>
              <div>
                <label htmlFor="grade-exitScore" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Exit Score
                </label>
                <Input
                  id="grade-exitScore"
                  type="number"
                  min={1}
                  max={10}
                  value={form.exitScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, exitScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                  }
                />
              </div>
              <div>
                <label htmlFor="grade-reviewScore" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Review Score
                </label>
                <Input
                  id="grade-reviewScore"
                  type="number"
                  min={1}
                  max={10}
                  value={form.reviewScore}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, reviewScore: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))
                  }
                />
              </div>
            </div>
            <div className="flex gap-4 pt-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.followedPlan}
                  onChange={(e) => setForm((f) => ({ ...f, followedPlan: e.target.checked }))}
                  className="rounded border text-foreground focus:ring-ring"
                />
                <span className="text-muted-foreground">Followed Plan</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.ruleViolation}
                  onChange={(e) => setForm((f) => ({ ...f, ruleViolation: e.target.checked }))}
                  className="rounded border text-foreground focus:ring-ring"
                />
                <span className="text-muted-foreground">Rule Violation</span>
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave}>
                Save
              </Button>
              <Button variant="outline" onClick={() => setEditMode(false)}>
                Cancel
              </Button>
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
              <Star className="size-4 text-muted-foreground" />
              Trade Grade
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={enterEditMode}
            >
              <Pencil className="size-3" />
              Add Grade
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
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
            <Star className="size-4 text-muted-foreground" />
            Trade Grade
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={enterEditMode}
          >
            <Pencil className="size-3" />
            Edit
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <div className="text-muted-foreground">Setup</div>
              <div className="tabular-nums text-foreground">
                {grade.setupQualityScore}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Risk</div>
              <div className="tabular-nums text-foreground">
                {grade.riskQualityScore}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Entry</div>
              <div className="tabular-nums text-foreground">
                {grade.entryQualityScore}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Management</div>
              <div className="tabular-nums text-foreground">
                {grade.managementQualityScore}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Exit</div>
              <div className="tabular-nums text-foreground">
                {grade.exitQualityScore}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Review</div>
              <div className="tabular-nums text-foreground">
                {grade.reviewQualityScore}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-6 border-t pt-3">
            <div>
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="text-lg font-semibold tabular-nums text-foreground">
                {grade.totalScore}/60
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Grade</div>
              <div className={`text-lg font-bold tabular-nums ${gradeLetterColor(grade.gradeLabel)}`}>
                {grade.gradeLabel}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Followed Plan</div>
              <div className="text-sm font-medium text-foreground">
                {grade.followedPlan === true
                  ? 'Yes'
                  : grade.followedPlan === false
                    ? 'No'
                    : '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Rule Violation</div>
              <div className="text-sm font-medium text-foreground">
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
