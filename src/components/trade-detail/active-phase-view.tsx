'use client';

import { LifecycleStepper } from '@/components/lifecycle-stepper';
import TradeDetailHeader from './trade-detail-header';
import RiskSnapshotCard from './risk-snapshot-card';
import TradeDetailsCard from './trade-details-card';
import TradeLifecycleSummaryCard from './trade-lifecycle-summary-card';
import TradeHistoryFeed, { type LevelHistoryEvent } from './trade-history-feed';
import PriceWidget from './price-widget';
import TradePnlCard from './trade-pnl-card';
import TradeCheckResultsCard from './trade-check-results-card';
import { TradeDetailColumn, TradeDetailGrid, TradeDetailMain, TradeDetailPanel } from './trade-detail-grid';
import TradeContextBand from './trade-context-band';
import TradeAssetsCard from './trade-assets-card';
import type {
  Trade,
  Execution,
  RiskSnapshot,
  StopAdjustment,
  TargetAdjustment,
  TradeAsset,
  CheckResult,
  MtmData,
} from './types';
import type { DeriveStatusResult } from '@/lib/trade-metrics';
import type { PerfMetrics } from '@/lib/perf-metrics';

interface ActivePhaseViewProps {
  trade: Trade;
  executions: Execution[];
  levelHistoryEvents: LevelHistoryEvent[];
  riskSnapshot: RiskSnapshot | null;
  stopAdjustments: StopAdjustment[];
  targetAdjustments: TargetAdjustment[];
  assets: TradeAsset[];
  derivedStatus: DeriveStatusResult | null;
  pnlResult: {
    totalRealizedPnL: number;
    avgEntryPrice: number | null;
    totalEntryQty: number;
    totalExitQty: number;
  } | null;
  rMultiple: { rMultiple: number | null; initialRiskUsed: boolean } | null;
  perfMetrics: PerfMetrics | null;
  checkResults: CheckResult[];
  mtmData: MtmData;
  onRefreshPrice: () => void;
  onAdjustmentsChanged: () => Promise<void>;
  onAssetsChanged: () => Promise<void>;
  onTradeChanged: () => Promise<void>;
  onAddFill?: () => void;
  onCorrectExecution?: (execution: Execution) => void;
  unrealizedPnl?: number | null;
  unrealizedReturnPct?: number | null;
  unrealizedRMultiple?: number | null;
}

export default function ActivePhaseView({
  trade,
  executions,
  levelHistoryEvents,
  riskSnapshot,
  stopAdjustments,
  targetAdjustments,
  assets,
  derivedStatus,
  pnlResult,
  rMultiple,
  perfMetrics,
  checkResults,
  mtmData,
  onRefreshPrice,
  onAdjustmentsChanged,
  onAssetsChanged,
  onTradeChanged,
  onAddFill,
  onCorrectExecution,
  unrealizedPnl,
  unrealizedReturnPct,
  unrealizedRMultiple,
}: ActivePhaseViewProps) {
  return (
    <TradeDetailGrid>
      <TradeDetailPanel area="lifecycle" title="Lifecycle">
        <LifecycleStepper
          status={trade.status}
          direction={trade.direction}
          openedAt={trade.openedAt}
          exitNotes={trade.exitNotes}
          lesson={trade.lesson}
        />
      </TradeDetailPanel>

      <TradeDetailMain>
      <TradeDetailColumn area="left">
        <TradeDetailPanel area="cockpit" title="Cockpit">
          <TradeDetailHeader
            symbol={trade.symbol}
            status={trade.status}
            direction={trade.direction}
            tradeCode={trade.tradeCode}
            openedAt={trade.openedAt}
            setupName={trade.setupName}
            tradeId={trade.id}
            onTradeChanged={onTradeChanged}
          />
          <PriceWidget mtmData={mtmData} onRefreshPrice={onRefreshPrice} />
          {derivedStatus && (
            <TradeLifecycleSummaryCard
              status={trade.status}
              openedAt={derivedStatus.openedAt}
              closedAt={derivedStatus.closedAt}
              openQuantity={derivedStatus.openQuantity}
            />
          )}
        </TradeDetailPanel>

        <TradeDetailPanel area="context" title="Context">
          <TradeContextBand
            tradeId={trade.id}
            thesis={trade.thesis}
            invalidationCondition={trade.invalidationCondition}
            preTradePlan={trade.preTradePlan}
            onTradeChanged={onTradeChanged}
          />
        </TradeDetailPanel>
      </TradeDetailColumn>

      <TradeDetailColumn area="details">
        <TradeDetailPanel area="details" title="Trade Details">
          <TradeDetailsCard
            plannedValues={trade}
            initialEntryPrice={riskSnapshot?.initialEntryPrice ?? null}
            initialStopPrice={riskSnapshot?.initialStopPrice ?? null}
            initialQuantity={riskSnapshot?.initialQuantity ?? null}
            currentQuantity={derivedStatus?.openQuantity ?? null}
            actualEntryPrice={pnlResult?.avgEntryPrice ?? null}
            totalEntryQuantity={pnlResult?.totalEntryQty ?? 0}
            totalExitQuantity={pnlResult?.totalExitQty ?? 0}
            stopAdjustments={stopAdjustments}
            targetAdjustments={targetAdjustments}
            tradeStatus={trade.status}
            tradeId={trade.id}
            onAdjustmentsChanged={onAdjustmentsChanged}
            onAddFill={onAddFill}
          />
        </TradeDetailPanel>

        <TradeDetailPanel area="history">
          <TradeHistoryFeed
            levelHistoryEvents={levelHistoryEvents}
            executions={executions}
            onCorrectExecution={onCorrectExecution}
          />
        </TradeDetailPanel>
      </TradeDetailColumn>

      <TradeDetailPanel area="assets">
        <TradeAssetsCard
          assets={assets}
          tradeId={trade.id}
          onAssetsChanged={onAssetsChanged}
          defaultPhase="management"
        />
      </TradeDetailPanel>
      </TradeDetailMain>

      <TradeDetailColumn area="right">
        <TradeDetailPanel area="risk" title="Risk">
          <TradePnlCard
            realizedPnl={pnlResult?.totalRealizedPnL ?? 0}
            rMultiple={rMultiple?.rMultiple ?? null}
            avgEntryPrice={pnlResult?.avgEntryPrice ?? null}
            totalEntryQty={pnlResult?.totalEntryQty ?? 0}
            totalExitQty={pnlResult?.totalExitQty ?? 0}
            duration={perfMetrics?.duration ?? null}
            returnPercent={perfMetrics?.returnPercent ?? null}
            totalFees={perfMetrics?.totalFees ?? 0}
            unrealizedPnl={unrealizedPnl}
            unrealizedReturnPct={unrealizedReturnPct}
            unrealizedRMultiple={unrealizedRMultiple}
            setupName={trade.setupName}
          />
          <RiskSnapshotCard
            riskSnapshot={riskSnapshot}
            plannedValues={trade}
            actualValues={{ avgEntryPrice: pnlResult?.avgEntryPrice ?? null, avgExitPrice: null }}
            mtmData={mtmData}
            tradeStatus={trade.status}
          />
        </TradeDetailPanel>

        <TradeDetailPanel area="review" title="Review">
          <TradeCheckResultsCard checkResults={checkResults} />
        </TradeDetailPanel>
      </TradeDetailColumn>

    </TradeDetailGrid>
  );
}
