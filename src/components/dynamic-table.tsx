'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  type ColumnOrderState,
  type Row,
  type Header,
  flexRender,
} from '@tanstack/react-table';
import {
  DndContext,
  type DragEndEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ArrowUpDown, ArrowUp, ArrowDown, Columns3 } from 'lucide-react';
import { cn } from '@/lib/utils';

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

// ── Types ──────────────────────────────────────────────────────────────

export interface DynamicTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  storageKey: string;
  onRowClick?: (row: Row<TData>) => void;
  rowClassName?: (row: Row<TData>) => string;
  emptyState?: React.ReactNode;
  className?: string;
  initialVisibility?: VisibilityState;
  /** Enable the column visibility dropdown selector */
  columnSelector?: boolean;
  /** Column IDs that cannot be hidden via the dropdown or persistence */
  alwaysVisible?: string[];
}

// ── Draggable header ───────────────────────────────────────────────────

function DraggableHeader<TData>({ header }: { header: Header<TData, unknown> }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: header.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const canSort = header.column.getCanSort();
  const sortDir = header.column.getIsSorted();
  const ariaSortValue = canSort
    ? sortDir === 'asc'
      ? 'ascending'
      : sortDir === 'desc'
        ? 'descending'
        : 'none'
    : undefined;

  return (
    <th
      ref={setNodeRef}
      style={style}
      colSpan={header.colSpan}
      aria-sort={ariaSortValue}
      className={cn(
        'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground select-none',
        canSort && 'cursor-pointer hover:text-foreground',
      )}
      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          aria-label={`Drag to reorder ${header.column.id} column`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3" />
        </button>
        <span className="flex items-center gap-0.5">
          {flexRender(header.column.columnDef.header, header.getContext())}
          {sortDir === 'asc' && <ArrowUp className="size-3" />}
          {sortDir === 'desc' && <ArrowDown className="size-3" />}
          {canSort && !sortDir && <ArrowUpDown className="size-3 text-muted-foreground" />}
        </span>
      </div>
    </th>
  );
}

// ── Main component ─────────────────────────────────────────────────────

/** Derive a human-readable label for a column from its header text or id. */
function getColumnLabel(col: { id: string; columnDef: { header?: unknown } }): string {
  const header = col.columnDef.header;
  if (typeof header === 'string' && header.trim().length > 0) return header;
  // Fallback: title-case the id
  return col.id
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

export default function DynamicTable<TData>({
  data,
  columns,
  storageKey,
  onRowClick,
  rowClassName,
  emptyState,
  className,
  initialVisibility,
  columnSelector,
  alwaysVisible,
}: DynamicTableProps<TData>) {
  // Ensure alwaysVisible columns are never hidden
  const safeInitialVisibility = useMemo(() => {
    if (!alwaysVisible) return initialVisibility ?? {};
    return {
      ...initialVisibility,
      ...Object.fromEntries(alwaysVisible.map((id) => [id, true])),
    };
  }, [initialVisibility, alwaysVisible]);

  // Load saved state from localStorage
  const [sorting, setSorting] = useState<SortingState>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}:sorting`);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const [columnVisibility, _setColumnVisibility] = useState<VisibilityState>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}:visibility`);
      const saved = raw ? JSON.parse(raw) : {};
      // Guard: strip any hidden overrides for alwaysVisible columns from saved data
      if (alwaysVisible) {
        for (const id of alwaysVisible) {
          if (saved[id] === false) delete saved[id];
        }
      }
      return { ...safeInitialVisibility, ...saved };
    } catch { return safeInitialVisibility; }
  });

  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}:order`);
      return raw ? JSON.parse(raw) : columns.map(c => c.id!);
    } catch { return columns.map(c => c.id!); }
  });

  // Wrapped setter that prevents hiding alwaysVisible columns
  const setColumnVisibility = useCallback(
    (updater: React.SetStateAction<VisibilityState>) => {
      _setColumnVisibility((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (alwaysVisible) {
          for (const id of alwaysVisible) {
            if (next[id] === false) delete next[id];
          }
        }
        return next;
      });
    },
    [alwaysVisible],
  );

  // Persist changes
  useEffect(() => { localStorage.setItem(`${storageKey}:sorting`, JSON.stringify(sorting)); }, [sorting, storageKey]);
  useEffect(() => { localStorage.setItem(`${storageKey}:visibility`, JSON.stringify(columnVisibility)); }, [columnVisibility, storageKey]);
  useEffect(() => { localStorage.setItem(`${storageKey}:order`, JSON.stringify(columnOrder)); }, [columnOrder, storageKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setColumnOrder(prev => {
        const old = prev.indexOf(active.id as string);
        const newIdx = prev.indexOf(over.id as string);
        const next = [...prev];
        next.splice(old, 1);
        next.splice(newIdx, 0, active.id as string);
        return next;
      });
    }
  }, []);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, columnOrder },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
  });

  const hideableLeafColumns = useMemo(() => {
    return table
      .getAllLeafColumns()
      .filter((col) => !alwaysVisible?.includes(col.id));
  }, [table, alwaysVisible]);

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="space-y-2">
      {/* ── Column selector toolbar ───────────────────────────── */}
      {columnSelector && hideableLeafColumns.length > 0 && (
        <div className="flex items-center justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Columns3 className="size-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {hideableLeafColumns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(checked) => col.toggleVisibility(!!checked)}
                >
                  {getColumnLabel(col)}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => {
                table.getAllLeafColumns().forEach((col) => {
                  if (!alwaysVisible?.includes(col.id)) {
                    col.toggleVisibility(true);
                  }
                });
              }}>
                Show All
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => {
                setColumnVisibility(safeInitialVisibility);
              }}>
                Reset to Defaults
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div className={cn('overflow-x-auto rounded-lg border', className)}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <table className="w-full text-sm">
          <SortableContext items={table.getState().columnOrder} strategy={horizontalListSortingStrategy}>
            <thead>
              <tr className="border-b bg-muted">
                {table.getFlatHeaders().map(header => (
                  <DraggableHeader key={header.id} header={header} />
                ))}
              </tr>
            </thead>
          </SortableContext>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row)}
              onKeyDown={e => { if (e.key === 'Enter') onRowClick?.(row); }}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn(
                'border-b transition-colors',
                onRowClick && 'cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                rowClassName?.(row),
              )}
            >
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="px-3 py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </DndContext>
    </div>
    </div>
  );
}
