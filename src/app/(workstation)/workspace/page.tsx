// /workspace — greenfield workstation entry point.
//
// T03 ships the full shell: WorkstationProvider (single owner of account +
// scenario state), the compact toolbar, and the terminal-dense CSS Grid with
// fixture-populated panels. T04 adds Playwright browser evidence at
// 1440x900; S06 swaps fixtures for live API data inside the context without
// touching panels.

import { WorkstationProvider } from '@/components/workstation/workstation-context';
import { WorkstationToolbar } from '@/components/workstation/workstation-toolbar';
import { WorkstationShell } from '@/components/workstation/workstation-shell';
import { WorkstationKeyboardShortcuts } from '@/components/workstation/workstation-keyboard-shortcuts';

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; live?: string }>;
}) {
  const { scenario, live } = await searchParams;
  const liveMode = live === 'true';

  return (
    <WorkstationProvider initialScenario={scenario} liveMode={liveMode}>
      <a href="#ws-main-content" className="ws-skip-link" data-testid="ws-skip-link">
        Skip to main content
      </a>
      <WorkstationKeyboardShortcuts />
      <WorkstationToolbar />
      <WorkstationShell />
    </WorkstationProvider>
  );
}
