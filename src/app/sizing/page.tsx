import { Target } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';

export default function SizingPage() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Position Sizing
      </h1>
      <EmptyState
        icon={<Target className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
        title="No position calculations yet"
        description="Calculate your optimal position size based on account equity, risk per trade, and stop loss distance."
      />
    </div>
  );
}
