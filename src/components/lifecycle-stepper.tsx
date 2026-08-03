'use client';

import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface LifecycleStepperProps {
  status: 'planned' | 'open' | 'closed' | 'deleted';
  direction: 'long' | 'short';
  openedAt?: string | null;
  exitNotes?: string | null;
  lesson?: string | null;
  hasGrade?: boolean;
  hasMistakes?: boolean;
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
  hasGrade?: boolean,
  hasMistakes?: boolean,
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
        // Steps 1-5 are complete for closed trades. Step 6 (Grade) is current.
        // When grade/review data exists, use 7 so all 6 steps show as complete.
        currentStep: exitNotes || lesson || hasGrade || hasMistakes ? 7 : 6,
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
  hasGrade,
  hasMistakes,
}: LifecycleStepperProps) {
  const { currentStep, isScratched } = getCurrentStep(status, openedAt, exitNotes, lesson, hasGrade, hasMistakes);
  const isLong = direction === 'long';

  return (
    <div
      className={cn(
        'flex w-full items-center justify-between',
        isScratched && 'opacity-50',
      )}
    >
      {STEPS.map((step, index) => {
        const isLastStep = index === STEPS.length - 1;
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
                  isCompleted && isLong && 'bg-positive text-primary-foreground',
                  isCompleted && !isLong && 'bg-negative text-primary-foreground',
                  // Active: outlined circle with accent border
                  isActive && isLong && 'border-2 border-positive bg-card text-positive',
                  isActive && !isLong && 'border-2 border-negative bg-card text-negative',
                  // Future: light outline
                  isFuture && 'border border-border bg-card text-muted-foreground',
                  // Scratched: muted outline
                  isScratched && 'border border-border text-muted-foreground',
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
                  isActive && isLong && 'text-positive',
                  isActive && !isLong && 'text-negative',
                  isCompleted && 'text-foreground',
                  isFuture && 'text-muted-foreground',
                  isScratched && 'text-muted-foreground line-through',
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
                    step.number < currentStep && isLong && 'bg-positive',
                    step.number < currentStep && !isLong && 'bg-negative',
                    step.number >= currentStep && 'bg-muted',
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
