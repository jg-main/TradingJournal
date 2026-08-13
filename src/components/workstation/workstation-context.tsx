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
  fetchMtmRefreshIntervalLive,
  fetchWatchlistPricesLive,
  refreshMtmPricesLive,
  adaptV2Account,
  adaptMarketIndices,
  adaptSymbolPrices,
  buildTradeIdeasFromWatchlist,
  type LiveDashboardData,
  type WorkstationAccount,
} from '@/lib/workstation-live-adapter';
import { DEFAULT_MTM_REFRESH_INTERVAL_SECONDS } from '@/lib/market-data-refresh-interval';

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
  /** True when account selection is owned by an external provider
   *  (e.g. the global AccountProvider in the legacy shell). The toolbar
   *  hides its own account selector in this mode to avoid duplicate
   *  selectors (AGENTS.md state rules). */
  accountSelectionExternal: boolean;
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
  /** Configured cadence shown beside the live market-data indicator. */
  mtmRefreshIntervalSeconds: number;
}

const WorkstationContext = createContext<WorkstationContextValue | null>(null);

function normalizeScenario(value: string | undefined): WorkstationScenarioId {
  if (value && isWorkstationScenarioId(value)) return value;
  return 'default';
}

export function WorkstationProvider({
  initialScenario,
  liveMode = false,
  accounts: controlledAccounts,
  accountId: controlledAccountId,
  onAccountIdChange,
  children,
}: {
  initialScenario?: string;
  liveMode?: boolean;
  /** M007/D037: optional controlled account props. When accountId is
   *  provided, selection and the accounts list are owned externally
   *  (global AccountProvider) and the internal bootstrap fetch is skipped. */
  accounts?: { id: string; name: string; currency: string }[];
  accountId?: string;
  onAccountIdChange?: (id: string) => void;
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
  const [mtmRefreshIntervalSeconds, setMtmRefreshIntervalSeconds] = useState(
    DEFAULT_MTM_REFRESH_INTERVAL_SECONDS,
  );
  const fetchAbortRef = useRef<AbortController | null>(null);
  const mtmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mtmAbortRef = useRef<AbortController | null>(null);
  const mtmRefreshInFlightRef = useRef(false);

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
  const isAccountControlled = controlledAccountId !== undefined;

  const accounts = useMemo(
    () =>
      isAccountControlled
        ? (controlledAccounts ?? [])
        : liveMode
          ? liveAccounts
          : [fixtureData.account],
    [isAccountControlled, controlledAccounts, liveMode, liveAccounts, fixtureData],
  );

  const activeAccountId = isAccountControlled
    ? accounts.some((a) => a.id === controlledAccountId)
      ? controlledAccountId
      : (accounts[0]?.id ?? '')
    : accounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : (accounts[0]?.id ?? '');

  const setActiveAccountId = useCallback(
    (id: string) => {
      if (isAccountControlled) {
        onAccountIdChange?.(id);
      } else {
        setSelectedAccountId(id);
      }
    },
    [isAccountControlled, onAccountIdChange],
  );

  // ── Fetch accounts (live mode bootstrap) ───────────────────────────
  useEffect(() => {
    if (!liveMode || isAccountControlled) return;

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
  }, [liveMode, isAccountControlled]);

  // ── Mark refresh configuration (live mode only) ───────────────────
  // The persisted setting is read once per mounted workstation. A malformed
  // or older row is normalized in the adapter to the 30-second default.
  useEffect(() => {
    if (!liveMode) return;

    let cancelled = false;
    const loadInterval = async () => {
      const result = await fetchMtmRefreshIntervalLive();
      if (cancelled) return;

      if (!result.success) {
        console.warn(
          '[workstation] unable to load MTM refresh interval; using default:',
          result.error,
        );
        return;
      }

      setMtmRefreshIntervalSeconds(result.data);
    };

    void loadInterval();
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
        { skipAccounts: isAccountControlled },
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
      // accounts than the initial fetchAccountsLive call). Skipped when
      // account selection is controlled externally (M007/D037).
      if (!isAccountControlled) setLiveAccounts(result.data.accounts);
      setLiveData(result.data);
      setIsLoading(false);
    };

    fetchLive();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [liveMode, activeAccountId, isAccountControlled]);

  // ── Live price fetching (fills marketIndices, symbolPrices, tradeIdeas) ─
  // Fetches prices for market indices + watchlist symbols when liveData
  // changes.  Best-effort: a failure leaves marketIndices/symbolPrices
  // empty but doesn't break the rest of the workstation.
  //
  // Reset live prices when live mode is off. Adjusted during render
  // (React-sanctioned; replaces the setState-in-effect the linter rejects).
  if (!liveMode || !liveData) {
    if (livePrices !== null) setLivePrices(null);
  }

  useEffect(() => {
    if (!liveMode || !liveData) return;

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
  // Refreshes at the configured cadence when live mode is active, the tab is
  // visible, and positions > 0. Every tick persists fresh quotes first, then
  // reloads current dashboard state. Historical analytics are never refreshed.
  // Pauses when tab is hidden or positions reach zero.  Sets mtmPollingState
  // so the toolbar can render the active/paused/error indicator.
  //
  // Show the paused indicator when live mode is off, no account is
  // selected, or there are no positions to poll. Adjusted during render
  // (React-sanctioned; replaces the setState-in-effect the linter rejects).
  if (!liveMode || !activeAccountId) {
    if (mtmPollingState !== 'paused') setMtmPollingState('paused');
  } else if (liveData === null || liveData.positions.length === 0) {
    if (mtmPollingState !== 'paused') setMtmPollingState('paused');
  }

  useEffect(() => {
    if (!liveMode || !activeAccountId) return;

    const hasPositions = liveData !== null && liveData.positions.length > 0;

    const startPolling = () => {
      if (mtmIntervalRef.current) return; // already polling

      setMtmPollingState('active');
      console.info(
        `[workstation] MTM polling started (${mtmRefreshIntervalSeconds}s)`,
      );

      const tick = async () => {
        if (mtmRefreshInFlightRef.current) {
          console.info('[workstation] MTM poll skipped; a refresh is still in flight');
          return;
        }

        const controller = new AbortController();
        mtmAbortRef.current = controller;
        mtmRefreshInFlightRef.current = true;

        try {
          console.info('[workstation] MTM refresh fired');
          const refreshResult = await refreshMtmPricesLive(controller.signal);

          // Effect cleanup intentionally aborts the request. It is a
          // lifecycle event, not a user-visible refresh failure.
          if (controller.signal.aborted) return;

          if (!refreshResult.success) {
            const message = `Mark refresh failed: ${refreshResult.error}`;
            console.error('[workstation] MTM refresh failed:', refreshResult.error);
            setError(message);
            setMtmPollingState('error');
            return;
          }

          const result = await fetchAllLiveDashboardData(
            activeAccountId,
            controller.signal,
            { skipAccounts: isAccountControlled },
          );

          if (controller.signal.aborted) return;

          if (!result.success) {
            const message = `Dashboard reload failed: ${result.error}`;
            console.error('[workstation] MTM dashboard reload failed:', result.error);
            setError(message);
            setMtmPollingState('error');
            return;
          }

          const partialFailure = refreshResult.data.failed.length > 0;
          const message = partialFailure
            ? `Mark refresh incomplete for ${refreshResult.data.failed.join(', ')}`
            : null;

          console.info(
            `[workstation] MTM refresh OK: ${refreshResult.data.updated} mark(s), ` +
              `${result.data.positions.length} position(s)`,
          );
          setLiveData(result.data);
          if (!isAccountControlled) setLiveAccounts(result.data.accounts);
          setError(message);
          setMtmPollingState(partialFailure ? 'error' : 'active');
        } finally {
          mtmRefreshInFlightRef.current = false;
          if (mtmAbortRef.current === controller) {
            mtmAbortRef.current = null;
          }
        }
      };

      // Fire one refresh immediately, then at the configured cadence.
      void tick();
      mtmIntervalRef.current = setInterval(
        () => { void tick(); },
        mtmRefreshIntervalSeconds * 1_000,
      );
    };

    const stopPolling = () => {
      if (mtmIntervalRef.current) {
        clearInterval(mtmIntervalRef.current);
        mtmIntervalRef.current = null;
      }
      if (mtmAbortRef.current) {
        mtmAbortRef.current.abort();
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
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopPolling();
      // Resolve any pending interval — use a shallow check to avoid
      // stale-closure issues with hasPositions.
    };
  }, [
    liveMode,
    activeAccountId,
    liveData?.positions.length,
    isAccountControlled,
    mtmRefreshIntervalSeconds,
  ]);

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
      setActiveAccountId,
      accountSelectionExternal: isAccountControlled,
      fixtureMode: !liveMode,
      liveMode,
      isLoading,
      error,
      mtmPollingState,
      mtmRefreshIntervalSeconds,
    }),
    [
      liveMode,
      scenario,
      setScenario,
      fixtures,
      accounts,
      activeAccountId,
      setActiveAccountId,
      isAccountControlled,
      isLoading,
      error,
      mtmPollingState,
      mtmRefreshIntervalSeconds,
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
