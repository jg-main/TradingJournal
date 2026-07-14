'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
import { GripVertical, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

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
        'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 select-none dark:text-zinc-400',
        canSort && 'cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300',
      )}
      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
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
          {canSort && !sortDir && <ArrowUpDown className="size-3 text-zinc-300 dark:text-zinc-600" />}
        </span>
      </div>
    </th>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export default function DynamicTable<TData>({
  data,
  columns,
  storageKey,
  onRowClick,
  rowClassName,
  emptyState,
  className,
  initialVisibility,
}: DynamicTableProps<TData>) {
  const router = useRouter();

  // Load saved state from localStorage
  const [sorting, setSorting] = useState<SortingState>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}:sorting`);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}:visibility`);
      const saved = raw ? JSON.parse(raw) : {};
      return { ...initialVisibility, ...saved };
    } catch { return initialVisibility ?? {}; }
  });

  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}:order`);
      return raw ? JSON.parse(raw) : columns.map(c => c.id!);
    } catch { return columns.map(c => c.id!); }
  });

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

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={cn('overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800', className)}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <table className="w-full text-sm">
          <SortableContext items={table.getState().columnOrder} strategy={horizontalListSortingStrategy}>
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
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
              role={onRowClick ? 'link' : undefined}
              className={cn(
                'border-b border-zinc-100 transition-colors dark:border-zinc-800',
                onRowClick && 'cursor-pointer hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-400 dark:hover:bg-zinc-900/50 dark:focus-visible:ring-zinc-500',
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
  );
}
