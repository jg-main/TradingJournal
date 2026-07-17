/**
 * Tests for the DashboardView type definition and factory helpers.
 *
 * Covers: createDashboardView, generateViewId, structural type checks,
 * deep-copy semantics, and system view name mapping.
 *
 * Run: npx vitest run src/types/dashboard-view.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  createDashboardView,
  generateViewId,
  SYSTEM_VIEW_IDS,
  SYSTEM_VIEW_NAMES,
} from './dashboard-view';
import type { DashboardView } from './dashboard-view';
import type { LayoutItem } from 'react-grid-layout';

// ── Fixtures ───────────────────────────────────────────────────────────

const SAMPLE_LAYOUT: LayoutItem[] = [
  { i: 'account-performance', x: 0, y: 0, w: 12, h: 3 },
  { i: 'ptd-performance', x: 0, y: 3, w: 6, h: 4 },
];

// ── System View Identifiers ────────────────────────────────────────────

describe('SYSTEM_VIEW_IDS', () => {
  it('defines exactly four system views', () => {
    expect(SYSTEM_VIEW_IDS).toHaveLength(4);
    expect(SYSTEM_VIEW_IDS).toContain('system-default');
    expect(SYSTEM_VIEW_IDS).toContain('system-trading-risk');
    expect(SYSTEM_VIEW_IDS).toContain('system-performance');
    expect(SYSTEM_VIEW_IDS).toContain('system-process-review');
  });
});

describe('SYSTEM_VIEW_NAMES', () => {
  it('maps each system view ID to a human-readable name', () => {
    expect(SYSTEM_VIEW_NAMES['system-default']).toBe('Default');
    expect(SYSTEM_VIEW_NAMES['system-trading-risk']).toBe('Trading Risk');
    expect(SYSTEM_VIEW_NAMES['system-performance']).toBe('Performance');
    expect(SYSTEM_VIEW_NAMES['system-process-review']).toBe('Process Review');
  });
});

// ── generateViewId ─────────────────────────────────────────────────────

describe('generateViewId', () => {
  it('returns a string', () => {
    const id = generateViewId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateViewId()));
    // With 50 calls, all should be unique
    expect(ids.size).toBe(50);
  });
});

// ── createDashboardView ────────────────────────────────────────────────

describe('createDashboardView', () => {
  it('creates a fully populated DashboardView', () => {
    const view = createDashboardView({
      name: 'Test View',
      layout: SAMPLE_LAYOUT,
      hiddenWidgetIds: ['calendar-heatmap'],
    });

    // Structural type check
    const dv: DashboardView = view;
    expect(dv).toBeDefined();

    // Required fields
    expect(view.name).toBe('Test View');
    expect(view.layout).toEqual(SAMPLE_LAYOUT);
    expect(view.hiddenWidgetIds).toEqual(['calendar-heatmap']);

    // Defaults
    expect(typeof view.id).toBe('string');
    expect(view.id.length).toBeGreaterThan(0);
    expect(typeof view.createdAt).toBe('string');
    expect(typeof view.updatedAt).toBe('string');
    expect(view.isSystem).toBe(false);
    expect(view.isDefault).toBe(false);
  });

  it('accepts override values for all optional fields', () => {
    const now = '2026-07-17T12:00:00.000Z';
    const view = createDashboardView({
      id: 'custom-id',
      name: 'Custom',
      layout: SAMPLE_LAYOUT,
      hiddenWidgetIds: ['calendar-heatmap'],
      createdAt: now,
      updatedAt: now,
      isSystem: true,
      isDefault: true,
    });

    expect(view.id).toBe('custom-id');
    expect(view.createdAt).toBe(now);
    expect(view.updatedAt).toBe(now);
    expect(view.isSystem).toBe(true);
    expect(view.isDefault).toBe(true);
  });

  it('deep-copies the layout array', () => {
    const view = createDashboardView({
      name: 'Deep Copy',
      layout: SAMPLE_LAYOUT,
    });

    // Mutate the original
    SAMPLE_LAYOUT[0].x = 99;

    // View should retain original values
    expect(view.layout[0].x).toBe(0);
  });

  it('defaults hiddenWidgetIds to empty array when omitted', () => {
    const view = createDashboardView({
      name: 'No Hidden',
      layout: SAMPLE_LAYOUT,
    });

    expect(view.hiddenWidgetIds).toEqual([]);
  });

  it('sets createdAt and updatedAt to ISO-8601 strings', () => {
    const view = createDashboardView({
      name: 'Timestamps',
      layout: SAMPLE_LAYOUT,
    });

    const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    expect(view.createdAt).toMatch(datePattern);
    expect(view.updatedAt).toMatch(datePattern);
  });

  it('creates a system view when isSystem is true', () => {
    const view = createDashboardView({
      id: 'system-default',
      name: 'Default',
      layout: SAMPLE_LAYOUT,
      isSystem: true,
      isDefault: true,
    });

    expect(view.isSystem).toBe(true);
    expect(view.isDefault).toBe(true);
    expect(view.id).toBe('system-default');
  });

  it('distinct createdAt and updatedAt when specified separately', () => {
    const created = '2026-01-01T00:00:00.000Z';
    const updated = '2026-06-15T00:00:00.000Z';
    const view = createDashboardView({
      name: 'Separate Times',
      layout: SAMPLE_LAYOUT,
      createdAt: created,
      updatedAt: updated,
    });

    expect(view.createdAt).toBe(created);
    expect(view.updatedAt).toBe(updated);
  });
});
