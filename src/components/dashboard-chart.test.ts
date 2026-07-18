/**
 * dashboard-chart.test.ts
 *
 * Tests for the DashboardChart wrapper component.
 * Verifies module contract, props interface, and type safety.
 *
 * Run: npx tsx src/components/dashboard-chart.test.ts
 */

import { DashboardChart } from './dashboard-chart';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chartSourcePath = path.resolve(__dirname, 'dashboard-chart.tsx');

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
// Module contract
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Module contract');

  assert(typeof DashboardChart === 'function', 'DashboardChart is exported as a function');
  assert(DashboardChart.name === 'DashboardChart', 'exports named DashboardChart');
}

// ────────────────────────────────────────────────────────────────────────
// Props interface validation — source-level checks
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Props interface (source-level)');

  const source = fs.readFileSync(chartSourcePath, 'utf-8');

  assert(source.includes('height = 300'), 'default height is 300px');
  assert(source.includes("width = '100%'"), 'default width is 100%');
  assert(source.includes('className'), 'accepts className prop');
  assert(source.includes('theme'), 'accepts theme prop');
  assert(source.includes('showLoading'), 'accepts showLoading prop');
  assert(source.includes('onChartReady'), 'accepts onChartReady prop');
  assert(source.includes('onEvents'), 'accepts onEvents prop');
  assert(source.includes('flexHeight'), 'accepts flexHeight prop');
  assert(source.includes('flexHeight = false'), 'flexHeight defaults to false');
  assert(source.includes('autoResize'), 'autoResize enabled in echarts-for-react');
  assert(source.includes("renderer: 'canvas'"), 'canvas renderer configured');
  assert(source.includes("'use client'"), 'has use client directive');
  assert(source.includes('DashboardChartProps'), 'exports typed DashboardChartProps interface');
  assert(source.includes('Omit<EChartsReactProps'), 'extends from EChartsReactProps');
  assert(source.includes('min-h-0 flex-1 h-full w-full'), 'flexHeight mode applies flex container classes');
}

// ────────────────────────────────────────────────────────────────────────
// flexHeight mode checks
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## flexHeight mode');

  const source = fs.readFileSync(chartSourcePath, 'utf-8');

  assert(source.includes('useChartResize'), 'imports useChartResize hook');
  assert(source.includes("@/hooks/use-chart-resize'"), 'useChartResize imported from correct path');
  assert(source.includes('useRef'), 'imports useRef from react');
  assert(source.includes('useCallback'), 'imports useCallback from react');
  assert(source.includes("from 'echarts'"), 'imports ECharts type from echarts');
  assert(source.includes('echartsInstanceRef'), 'stores echarts instance in a ref');
  assert(source.includes('handleChartReady'), 'wraps onChartReady to capture instance');
  assert(
    source.includes('if (flexHeight)'),
    'conditionally renders flex container when flexHeight is true'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Requires 'use client' — important for Next.js App Router
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Client component directive');

  const source = fs.readFileSync(chartSourcePath, 'utf-8');
  assert(
    source.includes("'use client'") || source.includes('"use client"'),
    'source file contains use client directive'
  );
  // Must be on the first line (or very early) per convention
  const firstLine = source.trimStart().split('\n')[0];
  assert(
    firstLine.includes("'use client'") || firstLine.includes('"use client"'),
    'use client directive is on the first line'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Only imports from allowed modules (no server-only or DB)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Import safety');

  const source = fs.readFileSync(chartSourcePath, 'utf-8');
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
    source.includes("echarts-for-react"),
    'imports from echarts-for-react'
  );
  assert(
    source.includes("@/lib/utils"),
    'imports cn utility from @/lib/utils'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
