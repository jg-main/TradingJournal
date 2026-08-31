'use client';

import { useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { Separator } from '@/components/ui/separator';
import { NAV_SECTIONS, resolveActiveHref } from './nav-config';
import { SidebarNavItem } from './nav-item';
import { SidebarBrand } from './sidebar-brand';
import { SidebarAccount } from './sidebar-account';
import { SidebarPeriod } from './sidebar-period';
import { SidebarValue } from './sidebar-value';

const COLLAPSED_STORAGE_KEY = 'sidebar:collapsed';
const COLLAPSED_CHANGE_EVENT = 'sidebar:collapsed-change';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function subscribeCollapsed(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === COLLAPSED_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(COLLAPSED_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(COLLAPSED_CHANGE_EVENT, onStoreChange);
  };
}

function getServerCollapsed(): boolean {
  return false;
}

export function Sidebar() {
  const pathname = usePathname();
  // Single active item across all sections; longest-matching-href wins so
  // nested routes (e.g. /settings/accounts) highlight the specific item.
  const activeHref = resolveActiveHref(pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, getServerCollapsed);

  // Collapsed visuals apply only on desktop. When the mobile drawer is open,
  // always render the full expanded sidebar with labels.
  const effectiveCollapsed = collapsed && !sidebarOpen;

  const toggleCollapsed = () => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '0' : '1');
      window.dispatchEvent(new Event(COLLAPSED_CHANGE_EVENT));
    } catch {
      // localStorage unavailable — leave the persisted preference unchanged
    }
  };

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
        <div className="fixed inset-0 z-30 bg-overlay md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 md:static md:translate-x-0',
          collapsed && 'md:w-14',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <SidebarBrand collapsed={effectiveCollapsed} />
        <SidebarAccount collapsed={effectiveCollapsed} />

        {/* Global operational period selector — visible on the exact primary
            operational routes migrated so far: /trades and /performance
            (M004/T9B/T9C). Workstation does not consume the global period
            until Task 9D, so the selector must never imply a surface
            consumes a context it ignores. */}
        {(pathname === '/trades' || pathname === '/performance') && (
          <SidebarPeriod collapsed={effectiveCollapsed} />
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-4 overflow-y-auto p-2">
          {NAV_SECTIONS.map((section, index) => (
            <div key={section.label}>
              {effectiveCollapsed ? (
                index > 0 && (
                  <div className="px-2 pb-2 pt-0">
                    <Separator className="bg-sidebar-border" />
                  </div>
                )
              ) : (
                <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {section.label}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <SidebarNavItem
                    key={item.href}
                    item={item}
                    isActive={activeHref === item.href}
                    collapsed={effectiveCollapsed}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <SidebarValue collapsed={effectiveCollapsed} />

        {/* Footer */}
        <div
          className={cn(
            'flex border-t border-sidebar-border p-2',
            effectiveCollapsed ? 'flex-col items-center gap-1' : 'items-center justify-between'
          )}
        >
          <ThemeToggle />
          <button
            onClick={toggleCollapsed}
            className="hidden min-h-11 min-w-11 items-center justify-center rounded-lg text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
      </aside>
    </>
  );
}
