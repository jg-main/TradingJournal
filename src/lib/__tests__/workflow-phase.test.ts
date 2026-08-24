/**
 * workflow-phase.test.ts
 *
 * Tests for the derived workflow phase library (S05/T01).
 *
 * Covers:
 * - deriveWorkflowPhase mapping for every status × management-activity
 *   combination (planned / open / managed / closed / reviewed / deleted).
 * - hasManagementActivity detection: add/reduce executions count,
 *   buy/sell/buy_to_cover/sell_short entry/exit executions do not;
 *   any stop or target adjustment counts.
 *
 * Run: npx vitest run src/lib/__tests__/workflow-phase.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  deriveWorkflowPhase,
  hasManagementActivity,
  type ManagementActivity,
  type WorkflowPhase,
  type WorkflowStatus,
  type ExecutionLike,
} from '../workflow-phase';

const NO_ACTIVITY: ManagementActivity = {
  hasAddOrReduceExecution: false,
  hasStopAdjustment: false,
  hasTargetAdjustment: false,
};

const ALL_ACTIVITY: ManagementActivity = {
  hasAddOrReduceExecution: true,
  hasStopAdjustment: true,
  hasTargetAdjustment: true,
};

function execution(action: string): ExecutionLike {
  return { action };
}

describe('deriveWorkflowPhase', () => {
  it("maps planned status to 'planned' regardless of activity or review state", () => {
    expect(deriveWorkflowPhase('planned', null, NO_ACTIVITY)).toBe('planned');
    expect(deriveWorkflowPhase('planned', '2026-08-01T00:00:00Z', ALL_ACTIVITY)).toBe('planned');
  });

  it("maps open status with no management activity to 'open'", () => {
    expect(deriveWorkflowPhase('open', null, NO_ACTIVITY)).toBe('open');
  });

  it("maps open status with an add execution to 'managed'", () => {
    const activity = hasManagementActivity([execution('add')], [], []);
    expect(deriveWorkflowPhase('open', null, activity)).toBe('managed');
  });

  it("maps open status with a reduce execution to 'managed'", () => {
    const activity = hasManagementActivity([execution('reduce')], [], []);
    expect(deriveWorkflowPhase('open', null, activity)).toBe('managed');
  });

  it("maps open status with a stop adjustment to 'managed'", () => {
    const activity = hasManagementActivity([], [{ id: 's1' }], []);
    expect(deriveWorkflowPhase('open', null, activity)).toBe('managed');
  });

  it("maps open status with a target adjustment to 'managed'", () => {
    const activity = hasManagementActivity([], [], [{ id: 't1' }]);
    expect(deriveWorkflowPhase('open', null, activity)).toBe('managed');
  });

  it("maps open status with multiple activities to 'managed'", () => {
    expect(deriveWorkflowPhase('open', null, ALL_ACTIVITY)).toBe('managed');
  });

  it("maps closed status without a review timestamp to 'closed'", () => {
    expect(deriveWorkflowPhase('closed', null, NO_ACTIVITY)).toBe('closed');
    expect(deriveWorkflowPhase('closed', undefined, ALL_ACTIVITY)).toBe('closed');
  });

  it("maps closed status with a review timestamp to 'reviewed'", () => {
    expect(deriveWorkflowPhase('closed', '2026-08-10T12:00:00Z', NO_ACTIVITY)).toBe('reviewed');
  });

  it("passes through 'deleted' status", () => {
    expect(deriveWorkflowPhase('deleted', null, NO_ACTIVITY)).toBe('deleted');
    expect(deriveWorkflowPhase('deleted', '2026-08-10T12:00:00Z', ALL_ACTIVITY)).toBe('deleted');
  });

  it('returns a WorkflowPhase-typed value for every status input', () => {
    const statuses: WorkflowStatus[] = ['planned', 'open', 'closed', 'deleted'];
    const phases: WorkflowPhase[] = statuses.map((s) => deriveWorkflowPhase(s, null, NO_ACTIVITY));
    expect(phases).toEqual(['planned', 'open', 'closed', 'deleted']);
  });
});

describe('hasManagementActivity', () => {
  it('returns all-false for empty inputs', () => {
    expect(hasManagementActivity([], [], [])).toEqual({
      hasAddOrReduceExecution: false,
      hasStopAdjustment: false,
      hasTargetAdjustment: false,
    });
  });

  it('ignores entry/exit executions (buy, sell, buy_to_cover, sell_short)', () => {
    const activity = hasManagementActivity(
      [execution('buy'), execution('sell'), execution('buy_to_cover'), execution('sell_short')],
      [],
      [],
    );
    expect(activity).toEqual({
      hasAddOrReduceExecution: false,
      hasStopAdjustment: false,
      hasTargetAdjustment: false,
    });
  });

  it('flags add executions regardless of position direction', () => {
    expect(hasManagementActivity([execution('add')], [], []).hasAddOrReduceExecution).toBe(true);
  });

  it('flags reduce executions regardless of position direction', () => {
    expect(hasManagementActivity([execution('reduce')], [], []).hasAddOrReduceExecution).toBe(true);
  });

  it('flags add detection even when mixed with entry/exit executions', () => {
    const activity = hasManagementActivity(
      [execution('buy'), execution('add'), execution('sell')],
      [],
      [],
    );
    expect(activity.hasAddOrReduceExecution).toBe(true);
    expect(activity.hasStopAdjustment).toBe(false);
    expect(activity.hasTargetAdjustment).toBe(false);
  });

  it('flags a non-empty stop adjustments array', () => {
    expect(hasManagementActivity([], [{ id: 'a' }, { id: 'b' }], []).hasStopAdjustment).toBe(true);
  });

  it('flags a non-empty target adjustments array', () => {
    expect(hasManagementActivity([], [], [{ id: 'c' }]).hasTargetAdjustment).toBe(true);
  });

  it('defaults omitted array arguments to empty', () => {
    expect(hasManagementActivity()).toEqual({
      hasAddOrReduceExecution: false,
      hasStopAdjustment: false,
      hasTargetAdjustment: false,
    });
  });
});
