'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * SettingsChildPage — the canonical Settings configuration-child shell
 * (M004 Tasks 11–13).
 *
 * This is intentionally SETTINGS-SPECIFIC: the outer constrained shell, Back
 * to Settings navigation, h1 + description header, success/error message
 * block, and the stable loading/body switch are the structure every Settings
 * child page repeats. It owns STRUCTURE ONLY — page fetch/submit/save logic,
 * forms, shared controls, action rows, and domain state all stay in the
 * consuming page.
 *
 * Geometry contract (visually equivalent across Workspace and Risk Defaults):
 * - outer shell: mx-auto max-w-5xl px-8 py-10 (Settings family 960px keyline)
 * - header: h1 (text-2xl) + subordinate description (mt-1 mb-8)
 * - message: mb-6 status block at the shell keyline
 * - loading: loadingText at the body keyline (shell/back/header stay stable)
 * - loaded children: wrapped in a max-w-2xl content boundary, LEFT-aligned to
 *   the keyline (never stretched to the 960px keyline)
 */
export interface SettingsChildMessage {
  type: 'success' | 'error';
  text: string;
}

export interface SettingsChildPageProps {
  title: string;
  description: ReactNode;
  /**
   * Optional loading lifecycle. Defaults to false so STATIC child pages
   * (e.g. the Integrations sub-hub) need no fake loading props.
   */
  loading?: boolean;
  /** Loading text rendered only while loading === true. */
  loadingText?: string;
  message?: SettingsChildMessage | null;
  children: ReactNode;
}

export function SettingsChildPage({
  title,
  description,
  loading = false,
  loadingText,
  message,
  children,
}: SettingsChildPageProps) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <Link
        href="/settings"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Settings
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">{description}</p>

      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{loadingText}</p>
      ) : (
        <div className="max-w-2xl">{children}</div>
      )}
    </div>
  );
}
