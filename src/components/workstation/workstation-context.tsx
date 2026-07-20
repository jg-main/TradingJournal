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
  useState,
  type ReactNode,
} from 'react';

import {
  getWorkstationFixtures,
  isWorkstationScenarioId,
  warnFixtureMode,
  WORKSTATION_SCENARIO_IDS,
  type WorkstationFixtures,
  type WorkstationScenarioId,
} from '@/lib/workstation-fixtures';

export interface WorkstationAccount {
  id: string;
  name: string;
  currency: string;
}

export interface WorkstationContextValue {
  scenario: WorkstationScenarioId;
  setScenario: (scenario: WorkstationScenarioId) => void;
  scenarios: readonly WorkstationScenarioId[];
  fixtures: WorkstationFixtures;
  accounts: WorkstationAccount[];
  activeAccountId: string;
  setActiveAccountId: (id: string) => void;
  /** True while panels render synthetic fixture data (pre-S06). */
  fixtureMode: true;
}

const WorkstationContext = createContext<WorkstationContextValue | null>(null);

function normalizeScenario(value: string | undefined): WorkstationScenarioId {
  if (value && isWorkstationScenarioId(value)) return value;
  return 'default';
}

export function WorkstationProvider({
  initialScenario,
  children,
}: {
  initialScenario?: string;
  children: ReactNode;
}) {
  const [scenario, setScenarioState] = useState<WorkstationScenarioId>(() =>
    normalizeScenario(initialScenario),
  );
  // User-selected account id; '' means "not chosen yet". The resolved
  // activeAccountId below falls back to the first account, so no effect is
  // needed to keep the selection valid when the scenario changes.
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  const fixtures = useMemo(() => getWorkstationFixtures(scenario), [scenario]);

  // Account list derives from the scenario payload. Pre-S06 every scenario
  // carries a single fixture account; the shape already matches the account
  // switcher contract so S06 can substitute the real /api/accounts list.
  const accounts = useMemo<WorkstationAccount[]>(
    () => [fixtures.account],
    [fixtures],
  );

  const activeAccountId = accounts.some((a) => a.id === selectedAccountId)
    ? selectedAccountId
    : (accounts[0]?.id ?? '');

  // Slice verification contract: console.warn whenever fixture data loads.
  useEffect(() => {
    warnFixtureMode(scenario);
  }, [scenario]);

  const setScenario = useCallback((next: WorkstationScenarioId) => {
    setScenarioState(next);
  }, []);

  const value = useMemo<WorkstationContextValue>(
    () => ({
      scenario,
      setScenario,
      scenarios: WORKSTATION_SCENARIO_IDS,
      fixtures,
      accounts,
      activeAccountId,
      setActiveAccountId: setSelectedAccountId,
      fixtureMode: true,
    }),
    [scenario, setScenario, fixtures, accounts, activeAccountId],
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
