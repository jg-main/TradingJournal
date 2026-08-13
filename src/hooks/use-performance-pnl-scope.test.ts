import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PERFORMANCE_PNL_SCOPE_STORAGE_KEY,
  usePerformancePnlScope,
} from './use-performance-pnl-scope';

const store = new Map<string, string>();

const localStorageMock: Storage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => store.delete(key)),
  clear: vi.fn(() => store.clear()),
  get length() {
    return store.size;
  },
  key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('usePerformancePnlScope', () => {
  it('persists a chosen scope and restores it after a new dashboard session', async () => {
    const first = renderHook(() => usePerformancePnlScope());

    expect(first.result.current.scope).toBe('total');

    act(() => first.result.current.setScope('open'));
    expect(store.get(PERFORMANCE_PNL_SCOPE_STORAGE_KEY)).toBe('open');

    first.unmount();

    const second = renderHook(() => usePerformancePnlScope());
    await waitFor(() => {
      expect(second.result.current.scope).toBe('open');
    });
  });
});
