/**
 * lifecycle-stepper.test.tsx
 *
 * Vitest (jsdom) component test for LifecycleStepper (M004 Fix 3).
 * Pins the six visible lifecycle labels (Plan → Size → Execute → Manage →
 * Close → Review) and representative current-step behavior. The exhaustive
 * pure-logic getCurrentStep mappings remain covered by
 * src/components/lifecycle-stepper.test.ts (tsx runner).
 *
 * Run: npx vitest run "src/components/lifecycle-stepper.test.tsx"
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { LifecycleStepper, getCurrentStep } from './lifecycle-stepper';

const VISIBLE_LABELS = ['Plan', 'Size', 'Execute', 'Manage', 'Close', 'Review'];

describe('LifecycleStepper visible vocabulary (M004 Fix 3)', () => {
  it('renders exactly the six lifecycle labels Plan, Size, Execute, Manage, Close, Review', () => {
    render(<LifecycleStepper status="planned" direction="long" />);
    for (const label of VISIBLE_LABELS) {
      expect(screen.getByText(label), `label ${label}`).toBeTruthy();
    }
    // The pre-fix vocabulary is gone.
    expect(screen.queryByText('Exit')).toBeNull();
    expect(screen.queryByText('Grade')).toBeNull();
  });

  it('renders the same six labels for an open trade', () => {
    render(<LifecycleStepper status="open" direction="short" openedAt="2026-01-01T00:00:00.000Z" />);
    for (const label of VISIBLE_LABELS) {
      expect(screen.getByText(label), `label ${label}`).toBeTruthy();
    }
  });

  it('keeps current-step behavior for representative states', () => {
    // planned
    expect(getCurrentStep('planned')).toEqual({ currentStep: 1, isScratched: false });
    // open, executed
    expect(getCurrentStep('open', '2026-01-01T00:00:00.000Z')).toEqual({ currentStep: 4, isScratched: false });
    // open, managed phase without openedAt
    expect(getCurrentStep('open', null, null, null, null, null, 'managed')).toEqual({ currentStep: 4, isScratched: false });
    // closed, unreviewed → Review (step 6) current
    expect(getCurrentStep('closed')).toEqual({ currentStep: 6, isScratched: false });
    // closed, reviewed → reviewed step (7)
    expect(getCurrentStep('closed', null, null, null, null, null, undefined, '2026-01-02T00:00:00.000Z')).toEqual({ currentStep: 7, isScratched: false });
    // deleted
    expect(getCurrentStep('deleted')).toEqual({ currentStep: 1, isScratched: true });
  });
});
