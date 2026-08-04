// Dev-only deterministic workstation harness.
//
// The production workstation was promoted to `/` and always uses live data.
// This route preserves the four M005 fixture scenarios for browser regression
// testing without reopening the retired `/workspace` product route.

import '@/app/(workstation)/workspace/workstation.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkstationFixtureToolbar } from '@/components/workstation/workstation-fixture-toolbar';
import { WorkstationKeyboardShortcuts } from '@/components/workstation/workstation-keyboard-shortcuts';
import { WorkstationProvider } from '@/components/workstation/workstation-context';
import { WorkstationShell } from '@/components/workstation/workstation-shell';
import { TimezoneProvider } from '@/lib/timezone-context';

export default async function WorkstationFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario } = await searchParams;

  return (
    <TimezoneProvider>
      <TooltipProvider>
        <div className="ws">
          <WorkstationProvider initialScenario={scenario} liveMode={false}>
            <a href="#ws-main-content" className="ws-skip-link" data-testid="ws-skip-link">
              Skip to main content
            </a>
            <WorkstationKeyboardShortcuts />
            <WorkstationFixtureToolbar />
            <WorkstationShell />
          </WorkstationProvider>
        </div>
      </TooltipProvider>
    </TimezoneProvider>
  );
}
