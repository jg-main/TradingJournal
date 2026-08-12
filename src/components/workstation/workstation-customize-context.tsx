'use client';

// WorkstationCustomizeContext — single owner of the workstation customize
// session (M016/S06-T04).
//
// Customize state (useCustomizeMode) is transient client UI state shared by
// the toolbar (entry button) and the shell (draft grid, hide overlays,
// customize bar). A provider makes the session available to both consumers
// without prop drilling — including from server-component host pages where a
// render-prop would cross the RSC boundary. This mirrors the
// WorkstationViewsContext decision: shared state has exactly one owner, and
// consumers subscribe through the context (AGENTS.md state rules).

import { createContext, useContext, type ReactNode } from 'react';
import { useCustomizeMode, type UseCustomizeModeResult } from '@/hooks/use-customize-mode';

const WorkstationCustomizeContext = createContext<UseCustomizeModeResult | null>(null);

export function WorkstationCustomizeProvider({ children }: { children: ReactNode }) {
  const customize = useCustomizeMode();
  return (
    <WorkstationCustomizeContext.Provider value={customize}>
      {children}
    </WorkstationCustomizeContext.Provider>
  );
}

/**
 * Consume the workstation customize session. Throws a descriptive error when
 * used outside the provider so a misplaced consumer fails loudly at render
 * time rather than silently rendering without editing controls.
 */
export function useWorkstationCustomizeContext(): UseCustomizeModeResult {
  const ctx = useContext(WorkstationCustomizeContext);
  if (!ctx) {
    throw new Error(
      'useWorkstationCustomizeContext must be used inside <WorkstationCustomizeProvider>. ' +
        'Wrap the workstation tree in workstation-customize-context.tsx.',
    );
  }
  return ctx;
}
