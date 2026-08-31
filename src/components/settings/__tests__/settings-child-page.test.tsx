/**
 * Tests for the SettingsChildPage structural component (M004 Task 13).
 *
 * Proves the canonical settings-configuration-child shell owns ONLY
 * structure: outer constrained shell, Back to Settings navigation, h1 +
 * description header, success/error message block, and the stable
 * loading/body switch. It must NOT own fetch/submit/save/form/control logic.
 *
 * Also proves the extraction architecture: Workspace and Risk Defaults
 * consume this single structural owner and no longer duplicate the shell or
 * Back to Settings markup themselves.
 *
 * Run: npx vitest run "src/components/settings/__tests__/settings-child-page.test.tsx"
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { SettingsChildPage } from '../settings-child-page';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => React.createElement('a', { href }, children),
}));

function renderChild(props: Partial<Parameters<typeof SettingsChildPage>[0]> = {}) {
  return render(
    <SettingsChildPage
      title="Workspace"
      description="Configure the application timezone."
      loading={false}
      loadingText="Loading workspace settings..."
      {...props}
    >
      <form>
        <input aria-label="sample field" />
        <button type="submit">Save</button>
      </form>
    </SettingsChildPage>,
  );
}

describe('SettingsChildPage', () => {
  it('renders Back to Settings as a link to /settings', () => {
    renderChild();
    const back = screen.getByRole('link', { name: /back to settings/i });
    expect(back.getAttribute('href')).toBe('/settings');
  });

  it('renders the title as the page h1', () => {
    renderChild();
    expect(screen.getByRole('heading', { level: 1, name: 'Workspace' })).toBeTruthy();
  });

  it('renders the subordinate description', () => {
    renderChild();
    expect(screen.getByText('Configure the application timezone.')).toBeTruthy();
  });

  it('renders loadingText while loading and hides children', () => {
    renderChild({ loading: true });
    expect(screen.getByText('Loading workspace settings...')).toBeTruthy();
    expect(screen.queryByLabelText('sample field')).toBeNull();
  });

  it('renders children when loaded and hides loadingText', () => {
    renderChild({ loading: false });
    expect(screen.getByLabelText('sample field')).toBeTruthy();
    expect(screen.queryByText('Loading workspace settings...')).toBeNull();
  });

  it('renders a success message', () => {
    renderChild({ message: { type: 'success', text: 'Saved successfully.' } });
    expect(screen.getByText('Saved successfully.')).toBeTruthy();
  });

  it('renders an error message', () => {
    renderChild({ message: { type: 'error', text: 'Something broke.' } });
    expect(screen.getByText('Something broke.')).toBeTruthy();
  });

  it('renders no message block when message is null', () => {
    renderChild({ message: null });
    expect(screen.queryByText(/saved successfully/i)).toBeNull();
  });
});

describe('SettingsChildPage extraction architecture (M004 Task 13)', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');
  const componentSource = readFileSync(
    resolve(repoRoot, 'src/components/settings/settings-child-page.tsx'),
    'utf8',
  );
  const workspaceSource = readFileSync(
    resolve(repoRoot, 'src/app/(legacy)/settings/workspace/page.tsx'),
    'utf8',
  );
  const riskSource = readFileSync(
    resolve(repoRoot, 'src/app/(legacy)/settings/risk-defaults/page.tsx'),
    'utf8',
  );

  it('the shell + Back navigation live ONLY in SettingsChildPage', () => {
    // The component is the sole owner of the canonical outer shell and back link.
    expect(componentSource).toContain('mx-auto max-w-5xl px-8 py-10');
    expect(componentSource).toContain('Back to Settings');
    expect(componentSource).toContain('ArrowLeft');

    // The two child pages must NOT reintroduce their own copies.
    for (const [name, src] of [
      ['workspace', workspaceSource],
      ['risk-defaults', riskSource],
    ] as const) {
      expect(src, `${name} must not duplicate the outer shell`).not.toContain(
        'mx-auto max-w-5xl px-8 py-10',
      );
      expect(src, `${name} must not duplicate Back to Settings markup`).not.toContain(
        'Back to Settings',
      );
      expect(src, `${name} must not render its own ArrowLeft`).not.toContain('<ArrowLeft');
    }
  });

  it('both child pages consume the single structural owner', () => {
    expect(workspaceSource).toContain(
      "from '@/components/settings/settings-child-page'",
    );
    expect(riskSource).toContain(
      "from '@/components/settings/settings-child-page'",
    );
    expect(workspaceSource).toContain('<SettingsChildPage');
    expect(riskSource).toContain('<SettingsChildPage');
  });

  it('the shared component owns structure only — no form/control/business concerns', () => {
    // No shared controls, no API/business imports, no action-row concepts.
    expect(componentSource).not.toContain("from '@/components/ui/button'");
    expect(componentSource).not.toContain("from '@/components/ui/input'");
    expect(componentSource).not.toContain("from '@/components/ui/select'");
    expect(componentSource).not.toContain('onSave');
    expect(componentSource).not.toContain('saving');
    expect(componentSource).not.toContain('router.push');
    expect(componentSource).not.toContain("fetch(");
  });
});
