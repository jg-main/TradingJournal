'use client';

import { Badge } from '@/components/ui/badge';

/**
 * Account detail header showing the account identity.
 *
 * Renders the account name, active/inactive status badge,
 * broker reference, and currency.
 */
export interface AccountDetailHeaderProps {
  /** Account display name. */
  name: string;
  /** Broker label, or null. */
  broker: string | null;
  /** Trading currency code (e.g. 'USD'). */
  currency: string;
  /** Whether the account is active. */
  isActive: boolean;
}

export function AccountDetailHeader({ name, broker, currency, isActive }: AccountDetailHeaderProps) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {name}
        </h1>
        {!isActive && (
          <Badge variant="secondary">Inactive</Badge>
        )}
      </div>
      <div className="mt-2 flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-300">
        {broker && <span>{broker}</span>}
        <span>{currency}</span>
      </div>
    </div>
  );
}
