'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Building2,
  ChartNoAxesCombined,
  CircleCheck,
  CircleDashed,
  Gamepad2,
  Play,
  ShieldCheck,
  User,
} from 'lucide-react';
import type { ReadinessState } from '@/lib/readiness';

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

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 size-8 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
      <div className="mb-2 h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-3 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
      <div className="mt-2 h-3 w-5/6 rounded bg-zinc-100 dark:bg-zinc-800" />
    </div>
  );
}

function SetupChecklist({ readiness }: { readiness: ReadinessState }) {
  const steps = readiness.missing;
  const nextStep = steps[0] ?? null;
  const stepMap = new Map(steps.map((step, index) => [step.id, { ...step, stepNumber: index + 1 }]));

  const orderedSteps = [
    { id: 'app_profile', label: 'App Profile', href: '/settings/app' },
    { id: 'settings', label: 'Risk Settings', href: '/settings/risk' },
    { id: 'accounts', label: 'Accounts', href: '/settings/accounts' },
    { id: 'setups', label: 'Trading Setups', href: '/settings/plays' },
  ].map((step, index) => {
    const missing = stepMap.get(step.id);
    return {
      ...step,
      stepNumber: index + 1,
      isMissing: Boolean(missing),
      description:
        step.id === 'app_profile'
          ? 'Set your display name and profile details.'
          : step.id === 'settings'
            ? 'Choose your journal start date and risk defaults.'
            : step.id === 'accounts'
              ? 'Add at least one active brokerage account.'
              : 'Create at least one active trading setup.',
    };
  });

  return (
    <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Setup your journal</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Complete these steps to get started.
          </p>
        </div>
        {nextStep && (
          <Link
            href={nextStep.href}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Play className="size-3.5" />
            Continue setup
          </Link>
        )}
      </div>

      <div className="space-y-3">
        {orderedSteps.map((step) => (
          <div
            key={step.id}
            className={`flex items-start gap-4 rounded-lg border p-4 ${
              step.isMissing
                ? 'border-dashed border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/40'
                : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-900/10'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {step.isMissing ? (
                <CircleDashed className="size-5 text-zinc-400 dark:text-zinc-500" />
              ) : (
                <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Step {step.stepNumber}
                </span>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{step.label}</h3>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{step.description}</p>
            </div>
            <Link
              href={step.href}
              aria-label={`Setup ${step.label}`}
              title={`Setup ${step.label}`}
              className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Set up
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SettingsHubPage() {
  const [readiness, setReadiness] = useState<ReadinessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReadiness = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/readiness', { signal });
      const data = (await res.json().catch(() => null)) as ReadinessState | { error?: string } | null;

      if (!res.ok) {
        throw new Error((data && 'error' in data && data.error) || 'Failed to load readiness');
      }

      setReadiness((data && 'ready' in data ? data : null) as ReadinessState | null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load readiness');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReadiness(controller.signal);

    const handleFocus = () => void loadReadiness();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadReadiness();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      controller.abort();
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadReadiness]);

  const shouldShowChecklist = readiness !== null && readiness.ready === false;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Settings
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage your trading journal preferences, risk parameters, and trading setups.
          </p>
        </div>
        {!loading && readiness?.ready && (
          <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-400">
            All set
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {shouldShowChecklist && readiness && <SetupChecklist readiness={readiness} />}

      {!loading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-lg border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
          >
            <div className="mb-3">{card.icon}</div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{card.title}</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{card.description}</p>
          </Link>
        ))}
      </div>
    )}
    </div>
  );
}
