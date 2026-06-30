import { Eye } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';

export default function WatchlistPage() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Watchlist
      </h1>
      <EmptyState
        icon={<Eye className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
        title="No stocks on watch"
        description="Track stocks you're monitoring for potential entries. Add symbols to your watchlist and set price alerts."
      />
    </div>
  );
}
