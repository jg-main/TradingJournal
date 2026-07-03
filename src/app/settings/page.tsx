'use client';

import Link from 'next/link';
import { Building2, ChartNoAxesCombined, User, ShieldCheck, Gamepad2 } from 'lucide-react';

interface HubCard {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}

const cards: HubCard[] = [
  {
    title: 'Plays',
    description: 'Manage trading setups that appear in the Plan Trade dropdown.',
    href: '/settings/plays',
    icon: <Gamepad2 className="size-8 text-zinc-400 dark:text-zinc-500" strokeWidth={1.5} />,
  },
  {
    title: 'App Preferences',
    description: 'Configure display name, timezone, and default currency.',
    href: '/settings/app',
    icon: <User className="size-8 text-zinc-400 dark:text-zinc-500" strokeWidth={1.5} />,
  },
  {
    title: 'Risk Settings',
    description: 'Set max risk per trade, default commission, and starting account value.',
    href: '/settings/risk',
    icon: <ShieldCheck className="size-8 text-zinc-400 dark:text-zinc-500" strokeWidth={1.5} />,
  },
  {
    title: 'Accounts',
    description: 'Manage your brokerage accounts, deposits, and withdrawals.',
    href: '/settings/accounts',
    icon: <Building2 className="size-8 text-zinc-400 dark:text-zinc-500" strokeWidth={1.5} />,
  },
  {
    title: 'Export & Backup',
    description: 'Download a full backup of your journal database and files.',
    href: '/api/backup',
    icon: <ChartNoAxesCombined className="size-8 text-zinc-400 dark:text-zinc-500" strokeWidth={1.5} />,
  },
];

export default function SettingsHubPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Manage your trading journal preferences, risk parameters, and trading setups.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-lg border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
          >
            <div className="mb-3">{card.icon}</div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {card.title}
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {card.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
