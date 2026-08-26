/**
 * trade-execution-idempotency.ts
 *
 * Deterministic accounting idempotency key semantics for journal trade
 * executions.
 *
 * The accounting execution row created for a persisted journal execution
 * uses the stable key `trade-execution-<journalExecutionId>`. The canonical
 * execution engine (executeTradeFill), idempotent replay reconstruction,
 * and execution-correction lookup all derive that key from THIS builder so
 * the format can never drift between writer and readers.
 *
 * Pure module: no DB imports, no accounting writes, no FIFO rebuilds, no
 * logging, no transactions, no NextResponse, no fail-open behavior. Safe for
 * both the canonical execution engine and correction/replay readers.
 */

/**
 * Build the accounting idempotency key for a journal trade execution.
 *
 * The key namespaces the original trade execution ID so it cannot collide
 * with idempotency keys from other domains (e.g. financial events).
 *
 * The format is historical and MUST NOT change: existing
 * accounting_executions rows already use `trade-execution-<executionId>`,
 * and correction/replay must continue finding them (no key migration).
 *
 * @param tradeExecutionId Persisted journal execution ID.
 * @returns Stable idempotency key, e.g. `trade-execution-abc`.
 */
export function tradeExecutionIdempotencyKey(tradeExecutionId: string): string {
  return `trade-execution-${tradeExecutionId}`;
}
