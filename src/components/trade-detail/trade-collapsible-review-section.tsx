'use client';

/**
 * TradeCollapsibleReviewSection (M020/S04).
 *
 * Progressive-disclosure unit for the closed-trade review column: a header
 * button (title + optional meta + chevron) over an expandable body. Wraps
 * the shadcn/Radix Collapsible primitive so each section inherits the
 * standard `data-state` attributes (open/closed), keyboard behavior
 * (Enter/Space toggles), and `aria-expanded` wiring for free.
 *
 * Collapsed by default per the design system — collapsibles are for
 * auxiliary detail in dense surfaces, and critical risk or warnings must
 * never hide inside them (the checklist and snapshot stay visible).
 *
 * Chrome lives in `trade-detail-grid.css` under the `.td-review-section`
 * rules (the grid is the owning phase surface). Legacy cards rendered
 * inside the content drop their own ring/background via the shared
 * card-strip rule, so each section reads as one bordered unit.
 */

import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export interface TradeCollapsibleReviewSectionProps {
  /** Section heading; also the trigger's accessible name. */
  title: string;
  /** Optional right-aligned meta (e.g. grade badge, mistake count). */
  meta?: ReactNode;
  /** Expand on first paint; defaults to collapsed. */
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

export function TradeCollapsibleReviewSection({
  title,
  meta,
  defaultOpen = false,
  className,
  children,
}: TradeCollapsibleReviewSectionProps) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={cn('td-review-section', className)}
    >
      <CollapsibleTrigger className="td-review-section-trigger">
        <span className="td-review-section-title">{title}</span>
        {meta != null && <span className="td-review-section-meta">{meta}</span>}
        <ChevronDown className="td-review-section-chevron" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="td-review-section-content">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
