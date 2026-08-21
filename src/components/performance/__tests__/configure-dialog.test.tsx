import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import {
  ConfigureDialog,
  applySchemaDefaults,
  buildConfigFromDraft,
} from '../configure-dialog';
import { GLOBAL_UNIT_SENTINEL, getWidgetConfigSchema } from '@/lib/performance-widget-registry';

// jsdom gaps for Radix Select (repo pattern — see performance-filter-bar.test.tsx).
Element.prototype.scrollIntoView = () => {};

/** Open a radix Select by combobox name and click the given option label. */
async function chooseSelectOption(comboboxName: string, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }));
  const option = await screen.findByRole('option', { name: optionName });
  fireEvent.click(option);
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => cleanup());

function renderDialog(props: {
  widgetType?: string;
  config?: Record<string, unknown>;
  onSave?: (config: Record<string, unknown>) => void;
  widgetTitle?: string;
}) {
  const { widgetType = 'net-pnl', config = {}, widgetTitle = 'Net P&L', onSave = vi.fn() } = props;
  const onOpenChange = vi.fn();
  const utils = render(
    <ConfigureDialog
      open
      onOpenChange={onOpenChange}
      widgetTitle={widgetTitle}
      widgetType={widgetType}
      config={config}
      onSave={onSave as never}
    />,
  );
  return { onSave, onOpenChange, ...utils };
}

describe('ConfigureDialog', () => {
  it('renders typed KPI fields: metric select, title input, unit select', () => {
    renderDialog({ widgetType: 'net-pnl' });
    expect(screen.getByRole('combobox', { name: 'Metric' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeDefined();
    // Net P&L supports $/%/R → a unit override select is offered.
    expect(screen.getByRole('combobox', { name: 'Unit' })).toBeDefined();
  });

  it('omits the unit field for fixed-semantic metrics', () => {
    renderDialog({ widgetType: 'win-rate' });
    expect(screen.getByRole('combobox', { name: 'Metric' })).toBeDefined();
    expect(screen.queryByRole('combobox', { name: 'Unit' })).toBeNull();
  });

  it('renders typed chart fields: visible series checkboxes, legend toggle, title', () => {
    renderDialog({ widgetType: 'drawdown-curve', widgetTitle: 'Drawdown Curve' });
    expect(screen.getByRole('checkbox', { name: 'Amount ($)' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Percent (%)' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Show legend' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeDefined();
    // Both series are on by default (registry schema default).
    expect((screen.getByRole('checkbox', { name: 'Amount ($)' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Percent (%)' }) as HTMLInputElement).checked).toBe(true);
  });

  it('renders the primary-series select for performance-by-setup', () => {
    renderDialog({ widgetType: 'performance-by-setup', widgetTitle: 'Performance by Setup' });
    expect(screen.getByRole('combobox', { name: 'Primary series' })).toBeDefined();
  });

  it('prefills the draft from the saved config', () => {
    renderDialog({
      widgetType: 'drawdown-curve',
      widgetTitle: 'Drawdown Curve',
      config: { titleOverride: 'My Drawdown', visibleSeries: ['drawdownAmount'] },
    });
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('My Drawdown');
    expect((screen.getByRole('checkbox', { name: 'Amount ($)' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Percent (%)' }) as HTMLInputElement).checked).toBe(false);
  });

  it('saves a typed title override and closes', async () => {
    const user = userEvent.setup();
    const { onSave, onOpenChange } = renderDialog({ widgetType: 'drawdown-curve', widgetTitle: 'Drawdown Curve' });
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'My Drawdown');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ titleOverride: 'My Drawdown' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saves series visibility toggles', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog({ widgetType: 'drawdown-curve', widgetTitle: 'Drawdown Curve' });
    await user.click(screen.getByRole('checkbox', { name: 'Percent (%)' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ visibleSeries: ['drawdownAmount'] });
  });

  it('saves the legend toggle', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog({ widgetType: 'drawdown-curve', widgetTitle: 'Drawdown Curve' });
    await user.click(screen.getByRole('checkbox', { name: 'Show legend' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ legendVisible: true });
  });

  it('drops an emptied title override on save', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog({
      widgetType: 'net-pnl',
      config: { titleOverride: 'Stale' },
    });
    const title = screen.getByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    // No titleOverride key at all → registry default title applies.
    expect(onSave).toHaveBeenCalledWith({});
  });

  it('saves a metric change and drops the now-unsupported unit override', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog({
      widgetType: 'net-pnl',
      config: { unit: 'percent' },
    });
    // Change the metric to a fixed-semantic one (Win Rate).
    await chooseSelectOption('Metric', 'Win Rate');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ metricId: 'win-rate' });
  });

  it('Cancel closes without saving', async () => {
    const user = userEvent.setup();
    const { onSave, onOpenChange } = renderDialog({ widgetType: 'net-pnl' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('applySchemaDefaults', () => {
  it('fills missing fields from schema defaults', () => {
    const schema = getWidgetConfigSchema('drawdown-curve');
    const draft = applySchemaDefaults(schema, {});
    expect(draft.visibleSeries).toEqual(['drawdownAmount', 'drawdownPct']);
    expect(draft.legendVisible).toBe(false);
    expect(draft.titleOverride).toBe('');
  });

  it('keeps existing config values', () => {
    const schema = getWidgetConfigSchema('drawdown-curve');
    const draft = applySchemaDefaults(schema, { visibleSeries: ['drawdownPct'], legendVisible: true });
    expect(draft.visibleSeries).toEqual(['drawdownPct']);
    expect(draft.legendVisible).toBe(true);
  });
});

describe('buildConfigFromDraft', () => {
  it('omits values equal to their schema defaults', () => {
    const schema = getWidgetConfigSchema('net-pnl');
    const next = buildConfigFromDraft(schema, {
      metricId: 'net-pnl',
      titleOverride: '',
      unit: GLOBAL_UNIT_SENTINEL,
    });
    expect(next).toEqual({});
  });

  it('keeps non-default values and trims text fields', () => {
    const schema = getWidgetConfigSchema('net-pnl');
    const next = buildConfigFromDraft(schema, {
      metricId: 'win-rate',
      titleOverride: '  My Title  ',
      unit: 'percent',
    });
    expect(next).toEqual({ metricId: 'win-rate', titleOverride: 'My Title', unit: 'percent' });
  });
});
