'use client';

import { Building2, Check, RefreshCw } from 'lucide-react';
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
  const { accounts, loading, error, accountId, setAccountId, refresh } = useAccount();

  if (loading) {
    return (
      <div className={cn('border-b border-sidebar-border p-2', collapsed && 'flex justify-center')}>
        <div
          className={cn(
            'animate-pulse rounded-lg bg-sidebar-accent',
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
        <div className="flex justify-center border-b border-sidebar-border p-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex size-9 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-sidebar-accent"
            title={`Accounts unavailable: ${error} — click to retry`}
            aria-label="Retry loading accounts"
            data-testid="sidebar-account-error-retry"
          >
            <Building2 className="size-4" />
          </button>
        </div>
      );
    }
    return (
      <div className="border-b border-sidebar-border p-2">
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <RefreshCw className="size-3" />
          Retry loading accounts
        </button>
      </div>
    );
  }

  if (accounts.length === 0) {
    return null;
  }

  if (collapsed) {
    const active = accounts.find((a) => a.id === accountId);
    return (
      <div className="flex justify-center border-b border-sidebar-border p-2">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
    <div className="border-b border-sidebar-border p-2" data-testid="sidebar-account">
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
