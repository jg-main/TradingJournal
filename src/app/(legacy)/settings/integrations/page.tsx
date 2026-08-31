'use client';

import Link from 'next/link';
import { Brain, Database } from 'lucide-react';
import { SettingsChildPage } from '@/components/settings/settings-child-page';

// ── Sub-hub Cards ───────────────────────────────────────────────────────

const integrationCards = [
  {
    title: 'AI Provider',
    description: 'Configure AI model providers for trade analysis and grading.',
    href: '/settings/ai',
    icon: <Brain className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
  {
    title: 'Market Data',
    description: 'Configure market data providers and connection settings.',
    href: '/settings/market-data',
    icon: <Database className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
];

// ── Page ────────────────────────────────────────────────────────────────
// STATIC Settings sub-hub: no fetch, no loading lifecycle, no message, no
// save action. SettingsChildPage provides the Settings-family shell, Back
// navigation, and header; the two destination cards stay local at the
// established 672px child-content scale.

export default function IntegrationsPage() {
  return (
    <SettingsChildPage
      title="Integrations"
      description="Manage AI service providers and market data sources for your journal."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {integrationCards.map((card) => (
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
