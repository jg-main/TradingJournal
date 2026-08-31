'use client';

import Link from 'next/link';
import { Gamepad2, AlertTriangle } from 'lucide-react';
import { SettingsChildPage } from '@/components/settings/settings-child-page';

// ── Sub-hub Cards ───────────────────────────────────────────────────────

const journalCards = [
  {
    title: 'Plays',
    description: 'Manage trading setups that appear in the Plan Trade dropdown.',
    href: '/settings/plays',
    icon: <Gamepad2 className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
  {
    title: 'Mistake Types',
    description: 'Manage mistake categories for trade reviews.',
    href: '/settings/mistake-types',
    icon: <AlertTriangle className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
];

// ── Page ────────────────────────────────────────────────────────────────
// STATIC Settings sub-hub: no fetch, no loading lifecycle, no message, no
// save action. SettingsChildPage provides the Settings-family shell, Back
// navigation, and header; the two destination cards stay local at the
// established 672px child-content scale.

export default function JournalSetupPage() {
  return (
    <SettingsChildPage
      title="Journal Setup"
      description="Configure trading setups and mistake categories used in your journal."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {journalCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-lg border border-border bg-card p-6 transition-colors hover:border-border hover:bg-muted/50"
          >
            <div className="mb-3">{card.icon}</div>
            <h2 className="text-sm font-semibold text-foreground">{card.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
          </Link>
        ))}
      </div>
    </SettingsChildPage>
  );
}
