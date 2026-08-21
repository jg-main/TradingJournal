import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { WidgetActionsMenu } from '../widget-actions-menu';

afterEach(() => cleanup());

describe('WidgetActionsMenu', () => {
  it('renders nothing when no actions are provided', () => {
    const { container } = render(<WidgetActionsMenu widgetTitle="Net P&L" />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('labels the trigger accessibly with the widget title', () => {
    render(<WidgetActionsMenu widgetTitle="Net P&L" onDuplicate={() => {}} />);
    expect(screen.getByLabelText('Actions for Net P&L')).toBeDefined();
  });

  it('opens with only the provided actions', async () => {
    const user = userEvent.setup();
    render(
      <WidgetActionsMenu
        widgetTitle="Net P&L"
        onConfigure={() => {}}
        onDuplicate={() => {}}
      />,
    );
    await user.click(screen.getByLabelText('Actions for Net P&L'));
    expect(screen.getByRole('menuitem', { name: 'Configure' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeDefined();
    // Not offered → absent from the menu.
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Reset' })).toBeNull();
  });

  it('shows Remove with the destructive variant', async () => {
    const user = userEvent.setup();
    render(<WidgetActionsMenu widgetTitle="Net P&L" onRemove={() => {}} />);
    await user.click(screen.getByLabelText('Actions for Net P&L'));
    const remove = screen.getByRole('menuitem', { name: 'Remove' });
    expect(remove.getAttribute('data-variant')).toBe('destructive');
  });

  it('invokes the selected action handler', async () => {
    const user = userEvent.setup();
    const onConfigure = vi.fn();
    const onDuplicate = vi.fn();
    const onRemove = vi.fn();
    const onReset = vi.fn();
    render(
      <WidgetActionsMenu
        widgetTitle="Net P&L"
        onConfigure={onConfigure}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
        onReset={onReset}
      />,
    );
    await user.click(screen.getByLabelText('Actions for Net P&L'));
    await user.click(screen.getByRole('menuitem', { name: 'Configure' }));
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onDuplicate).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });
});
