'use client';

/**
 * Trade detail dense grid shell (M020/S01).
 *
 * `TradeDetailGrid` renders the `.td` scope (density tokens) with the
 * `.td-grid` CSS grid beneath it. `TradeDetailPanel` is the single panel
 * primitive: it renders `.td-panel` chrome (header + body) and assigns the
 * panel to a named grid area via `data-area`. At the wide breakpoint,
 * `TradeDetailStack` keeps the left and right panel pairs independent so a
 * short Context panel never inherits Cockpit's grid-row height.
 *
 * The grid is a fixed layout per phase — monitoring (open trades), planned,
 * and closed — it is intentionally not user-customizable, so no
 * react-grid-layout is involved (D073).
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './trade-detail-grid.css';

/** Named grid areas for the trade detail grid. */
export type TradeDetailArea =
  | 'lifecycle'
  | 'cockpit'
  | 'risk'
  | 'history'
  | 'review'
  | 'context'
  /** Planned-phase arrangement: plan definition, narrative, and assessment. */
  | 'plan';

/** Wide monitoring side stacks; they flatten into direct panel items below 1600px. */
export type TradeDetailStackArea = 'left' | 'right';

/**
 * Grid arrangement variants.
 * - `monitoring` (default): lifecycle first, then cockpit | risk | context /
 *   history | risk | review at >=1600px, using independent side stacks.
 * - `planned`: lifecycle followed by the plan surface; assets remain below in
 *   document flow.
 * - `closed`: lifecycle first, then the frozen snapshot and review with the
 *   same wide-screen hierarchy as monitoring.
 */
export type TradeDetailGridVariant = 'monitoring' | 'planned' | 'closed';

interface TradeDetailGridProps {
  children: ReactNode;
  className?: string;
  /** Grid arrangement variant; defaults to the monitoring grid. */
  variant?: TradeDetailGridVariant;
  /** Removes the reserved context slot when this trade has no narrative. */
  hasContextContent?: boolean;
}

export function TradeDetailGrid({
  children,
  className,
  variant = 'monitoring',
  hasContextContent = true,
}: TradeDetailGridProps) {
  return (
    <div className={cn('td', className)}>
      <div
        className={cn(
          'td-grid',
          variant === 'planned' && 'td-grid--planned',
          variant === 'closed' && 'td-grid--closed',
          !hasContextContent && variant !== 'planned' && 'td-grid--without-context',
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface TradeDetailStackProps {
  /** The wide-screen column this panel stack occupies. */
  area: TradeDetailStackArea;
  children: ReactNode;
}

export function TradeDetailStack({ area, children }: TradeDetailStackProps) {
  return <div className="td-grid-stack" data-area={area}>{children}</div>;
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
