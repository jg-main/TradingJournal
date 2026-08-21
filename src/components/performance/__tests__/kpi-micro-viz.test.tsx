import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { Sparkline, Donut, MicroViz, PnlSplitBar } from '../kpi-micro-viz';

afterEach(() => cleanup());

describe('kpi-micro-viz', () => {
  describe('Sparkline', () => {
    it('renders a path for ≥2 points', () => {
      const { container } = render(<Sparkline values={[0, 10, 5, 20]} />);
      expect(container.querySelector('path')).not.toBeNull();
    });

    it('renders nothing for fewer than 2 points', () => {
      const { container } = render(<Sparkline values={[5]} />);
      expect(container.querySelector('path')).toBeNull();
    });

    it('renders nothing for empty values', () => {
      const { container } = render(<Sparkline values={[]} />);
      expect(container.querySelector('path')).toBeNull();
    });

    it('defaults to the larger 140x40 canvas (Corrective Task 1)', () => {
      const { container } = render(<Sparkline values={[0, 10, 5, 20]} />);
      const svg = container.querySelector('[data-testid="kpi-sparkline"]');
      expect(svg?.getAttribute('width')).toBe('140');
      expect(svg?.getAttribute('height')).toBe('40');
    });

    it('renders an area fill under the line by default', () => {
      const { container } = render(<Sparkline values={[0, 10, 5, 20]} />);
      // Line path + area path.
      expect(container.querySelectorAll('path')).toHaveLength(2);
    });
  });

  describe('Donut', () => {
    it('renders two circles', () => {
      const { container } = render(<Donut fraction={0.6} />);
      expect(container.querySelectorAll('circle')).toHaveLength(2);
    });

    it('clamps fraction outside 0..1', () => {
      const { container } = render(<Donut fraction={1.5} />);
      expect(container.querySelectorAll('circle')).toHaveLength(2);
    });

    it('defaults to the larger 56px gauge (Corrective Task 1)', () => {
      const { container } = render(<Donut fraction={0.6} />);
      expect(container.querySelector('[data-testid="kpi-donut"]')?.getAttribute('width')).toBe('56');
    });
  });

  describe('PnlSplitBar', () => {
    it('renders proportional positive and negative segments', () => {
      const { container } = render(<PnlSplitBar positive={300} negative={100} />);
      const bar = container.querySelector('[data-testid="kpi-pnl-split-bar"]');
      expect(bar).not.toBeNull();
      // Two segment divs inside the bar.
      expect(bar?.querySelectorAll('.bg-positive')).toHaveLength(1);
      expect(bar?.querySelectorAll('.bg-negative')).toHaveLength(1);
    });

    it('renders nothing when either magnitude is non-positive', () => {
      const { container } = render(<PnlSplitBar positive={0} negative={100} />);
      expect(container.querySelector('[data-testid="kpi-pnl-split-bar"]')).toBeNull();
      const { container: c2 } = render(<PnlSplitBar positive={100} negative={-5} />);
      expect(c2.querySelector('[data-testid="kpi-pnl-split-bar"]')).toBeNull();
    });

    it('renders captions (labels + values) when enabled', () => {
      render(
        <PnlSplitBar
          positive={363}
          negative={263}
          positiveLabel="Avg Win"
          negativeLabel="Avg Loss"
          positiveValue="$363"
          negativeValue="-$263"
          showCaptions
        />,
      );
      expect(screen.getByText('Avg Win')).toBeDefined();
      expect(screen.getByText('Avg Loss')).toBeDefined();
      expect(screen.getByText('$363')).toBeDefined();
      expect(screen.getByText('-$263')).toBeDefined();
    });
  });

  describe('MicroViz', () => {
    it('renders sparkline when values present', () => {
      render(<MicroViz kind="sparkline" values={[1, 2, 3]} />);
      expect(screen.getByTestId('kpi-sparkline')).toBeDefined();
    });

    it('renders nothing when sparkline values absent', () => {
      render(<MicroViz kind="sparkline" values={[1]} />);
      expect(screen.queryByTestId('kpi-sparkline')).toBeNull();
    });

    it('renders donut when fraction present', () => {
      render(<MicroViz kind="donut" fraction={0.5} />);
      expect(screen.getByTestId('kpi-donut')).toBeDefined();
    });

    it('renders nothing when donut fraction absent', () => {
      render(<MicroViz kind="donut" />);
      expect(screen.queryByTestId('kpi-donut')).toBeNull();
    });

    it('renders the pnl-split bar when magnitudes present', () => {
      render(<MicroViz kind="pnl-split" positive={300} negative={100} />);
      expect(screen.getByTestId('kpi-pnl-split-bar')).toBeDefined();
    });

    it('renders nothing for pnl-split when magnitudes absent', () => {
      render(<MicroViz kind="pnl-split" />);
      expect(screen.queryByTestId('kpi-pnl-split-bar')).toBeNull();
    });
  });
});
