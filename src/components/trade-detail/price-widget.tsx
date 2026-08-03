'use client';

import { Clock, RefreshCw, WifiOff, AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatPrice, getStalenessLabel } from './helpers';
import type { MtmData } from './types';

export interface PriceWidgetProps {
  mtmData: MtmData;
  onRefreshPrice?: () => void;
  frozen?: boolean;
}

/**
 * PriceWidget displays live price data for a trade's symbol.
 *
 * Visual states:
 *   loading   — Skeleton placeholders (mtmData.loading && no price)
 *   populated — Full data display (price exists, no error)
 *   stale     — Price exists but market is closed, shows Clock + staleness
 *   error     — Error banner with retry button (error, no cached price)
 *   offline   — Cached price + offline indicator + retry (error + cached price)
 *   frozen    — Closed trade — shows data without polling/refresh indicators
 */
export default function PriceWidget({ mtmData, onRefreshPrice, frozen = false }: PriceWidgetProps) {
  const hasPrice = mtmData.price != null;
  const isLoading = mtmData.loading && !hasPrice;
  const hasError = !!mtmData.error;
  const isCachedWithError = hasPrice && hasError;
  const isStreaming = mtmData.source === 'schwab';

  const marketClosed =
    mtmData.marketState != null &&
    !['REGULAR', 'PRE', 'POST', 'PREPRE', 'POSTPOST'].includes(mtmData.marketState.toUpperCase());

  const populated = hasPrice && !isLoading;
  const showStaleness = populated && !frozen && marketClosed;
  const showStreamingLabel = populated && !frozen && isStreaming;

  const change = mtmData.change ?? 0;
  const changePercent = mtmData.changePercent ?? 0;
  const changeSign = change >= 0;
  const changeColor = 'text-positive';
  const negChangeColor = 'text-negative';

  // ── Loading State ──
  if (isLoading) {
    return (
      <Card data-testid="price-widget-loading" className="border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-3.5 w-32" />
            </div>
            <div className="space-y-2 text-right">
              <Skeleton className="h-5 w-24 ml-auto" />
              <Skeleton className="h-3.5 w-16 ml-auto" />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error State (no cached price) ──
  if (hasError && !hasPrice) {
    return (
      <Card data-testid="price-widget-error" className="border-destructive/40">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-destructive">
                Price data unavailable
              </p>
              <p className="mt-0.5 text-xs text-destructive/80">
                {mtmData.error}
              </p>
            </div>
            {!frozen && onRefreshPrice && (
              <Button
                data-testid="price-widget-retry"
                variant="outline"
                size="sm"
                onClick={onRefreshPrice}
                className="shrink-0"
              >
                <RefreshCw className="mr-1 size-3.5" />
                Retry
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Have price data — show the populated display ──
  return (
    <Card
      data-testid="price-widget"
      className={cn(
        "border-border",
        isCachedWithError && "border-warning/40",
      )}
    >
      <CardContent className="p-4">
        {/* ── Top row: symbol + company + price/change ── */}
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold tabular-nums text-foreground">
                Symbol
              </span>
              {mtmData.shortName ? (
                <span className="truncate text-sm font-medium text-muted-foreground">
                  {mtmData.shortName}
                </span>
              ) : null}
            </div>
            {mtmData.sector && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {mtmData.sector}
                {mtmData.industry && <span> · {mtmData.industry}</span>}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div
              className={cn(
                "text-lg font-semibold tabular-nums",
                hasPrice && change !== 0
                  ? changeSign
                    ? changeColor
                    : negChangeColor
                  : "text-foreground",
              )}
            >
              {formatPrice(mtmData.price)}
            </div>
            {change !== 0 && (
              <div
                className={cn(
                  "mt-0.5 text-xs tabular-nums font-medium",
                  changeSign ? changeColor : negChangeColor,
                )}
              >
                {changeSign ? "+" : ""}
                {change.toFixed(2)} ({changeSign ? "+" : ""}
                {changePercent.toFixed(2)}%)
              </div>
            )}
          </div>
        </div>

        {/* ── Detail grid: day high, day low, previous close ── */}
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">Day High</span>
            <div className="mt-0.5 tabular-nums text-foreground">
              {formatPrice(mtmData.dayHigh)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Day Low</span>
            <div className="mt-0.5 tabular-nums text-foreground">
              {formatPrice(mtmData.dayLow)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Prev Close</span>
            <div className="mt-0.5 tabular-nums text-foreground">
              {formatPrice(mtmData.previousClose)}
            </div>
          </div>
        </div>

        {/* ── Footer row: staleness/streaming/last-updated + offline/retry ── */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {showStaleness && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {getStalenessLabel(mtmData.marketState, mtmData.fetchedAt)}
              </span>
            )}
            {showStreamingLabel && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                Streaming
              </span>
            )}
            {populated && mtmData.fetchedAt && !showStaleness && !showStreamingLabel && !isCachedWithError && (
              <span>
                Updated: {formatTimeAgo(mtmData.fetchedAt)}
              </span>
            )}
            {isCachedWithError && (
              <span
                data-testid="price-widget-offline"
                className="inline-flex items-center gap-1 text-warning"
              >
                <WifiOff className="size-3" />
                Offline — showing cached price
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isCachedWithError && !frozen && onRefreshPrice && (
              <Button
                data-testid="price-widget-retry"
                variant="ghost"
                size="sm"
                onClick={onRefreshPrice}
                className="h-7 text-xs"
              >
                <RefreshCw className="mr-1 size-3" />
                Retry
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Format a timestamp as a relative "time ago" string.
 * Returns raw formatted date if less than ~1 day ago, else short date.
 */
function formatTimeAgo(iso: string): string {
  try {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
