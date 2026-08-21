/**
 * Ledger route helpers.
 *
 * Utilities used by the GET /api/accounts/[id]/ledger route to compose
 * ledger projection input from multiple repository calls. The main
 * challenge is resolving correction-lineage execution IDs to their
 * corresponding financial event IDs — stored in the event payload
 * (for reversal/replacement) or matching by description (for the
 * original execution).
 *
 * Pure repository-composition functions. No domain logic, no validation.
 */

import Database from 'better-sqlite3';
import type { CorrectionGroupInput } from './ledger';
import type { CorrectionLineageRow } from '../../db/accounting-repository';
import { listFinancialEventCorrectionsByAccount } from '../../db/accounting-repository';

/**
 * Resolve a single correction lineage row to a CorrectionGroupInput with
 * financial-event-level identities.
 *
 * Strategy:
 * - Reversal event: matched by `correctionType:"reversal"` and
 *   `originalExecutionId` in the JSON payload column.
 * - Replacement event: matched by `correctionType:"replacement"` and
 *   `originalExecutionId` in the JSON payload column.
 * - Original event: matched by the most recent `trade_execution` event
 *   for the account whose description matches the original execution's
 *   description.
 *
 * Returns null when the original event cannot be resolved (the correction
 * group will be silently skipped by the adapter).
 *
 * @param sqlite     - Raw SQLite handle.
 * @param correction - A correction lineage row from listCorrectionsByAccount.
 * @param accountId  - The account ID for scoping.
 * @param originalExecDescription - The description of the original execution.
 * @returns CorrectionGroupInput with resolved event IDs, or null.
 */
export function resolveCorrectionGroup(
  sqlite: Database.Database,
  correction: CorrectionLineageRow,
  accountId: string,
  originalExecDescription: string | null,
): CorrectionGroupInput | null {
  const { id: correctionLineageId } = correction;

  // 1. Resolve reversal event by payload content
  //    reversal payload: {"correctionType":"reversal","originalExecutionId":"<origId>",...}
  const reversalEvent = sqlite
    .prepare(
      `SELECT id FROM financial_events
       WHERE account_id = ?
         AND event_type = 'trade_execution'
         AND payload IS NOT NULL
         AND payload LIKE '%"correctionType":"reversal"%'
         AND payload LIKE ?
       ORDER BY posted_at DESC, id ASC
       LIMIT 1`,
    )
    .get(accountId, `%"originalExecutionId":"${correction.original_execution_id}"%`) as
    { id: string } | undefined;

  // 2. Resolve replacement event by payload content
  const replacementEvent = sqlite
    .prepare(
      `SELECT id FROM financial_events
       WHERE account_id = ?
         AND event_type = 'trade_execution'
         AND payload IS NOT NULL
         AND payload LIKE '%"correctionType":"replacement"%'
         AND payload LIKE ?
       ORDER BY posted_at DESC, id ASC
       LIMIT 1`,
    )
    .get(accountId, `%"originalExecutionId":"${correction.original_execution_id}"%`) as
    { id: string } | undefined;

  // 3. Resolve original event by description match
  //    The original execution's financial event shares the same description
  //    (set by postExecutionFill).  Fallback: look for the most recent
  //    trade_execution event for the account that was posted before the
  //    correction timestamp.
  let originalEventId: string | null = null;

  if (originalExecDescription) {
    const origByDesc = sqlite
      .prepare(
        `SELECT fe.id FROM financial_events fe
         WHERE fe.account_id = ?
           AND fe.event_type = 'trade_execution'
           AND fe.description = ?
         ORDER BY fe.posted_at DESC, fe.id ASC
         LIMIT 1`,
      )
      .get(accountId, originalExecDescription) as { id: string } | undefined;
    if (origByDesc) {
      originalEventId = origByDesc.id;
    }
  }

  // Fallback: if description match failed, look for the most recent
  // trade_execution event before the correction timestamp
  if (!originalEventId) {
    const origByTime = sqlite
      .prepare(
        `SELECT fe.id FROM financial_events fe
         WHERE fe.account_id = ?
           AND fe.event_type = 'trade_execution'
           AND fe.posted_at < ?
         ORDER BY fe.posted_at DESC, fe.id ASC
         LIMIT 1`,
      )
      .get(accountId, correction.corrected_at) as { id: string } | undefined;
    if (origByTime) {
      originalEventId = origByTime.id;
    }
  }

  if (!originalEventId) {
    // Cannot resolve — adapter will skip this correction group
    return null;
  }

  // Use the original event ID as a fallback for unresolvable reversal/replacement
  return {
    correctionId: correctionLineageId,
    originalEventId,
    reversalEventId: (reversalEvent?.id) ?? originalEventId,
    replacementEventId: (replacementEvent?.id) ?? originalEventId,
    reason: correction.reason,
    correctedAt: correction.corrected_at,
  };
}

/**
 * Resolve all correction lineage rows for an account to a list of
 * CorrectionGroupInput values.
 *
 * Each correction group carries financial-event-level IDs that the
 * ledger adapter can consume directly.
 *
 * @param sqlite    - Raw SQLite handle.
 * @param accountId - The account ID.
 * @returns Array of resolved CorrectionGroupInput (unresolvable groups skipped).
 */
export function resolveCorrectionGroupsForAccount(
  sqlite: Database.Database,
  accountId: string,
): CorrectionGroupInput[] {
  const corrections = sqlite
    .prepare(
      `SELECT cl.id, cl.account_id, cl.original_execution_id, cl.reversal_execution_id,
              cl.replacement_execution_id, cl.idempotency_key, cl.reason,
              cl.corrected_at, cl.created_at
       FROM correction_lineage cl
       WHERE cl.account_id = ?
       ORDER BY cl.corrected_at DESC, cl.id ASC`,
    )
    .all(accountId) as CorrectionLineageRow[];

  if (corrections.length === 0) return [];

  const results: CorrectionGroupInput[] = [];

  for (const correction of corrections) {
    // Look up the original execution to get its description
    const execData = sqlite
      .prepare(
        `SELECT description FROM accounting_executions WHERE id = ?`,
      )
      .get(correction.original_execution_id) as { description: string | null } | undefined;

    const resolved = resolveCorrectionGroup(
      sqlite,
      correction,
      accountId,
      execData?.description ?? null,
    );
    if (resolved) {
      results.push(resolved);
    }
  }

  return results;
}

/**
 * Resolve all financial event correction lineage rows for an account to a
 * list of CorrectionGroupInput values.
 *
 * Unlike execution corrections, financial event corrections store the
 * financial event IDs directly on the lineage row — no payload matching is
 * required. Each row maps 1:1 to a CorrectionGroupInput that the ledger
 * projection consumes directly.
 *
 * @param sqlite    - Raw SQLite handle.
 * @param accountId - The account ID.
 * @returns Array of CorrectionGroupInput (never null — rows are fully resolved).
 */
export function resolveFinancialEventCorrectionGroupsForAccount(
  sqlite: Database.Database,
  accountId: string,
): CorrectionGroupInput[] {
  const corrections = listFinancialEventCorrectionsByAccount(sqlite, accountId);

  return corrections.map((correction) => ({
    correctionId: correction.id,
    originalEventId: correction.original_event_id,
    reversalEventId: correction.reversal_event_id,
    replacementEventId: correction.replacement_event_id,
    reason: correction.reason,
    correctedAt: correction.corrected_at,
  }));
}
