'use client';

import Link from 'next/link';
import { ArrowLeft, Brain, Database } from 'lucide-react';

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

export default function IntegrationsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/settings"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Integrations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage AI service providers and market data sources for your journal.
        </p>
      </div>

      {/* Card grid */}
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
    </div>
  );
}
