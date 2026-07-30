import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildAssessmentPrompt, type GatheredTradeData } from '@/lib/assessment-engine';
import { trades, tradeExecutions } from '@/db/schema';

// ── Request Validation ───────────────────────────────────────────────────

const requestSchema = z.object({
  systemPrompt: z.string().optional(),
  assessmentType: z.enum(['ai_quality', 'ai_review']).default('ai_quality'),
});

// ── Static Sample Data ───────────────────────────────────────────────────

/**
 * Build a static GatheredTradeData for prompt preview purposes.
 *
 * The trade and execution objects are cast because Drizzle $inferSelect types
 * carry ORM-internal properties. The casts are safe: buildAssessmentPrompt()
 * only accesses documented fields.
 *
 * @param assessmentType - Controls whether executions are populated
 * @returns GatheredTradeData matching a realistic sample trade
 */
function buildSampleTradeData(
  assessmentType: 'ai_quality' | 'ai_review',
): GatheredTradeData {
  const now = '2024-06-10T08:00:00.000Z';

  // ── Base trade (shared fields) ────────────────────────────────
  const isPostExit = assessmentType === 'ai_review';

  const sampleTrade = {
    id: '00000000-0000-0000-0000-000000000001',
    tradeCode: 'SAMPLE-001',
    accountId: '00000000-0000-0000-0000-000000000002',
    symbol: 'AAPL',
    direction: 'long',
    sectorId: null as string | null,
    setupId: 'set-00000000-0000-0000-0000-000000000001',
    marketConditionId: null as string | null,
    status: isPostExit ? 'closed' : 'planned',
    plannedEntry: 150,
    plannedStop: 145,
    plannedTarget1: 170,
    plannedTarget2: null as number | null,
    plannedQuantity: 100,
    thesis: 'Bullish breakout above resistance with above-average volume confirmation',
    invalidationCondition: 'Close below 145 support level',
    preTradePlan:
      'Wait for confirmation candle above 150.50 on above-average volume. Enter on retest of the breakthrough level.',
    openedAt: isPostExit ? '2024-06-10T09:30:00.000Z' : null,
    closedAt: isPostExit ? '2024-06-10T14:45:00.000Z' : null,
    exitNotes: isPostExit ? 'Target 1 hit. Solid execution managing position to plan.' : null,
    lesson: isPostExit ? 'Patience at the trigger paid off — wait for the confirmation candle next time too.' : null,
    grossRealizedPnl: null,
    netRealizedPnl: null,
    realizedFees: null,
    currentPrice: null,
    currentPriceFetchedAt: null,
    createdAt: now,
    updatedAt: now,
  } satisfies typeof trades.$inferSelect;

  // ── Executions ────────────────────────────────────────────────
  const sampleExecutions = isPostExit
    ? [
        {
          id: 'exec-00000000-0000-0000-0000-000000000001',
          tradeId: sampleTrade.id,
          executedAt: '2024-06-10T09:31:00.000Z',
          action: 'buy',
          quantity: 100,
          price: 150.25,
          fees: 1.5,
          reasonId: null as string | null,
          notes: null as string | null,
          createdAt: now,
        } satisfies typeof tradeExecutions.$inferSelect,
        {
          id: 'exec-00000000-0000-0000-0000-000000000002',
          tradeId: sampleTrade.id,
          executedAt: '2024-06-10T14:45:00.000Z',
          action: 'sell',
          quantity: 100,
          price: 162.5,
          fees: 1.5,
          reasonId: null as string | null,
          notes: 'Target 1 filled cleanly',
          createdAt: now,
        } satisfies typeof tradeExecutions.$inferSelect,
      ]
    : ([] as typeof tradeExecutions.$inferSelect[]);

  // ── Evaluation fields ─────────────────────────────────────────
  const evaluationFields: GatheredTradeData['evaluationFields'] = [
    {
      fieldKey: 'followed_plan',
      label: 'Followed the Plan',
      description: 'Did the trader execute according to their pre-trade plan?',
      fieldType: 'boolean',
      weight: 1.0,
      minLookbackDays: null,
    },
    {
      fieldKey: 'entry_discipline',
      label: 'Entry Discipline',
      description: 'How well did the trader wait for their defined entry criteria?',
      fieldType: 'score_1_5',
      weight: 0.8,
      minLookbackDays: 10,
    },
  ];

  return {
    trade: sampleTrade,
    executions: sampleExecutions,
    evaluationFields,
    setupName: 'Momentum Breakout',
    analysisConfig: null,
    checklistItems: null,
    marketEvidence: null,
    featureTimeSeries: null,
    warnings: ['Static sample trade for prompt preview'],
  };
}

// ── POST Handler ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const { systemPrompt, assessmentType } = parsed.data;

    // Log request metadata (assessmentType only — no trade data)
    console.log(
      JSON.stringify({
        event: 'prompt_preview_request',
        assessmentType,
      }),
    );

    const data = buildSampleTradeData(assessmentType);
    const result = buildAssessmentPrompt(data, {
      assessmentType,
      systemPrompt,
      // Passing empty string to systemPrompt override is intentional:
      // the user may have an empty custom prompt which should override the
      // DB default for preview purposes.
      ...(systemPrompt !== undefined && { systemPrompt }),
    });

    return NextResponse.json({
      systemMessage: result.systemMessage,
      userMessage: result.userMessage,
      sectionCount: result.sectionCount,
      totalChars: result.totalChars,
    });
  } catch (error) {
    console.error('Failed to build prompt preview:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate prompt preview',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
