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

  // 4. closed WITHOUT exitNotes or lesson → Exit (step 5)
  {
    const r = getCurrentStep('closed', null, null, null);
    assert(r.currentStep === 5, 'closed without notes → step 5 (Exit)');
  }

  // 5. closed WITH exitNotes → Grade (step 6)
  {
    const r = getCurrentStep('closed', null, 'Stopped out on earnings gap', null);
    assert(r.currentStep === 6, 'closed with exitNotes → step 6 (Grade)');
  }

  // 6. closed WITH lesson → Grade (step 6)
  {
    const r = getCurrentStep('closed', null, null, 'Should have cut loss earlier');
    assert(r.currentStep === 6, 'closed with lesson → step 6 (Grade)');
  }

  // 7. closed WITH both exitNotes and lesson → Grade (step 6)
  {
    const r = getCurrentStep('closed', null, 'Stopped out', 'Should have cut earlier');
    assert(r.currentStep === 6, 'closed with both notes → step 6 (Grade)');
  }

  // 7b. closed WITHOUT notes but WITH hasGrade → Grade (step 6)
  {
    const r = getCurrentStep('closed', null, null, null, true, false);
    assert(r.currentStep === 6, 'closed with hasGrade=true and no notes → step 6 (Grade)');
  }

  // 7c. closed WITHOUT notes but WITH hasMistakes → Grade (step 6)
  {
    const r = getCurrentStep('closed', null, null, null, false, true);
    assert(r.currentStep === 6, 'closed with hasMistakes=true and no notes → step 6 (Grade)');
  }

  // 7d. closed WITHOUT notes but WITH both hasGrade and hasMistakes → Grade (step 6)
  {
    const r = getCurrentStep('closed', null, null, null, true, true);
    assert(r.currentStep === 6, 'closed with both grade and mistakes → step 6 (Grade)');
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

  // 10. closed with empty exitNotes and empty lesson → Exit (step 5)
  {
    const r = getCurrentStep('closed', null, '', '');
    assert(r.currentStep === 5, 'closed with empty strings → step 5');
  }

  // 11. open with undefined openedAt → Execute (step 3)
  {
    const r = getCurrentStep('open');
    assert(r.currentStep === 3, 'open with undefined openedAt → step 3');
  }

  // 12. closed with undefined exitNotes and lesson → Exit (step 5)
  {
    const r = getCurrentStep('closed');
    assert(r.currentStep === 5, 'closed with undefined notes → step 5');
  }

  // 13. open with null-ish openedAt (explicit null) → Execute (step 3)
  {
    const r = getCurrentStep('open', null);
    assert(r.currentStep === 3, 'open with null openedAt → step 3');
  }

  // 14. closed WITHOUT notes, grade, or mistakes → default to Exit (step 5)
  {
    const r = getCurrentStep('closed', null, null, null, false, false);
    assert(r.currentStep === 5, 'closed with no notes, no grade, no mistakes → step 5 (Exit)');
    assert(r.isScratched === false, 'closed with no signals → not scratched');
  }

  // 15. hasGrade and hasMistakes are ignored for non-closed status
  {
    const r = getCurrentStep('planned', null, null, null, true, true);
    assert(r.currentStep === 1, 'planned ignores hasGrade/hasMistakes → step 1');
  }

  // 16. hasGrade and hasMistakes default to falsey when omitted
  {
    const r = getCurrentStep('closed', null, 'Has notes', null);
    assert(r.currentStep === 6, 'closed with notes and omitted grade/mistakes → step 6');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
