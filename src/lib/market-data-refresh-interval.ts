/** Default cadence for refreshing open-position marks. */
export const DEFAULT_MTM_REFRESH_INTERVAL_SECONDS = 30;

/** The refresh route permits one successful refresh per ten seconds. */
export const MIN_MTM_REFRESH_INTERVAL_SECONDS = 10;

/** Keep automatic provider traffic bounded to a practical maximum. */
export const MAX_MTM_REFRESH_INTERVAL_SECONDS = 300;

/**
 * Return a persisted quote-refresh interval only when it is a whole number
 * within the provider-safe range. Older rows and malformed values retain the
 * established 30-second cadence.
 */
export function resolveMtmRefreshIntervalSeconds(value: unknown): number {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_MTM_REFRESH_INTERVAL_SECONDS &&
    value <= MAX_MTM_REFRESH_INTERVAL_SECONDS
  ) {
    return value;
  }

  return DEFAULT_MTM_REFRESH_INTERVAL_SECONDS;
}
