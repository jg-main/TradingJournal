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
          <Activity className="size-4 text-muted-foreground" />
          Lifecycle Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">Status</div>
            <div className="font-medium text-foreground">
              {statusLabel(status)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Opened At</div>
            <div className="tabular-nums text-foreground">
              {formatDate(openedAt)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Closed At</div>
            <div className="tabular-nums text-foreground">
              {formatDate(closedAt)}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Open Qty</div>
            <div className="tabular-nums text-foreground">
              {openQuantity.toLocaleString()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
