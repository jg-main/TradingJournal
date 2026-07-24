'use client';

// WorkstationContext — single owner of workstation account + scenario state.
//
// Owns:
//   - the active fixture scenario (S06 swaps this for a live data source)
//   - the active account id and the account list available to the toolbar
//   - the memoized fixture payload for the active scenario
//
// Per AGENTS.md state rules: shared workstation state has exactly one owner.
// Panels consume this context; they never fetch independently.
//
// Failure mode: `getWorkstationFixtures` throws on an unknown scenario id.
// The provider validates the id with `isWorkstationScenarioId` before it ever
// reaches the builder, and falls back to 'default' — so a malformed
// ?scenario= query param can never crash the shell; it degrades to the
// default scenario instead.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  getWorkstationFixtures,
  isWorkstationScenarioId,
  warnFixtureMode,
  WORKSTATION_SCENARIO_IDS,
  MARKET_INDEX_SYMBOLS,
  type WorkstationFixtures,
  type WorkstationScenarioId,
} from '@/lib/workstation-fixtures';

import {
  fetchAllLiveDashboardData,
  fetchAccountsLive,
  fetchWatchlistPricesLive,
  adaptV2Account,
  adaptMarketIndices,
  adaptSymbolPrices,
  buildTradeIdeasFromWatchlist,
  type LiveDashboardData,
  type WorkstationAccount,
} from '@/lib/workstation-live-adapter';

/** Re-export the account shape so the toolbar and other consumers
 *  can rely on a single source of truth. */
export type { WorkstationAccount } from '@/lib/workstation-live-adapter';

/** MTM polling lifecycle states exposed for the toolbar indicator. */
export type MtmPollingState = 'active' | 'paused' | 'error';

/** Derive a WorkstationFixtures payload from live dashboard data.
 *  Populates marketIndices, symbolPrices, and tradeIdeas from the
 *  live price data when available; empty arrays/sets when not. */
function liveDataToFixtures(
  data: LiveDashboardData,
  prices: Record<string, import('@/lib/market-quote').QuoteResult> | null,
): WorkstationFixtures {
  const account = adaptV2Account(data.dashboardV2.account);

  // Derive market indices and symbol prices from live price data.
  const marketIndices = prices ? adaptMarketIndices(prices) : [];
  const symbolPrices = prices
    ? adaptSymbolPrices(prices, data.watchlist)
    : {};

  // Build a setup name lookup from the dashboard's setup ranking.
  const setupNames: Record<string, string> = {};
  for (const sr of data.dashboard.setupRanking) {
    if (sr.setupId) {
      setupNames[sr.setupId] = sr.setupName;
    }
  }

  const tradeIdeas = buildTradeIdeasFromWatchlist(
    data.watchlist,
    symbolPrices,
    setupNames,
  );

  return {
    scenario: 'default',
    account,
    dashboard: data.dashboard,
    dashboardV2: data.dashboardV2,
    watchlist: data.watchlist,
    marketIndices,
    symbolPrices,
    positions: data.positions,
    risk: data.risk,
    tradeIdeas,
  };
}

export interface WorkstationContextValue {
  scenario: WorkstationScenarioId;
  setScenario: (scenario: WorkstationScenarioId) => void;
  scenarios: readonly WorkstationScenarioId[];
  fixtures: WorkstationFixtures;
  accounts: { id: string; name: string; currency: string }[];
  activeAccountId: string;
  setActiveAccountId: (id: string) => void;
  /** True while panels render synthetic fixture data (pre-S06). */
  fixtureMode: boolean;
  /** True when the workstation is connected to live /api endpoints. */
  liveMode: boolean;
  /** True while a live data fetch is in flight. */
  isLoading: boolean;
  /** Last fetch error message, or null when the last fetch succeeded. */
  error: string | null;
  /** MTM polling state: active (polling with open positions), paused
   *  (tab hidden or no open positions), or error (last poll failed). */
  mtmPollingState: MtmPollingState;
}

const WorkstationContext = createContext<WorkstationContextValue | null>(null);

function normalizeScenario(value: string | undefined): WorkstationScenarioId {
  if (value && isWorkstationScenarioId(value)) return value;
  return 'default';
}

export function WorkstationProvider({
  initialScenario,
  liveMode = false,
  children,
}: {
  initialScenario?: string;
  liveMode?: boolean;
  children: ReactNode;
}) {
  const [scenario, setScenarioState] = useState<WorkstationScenarioId>(() =>
    normalizeScenario(initialScenario),
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  // Live-mode state
  const [liveData, setLiveData] = useState<LiveDashboardData | null>(null);
  const [liveAccounts, setLiveAccounts] = useState<WorkstationAccount[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, import('@/lib/market-quote').QuoteResult> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mtmPollingState, setMtmPollingState] = useState<MtmPollingState>('paused');
  const fetchAbortRef = useRef<AbortController | null>(null);
  const mtmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mtmAbortRef = useRef<AbortController | null>(null);

  // ── Fixture-mode data ──────────────────────────────────────────────
  const fixtureData = useMemo(
    () => getWorkstationFixtures(scenario),
    [scenario],
  );

  // ── Live-mode data ─────────────────────────────────────────────────
  const liveFixtures = useMemo<WorkstationFixtures | null>(() => {
    if (!liveData) return null;
    return liveDataToFixtures(liveData, livePrices);
  }, [liveData, livePrices]);

  // ── fixturves expose either live or fixture data ───────────────────
  const fixtures: WorkstationFixtures = liveMode && liveFixtures
    ? liveFixtures
    : fixtureData;

  // ── accounts ──────────────────────────────────────────────────────
  const accounts = useMemo(
    () => (liveMode ? liveAccounts : [fixtureData.account]),
    [liveMode, liveAccounts, fixtureData],
  );

  const activeAccountId = accounts.some((a) => a.id === selectedAccountId)
    ? selectedAccountId
    : (accounts[0]?.id ?? '');

  // ── Fetch accounts (live mode bootstrap) ───────────────────────────
  useEffect(() => {
    if (!liveMode) return;

    let cancelled = false;

    const bootAccounts = async () => {
      console.info('[workstation] LIVE MODE — fetching accounts');
      const result = await fetchAccountsLive();
      if (cancelled) return;

      if (!result.success) {
        console.error('[workstation] LIVE MODE — accounts fetch failed:', result.error);
        setError(`Failed to load accounts: ${result.error}`);
        return;
      }

      console.info(
        `[workstation] LIVE MODE — ${result.data.length} account(s) loaded`,
      );
      setLiveAccounts(result.data);
    };

    bootAccounts();
    return () => { cancelled = true; };
  }, [liveMode]);

  // ── Fetch dashboard data (live mode, on account resolved) ──────────
  useEffect(() => {
    if (!liveMode || !activeAccountId) return;

    // Abort any in-flight fetch
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    let cancelled = false;

    const fetchLive = async () => {
      console.info(
        `[workstation] LIVE MODE — fetching data for account: ${activeAccountId}`,
      );
      setIsLoading(true);
      setError(null);

      const result = await fetchAllLiveDashboardData(
        activeAccountId,
        controller.signal,
      );

      if (cancelled) return;

      if (!result.success) {
        console.error(
          '[workstation] LIVE MODE — data fetch failed:',
          result.error,
        );
        setError(result.error);
        setIsLoading(false);
        return;
      }

      console.info(
        `[workstation] LIVE MODE — data fetched: ` +
          `${result.data.positions.length} position(s), ` +
          `${result.data.watchlist.length} watchlist item(s)`,
      );

      // Update accounts list from the fresh fetch (may include different
      // accounts than the initial fetchAccountsLive call).
      setLiveAccounts(result.data.accounts);
      setLiveData(result.data);
      setIsLoading(false);
    };

    fetchLive();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [liveMode, activeAccountId]);

  // ── Live price fetching (fills marketIndices, symbolPrices, tradeIdeas) ─
  // Fetches prices for market indices + watchlist symbols when liveData
  // changes.  Best-effort: a failure leaves marketIndices/symbolPrices
  // empty but doesn't break the rest of the workstation.
  useEffect(() => {
    if (!liveMode || !liveData) {
      setLivePrices(null);
      return;
    }

    let cancelled = false;

    const fetchPrices = async () => {
      // Collect all symbols we need prices for: indices + watchlist
      const wlSymbols = liveData.watchlist
        .map((w) => w.symbol)
        .filter(Boolean);
      const symbols = [
        ...MARKET_INDEX_SYMBOLS,
        ...wlSymbols,
      ];

      // Deduplicate while preserving order
      const unique = [...new Set(symbols)];
      if (unique.length === 0) return;

      console.info(
        `[workstation] fetching live prices for ${unique.length} symbol(s)`,
      );
      const result = await fetchWatchlistPricesLive(unique);
      if (cancelled) return;

      if (result.success) {
        setLivePrices(result.data);
      } else {
        console.error(
          '[workstation] live price fetch failed:',
          result.error,
        );
        setLivePrices(null);
      }
    };

    fetchPrices();
    return () => { cancelled = true; };
  }, [liveMode, liveData]);

  // ── MTM polling (live mode only) ─────────────────────────────────
  // Polls at 30s when live mode is active, tab is visible, and positions > 0.
  // Pauses when tab is hidden or positions reach zero.  Sets mtmPollingState
  // so the toolbar can render the active/paused/error indicator.
  useEffect(() => {
    if (!liveMode || !activeAccountId) {
      setMtmPollingState('paused');
      return;
    }

    const hasPositions = liveData !== null && liveData.positions.length > 0;

    const startPolling = () => {
      if (mtmIntervalRef.current) return; // already polling

      setMtmPollingState('active');
      console.info('[workstation] MTM polling started (30s)');

      const tick = async () => {
        if (mtmAbortRef.current) {
          mtmAbortRef.current.abort();
        }
        const controller = new AbortController();
        mtmAbortRef.current = controller;

        console.info('[workstation] MTM poll fired');
        const result = await fetchAllLiveDashboardData(
          activeAccountId,
          controller.signal,
        );

        if (!result.success) {
          console.error(
            '[workstation] MTM poll failed:',
            result.error,
          );
          setMtmPollingState('error');
          return;
        }

        console.info(
          `[workstation] MTM poll OK: ${result.data.positions.length} position(s)`,
        );
        setLiveData(result.data);
        setLiveAccounts(result.data.accounts);
        setMtmPollingState('active');
      };

      // Fire one poll immediately, then every 30s.
      tick();
      mtmIntervalRef.current = setInterval(tick, 30_000);
    };

    const stopPolling = () => {
      if (mtmIntervalRef.current) {
        clearInterval(mtmIntervalRef.current);
        mtmIntervalRef.current = null;
      }
      if (mtmAbortRef.current) {
        mtmAbortRef.current.abort();
        mtmAbortRef.current = null;
      }
      setMtmPollingState('paused');
      console.info('[workstation] MTM polling paused');
    };

    const onVisibilityChange = () => {
      if (!hasPositions) return;
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };

    if (hasPositions && !document.hidden) {
      startPolling();
    } else {
      setMtmPollingState('paused');
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopPolling();
      // Resolve any pending interval — use a shallow check to avoid
      // stale-closure issues with hasPositions.
    };
  }, [liveMode, activeAccountId, liveData?.positions.length]);

  // ── Fixture-mode signal ───────────────────────────────────────────
  useEffect(() => {
    if (!liveMode) {
      warnFixtureMode(scenario);
    }
  }, [liveMode, scenario]);

  const setScenario = useCallback((next: WorkstationScenarioId) => {
    setScenarioState(next);
  }, []);

  const value = useMemo<WorkstationContextValue>(
    () => ({
      scenario: liveMode ? 'default' : scenario,
      setScenario,
      scenarios: WORKSTATION_SCENARIO_IDS,
      fixtures,
      accounts,
      activeAccountId,
      setActiveAccountId: setSelectedAccountId,
      fixtureMode: !liveMode,
      liveMode,
      isLoading,
      error,
      mtmPollingState,
    }),
    [
      liveMode,
      scenario,
      setScenario,
      fixtures,
      accounts,
      activeAccountId,
      isLoading,
      error,
      mtmPollingState,
    ],
  );

  return (
    <WorkstationContext.Provider value={value}>
      {children}
    </WorkstationContext.Provider>
  );
}

/**
 * Consume the workstation context. Throws a descriptive error when used
 * outside the provider so a misplaced panel fails loudly at render time
 * rather than silently rendering empty.
 */
export function useWorkstation(): WorkstationContextValue {
  const ctx = useContext(WorkstationContext);
  if (!ctx) {
    throw new Error(
      'useWorkstation must be used inside <WorkstationProvider>. ' +
        'Wrap the /workspace tree in workstation-context.tsx.',
    );
  }
  return ctx;
}
