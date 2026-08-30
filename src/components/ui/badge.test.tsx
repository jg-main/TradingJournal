/**
 * Component tests for the Badge primitive semantic variants (M004/T2).
 *
 * Proves the design-system semantic Badge vocabulary is exposed by the
 * primitive and that all pre-existing variants remain supported.
 *
 * Run: npx vitest run src/components/ui/badge.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge';

const SEMANTIC_VARIANTS: Array<[string, string]> = [
  ['positive', 'bg-positive/10 text-positive'],
  ['negative', 'bg-negative/10 text-negative'],
  ['warning', 'bg-warning/10 text-warning'],
  ['missing', 'bg-missing/10 text-missing'],
  ['info', 'bg-info/10 text-info'],
];

const EXISTING_VARIANTS = [
  'default',
  'secondary',
  'destructive',
  'outline',
  'ghost',
  'link',
] as const;

describe('Badge semantic variants', () => {
  it.each(SEMANTIC_VARIANTS)(
    'renders the %s variant with its semantic classes',
    (variant, expected) => {
      render(<Badge variant={variant as 'positive'}>label</Badge>);
      const el = screen.getByText('label');
      expect(el.getAttribute('data-variant')).toBe(variant);
      for (const cls of expected.split(' ')) {
        expect(el.className, `expected ${cls} in className`).toContain(cls);
      }
    },
  );
});

describe('Badge existing variants', () => {
  it.each(EXISTING_VARIANTS)('keeps the %s variant supported', (variant) => {
    render(<Badge variant={variant}>label</Badge>);
    const el = screen.getByText('label');
    expect(el.getAttribute('data-variant')).toBe(variant);
  });
});
