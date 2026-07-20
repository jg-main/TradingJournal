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

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario } = await searchParams;

  return (
    <WorkstationProvider initialScenario={scenario}>
      <WorkstationToolbar />
      <WorkstationShell />
    </WorkstationProvider>
  );
}
