import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { z } from 'zod';
import { computePlannedRiskAmount } from '@/lib/planned-risk';
import { computeExecutionContext } from '@/lib/execution-context';
import { resolveEffectiveExecutionConfig } from '@/lib/execution-config';

/**
 * GET /api/trades/planned-risk-preview
 *
 * Deterministic planned-risk preview with account context (S02/T05).
 *
 * Returns the canonical direction-aware planned risk (computePlannedRiskAmount,
 * R021) plus the account-relative risk percentage (riskDollar / equityAtOpen)
 * so the Plan Trade form can show "X.XX% of account equity" — the metric that
 * matters for a risk-first trading workstation. Equity-at-open and the
 * max-risk threshold come from the same canonical execution context the
 * execution-readiness gate uses (T04), so the preview and the eventual first
 * fill agree on the numbers.
 *
 * Query params: accountId (required), direction, entry, stop, target1, quantity.
 *
 * Response: { riskDollar, riskPct, accountRiskPct, rewardDollar, rewardPct,
 *   riskRewardRatio, equityAtOpen, maxRiskPerTradePct, maxRiskExceeded }.
 *
 * D1 null-not-zero contract: riskDollar and accountRiskPct are null (never 0)
 * when the stop is missing or sits on the wrong side of the entry; accountRiskPct
 * is also null when equity-at-open cannot be determined. maxRiskExceeded is only
 * true when both accountRiskPct and a threshold are known.
 */

const previewQuerySchema = z.object({
  accountId: z.string().min(1),
  direction: z.enum(['long', 'short']).default('long'),
  entry: z.coerce.number().positive().optional(),
  stop: z.coerce.number().positive().optional(),
  target1: z.coerce.number().positive().optional(),
  quantity: z.coerce.number().positive().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = previewQuerySchema.safeParse(params);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { accountId, direction, entry, stop, target1, quantity } = parsed.data;

    // Canonical account + settings + equity-at-open resolution (T04 path,
    // A2). computeExecutionContext delegates equity to the shared
    // resolveExecutionEquityContext so the preview uses the SAME canonical
    // pre-fill equity (with provenance) as first-fill readiness and the
    // persisted risk snapshot.
    const context = computeExecutionContext(db, getSqliteHandle(), accountId, new Date().toISOString());
    const account = context.account;
    const settings = context.globalSettings;

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Direction-aware dollar risk (R021) — null when the stop is missing,
    // wrong-side, or quantity is absent. This is the D1 null-not-zero source.
    const riskDollar = computePlannedRiskAmount(direction, entry, stop, quantity);

    // Risk as a percentage of entry price (price-based, quantity-independent,
    // matching the form's existing "Max Risk" preview semantics). Null when the
    // stop is missing or on the wrong side — never a misleading negative.
    let riskPct: number | null = null;
    if (entry != null && entry > 0 && stop != null && stop > 0) {
      const perUnit = direction === 'long' ? entry - stop : stop - entry;
      if (perUnit > 0) riskPct = (perUnit / entry) * 100;
    }

    // Reward as a percentage of entry price (quantity-independent).
    let rewardPct: number | null = null;
    if (entry != null && entry > 0 && target1 != null && target1 > 0) {
      const perUnit = direction === 'long' ? target1 - entry : entry - target1;
      if (perUnit > 0) rewardPct = (perUnit / entry) * 100;
    }

    let rewardDollar: number | null = null;
    if (rewardPct != null && entry != null && quantity != null && quantity > 0) {
      rewardDollar = (rewardPct / 100) * entry * quantity;
    }

    const riskRewardRatio =
      riskPct != null && rewardPct != null && riskPct > 0
        ? rewardPct / riskPct
        : null;

    const equityAtOpen = context.equityAtOpen;

    // Account-relative risk (D1): null when equity is unknown/non-positive or
    // the dollar risk is invalid — never a fabricated 0.
    const accountRiskPct =
      equityAtOpen != null && equityAtOpen > 0 && riskDollar != null
        ? (riskDollar / equityAtOpen) * 100
        : null;

    // Effective max risk (A1): shared canonical resolver — account override →
    // global default → unavailable — so the preview and the execution
    // readiness gate / engine agree on the same threshold for the same
    // account/settings state.
    const effective = resolveEffectiveExecutionConfig({
      account: {
        maxRiskPerTradePct: account.maxRiskPerTradePct,
        defaultCommission: account.defaultCommission,
      },
      settings: {
        maxRiskPerTradePct: settings?.maxRiskPerTradePct ?? null,
        defaultCommission: settings?.defaultCommission ?? null,
      },
    });
    const maxRiskPerTradePct = effective.maxRiskPerTradePct;

    const maxRiskExceeded =
      accountRiskPct != null &&
      maxRiskPerTradePct != null &&
      accountRiskPct > maxRiskPerTradePct;

    return NextResponse.json({
      riskDollar,
      riskPct,
      accountRiskPct,
      rewardDollar,
      rewardPct,
      riskRewardRatio,
      equityAtOpen,
      equitySource: context.equitySource,
      equityAsOf: context.equityAsOf,
      maxRiskPerTradePct,
      maxRiskExceeded,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to compute planned risk preview',
        details: String(error),
      },
      { status: 500 },
    );
  }
}
