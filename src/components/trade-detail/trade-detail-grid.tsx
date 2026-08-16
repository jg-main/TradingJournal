'use client';

/**
 * Fixed, phase-aware trade-detail grid shell.
 *
 * Open and closed trades use three continuous desktop columns beneath
 * Lifecycle: Cockpit → Context, Trade Details → History, and Risk → Review.
 * Assets span underneath the three columns.
 * Planned trades retain their dedicated plan surface. This is a reading and
 * management layout, never a customizable canvas.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './trade-detail-grid.css';

export type TradeDetailArea =
  | 'lifecycle'
  | 'cockpit'
  | 'details'
  | 'risk'
  | 'context'
  | 'history'
  | 'review'
  | 'assets'
  | 'plan';

export type TradeDetailGridVariant = 'monitoring' | 'planned' | 'closed';
export type TradeDetailColumnArea = 'left' | 'details' | 'right';

interface TradeDetailGridProps {
  children: ReactNode;
  className?: string;
  variant?: TradeDetailGridVariant;
}

export function TradeDetailGrid({
  children,
  className,
  variant = 'monitoring',
}: TradeDetailGridProps) {
  return (
    <div className={cn('td', className)}>
      <div
        className={cn(
          'td-grid',
          variant === 'planned' && 'td-grid--planned',
          variant === 'closed' && 'td-grid--closed',
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface TradeDetailColumnProps {
  area: TradeDetailColumnArea;
  className?: string;
  children: ReactNode;
}

/** A continuous management column; its panels never wait for another column. */
export function TradeDetailColumn({ area, className, children }: TradeDetailColumnProps) {
  return (
    <div className={cn('td-grid-column', className)} data-area={area}>
      {children}
    </div>
  );
}

interface TradeDetailPanelProps {
  area: TradeDetailArea;
  title?: ReactNode;
  meta?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function TradeDetailPanel({
  area,
  title,
  meta,
  className,
  children,
}: TradeDetailPanelProps) {
  return (
    <section className={cn('td-panel', className)} data-area={area} tabIndex={-1}>
      {(title != null || meta != null) && (
        <header className="td-panel-header">
          {title != null && <span className="td-panel-title">{title}</span>}
          {meta != null && <span className="td-panel-meta">{meta}</span>}
        </header>
      )}
      <div className="td-panel-body">{children}</div>
    </section>
  );
}
