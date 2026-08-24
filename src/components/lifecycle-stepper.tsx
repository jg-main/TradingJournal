'use client';

import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import type { WorkflowPhase } from '@/lib/workflow-phase';

interface LifecycleStepperProps {
  status: 'planned' | 'open' | 'closed' | 'deleted';
  direction: 'long' | 'short';
  openedAt?: string | null;
  exitNotes?: string | null;
  lesson?: string | null;
  hasGrade?: boolean;
  hasMistakes?: boolean;
  // S05/T03: derived workflow phase — when 'managed', the Manage step (4)
  // is current regardless of openedAt; 'open' preserves the existing
  // Execute/Manage behavior.
  workflowPhase?: WorkflowPhase;
  // S07/T02: durable reviewedAt marker (written by POST /api/trades/[id]/review)
  // drives the reviewed step (7). When present on a closed trade, all six
  // steps show as complete.
  reviewedAt?: string | null;
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
  // S05/T03: appended last so existing positional callers stay valid.
  workflowPhase?: WorkflowPhase,
  // S07/T02: durable review marker, appended after workflowPhase so existing
  // positional callers stay valid.
  reviewedAt?: string | null,
): { currentStep: number; isScratched: boolean } {
  switch (status) {
    case 'planned':
      return { currentStep: 1, isScratched: false };
    case 'open':
      if (workflowPhase === 'managed') {
        // Meaningful management activity exists (add/reduce/adjustment) —
        // the Manage step is current even if openedAt is missing.
        return { currentStep: 4, isScratched: false };
      }
      return {
        currentStep: openedAt ? 4 : 3,
        isScratched: false,
      };
    case 'closed':
      return {
        // Steps 1-5 are complete for closed trades. Step 6 (Grade) is current.
        // S07/T02: the reviewed step (7) is driven by the durable reviewedAt
        // marker alone — not by the presence of exit notes, a lesson, a grade,
        // or recorded mistakes (evidence presence ≠ reviewed).
        currentStep: reviewedAt ? 7 : 6,
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
  workflowPhase,
  reviewedAt,
}: LifecycleStepperProps) {
  const { currentStep, isScratched } = getCurrentStep(status, openedAt, exitNotes, lesson, hasGrade, hasMistakes, workflowPhase, reviewedAt);
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
