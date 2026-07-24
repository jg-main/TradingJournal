'use client';

// WorkstationToolbar — compact top chrome for the workstation.
//
// Deliberately minimal: product mark, account switcher, scenario switcher
// (fixture-era control; removed or repurposed in S06), and the FIXTURE badge
// required by the slice verification contract. No legacy nav, no sidebar
// toggle — the workstation owns the full viewport.

import { useWorkstation, type MtmPollingState } from './workstation-context';
import type { WorkstationScenarioId } from '@/lib/workstation-fixtures';

/** Compact label + semantic description for the MTM polling indicator. */
function mtmLabel(state: MtmPollingState): string {
  switch (state) {
    case 'active':
      return 'MTM Live';
    case 'paused':
      return 'MTM Idle';
    case 'error':
      return 'MTM Error';
  }
}

function mtmTitle(state: MtmPollingState): string {
  switch (state) {
    case 'active':
      return 'Mark-to-market polling active (30s)';
    case 'paused':
      return 'MTM polling paused — no open positions or tab hidden';
    case 'error':
      return 'MTM polling failed — check console for details';
  }
}

export function WorkstationToolbar() {
  const {
    accounts,
    activeAccountId,
    setActiveAccountId,
    scenario,
    setScenario,
    scenarios,
    fixtureMode,
    liveMode,
    isLoading,
    error,
    mtmPollingState,
  } = useWorkstation();

  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  return (
    <header
      className="ws-toolbar"
      role="banner"
      data-testid="ws-toolbar"
    >
      <span className="ws-toolbar-brand">Workstation</span>

      <label className="ws-toolbar-field">
        <span className="ws-toolbar-label">Account</span>
        <select
          className="ws-select"
          aria-label="Active account"
          value={activeAccountId}
          onChange={(e) => setActiveAccountId(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      {/* Scenario switcher — only visible in fixture mode (live mode hides it). */}
      {!liveMode && (
        <label className="ws-toolbar-field">
          <span className="ws-toolbar-label">Scenario</span>
          <select
            className="ws-select"
            aria-label="Fixture scenario"
            data-testid="ws-scenario-select"
            value={scenario}
            onChange={(e) => setScenario(e.target.value as WorkstationScenarioId)}
          >
            {scenarios.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="ws-toolbar-spacer" />

      {/* Loading indicator (live mode only). */}
      {liveMode && isLoading && (
        <span
          className="ws-loading-indicator"
          data-testid="ws-loading-indicator"
          role="status"
          aria-label="Loading live data"
        >
          Fetching…
        </span>
      )}

      {/* Error indicator (live mode only, shown when a fetch fails). */}
      {liveMode && error && (
        <span
          className="ws-error-indicator"
          data-testid="ws-error-indicator"
          role="alert"
          title={error}
        >
          Error
        </span>
      )}

      {/* MTM polling indicator (live mode only). */}
      {liveMode && (
        <span
          className={`ws-mtm-indicator ws-mtm-${mtmPollingState}`}
          data-testid={`ws-mtm-${mtmPollingState}`}
          role="status"
          aria-label={mtmLabel(mtmPollingState)}
          title={mtmTitle(mtmPollingState)}
        >
          <span className="ws-mtm-dot" aria-hidden="true" />
          {mtmLabel(mtmPollingState)}
        </span>
      )}

      {activeAccount && (
        <span className="ws-toolbar-meta ws-mono">
          {activeAccount.currency}
        </span>
      )}

      {/* LIVE badge (live mode) or FIXTURE badge (fixture mode). */}
      {liveMode && (
        <span
          className="ws-live-badge"
          data-testid="ws-live-badge"
          role="status"
        >
          LIVE
        </span>
      )}

      {fixtureMode && (
        <span
          className="ws-fixture-badge"
          data-testid="ws-fixture-badge"
          role="status"
        >
          Fixture
        </span>
      )}
    </header>
  );
}
