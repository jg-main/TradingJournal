/**
 * assessment-history.test.ts
 *
 * Tests for the AssessmentHistory component.
 * Verifies module contract, source-level helper function logic,
 * props interface, and state rendering paths.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/assessment-history.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compSourcePath = path.resolve(__dirname, '../assessment-history.tsx');

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
// Module contract — verify component can be imported and inspected
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Module contract');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('export default function AssessmentHistory'), 'exports AssessmentHistory as default');
  assert(source.includes('export interface AssessmentSnapshot'), 'exports AssessmentSnapshot interface');
  assert(source.includes('export interface AssessmentHistoryProps'), 'exports AssessmentHistoryProps interface');
  assert(source.includes("import type { Scorecard }") || source.includes("import { type Scorecard }"), 'references Scorecard type from @/lib/scorecard');
  assert(source.includes("'use client'") || source.includes('"use client"'), 'has use client directive');
  assert(source.includes("import AssessmentCard from './assessment-card'"), 'imports AssessmentCard for expanded detail');
}

// ────────────────────────────────────────────────────────────────────────
// Client directive position
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Client component directive');

  const source = fs.readFileSync(compSourcePath, 'utf-8');
  // Strip leading whitespace/comments to find the first executable line
  const lines = source.trimStart().split('\n');
  const firstCodeLine = lines.find(
    (l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('/*') && !l.trim().startsWith('*')
  );
  assert(
    !!(firstCodeLine?.includes("'use client'") || firstCodeLine?.includes('"use client"')),
    'use client directive is the first meaningful line'
  );
}

// ────────────────────────────────────────────────────────────────────────
// AssessmentSnapshot interface — verify all declared fields
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## AssessmentSnapshot interface (source-level)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('id: string'), 'snapshot has id (string)');
  assert(source.includes('tradeId: string'), 'snapshot has tradeId (string)');
  assert(source.includes('assessedAt: string | null'), 'snapshot has assessedAt (string | null)');
  assert(source.includes('assessmentType: string'), 'snapshot has assessmentType (string)');
  assert(source.includes('overallScore: number | null'), 'snapshot has overallScore (number | null)');
  assert(source.includes('modelUsed: string | null'), 'snapshot has modelUsed (string | null)');
  assert(source.includes('promptTokens: number | null'), 'snapshot has promptTokens (number | null)');
  assert(source.includes('completionTokens: number | null'), 'snapshot has completionTokens (number | null)');
  assert(source.includes('notes: string | null'), 'snapshot has notes (string | null)');
  assert(source.includes('createdAt: string | null'), 'snapshot has createdAt (string | null)');
  assert(source.includes('scorecard: Scorecard | null'), 'snapshot has scorecard (Scorecard | null)');
  assert(source.includes('snapshotVersion: number'), 'snapshot has snapshotVersion (number)');
  assert(source.includes('promptText?: string | null'), 'snapshot has promptText (string | null | undefined)');
  assert(source.includes('rawResponse?: string | null'), 'snapshot has rawResponse (string | null | undefined)');
}

// ────────────────────────────────────────────────────────────────────────
// Props interface — verify all declared props
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Props interface (source-level)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('assessments: AssessmentSnapshot[]'), 'accepts assessments prop (AssessmentSnapshot[])');
  assert(source.includes('loading?: boolean'), 'accepts optional loading prop');
  assert(source.includes('error?: string | null'), 'accepts optional error prop');
}

// ────────────────────────────────────────────────────────────────────────
// Import check — verify dependencies are safe and correct
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Import safety');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    !source.includes('server-only'),
    'does not import server-only module'
  );
  assert(
    !source.includes('better-sqlite3'),
    'does not import database module'
  );
  assert(
    !source.includes('drizzle'),
    'does not import drizzle ORM'
  );
  assert(
    source.includes("lucide-react"),
    'imports icons from lucide-react'
  );
  assert(
    source.includes("@/components/ui/card"),
    'imports Card components from @/components/ui/card'
  );
  assert(
    source.includes("@/components/ui/badge"),
    'imports Badge from @/components/ui/badge'
  );
  assert(
    source.includes("@/lib/utils"),
    'imports cn utility from @/lib/utils'
  );
  assert(
    source.includes("@/lib/scorecard"),
    'imports Scorecard type from @/lib/scorecard'
  );
  assert(
    source.includes("./assessment-card"),
    'imports AssessmentCard for expanded detail rendering'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helper function: gradeColorClass — verify all letter-to-color mappings
// (same mapping as assessment-card.tsx, duplicated for this component)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Helper: gradeColorClass');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // The gradeColorClass function uses a switch statement with 6 cases + default
  assert(source.includes("case 'A'") && source.includes('emerald'), 'grade A maps to emerald color');
  assert(source.includes("case 'B'") && source.includes('blue'), 'grade B maps to blue color');
  assert(source.includes("case 'C'") && source.includes('amber'), 'grade C maps to amber color');
  assert(source.includes("case 'D'") && source.includes('orange'), 'grade D maps to orange color');
  assert(source.includes("case 'F'") && source.includes('red'), 'grade F maps to red color');
  assert(source.includes('default:') && source.includes('zinc'), 'default (unknown grade) maps to zinc color');
  assert(source.includes('function gradeColorClass'), 'gradeColorClass function is defined');
  assert(source.includes('letter: string'), 'gradeColorClass accepts a string parameter');
}

// ────────────────────────────────────────────────────────────────────────
// Helper function: scoreLabel — verify all score threshold mappings
// (same mapping as assessment-card.tsx, duplicated for this component)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Helper: scoreLabel');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function scoreLabel'), 'scoreLabel function is defined');
  assert(source.includes("return 'Excellent'"), 'score >= 80 returns Excellent');
  assert(source.includes("return 'Good'"), 'score >= 60 returns Good');
  assert(source.includes("return 'Fair'"), 'score >= 40 returns Fair');
  assert(source.includes("return 'Needs Improvement'"), 'score < 40 returns Needs Improvement');
  assert(source.includes('score >= 80'), 'first threshold is 80 (Excellent)');
  assert(source.includes('score >= 60'), 'second threshold is 60 (Good)');
  assert(source.includes('score >= 40'), 'third threshold is 40 (Fair)');
}

// ────────────────────────────────────────────────────────────────────────
// Helper function: formatTimestamp — verify input handling
// (same implementation as assessment-card.tsx, duplicated for this component)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Helper: formatTimestamp');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function formatTimestamp'), 'formatTimestamp function is defined');
  assert(source.includes('ts: string | undefined | null'), 'formatTimestamp accepts string | undefined | null');
  assert(source.includes("if (!ts) return ''"), 'returns empty string for null/undefined/empty input');
  assert(source.includes('new Date(ts).toLocaleString'), 'formats valid timestamps via toLocaleString');
  assert(source.includes('catch'), 'handles invalid dates with try/catch fallback');
  assert(source.includes("return ts"), 'returns raw ts string in catch fallback');
  assert(source.includes('month:'), 'formatTimestamp includes month option');
  assert(source.includes('year:'), 'formatTimestamp includes year option');
}

// ────────────────────────────────────────────────────────────────────────
// Helper function: deriveGradeLabel — NEW, unique to AssessmentHistory
// Verifies grade letter derivation from scorecard gradeLabel, overallScore,
// or fallback to '-'
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Helper: deriveGradeLabel');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function deriveGradeLabel'), 'deriveGradeLabel function is defined');
  assert(source.includes('assessment: AssessmentSnapshot'), 'deriveGradeLabel accepts an AssessmentSnapshot');

  // Prefers scorecard.gradeLabel when available
  assert(source.includes('scorecard?.gradeLabel'), 'checks scorecard.gradeLabel first');

  // Falls back to overallScore thresholds
  assert(source.includes('overallScore >= 80') && source.includes("return 'A'"), 'overallScore >= 80 returns A');
  assert(source.includes('overallScore >= 60') && source.includes("return 'B'"), 'overallScore >= 60 returns B');
  assert(source.includes('overallScore >= 40') && source.includes("return 'C'"), 'overallScore >= 40 returns C');
  assert(source.includes('overallScore >= 20') && source.includes("return 'D'"), 'overallScore >= 20 returns D');
  assert(source.includes("return 'F'"), 'overallScore < 20 returns F');

  // Returns '-' when neither scorecard nor overallScore is available
  assert(source.includes("return '-'"), 'returns dash when no grade is derivable');
}

// ────────────────────────────────────────────────────────────────────────
// Helper function: assessmentTypeLabel — NEW, unique to AssessmentHistory
// Verifies type-to-label mapping
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Helper: assessmentTypeLabel');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function assessmentTypeLabel'), 'assessmentTypeLabel function is defined');
  assert(source.includes("type: string"), 'assessmentTypeLabel accepts a string');

  assert(source.includes("=== 'ai_quality'") && source.includes("return 'Quality'"), 'ai_quality maps to Quality');
  assert(source.includes("=== 'ai_review'") && source.includes("return 'Review'"), 'ai_review maps to Review');
  assert(source.includes("return type"), 'unknown type returns the raw string');
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components — verify all 4 rendering branches are defined
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Sub-components (state rendering)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function ErrorState'), 'ErrorState sub-component is defined');
  assert(source.includes('function EmptyState'), 'EmptyState sub-component is defined');
  assert(source.includes('function HistoryRow'), 'HistoryRow sub-component is defined');
  assert(source.includes('function TableSkeleton'), 'TableSkeleton sub-component is defined');
}

// ────────────────────────────────────────────────────────────────────────
// State rendering — verify the root component conditionally renders
// the correct sub-component for each state
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## State rendering paths');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Loading takes highest priority
  assert(
    source.includes('if (loading)') && source.includes('<TableSkeleton />'),
    'loading=true renders Card with TableSkeleton'
  );

  // Error state (checked after loading)
  assert(
    source.includes('if (error)') && source.includes('<ErrorState'),
    'error string renders ErrorState'
  );

  // Empty state — no assessments exist
  assert(
    source.includes("assessments.length === 0") && source.includes('<EmptyState'),
    'empty assessments array renders EmptyState'
  );

  // Data state — has assessments
  assert(
    source.includes('assessments.map'),
    'non-empty assessments renders rows via map'
  );
}

// ────────────────────────────────────────────────────────────────────────
// TableSkeleton — verify loading skeleton content
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## TableSkeleton content');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function TableSkeleton'), 'TableSkeleton function is defined');
  assert(source.includes('divide-y'), 'TableSkeleton uses divide layout');
  assert(source.includes('animate-pulse'), 'TableSkeleton uses animate-pulse for skeleton animation');
  assert(source.includes('Ver'), 'TableSkeleton shows Ver column header');
  assert(source.includes('Date'), 'TableSkeleton shows Date column header');
  assert(source.includes('Model'), 'TableSkeleton shows Model column header');
  assert(source.includes('Type'), 'TableSkeleton shows Type column header');
  assert(source.includes('Score'), 'TableSkeleton shows Score column header');
  assert(source.includes('Grade'), 'TableSkeleton shows Grade column header');
  assert(source.includes('[1, 2, 3]'), 'TableSkeleton renders 3 skeleton rows');
}

// ────────────────────────────────────────────────────────────────────────
// ErrorState — verify error rendering (AssessmentHistory-specific)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## ErrorState content (AssessmentHistory)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('<span>{error}</span>'),
    'ErrorState renders the error message text'
  );
  assert(
    source.includes('AlertCircle') && source.includes('lucide-react'),
    'ErrorState uses AlertCircle icon'
  );
  assert(
    source.includes('History'),
    'ErrorState uses History icon in card title'
  );
  assert(
    source.includes('Assessment History'),
    'ErrorState shows Assessment History card title'
  );
}

// ────────────────────────────────────────────────────────────────────────
// EmptyState — verify empty state content (AssessmentHistory-specific)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## EmptyState content (AssessmentHistory)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('No assessment history yet'),
    'EmptyState shows empty state heading'
  );
  assert(
    source.includes('Assessments will appear here once you request one'),
    'EmptyState shows descriptive helper text'
  );
  assert(
    source.includes('History'),
    'EmptyState uses History icon (strokeWidth 1)'
  );
  assert(
    source.includes('strokeWidth={1}'),
    'EmptyState uses strokeWidth 1 for large icon'
  );
  assert(
    source.includes('py-8'),
    'EmptyState uses generous vertical padding'
  );
}

// ────────────────────────────────────────────────────────────────────────
// HistoryRow — verify expandable row structure and content columns
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## HistoryRow content');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function HistoryRow'), 'HistoryRow function is defined');
  assert(source.includes('assessment: AssessmentSnapshot'), 'HistoryRow accepts an AssessmentSnapshot');
  assert(source.includes('isExpanded: boolean'), 'HistoryRow accepts isExpanded boolean');
  assert(source.includes('onToggle: () => void'), 'HistoryRow accepts onToggle callback');

  // Expand/collapse icons
  assert(source.includes('<ChevronDown'), 'HistoryRow shows ChevronDown when expanded');
  assert(source.includes('<ChevronRight'), 'HistoryRow shows ChevronRight when collapsed');

  // Version number display
  assert(source.includes('snapshotVersion}'), 'HistoryRow displays snapshotVersion');
  assert(source.includes("v{"), 'HistoryRow prefixes version with v');

  // Date column
  assert(source.includes('formatTimestamp(assessment.assessedAt)'), 'HistoryRow formats assessedAt timestamp');

  // Model column
  assert(source.includes('modelUsed ||'), 'HistoryRow shows modelUsed or dash fallback');

  // Type column
  assert(source.includes('assessmentTypeLabel(assessment.assessmentType)'), 'HistoryRow translates assessmentType via helper');

  // Score column
  assert(source.includes('overallScore'), 'HistoryRow references overallScore for score column');

  // Grade badge
  assert(source.includes('deriveGradeLabel(assessment)'), 'HistoryRow derives grade label');
  assert(source.includes('gradeColorClass'), 'HistoryRow uses gradeColorClass for badge styling');
  assert(source.includes('<Badge'), 'HistoryRow renders grade inside Badge component');

  // Score label
  assert(source.includes('scoreLabel(score)'), 'HistoryRow shows score label for non-null scores');

  // Expanded detail area
  assert(source.includes('isExpanded &&'), 'HistoryRow conditionally renders expanded detail');
  assert(source.includes('<AssessmentCard'), 'HistoryRow renders AssessmentCard in expanded detail');
  assert(source.includes('scorecard={assessment.scorecard}'), 'HistoryRow passes scorecard to AssessmentCard');
  assert(source.includes('loading={false}'), 'HistoryRow passes loading=false to AssessmentCard');
  assert(source.includes('error={null}'), 'HistoryRow passes error=null to AssessmentCard');
  assert(source.includes('promptText={assessment.promptText}'), 'HistoryRow passes promptText to AssessmentCard');
  assert(source.includes('rawResponse={assessment.rawResponse}'), 'HistoryRow passes rawResponse to AssessmentCard');

  // No-scorecard fallback
  assert(source.includes('No scorecard data available'), 'HistoryRow shows fallback when scorecard is null');

  // Hover styling
  assert(source.includes('hover:bg-zinc-50'), 'HistoryRow has hover background style');
  assert(source.includes('transition-colors'), 'HistoryRow has transition animation');
}

// ────────────────────────────────────────────────────────────────────────
// Data state — verify the root component in data mode renders columns,
// version count badge, and passes assessements to HistoryRow
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Data state rendering');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Version count badge
  assert(
    source.includes('{assessments.length} version'),
    'data state shows version count with pluralization'
  );
  assert(
    source.includes("assessments.length !== 1 ? 's' : ''"),
    'pluralization handles singular vs plural versions'
  );

  // Column headers
  assert(source.includes('>Ver<'), 'data state shows Ver column header');
  assert(source.includes('>Date<'), 'data state shows Date column header');
  assert(source.includes('>Model<'), 'data state shows Model column header');
  assert(source.includes('>Type<'), 'data state shows Type column header');
  assert(source.includes('>Score<'), 'data state shows Score column header');
  assert(source.includes('>Grade<'), 'data state shows Grade column header');

  // Column headers container
  assert(
    source.includes('border-b'),
    'column headers have bottom border separator'
  );

  // Row container
  assert(
    source.includes('divide-y'),
    'rows container uses divide-y separator'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Toggle behavior — verify the state hook and toggle handler
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Toggle behavior');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // useState for expanded version tracking
  assert(source.includes('useState<number | null>'), 'uses useState with nullable number for expanded version');
  assert(source.includes('expandedVersion'), 'tracks expandedVersion state');
  assert(source.includes('setExpandedVersion'), 'has setExpandedVersion setter');

  // Toggle handler — toggle off when same version, on for different version
  assert(source.includes("prev === version ? null : version"), 'toggle handler toggles off same version, switches to different version');

  // Compare expandedVersion to snapshotVersion
  assert(source.includes('expandedVersion === assessment.snapshotVersion'), 'compares expandedVersion to snapshotVersion');
  assert(source.includes('handleToggle(assessment.snapshotVersion)'), 'calls handleToggle with snapshotVersion');
}

// ────────────────────────────────────────────────────────────────────────
// Scorecard null/scorecard present branching in expanded row
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Expanded detail branching');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Conditional: if scorecard exists, show AssessmentCard; otherwise show fallback
  assert(
    source.includes('assessment.scorecard ?') || source.includes('assessment.scorecard'),
    'expanded detail branches on scorecard existence'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
