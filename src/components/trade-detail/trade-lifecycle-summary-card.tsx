'use client';

import { Activity } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { statusLabel, formatDate } from './helpers';
import type { Trade } from './types';

interface TradeLifecycleSummaryCardProps {
  status: Trade['status'];
  openedAt: string | null;
  closedAt: string | null;
  openQuantity: number;
}

export default function TradeLifecycleSummaryCard({
  status,
  openedAt,
  closedAt,
  openQuantity,
}: TradeLifecycleSummaryCardProps) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-zinc-500" />
          Lifecycle Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Status</div>
            <div className="font-medium text-zinc-900 dark:text-zinc-100">
              {statusLabel(status)}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Opened At</div>
            <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatDate(openedAt)}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Closed At</div>
            <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatDate(closedAt)}
            </div>
          </div>
          <div>
            <div className="text-zinc-600 dark:text-zinc-300">Open Qty</div>
            <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
              {openQuantity.toLocaleString()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
