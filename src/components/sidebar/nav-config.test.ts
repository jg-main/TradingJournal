import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, resolveActiveHref } from './nav-config';

/**
 * M014/S02/T02 — active-route resolution for the shell sidebar.
 *
 * Guards the longest-matching-href rule: nested routes must highlight the
 * most specific nav item (e.g. /settings/accounts activates the Accounts
 * item, not the broader Settings item at /settings), the root href matches
 * only the exact path, and unknown paths yield no active item.
 */
describe('resolveActiveHref', () => {
  it('matches the root href only on the exact root path', () => {
    expect(resolveActiveHref('/')).toBe('/');
    expect(resolveActiveHref('/trades')).not.toBe('/');
    expect(resolveActiveHref('/settings')).not.toBe('/');
  });

  it('matches exact nav hrefs', () => {
    expect(resolveActiveHref('/trades')).toBe('/trades');
    expect(resolveActiveHref('/sizing')).toBe('/sizing');
    expect(resolveActiveHref('/alerts')).toBe('/alerts');
    expect(resolveActiveHref('/settings')).toBe('/settings');
    expect(resolveActiveHref('/help')).toBe('/help');
  });

  it('keeps a section active on nested child routes', () => {
    expect(resolveActiveHref('/trades/42')).toBe('/trades');
    expect(resolveActiveHref('/trades/42/assessments')).toBe('/trades');
  });

  it('prefers the longest matching href for nested prefixes', () => {
    // Accounts lives at /settings/accounts; the Settings item at /settings
    // must not also go active on the accounts route.
    expect(resolveActiveHref('/settings/accounts')).toBe('/settings/accounts');
    expect(resolveActiveHref('/settings/accounts/1')).toBe('/settings/accounts');
    expect(resolveActiveHref('/settings')).toBe('/settings');
  });

  it('returns null for paths with no matching nav item', () => {
    expect(resolveActiveHref('/does-not-exist')).toBeNull();
    // S03: Watchlist and Reviews are dashboard-widget-only workflows; the
    // legacy pages remain functional routes but have no sidebar nav item.
    expect(resolveActiveHref('/watchlist')).toBeNull();
    expect(resolveActiveHref('/reviews')).toBeNull();
    expect(resolveActiveHref('/watchlist/123')).toBeNull();
    expect(resolveActiveHref('/reviews/weekly')).toBeNull();
  });

  it('keeps the Settings section active on its child routes', () => {
    expect(resolveActiveHref('/settings/risk-defaults')).toBe('/settings');
    expect(resolveActiveHref('/settings/workspace')).toBe('/settings');
  });

  it('respects a custom section list', () => {
    expect(resolveActiveHref('/trades', [NAV_SECTIONS[0]])).toBe('/trades');
    expect(resolveActiveHref('/settings', [NAV_SECTIONS[0]])).toBeNull();
  });
});
