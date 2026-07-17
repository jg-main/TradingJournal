import { describe, expect, it } from 'vitest';
import { resolveAccountDefault } from './account-defaults';

describe('resolveAccountDefault', () => {
  it('uses a persisted account override before the global default', () => {
    expect(resolveAccountDefault(2.5, 2)).toEqual({
      source: 'overridden',
      value: 2.5,
    });
  });

  it('inherits the global default when the account override is null', () => {
    expect(resolveAccountDefault(null, 2)).toEqual({
      source: 'inherited',
      value: 2,
    });
  });

  it('preserves valid zero-valued overrides and global defaults', () => {
    expect(resolveAccountDefault(0, 2)).toEqual({
      source: 'overridden',
      value: 0,
    });
    expect(resolveAccountDefault(null, 0)).toEqual({
      source: 'inherited',
      value: 0,
    });
  });

  it('reports unavailable when neither source has a finite numeric value', () => {
    expect(resolveAccountDefault(null, null)).toEqual({
      source: 'unavailable',
      value: null,
    });
    expect(resolveAccountDefault(undefined, undefined)).toEqual({
      source: 'unavailable',
      value: null,
    });
    expect(resolveAccountDefault(null, Number.NaN)).toEqual({
      source: 'unavailable',
      value: null,
    });
  });

  it('keeps fields independent when only one source is available', () => {
    const risk = resolveAccountDefault(null, undefined);
    const commission = resolveAccountDefault(1, undefined);

    expect(risk.source).toBe('unavailable');
    expect(commission).toEqual({ source: 'overridden', value: 1 });
  });
});
