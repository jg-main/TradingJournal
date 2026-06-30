import { Star } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';

export default function ReviewsPage() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Reviews
      </h1>
      <EmptyState
        icon={<Star className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
        title="No reviews completed"
        description="Weekly and monthly reviews help you spot patterns in your trading behavior and track your improvement over time."
      />
    </div>
  );
}
