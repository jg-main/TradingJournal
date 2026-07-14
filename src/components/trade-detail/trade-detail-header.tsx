'use client';

import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Calendar, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { statusBadgeVariant, statusLabel } from './helpers';
import { useAppTimezone } from '@/lib/timezone-context';
import type { Trade } from './types';

interface TradeDetailHeaderProps {
  symbol: string;
  status: Trade['status'];
  direction: Trade['direction'];
  tradeCode: string;
  openedAt?: string | null;
  setupName?: string | null;
  gradeLabel?: string | null;
  rightContent?: ReactNode;
}

export default function TradeDetailHeader({
  symbol,
  status,
  direction,
  tradeCode,
  openedAt,
  setupName,
  gradeLabel,
  rightContent,
}: TradeDetailHeaderProps) {
  const { timezone } = useAppTimezone();
  const isDeleted = status === 'deleted';

  const symbolClasses = isDeleted
    ? 'text-xl font-semibold tracking-tight text-zinc-400 line-through dark:text-zinc-500'
    : 'text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50';

  const DirectionIcon = direction === 'long' ? TrendingUp : TrendingDown;

  const openedDate = openedAt
    ? new Date(openedAt).toLocaleDateString(undefined, { timeZone: timezone, month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="mb-6 flex items-start justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <h1 className={symbolClasses}>{symbol}</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            <DirectionIcon className="size-3" />
            {direction === 'long' ? 'Long' : 'Short'}
          </span>
          <Badge variant={statusBadgeVariant(status).variant} className={statusBadgeVariant(status).className}>
            {statusLabel(status)}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
          <span className="font-mono">{tradeCode}</span>
          {openedDate && (
            <>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" />
                {openedDate}
              </span>
            </>
          )}
          {setupName && (
            <>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span className="inline-flex items-center gap-1">
                <Tag className="size-3" />
                {setupName}
              </span>
            </>
          )}
          {gradeLabel && (
            <>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span className="font-medium text-zinc-500 dark:text-zinc-400">Grade: {gradeLabel}</span>
            </>
          )}
        </div>
      </div>
      {rightContent && <div>{rightContent}</div>}
    </div>
  );
}
