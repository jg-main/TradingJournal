/**
 * lifecycle-stepper.test.ts
 *
 * Tests for the LifecycleStepper component's getCurrentStep logic.
 * Covers all status-to-step mappings, edge cases, and negative scenarios.
 *
 * Run: npx tsx src/components/lifecycle-stepper.test.ts
 */

import { getCurrentStep } from './lifecycle-stepper';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED)`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Positive tests — every status maps to the correct step
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## getCurrentStep — status mappings');

  // 1. planned → Plan (step 1), not scratched
  {
    const r = getCurrentStep('planned');
    assert(r.currentStep === 1, 'planned → step 1 (Plan)');
    assert(r.isScratched === false, 'planned → not scratched');
  }

  // 2. open WITHOUT openedAt → Execute (step 3)
  {
    const r = getCurrentStep('open', null);
    assert(r.currentStep === 3, 'open without openedAt → step 3 (Execute)');
    assert(r.isScratched === false, 'open → not scratched');
  }

  // 3. open WITH openedAt → Manage (step 4)
  {
    const r = getCurrentStep('open', '2026-06-15T10:00:00Z');
    assert(r.currentStep === 4, 'open with openedAt → step 4 (Manage)');
  }

  // 4. closed WITHOUT exitNotes or lesson → Grade (step 6, current)
  {
    const r = getCurrentStep('closed', null, null, null);
    assert(r.currentStep === 6, 'closed without notes → step 6 (Grade current)');
  }

  // 5. closed WITH exitNotes but WITHOUT reviewedAt → Grade current (step 6)
  //    (S07/T02: step 7 is driven by the durable reviewedAt marker only)
  {
    const r = getCurrentStep('closed', null, 'Stopped out on earnings gap', null);
    assert(r.currentStep === 6, 'closed with exitNotes but no reviewedAt → step 6 (Grade current)');
  }

  // 6. closed WITH lesson but WITHOUT reviewedAt → Grade current (step 6)
  {
    const r = getCurrentStep('closed', null, null, 'Should have cut loss earlier');
    assert(r.currentStep === 6, 'closed with lesson but no reviewedAt → step 6 (Grade current)');
  }

  // 7. closed WITH both notes but WITHOUT reviewedAt → Grade current (step 6)
  {
    const r = getCurrentStep('closed', null, 'Stopped out', 'Should have cut earlier');
    assert(r.currentStep === 6, 'closed with both notes but no reviewedAt → step 6 (Grade current)');
  }

  // 7b. closed WITH hasGrade but WITHOUT reviewedAt → Grade current (step 6)
  {
    const r = getCurrentStep('closed', null, null, null, true, false);
    assert(r.currentStep === 6, 'closed with hasGrade=true but no reviewedAt → step 6 (Grade current)');
  }

  // 7c. closed WITH hasMistakes but WITHOUT reviewedAt → Grade current (step 6)
  {
    const r = getCurrentStep('closed', null, null, null, false, true);
    assert(r.currentStep === 6, 'closed with hasMistakes=true but no reviewedAt → step 6 (Grade current)');
  }

  // 7d. closed WITH both hasGrade and hasMistakes but WITHOUT reviewedAt → step 6
  {
    const r = getCurrentStep('closed', null, null, null, true, true);
    assert(r.currentStep === 6, 'closed with grade and mistakes but no reviewedAt → step 6 (Grade current)');
  }

  // 7e. closed WITH reviewedAt (durable marker) → all steps complete (step 7)
  {
    const r = getCurrentStep('closed', null, undefined, undefined, undefined, undefined, undefined, '2026-08-10T12:00:00Z');
    assert(r.currentStep === 7, 'closed with reviewedAt → step 7 (all complete)');
    assert(r.isScratched === false, 'closed with reviewedAt → not scratched');
  }

  // 7f. closed WITH reviewedAt even when evidence presence is false → step 7
  {
    const r = getCurrentStep('closed', null, null, null, false, false, undefined, '2026-08-10T12:00:00Z');
    assert(r.currentStep === 7, 'closed with reviewedAt and no notes/grade/mistakes → step 7 (all complete)');
  }

  // 7g. reviewedAt is ignored for non-closed statuses
  {
    const r = getCurrentStep('planned', null, null, null, undefined, undefined, undefined, '2026-08-10T12:00:00Z');
    assert(r.currentStep === 1, 'planned ignores reviewedAt → step 1');
  }

  // 8. deleted → step 1, isScratched = true
  {
    const r = getCurrentStep('deleted');
    assert(r.currentStep === 1, 'deleted → step 1 (Plan)');
    assert(r.isScratched === true, 'deleted → isScratched true');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Edge cases and negative tests
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Edge cases & negative tests');

  // 9. open with empty string openedAt → still treated as not yet entered
  {
    const r = getCurrentStep('open', '');
    assert(r.currentStep === 3, 'open with empty openedAt → step 3');
  }

  // 10. closed with empty exitNotes and empty lesson → Grade (step 6, current)
  {
    const r = getCurrentStep('closed', null, '', '');
    assert(r.currentStep === 6, 'closed with empty strings → step 6');
  }

  // 11. open with undefined openedAt → Execute (step 3)
  {
    const r = getCurrentStep('open');
    assert(r.currentStep === 3, 'open with undefined openedAt → step 3');
  }

  // 12. closed with undefined exitNotes and lesson → Grade (step 6, current)
  {
    const r = getCurrentStep('closed');
    assert(r.currentStep === 6, 'closed with undefined notes → step 6');
  }

  // 13. open with null-ish openedAt (explicit null) → Execute (step 3)
  {
    const r = getCurrentStep('open', null);
    assert(r.currentStep === 3, 'open with null openedAt → step 3');
  }

  // 14. closed WITHOUT notes, grade, or mistakes → Grade current (step 6)
  {
    const r = getCurrentStep('closed', null, null, null, false, false);
    assert(r.currentStep === 6, 'closed with no notes, no grade, no mistakes → step 6 (Grade current)');
    assert(r.isScratched === false, 'closed with no signals → not scratched');
  }

  // 15. hasGrade and hasMistakes are ignored for non-closed status
  {
    const r = getCurrentStep('planned', null, null, null, true, true);
    assert(r.currentStep === 1, 'planned ignores hasGrade/hasMistakes → step 1');
  }

  // 16. notes presence does NOT advance a closed trade to step 7 without the
  //     reviewedAt marker (S07/T02); omitted grade/mistakes stay falsey
  {
    const r = getCurrentStep('closed', null, 'Has notes', null);
    assert(r.currentStep === 6, 'closed with notes but no reviewedAt → step 6 (Grade current)');
  }
}

// ────────────────────────────────────────────────────────────────────────
// S05/T03 — workflowPhase sub-phase mapping (managed vs open)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## getCurrentStep — workflowPhase (S05/T03)');

  // 17. open + managed WITHOUT openedAt → Manage (step 4)
  {
    const r = getCurrentStep('open', null, undefined, undefined, undefined, undefined, 'managed');
    assert(r.currentStep === 4, 'open + managed without openedAt → step 4 (Manage)');
    assert(r.isScratched === false, 'open + managed → not scratched');
  }

  // 18. open + managed WITH openedAt → Manage (step 4)
  {
    const r = getCurrentStep('open', '2026-06-15T10:00:00Z', undefined, undefined, undefined, undefined, 'managed');
    assert(r.currentStep === 4, 'open + managed with openedAt → step 4 (Manage)');
  }

  // 19. open + explicit 'open' phase without openedAt → Execute (step 3)
  {
    const r = getCurrentStep('open', null, undefined, undefined, undefined, undefined, 'open');
    assert(r.currentStep === 3, 'open + phase open without openedAt → step 3 (Execute)');
  }

  // 20. open + explicit 'open' phase WITH openedAt → Manage (step 4, preserved)
  {
    const r = getCurrentStep('open', '2026-06-15T10:00:00Z', undefined, undefined, undefined, undefined, 'open');
    assert(r.currentStep === 4, 'open + phase open with openedAt → step 4 (Manage, preserved)');
  }

  // 21. managed is ignored for planned status
  {
    const r = getCurrentStep('planned', null, undefined, undefined, undefined, undefined, 'managed');
    assert(r.currentStep === 1, 'planned ignores managed → step 1 (Plan)');
  }

  // 22. managed is ignored for closed status
  {
    const r = getCurrentStep('closed', null, null, null, undefined, undefined, 'managed');
    assert(r.currentStep === 6, 'closed ignores managed → step 6 (Grade)');
  }

  // 23. managed is ignored for deleted status
  {
    const r = getCurrentStep('deleted', undefined, undefined, undefined, undefined, undefined, 'managed');
    assert(r.currentStep === 1 && r.isScratched === true, 'deleted ignores managed → step 1, scratched');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
