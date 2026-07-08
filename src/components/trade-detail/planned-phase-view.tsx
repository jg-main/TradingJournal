'use client';

import { Play } from 'lucide-react';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import TradeDetailHeader from './trade-detail-header';
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
  const preTradeAssets = assets.filter((a) => a.phase === 'pre_trade');

  return (
    <>
      <TradeDetailHeader
        symbol={trade.symbol}
        status={trade.status}
        direction={trade.direction}
        tradeCode={trade.tradeCode}
        rightContent={
          <button
            type="button"
            onClick={onExecute}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Play className="size-4" />
            Execute
          </button>
        }
      />

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
      <div className="mb-8">
        <TradeAssetsCard
          assets={preTradeAssets}
          tradeId={trade.id}
          onAssetsChanged={onAssetsChanged}
        />
      </div>
    </>
  );
}
