'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  NotebookPen,
  Eye,
  Bell,
  Target,
  Star,
  Settings,
  HelpCircle,
  Menu,
  type LucideIcon,
  X,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/trades', label: 'Trade Log', icon: NotebookPen },
  { href: '/watchlist', label: 'Watchlist', icon: Eye },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/sizing', label: 'Position Sizing', icon: Target },
  { href: '/reviews', label: 'Reviews', icon: Star },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/help', label: 'Help & Docs', icon: HelpCircle },
];

export function Sidebar() {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed left-3 top-3 z-40 flex min-w-11 min-h-11 items-center justify-center rounded-lg border bg-background shadow-sm md:hidden"
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        {sidebarOpen ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>

      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={
        'fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r bg-background transition-transform duration-200 md:static md:translate-x-0 ' +
        (sidebarOpen ? 'translate-x-0' : '-translate-x-full')
      }>
      {/* Brand */}
      <div className="flex h-14 items-center gap-2 border-b px-5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-foreground text-xs font-bold text-background dark:bg-secondary dark:text-secondary-foreground">
          TJ
        </div>
        <span className="text-sm font-semibold text-foreground">
          Trading Journal
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 p-2">
        {navItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-2">
        <ThemeToggle />
        <p className="mt-1 text-center text-xs text-muted-foreground">
          v0.1.0
        </p>
      </div>
    </aside>
    </>
  );
}
