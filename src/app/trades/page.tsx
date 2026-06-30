import { NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';

export default function TradesPage() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Trade Log
      </h1>
      <EmptyState
        icon={<NotebookPen className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
        title="No trades yet"
        description="Your first trade is the hardest — once logged, this page will show your full trade history with entry and exit details."
      />
    </div>
  );
}
