'use client';

import { useEffect, useState, useCallback } from 'react';
import { Play, Brain, Loader2, MoreHorizontal, Pencil } from 'lucide-react';
import { LifecycleStepper } from '@/components/lifecycle-stepper';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import TradeDetailHeader from './trade-detail-header';
import TradePlanCard from './trade-plan-card';
import TradeAssetsCard from './trade-assets-card';
import AssessmentCard from './assessment-card';
import type { Trade, TradeAsset } from './types';
import type { Scorecard } from '@/lib/scorecard';

interface AssessmentResponse {
  scorecard?: Scorecard;
  snapshot?: {
    scorecard: Scorecard | null;
    id: string;
    tradeId: string;
    assessedAt: string | null;
    assessmentType: string;
    overallScore: number | null;
    modelUsed: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    notes: string | null;
    createdAt: string | null;
    snapshotVersion: number;
    promptText?: string | null;
    rawResponse?: string | null;
  };
  warnings?: string[];
  data?: Array<{
    scorecard: Scorecard | null;
    id: string;
    tradeId: string;
    assessedAt: string | null;
    assessmentType: string;
    overallScore: number | null;
    modelUsed: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    notes: string | null;
    createdAt: string | null;
    snapshotVersion: number;
    promptText?: string | null;
    rawResponse?: string | null;
  }>;
  error?: string;
  /** Machine-readable error code from the API */
  code?: string;
}

interface PlannedPhaseViewProps {
  trade: Trade;
  assets: TradeAsset[];
  onAssetsChanged: () => Promise<void>;
  onExecute: () => void;
  onEdit?: () => void;
}

export default function PlannedPhaseView({
  trade,
  assets,
  onAssetsChanged,
  onExecute,
  onEdit,
}: PlannedPhaseViewProps) {
  const preTradeAssets = assets.filter((a) => a.phase === 'pre_trade');

  // ── Assessment State ─────────────────────────────────────────
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [promptText, setPromptText] = useState<string | null | undefined>(undefined);
  const [rawResponse, setRawResponse] = useState<string | null | undefined>(undefined);

  // ── Fetch latest assessment on mount ─────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchLatestAssessment() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/trades/${trade.id}/assessments`);

        if (!res.ok) {
          if (res.status === 404) {
            // Trade not found — show empty state
            if (!cancelled) {
              setScorecard(null);
              setWarnings([]);
              setLoading(false);
            }
            return;
          }
          const body: AssessmentResponse = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to load assessment');
        }

        const body: AssessmentResponse = await res.json();

        if (!cancelled) {
          const latest = body.data?.[0];
          if (latest?.scorecard) {
            setScorecard(latest.scorecard);
            setWarnings([]);
          } else {
            setScorecard(null);
            setWarnings([]);
          }
          setPromptText(latest?.promptText ?? undefined);
          setRawResponse(latest?.rawResponse ?? undefined);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load assessment',
          );
          setScorecard(null);
          setLoading(false);
        }
      }
    }

    fetchLatestAssessment();

    return () => {
      cancelled = true;
    };
  }, [trade.id]);

  // ── Request new assessment ───────────────────────────────────
  const handleRequestAssessment = useCallback(async () => {
    setRequestLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/trades/${trade.id}/assessments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessmentType: 'ai_quality' }),
      });

      if (!res.ok) {
        const body: AssessmentResponse = await res.json().catch(() => ({}));
        const rawMessage = body.error || 'Assessment request failed';
        const errorCode = (body as { code?: string }).code;
        // Differentiate user-facing message based on API error code
        if (errorCode === 'STALE_MARKET_DATA') {
          throw new Error('Market data is not current — try again later');
        }
        if (errorCode === 'AI_NOT_CONFIGURED') {
          throw new Error('AI not configured — set up in Settings');
        }
        if (errorCode === 'AI_PROVIDER_ERROR') {
          throw new Error('AI provider error — check credentials');
        }
        throw new Error(rawMessage);
      }

      const body: AssessmentResponse = await res.json();

      if (body.scorecard) {
        setScorecard(body.scorecard);
      } else if (body.snapshot?.scorecard) {
        setScorecard(body.snapshot.scorecard);
      }

      // Capture promptText/rawResponse from the posted snapshot
      if (body.snapshot) {
        setPromptText(body.snapshot.promptText ?? undefined);
        setRawResponse(body.snapshot.rawResponse ?? undefined);
      }

      if (body.warnings) {
        setWarnings(body.warnings);
      }
    } catch (err) {
      console.error('Assessment request failed:', err);
      setError(
        err instanceof Error ? err.message : 'Assessment request failed',
      );
    } finally {
      setRequestLoading(false);
    }
  }, [trade.id]);

  return (
    <>
      <TradeDetailHeader
        symbol={trade.symbol}
        status={trade.status}
        direction={trade.direction}
        tradeCode={trade.tradeCode}
        rightContent={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onExecute}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <Play className="size-4" />
              Execute
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-md border border-zinc-300 p-2 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit?.()}>
                  <Pencil className="size-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRequestAssessment} disabled={requestLoading}>
                  {requestLoading ? <Loader2 className="size-4 animate-spin" /> : <Brain className="size-4" />}
                  {requestLoading ? 'Assessing...' : 'Assess'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* Lifecycle Stepper */}
      <div className="mb-8">
        <LifecycleStepper
          status={trade.status}
          direction={trade.direction}
          openedAt={trade.openedAt}
          exitNotes={trade.exitNotes}
          lesson={trade.lesson}
        />
      </div>

      {/* Trade Plan Card */}
      <div className="mb-8">
        <TradePlanCard trade={trade} />
      </div>

      {/* AI Quality Assessment — shown after Trade Plan per design */}
      <div className="mb-8">
        <AssessmentCard
          scorecard={scorecard}
          warnings={warnings}
          loading={loading}
          error={error}
          onRequestAssessment={handleRequestAssessment}
          requestLoading={requestLoading}
          promptText={promptText}
          rawResponse={rawResponse}
        />
      </div>

      {/* Assets — pre_trade only */}
      <div className="mb-8">
        <TradeAssetsCard
          assets={preTradeAssets}
          tradeId={trade.id}
          onAssetsChanged={onAssetsChanged}
        />
      </div>
    </>
  );
}
