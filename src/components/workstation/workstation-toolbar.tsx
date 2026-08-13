'use client';

// WorkstationToolbar — compact top chrome for the workstation.
//
// Production toolbar: view switcher (S06), account selector, loading/error
// indicators, MTM polling status, and LIVE badge. No fixture controls — the
// workstation is always live against the real database.

import { useWorkstation, type MtmPollingState } from './workstation-context';
import { useWorkstationViewsContext } from './workstation-views-context';
import { useWorkstationCustomizeContext } from './workstation-customize-context';
import { WorkstationViewSwitcher } from './workstation-view-switcher';
import { SlidersHorizontal } from 'lucide-react';

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

function mtmTitle(state: MtmPollingState, intervalSeconds: number): string {
  switch (state) {
    case 'active':
      return `Mark-to-market refresh active (every ${intervalSeconds} seconds)`;
    case 'paused':
      return 'MTM polling paused — no open positions or tab hidden';
    case 'error':
      return 'Mark-to-market update failed — displayed marks may be stale';
  }
}

/** The compact badge summarizes whether the live data path is usable. */
function liveBadgeLabel(state: MtmPollingState): string {
  switch (state) {
    case 'active':
      return 'LIVE';
    case 'paused':
      return 'IDLE';
    case 'error':
      return 'ISSUE';
  }
}

function liveBadgeTitle(state: MtmPollingState, intervalSeconds: number): string {
  switch (state) {
    case 'active':
      return `Live data is flowing; mark-to-market refreshes every ${intervalSeconds} seconds`;
    case 'paused':
      return 'Live data is loaded; mark-to-market polling is idle';
    case 'error':
      return 'Live data issue — mark-to-market update failed and marks may be stale';
  }
}

export function WorkstationToolbar() {
  // Saved workstation views (S06): the provider owns the view store; the
  // toolbar renders the switcher and dispatches changes through it.
  const viewsState = useWorkstationViewsContext();

  // Customize session (S06-T04): the toolbar hosts the entry button. It is
  // disabled while a session is open (Save/Cancel/Undo/Reset live in the
  // customize bar) and for read-only system presets — the curated templates
  // cannot be overwritten (R035); users customize their own views or
  // duplicate a preset into an editable copy first.
  const customize = useWorkstationCustomizeContext();
  const activeView = viewsState.views.find((v) => v.id === viewsState.activeViewId);
  const customizeDisabled = customize.isCustomizing || !activeView || activeView.isSystem;

  const {
    accounts,
    activeAccountId,
    setActiveAccountId,
    accountSelectionExternal,
    isLoading,
    error,
    mtmPollingState,
    mtmRefreshIntervalSeconds,
  } = useWorkstation();

  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const liveBadgeState: MtmPollingState = error ? 'error' : mtmPollingState;

  return (
    <header
      className="ws-toolbar"
      role="banner"
      data-testid="ws-toolbar"
    >
      <span className="ws-toolbar-brand">Workstation</span>

      {/* Curated saved views + user views (S06): switching the active view
          re-lays-out the grid below via the shell's dynamic grid-template-*.*/}
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

      {/* Customize entry — explicit editing mode (R035). Disabled for system
          presets (read-only) and while a session is already open. */}
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

      {accountSelectionExternal ? (
        // Account selection lives in the sidebar (global AccountProvider).
        // Show read-only context instead of a duplicate selector.
        activeAccount && (
          <span className="ws-toolbar-label" data-testid="ws-external-account">
            {activeAccount.name}
          </span>
        )
      ) : (
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
      )}

      <div className="ws-toolbar-spacer" />

      {/* Loading indicator. */}
      {isLoading && (
        <span
          className="ws-loading-indicator"
          data-testid="ws-loading-indicator"
          role="status"
          aria-label="Loading live data"
        >
          Fetching…
        </span>
      )}

      {/* Error indicator. */}
      {error && (
        <span
          className="ws-error-indicator"
          data-testid="ws-error-indicator"
          role="alert"
          title={error}
        >
          Error
        </span>
      )}

      {/* MTM polling indicator. */}
      <span
        className={`ws-mtm-indicator ws-mtm-${mtmPollingState}`}
        data-testid={`ws-mtm-${mtmPollingState}`}
        role="status"
        aria-label={mtmLabel(mtmPollingState)}
        title={mtmTitle(mtmPollingState, mtmRefreshIntervalSeconds)}
      >
        <span className="ws-mtm-dot" aria-hidden="true" />
        {mtmLabel(mtmPollingState)}
      </span>

      {activeAccount && (
        <span className="ws-toolbar-meta ws-mono">
          {activeAccount.currency}
        </span>
      )}

      <span
        className={`ws-live-badge ws-live-badge-${liveBadgeState}`}
        data-testid="ws-live-badge"
        role={liveBadgeState === 'error' ? 'alert' : 'status'}
        aria-label={liveBadgeTitle(liveBadgeState, mtmRefreshIntervalSeconds)}
        title={liveBadgeTitle(liveBadgeState, mtmRefreshIntervalSeconds)}
      >
        {liveBadgeLabel(liveBadgeState)}
      </span>
    </header>
  );
}
