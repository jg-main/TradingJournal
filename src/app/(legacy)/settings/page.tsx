'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BookOpen,
  CircleCheck,
  CircleDashed,
  Globe,
  HardDrive,
  Landmark,
  Play,
  Puzzle,
  ShieldCheck,
} from 'lucide-react';
import type { ReadinessState } from '@/lib/readiness';

// ── Types ───────────────────────────────────────────────────────────────

interface HubCard {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  onClick?: () => void;
}



// ── Cards (Link-based) ──────────────────────────────────────────────────

const cards: HubCard[] = [
  {
    title: 'Workspace',
    description: 'Configure workspace timezone and regional preferences.',
    href: '/settings/workspace',
    icon: <Globe className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
  {
    title: 'Accounts',
    description: 'Manage brokerage accounts, view effective risk and commission values, and set overrides.',
    href: '/settings/accounts',
    icon: <Landmark className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
  {
    title: 'Risk Defaults',
    description: 'Set global risk defaults that apply as fallbacks for all accounts.',
    href: '/settings/risk-defaults',
    icon: <ShieldCheck className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
  {
    title: 'Journal Setup',
    description: 'Manage trading setups and mistake categories used in your journal.',
    href: '/settings/journal-setup',
    icon: <BookOpen className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
  {
    title: 'Integrations',
    description: 'Configure AI service providers and market data sources.',
    href: '/settings/integrations',
    icon: <Puzzle className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
  {
    title: 'Backup',
    description: 'Download backups, schedule automatic backups, and restore from backup files.',
    href: '/settings/backup',
    icon: <HardDrive className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
  {
    title: 'Danger Zone',
    description: 'Destructive actions that permanently alter your journal data.',
    href: '/settings/danger-zone',
    icon: <AlertTriangle className="size-8 text-muted-foreground" strokeWidth={1.5} />,
  },
];

// ── Skeleton ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-6">
      <div className="mb-3 size-8 rounded-lg bg-muted" />
      <div className="mb-2 h-4 w-24 rounded bg-muted" />
      <div className="h-3 w-full rounded bg-muted" />
      <div className="mt-2 h-3 w-5/6 rounded bg-muted" />
    </div>
  );
}

// ── Setup Checklist ────────────────────────────────────────────────────

function SetupChecklist({ readiness }: { readiness: ReadinessState }) {
  const steps = readiness.missing;
  const nextStep = steps[0] ?? null;
  const stepMap = new Map(steps.map((step, index) => [step.id, { ...step, stepNumber: index + 1 }]));

  const orderedSteps = [
    { id: 'app_profile', label: 'Workspace', href: '/settings/workspace' },
    { id: 'settings', label: 'Risk Defaults', href: '/settings/risk-defaults' },
    { id: 'setups', label: 'Trading Setups', href: '/settings/plays' },
  ].map((step, index) => {
    const missing = stepMap.get(step.id);
    return {
      ...step,
      stepNumber: index + 1,
      isMissing: Boolean(missing),
      description:
        step.id === 'app_profile'
          ? 'Set your workspace timezone and regional preferences.'
          : step.id === 'settings'
            ? 'Choose your global risk defaults.'
            : 'Create at least one active trading setup.',
    };
  });

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Setup your journal</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete these steps to get started.
          </p>
        </div>
        {nextStep && (
          <Link
            href={nextStep.href}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/80 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
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
                ? 'border-dashed border-border bg-muted/50'
                : 'border-positive/30 bg-positive/10'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {step.isMissing ? (
                <CircleDashed className="size-5 text-muted-foreground" />
              ) : (
                <CircleCheck className="size-5 text-positive" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Step {step.stepNumber}
                </span>
                <h3 className="text-sm font-semibold text-foreground">{step.label}</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
            </div>
            <Link
              href={step.href}
              aria-label={`Setup ${step.label}`}
              title={`Setup ${step.label}`}
              className="shrink-0 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              Set up
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}




// ── Main Page ───────────────────────────────────────────────────────────

export default function SettingsHubPage() {
  useEffect(() => { document.title = "Settings — Trading Journal"; }, []);
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your trading journal preferences, risk parameters, and trading setups.
          </p>
        </div>
        {!loading && readiness?.ready && (
          <div className="rounded-full border border-positive/30 bg-positive/10 px-3 py-1 text-xs font-medium text-positive">
            All set
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
          {cards.map((card) =>
            card.onClick ? (
              <button
                key={card.title}
                onClick={card.onClick}
                className="group rounded-lg border border-border bg-card p-6 text-left transition-colors hover:border-border hover:bg-muted/50"
              >
                <div className="mb-3">{card.icon}</div>
                <h2 className="text-sm font-semibold text-foreground">{card.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
              </button>
            ) : (
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
      )}




    </div>
  );
}
