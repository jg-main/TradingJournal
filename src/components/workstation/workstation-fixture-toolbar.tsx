'use client';

// Dev-only toolbar for the deterministic workstation fixture harness.
// Production account ownership and LIVE state remain in WorkstationToolbar.

import type { WorkstationScenarioId } from '@/lib/workstation-fixtures';
import { useWorkstation } from './workstation-context';
import { useWorkstationViewsContext } from './workstation-views-context';
import { WorkstationViewSwitcher } from './workstation-view-switcher';

export function WorkstationFixtureToolbar() {
  // Saved workstation views (S06): the provider owns the view store; the
  // fixture harness exercises the same switcher + dynamic grid as production.
  const viewsState = useWorkstationViewsContext();

  const {
    accounts,
    activeAccountId,
    setActiveAccountId,
    scenario,
    setScenario,
    scenarios,
  } = useWorkstation();

  const activeAccount = accounts.find((account) => account.id === activeAccountId);

  return (
    <header className="ws-toolbar" role="banner" data-testid="ws-toolbar">
      <span className="ws-toolbar-brand">Workstation</span>

      {/* Curated saved views + user views (S06): switching re-lays-out the
          grid below via the shell's dynamic grid-template-*.*/}
      <WorkstationViewSwitcher
        views={viewsState.views}
        activeViewId={viewsState.activeViewId}
        onSelectView={viewsState.setActiveView}
        onCreateView={(name) => viewsState.createView(name)}
        writeFailed={viewsState.writeFailed}
      />

      <label className="ws-toolbar-field">
        <span className="ws-toolbar-label">Account</span>
        <select
          className="ws-select"
          aria-label="Active account"
          value={activeAccountId}
          onChange={(event) => setActiveAccountId(event.target.value)}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>

      <label className="ws-toolbar-field">
        <span className="ws-toolbar-label">Scenario</span>
        <select
          className="ws-select"
          aria-label="Fixture scenario"
          data-testid="ws-scenario-select"
          value={scenario}
          onChange={(event) => setScenario(event.target.value as WorkstationScenarioId)}
        >
          {scenarios.map((scenarioId) => (
            <option key={scenarioId} value={scenarioId}>
              {scenarioId}
            </option>
          ))}
        </select>
      </label>

      <div className="ws-toolbar-spacer" />

      {activeAccount && (
        <span className="ws-toolbar-meta ws-mono">{activeAccount.currency}</span>
      )}

      <span className="ws-fixture-badge" data-testid="ws-fixture-badge" role="status">
        Fixture
      </span>
    </header>
  );
}
