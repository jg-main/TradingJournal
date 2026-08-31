/**
 * Tests for the SettingsManagementPage structural component (M004 Task 22).
 *
 * Proves the canonical SETTINGS_MANAGEMENT shell owns ONLY structure:
 * the Settings-family outer shell, the left-aligned max-w-3xl management
 * boundary, Back to Journal Setup navigation, and the title/description +
 * right-side header-action slot. It must NOT own CRUD, dialogs, tables,
 * list rows, forms, message blocks, or the loading/content boundary.
 *
 * Also proves the extraction architecture: Plays and Mistake Types consume
 * this single structural owner and no longer duplicate the shell, Back to
 * Journal Setup markup, or the header structure themselves.
 *
 * Run: npx vitest run "src/components/settings/__tests__/settings-management-page.test.tsx"
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { SettingsManagementPage } from '../settings-management-page';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => React.createElement('a', { href }, children),
}));

function renderManagement(props: Partial<Parameters<typeof SettingsManagementPage>[0]> = {}) {
  return render(
    <SettingsManagementPage
      title="Plays"
      description="Trading setups that appear in the Plan Trade dropdown."
      action={<button type="button">New Play</button>}
      {...props}
    >
      <ul>
        <li>Breakout Pullback</li>
      </ul>
    </SettingsManagementPage>,
  );
}

describe('SettingsManagementPage', () => {
  it('renders Back to Journal Setup as a link to /settings/journal-setup', () => {
    renderManagement();
    const back = screen.getByRole('link', { name: /back to journal setup/i });
    expect(back.getAttribute('href')).toBe('/settings/journal-setup');
  });

  it('renders the title as the page h1', () => {
    renderManagement();
    expect(screen.getByRole('heading', { level: 1, name: 'Plays' })).toBeTruthy();
  });

  it('renders the subordinate description', () => {
    renderManagement();
    expect(screen.getByText('Trading setups that appear in the Plan Trade dropdown.')).toBeTruthy();
  });

  it('renders the header action slot', () => {
    renderManagement();
    expect(screen.getByRole('button', { name: /new play/i })).toBeTruthy();
  });

  it('renders children inside the management body', () => {
    renderManagement();
    expect(screen.getByText('Breakout Pullback')).toBeTruthy();
  });

  it('renders the header without an action when the slot is omitted', () => {
    renderManagement({ action: undefined });
    expect(screen.getByRole('heading', { level: 1, name: 'Plays' })).toBeTruthy();
    expect(screen.getByText('Breakout Pullback')).toBeTruthy();
  });
});

describe('SettingsManagementPage extraction architecture (M004 Task 22)', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');
  const componentSource = readFileSync(
    resolve(repoRoot, 'src/components/settings/settings-management-page.tsx'),
    'utf8',
  );
  const playsSource = readFileSync(
    resolve(repoRoot, 'src/app/(legacy)/settings/plays/page.tsx'),
    'utf8',
  );
  const mistakeTypesSource = readFileSync(
    resolve(repoRoot, 'src/app/(legacy)/settings/mistake-types/page.tsx'),
    'utf8',
  );

  it('the shell + Back navigation + header live ONLY in SettingsManagementPage', () => {
    // The component is the sole owner of the management outer shell and back link.
    expect(componentSource).toContain('mx-auto max-w-5xl px-8 py-10');
    expect(componentSource).toContain('Back to Journal Setup');
    expect(componentSource).toContain('ArrowLeft');
    expect(componentSource).toContain('max-w-3xl');
    expect(componentSource).toContain('href="/settings/journal-setup"');

    // The consuming management pages must NOT reintroduce their own copies.
    for (const [name, src] of [
      ['plays', playsSource],
      ['mistake-types', mistakeTypesSource],
    ] as const) {
      expect(src, `${name} must not duplicate the outer shell`).not.toContain(
        'mx-auto max-w-5xl px-8 py-10',
      );
      expect(src, `${name} must not duplicate Back to Journal Setup markup`).not.toContain(
        'Back to Journal Setup',
      );
      expect(src, `${name} must not render its own ArrowLeft`).not.toContain('<ArrowLeft');
      expect(src, `${name} must not duplicate the header row`).not.toContain(
        'mb-8 flex items-start justify-between gap-4',
      );
    }
  });

  it('the management pages consume the single structural owner', () => {
    for (const src of [playsSource, mistakeTypesSource]) {
      expect(src).toContain("from '@/components/settings/settings-management-page'");
      expect(src).toContain('<SettingsManagementPage');
    }
  });

  it('the shared component owns structure only — no form/control/business concerns', () => {
    // No shared controls, no API/business imports, no dialog, no action rows.
    expect(componentSource).not.toContain("from '@/components/ui/button'");
    expect(componentSource).not.toContain("from '@/components/ui/input'");
    expect(componentSource).not.toContain("from '@/components/ui/dialog'");
    expect(componentSource).not.toContain('onSave');
    expect(componentSource).not.toContain('saving');
    expect(componentSource).not.toContain('router.push');
    expect(componentSource).not.toContain('fetch(');
  });

  it('does not force the management pages into SettingsChildPage', () => {
    expect(playsSource).not.toContain("from '@/components/settings/settings-child-page'");
    expect(mistakeTypesSource).not.toContain("from '@/components/settings/settings-child-page'");
  });
});
