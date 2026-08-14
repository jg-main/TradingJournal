/**
 * correction-dialog.test.ts
 *
 * Source-contract tests for the M019/S04/T03 CorrectionDialog: the dialog
 * that corrects one execution from the Trade Details surface. Covers the
 * module contract, the planned/non-planned routing rule (must-haves #3, #4),
 * the "No accounting record" inline state for trades without an accountId
 * (must-have #5), the canonical correction body shape (accounting decimals +
 * idempotency key), the direct-PUT body shape for planned trades, validation,
 * reset-on-close, the page/phase-view/card wiring (must-have #6), and
 * registration in run-all-tests.ts.
 *
 * Run: npx tsx src/components/trade-detail/__tests__/correction-dialog.test.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compSourcePath = path.resolve(__dirname, '../correction-dialog.tsx');
const correctionRouteSourcePath = path.resolve(
  __dirname,
  '../../../app/api/trades/[id]/executions/[execId]/correct/route.ts',
);
const putRouteSourcePath = path.resolve(
  __dirname,
  '../../../app/api/trades/[id]/executions/[execId]/route.ts',
);
const runAllTestsPath = path.resolve(
  __dirname,
  '../../../../scripts/run-all-tests.ts',
);
// M019/S04/T03 wiring targets
const executionsCardPath = path.resolve(__dirname, '../trade-executions-card.tsx');
const activePhaseViewPath = path.resolve(__dirname, '../active-phase-view.tsx');
const closedPhaseViewPath = path.resolve(__dirname, '../closed-phase-view.tsx');
const tradeDetailPagePath = path.resolve(
  __dirname,
  '../../../app/(legacy)/trades/[id]/page.tsx',
);

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

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED) — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// CorrectionDialog module contract
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## CorrectionDialog module contract');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('export function CorrectionDialog'), 'exports CorrectionDialog as a named export');
  assert(source.includes('interface CorrectionDialogProps'), 'defines CorrectionDialogProps interface');
  assert(source.includes('export interface CorrectionTradeData'), 'exports the CorrectionTradeData interface');
  assert(source.includes('accountId: string | null'), 'trade.accountId is nullable (no-account trades)');
  assert(source.includes('status: TradeStatus'), 'accepts trade.status for planned/non-planned routing');
  assert(source.includes('execution: Execution | null'), 'accepts the execution being corrected');
  assert(source.includes('open: boolean'), 'accepts open: boolean (controlled dialog)');
  assert(source.includes('onOpenChange: (open: boolean) => void'), 'accepts onOpenChange: (open: boolean) => void');
  assert(source.includes('onComplete: () => void'), 'accepts onComplete: () => void');
  assert(source.includes("'use client'") || source.includes('"use client"'), 'has use client directive');
  assert(
    source.includes("import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';"),
    'renders inside a Dialog (header/content/footer/close pattern)',
  );
  assert(
    !source.includes("from '@/app/api") && !source.includes("from '../app/api"),
    'does not import from an API route module (client component stays server-only free)'
  );
}

// ────────────────────────────────────────────────────────────────────────
// Planned / non-planned routing (must-haves #3, #4)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Planned / non-planned routing rule');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  // The trade-level handler is exported for the source contract and the
  // page wires onComplete through it.
  assert(source.includes('export async function submitExecutionCorrection'), 'exports the trade-level submitExecutionCorrection handler');
  assert(source.includes("export function resolveCorrectionRoute"), 'exports resolveCorrectionRoute (pure routing rule)');
  assert(
    source.includes("return isPlannedTrade(trade.status) ? 'planned-put' : 'accounting-correct';"),
    'routes planned trades to the direct PUT path and non-planned trades to the correction endpoint',
  );
  assert(source.includes("export function isPlannedTrade"), 'exports isPlannedTrade helper');
  assert(
    source.includes("return status === 'planned';"),
    'planned is the only status that keeps the direct edit path',
  );

  // Non-planned route → the accounting-true correction endpoint.
  assert(
    source.includes('`/api/trades/${trade.id}/executions/${executionId}/correct`'),
    'non-planned corrections POST to /api/trades/[id]/executions/[execId]/correct',
  );
  assert(
    source.includes("method: route === 'planned-put' ? 'PUT' : 'POST'"),
    'planned uses PUT; non-planned uses POST',
  );

  // Planned route → the existing direct PUT endpoint.
  assert(
    source.includes('`/api/trades/${trade.id}/executions/${executionId}`'),
    'planned corrections PUT to the existing /api/trades/[id]/executions/[execId] path',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Accounting correction body (canonical decimals + idempotency)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Accounting correction body');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('export function buildCorrectionBody'), 'exports buildCorrectionBody');
  assert(source.includes('export function toCanonicalDecimal'), 'exports toCanonicalDecimal');
  assert(
    source.includes('return value.toFixed(2);'),
    'toCanonicalDecimal renders 2-decimal canonical strings (e.g. 150 → "150.00")',
  );
  assert(
    source.includes('quantity: toCanonicalDecimal(values.quantity)') &&
      source.includes('price: toCanonicalDecimal(values.price)') &&
      source.includes('fees: toCanonicalDecimal(values.fees)'),
    'correction body carries canonical decimal quantity/price/fees (correctionInputSchema)',
  );
  assert(
    source.includes('symbol: trade.symbol') && source.includes('action: values.action'),
    'correction body carries the replacement symbol and action',
  );
  assert(
    source.includes('idempotencyKey: crypto.randomUUID()'),
    'each correction generates a fresh idempotency key (retry-safe)',
  );
  assert(
    source.includes("if (values.executedAt.trim()) body.postedAt = new Date(values.executedAt).toISOString();"),
    'postedAt is sent as ISO only when the user supplied an executedAt',
  );
  assert(
    source.includes("if (values.reason.trim()) body.reason = values.reason;"),
    'correction reason is sent only when supplied (schema: optional)',
  );

  // Planned path body mirrors the legacy update schema (numbers).
  assert(source.includes('export function buildDirectUpdateBody'), 'exports buildDirectUpdateBody');
  assert(
    source.includes('action: values.action') &&
      source.includes('quantity: values.quantity') &&
      source.includes('price: values.price') &&
      source.includes('fees: values.fees'),
    'direct-PUT body carries numeric action/quantity/price/fees (legacy update schema)',
  );
  assert(
    source.includes("if (values.notes.trim()) body.notes = values.notes;"),
    'direct-PUT body sends notes only when supplied',
  );
}

// ────────────────────────────────────────────────────────────────────────
// "No accounting record" inline state (must-have #5)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## No accounting record inline state');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(
    source.includes('const noAccountingRecord = !trade.accountId && !isPlannedTrade(trade.status);'),
    'no-account state applies to non-planned trades without an accountId',
  );
  assert(
    source.includes('No accounting record') && source.includes('<DialogDescription>No accounting record</DialogDescription>'),
    'renders the "No accounting record" description inline',
  );
  assert(
    source.includes('This trade has no accounting account, so its executions have no'),
    'explains the missing accounting record inline instead of opening the form',
  );
  assert(
    source.includes('if (noAccountingRecord) {'),
    'returns the inline state before rendering the correction form',
  );
  // Planned trades without an accountId still edit directly (no accountId
  // needed on the direct PUT path).
  assert(
    source.includes('noAccountingRecord = !trade.accountId && !isPlannedTrade(trade.status)'),
    'planned trades are excluded from the no-account inline state',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Submit behavior + validation
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Submit behavior and validation');

  const source = fs.readFileSync(compSourcePath, 'utf-8');

  assert(source.includes('onComplete();'), 'calls onComplete() after a successful correction');
  assert(source.includes('onOpenChange(false);'), 'closes the dialog after a successful correction');
  assert(
    source.includes("setServerError('Failed to correct execution. Please check your connection.')"),
    'network failure surfaces an inline server error',
  );
  assert(source.includes("errors.action = 'Action must be selected.'"), 'action validation: must be selected');
  assert(source.includes("errors.quantity = 'Quantity must be greater than 0.'"), 'quantity validation: must be > 0');
  assert(source.includes("errors.price = 'Price must be greater than 0.'"), 'price validation: must be > 0');
  assert(source.includes("errors.fees = 'Fees must be 0 or greater.'"), 'fees validation: must be >= 0');
  assert(source.includes('aria-invalid'), 'invalid fields surface aria-invalid for assistive tech');

  // Pre-fill from the execution being corrected (via the initialForm helper
  // used by the during-render state adjustment — no setState-in-effect).
  assert(
    source.includes('action: exec.action') &&
      source.includes('String(exec.quantity)') &&
      source.includes('String(exec.price)') &&
      source.includes('toDatetimeLocal(exec.executedAt, timezone)'),
    'form pre-fills from the execution being corrected',
  );
  assert(
    source.includes('if (execution && execution.id !== prevExecutionId) {') &&
      source.includes('setPrevExecutionId(execution.id)') &&
      source.includes('setForm(initialForm(execution))'),
    'a new execution selection adjusts the form during render (no setState-in-effect)',
  );

  // Reset on close.
  assert(
    source.includes('const handleOpenChange = (open: boolean) =>') &&
      source.includes('if (!open) {') &&
      source.includes("setFieldErrors({});") &&
      source.includes('setServerError(null);'),
    'closing the dialog resets form, field errors, and server error',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Functional checks on the exported pure helpers
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Functional: routing rule, decimal conversion, body builders');

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../correction-dialog') as typeof import('../correction-dialog');
  const {
    toCanonicalDecimal,
    isPlannedTrade,
    resolveCorrectionRoute,
    buildDirectUpdateBody,
    buildCorrectionBody,
  } = mod;

  // 1. Canonical decimal conversion
  assertEqual(toCanonicalDecimal(150), '150.00', '150 → "150.00"');
  assertEqual(toCanonicalDecimal(152.5), '152.50', '152.5 → "152.50"');
  assertEqual(toCanonicalDecimal(0), '0.00', '0 → "0.00"');
  assertEqual(toCanonicalDecimal(1.999), '2.00', '1.999 → "2.00" (2-decimal canonical)');

  // 2. Planned-status classification
  assertEqual(isPlannedTrade('planned'), true, 'planned is a planned trade');
  assertEqual(isPlannedTrade('open'), false, 'open is not planned');
  assertEqual(isPlannedTrade('closed'), false, 'closed is not planned');

  // 3. Routing rule
  const plannedTrade = { id: 't1', symbol: 'AAPL', direction: 'long' as const, accountId: 'a1', status: 'planned' as const };
  const openTrade = { id: 't2', symbol: 'AAPL', direction: 'long' as const, accountId: 'a1', status: 'open' as const };
  const closedTrade = { id: 't3', symbol: 'MSFT', direction: 'short' as const, accountId: 'a2', status: 'closed' as const };
  assertEqual(resolveCorrectionRoute(plannedTrade), 'planned-put', 'planned trade routes to the direct PUT path (must-have #4)');
  assertEqual(resolveCorrectionRoute(openTrade), 'accounting-correct', 'open trade routes to the accounting correction endpoint (must-have #3)');
  assertEqual(resolveCorrectionRoute(closedTrade), 'accounting-correct', 'closed trade routes to the accounting correction endpoint (must-have #3)');

  // 4. Direct-PUT body (planned) — legacy numeric schema
  const values = {
    action: 'buy',
    quantity: 150,
    price: 152,
    fees: 1,
    executedAt: '2025-06-01T10:00',
    notes: 'adjusted',
    reason: 'fix qty',
  };
  const putBody = buildDirectUpdateBody(values);
  assertEqual(putBody.action, 'buy', 'PUT body action');
  assertEqual(putBody.quantity, 150, 'PUT body quantity stays numeric (legacy schema)');
  assertEqual(putBody.price, 152, 'PUT body price stays numeric');
  assertEqual(putBody.fees, 1, 'PUT body fees stays numeric');
  assertEqual(putBody.executedAt, '2025-06-01T10:00', 'PUT body executedAt passes through');
  assertEqual(putBody.notes, 'adjusted', 'PUT body notes passes through');
  assertEqual(putBody.reason, undefined, 'PUT body drops the correction reason (not in legacy schema)');
  const emptyNotesBody = buildDirectUpdateBody({ ...values, notes: '', executedAt: '' });
  assertEqual(emptyNotesBody.notes, undefined, 'PUT body omits empty notes');
  assertEqual(emptyNotesBody.executedAt, undefined, 'PUT body omits empty executedAt');

  // 5. Correction body (non-planned) — canonical schema
  const correctBody = buildCorrectionBody(openTrade, values);
  assertEqual(correctBody.symbol, 'AAPL', 'correction body symbol comes from the trade');
  assertEqual(correctBody.action, 'buy', 'correction body action');
  assertEqual(correctBody.quantity, '150.00', 'correction body quantity is canonical decimal');
  assertEqual(correctBody.price, '152.00', 'correction body price is canonical decimal');
  assertEqual(correctBody.fees, '1.00', 'correction body fees is canonical decimal');
  assertEqual(correctBody.reason, 'fix qty', 'correction body carries the reason');
  assert(
    typeof correctBody.idempotencyKey === 'string' && (correctBody.idempotencyKey as string).length > 10,
    'correction body carries a fresh idempotency key string',
  );
  assert(
    typeof correctBody.postedAt === 'string' && (correctBody.postedAt as string).endsWith('Z'),
    'correction body postedAt is an ISO timestamp (Z suffix)',
  );

  // A no-account trade still resolves a route for the handler; the dialog
  // renders the inline state before the form (covered above).
  const noAccountTrade = { id: 't4', symbol: 'TSLA', direction: 'long' as const, accountId: null, status: 'open' as const };
  assertEqual(resolveCorrectionRoute(noAccountTrade), 'accounting-correct', 'no-account open trade still routes to correction (server 422s)');
}

// ────────────────────────────────────────────────────────────────────────
// T03 wiring: TradeExecutionsCard pencil → page-owned dialog → refetch
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## T03 wiring (executions card pencil → page-owned dialog)');

  const cardSource = fs.readFileSync(executionsCardPath, 'utf-8');
  const activeSource = fs.readFileSync(activePhaseViewPath, 'utf-8');
  const closedSource = fs.readFileSync(closedPhaseViewPath, 'utf-8');
  const pageSource = fs.readFileSync(tradeDetailPagePath, 'utf-8');

  // 1. TradeExecutionsCard opens the page-owned dialog via onCorrectExecution.
  assert(
    cardSource.includes('onCorrectExecution?: (exec: Execution) => void;'),
    'TradeExecutionsCard accepts the optional onCorrectExecution prop',
  );
  assert(
    cardSource.includes('onCorrectExecution(exec)') &&
      cardSource.includes('handleEdit(exec)'),
    'the pencil routes through onCorrectExecution when supplied (inline dialog fallback otherwise)',
  );

  // 2. Both phase views accept the callback and thread it to the card.
  assert(
    activeSource.includes('onCorrectExecution?: (exec: Execution) => void;'),
    'ActivePhaseView accepts the optional onCorrectExecution prop',
  );
  assert(
    activeSource.includes('onCorrectExecution={onCorrectExecution}'),
    'ActivePhaseView forwards onCorrectExecution to TradeExecutionsCard',
  );
  assert(
    closedSource.includes('onCorrectExecution?: (exec: Execution) => void;'),
    'ClosedPhaseView accepts the optional onCorrectExecution prop',
  );
  assert(
    closedSource.includes('onCorrectExecution={onCorrectExecution}'),
    'ClosedPhaseView forwards onCorrectExecution to TradeExecutionsCard',
  );

  // 3. The page owns the open state + selected execution, renders the
  //    dialog, and routes onComplete into handleExecutionAdded (must-have #6).
  assert(
    pageSource.includes("import { CorrectionDialog } from '@/components/trade-detail/correction-dialog';"),
    'page.tsx imports CorrectionDialog from the trade-detail component',
  );
  assert(
    pageSource.includes('const [correctionOpen, setCorrectionOpen] = useState(false);'),
    'page.tsx owns the dialog open state (correctionOpen)',
  );
  assert(
    pageSource.includes('const [correctingExecution, setCorrectingExecution] = useState<Execution | null>(null);'),
    'page.tsx owns the execution being corrected',
  );
  assert(
    pageSource.includes('const openCorrectExecution = useCallback((exec: Execution) => {'),
    'page.tsx exposes an openCorrectExecution callback that selects the execution',
  );
  assert(
    pageSource.includes('onCorrectExecution={openCorrectExecution}'),
    'page.tsx threads onCorrectExecution into the phase views',
  );
  assert(
    pageSource.includes('<CorrectionDialog') &&
      pageSource.includes('execution={correctingExecution}') &&
      pageSource.includes('open={correctionOpen}') &&
      pageSource.includes('onOpenChange={handleCorrectionOpenChange}'),
    'page.tsx renders the controlled CorrectionDialog with the owned state',
  );
  assert(
    pageSource.includes('accountId: trade.accountId') &&
      pageSource.includes('status: trade.status'),
    'page.tsx passes accountId and status so the dialog can route planned/non-planned',
  );
  assert(
    pageSource.includes('onComplete={handleExecutionAdded}'),
    'page.tsx routes onComplete into handleExecutionAdded (executions + level-history refetch)',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Route contracts referenced by the dialog (cross-surface parity)
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Route parity (dialog targets exist with matching contracts)');

  const correctionRouteSource = fs.readFileSync(correctionRouteSourcePath, 'utf-8');
  const putRouteSource = fs.readFileSync(putRouteSourcePath, 'utf-8');

  assert(
    correctionRouteSource.includes('export async function POST'),
    'correction route exports POST /api/trades/[id]/executions/[execId]/correct',
  );
  assert(
    correctionRouteSource.includes('correctExecution') &&
      correctionRouteSource.includes('correctionInputSchema'),
    'correction route forwards to correctExecution with zod validation',
  );
  assert(
    correctionRouteSource.includes('tradeExecutionIdempotencyKey(execId)') &&
      correctionRouteSource.includes("from '@/lib/positions/trade-execution-sync'"),
    'correction route resolves the accounting execution via the shared trade-execution-<execId> idempotency key builder',
  );
  assert(
    correctionRouteSource.includes("status: 200") && correctionRouteSource.includes('reversalExecution') && correctionRouteSource.includes('replacementExecution'),
    'correction route returns the canonical lineage payload (reversal + replacement)',
  );
  assert(
    putRouteSource.includes("trade.status !== 'planned'") &&
      putRouteSource.includes('422'),
    'direct PUT path stays guarded to planned trades (422 otherwise) — the reason non-planned edits must correct',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Orchestration: registered in run-all-tests.ts
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## Orchestration registration');

  const runAllSource = fs.readFileSync(runAllTestsPath, 'utf-8');

  assert(
    runAllSource.includes("'src/components/trade-detail/__tests__/correction-dialog.test.ts'"),
    'run-all-tests.ts registers the correction-dialog source-contract test',
  );
  assert(
    runAllSource.includes("'src/app/api/trades/[id]/executions/[execId]/correct/__tests__/route.test.ts'"),
    'run-all-tests.ts registers the correction route contract test',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n## Results: ${passed}/${total} passed, ${failed}/${total} failed\n`);
process.exit(failed > 0 ? 1 : 0);
