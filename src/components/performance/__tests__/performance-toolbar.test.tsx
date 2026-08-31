import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { PerformanceToolbar } from '../performance-toolbar';
import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';
import { PerformanceInstanceProvider } from '../performance-instance-context';
import { PerformanceDashboardShell } from '../performance-dashboard-shell';
import { createSystemDefaultDashboard } from '@/lib/performance-view-types';

afterEach(() => cleanup());

const defaultDashboard = createSystemDefaultDashboard();

function renderToolbar(editMode: boolean, onToggleEditMode = () => {}, onSave = () => {}) {
  return render(
    <PerformanceToolbar
      editMode={editMode}
      onToggleEditMode={onToggleEditMode}
      onSave={onSave}
      onSwitch={() => {}}
      dashboards={[defaultDashboard]}
      activeDashboard={defaultDashboard}
      writeFailed={false}
      onCreate={() => {}}
      onRename={() => {}}
      onDuplicate={() => {}}
      onDelete={() => {}}
      onReset={() => {}}
      tradeCount={5}
    />,
  );
}

describe('PerformanceToolbar', () => {
  it('shows Customize button in normal mode', () => {
    renderToolbar(false);
    expect(screen.getByText('Customize')).toBeDefined();
    expect(screen.getByText('5 trades')).toBeDefined();
  });

  it('shows Done button in edit mode', () => {
    renderToolbar(true);
    expect(screen.getByText('Done')).toBeDefined();
    expect(screen.queryByText('Customize')).toBeNull();
  });

  it('renders Customize through the canonical Button (outline entry action)', () => {
    renderToolbar(false);
    const customize = screen.getByText('Customize').closest('[data-slot="button"]') as HTMLElement;
    expect(customize.getAttribute('data-slot')).toBe('button');
    expect(customize.getAttribute('data-variant')).toBe('outline');
    expect(customize.getAttribute('data-size')).toBe('lg');
  });

  it('renders Done through the canonical Button as the secondary action', () => {
    renderToolbar(true);
    const done = screen.getByText('Done').closest('[data-slot="button"]') as HTMLElement;
    expect(done.getAttribute('data-slot')).toBe('button');
    expect(done.getAttribute('data-variant')).toBe('secondary');
  });

  it('edit mode shows Save as primary and Done as secondary', () => {
    renderToolbar(true);
    const save = screen.getByText('Save').closest('[data-slot="button"]') as HTMLElement;
    expect(save.getAttribute('data-variant')).toBe('default');
    const done = screen.getByText('Done').closest('[data-slot="button"]') as HTMLElement;
    expect(done.getAttribute('data-variant')).toBe('secondary');
  });

  it('toggles mode on click', () => {
    let mode = false;
    const toggle = () => { mode = !mode; };
    const { rerender } = renderToolbar(mode, toggle);
    fireEvent.click(screen.getByText('Customize'));
    rerender(
      <PerformanceToolbar
        editMode={mode}
        onToggleEditMode={toggle}
        onSave={() => {}}
        onSwitch={() => {}}
        dashboards={[defaultDashboard]}
        activeDashboard={defaultDashboard}
        writeFailed={false}
        onCreate={() => {}}
        onRename={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByText('Done')).toBeDefined();
  });

  it('Done exits edit mode without implicitly saving', () => {
    const onSave = vi.fn();
    const onToggle = vi.fn();
    renderToolbar(true, onToggle, onSave);
    fireEvent.click(screen.getByText('Done'));
    expect(onToggle).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('PerformanceToolbar page identity (M004/T7)', () => {
  it('renders a compact semantic H1 with the page title Performance', () => {
    renderToolbar(false);
    const heading = screen.getByRole('heading', { name: 'Performance', level: 1 });
    expect(heading).toBeDefined();
    expect(heading.textContent).toBe('Performance');
  });

  it('keeps the dashboard selector as context after the page title', () => {
    renderToolbar(false);
    const heading = screen.getByRole('heading', { name: 'Performance' });
    const trigger = screen.getByRole('button', { name: /Switch performance dashboard/ });
    // Active dashboard name still reads as context on the trigger.
    expect(trigger.textContent).toContain('Performance Default');
    // Title precedes the selector in DOM order (page identity first).
    const pos = heading.compareDocumentPosition(trigger);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps Customize visible in normal mode alongside the title', () => {
    renderToolbar(false);
    expect(screen.getByText('Performance')).toBeDefined();
    expect(screen.getByText('Customize')).toBeDefined();
    expect(screen.getByText('5 trades')).toBeDefined();
  });

  it('keeps the header chrome canonical (border-b, bg-card, px-4)', () => {
    renderToolbar(false);
    const header = screen.getByTestId('performance-page-header');
    expect(header.className).toContain('border-b');
    expect(header.className).toContain('bg-card');
    expect(header.className).toContain('px-4');
    // No hero whitespace or page wrapper.
    expect(header.className).not.toContain('py-10');
  });
});

describe('PerformanceDashboardShell mode flow', () => {
  it('normal mode has no edit chrome; Customize reveals edit controls', () => {
    render(
      <PerformanceDashboardProvider>
        <PerformanceInstanceProvider>
          <PerformanceDashboardShell />
        </PerformanceInstanceProvider>
      </PerformanceDashboardProvider>,
    );
    // Normal mode: no add/reset controls
    expect(screen.queryByText('+ Add KPI')).toBeNull();
    expect(screen.queryByText('+ Add Chart')).toBeNull();
    expect(screen.getByText('Customize')).toBeDefined();

    // Enter edit mode
    fireEvent.click(screen.getByText('Customize'));
    expect(screen.getByText('Done')).toBeDefined();
    expect(screen.getByText('+ Add KPI')).toBeDefined();
    expect(screen.getByText('+ Add Chart')).toBeDefined();
  });

  it('keeps the operational order header → filter bar → fluid content (M004/T7)', () => {
    render(
      <PerformanceDashboardProvider>
        <PerformanceInstanceProvider>
          <PerformanceDashboardShell />
        </PerformanceInstanceProvider>
      </PerformanceDashboardProvider>,
    );
    const header = screen.getByTestId('performance-page-header');
    const content = screen.getByTestId('performance-content');
    // Content follows the header (the filter bar sits between them).
    const pos = header.compareDocumentPosition(content);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Content stays fluid — no page wrapper or max-width introduced.
    expect(content.className).not.toContain('max-w-');
    expect(content.className).toContain('px-4');
  });
});
