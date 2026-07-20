'use client';

// WorkstationToolbar — compact top chrome for the workstation.
//
// Deliberately minimal: product mark, account switcher, scenario switcher
// (fixture-era control; removed or repurposed in S06), and the FIXTURE badge
// required by the slice verification contract. No legacy nav, no sidebar
// toggle — the workstation owns the full viewport.

import { useWorkstation } from './workstation-context';
import type { WorkstationScenarioId } from '@/lib/workstation-fixtures';

export function WorkstationToolbar() {
  const {
    accounts,
    activeAccountId,
    setActiveAccountId,
    scenario,
    setScenario,
    scenarios,
    fixtureMode,
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

      <div className="ws-toolbar-spacer" />

      {activeAccount && (
        <span className="ws-toolbar-meta ws-mono">
          {activeAccount.currency}
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
