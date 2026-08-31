/**
 * Characterization tests for the Integrations settings page (M004 Task 14).
 *
 * Integrations is a STATIC Settings sub-hub: it consumes SettingsChildPage
 * (shared shell/Back/header) and renders two navigation cards, with NO fetch,
 * loading lifecycle, message, form, or Save action. These tests pin that
 * contract so the structural adoption never invents behavior.
 *
 * Run: npx vitest run "src/app/(legacy)/settings/integrations/__tests__/page.test.tsx"
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React, { type ComponentType } from 'react';

let IntegrationsPage: ComponentType;

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => React.createElement('a', { href }, children),
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/integrations/page');
  IntegrationsPage = mod.default;
});

afterEach(() => {
  cleanup();
});

describe('Integrations settings page (static sub-hub)', () => {
  it('renders the Integrations title as the page h1', () => {
    render(<IntegrationsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Integrations' })).toBeTruthy();
  });

  it('renders the description', () => {
    render(<IntegrationsPage />);
    expect(
      screen.getByText('Manage AI service providers and market data sources for your journal.'),
    ).toBeTruthy();
  });

  it('renders Back to Settings pointing to /settings', () => {
    render(<IntegrationsPage />);
    const back = screen.getByRole('link', { name: /back to settings/i });
    expect(back.getAttribute('href')).toBe('/settings');
  });

  it('renders the AI Provider card with its exact destination', () => {
    render(<IntegrationsPage />);
    const ai = screen.getByRole('link', { name: /ai provider/i });
    expect(ai.getAttribute('href')).toBe('/settings/ai');
  });

  it('renders the Market Data card with its exact destination', () => {
    render(<IntegrationsPage />);
    const market = screen.getByRole('link', { name: /market data/i });
    expect(market.getAttribute('href')).toBe('/settings/market-data');
  });

  it('keeps card headings semantically subordinate to the page h1', () => {
    render(<IntegrationsPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'AI Provider' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Market Data' })).toBeTruthy();
  });

  it('has no form', () => {
    render(<IntegrationsPage />);
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('has no Save action', () => {
    render(<IntegrationsPage />);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });

  it('has no loading text', () => {
    render(<IntegrationsPage />);
    expect(screen.queryByText(/loading/i)).toBeNull();
  });
});
