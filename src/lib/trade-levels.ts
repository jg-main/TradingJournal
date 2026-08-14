/**
 * trade-levels.ts
 *
 * Pure derivation helpers for trade level values (stop, targets).
 *
 * Canonical logic per M019: the CURRENT value of a level is derived from the
 * append-only adjustment chains, never from client-supplied values. These
 * helpers are plain functions over plain data — they must not import database
 * access or NextResponse (AGENTS.md Computation Ownership).
 */

/** Minimal shape of a stop adjustment row used for chain derivation. */
export interface StopAdjustmentLike {
  id: string;
  newStop: number | null;
  adjustedAt: string | null;
  createdAt: string | null;
}

/** Minimal shape of a target adjustment row used for chain derivation. */
export interface TargetAdjustmentLike {
  id: string;
  targetIndex: number;
  newTarget: number | null;
  adjustedAt: string | null;
  createdAt: string | null;
}

/**
 * Shared ordering for level event chains: adjustedAt desc, createdAt desc,
 * id desc. Mirrors the list ordering used by the stop-adjustments GET route
 * so the "latest" event here is the same event the UI shows as most recent.
 */
export function compareLevelEventsDesc(
  a: { adjustedAt: string | null; createdAt: string | null; id: string },
  b: { adjustedAt: string | null; createdAt: string | null; id: string },
): number {
  const aAt = a.adjustedAt ?? a.createdAt ?? '';
  const bAt = b.adjustedAt ?? b.createdAt ?? '';
  if (aAt !== bAt) return aAt < bAt ? 1 : -1;
  const aC = a.createdAt ?? '';
  const bC = b.createdAt ?? '';
  if (aC !== bC) return aC < bC ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Current stop of a trade: the latest stop adjustment's newStop, else the
 * initial stop from the risk snapshot, else the planned stop.
 *
 * Domain invariant (M019/CONTEXT.md): the current stop of an open trade is
 * the latest stop adjustment's newStop, else the initial stop. plannedStop
 * stays immutable once the trade leaves planned status (R019) and is a plan
 * value, not the live level — it is only the final fallback here.
 */
export function deriveCurrentStop(
  plannedStop: number | null,
  initialStopPrice: number | null,
  adjustments: StopAdjustmentLike[],
): number | null {
  if (adjustments.length > 0) {
    const sorted = [...adjustments].sort(compareLevelEventsDesc);
    const latestNewStop = sorted[0].newStop;
    if (latestNewStop != null) return latestNewStop;
  }
  if (initialStopPrice != null) return initialStopPrice;
  return plannedStop;
}

/**
 * Current value of a specific target level (index 1 or 2): the latest target
 * adjustment's newTarget for that index, else the planned target.
 * Adjustments for other target indexes are ignored.
 */
export function deriveCurrentTarget(
  plannedTarget: number | null,
  targetIndex: number,
  adjustments: TargetAdjustmentLike[],
): number | null {
  const forIndex = adjustments.filter((a) => a.targetIndex === targetIndex);
  if (forIndex.length > 0) {
    const sorted = [...forIndex].sort(compareLevelEventsDesc);
    const latestNewTarget = sorted[0].newTarget;
    if (latestNewTarget != null) return latestNewTarget;
  }
  return plannedTarget;
}
