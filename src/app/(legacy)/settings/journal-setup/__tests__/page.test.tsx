/**
 * Characterization tests for the Journal Setup settings page (M004 Task 18).
 *
 * Journal Setup is a STATIC Settings sub-hub migrated onto SettingsChildPage.
 * It has NO fetch, loading, message, form, or save action — it renders two
 * navigation cards. These tests pin that contract so the structural adoption
 * never invents behavior.
 *
 * Run: npx vitest run "src/app/(legacy)/settings/journal-setup/__tests__/page.test.tsx"
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React, { type ComponentType } from 'react';

let JournalSetupPage: ComponentType;

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

beforeAll(async () => {
  const mod = await import('@/app/(legacy)/settings/journal-setup/page');
  JournalSetupPage = mod.default;
});

afterEach(() => {
  cleanup();
});

describe('Journal Setup settings page (static sub-hub)', () => {
  it('renders the Journal Setup title as the page h1', () => {
    render(<JournalSetupPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Journal Setup' })).toBeTruthy();
  });

  it('renders the description', () => {
    render(<JournalSetupPage />);
    expect(
      screen.getByText('Configure trading setups and mistake categories used in your journal.'),
    ).toBeTruthy();
  });

  it('renders Back to Settings pointing to /settings', () => {
    render(<JournalSetupPage />);
    const back = screen.getByRole('link', { name: /back to settings/i });
    expect(back.getAttribute('href')).toBe('/settings');
  });

  it('renders the Plays card with its exact destination and description', () => {
    render(<JournalSetupPage />);
    const plays = screen.getByRole('link', { name: /plays/i });
    expect(plays.getAttribute('href')).toBe('/settings/plays');
    expect(
      screen.getByText('Manage trading setups that appear in the Plan Trade dropdown.'),
    ).toBeTruthy();
  });

  it('renders the Mistake Types card with its exact destination and description', () => {
    render(<JournalSetupPage />);
    const mistakes = screen.getByRole('link', { name: /mistake types/i });
    expect(mistakes.getAttribute('href')).toBe('/settings/mistake-types');
    expect(screen.getByText('Manage mistake categories for trade reviews.')).toBeTruthy();
  });

  it('keeps card headings semantically subordinate to the page h1', () => {
    render(<JournalSetupPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Plays' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Mistake Types' })).toBeTruthy();
  });

  it('has no form', () => {
    render(<JournalSetupPage />);
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('has no Save action', () => {
    render(<JournalSetupPage />);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });

  it('has no loading state', () => {
    render(<JournalSetupPage />);
    expect(screen.queryByText(/loading/i)).toBeNull();
  });
});
