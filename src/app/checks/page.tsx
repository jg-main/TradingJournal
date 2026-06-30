import { ClipboardCheck } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';

export default function ChecksPage() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Checks
      </h1>
      <EmptyState
        icon={<ClipboardCheck className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
        title="No checks configured"
        description="Configure pre-trade checklists and quality gates to ensure you follow your process on every trade."
      />
    </div>
  );
}
