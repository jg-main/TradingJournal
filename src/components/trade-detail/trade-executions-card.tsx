'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { formatAction, formatDate, formatPrice, formatCurrency } from './helpers';
import type { Execution } from './types';

interface TradeExecutionsCardProps {
  executions: Execution[];
}

export default function TradeExecutionsCard({ executions }: TradeExecutionsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Executions</CardTitle>
      </CardHeader>
      <CardContent>
        {executions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No executions recorded yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executions.map((exec) => {
                const actionColorClass =
                  exec.action === 'buy' || exec.action === 'add'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : exec.action === 'sell' || exec.action === 'reduce' || exec.action === 'sell_short'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';

                return (
                  <TableRow key={exec.id}>
                    <TableCell className="tabular-nums text-zinc-600 dark:text-zinc-300">
                      {formatDate(exec.executedAt)}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${actionColorClass}`}>
                        {formatAction(exec.action)}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                      {exec.quantity.toLocaleString()}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-900 dark:text-zinc-100">
                      {formatPrice(exec.price)}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-zinc-600 dark:text-zinc-300">
                      {exec.fees != null ? formatCurrency(exec.fees) : '-'}
                    </TableCell>
                    <TableCell className="text-zinc-600 dark:text-zinc-300">
                      {exec.notes ?? '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
