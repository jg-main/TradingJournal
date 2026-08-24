'use client';

import { useState, type ReactNode } from 'react';
import { Calendar, Check, Pencil, Tag, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { statusBadgeVariant, statusLabel } from './helpers';
import { useAppTimezone } from '@/lib/timezone-context';
import type { WorkflowPhase } from '@/lib/workflow-phase';
import type { Trade } from './types';

interface TradeDetailHeaderProps {
  symbol: string;
  status: Trade['status'];
  direction: Trade['direction'];
  tradeCode: string;
  openedAt?: string | null;
  setupName?: string | null;
  gradeLabel?: string | null;
  tradeId?: string;
  // S05/T03: derived workflow phase — when 'managed', an extra Managed badge
  // appears next to the economic status badge. Other phases render nothing
  // extra (the status badge already carries the label).
  workflowPhase?: WorkflowPhase;
  onTradeChanged?: () => Promise<void>;
  rightContent?: ReactNode;
}

/** Compact trade identity with a section-owned setup editor. */
export default function TradeDetailHeader({
  symbol,
  status,
  tradeCode,
  openedAt,
  setupName,
  gradeLabel,
  tradeId,
  workflowPhase,
  onTradeChanged,
  rightContent,
}: TradeDetailHeaderProps) {
  const { timezone } = useAppTimezone();
  const [editingSetup, setEditingSetup] = useState(false);
  const [setupDraft, setSetupDraft] = useState(setupName ?? '');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [savingSetup, setSavingSetup] = useState(false);
  const isDeleted = status === 'deleted';
  const canEditSetup = Boolean(tradeId && onTradeChanged && status === 'open');

  const openedDate = openedAt
    ? new Date(openedAt).toLocaleDateString(undefined, { timeZone: timezone, month: 'short', day: 'numeric' })
    : null;

  const cancelSetupEdit = () => {
    setEditingSetup(false);
    setSetupDraft(setupName ?? '');
    setSetupError(null);
  };

  const saveSetup = async () => {
    if (!tradeId || !onTradeChanged) return;
    setSavingSetup(true);
    setSetupError(null);
    try {
      const response = await fetch(`/api/trades/${tradeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup: setupDraft.trim() || null }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setSetupError(body.error ?? 'Failed to update setup.');
        return;
      }
      setEditingSetup(false);
      await onTradeChanged();
    } catch {
      setSetupError('Failed to update setup. Check your connection and try again.');
    } finally {
      setSavingSetup(false);
    }
  };

  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <h1 className={isDeleted ? 'text-xl font-semibold tracking-tight text-muted-foreground line-through' : 'text-xl font-semibold tracking-tight text-foreground'}>{symbol}</h1>
          <Badge variant={statusBadgeVariant(status).variant} className={statusBadgeVariant(status).className}>
            {statusLabel(status)}
          </Badge>
          {workflowPhase === 'managed' && (
            <Badge variant="secondary" className="bg-info/10 text-info">
              Managed
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{tradeCode}</span>
          {openedDate && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" />
                {openedDate}
              </span>
            </>
          )}
          <span>·</span>
          {editingSetup ? (
            <span className="inline-flex items-center gap-1">
              <Tag className="size-3" aria-hidden="true" />
              <Input
                aria-label="Setup"
                value={setupDraft}
                onChange={(event) => setSetupDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveSetup();
                  if (event.key === 'Escape') cancelSetupEdit();
                }}
                className="h-7 w-44 text-xs"
                autoFocus
                disabled={savingSetup}
              />
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => void saveSetup()} disabled={savingSetup} aria-label="Save setup">
                <Check className="size-3" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={cancelSetupEdit} disabled={savingSetup} aria-label="Cancel setup edit">
                <X className="size-3" />
              </Button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Tag className="size-3" />
              {setupName ?? 'No setup'}
              {canEditSetup && (
                <button
                  type="button"
                  onClick={() => {
                    setSetupDraft(setupName ?? '');
                    setEditingSetup(true);
                    setSetupError(null);
                  }}
                  className="inline-flex size-5 items-center justify-center rounded hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Edit setup"
                >
                  <Pencil className="size-3" />
                </button>
              )}
            </span>
          )}
          {gradeLabel && (
            <>
              <span>·</span>
              <span className="font-medium">Grade: {gradeLabel}</span>
            </>
          )}
        </div>
        {setupError && <p role="alert" className="text-xs text-destructive">{setupError}</p>}
      </div>
      {rightContent && <div className="shrink-0">{rightContent}</div>}
    </div>
  );
}
