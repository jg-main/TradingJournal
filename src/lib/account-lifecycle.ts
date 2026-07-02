export type AccountTradeStatus = {
  status: string;
};

export type AccountLifecycleSnapshot = {
  hasTrades: boolean;
  hasClosedTrades: boolean;
  hasOpenTrades: boolean;
};

function isOpenTradeStatus(status: string) {
  return status !== 'closed';
}

export function classifyAccountLifecycle(trades: AccountTradeStatus[]): AccountLifecycleSnapshot {
  const hasTrades = trades.length > 0;
  const hasClosedTrades = trades.some((trade) => trade.status === 'closed');
  const hasOpenTrades = trades.some((trade) => isOpenTradeStatus(trade.status));

  return { hasTrades, hasClosedTrades, hasOpenTrades };
}

export function canDeleteAccount(trades: AccountTradeStatus[]) {
  return !classifyAccountLifecycle(trades).hasTrades;
}

export function canDeactivateAccount(trades: AccountTradeStatus[]) {
  return !classifyAccountLifecycle(trades).hasOpenTrades;
}

export function canReactivateAccount(trades: AccountTradeStatus[]) {
  return !classifyAccountLifecycle(trades).hasOpenTrades;
}
