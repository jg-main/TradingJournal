'use client';

import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface HelpTooltipProps {
  /** The help text shown inside the tooltip. */
  content: string;
  /** Tooltip side placement. Default: 'top'. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Optional className for the icon wrapper. */
  className?: string;
}

/**
 * Reusable contextual help icon with a tooltip.
 *
 * Renders a muted HelpCircle icon that shows `content` on hover.
 * Designed for inline use next to form labels, section headings, or
 * any UI element that benefits from brief explanatory text.
 *
 * @example
 * ```tsx
 * <HelpTooltip content="This setting controls your max risk per trade." />
 * ```
 */
export function HelpTooltip({ content, side = 'top', className }: HelpTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            className,
          )}
          aria-label={content}
        >
          <HelpCircle className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-64 text-pretty">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
