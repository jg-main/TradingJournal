'use client';

import Link from 'next/link';
import { TrendingUp, TrendingDown, ArrowLeft, AlertCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import { EmptyState } from '@/components/empty-state';
import { statusBadgeVariant, statusLabel } from './helpers';
import type { Trade } from './types';

interface DeletedPhaseViewProps {
  trade: Trade;
}

export default function DeletedPhaseView({ trade }: DeletedPhaseViewProps) {
  const badgeInfo = statusBadgeVariant(trade.status);

  return (
    <>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-400 line-through dark:text-zinc-500">
              {trade.symbol}
            </h1>
            <Badge variant={badgeInfo.variant} className={badgeInfo.className}>
              {statusLabel(trade.status)}
            </Badge>
            {trade.direction === 'long' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                <TrendingUp className="size-3" />
                Long
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                <TrendingDown className="size-3" />
                Short
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {trade.tradeCode}
          </p>
        </div>
      </div>

      {/* Scratched Lifecycle Stepper */}
      <div className="mb-8">
        <LifecycleStepper
          status={trade.status}
          direction={trade.direction}
          openedAt={trade.openedAt}
          exitNotes={trade.exitNotes}
          lesson={trade.lesson}
        />
      </div>

      {/* Deleted state */}
      <EmptyState
        icon={<AlertCircle className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
        title="This trade has been deleted"
        description="The trade was removed and its data is no longer available."
        action={
          <Link
            href="/trades"
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <ArrowLeft className="size-4" />
            Back to Trade Log
          </Link>
        }
      />
    </>
  );
}
