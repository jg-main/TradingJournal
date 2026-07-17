'use client';

import { createContext, useContext } from 'react';

/**
 * React context that provides the current customization mode state down the
 * component tree without prop drilling through every widget component.
 *
 * DashboardWidget consumes this context so drag handles appear only when
 * the user enters customization mode, without requiring every widget
 * component to forward an isCustomizing prop explicitly.
 */
const CustomizingContext = createContext<boolean>(false);

/** Provider component — wrap dashboard area with cm.isCustomizing value. */
export const CustomizingProvider = CustomizingContext.Provider;

/**
 * Hook to read the current customization mode state.
 *
 * Components that render DashboardWidget internally pick up this context
 * without needing to forward isCustomizing as a prop.
 */
export function useCustomizing(): boolean {
  return useContext(CustomizingContext);
}
