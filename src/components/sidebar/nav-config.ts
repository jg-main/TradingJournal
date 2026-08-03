import {
  LayoutDashboard,
  Eye,
  NotebookPen,
  Star,
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
 * - Trading: the daily workflow (dashboard, watchlist, trades, review, checks)
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
      { href: '/watchlist', label: 'Watchlist', icon: Eye },
      { href: '/trades', label: 'Trades', icon: NotebookPen },
      { href: '/reviews', label: 'Reviews', icon: Star },
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
