import {
  LayoutDashboard,
  NotebookPen,
  ClipboardCheck,
  Target,
  Landmark,
  Bell,
  Settings,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Grouped navigation for the legacy shell sidebar, organized by user job
 * rather than by database entity (M014 S02).
 * Order matters: sections render top-to-bottom in this sequence.
 *
 * - Trading: the daily workflow (dashboard, trades, checks)
 * - Accounts: account management
 * - Analysis: planning/analytics tooling (position sizing)
 * - System: settings and maintenance
 *
 * Every href targets an existing functional route; no items are added for
 * unfinished or nonexistent pages.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Trading',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/trades', label: 'Trades', icon: NotebookPen },
      { href: '/checks', label: 'Checks', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Accounts',
    items: [{ href: '/settings/accounts', label: 'Accounts', icon: Landmark }],
  },
  {
    label: 'Analysis',
    items: [{ href: '/sizing', label: 'Sizing', icon: Target }],
  },
  {
    label: 'System',
    items: [
      { href: '/alerts', label: 'Alerts', icon: Bell },
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/help', label: 'Help', icon: HelpCircle },
    ],
  },
];

/**
 * Resolve which nav item's href represents the current pathname.
 *
 * Longest-matching-href wins so nested routes highlight the most specific
 * item: on /settings/accounts the Accounts item is active, not the broader
 * Settings item at /settings. The root href "/" matches only the exact
 * path. Returns null when no nav item matches (e.g. a route with no item).
 */
export function resolveActiveHref(
  pathname: string,
  sections: NavSection[] = NAV_SECTIONS
): string | null {
  let best: string | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (itemMatches(item.href, pathname) && (best === null || item.href.length > best.length)) {
        best = item.href;
      }
    }
  }
  return best;
}

function itemMatches(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
