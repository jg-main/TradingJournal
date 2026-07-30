'use client';

// WorkstationToolbar — compact top chrome for the workstation.
//
// Production toolbar: account selector, loading/error indicators,
// MTM polling status, and LIVE badge. No fixture controls — the
// workstation is always live against the real database.

import { useWorkstation, type MtmPollingState } from './workstation-context';

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
    accountSelectionExternal,
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
        title={mtmTitle(mtmPollingState)}
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
        className="ws-live-badge"
        data-testid="ws-live-badge"
        role="status"
      >
        LIVE
      </span>
    </header>
  );
}
