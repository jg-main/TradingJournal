'use client';

// Root dashboard page — the greenfield workstation as the primary trading surface.
// Always runs in live mode against the real database. Renders inside the legacy
// layout which provides the Sidebar and keyboard shortcut infrastructure.
//
// Migration from M005 workstation pattern: the workstation's CSS density scope
// (.ws) is applied here so panels inherit compact rows, tabular numerals, and
// fine borders. The workstation toolbar is embedded above the grid shell.

import '@/app/(workstation)/workspace/workstation.css';
import { WorkstationProvider } from '@/components/workstation/workstation-context';
import { WorkstationToolbar } from '@/components/workstation/workstation-toolbar';
import { WorkstationShell } from '@/components/workstation/workstation-shell';
import { WorkstationKeyboardShortcuts } from '@/components/workstation/workstation-keyboard-shortcuts';
import { WorkstationViewsProvider } from '@/components/workstation/workstation-views-context';
import { WorkstationCustomizeProvider } from '@/components/workstation/workstation-customize-context';
import { useAccount } from '@/lib/account-context';
import { useOperationalDateRange } from '@/lib/operational-date-range-context';
import { useAppTimezone } from '@/lib/timezone-context';

export default function DashboardPage() {
  // Global account selection (M007/D037): the sidebar owns the selector;
  // the workstation consumes it as controlled props. /workspace keeps its
  // own uncontrolled provider for isolation.
  const { accounts, accountId, setAccountId } = useAccount();

  // Global operational period (M004 9D.2 §4): the canonical
  // OperationalDateRangeProvider owns the period; the page only forwards
  // the already-resolved plain-YMD range + hydration readiness to the
  // workstation as CONTROLLED read-only input. The workstation is never a
  // second period owner.
  const { resolvedRange, hydrated: periodHydrated } = useOperationalDateRange();
  const { timezone } = useAppTimezone();

  return (
    <div className="ws">
      <WorkstationProvider
        liveMode={true}
        accounts={accounts}
        accountId={accountId}
        onAccountIdChange={setAccountId}
        resolvedPeriod={resolvedRange}
        periodHydrated={periodHydrated}
        timezone={timezone}
      >
        {/* Saved workstation views (S06): the provider owns the view store so
            the toolbar switcher and the shell's dynamic grid share one
            source of truth. Customize session (S06-T04): the toolbar entry
            button and the shell's editing chrome share one session. */}
        <WorkstationViewsProvider>
          <WorkstationCustomizeProvider>
            <a href="#ws-main-content" className="ws-skip-link" data-testid="ws-skip-link">
              Skip to main content
            </a>
            <WorkstationKeyboardShortcuts />
            <WorkstationToolbar />
            <WorkstationShell />
          </WorkstationCustomizeProvider>
        </WorkstationViewsProvider>
      </WorkstationProvider>
    </div>
  );
}
