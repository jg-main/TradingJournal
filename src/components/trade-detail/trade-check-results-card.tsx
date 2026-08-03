'use client';

import { CheckCircle2, XCircle, ClipboardCheck } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatDate } from './helpers';
import type { CheckResult } from './types';

interface TradeCheckResultsCardProps {
  checkResults: CheckResult[];
}

export default function TradeCheckResultsCard({ checkResults }: TradeCheckResultsCardProps) {
  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-muted-foreground" />
          Pre-Execution Checklist
        </CardTitle>
      </CardHeader>
      <CardContent>
        {checkResults.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No pre-execution checks were verified for this trade.
          </p>
        ) : (
          <ul className="space-y-3">
            {checkResults.map((check) => (
              <li key={check.id} className="flex items-start gap-3">
                {check.passed ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-negative" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    {check.description}
                  </p>
                  {check.checkedAt && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Verified {formatDate(check.checkedAt)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
