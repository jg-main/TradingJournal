'use client';

import { createContext, useContext } from 'react';

/**
 * List-page scratch event propagation (M015/S02/T01).
 *
 * ActionsCell is rendered from module-level column definitions, so the trades
 * list page cannot pass callbacks to it as props. Instead, the page provides
 * this context with a `requestScratch` handler; ActionsCell calls it when the
 * user picks the Scratch menu item on a planned row. The page owns the
 * ConfirmDialog, the DELETE /api/trades/[id] call, and the planned-tab
 * refetch — ActionsCell stays a dumb trigger.
 *
 * The default value is a no-op so standalone renderings of ActionsCell
 * (unit tests, legacy surfaces) keep working without a provider.
 */
export interface TradesScratchContextValue {
  /** Open the scratch confirmation for a planned trade. */
  requestScratch: (tradeId: string) => void;
}

export const TradesScratchContext = createContext<TradesScratchContextValue>({
  requestScratch: () => {},
});

export function useTradesScratch(): TradesScratchContextValue {
  return useContext(TradesScratchContext);
}
