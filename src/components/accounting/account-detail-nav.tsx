'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  BookOpen,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react';

/**
 * Navigation tab definition for the account detail workspace.
 */
interface AccountNavTab {
  /** Route href relative to the account base path. */
  href: string;
  /** Visible tab label. */
  label: string;
  /** Lucide icon component. */
  icon: LucideIcon;
}

/**
 * Build the workspace tab definitions for a given account id.
 *
 * The base route (`/accounts/${id}`) is the Overview tab.  All other
 * tabs have a sub-path under the account route.  Tabs are ordered
 * left-to-right in the navigation bar.
 */
function buildTabs(accountId: string): AccountNavTab[] {
  const base = `/settings/accounts/${accountId}`;
  return [
    { href: base, label: 'Overview', icon: LayoutDashboard },
    { href: `${base}/ledger`, label: 'Ledger', icon: BookOpen },
    { href: `${base}/positions`, label: 'Positions', icon: BarChart3 },
    { href: `${base}/settings`, label: 'Settings', icon: Settings },
  ];
}

/**
 * Account detail workspace navigation bar.
 *
 * Renders horizontal tab links for the four current account workspace areas.
 * The active tab is highlighted with a bottom-border and dark text.
 *
 * @param accountId - The account id used to build tab hrefs.
 */
export interface AccountDetailNavProps {
  accountId: string;
}

export function AccountDetailNav({ accountId }: AccountDetailNavProps) {
  const pathname = usePathname();
  const tabs = buildTabs(accountId);

  return (
    <nav
      className="mb-8 flex gap-1 border-b border-border"
      role="tablist"
      aria-label="Account workspace tabs"
    >
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-b-2 border-foreground text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
