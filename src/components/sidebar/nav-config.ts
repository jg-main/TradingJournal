import {
  LayoutDashboard,
  Eye,
  NotebookPen,
  Star,
  ClipboardCheck,
  Target,
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
 * Grouped navigation for the legacy shell sidebar.
 * Order matters: sections render top-to-bottom in this sequence.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/watchlist', label: 'Watchlist', icon: Eye },
    ],
  },
  {
    label: 'Trading',
    items: [
      { href: '/trades', label: 'Trades', icon: NotebookPen },
      { href: '/reviews', label: 'Reviews', icon: Star },
      { href: '/checks', label: 'Checks', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Tools',
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
