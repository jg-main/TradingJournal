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

  // 1. idea → Plan (step 1), not scratched
  {
    const r = getCurrentStep('idea');
    assert(r.currentStep === 1, 'idea → step 1 (Plan)');
    assert(r.isScratched === false, 'idea → not scratched');
  }

  // 2. planned → Plan (step 1), not scratched
  {
    const r = getCurrentStep('planned');
    assert(r.currentStep === 1, 'planned → step 1 (Plan)');
    assert(r.isScratched === false, 'planned → not scratched');
  }

  // 3. open WITHOUT openedAt → Execute (step 3)
  {
    const r = getCurrentStep('open', null);
    assert(r.currentStep === 3, 'open without openedAt → step 3 (Execute)');
    assert(r.isScratched === false, 'open → not scratched');
  }

  // 4. open WITH openedAt → Manage (step 4)
  {
    const r = getCurrentStep('open', '2026-06-15T10:00:00Z');
    assert(r.currentStep === 4, 'open with openedAt → step 4 (Manage)');
  }

  // 5. partially_closed → Manage (step 4)
  {
    const r = getCurrentStep('partially_closed');
    assert(r.currentStep === 4, 'partially_closed → step 4 (Manage)');
  }

  // 6. closed WITHOUT exitNotes or lesson → Exit (step 5)
  {
    const r = getCurrentStep('closed', null, null, null);
    assert(r.currentStep === 5, 'closed without notes → step 5 (Exit)');
  }

  // 7. closed WITH exitNotes → Grade (step 6)
  {
    const r = getCurrentStep('closed', null, 'Stopped out on earnings gap', null);
    assert(r.currentStep === 6, 'closed with exitNotes → step 6 (Grade)');
  }

  // 8. closed WITH lesson → Grade (step 6)
  {
    const r = getCurrentStep('closed', null, null, 'Should have cut loss earlier');
    assert(r.currentStep === 6, 'closed with lesson → step 6 (Grade)');
  }

  // 9. closed WITH both exitNotes and lesson → Grade (step 6)
  {
    const r = getCurrentStep('closed', null, 'Stopped out', 'Should have cut earlier');
    assert(r.currentStep === 6, 'closed with both notes → step 6 (Grade)');
  }

  // 10. scratched → step 1, isScratched = true
  {
    const r = getCurrentStep('scratched');
    assert(r.currentStep === 1, 'scratched → step 1 (Plan)');
    assert(r.isScratched === true, 'scratched → isScratched true');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Edge cases and negative tests
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Edge cases & negative tests');

  // 11. open with empty string openedAt → still treated as not yet entered
  {
    const r = getCurrentStep('open', '');
    assert(r.currentStep === 3, 'open with empty openedAt → step 3');
  }

  // 12. closed with empty exitNotes and empty lesson → Exit (step 5)
  {
    const r = getCurrentStep('closed', null, '', '');
    assert(r.currentStep === 5, 'closed with empty strings → step 5');
  }

  // 13. open with undefined openedAt → Execute (step 3)
  {
    const r = getCurrentStep('open');
    assert(r.currentStep === 3, 'open with undefined openedAt → step 3');
  }

  // 14. closed with undefined exitNotes and lesson → Exit (step 5)
  {
    const r = getCurrentStep('closed');
    assert(r.currentStep === 5, 'closed with undefined notes → step 5');
  }

  // 15. open with null-ish openedAt (explicit null) → Execute (step 3)
  {
    const r = getCurrentStep('open', null);
    assert(r.currentStep === 3, 'open with null openedAt → step 3');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
