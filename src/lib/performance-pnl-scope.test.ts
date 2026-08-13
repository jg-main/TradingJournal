import { describe, expect, it } from 'vitest';

import {
  computePerformancePnlScope,
  DEFAULT_PERFORMANCE_PNL_SCOPE,
} from './performance-pnl-scope';

describe('computePerformancePnlScope', () => {
  it('uses realized P&L from every closed quantity and current Open P&L for Total', () => {
    expect(DEFAULT_PERFORMANCE_PNL_SCOPE).toBe('total');

    expect(
      computePerformancePnlScope({
        scope: 'total',
        realizedPnl: '17.70',
        openPnl: '2.00',
        valuationState: 'complete',
      }),
    ).toEqual({
      label: 'Total P&L',
      value: '19.70',
      description: 'Realized + current marks',
    });
  });

  it('keeps partial-exit P&L visible when a live valuation is unavailable', () => {
    expect(
      computePerformancePnlScope({
        scope: 'realized',
        realizedPnl: '17.70',
        openPnl: null,
        valuationState: 'partial',
      }),
    ).toEqual({
      label: 'Realized P&L',
      value: '17.70',
      description: 'All exits, including partials',
    });

    expect(
      computePerformancePnlScope({
        scope: 'total',
        realizedPnl: '17.70',
        openPnl: null,
        valuationState: 'partial',
      }),
    ).toEqual({
      label: 'Total P&L',
      value: null,
      description: 'Partial valuation',
    });
  });
});
