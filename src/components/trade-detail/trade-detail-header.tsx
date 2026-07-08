'use client';

import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { statusBadgeVariant, statusLabel } from './helpers';
import type { Trade } from './types';

interface TradeDetailHeaderProps {
  symbol: string;
  status: Trade['status'];
  direction: Trade['direction'];
  tradeCode: string;
  rightContent?: ReactNode;
}

export default function TradeDetailHeader({
  symbol,
  status,
  direction,
  tradeCode,
  rightContent,
}: TradeDetailHeaderProps) {
  const badgeInfo = statusBadgeVariant(status);
  const isDeleted = status === 'deleted';

  const symbolClasses = isDeleted
    ? 'text-2xl font-semibold tracking-tight text-zinc-400 line-through dark:text-zinc-500'
    : 'text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50';

  const directionClasses = isDeleted
    ? 'inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
    : direction === 'long'
      ? 'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
      : 'inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400';

  const DirectionIcon = direction === 'long' ? TrendingUp : TrendingDown;

  return (
    <div className="mb-8 flex items-start justify-between">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <h1 className={symbolClasses}>{symbol}</h1>
          <Badge variant={badgeInfo.variant} className={badgeInfo.className}>
            {statusLabel(status)}
          </Badge>
          <span className={directionClasses}>
            <DirectionIcon className="size-3" />
            {direction === 'long' ? 'Long' : 'Short'}
          </span>
        </div>
        <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {tradeCode}
        </p>
      </div>
      {rightContent && <div>{rightContent}</div>}
    </div>
  );
}
