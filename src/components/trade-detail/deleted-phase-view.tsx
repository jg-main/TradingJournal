'use client';

import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';

import { LifecycleStepper } from '@/components/lifecycle-stepper';
import { EmptyState } from '@/components/empty-state';
import TradeDetailHeader from './trade-detail-header';
import type { Trade } from './types';

interface DeletedPhaseViewProps {
  trade: Trade;
}

export default function DeletedPhaseView({ trade }: DeletedPhaseViewProps) {
  return (
    <>
      <TradeDetailHeader
        symbol={trade.symbol}
        status={trade.status}
        direction={trade.direction}
        tradeCode={trade.tradeCode}
      />

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
        icon={<AlertCircle className="size-12 text-muted-foreground" strokeWidth={1} />}
        title="This trade has been deleted"
        description="The trade was removed and its data is no longer available."
        action={
          <Link
            href="/trades"
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
          >
            <ArrowLeft className="size-4" />
            Back to Trades
          </Link>
        }
      />
    </>
  );
}
