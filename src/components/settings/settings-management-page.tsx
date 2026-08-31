'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * SettingsManagementPage — the canonical SETTINGS_MANAGEMENT shell
 * (M004 Task 22), consumed by the Journal Setup management children
 * (Plays, Mistake Types).
 *
 * This is intentionally SETTINGS-SPECIFIC: the Settings-family outer shell
 * (max-w-5xl keyline), the left-aligned max-w-3xl management boundary,
 * Back to Journal Setup navigation, and the title/description + right-side
 * primary-action header. It owns STRUCTURE ONLY — CRUD, APIs, dialogs,
 * tables, list rows, forms, message blocks, and loading/empty boundaries
 * stay in the consuming page (the message block and loading boundary differ
 * between management surfaces and are deliberately local).
 *
 * Geometry contract (visually equivalent across Plays and Mistake Types):
 * - outer shell: mx-auto max-w-5xl px-8 py-10 (Settings family 960px keyline)
 * - management body: max-w-3xl (768px), LEFT-aligned to the keyline
 * - parent navigation: Back to Journal Setup → /settings/journal-setup
 * - header: h1 (text-2xl) + subordinate description on the left, the
 *   header action (e.g. create-dialog trigger) on the right
 */
export interface SettingsManagementPageProps {
  title: string;
  description: ReactNode;
  /** Right-side header action, e.g. a create-dialog trigger. Optional. */
  action?: ReactNode;
  children: ReactNode;
}

export function SettingsManagementPage({
  title,
  description,
  action,
  children,
}: SettingsManagementPageProps) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="max-w-3xl">
        <Link
          href="/settings/journal-setup"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Journal Setup
        </Link>

        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          {action}
        </div>

        {children}
      </div>
    </div>
  );
}
