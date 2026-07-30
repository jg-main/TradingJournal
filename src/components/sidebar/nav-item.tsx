'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { NavItem } from './nav-config';

interface SidebarNavItemProps {
  item: NavItem;
  isActive: boolean;
  collapsed?: boolean;
}

/**
 * Single sidebar navigation link.
 *
 * Active state: muted fill plus a 3px primary rail on the leading edge
 * (before: pseudo-element) using the --sidebar-primary theme token.
 * Collapsed mode: icon-only, centered, with a right-side tooltip label.
 */
export function SidebarNavItem({ item, isActive, collapsed = false }: SidebarNavItemProps) {
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        collapsed && 'justify-center px-0',
        isActive
          ? 'bg-muted text-foreground before:absolute before:left-0 before:inset-y-1 before:w-[3px] before:rounded-r-full before:bg-sidebar-primary before:content-[""]'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}
