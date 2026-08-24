/**
 * workflow-phase.ts
 *
 * Derived workflow phase for trades (S05/T01).
 *
 * The workflow phase is NOT a stored economic status — it is derived from:
 *   - the stored trade status ('planned' | 'open' | 'closed' | 'deleted')
 *   - whether the trade has been reviewed (reviewedAt present)
 *   - whether meaningful management activity exists (add/reduce executions,
 *     stop adjustments, target adjustments)
 *
 * "Managed" is the key derived sub-phase: an open trade becomes "managed"
 * once the trader adds/reduces size or adjusts a stop/target level.
 *
 * Pattern: src/lib/trade-calc.ts (M026 pure-computation convention)
 *   - No database imports
 *   - No NextResponse or framework dependencies
 *   - Own input/output types (not Drizzle schema types)
 *   - Plain arguments only
 */

// ── Output Type ─────────────────────────────────────────────────────────

/** Derived workflow phase of a trade. */
export type WorkflowPhase =
  | 'planned'
  | 'open'
  | 'managed'
  | 'closed'
  | 'reviewed'
  | 'deleted';

// ── Input Types ─────────────────────────────────────────────────────────

/** Stored economic status of a trade (subset of the trades table enum). */
export type WorkflowStatus = 'planned' | 'open' | 'closed' | 'deleted';

/** Minimal execution shape — only the `action` field is inspected. */
export interface ExecutionLike {
  action: string;
}

/** Which kinds of management activity exist for a trade. */
export interface ManagementActivity {
  /** Any execution with action 'add' or 'reduce' (direction-independent). */
  hasAddOrReduceExecution: boolean;
  /** Any stop adjustment record exists. */
  hasStopAdjustment: boolean;
  /** Any target adjustment record exists. */
  hasTargetAdjustment: boolean;
}

// ── Derivation ─────────────────────────────────────────────────────────

/**
 * Detect management activity from raw collections.
 *
 * Only add/reduce executions count as management executions — entry/exit
 * actions (buy, sell, buy_to_cover, sell_short) are position shaping, not
 * management. Any non-empty stop/target adjustment collection counts.
 */
export function hasManagementActivity(
  executions: ExecutionLike[] = [],
  stopAdjustments: unknown[] = [],
  targetAdjustments: unknown[] = [],
): ManagementActivity {
  return {
    hasAddOrReduceExecution: executions.some(
      (execution) => execution.action === 'add' || execution.action === 'reduce',
    ),
    hasStopAdjustment: stopAdjustments.length > 0,
    hasTargetAdjustment: targetAdjustments.length > 0,
  };
}

/** Whether any management activity flag is set. */
export function hasAnyManagementActivity(activity: ManagementActivity): boolean {
  return (
    activity.hasAddOrReduceExecution || activity.hasStopAdjustment || activity.hasTargetAdjustment
  );
}

/**
 * Derive the workflow phase for a trade.
 *
 * - 'planned'  when the trade is still planned (regardless of activity)
 * - 'managed'  when open AND meaningful management activity exists
 * - 'open'     when open AND no management activity yet
 * - 'closed'   when closed AND not yet reviewed
 * - 'reviewed' when closed AND reviewedAt is set
 * - 'deleted'  pass-through
 */
export function deriveWorkflowPhase(
  status: WorkflowStatus,
  reviewedAt: string | null | undefined,
  managementActivity: ManagementActivity,
): WorkflowPhase {
  switch (status) {
    case 'planned':
      return 'planned';
    case 'open':
      return hasAnyManagementActivity(managementActivity) ? 'managed' : 'open';
    case 'closed':
      return reviewedAt ? 'reviewed' : 'closed';
    case 'deleted':
      return 'deleted';
  }
}
