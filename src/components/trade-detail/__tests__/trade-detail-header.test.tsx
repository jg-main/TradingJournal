/**
 * TradeDetailHeader workflow-phase badge tests (S05/T03).
 *
 * The header shows the derived workflow phase alongside the economic status:
 * a managed open trade renders an extra "Managed" (info-tint) badge next to
 * the "Open" status badge; other phases render nothing extra (the status
 * badge already carries the label). The setup editor for open trades is
 * unchanged.
 *
 * Run: npx vitest run src/components/trade-detail/__tests__/trade-detail-header.test.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import TradeDetailHeader from '@/components/trade-detail/trade-detail-header';

const baseProps = {
  symbol: 'AAPL',
  status: 'open' as const,
  direction: 'long' as const,
  tradeCode: 'TC-001',
};

describe('TradeDetailHeader workflow phase badge (S05/T03)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows a Managed badge next to the Open status badge when workflowPhase=managed', () => {
    render(<TradeDetailHeader {...baseProps} workflowPhase="managed" />);

    // Economic status badge (unchanged) + derived phase badge
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Managed')).toBeTruthy();
  });

  it('shows only the Open status badge when workflowPhase=open (no extra badge)', () => {
    render(<TradeDetailHeader {...baseProps} workflowPhase="open" />);

    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.queryByText('Managed')).toBeNull();
  });

  it('does not render a Managed badge when workflowPhase is omitted', () => {
    render(<TradeDetailHeader {...baseProps} />);

    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.queryByText('Managed')).toBeNull();
  });

  it('does not render a Managed badge for a planned trade', () => {
    render(<TradeDetailHeader {...baseProps} status="planned" workflowPhase="planned" />);

    expect(screen.getByText('Planned')).toBeTruthy();
    expect(screen.queryByText('Managed')).toBeNull();
  });

  it('does not render a Managed badge for a closed trade', () => {
    render(<TradeDetailHeader {...baseProps} status="closed" workflowPhase="closed" />);

    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByText('Managed')).toBeNull();
  });

  it('keeps the setup editor available for open trades', () => {
    render(
      <TradeDetailHeader
        {...baseProps}
        setupName="Breakout"
        tradeId="trade-001"
        onTradeChanged={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByLabelText('Edit setup')).toBeTruthy();
    expect(screen.getByText('Breakout')).toBeTruthy();
  });
});
