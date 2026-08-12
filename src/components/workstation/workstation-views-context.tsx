'use client';

// WorkstationViewsContext — single owner of the workstation view store
// (M016/S06).
//
// Workstation views state (useWorkstationViews) is client-side: it hydrates
// from localStorage, syncs with the shared /api/dashboard/views route, and
// drives both the toolbar view switcher and the shell's dynamic grid.
//
// The provider makes the store available to any workstation component —
// including pages rendered from server components (the dev fixture harness)
// where a render-prop would cross the server/client boundary. This mirrors
// the WorkstationContext pattern: shared state has exactly one owner, and
// consumers subscribe through the context rather than fetching independently
// (AGENTS.md state rules).

import { createContext, useContext, type ReactNode } from 'react';
import { useWorkstationViews, type UseWorkstationViewsResult } from '@/hooks/use-workstation-views';

const WorkstationViewsContext = createContext<UseWorkstationViewsResult | null>(null);

export function WorkstationViewsProvider({ children }: { children: ReactNode }) {
  const viewsState = useWorkstationViews();
  return (
    <WorkstationViewsContext.Provider value={viewsState}>
      {children}
    </WorkstationViewsContext.Provider>
  );
}

/**
 * Consume the workstation view store. Throws a descriptive error when used
 * outside the provider so a misplaced consumer fails loudly at render time
 * rather than silently rendering empty.
 */
export function useWorkstationViewsContext(): UseWorkstationViewsResult {
  const ctx = useContext(WorkstationViewsContext);
  if (!ctx) {
    throw new Error(
      'useWorkstationViewsContext must be used inside <WorkstationViewsProvider>. ' +
        'Wrap the workstation tree in workstation-views-context.tsx.',
    );
  }
  return ctx;
}
