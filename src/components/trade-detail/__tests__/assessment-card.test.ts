/**
 * assessment-card.test.ts
 *
 * Tests for the AssessmentCard component.
 * Verifies module contract, source-level helper function logic,
 * props interface, and state rendering paths.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/assessment-card.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compSourcePath = path.resolve(__dirname, '../assessment-card.tsx');

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

  assert(source.includes('export default function AssessmentCard'), 'exports AssessmentCard as default');
  assert(source.includes('export interface AssessmentCardProps'), 'exports AssessmentCardProps interface');
  assert(source.includes("import type { Scorecard }") || source.includes("import { type Scorecard }"), 'references Scorecard type from @/lib/scorecard');
  assert(source.includes("'use client'") || source.includes('"use client"'), 'has use client directive');
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
// Props interface — verify all declared props
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Props interface (source-level)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('scorecard: Scorecard | null'), 'accepts scorecard prop (Scorecard | null)');
  assert(source.includes('warnings?: string[]'), 'accepts optional warnings prop');
  assert(source.includes('loading?: boolean'), 'accepts optional loading prop');
  assert(source.includes('error?: string | null'), 'accepts optional error prop');
  assert(source.includes('onRequestAssessment?: () => void'), 'accepts optional onRequestAssessment callback');
  assert(source.includes('requestLoading?: boolean'), 'accepts optional requestLoading prop');
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
}

// ────────────────────────────────────────────────────────────────────────
// Helper function: gradeColorClass — verify all letter-to-color mappings
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
// Helper function: dimensionColorClass — verify all score-to-color mappings
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Helper: dimensionColorClass');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function dimensionColorClass'), 'dimensionColorClass function is defined');
  assert(source.includes('score >= 8') && source.includes('emerald'), 'score >= 8 maps to emerald');
  assert(source.includes('score >= 6') && source.includes('blue'), 'score >= 6 maps to blue');
  assert(source.includes('score >= 4') && source.includes('amber'), 'score >= 4 maps to amber');
  assert(source.includes('return') && source.includes('red'), 'score < 4 maps to red');
  assert(source.includes('score: number'), 'dimensionColorClass accepts a number parameter');
}

// ────────────────────────────────────────────────────────────────────────
// Helper function: formatDuration — verify duration formatting
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Helper: formatDuration');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function formatDuration'), 'formatDuration function is defined');
  assert(source.includes('ms: number'), 'formatDuration accepts a number parameter');
  assert(source.includes('ms < 1000'), 'formatDuration uses threshold at 1000ms');
  assert(source.includes("${Math.round(ms)}ms"), 'formatDuration returns ms suffix for sub-second values');
  assert(source.includes("${(ms / 1000).toFixed(1)}s"), 'formatDuration returns s suffix for second values');
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components — verify all 4 rendering branches are defined
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Sub-components (state rendering)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function LoadingState'), 'LoadingState sub-component is defined');
  assert(source.includes('function ErrorState'), 'ErrorState sub-component is defined');
  assert(source.includes('function EmptyState'), 'EmptyState sub-component is defined');
  assert(source.includes('function ScorecardDisplay'), 'ScorecardDisplay sub-component is defined');
  assert(source.includes('function DimensionRow'), 'DimensionRow sub-component is defined');
  assert(source.includes('function WarningsList'), 'WarningsList sub-component is defined');
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
    source.includes('if (loading)') && source.includes('<LoadingState />'),
    'loading=true renders LoadingState'
  );

  // Error state (checked after loading)
  assert(
    source.includes('if (error)') && source.includes('<ErrorState'),
    'error string renders ErrorState'
  );

  // Empty state — no scorecard
  assert(
    source.includes("if (!scorecard)") && source.includes('<EmptyState'),
    'null scorecard renders EmptyState'
  );

  // Scorecard display — has data
  assert(
    source.includes('<ScorecardDisplay'),
    'valid scorecard renders ScorecardDisplay'
  );
}

// ────────────────────────────────────────────────────────────────────────
// ScorecardDisplay — verify scorecard content rendering
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## ScorecardDisplay content');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Overall score rendering
  assert(
    source.includes('scorecard.overallScore') && source.includes('/100'),
    'displays overall score with /100 suffix'
  );

  // Grade badge rendering
  assert(
    source.includes('scorecard.gradeLabel') && source.includes('<Badge'),
    'displays grade label inside Badge component'
  );

  // Score label text
  assert(
    source.includes('scorecard.overallScore') && source.includes('scoreLabel'),
    'calls scoreLabel with overallScore for text label'
  );

  // Dimension scores
  assert(
    source.includes('scorecard.dimensions.map'),
    'renders dimension list via map'
  );
  assert(
    source.includes('dim.label') && source.includes('dim.score'),
    'renders each dimension label and score'
  );

  // Summary/Rationale
  assert(
    source.includes('scorecard.summary'),
    'conditionally renders summary section'
  );

  // Metadata
  assert(
    source.includes('scorecard.metadata?.modelUsed'),
    'renders modelUsed metadata'
  );
  assert(
    source.includes('scorecard.assessmentType'),
    'renders assessment type metadata'
  );
  assert(
    source.includes('scorecard.metadata?.promptTokens'),
    'renders promptTokens metadata'
  );
  assert(
    source.includes('scorecard.metadata?.completionTokens'),
    'renders completionTokens metadata'
  );
  assert(
    source.includes('scorecard.metadata?.durationMs'),
    'renders durationMs metadata'
  );

  // Reassess button
  assert(
    source.includes("Reassess") && source.includes('onRequest'),
    'ScorecardDisplay includes a Reassess button when onRequest is provided'
  );
}

// ────────────────────────────────────────────────────────────────────────
// EmptyState — verify empty state content
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## EmptyState content');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('No AI assessment yet'),
    'EmptyState shows empty state text'
  );
  assert(
    source.includes('Request an AI-powered quality assessment'),
    'EmptyState shows descriptive text'
  );
  assert(
    source.includes('Request Assessment'),
    'EmptyState includes Request Assessment button label'
  );
  assert(
    source.includes('requestLoading') && source.includes('disabled'),
    'Request Assessment button disables when requestLoading is true'
  );
}

// ────────────────────────────────────────────────────────────────────────
// ErrorState — verify error rendering
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## ErrorState content');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('<span>{error}</span>'),
    'ErrorState renders the error message text'
  );
  assert(
    source.includes('AlertCircle') && source.includes('lucide-react'),
    'ErrorState uses AlertCircle icon'
  );
}

// ────────────────────────────────────────────────────────────────────────
// LoadingState — verify loading indicator
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## LoadingState content');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('Loading assessment...'),
    'LoadingState shows loading text'
  );
  assert(
    source.includes('Loader2') && source.includes('animate-spin'),
    'LoadingState uses Loader2 with animate-spin class'
  );
}

// ────────────────────────────────────────────────────────────────────────
// WarningsList — verify warnings rendering
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## WarningsList content');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('function WarningsList'),
    'WarningsList function is defined'
  );
  assert(
    source.includes('warnings.length === 0') && source.includes('return null'),
    'WarningsList returns null for empty warnings array'
  );
  assert(
    source.includes('warnings.map'),
    'WarningsList maps over warnings'
  );
  assert(
    source.includes('AlertCircle'),
    'WarningsList uses AlertCircle icon per warning'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
