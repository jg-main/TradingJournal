/**
 * metrics.ts
 *
 * Pure (no side effects) metrics computation library.
 * Provides named win-rate policies that capture the distinct semantics
 * currently scattered across dashboard.ts, weekly-review.ts, and
 * review-dashboard.ts.
 *
 * All functions are decoupled from Drizzle and trade types — they operate
 * on plain numbers and simple interfaces, making them independently
 * testable without a database.
 *
 * Pattern: src/lib/trade-calc.ts
 */

// ── Win Rate Policies ──────────────────────────────────────────────────

/**
 * Named win-rate policies matching the three distinct denominator rules
 * used across the codebase.
 *
 * - `includeZeroAsLoss`: >0 P&L = win, <=0 P&L = loss (scratches count as losses).
 *   Every input counts as a decision.  Used by Dashboard (D013 convention).
 *
 * - `excludeScratches`:   >0 P&L = win, <0 P&L = loss, P&L === 0 = scratch.
 *   Scratches are excluded from the decision denominator.  Used by Review Dashboard.
 *
 * - `allDecisions`:       >0 P&L = win, <=0 P&L = loss.  Every input counts as a
 *   decision.  Semantically identical to includeZeroAsLoss for the denominator
 *   count; the name emphasises that no trades are filtered at the input layer.
 *   Used by Weekly Review.
 */
export type WinRatePolicy = 'includeZeroAsLoss' | 'excludeScratches' | 'allDecisions';

/**
 * The possible classifications of a single trade P&L outcome.
 *
 * - `win`:    P&L > 0 (profitable trade)
 * - `loss`:   P&L < 0 (losing trade)
 * - `scratch`: P&L === 0 (breakeven — only relevant for excludeScratches policy)
 */
export type PnlDecision = 'win' | 'loss' | 'scratch';

// ── Policy Classification ──────────────────────────────────────────────

/**
 * Classify a single trade's realised P&L according to the given win-rate
 * policy.
 *
 * @param pnl    Total realised P&L (including fees) for a single trade
 * @param policy Named policy governing win/loss/scratch boundaries
 * @returns `'win'`, `'loss'`, or `'scratch'`
 *
 * Policy comparison:
 *
 * | Policy                | win       | loss      | scratch  |
 * |-----------------------|-----------|-----------|----------|
 * | includeZeroAsLoss     | pnl > 0   | pnl <= 0  | —        |
 * | excludeScratches      | pnl > 0   | pnl < 0   | pnl === 0|
 * | allDecisions          | pnl > 0   | pnl <= 0  | —        |
 */
export function classifyPnlDecision(pnl: number, policy: WinRatePolicy): PnlDecision {
  switch (policy) {
    case 'includeZeroAsLoss':
    case 'allDecisions':
      return pnl > 0 ? 'win' : 'loss';
    case 'excludeScratches':
      if (pnl > 0) return 'win';
      if (pnl < 0) return 'loss';
      return 'scratch';
  }
}

// ── Win Rate ───────────────────────────────────────────────────────────

/**
 * Compute the win rate for an array of trade P&L values under a named policy.
 *
 * @param pnls   Array of realised P&L values (one per trade)
 * @param policy Win-rate policy governing win/loss/scratch classification
 * @returns Fraction of winning decisions (0–1), or `null` when no decisions
 *          exist after policy filtering.
 *
 * Example:
 * ```ts
 * computeWinRate([1000, -500, 0], 'includeZeroAsLoss')
 * // => 0.3333  (1 win / 3 decisions; scratch counted as loss)
 *
 * computeWinRate([1000, -500, 0], 'excludeScratches')
 * // => 0.5     (1 win / 2 decisions; scratch excluded)
 *
 * computeWinRate([], 'includeZeroAsLoss')
 * // => null    (no trades)
 * ```
 */
export function computeWinRate(pnls: number[], policy: WinRatePolicy): number | null {
  let wins = 0;
  let decisions = 0;

  for (const pnl of pnls) {
    const d = classifyPnlDecision(pnl, policy);
    if (d === 'win') wins++;
    if (d !== 'scratch') decisions++;
  }

  if (decisions === 0) return null;
  return wins / decisions;
}

// ── Averages ───────────────────────────────────────────────────────────

/**
 * Compute the arithmetic mean of an array of numbers.
 *
 * Returns `null` when the array is empty.
 *
 * @param values Non-null numeric values to average
 * @returns Mean value, or `null` for empty input
 */
export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute the mean R-multiple across an array of pre-computed R-multiple values.
 *
 * Callers should filter out `null` / invalid R-multiples before calling this
 * function (typically by checking `initialRiskAmount > 0` before computing
 * R-multiple via `calculateRMultiple`).
 *
 * Delegates to `average()` — returns `null` for empty input.
 *
 * @param rMultiples Pre-computed R-multiple values (non-null, from valid risk data)
 * @returns Mean R-multiple, or `null` when none provided
 */
export function averageRMultiples(rMultiples: number[]): number | null {
  return average(rMultiples);
}

/**
 * Compute the mean process (grade) score across an array of pre-computed
 * grade scores.
 *
 * Callers should filter out ungraded trades before calling this function.
 *
 * Delegates to `average()` — returns `null` for empty input.
 *
 * @param scores Pre-computed grade totalScore values (non-null)
 * @returns Mean process score, or `null` when none provided
 */
export function averageProcessScore(scores: number[]): number | null {
  return average(scores);
}
