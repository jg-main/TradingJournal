'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  EllipsisVertical,
  Eye,
  Pencil,
  PlusCircle,
  SlidersHorizontal,
  Star,
  AlertTriangle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

/** Minimal row shape ActionsCell needs from the trades list row. */
export interface ActionsCellRow {
  id: string;
  status: 'planned' | 'open' | 'closed' | 'deleted';
}

/**
 * Status-aware actions dropdown menu.
 *
 * Lives inside a DynamicTable row whose onRowClick navigates to /trades/{id}.
 * The trigger's click and keydown events are stopPropagation'd so opening the
 * menu does not bubble up to the row and navigate away. Radix composes child
 * handlers first, so the menu still opens (pointerdown / composed keydown)
 * while the click event never reaches the <tr>.
 */
export function ActionsCell({ row }: { row: ActionsCellRow }) {
  const router = useRouter();

  const statusActions = useMemo(() => {
    const go = () => router.push(`/trades/${row.id}`);
    switch (row.status) {
      case 'planned':
        return (
          <DropdownMenuItem onClick={go}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
        );
      case 'open':
        return (
          <>
            <DropdownMenuItem onClick={go}>
              <PlusCircle className="size-4" />
              Add Exit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={go}>
              <SlidersHorizontal className="size-4" />
              Adjust Stop
            </DropdownMenuItem>
          </>
        );
      case 'closed':
        return (
          <>
            <DropdownMenuItem onClick={go}>
              <Star className="size-4" />
              Grade
            </DropdownMenuItem>
            <DropdownMenuItem onClick={go}>
              <AlertTriangle className="size-4" />
              Log Mistake
            </DropdownMenuItem>
          </>
        );
      default:
        return null;
    }
  }, [row.status, row.id, router]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Trade actions"
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <EllipsisVertical className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push(`/trades/${row.id}`)}>
          <Eye className="size-4" />
          View Details
        </DropdownMenuItem>
        {statusActions && <DropdownMenuSeparator />}
        {statusActions}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
