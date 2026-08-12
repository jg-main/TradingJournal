'use client';

// Dev-only toolbar for the deterministic workstation fixture harness.
// Production account ownership and LIVE state remain in WorkstationToolbar.

import type { WorkstationScenarioId } from '@/lib/workstation-fixtures';
import { useWorkstation } from './workstation-context';
import { useWorkstationViewsContext } from './workstation-views-context';
import { useWorkstationCustomizeContext } from './workstation-customize-context';
import { WorkstationViewSwitcher } from './workstation-view-switcher';
import { SlidersHorizontal } from 'lucide-react';

export function WorkstationFixtureToolbar() {
  // Saved workstation views (S06): the provider owns the view store; the
  // fixture harness exercises the same switcher + dynamic grid as production.
  const viewsState = useWorkstationViewsContext();

  // Customize session (S06-T04): the fixture harness carries the same entry
  // button so T05 can verify customize mode deterministically against
  // fixtures. Disabled for read-only system presets and mid-session.
  const customize = useWorkstationCustomizeContext();
  const activeView = viewsState.views.find((v) => v.id === viewsState.activeViewId);
  const customizeDisabled = customize.isCustomizing || !activeView || activeView.isSystem;

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
        onRenameView={(id, name) => viewsState.renameView(id, name)}
        onDuplicateView={(id) => viewsState.duplicateView(id)}
        onDeleteView={(id) => viewsState.deleteView(id)}
        onResetView={(id) => viewsState.resetView(id)}
        onSetStartupView={(id) => viewsState.setStartupView(id)}
        writeFailed={viewsState.writeFailed}
      />

      {/* Customize entry — same entry as production for deterministic E2E. */}
      <button
        type="button"
        className="ws-customize-trigger"
        data-testid="ws-customize-trigger"
        onClick={() => {
          if (activeView && !customize.isCustomizing) {
            customize.enterCustomize(activeView.config);
          }
        }}
        disabled={customizeDisabled}
        title={
          customize.isCustomizing
            ? 'Customize session in progress'
            : activeView?.isSystem
              ? 'System templates are read-only — create or duplicate a view to customize'
              : 'Customize this view'
        }
      >
        <SlidersHorizontal className="ws-customize-trigger-icon" aria-hidden="true" />
        Customize
      </button>

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
