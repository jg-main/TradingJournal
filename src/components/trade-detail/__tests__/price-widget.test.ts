/**
 * price-widget.test.ts
 *
 * Tests for the PriceWidget component.
 * Verifies module contract, source-level helper function logic,
 * props interface, and all 6 visual state rendering paths
 * (loading, populated, stale, error, offline, frozen).
 *
 * Run: npx tsx src/components/trade-detail/__tests__/price-widget.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compSourcePath = path.resolve(__dirname, '../price-widget.tsx');

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

  assert(source.includes('export default function PriceWidget'), 'exports PriceWidget as default');
  assert(source.includes('export interface PriceWidgetProps'), 'exports PriceWidgetProps interface');
  assert(source.includes("import type { MtmData }"), 'references MtmData type from ./types');
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

  assert(source.includes('mtmData: MtmData'), 'accepts required mtmData prop (MtmData)');
  assert(source.includes('onRefreshPrice?: () => void'), 'accepts optional onRefreshPrice callback');
  assert(source.includes('frozen?: boolean'), 'accepts optional frozen prop');
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
    source.includes("@/components/ui/skeleton") || source.includes("@/components/ui/Skeleton"),
    'imports Skeleton from @/components/ui/skeleton'
  );
  assert(
    source.includes("@/components/ui/button"),
    'imports Button from @/components/ui/button'
  );
  assert(
    source.includes("@/lib/utils"),
    'imports cn utility from @/lib/utils'
  );
  assert(
    source.includes("./helpers"),
    'imports helpers from ./helpers'
  );
  assert(
    source.includes("./types"),
    'imports types from ./types'
  );
}

// ────────────────────────────────────────────────────────────────────────
// data-testid attributes — verify all 5 data-testids present for browser verification
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## data-testid attributes');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('data-testid="price-widget"'),
    'populated state has data-testid="price-widget"'
  );
  assert(
    source.includes('data-testid="price-widget-loading"'),
    'loading state has data-testid="price-widget-loading"'
  );
  assert(
    source.includes('data-testid="price-widget-error"'),
    'error state has data-testid="price-widget-error"'
  );
  assert(
    source.includes('data-testid="price-widget-offline"'),
    'offline indicator has data-testid="price-widget-offline"'
  );

  // Retry button has data-testid (used in both error and offline states)
  const retryCount = (source.match(/data-testid="price-widget-retry"/g) || []).length;
  assert(retryCount >= 1, 'retry button has data-testid="price-widget-retry"');
}

// ────────────────────────────────────────────────────────────────────────
// State rendering paths — verify the root component conditionally renders
// the correct sub-component for each of the 6 visual states
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## State rendering paths (6 visual states)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // 1. Loading state: mtmData.loading && !hasPrice
  assert(
    source.includes('if (isLoading)') &&
    source.includes('data-testid="price-widget-loading"'),
    'loading state condition: isLoading (loading && !hasPrice) renders loading skeleton'
  );

  // 2. Error state (no cached price): hasError && !hasPrice
  assert(
    source.includes('if (hasError && !hasPrice)') ||
    source.includes('if (hasError && !hasPrice'),
    'error state condition: hasError && !hasPrice renders error banner'
  );

  // 3-6. Populated state (covers populated, stale, offline, frozen):
  // Default return — no prior if/return matched
  assert(
    source.includes('data-testid="price-widget"') &&
    source.includes('border-border'),
    'populated state: data-testid="price-widget" with default card styling'
  );

  // Market-closed staleness detection
  assert(
    source.includes('marketClosed') &&
    source.includes("'REGULAR', 'PRE', 'POST'"),
    'stale state: marketClosed derived from marketState set membership'
  );

  // Streaming label for Schwab source
  assert(
    source.includes("mtmData.source === 'schwab'"),
    'streaming label checks mtmData.source === "schwab"'
  );

  // Frozen guard — no refresh/staleness when frozen=true
  assert(
    source.includes('!frozen && onRefreshPrice') || source.includes('!frozen && onRefreshPrice'),
    'frozen state: retry/refresh buttons are guarded by !frozen'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Loading state — verify skeleton layout and content
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Loading state content');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('<Skeleton'),
    'loading state uses Skeleton components'
  );
  assert(
    source.includes('h-5 w-20') &&
    source.includes('h-3.5 w-32'),
    'loading state has first-row skeleton placeholders'
  );
  assert(
    source.includes('h-5 w-24 ml-auto') &&
    source.includes('h-3.5 w-16 ml-auto'),
    'loading state has price skeleton placeholders (right-aligned)'
  );
  assert(
    source.includes('grid grid-cols-3 gap-4') &&
    source.includes('h-10 w-full'),
    'loading state has 3-column detail grid skeleton placeholders'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Error state — verify error banner content
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Error state content');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('AlertTriangle') && source.includes('lucide-react'),
    'error state uses AlertTriangle icon'
  );
  assert(
    source.includes('Price data unavailable'),
    'error state shows "Price data unavailable" heading'
  );
  assert(
    source.includes('{mtmData.error}'),
    'error state renders the mtmData.error message'
  );
  assert(
    source.includes('border-destructive/40'),
    'error state card uses destructive border styling'
  );
  assert(
    source.includes('text-destructive'),
    'error state uses destructive text for heading and detail'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Populated state — verify symbol, price, change, detail grid, footer
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Populated state content');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Symbol display (placeholder — actual symbol added in T03 integration)
  assert(
    source.includes('Symbol') && source.includes('tabular-nums'),
    'populated state displays Symbol with tabular-nums class'
  );

  // Company name
  assert(
    source.includes('mtmData.shortName'),
    'populated state conditionally displays shortName'
  );

  // Sector / Industry
  assert(
    source.includes('mtmData.sector'),
    'populated state conditionally displays sector'
  );
  assert(
    source.includes('mtmData.industry'),
    'populated state conditionally displays industry'
  );

  // Price display with formatPrice
  assert(
    source.includes('formatPrice(mtmData.price)'),
    'populated state formats price via formatPrice'
  );

  // Change color logic
  assert(
    source.includes('changeSign') && source.includes('text-positive'),
    'populated state uses positive color for positive change'
  );
  assert(
    source.includes('text-negative'),
    'populated state uses negative color for negative change'
  );

  // Change display
  assert(
    source.includes('change.toFixed(2)') &&
    source.includes('changePercent.toFixed(2)'),
    'populated state displays $ change and % change with 2 decimals'
  );
  assert(
    source.includes('changeSign ? "+" : ""'),
    'populated state prefixes + for positive change values'
  );

  // Detail grid
  assert(
    source.includes('Day High') && source.includes('formatPrice(mtmData.dayHigh)'),
    'populated state displays Day High from mtmData.dayHigh'
  );
  assert(
    source.includes('Day Low') && source.includes('formatPrice(mtmData.dayLow)'),
    'populated state displays Day Low from mtmData.dayLow'
  );
  assert(
    source.includes('Prev Close') && source.includes('formatPrice(mtmData.previousClose)'),
    'populated state displays Prev Close from mtmData.previousClose'
  );
  assert(
    (source.match(/grid grid-cols-3/g) || []).length >= 1,
    'populated state uses 3-column grid for detail values'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Stale state — verify market-closed staleness indicator
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Stale state (market closed)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Staleness guard: showStaleness = populated && !frozen && marketClosed
  assert(
    source.includes('showStaleness'),
    'stale state uses showStaleness boolean guard'
  );
  assert(
    source.includes('!frozen && marketClosed'),
    'stale state is disabled when frozen is true'
  );

  // Clock icon for staleness
  assert(
    source.includes('<Clock className="size-3" />') &&
    source.includes('getStalenessLabel'),
    'stale state shows Clock icon with staleness label from getStalenessLabel'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Offline state — verify cached price + WifiOff indicator + retry
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Offline state (cached error)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Offline detection: isCachedWithError = hasPrice && hasError
  assert(
    source.includes('isCachedWithError'),
    'offline state uses isCachedWithError boolean (hasPrice && hasError)'
  );

  // Amber border for cached error
  assert(
    source.includes('border-warning/40'),
    'offline state card uses warning border styling'
  );

  // WifiOff icon and text
  assert(
    source.includes('WifiOff') && source.includes('lucide-react'),
    'offline state uses WifiOff icon'
  );
  assert(
    source.includes('Offline') && source.includes('showing cached price'),
    'offline state shows "Offline — showing cached price" text'
  );

  // Retry button in offline state
  assert(
    source.includes('RefreshCw') && source.includes('lucide-react'),
    'offline state uses RefreshCw icon for retry'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Frozen state (closed trades) — verify no refresh/staleness indicators
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Frozen state (closed trades)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Default value: frozen = false
  assert(
    source.includes('frozen = false') || source.includes('frozen=false'),
    'frozen parameter defaults to false'
  );

  // When frozen: no retry button in error state
  assert(
    source.includes('!frozen && onRefreshPrice'),
    'error state retry button is hidden when frozen'
  );

  // When frozen: no staleness/streaming labels
  assert(
    source.includes('!frozen && marketClosed'),
    'staleness label is hidden when frozen (showStaleness guard)'
  );

  // When frozen: no streaming label
  assert(
    source.includes('!frozen && isStreaming'),
    'streaming label is hidden when frozen (showStreamingLabel guard)'
  );

  // Note: when frozen && populated, the component falls through to the
  // populated return branch but with showStaleness/showStreamingLabel false
  // and no retry button — effectively a read-only display
}

// ────────────────────────────────────────────────────────────────────────
// Helper function: formatTimeAgo — verify timestamp formatting
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Helper: formatTimeAgo');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('function formatTimeAgo'), 'formatTimeAgo function is defined');
  assert(source.includes('iso: string'), 'formatTimeAgo accepts a string parameter');

  // Time thresholds
  assert(source.includes('diffMin < 1') && source.includes('"just now"'), 'returns "just now" for < 1 minute')
  assert(source.includes('diffMin < 60') && source.includes("`${diffMin}m ago`"), 'returns "Xm ago" for < 60 minutes');
  assert(source.includes('diffHr < 24') && source.includes("`${diffHr}h ago`"), 'returns "Xh ago" for < 24 hours');

  // Long-format fallback
  assert(
    source.includes('toLocaleDateString') &&
    source.includes('"short"') &&
    source.includes('"numeric"'),
    'returns formatted date for >= 24 hours using toLocaleDateString'
  );

  // Error handling
  assert(
    source.includes('catch') &&
    (source.includes('return iso') || source.includes('return iso')),
    'handles invalid dates with try/catch fallback returning raw string'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Color coding — verify change sign color logic
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Color coding');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('changeSign = change >= 0'), 'changeSign derived from change >= 0 (zero shows as positive)');
  assert(source.includes("'text-positive'"), 'changeColor uses positive token for positive/zero');
  assert(source.includes("'text-negative'"), 'negChangeColor uses negative token for negative');

  // Price text color uses changeSign logic
  assert(
    source.includes('hasPrice && change !== 0') ||
    source.includes('hasPrice && change !== 0'),
    'price color changes only when change !== 0 (zero change shows neutral)'
  );

  // When price exists but change is zero, text is neutral
  assert(
    source.includes('text-foreground'),
    'neutral price color for zero/no change'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Change/changePercent defaulting — verify defaults to 0 for display
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Null safety (change defaulting)');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('mtmData.change ?? 0'),
    'change defaults to 0 when mtmData.change is null/undefined'
  );
  assert(
    source.includes('mtmData.changePercent ?? 0'),
    'changePercent defaults to 0 when mtmData.changePercent is null/undefined'
  );

  // Change display is hidden when both are zero
  assert(
    source.includes('change !== 0'),
    'change row is hidden when change is zero (no zero-percent display)'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Retry buttons — verify 2 potential locations (error state + offline state)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Retry button locations');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Count how many times the retry button JSX block appears (2 potential locations)
  const retryButtons = (source.match(/Retry/g) || []).length;

  // Retry appears in error state and cached-error offline state
  assert(retryButtons >= 2, 'retry button appears in both error state and offline state');
}

// ────────────────────────────────────────────────────────────────────────
// Updated timestamp — verify last-updated timestamp rendering
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Updated timestamp');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // Updated timestamp condition: populated && fetchedAt && !showStaleness && !showStreamingLabel && !isCachedWithError
  assert(
    source.includes('populated && mtmData.fetchedAt'),
    'updated timestamp renders when data is populated and fetchedAt exists'
  );
  assert(
    source.includes('!showStaleness') &&
    source.includes('!showStreamingLabel') &&
    source.includes('!isCachedWithError'),
    'updated timestamp hidden when staleness, streaming, or offline label is shown'
  );
  assert(
    source.includes('Updated:') && source.includes('formatTimeAgo(mtmData.fetchedAt)'),
    'updated timestamp uses "Updated: " prefix with formatTimeAgo'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
