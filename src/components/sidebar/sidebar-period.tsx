'use client';

import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOperationalDateRange } from '@/lib/operational-date-range-context';
import {
  OPERATIONAL_DATE_PRESETS,
  isValidCustomRange,
} from '@/lib/operational-date-range';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface SidebarPeriodProps {
  collapsed?: boolean;
}

/**
 * Global operational period selector hosted in the sidebar (M004/T9B).
 *
 * Consumes the single canonical OperationalDateRangeProvider — this component
 * owns NO period state and NO persistence. It holds only transient UI draft
 * state while editing a Custom range.
 *
 * Expanded: compact control directly below the Account selector.
 * Collapsed: compact icon trigger with a tooltip identifying the current
 * period; opens the same selector interaction.
 */
export function SidebarPeriod({ collapsed = false }: SidebarPeriodProps) {
  const { selection, resolvedRange, hydrated, setPreset, setCustomRange } = useOperationalDateRange();
  const [open, setOpen] = useState(false);
  const [editingCustom, setEditingCustom] = useState(false);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');

  const label = selection.preset;

  if (!hydrated) {
    return (
      <div className={cn('border-b border-sidebar-border p-2', collapsed && 'flex justify-center')}>
        <div
          className={cn(
            'animate-pulse rounded-lg bg-sidebar-accent',
            collapsed ? 'size-9' : 'h-9 w-full',
          )}
          data-testid="sidebar-period-loading"
        />
      </div>
    );
  }

  const openCustomEditor = () => {
    setEditingCustom(true);
    // Draft initializes from the current global selection (Custom) or from
    // the currently resolved range so the user edits the period in effect.
    if (selection.preset === 'Custom') {
      setDraftFrom(selection.from);
      setDraftTo(selection.to);
    } else {
      setDraftFrom(resolvedRange.from);
      setDraftTo(resolvedRange.to);
    }
  };

  const cancelCustomEditor = () => {
    setEditingCustom(false);
    setDraftFrom('');
    setDraftTo('');
  };

  const applyCustomRange = () => {
    setCustomRange(draftFrom, draftTo);
    cancelCustomEditor();
    setOpen(false);
  };

  const customValid = isValidCustomRange(draftFrom, draftTo);

  const popover = (
    <PopoverContent align="start" sideOffset={8} className="w-56 p-2">
      <div className="space-y-0.5">
        {OPERATIONAL_DATE_PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            variant={preset === selection.preset && !editingCustom ? 'secondary' : 'ghost'}
            size="sm"
            className="w-full justify-start px-2"
            data-testid={`period-preset-${preset}`}
            onClick={() => {
              if (preset === 'Custom') {
                openCustomEditor();
              } else {
                setPreset(preset);
                setOpen(false);
              }
            }}
          >
            {preset}
          </Button>
        ))}
      </div>

      {editingCustom && (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="period-custom-from" className="text-xs text-muted-foreground">
              From
            </label>
            <Input
              id="period-custom-from"
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              aria-label="Custom period from"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="period-custom-to" className="text-xs text-muted-foreground">
              To
            </label>
            <Input
              id="period-custom-to"
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              aria-label="Custom period to"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={applyCustomRange}
              disabled={!customValid}
              data-testid="period-custom-apply"
            >
              Apply
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cancelCustomEditor}
              data-testid="period-custom-cancel"
            >
              Cancel
            </Button>
          </div>
          {!customValid && (
            <p className="text-xs text-destructive" role="alert">
              From must be a valid date no later than To.
            </p>
          )}
        </div>
      )}
    </PopoverContent>
  );

  if (collapsed) {
    return (
      <div className="flex justify-center border-b border-sidebar-border p-2">
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  aria-label={`Period: ${label}`}
                  data-testid="sidebar-period-collapsed-trigger"
                >
                  <CalendarRange className="size-4" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              Period: {label}
            </TooltipContent>
          </Tooltip>
          {popover}
        </Popover>
      </div>
    );
  }

  return (
    <div className="border-b border-sidebar-border p-2" data-testid="sidebar-period">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-full justify-start gap-2 text-xs"
            aria-label={`Period: ${label}`}
            data-testid="sidebar-period-trigger"
          >
            <CalendarRange className="size-3.5" />
            {label}
          </Button>
        </PopoverTrigger>
        {popover}
      </Popover>
    </div>
  );
}
