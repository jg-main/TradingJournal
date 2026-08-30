/**
 * Component tests for the shared trade formatters (M004/T2).
 *
 * Proves:
 *  - financial cells use canonical semantic tokens (text-positive /
 *    text-negative / text-muted-foreground) instead of arbitrary
 *    emerald/red utilities
 *  - zero/null values stay muted
 *  - DirectionBadge is neutral (no positive/negative/destructive semantics)
 *    and keeps the exact Long / Short labels
 *  - numeric formatting output is unchanged
 *
 * Run: npx vitest run src/lib/trade-formatters.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PnlCell,
  PercentCell,
  RCell,
  DirectionBadge,
  formatCurrency,
  formatPercent,
  formatRMultiple,
} from './trade-formatters';

// ── Numeric output unchanged ────────────────────────────────────────────

describe('numeric formatter output (unchanged)', () => {
  it('formats currency exactly as before', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    expect(formatCurrency(-1234.5)).toBe('-$1,234.50');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(undefined)).toBe('—');
  });

  it('formats percentages exactly as before', () => {
    expect(formatPercent(0.0342)).toBe('+3.42%');
    expect(formatPercent(-0.05)).toBe('-5.00%');
    expect(formatPercent(null)).toBe('—');
  });

  it('formats R multiples exactly as before', () => {
    expect(formatRMultiple(1.5)).toBe('+1.50R');
    expect(formatRMultiple(-0.75)).toBe('-0.75R');
    expect(formatRMultiple(null)).toBe('—');
  });
});

// ── Financial cell semantics ────────────────────────────────────────────

describe('PnlCell', () => {
  it('uses text-positive for positive values', () => {
    render(<PnlCell value={1234.5} />);
    expect(screen.getByText('$1,234.50').className).toContain('text-positive');
  });

  it('uses text-negative for negative values', () => {
    render(<PnlCell value={-1234.5} />);
    expect(screen.getByText('-$1,234.50').className).toContain('text-negative');
  });

  it('uses text-muted-foreground for zero', () => {
    render(<PnlCell value={0} />);
    expect(screen.getByText('$0.00').className).toContain('text-muted-foreground');
  });

  it('uses text-muted-foreground for null', () => {
    render(<PnlCell value={null} />);
    expect(screen.getByText('—').className).toContain('text-muted-foreground');
  });
});

describe('PercentCell', () => {
  it('uses text-positive for positive values', () => {
    render(<PercentCell value={0.0342} />);
    expect(screen.getByText('+3.42%').className).toContain('text-positive');
  });

  it('uses text-negative for negative values', () => {
    render(<PercentCell value={-0.05} />);
    expect(screen.getByText('-5.00%').className).toContain('text-negative');
  });

  it('uses text-muted-foreground for zero', () => {
    render(<PercentCell value={0} />);
    expect(screen.getByText('+0.00%').className).toContain('text-muted-foreground');
  });

  it('uses text-muted-foreground for null', () => {
    render(<PercentCell value={null} />);
    expect(screen.getByText('—').className).toContain('text-muted-foreground');
  });
});

describe('RCell', () => {
  it('uses text-positive for positive values', () => {
    render(<RCell value={1.5} />);
    expect(screen.getByText('+1.50R').className).toContain('text-positive');
  });

  it('uses text-negative for negative values', () => {
    render(<RCell value={-0.75} />);
    expect(screen.getByText('-0.75R').className).toContain('text-negative');
  });

  it('uses text-muted-foreground for zero', () => {
    render(<RCell value={0} />);
    expect(screen.getByText('+0.00R').className).toContain('text-muted-foreground');
  });

  it('uses text-muted-foreground for null', () => {
    render(<RCell value={null} />);
    expect(screen.getByText('—').className).toContain('text-muted-foreground');
  });
});

// ── Direction is not P&L ────────────────────────────────────────────────

describe('DirectionBadge', () => {
  it.each(['Long', 'Short'] as const)('keeps the exact %s label', (label) => {
    render(<DirectionBadge direction={label === 'Long' ? 'long' : 'short'} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('Long carries no financial color semantics', () => {
    render(<DirectionBadge direction="long" />);
    const cls = screen.getByText('Long').className;
    expect(cls).not.toContain('positive');
    expect(cls).not.toContain('negative');
    expect(cls).not.toContain('destructive');
    expect(cls).not.toContain('emerald');
    expect(cls).not.toContain('red');
    expect(cls).not.toContain('green');
  });

  it('Short carries no financial color semantics', () => {
    render(<DirectionBadge direction="short" />);
    const cls = screen.getByText('Short').className;
    expect(cls).not.toContain('positive');
    expect(cls).not.toContain('negative');
    expect(cls).not.toContain('destructive');
    expect(cls).not.toContain('emerald');
    expect(cls).not.toContain('red');
    expect(cls).not.toContain('green');
  });

  it('renders an em dash for a missing direction', () => {
    render(<DirectionBadge direction={null} />);
    expect(screen.getByText('—')).toBeTruthy();
  });
});
