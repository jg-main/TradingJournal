import { User } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Account
      </h1>
      <EmptyState
        icon={<User className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
        title="Account overview"
        description="View your account details, balance history, and performance metrics over time."
      />
    </div>
  );
}
