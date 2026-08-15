'use client';

/**
 * TradeContextBand (M020/S02).
 *
 * Standalone narrative band for a trade: thesis, invalidation condition,
 * and pre-trade plan. Extracted from RiskSnapshotCard so the monitoring
 * grid can place it in its own context band below the plan-vs-actual
 * surface without double rendering (S02 must-have: "Narrative fields
 * removed from RiskSnapshotCard body").
 *
 * Renders chrome-free: the grid panel (TradeDetailPanel) owns the title
 * bar, border, and panel-body spacing; this component owns only the three
 * narrative fields. Returns null when every field is empty, preserving the
 * previous RiskSnapshotCard behavior.
 */

interface TradeContextBandProps {
  thesis?: string | null;
  invalidationCondition?: string | null;
  preTradePlan?: string | null;
}

export default function TradeContextBand({
  thesis,
  invalidationCondition,
  preTradePlan,
}: TradeContextBandProps) {
  if (!thesis && !invalidationCondition && !preTradePlan) {
    return null;
  }

  return (
    <div className="space-y-3">
      {thesis && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Thesis</div>
          <p className="text-sm leading-relaxed text-foreground">{thesis}</p>
        </div>
      )}
      {invalidationCondition && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Invalidation</div>
          <p className="text-sm leading-relaxed text-foreground">{invalidationCondition}</p>
        </div>
      )}
      {preTradePlan && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Pre-Trade Plan</div>
          <p className="text-sm leading-relaxed text-foreground">{preTradePlan}</p>
        </div>
      )}
    </div>
  );
}
