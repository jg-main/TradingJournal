import { cn } from '@/lib/utils';

interface SidebarBrandProps {
  collapsed?: boolean;
}

/**
 * Sidebar brand block: TJ mark, product name, and version inline.
 * Quiet and compact — operational tool, not marketing surface.
 * Collapsed mode shows the mark only.
 */
export function SidebarBrand({ collapsed = false }: SidebarBrandProps) {
  return (
    <div
      className={cn(
        'flex h-14 items-center gap-2 border-b border-sidebar-border',
        collapsed ? 'justify-center px-0' : 'px-5'
      )}
    >
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
        TJ
      </div>
      {!collapsed && (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold leading-tight text-sidebar-foreground">
            Trading Journal
          </span>
          <span className="text-[10px] leading-tight text-sidebar-foreground/50">
            v0.1.0
          </span>
        </div>
      )}
    </div>
  );
}
