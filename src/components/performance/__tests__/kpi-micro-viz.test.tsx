import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { Sparkline, Donut, MicroViz } from '../kpi-micro-viz';

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
  });
});
