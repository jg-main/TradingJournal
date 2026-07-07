'use client';

import { TrendingUp, TrendingDown, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import { statusBadgeVariant, statusLabel } from './helpers';
import TradePlanCard from './trade-plan-card';
import TradeAssetsCard from './trade-assets-card';
import type { Trade, TradeAsset } from './types';

interface PlannedPhaseViewProps {
  trade: Trade;
  assets: TradeAsset[];
  onAssetsChanged: () => Promise<void>;
  onExecute: () => void;
}

export default function PlannedPhaseView({
  trade,
  assets,
  onAssetsChanged,
  onExecute,
}: PlannedPhaseViewProps) {
  const badgeInfo = statusBadgeVariant(trade.status);
  const preTradeAssets = assets.filter((a) => a.phase === 'pre_trade');

  return (
    <>
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
          <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {trade.tradeCode}
          </p>
        </div>
        <button
          type="button"
          onClick={onExecute}
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Play className="size-4" />
          Execute
        </button>
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

      {/* Trade Plan Card */}
      <div className="mb-8">
        <TradePlanCard trade={trade} />
      </div>

      {/* Assets — pre_trade only */}
      <TradeAssetsCard
        assets={preTradeAssets}
        tradeId={trade.id}
        onAssetsChanged={onAssetsChanged}
      />
    </>
  );
}
