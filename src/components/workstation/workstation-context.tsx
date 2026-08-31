'use client';

// WorkstationContext — single owner of workstation account + scenario state.
//
// Owns:
//   - the active fixture scenario (S06 swaps this for a live data source)
//   - the active account id and the account list available to the toolbar
//   - the memoized fixture payload for the active scenario
//   - the stable DATE-INDEPENDENT setup reference map (M004 9D.2 §3)
//
// The global Period is NOT owned here.  When mounted on the root dashboard,
// the page passes the canonical OperationalDateRangeProvider's already
// resolved plain-YMD range + hydration readiness as CONTROLLED read-only
// props; period-sensitive consumers read them back from this context.
// Period changes refetch ONLY the date-aware V1 dashboard (and the Closed
// Trades history panel), never the CURRENT V2/watchlist/accounts/prices/MTM
// legs.  MTM reloads go through the 9D.1 CURRENT boundary so a poll can
// never overwrite the selected-period V1 dashboard.
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
  adaptRisk,
  fetchAccountsLive,
  fetchAllLiveDashboardData,
  fetchCurrentLiveDashboardData,
  fetchDashboardLive,
  fetchMtmRefreshIntervalLive,
  fetchSetupLookupsLive,
  fetchWatchlistPricesLive,
  refreshMtmPricesLive,
  adaptV2Account,
  adaptMarketIndices,
  adaptSymbolPrices,
  buildTradeIdeasFromWatchlist,
  type LiveDashboardData,
  type ResolvedDateRange,
  type WorkstationAccount,
} from '@/lib/workstation-live-adapter';
import { DEFAULT_MTM_REFRESH_INTERVAL_SECONDS } from '@/lib/market-data-refresh-interval';

/** Re-export the account shape so the toolbar and other consumers
 *  can rely on a single source of truth. */
export type { WorkstationAccount } from '@/lib/workstation-live-adapter';

/** MTM polling lifecycle states exposed for the toolbar indicator. */
export type MtmPollingState = 'active' | 'paused' | 'error';

/** Stable identity for the unbounded default period so effect/memo deps that
 *  reference the object do not churn on every render when the caller omits
 *  the controlled period props. */
const DEFAULT_RESOLVED_PERIOD: ResolvedDateRange = { from: '', to: '' };

/** Derive a WorkstationFixtures payload from live dashboard data.
 *  Populates marketIndices, symbolPrices, and tradeIdeas from the
 *  live price data when available; empty arrays/sets when not.
 *  `setupNames` is the stable DATE-INDEPENDENT reference map (lookup
 *  values) — trade ideas never derive setup names from the period-scoped
 *  Dashboard V1 setupRanking (M004 9D.2 §3/§17). */
function liveDataToFixtures(
  data: LiveDashboardData,
  prices: Record<string, import('@/lib/market-quote').QuoteResult> | null,
  setupNames: Record<string, string>,
): WorkstationFixtures {
  const account = adaptV2Account(data.dashboardV2.account);

  // Derive market indices and symbol prices from live price data.
  const marketIndices = prices ? adaptMarketIndices(prices) : [];
  const symbolPrices = prices
    ? adaptSymbolPrices(prices, data.watchlist)
    : {};

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
  /** Re-fetch live dashboard data for the active account without changing
   *  selection. Used after a mutation (e.g. watchlist CRUD) so panels
   *  reflect the change without a page reload. Safe no-op in fixture mode
   *  or before an account resolves. */
  refreshLiveData: () => void;
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
  /** Already-resolved plain YMD global period (canonical owner is
   *  OperationalDateRangeProvider). Read-only metadata for period-sensitive
   *  consumers (M004 9D.2 §4). */
  resolvedPeriod: ResolvedDateRange;
  /** True once the canonical global period has hydrated from persistence.
   *  The first period-sensitive V1 request waits for this. */
  periodHydrated: boolean;
  /** Configured application timezone (read-only, owned by TimezoneProvider).
   *  Used by the Closed Trades serializer for ISO day boundaries. */
  timezone: string;
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
  resolvedPeriod = DEFAULT_RESOLVED_PERIOD,
  periodHydrated = true,
  timezone = 'America/Bogota',
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
  /** M004 9D.2: optional CONTROLLED read-only global period (canonical
   *  owner is OperationalDateRangeProvider). The root dashboard passes the
   *  already-resolved plain YMD range. When omitted, the workstation is
   *  unbounded (Max) — preserving isolated /workspace behavior. */
  resolvedPeriod?: ResolvedDateRange;
  /** True once the canonical period has hydrated from persistence. The
   *  first period-sensitive V1 request waits for this so the restored
   *  selection wins (never a temporary default-YTD request). */
  periodHydrated?: boolean;
  /** Configured application timezone (read-only, owned by TimezoneProvider).
   *  Used for ISO day boundaries in the Closed Trades serializer. */
  timezone?: string;
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
  /** Stable DATE-INDEPENDENT setup reference map (id → name). Fetched once
   *  per live-mode mount — never on the MTM cadence and never derived from
   *  the period-scoped V1 setupRanking (M004 9D.2 §3). */
  const [setupNames, setSetupNames] = useState<Record<string, string>>({});
  const fetchAbortRef = useRef<AbortController | null>(null);
  const mtmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mtmAbortRef = useRef<AbortController | null>(null);
  const mtmRefreshInFlightRef = useRef(false);
  /** Latest live snapshot for effects that must read it without re-running
   *  on every render. */
  const liveDataRef = useRef<LiveDashboardData | null>(null);
  /** Monotonic fetch identity: a superseded request never writes state. */
  const fetchSeqRef = useRef(0);
  /** Identity of the fetch whose data is currently rendered — distinguishes
   *  a PERIOD-ONLY change (V1-only refresh) from a full/account load. */
  const lastFetchKeyRef = useRef<{ account: string; period: string } | null>(null);

  // ── Fixture-mode data ──────────────────────────────────────────────
  const fixtureData = useMemo(
    () => getWorkstationFixtures(scenario),
    [scenario],
  );

  // ── Live-mode data ─────────────────────────────────────────────────
  const liveFixtures = useMemo<WorkstationFixtures | null>(() => {
    if (!liveData) return null;
    return liveDataToFixtures(liveData, livePrices, setupNames);
  }, [liveData, livePrices, setupNames]);

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

  // ── Stable setup reference names (live mode only) ─────────────────
  // DATE-INDEPENDENT lookup map for current trade ideas. Fetched ONCE per
  // live-mode mount — deliberately NOT on the MTM cadence and not derived
  // from the period-scoped V1 setupRanking (M004 9D.2 §3/§24). Reference
  // failure degrades honestly to an empty map (setupName null).
  useEffect(() => {
    if (!liveMode) return;

    let cancelled = false;
    const loadSetupNames = async () => {
      const result = await fetchSetupLookupsLive();
      if (cancelled) return;

      if (result.success) {
        setSetupNames(result.data);
      } else {
        console.warn(
          '[workstation] unable to load setup reference names; current trade ideas will omit setup names:',
          result.error,
        );
      }
    };

    void loadSetupNames();
    return () => { cancelled = true; };
  }, [liveMode]);

  // ── Refresh live dashboard data (live mode) ────────────────────────
  // Manual / mutation refresh: re-fetches the complete required bundle
  // (CURRENT + selected-period V1) for the active account. The V1 leg always
  // uses the CURRENT global resolved period — it can never revert to
  // unbounded data (M004 9D.2 §9). Safe no-op in fixture mode, before an
  // account resolves, or before the period has hydrated. The newest call
  // wins: any superseded request is aborted and its sequence is stale.
  const refreshLiveData = useCallback((): void => {
    if (!liveMode || !activeAccountId || !periodHydrated) return;

    // Abort any in-flight fetch so the newest request owns the state.
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    const seq = ++fetchSeqRef.current;
    const periodKey = `${resolvedPeriod.from}|${resolvedPeriod.to}`;

    const fetchLive = async () => {
      // Enter the loading state inside the async continuation (see the
      // existing pattern — never synchronously on the calling tick).
      setIsLoading(true);
      setError(null);

      console.info(
        `[workstation] LIVE MODE — fetching data for account: ${activeAccountId}`,
      );

      const result = await fetchAllLiveDashboardData(
        activeAccountId,
        controller.signal,
        { skipAccounts: isAccountControlled },
        resolvedPeriod,
      );

      // A newer refresh (or unmount/account/period change) superseded this
      // request; it owns loading/error state from here on.
      if (controller.signal.aborted || seq !== fetchSeqRef.current) return;

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

      lastFetchKeyRef.current = { account: activeAccountId, period: periodKey };
      // Update accounts list from the fresh fetch (may include different
      // accounts than the initial fetchAccountsLive call). Skipped when
      // account selection is controlled externally (M007/D037).
      if (!isAccountControlled) setLiveAccounts(result.data.accounts);
      liveDataRef.current = result.data;
      setLiveData(result.data);
      setIsLoading(false);
    };

    void fetchLive();
  }, [liveMode, activeAccountId, isAccountControlled, resolvedPeriod, periodHydrated]);

  // ── Fetch orchestration (live mode, account/period resolved) ───────
  // Drives the FIRST load, ACCOUNT CHANGES, and PERIOD-ONLY changes with
  // one pipeline (M004 9D.2 §5/§6/§8):
  //  - Never issues a period-sensitive V1 request before `periodHydrated`;
  //    the first request therefore uses the RESTORED global period.
  //  - A PERIOD-ONLY change (same account, different period, data already
  //    loaded) refetches ONLY the date-aware V1 dashboard and recomposes
  //    the presentation-only hybrid adapters against the existing CURRENT
  //    V2 snapshot. No CURRENT leg (V2/watchlist/accounts/prices/MTM) is
  //    touched.
  //  - An account change (or first load) refreshes BOTH scopes with the
  //    current resolved period via the 9D.1 compatibility composition.
  //  - The newest request always wins: superseded requests are aborted and
  //    a monotonic sequence guard rejects any stale account/period
  //    combination that still settles later.
  useEffect(() => {
    if (!liveMode || !activeAccountId || !periodHydrated) return;

    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    const seq = ++fetchSeqRef.current;
    const periodKey = `${resolvedPeriod.from}|${resolvedPeriod.to}`;

    const lastKey = lastFetchKeyRef.current;
    const isPeriodOnlyChange =
      lastKey !== null &&
      lastKey.account === activeAccountId &&
      lastKey.period !== periodKey &&
      liveDataRef.current !== null;

    const run = async () => {
      if (!isPeriodOnlyChange) {
        // First load or account change: full bundle, V1 scoped to the
        // current resolved period.
        setIsLoading(true);
        setError(null);
        const result = await fetchAllLiveDashboardData(
          activeAccountId,
          controller.signal,
          { skipAccounts: isAccountControlled },
          resolvedPeriod,
        );
        if (controller.signal.aborted || seq !== fetchSeqRef.current) return;
        lastFetchKeyRef.current = { account: activeAccountId, period: periodKey };
        if (!result.success) {
          setError(result.error);
          setIsLoading(false);
          return;
        }
        if (!isAccountControlled) setLiveAccounts(result.data.accounts);
        liveDataRef.current = result.data;
        setLiveData(result.data);
        setIsLoading(false);
        return;
      }

      // Period-only change: refetch ONLY the date-aware V1 dashboard and
      // merge it into the existing snapshot. CURRENT V2/watchlist/marks/
      // positions stay untouched.
      const dashResult = await fetchDashboardLive(
        activeAccountId,
        controller.signal,
        resolvedPeriod,
      );
      if (controller.signal.aborted || seq !== fetchSeqRef.current) return;
      lastFetchKeyRef.current = { account: activeAccountId, period: periodKey };
      if (!dashResult.success) {
        console.error(
          '[workstation] PERIOD REFRESH — V1 dashboard fetch failed:',
          dashResult.error,
        );
        setError(dashResult.error);
        return;
      }
      const prevData = liveDataRef.current;
      if (prevData) {
        const next: LiveDashboardData = {
          ...prevData,
          dashboard: dashResult.data,
          risk: adaptRisk(dashResult.data, prevData.dashboardV2),
        };
        liveDataRef.current = next;
        setLiveData(next);
      }
      setError(null);
    };

    void run();

    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [
    liveMode,
    activeAccountId,
    isAccountControlled,
    resolvedPeriod,
    periodHydrated,
  ]);

  // ── Live price fetching (fills marketIndices, symbolPrices, tradeIdeas) ─
  // Fetches prices for market indices + watchlist symbols when the CURRENT
  // watchlist snapshot changes. Deliberately keyed to the watchlist
  // reference (not the whole live snapshot) so a PERIOD-ONLY refresh — which
  // replaces only the V1 dashboard — never re-requests prices (M004 9D.2 §6).
  // Best-effort: a failure leaves marketIndices/symbolPrices empty but
  // doesn't break the rest of the workstation.
  //
  // Reset live prices when live mode is off. Adjusted during render
  // (React-sanctioned; replaces the setState-in-effect the linter rejects).
  if (!liveMode || !liveData) {
    if (livePrices !== null) setLivePrices(null);
  }

  const liveWatchlist = liveData?.watchlist ?? null;

  useEffect(() => {
    if (!liveMode || !liveWatchlist) return;

    let cancelled = false;

    const fetchPrices = async () => {
      // Collect all symbols we need prices for: indices + watchlist
      const wlSymbols = liveWatchlist
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
  }, [liveMode, liveWatchlist]);

  // ── MTM polling (live mode only) ─────────────────────────────────
  // Refreshes at the configured cadence when live mode is active, the tab is
  // visible, and positions > 0. Every tick persists fresh quotes first, then
  // reloads current dashboard state. Historical analytics are never refreshed.
  // Pauses when tab is hidden or positions reach zero.  Sets mtmPollingState
  // so the toolbar can render the active/paused/error indicator.
  //
  // Polling eligibility is the BOOLEAN "has open positions" (zero vs nonzero),
  // not the exact position count: a user legitimately switching accounts with
  // 2 positions -> 1 position must not tear down and restart the polling
  // lifecycle (which would abort the in-flight refresh/reload). Only
  // eligibility flips (0 <-> nonzero), account changes, and other real
  // lifecycle changes re-run the polling effect.
  const hasOpenPositions = liveData !== null && liveData.positions.length > 0;

  // Show the paused indicator when live mode is off, no account is
  // selected, or there are no positions to poll. Adjusted during render
  // (React-sanctioned; replaces the setState-in-effect the linter rejects).
  if (!liveMode || !activeAccountId) {
    if (mtmPollingState !== 'paused') setMtmPollingState('paused');
  } else if (!hasOpenPositions) {
    if (mtmPollingState !== 'paused') setMtmPollingState('paused');
  }

  useEffect(() => {
    if (!liveMode || !activeAccountId) return;

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

          // Refreshes are global: the endpoint refreshes every open symbol,
          // not just this workstation. A 429 therefore means another visible
          // dashboard or trade detail just completed a usable refresh during
          // the shared cooldown. Reload its persisted marks rather than
          // presenting the throttle as a market-data outage.
          const sharedRefreshWithinCooldown =
            !refreshResult.success && refreshResult.status === 429;

          if (!refreshResult.success && !sharedRefreshWithinCooldown) {
            const message = `Mark refresh failed: ${refreshResult.error}`;
            console.error('[workstation] MTM refresh failed:', refreshResult.error);
            setError(message);
            setMtmPollingState('error');
            return;
          }

          if (sharedRefreshWithinCooldown) {
            console.info(
              '[workstation] MTM refresh shared by another visible surface; reloading persisted marks',
            );
          }

          // MTM reload is CURRENT-ONLY (M004 9D.2 §10): after persisting
          // fresh quotes, reload ONLY the current-state snapshot through the
          // 9D.1 CURRENT boundary and merge it into the existing
          // selected-period V1 dashboard — the retrospective payload is
          // never replaced or refreshed by a poll.
          const result = await fetchCurrentLiveDashboardData(
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

          const partialFailure = refreshResult.success && refreshResult.data.failed.length > 0;
          const message = partialFailure && refreshResult.success
            ? `Mark refresh incomplete for ${refreshResult.data.failed.join(', ')}`
            : null;
          const refreshSummary = sharedRefreshWithinCooldown
            ? 'shared refresh within cooldown'
            : `${refreshResult.success ? refreshResult.data.updated : 0} mark(s)`;

          console.info(
            `[workstation] MTM refresh OK: ${refreshSummary}, ` +
              `${result.data.positions.length} position(s)`,
          );

          const prevData = liveDataRef.current;
          if (prevData) {
            const next: LiveDashboardData = {
              ...prevData,
              dashboardV2: result.data.dashboardV2,
              watchlist: result.data.watchlist,
              accounts: result.data.accounts,
              positions: result.data.positions,
              risk: adaptRisk(prevData.dashboard, result.data.dashboardV2),
            };
            liveDataRef.current = next;
            setLiveData(next);
          }
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
      if (!hasOpenPositions) return;
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };

    if (hasOpenPositions && !document.hidden) {
      startPolling();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopPolling();
      // Resolve any pending interval — use a shallow check to avoid
      // stale-closure issues with the eligibility boolean.
    };
  }, [
    liveMode,
    activeAccountId,
    hasOpenPositions,
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
      refreshLiveData,
      accountSelectionExternal: isAccountControlled,
      fixtureMode: !liveMode,
      liveMode,
      isLoading,
      error,
      resolvedPeriod,
      periodHydrated,
      timezone,
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
      refreshLiveData,
      isAccountControlled,
      isLoading,
      error,
      resolvedPeriod,
      periodHydrated,
      timezone,
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
