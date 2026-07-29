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

export default function DashboardPage() {
  return (
    <div className="ws">
      <WorkstationProvider liveMode={true}>
        <a href="#ws-main-content" className="ws-skip-link" data-testid="ws-skip-link">
          Skip to main content
        </a>
        <WorkstationKeyboardShortcuts />
        <WorkstationToolbar />
        <WorkstationShell />
      </WorkstationProvider>
    </div>
  );
}
