'use client';

/**
 * Trade detail dense grid shell (M020/S01).
 *
 * `TradeDetailGrid` renders the `.td` scope (density tokens) with the
 * `.td-grid` CSS grid beneath it. `TradeDetailPanel` is the single panel
 * primitive: it renders `.td-panel` chrome (header + body) and assigns the
 * panel to a named grid area via `data-area`, which the grid CSS maps to
 * `grid-area`.
 *
 * The grid is a fixed layout per phase (open trades here; planned/closed
 * phases get their own arrangements in later slices) — it is intentionally
 * not user-customizable, so no react-grid-layout is involved (D073).
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './trade-detail-grid.css';

/** Named grid areas for the open-trade (monitoring) grid. */
export type TradeDetailArea = 'cockpit' | 'risk' | 'history' | 'review';

interface TradeDetailGridProps {
  children: ReactNode;
  className?: string;
}

export function TradeDetailGrid({ children, className }: TradeDetailGridProps) {
  return (
    <div className={cn('td', className)}>
      <div className="td-grid">{children}</div>
    </div>
  );
}

interface TradeDetailPanelProps {
  /** Which named grid area this panel occupies. */
  area: TradeDetailArea;
  /** Panel title bar content (optional — some areas carry their own title). */
  title?: ReactNode;
  /** Right-aligned meta content in the title bar (optional). */
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
