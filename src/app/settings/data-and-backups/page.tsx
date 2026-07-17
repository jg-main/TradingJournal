'use client';

import Link from 'next/link';
import { ArrowLeft, HardDrive } from 'lucide-react';

// ── Sub-hub Cards ───────────────────────────────────────────────────────

const dataCards = [
  {
    title: 'Backup',
    description: 'Download backups, schedule automatic backups, and restore from backup files.',
    href: '/settings/backup',
    icon: <HardDrive className="size-8 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />,
  },
];

// ── Page ────────────────────────────────────────────────────────────────

export default function DataAndBackupsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/settings"
          className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          Back to Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Data &amp; Backups
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          Manage your journal backups, scheduled backup settings, and data integrity.
        </p>
      </div>

      {/* Card grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {dataCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-lg border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
          >
            <div className="mb-3">{card.icon}</div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{card.title}</h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
