'use client';

import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface LifecycleStepperProps {
  status: 'planned' | 'open' | 'closed' | 'deleted';
  direction: 'long' | 'short';
  openedAt?: string | null;
  exitNotes?: string | null;
  lesson?: string | null;
}

interface Step {
  number: number;
  label: string;
}

const STEPS: Step[] = [
  { number: 1, label: 'Plan' },
  { number: 2, label: 'Size' },
  { number: 3, label: 'Execute' },
  { number: 4, label: 'Manage' },
  { number: 5, label: 'Exit' },
  { number: 6, label: 'Grade' },
];

export function getCurrentStep(
  status: LifecycleStepperProps['status'],
  openedAt?: string | null,
  exitNotes?: string | null,
  lesson?: string | null,
): { currentStep: number; isScratched: boolean } {
  switch (status) {
    case 'planned':
      return { currentStep: 1, isScratched: false };
    case 'open':
      return {
        currentStep: openedAt ? 4 : 3,
        isScratched: false,
      };
    case 'closed':
      return {
        currentStep: exitNotes || lesson ? 6 : 5,
        isScratched: false,
      };
    case 'deleted':
      return { currentStep: 1, isScratched: true };
  }
}

export function LifecycleStepper({
  status,
  direction,
  openedAt,
  exitNotes,
  lesson,
}: LifecycleStepperProps) {
  const { currentStep, isScratched } = getCurrentStep(status, openedAt, exitNotes, lesson);
  const isLong = direction === 'long';

  return (
    <div
      className={cn(
        'flex w-full items-center justify-between',
        isScratched && 'opacity-50',
      )}
    >
      {STEPS.map((step, index) => {
        const isCompleted = step.number < currentStep;
        const isActive = step.number === currentStep;
        const isFuture = step.number > currentStep;

        return (
          <div key={step.number} className="flex flex-1 items-center last:flex-none">
            {/* Step circle + label column */}
            <div className="flex flex-col items-center">
              {/* Number circle */}
              <div
                className={cn(
                  'flex size-8 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  // Completed: filled circle with checkmark
                  isCompleted && isLong && 'bg-emerald-500 text-white dark:bg-emerald-400 dark:text-white',
                  isCompleted && !isLong && 'bg-red-500 text-white dark:bg-red-400 dark:text-white',
                  // Active: outlined circle with accent border
                  isActive && isLong && 'border-2 border-emerald-500 bg-white text-emerald-600 dark:border-emerald-400 dark:bg-zinc-900 dark:text-emerald-400',
                  isActive && !isLong && 'border-2 border-red-500 bg-white text-red-600 dark:border-red-400 dark:bg-zinc-900 dark:text-red-400',
                  // Future: light outline
                  isFuture && 'border border-zinc-300 bg-white text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-500',
                  // Scratched: muted outline
                  isScratched && 'border border-zinc-300 text-zinc-400 dark:border-zinc-600 dark:text-zinc-500',
                )}
              >
                {isCompleted ? (
                  <Check className="size-4" strokeWidth={2.5} />
                ) : isScratched ? (
                  <span className="line-through">1</span>
                ) : (
                  <span>{step.number}</span>
                )}
              </div>

              {/* Step label */}
              <span
                className={cn(
                  'mt-1.5 whitespace-nowrap text-[11px] font-medium transition-colors',
                  isActive && isLong && 'text-emerald-600 dark:text-emerald-400',
                  isActive && !isLong && 'text-red-600 dark:text-red-400',
                  isCompleted && 'text-zinc-700 dark:text-zinc-300',
                  isFuture && 'text-zinc-400 dark:text-zinc-500',
                  isScratched && 'text-zinc-400 dark:text-zinc-500 line-through',
                )}
              >
                {step.label}
              </span>
            </div>

            {/* Connector bar between steps */}
            {index < STEPS.length - 1 && (
              <div className={cn('mx-2 flex-1', isScratched && 'opacity-40')}>
                <div
                  className={cn(
                    'h-[2px] transition-colors',
                    step.number < currentStep && isLong && 'bg-emerald-400 dark:bg-emerald-500',
                    step.number < currentStep && !isLong && 'bg-red-400 dark:bg-red-500',
                    step.number >= currentStep && 'bg-zinc-200 dark:bg-zinc-700',
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
