/**
 * assessment-engine.ts
 *
 * Core orchestrator for AI-powered trade quality assessment.
 *
 * Composes S01 (scorecard schemas), S02 (ClickHouse market data), and S03
 * (AI provider) into a complete pipeline: gather trade data -> resolve
 * evaluation fields -> collect market evidence -> build prompt -> call AI ->
 * parse scorecard -> persist snapshot.
 *
 * Uses optional dependency injection for ClickHouse and AI provider so
 * route tests can verify the full pipeline with mocked backends.
 *
 * Pattern: src/lib/trade-calc.ts (pure-ish -- async + DB reads)
 */

import { db } from '@/db';
import {
  trades,
  tradeExecutions,
  lookupValues,
  setupDefinitions,
  playEvaluationFields,
  aiSettings,
  tradeAssessmentSnapshots,
} from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  parseScorecard,
  type Scorecard,
  type AssessmentType,
} from './scorecard';
import {
  createDefaultClickHouseClient,
  type MarketEvidence,
  type FreshnessCheck,
} from './clickhouse-client';
import {
  createAiProvider,
  AiProviderError,
  type AiProvider,
  type AiProviderConfig,
} from './ai-provider';

// ── Error Codes ──────────────────────────────────────────────────────────

export const AssessmentErrorCode = {
  TRADE_NOT_FOUND: 'TRADE_NOT_FOUND',
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  CLICKHOUSE_ERROR: 'CLICKHOUSE_ERROR',
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  SCORECARD_PARSE_ERROR: 'SCORECARD_PARSE_ERROR',
  MISSING_MARKET_DATA: 'MISSING_MARKET_DATA',
  STALE_MARKET_DATA: 'STALE_MARKET_DATA',
} as const;

export type AssessmentErrorCode =
  (typeof AssessmentErrorCode)[keyof typeof AssessmentErrorCode];

// ── Typed Error ──────────────────────────────────────────────────────────

/**
 * Typed error for assessment pipeline failures.
 *
 * Carries a machine-readable error code and the affected tradeId so
 * callers can branch programmatically and log diagnostics.
 */
export class AssessmentError extends Error {
  public readonly code: AssessmentErrorCode;
  public readonly tradeId: string;

  constructor(code: AssessmentErrorCode, tradeId: string, message: string) {
    super(message);
    this.name = 'AssessmentError';
    this.code = code;
    this.tradeId = tradeId;
  }
}

// ── Optional Dependency Interface ────────────────────────────────────────

/**
 * Optional dependency injection for the assessment engine.
 *
 * When omitted, the engine instantiates default clients (real ClickHouse
 * connection via env vars, real AI provider via the active ai_settings row).
 * Tests provide mocked implementations.
 */
export interface AssessmentDeps {
  clickhouseClient?: {
    getMarketEvidence(query: {
      symbol: string;
      startDate: string;
      endDate: string;
    }): Promise<MarketEvidence>;
    checkFreshness(thresholdDays?: number): Promise<FreshnessCheck>;
  };
  aiProvider?: AiProvider;
}

// ── Result Types ─────────────────────────────────────────────────────────

/**
 * Successful assessment result with validated scorecard and persistence metadata.
 */
export interface AssessmentResult {
  /** Parsed and validated scorecard */
  scorecard: Scorecard;
  /** Snapshot persistence metadata */
  snapshot: {
    id: string;
    assessedAt: string;
    modelUsed?: string;
    promptTokens?: number;
    completionTokens?: number;
    promptText?: string | null;
    rawResponse?: string | null;
  };
  /** Non-fatal warnings gathered during the pipeline */
  warnings: string[];
}

// ── Gathered Trade Data ──────────────────────────────────────────────────

/**
 * Full trade data bundle assembled for the AI prompt.
 *
 * Combines the trade row, its executions, resolved evaluation fields,
 * setup name, and optional market evidence into a single structure.
 * Market evidence is populated by performAssessment after the initial
 * gather step.
 */
export interface GatheredTradeData {
  trade: typeof trades.$inferSelect;
  executions: typeof tradeExecutions.$inferSelect[];
  evaluationFields: Array<{
    fieldKey: string;
    label: string;
    description: string | null;
    fieldType: string;
    weight: number | null;
    minLookbackDays: number | null;
  }>;
  setupName: string | null;
  marketEvidence: MarketEvidence | null;
  warnings: string[];
}

// ── AI Config Resolver ────────────────────────────────────────────────────

/**
 * Read the active AI settings row and map it to AiProviderConfig.
 *
 * Returns null if no active ai_settings row exists.
 */
function readActiveAiConfig(): AiProviderConfig | null {
  const setting = db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.isActive, true))
    .get();

  if (!setting) return null;

  return {
    provider: setting.provider,
    model: (setting.model ?? '').trim(),
    apiKey: setting.apiKey ?? undefined,
    baseUrl: setting.baseUrl ?? undefined,
    timeoutMs: setting.timeoutMs ?? undefined,
    temperature: setting.temperature ?? undefined,
    maxTokens: setting.maxTokens ?? undefined,
  };
}

/**
 * Read the active AI system prompt from the DB, or return the fallback default.
 */
function readSystemPrompt(): string {
  const config = readActiveAiConfig();
  if (config) {
    const setting = db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.isActive, true))
      .get();
    if (setting?.systemPrompt) return setting.systemPrompt;
  }
  return [
    'You are an expert trade quality assessor. Analyze the provided trade data',
    'and produce a structured scorecard evaluating the trader\'s process',
    'adherence, risk management, and execution quality. Be objective and',
    'evidence-based.',
  ].join(' ');
}

// ── gatherTradeData ──────────────────────────────────────────────────────

/**
 * Gather all trade data needed for an assessment from the local database.
 *
 * Queries the trades row, trade_executions, resolves evaluation fields via
 * the setupId bridge (lookupValues -> setupDefinitions -> playEvaluationFields),
 * and populates warnings for missing data.
 *
 * Market evidence is NOT fetched here -- the orchestrator (performAssessment)
 * queries ClickHouse separately and attaches the result.
 *
 * Logs gather_trade_data with tradeId, symbol, executionCount, evaluationFieldCount.
 *
 * @param tradeId - Trade UUID to gather data for
 * @returns GatheredTradeData with marketEvidence set to null
 * @throws AssessmentError with TRADE_NOT_FOUND if the trade does not exist
 */
export async function gatherTradeData(
  tradeId: string,
): Promise<GatheredTradeData> {
  // Step 1: Fetch trade
  const trade = db
    .select()
    .from(trades)
    .where(eq(trades.id, tradeId))
    .get();

  if (!trade) {
    throw new AssessmentError(
      AssessmentErrorCode.TRADE_NOT_FOUND,
      tradeId,
      `Trade ${tradeId} not found`,
    );
  }

  // Step 2: Fetch executions
  const executions = db
    .select()
    .from(tradeExecutions)
    .where(eq(tradeExecutions.tradeId, tradeId))
    .orderBy(tradeExecutions.executedAt, tradeExecutions.createdAt)
    .all();

  // Step 3: Resolve evaluation fields via setupId bridge
  let setupName: string | null = null;
  const evaluationFields: GatheredTradeData['evaluationFields'] = [];

  if (trade.setupId) {
    // 3a. Query lookupValues to get the setup name from the setup ID
    const lookupVal = db
      .select()
      .from(lookupValues)
      .where(
        and(
          eq(lookupValues.id, trade.setupId),
          eq(lookupValues.type, 'setup'),
        ),
      )
      .get();

    if (lookupVal) {
      // 3b. Match to setupDefinitions by ID (same UUID per the bridge pattern)
      const setupDef = db
        .select()
        .from(setupDefinitions)
        .where(eq(setupDefinitions.id, lookupVal.id))
        .get();

      // Use setupDefinitions.name for display (original case); fall back to lookupValues.value
      if (setupDef) {
        setupName = setupDef.name;

        // 3c. Query playEvaluationFields by setupDefinitionId
        const fields = db
          .select()
          .from(playEvaluationFields)
          .where(
            and(
              eq(playEvaluationFields.setupDefinitionId, setupDef.id),
              eq(playEvaluationFields.isActive, true),
            ),
          )
          .orderBy(playEvaluationFields.sortOrder)
          .all();

        for (const f of fields) {
          evaluationFields.push({
            fieldKey: f.fieldKey,
            label: f.label,
            description: f.description,
            fieldType: f.fieldType,
            weight: f.weight,
            minLookbackDays: f.minLookbackDays,
          });
        }
      } else {
        // No setupDefinition found — use lookupValues value as fallback
        setupName = lookupVal.value;
      }
    }
  }

  // Step 4: Build warnings for missing sections
  const warnings: string[] = [];
  if (!trade.symbol) {
    warnings.push('Trade has no symbol - market evidence will be unavailable');
  }
  if (!trade.setupId) {
    warnings.push('Trade has no setup - play evaluation fields will be unavailable');
  }

  console.log(
    JSON.stringify({
      event: 'gather_trade_data',
      tradeId,
      symbol: trade.symbol,
      executionCount: executions.length,
      evaluationFieldCount: evaluationFields.length,
    }),
  );

  return {
    trade,
    executions,
    evaluationFields,
    setupName,
    marketEvidence: null,
    warnings,
  };
}

// ── buildAssessmentPrompt ────────────────────────────────────────────────

/**
 * Build a structured assessment prompt from gathered trade data.
 *
 * Constructs sections: TRADE DETAILS, EXECUTION RECORD, PLAY/SETUP CONTEXT,
 * MARKET EVIDENCE, OUTPUT FORMAT INSTRUCTIONS.
 *
 * The system message is read from the active ai_settings.systemPrompt in the
 * database, or a sensible default is used. The user message is built from
 * the gathered data sections.
 *
 * Logs prompt_built with sectionCount and totalChars (never logs prompt content).
 *
 * @param data - Gathered trade data
 * @param options - Optional assessment type and system prompt override
 * @returns Object with systemMessage, userMessage, sectionCount, totalChars
 */
export function buildAssessmentPrompt(
  data: GatheredTradeData,
  options?: { assessmentType?: AssessmentType; systemPrompt?: string },
): {
  systemMessage: string;
  userMessage: string;
  sectionCount: number;
  totalChars: number;
} {
  const assessmentType = options?.assessmentType ?? 'ai_quality';
  const parts: string[] = [];
  let sectionCount = 0;

  // ── Section 1: TRADE DETAILS ───────────────────────────────────────
  {
    const t = data.trade;
    const lines: string[] = ['## TRADE DETAILS', ''];
    lines.push(`Symbol: ${t.symbol || 'N/A'}`);
    lines.push(`Direction: ${t.direction}`);
    lines.push(`Status: ${t.status}`);
    lines.push(`Planned Entry: ${t.plannedEntry ?? 'N/A'}`);
    lines.push(`Planned Stop: ${t.plannedStop ?? 'N/A'}`);
    lines.push(
      `Planned Targets: ${[t.plannedTarget1, t.plannedTarget2].filter(Boolean).join(', ') || 'N/A'}`,
    );
    lines.push(`Thesis: ${t.thesis || 'N/A'}`);
    lines.push(`Invalidation Condition: ${t.invalidationCondition || 'N/A'}`);
    lines.push(`Pre-Trade Plan: ${t.preTradePlan || 'N/A'}`);
    parts.push(lines.join('\n'));
    sectionCount++;
  }

  // ── Section 2: EXECUTION RECORD ─────────────────────────────────────
  {
    const lines: string[] = ['## EXECUTION RECORD', ''];
    if (data.executions.length === 0) {
      lines.push('No executions recorded for this trade.');
    } else {
      for (const exec of data.executions) {
        lines.push(
          `- Action: ${exec.action} | Qty: ${exec.quantity} | Price: ${exec.price} | Date: ${exec.executedAt || exec.createdAt || 'N/A'}`,
        );
      }
    }
    parts.push(lines.join('\n'));
    sectionCount++;
  }

  // ── Section 3: PLAY/SETUP CONTEXT ──────────────────────────────────
  {
    const lines: string[] = ['## PLAY/SETUP CONTEXT', ''];
    if (data.setupName) {
      lines.push(`Setup: ${data.setupName}`);
    } else {
      lines.push('No setup configured for this trade.');
    }

    if (data.evaluationFields.length > 0) {
      lines.push('');
      lines.push('Evaluation Fields:');
      for (const field of data.evaluationFields) {
        lines.push(
          `- ${field.label} (${field.fieldKey}): ${field.description || 'No description'} -- Type: ${field.fieldType}${field.weight != null ? `, Weight: ${field.weight}` : ''}`,
        );
      }
    } else {
      lines.push('');
      lines.push('No evaluation fields defined for this setup.');
    }
    parts.push(lines.join('\n'));
    sectionCount++;
  }

  // ── Section 4: MARKET EVIDENCE ─────────────────────────────────────
  {
    const lines: string[] = ['## MARKET EVIDENCE', ''];
    if (data.marketEvidence && data.marketEvidence.ohlc.length > 0) {
      const ev = data.marketEvidence;
      const firstBar = ev.ohlc[0];
      const lastBar = ev.ohlc[ev.ohlc.length - 1];
      lines.push(`Symbol: ${ev.symbol}`);
      lines.push(`Bars: ${ev.ohlc.length}`);
      lines.push(`Date Range: ${firstBar.date} to ${lastBar.date}`);
      lines.push(`First Close: ${firstBar.close}`);
      lines.push(`Last Close: ${lastBar.close}`);
      const high = Math.max(...ev.ohlc.map((b) => b.high));
      const low = Math.min(...ev.ohlc.map((b) => b.low));
      lines.push(`High: ${high}`);
      lines.push(`Low: ${low}`);
      lines.push(`Range: ${(high - low).toFixed(2)}`);
      if (ev.notes.length > 0) {
        lines.push(`Notes: ${ev.notes.join('; ')}`);
      }
    } else if (data.marketEvidence && data.marketEvidence.error) {
      lines.push(`Market data error: ${data.marketEvidence.error}`);
    } else {
      lines.push('No market data available.');
    }
    parts.push(lines.join('\n'));
    sectionCount++;
  }

  // ── Section 5: OUTPUT FORMAT INSTRUCTIONS ──────────────────────────
  {
    const lines: string[] = ['## OUTPUT FORMAT INSTRUCTIONS', ''];
    lines.push(
      'Respond with a valid JSON object matching the schema below (no markdown, no code fences):',
    );
    lines.push('{');
    lines.push('  "assessmentType": "ai_quality" | "ai_review",');
    lines.push('  "dimensions": [');
    lines.push('    {');
    lines.push('      "key": "string (dimension identifier, e.g. setup, risk, entry)",');
    lines.push('      "label": "string (human-readable label, max 100 chars)",');
    lines.push('      "score": "integer 1-10",');
    lines.push('      "notes": "optional string (max 500 chars)"');
    lines.push('    }');
    lines.push('  ],');
    lines.push('  "evaluations": [');
    lines.push('    {');
    lines.push('      "fieldKey": "string",');
    lines.push('      "label": "string",');
    lines.push('      "fieldType": "boolean" | "score_1_5" | "score_1_10" | "text",');
    lines.push('      "value": "boolean | number | string",');
    lines.push('      "weight": "number 0-1 (default 1)"');
    lines.push('    }');
    lines.push('  ],');
    lines.push('  "overallScore": "number 0-100",');
    lines.push('  "gradeLabel": "single character A-F",');
    lines.push('  "summary": "optional string (max 2000 chars)"');
    lines.push('}');
    lines.push('');
    lines.push(`Assessment type for this request: ${assessmentType}`);
    lines.push('');
    lines.push(
      'Evaluate the quality of the trade based on the provided data. Consider: setup quality, risk management, entry execution, trade management, exit execution, and overall process discipline.',
    );
    parts.push(lines.join('\n'));
    sectionCount++;
  }

  const userMessage = parts.join('\n\n');

  // Build system message: use override, DB prompt, or default
  const systemPromptBody =
    options?.systemPrompt ?? readSystemPrompt();
  const systemMessage = `${systemPromptBody}\n\nYou must respond with valid JSON only.`;

  const totalChars = systemMessage.length + userMessage.length;

  console.log(
    JSON.stringify({
      event: 'prompt_built',
      sectionCount,
      totalChars,
    }),
  );

  return { systemMessage, userMessage, sectionCount, totalChars };
}

// ── Date Range Derivation ───────────────────────────────────────────────

/**
 * Derive a market evidence date range from a trade's open/created dates.
 *
 * Uses openedAt (or createdAt if not yet opened) and expands to a reasonable
 * window: ~30 trading days before the reference date to 5 days after.
 *
 * Returns { startDate, endDate } in YYYY-MM-DD format, or null if the trade
 * has no usable date.
 */
function deriveDateRange(
  trade: typeof trades.$inferSelect,
  lookbackDays?: number,
): { startDate: string; endDate: string } | null {
  const refDate = trade.openedAt ?? trade.createdAt;
  if (!refDate) return null;

  // Extract YYYY-MM-DD from ISO string
  const refDay = refDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(refDay)) return null;

  const ref = new Date(refDay);
  const days = lookbackDays ?? 45;
  const start = new Date(ref);
  start.setDate(start.getDate() - days);

  const end = new Date(ref);
  end.setDate(end.getDate() + 5);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

// ── performAssessment ────────────────────────────────────────────────────

/**
 * Execute the full AI assessment pipeline for a trade.
 *
 * Pipeline stages:
 *   1. gatherTradeData -- DB queries for trade + executions + evaluation fields
 *   2. Market evidence -- query ClickHouse for OHLC data (when symbol available)
 *   3. Build prompt -- construct structured system + user messages
 *   4. AI call -- invoke provider with response_format json_object
 *   5. Parse scorecard -- validate AI response against ScorecardSchema
 *   6. Persist snapshot -- insert into trade_assessment_snapshots
 *   7. Return AssessmentResult
 *
 * Structured logging per pipeline stage:
 *   engine_start       -> tradeId, assessmentType
 *   gather_trade_data  -> tradeId, symbol, executionCount, evaluationFieldCount
 *   market_evidence    -> symbol, barCount, hasError
 *   prompt_built       -> sectionCount, totalChars
 *   ai_call            -> model, durationMs (on success)
 *   scorecard_parsed   -> overallScore, gradeLabel, dimensionCount
 *   snapshot_saved     -> snapshotId, tradeId
 * All errors logged with tradeId and error code.
 *
 * @param tradeId  - Trade UUID to assess
 * @param deps     - Optional dependency injection (tests provide mocks)
 * @param options  - Optional parameters (assessmentType)
 * @returns        AssessmentResult with validated scorecard and snapshot metadata
 * @throws         AssessmentError with typed error codes on failure
 */
export async function performAssessment(
  tradeId: string,
  deps?: AssessmentDeps,
  options?: { assessmentType?: AssessmentType },
): Promise<AssessmentResult> {
  const assessmentType = options?.assessmentType ?? 'ai_quality';
  const warnings: string[] = [];

  console.log(
    JSON.stringify({
      event: 'engine_start',
      tradeId,
      assessmentType,
    }),
  );

  // ── Step 0: Resolve default clients when deps omitted ────────────
  let aiProvider: AiProvider;
  if (deps?.aiProvider) {
    aiProvider = deps.aiProvider;
  } else {
    const aiConfig = readActiveAiConfig();
    if (!aiConfig) {
      throw new AssessmentError(
        AssessmentErrorCode.AI_NOT_CONFIGURED,
        tradeId,
        'No active AI settings found. Configure an AI provider in settings first.',
      );
    }
    aiProvider = createAiProvider(aiConfig);
  }

  const chClient = deps?.clickhouseClient ?? createDefaultClickHouseClient();

  // ── Step 1: Gather trade data ─────────────────────────────────────
  let gathered: GatheredTradeData;
  try {
    gathered = await gatherTradeData(tradeId);
  } catch (err) {
    if (err instanceof AssessmentError) throw err;
    throw new AssessmentError(
      AssessmentErrorCode.TRADE_NOT_FOUND,
      tradeId,
      `Failed to gather trade data: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  warnings.push(...gathered.warnings);

  // ── Step 1.5: Compute maxLookback from evaluation fields ─────────
  let maxLookback: number | null = null;
  if (gathered.evaluationFields.length > 0) {
    const lookbacks = gathered.evaluationFields
      .map(f => f.minLookbackDays)
      .filter((d): d is number => d !== null && d !== undefined);
    if (lookbacks.length > 0) {
      maxLookback = Math.max(...lookbacks);
      console.log(
        JSON.stringify({
          event: 'per_play_lookback',
          tradeId,
          fieldCount: gathered.evaluationFields.length,
          maxLookback,
        }),
      );
    }
  }

  // ── Step 2: Market evidence (ClickHouse) ──────────────────────────
  let marketEvidence: MarketEvidence | null = null;
  if (gathered.trade.symbol) {
    const dateRange = deriveDateRange(gathered.trade, maxLookback ?? undefined);
    if (dateRange) {
      try {
        marketEvidence = await chClient.getMarketEvidence({
          symbol: gathered.trade.symbol,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        });

        console.log(
          JSON.stringify({
            event: 'market_evidence',
            symbol: gathered.trade.symbol,
            barCount: marketEvidence.ohlc.length,
            hasError: !!marketEvidence.error,
          }),
        );

        if (marketEvidence.error) {
          warnings.push(`Market evidence error: ${marketEvidence.error}`);
        } else if (marketEvidence.ohlc.length === 0) {
          warnings.push(
            `No market data available for ${gathered.trade.symbol}`,
          );
        }

        // Data sufficiency check: warn when bars < maxLookback
        if (
          maxLookback !== null &&
          marketEvidence.ohlc.length > 0 &&
          marketEvidence.ohlc.length < maxLookback
        ) {
          const playName = gathered.setupName ?? 'unknown';
          warnings.push(
            `Data sufficiency: only ${marketEvidence.ohlc.length}/${maxLookback} bars available for play ${playName}. Some evaluation criteria may be unreliable.`,
          );
        }

        gathered = { ...gathered, marketEvidence };
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : String(err);
        console.log(
          JSON.stringify({
            event: 'market_evidence',
            symbol: gathered.trade.symbol,
            barCount: 0,
            hasError: true,
          }),
        );
        console.log(
          JSON.stringify({
            event: 'assessment_error',
            tradeId,
            errorCode: 'CLICKHOUSE_ERROR',
            message: errMsg,
          }),
        );
        warnings.push(`Failed to fetch market evidence: ${errMsg}`);
        // Soft failure -- continue with null market evidence
        gathered = { ...gathered, marketEvidence: null };
      }
    } else {
      warnings.push(
        'Trade has no date information - cannot determine market evidence date range',
      );
    }
  }

  // ── Step 2.5: Freshness check ───────────────────────────────────────
  // Check whether ClickHouse market data is current enough for assessment.
  // For plan-stage (ai_quality), stale data blocks the assessment.
  // For after-exit (ai_review), stale data produces a warning only.
  if (gathered.trade.symbol) {
    try {
      const freshness = await chClient.checkFreshness();

      console.log(
        JSON.stringify({
          event: 'freshness_check',
          tradeId,
          status: freshness.status,
          latestDate: freshness.latestDate ?? null,
        }),
      );

      if (freshness.status === 'stale') {
        if (assessmentType === 'ai_quality') {
          console.log(
            JSON.stringify({
              event: 'freshness_blocked',
              tradeId,
              status: freshness.status,
              latestDate: freshness.latestDate ?? null,
              message: freshness.message,
            }),
          );
          throw new AssessmentError(
            AssessmentErrorCode.STALE_MARKET_DATA,
            tradeId,
            `Market data is stale — latest available date is ${freshness.latestDate ?? 'unknown'}. Data must be no older than T-1 to assess.`,
          );
        }
        // For ai_review, stale data is a warning, not a blocker
        warnings.push(`Market data freshness warning: ${freshness.message}`);
      }
    } catch (err) {
      if (err instanceof AssessmentError) throw err;
      // Connection error during freshness check — warn but don't block
      warnings.push(
        `Failed to check market data freshness: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Step 3: Build prompt ──────────────────────────────────────────
  const promptResult = buildAssessmentPrompt(gathered, { assessmentType });

  // ── Step 4: AI call ───────────────────────────────────────────────
  const aiCallStart = Date.now();
  let completionResult: Awaited<ReturnType<AiProvider['getCompletion']>>;

  try {
    completionResult = await aiProvider.getCompletion(
      [
        { role: 'system', content: promptResult.systemMessage },
        { role: 'user', content: promptResult.userMessage },
      ],
      { responseFormat: 'json_object' },
    );
  } catch (err) {
    const durationMs = Date.now() - aiCallStart;
    console.log(
      JSON.stringify({
        event: 'ai_call',
        model: 'unknown',
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    if (err instanceof AiProviderError) {
      switch (err.code) {
        case 'AUTH_ERROR':
          throw new AssessmentError(
            AssessmentErrorCode.AI_PROVIDER_ERROR,
            tradeId,
            `AI provider authentication error: ${err.message}`,
          );
        case 'TIMEOUT':
          throw new AssessmentError(
            AssessmentErrorCode.AI_PROVIDER_ERROR,
            tradeId,
            `AI provider request timed out: ${err.message}`,
          );
        case 'CONNECTION_ERROR':
          throw new AssessmentError(
            AssessmentErrorCode.AI_PROVIDER_ERROR,
            tradeId,
            `AI provider connection error: ${err.message}`,
          );
        default:
          throw new AssessmentError(
            AssessmentErrorCode.AI_PROVIDER_ERROR,
            tradeId,
            `AI provider error: ${err.message}`,
          );
      }
    }

    throw new AssessmentError(
      AssessmentErrorCode.AI_PROVIDER_ERROR,
      tradeId,
      `Unexpected AI provider error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const aiCallDuration = Date.now() - aiCallStart;

  // ── Step 5: Parse scorecard ───────────────────────────────────────
  const parseResult = parseScorecard(completionResult.content);

  if (!parseResult.success) {
    console.log(
      JSON.stringify({
        event: 'scorecard_parse_error',
        tradeId,
        errorCode: 'SCORECARD_PARSE_ERROR',
        parseErrorCode: parseResult.error.code,
        rawContentLength: completionResult.content.length,
      }),
    );

    throw new AssessmentError(
      AssessmentErrorCode.SCORECARD_PARSE_ERROR,
      tradeId,
      `Failed to parse AI scorecard: ${parseResult.error.message} (code: ${parseResult.error.code})`,
    );
  }

  const scorecard = parseResult.data;

  console.log(
    JSON.stringify({
      event: 'scorecard_parsed',
      overallScore: scorecard.overallScore,
      gradeLabel: scorecard.gradeLabel,
      dimensionCount: scorecard.dimensions.length,
    }),
  );

  // ── Step 6: Read AI config for model metadata ─────────────────────
  const activeConfig = readActiveAiConfig();
  const modelUsed = activeConfig?.model;
  const promptTokens = completionResult.usage?.promptTokens;
  const completionTokens = completionResult.usage?.completionTokens;

  console.log(
    JSON.stringify({
      event: 'ai_call',
      model: modelUsed ?? 'unknown',
      durationMs: aiCallDuration,
    }),
  );

  // ── Inject metadata into scorecard before persistence ────────────
  scorecard.metadata = {
    modelUsed: modelUsed ?? undefined,
    promptTokens: promptTokens ?? undefined,
    completionTokens: completionTokens ?? undefined,
    durationMs: aiCallDuration,
  };

  // ── Step 7: Persist snapshot ──────────────────────────────────────
  const snapshotId = randomUUID();
  const now = new Date().toISOString();

  db.insert(tradeAssessmentSnapshots)
    .values({
      id: snapshotId,
      tradeId,
      assessedAt: now,
      assessmentType: scorecard.assessmentType,
      overallScore: scorecard.overallScore,
      scorecardJson: JSON.stringify(scorecard),
      modelUsed: modelUsed ?? null,
      promptText: promptResult.systemMessage + '\n\n' + promptResult.userMessage,
      rawResponse: completionResult.content,
      promptTokens: promptTokens ?? null,
      completionTokens: completionTokens ?? null,
      notes: warnings.length > 0 ? warnings.join('; ') : null,
      createdAt: now,
    })
    .run();

  console.log(
    JSON.stringify({
      event: 'snapshot_saved',
      snapshotId,
      tradeId,
    }),
  );

  return {
    scorecard,
    snapshot: {
      id: snapshotId,
      assessedAt: now,
      modelUsed,
      promptTokens,
      completionTokens,
      promptText: promptResult.systemMessage + '\n\n' + promptResult.userMessage,
      rawResponse: completionResult.content,
    },
    warnings,
  };
}
