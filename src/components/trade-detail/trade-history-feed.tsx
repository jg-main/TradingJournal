'use client';

import { History, Pencil } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppTimezone } from '@/lib/timezone-context';
import { formatAction, formatPrice } from './helpers';
import type { Execution } from './types';

/**
 * Unified chronological history feed for the Trade Detail page (M019/S03).
 *
 * Renders stop adjustments, target adjustments, and execution events in one
 * most-recent-first feed. It consumes the S01 level-history API shape
 * (stop + target adjustments) and the existing executions fetch — no new
 * endpoint is created. The lifecycle scalar summary (status, dates, qty)
 * stays in TradeLifecycleSummaryCard above this feed.
 *
 * Level events are typed by a local structural interface (the S01 route also
 * exports LevelHistoryEvent, but this is a client component and must not
 * import from an API route module that pulls in server-only dependencies).
 */

/** Stop/target adjustment event as returned by GET /api/trades/[id]/level-history (S01). */
export interface LevelHistoryEvent {
  type: 'stop' | 'target';
  id: string;
  adjustedAt: string | null;
  oldValue: number | null;
  newValue: number | null;
  reason: string | null;
  ruleBased: boolean | null;
  targetIndex?: number;
  createdAt: string | null;
}

interface TradeHistoryFeedProps {
  /** Stop/target adjustment events from the S01 level-history API. */
  levelHistoryEvents: LevelHistoryEvent[];
  /** Executions for the trade from the existing executions fetch. */
  executions: Execution[];
  /** Opens the accounting-true correction workflow for the selected fill. */
  onCorrectExecution?: (execution: Execution) => void;
}

/** One normalized row in the unified feed (level event or execution). */
export type FeedEvent =
  | {
      kind: 'stop';
      id: string;
      /** Primary timestamp: adjustedAt ?? createdAt ('' when unknown). */
      at: string;
      createdAt: string;
      oldValue: number | null;
      newValue: number | null;
      reason: string | null;
      ruleBased: boolean | null;
    }
  | {
      kind: 'target';
      id: string;
      at: string;
      createdAt: string;
      oldValue: number | null;
      newValue: number | null;
      reason: string | null;
      ruleBased: boolean | null;
      targetIndex?: number;
    }
  | {
      kind: 'execution';
      id: string;
      /** Primary timestamp: executedAt ?? createdAt ('' when unknown). */
      at: string;
      createdAt: string;
      action: string;
      quantity: number;
      price: number;
      fees: number | null;
      notes: string | null;
      execution: Execution;
    };

/**
 * Unified ordering for the feed: primary timestamp desc, createdAt desc,
 * id desc — the same canonical ordering as compareLevelEventsDesc
 * (src/lib/trade-levels.ts) so level events keep their API order and
 * execution events interleave deterministically. Events without a timestamp
 * sort to the bottom.
 */
export function compareFeedEventsDesc(a: FeedEvent, b: FeedEvent): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Normalize the two data sources into one FeedEvent[] ordered
 * most-recent-first. Each source row keeps its own id, so the returned
 * array can contain duplicates across kinds (a level event and an execution
 * never share a DB row).
 */
export function buildFeedEvents(
  levelHistoryEvents: LevelHistoryEvent[],
  executions: Execution[],
): FeedEvent[] {
  const levelEvents: FeedEvent[] = levelHistoryEvents.map((e) =>
    e.type === 'stop'
      ? {
          kind: 'stop',
          id: e.id,
          at: e.adjustedAt ?? e.createdAt ?? '',
          createdAt: e.createdAt ?? '',
          oldValue: e.oldValue,
          newValue: e.newValue,
          reason: e.reason,
          ruleBased: e.ruleBased,
        }
      : {
          kind: 'target',
          id: e.id,
          at: e.adjustedAt ?? e.createdAt ?? '',
          createdAt: e.createdAt ?? '',
          oldValue: e.oldValue,
          newValue: e.newValue,
          reason: e.reason,
          ruleBased: e.ruleBased,
          targetIndex: e.targetIndex,
        },
  );
  const executionEvents: FeedEvent[] = executions.map((e) => ({
    kind: 'execution',
    id: e.id,
    at: e.executedAt ?? e.createdAt ?? '',
    createdAt: e.createdAt ?? '',
    action: e.action,
    quantity: e.quantity,
    price: e.price,
    fees: e.fees,
    notes: e.notes,
    execution: e,
  }));
  return [...levelEvents, ...executionEvents].sort(compareFeedEventsDesc);
}

/**
 * Distinct badge color per execution action, mirroring the Executions card:
 * buys/adds read as positive, sells/reduces/sell-shorts as negative, and
 * buy-to-cover as informational.
 */
export function executionBadgeClass(action: string): string {
  if (action === 'buy' || action === 'add') return 'bg-positive/10 text-positive';
  if (action === 'sell' || action === 'reduce' || action === 'sell_short') {
    return 'bg-negative/10 text-negative';
  }
  return 'bg-info/10 text-info';
}

/** Signed delta between two level values, colored by direction (green up, red down, neutral zero). */
function levelDelta(oldValue: number | null, newValue: number | null): { text: string; className: string } | null {
  if (oldValue == null || newValue == null) return null;
  const delta = newValue - oldValue;
  const sign = delta >= 0 ? '+' : '';
  const text = `${sign}${delta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const className = delta > 0 ? 'text-positive' : delta < 0 ? 'text-negative' : 'text-muted-foreground';
  return { text, className };
}

/** Historical target events remain visible without exposing retired target slots. */
function targetLabel(): string {
  return 'Target';
}

const BADGE_BASE = 'inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium';
const META_CLASS = 'mt-0.5 block text-xs text-muted-foreground';

export default function TradeHistoryFeed({
  levelHistoryEvents,
  executions,
  onCorrectExecution,
}: TradeHistoryFeedProps) {
  const { formatDateTime } = useAppTimezone();
  const events = buildFeedEvents(levelHistoryEvents, executions);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history recorded yet.</p>
        ) : (
          <ol className="divide-y divide-border">
            {events.map((event) => {
              const delta =
                event.kind === 'execution' ? null : levelDelta(event.oldValue, event.newValue);
              const typeLabel =
                event.kind === 'stop'
                  ? 'Stop'
                  : event.kind === 'target'
                    ? targetLabel()
                    : formatAction(event.action);

              return (
                <li key={`${event.kind}:${event.id}`} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <span
                      className={`${BADGE_BASE} ${
                        event.kind === 'stop'
                          ? 'bg-warning/10 text-warning'
                          : event.kind === 'target'
                            ? 'bg-info/10 text-info'
                            : executionBadgeClass(event.action)
                      }`}
                    >
                      {typeLabel}
                    </span>

                    <div className="min-w-0 flex-1">
                      {event.kind === 'execution' ? (
                        <>
                          <div className="text-sm text-foreground">
                            <span className="tabular-nums">{event.quantity.toLocaleString()}</span>
                            <span className="text-muted-foreground"> @ </span>
                            <span className="tabular-nums">{formatPrice(event.price)}</span>
                            {event.fees != null && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                Fees {formatPrice(event.fees)}
                              </span>
                            )}
                          </div>
                          {event.notes && <p className={META_CLASS}>{event.notes}</p>}
                        </>
                      ) : (
                        <>
                          <div className="text-sm text-foreground">
                            <span className="text-muted-foreground">
                              {event.kind === 'stop' ? 'Stop adjusted:' : `${typeLabel} adjusted:`}
                            </span>{' '}
                            <span className="tabular-nums">{formatPrice(event.oldValue)}</span>
                            <span className="text-muted-foreground"> → </span>
                            <span className="tabular-nums font-medium">{formatPrice(event.newValue)}</span>
                            {delta && (
                              <span className={`ml-1.5 text-xs tabular-nums ${delta.className}`}>
                                ({delta.text})
                              </span>
                            )}
                            {event.ruleBased != null && (
                              <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {event.ruleBased ? 'Auto' : 'Manual'}
                              </span>
                            )}
                          </div>
                          {event.reason && <p className={META_CLASS}>{event.reason}</p>}
                        </>
                      )}
                    </div>

                    {event.kind === 'execution' && onCorrectExecution && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => onCorrectExecution(event.execution)}
                        aria-label={`Correct ${formatAction(event.action)} execution`}
                      >
                        <Pencil className="size-3" />
                        Correct
                      </Button>
                    )}

                    <time
                      dateTime={event.at || undefined}
                      className="shrink-0 text-xs tabular-nums text-muted-foreground"
                    >
                      {formatDateTime(event.at)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
