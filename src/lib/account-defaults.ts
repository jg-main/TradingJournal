export type EffectiveAccountDefault =
  | { source: 'overridden'; value: number }
  | { source: 'inherited'; value: number }
  | { source: 'unavailable'; value: null };

/**
 * Resolves one persisted account default independently from every other field.
 * Explicit zero values are valid; only nullish or non-finite values are absent.
 */
export function resolveAccountDefault(
  accountOverride: number | null | undefined,
  globalDefault: number | null | undefined,
): EffectiveAccountDefault {
  if (typeof accountOverride === 'number' && Number.isFinite(accountOverride)) {
    return { source: 'overridden', value: accountOverride };
  }

  if (typeof globalDefault === 'number' && Number.isFinite(globalDefault)) {
    return { source: 'inherited', value: globalDefault };
  }

  return { source: 'unavailable', value: null };
}
