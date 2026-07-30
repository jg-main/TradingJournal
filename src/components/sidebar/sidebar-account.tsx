'use client';

import { Building2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAccount } from '@/lib/account-context';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface SidebarAccountProps {
  collapsed?: boolean;
}

function accountLabel(name: string, broker: string | null): string {
  return broker ? `${name} (${broker})` : name;
}

/**
 * Global account selector hosted in the sidebar (M007/D037).
 * The single visible account selector in the legacy shell — pages consume
 * the selection via useAccount() rather than rendering their own.
 *
 * Expanded: compact Select under the brand block.
 * Collapsed: icon button opening a dropdown, with tooltip label.
 */
export function SidebarAccount({ collapsed = false }: SidebarAccountProps) {
  const { accounts, loading, error, accountId, setAccountId } = useAccount();

  if (loading) {
    return (
      <div className={cn('border-b p-2', collapsed && 'flex justify-center')}>
        <div
          className={cn(
            'animate-pulse rounded-lg bg-muted',
            collapsed ? 'size-9' : 'h-9 w-full'
          )}
          data-testid="sidebar-account-loading"
        />
      </div>
    );
  }

  if (error) {
    if (collapsed) {
      return (
        <div className="flex justify-center border-b p-2">
          <div
            className="flex size-9 items-center justify-center rounded-lg text-red-500"
            title={`Accounts unavailable: ${error}`}
          >
            <Building2 className="size-4" />
          </div>
        </div>
      );
    }
    return (
      <div className="border-b p-2">
        <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return null;
  }

  if (collapsed) {
    const active = accounts.find((a) => a.id === accountId);
    return (
      <div className="flex justify-center border-b p-2">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={`Account: ${active?.name ?? 'Select account'}`}
                  data-testid="sidebar-account-collapsed-trigger"
                >
                  <Building2 className="size-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {active ? accountLabel(active.name, active.broker) : 'Select account'}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" sideOffset={8} align="start">
            {accounts.map((a) => (
              <DropdownMenuItem
                key={a.id}
                onClick={() => setAccountId(a.id)}
                className="flex items-center justify-between gap-4"
              >
                <span>{accountLabel(a.name, a.broker)}</span>
                {a.id === accountId && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className="border-b p-2" data-testid="sidebar-account">
      <Select value={accountId} onValueChange={setAccountId}>
        <SelectTrigger
          className="h-9 w-full text-xs"
          aria-label="Select account"
          data-testid="sidebar-account-trigger"
        >
          <SelectValue placeholder="Select account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {accountLabel(a.name, a.broker)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
