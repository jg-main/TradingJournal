#!/usr/bin/env node
/**
 * S01 T01 — Audit: Account UI surface and workspace infrastructure.
 *
 * Automated verification of the account-related UI layer for the M006
 * accounting audit matrix. Verifies:
 *
 *   1. Account pages under src/app/(legacy)/ (list, detail shell, and the
 *      overview / ledger / positions / reconciliation / settings tabs).
 *   2. Workspace infrastructure: the [id]/layout.tsx shell, account detail
 *      header + tab navigation, and the /account redirect.
 *   3. The AccountProvider context (src/lib/account-context.tsx) and its
 *      mounting points in the (legacy) and (trades) route-group layouts.
 *   4. Account API routes under src/app/api/accounts/ with their expected
 *      HTTP handlers (GET/POST/PUT/DELETE).
 *   5. Import connectivity: page -> component -> API endpoint wiring.
 *   6. Test coverage: component tests and route tests, and their
 *      registration — vitest suites in the explicit vitest.config.ts
 *      include list, standalone self-running scripts in
 *      scripts/run-all-tests.ts TSX_TESTS.
 *
 * Pure filesystem verification — no database, no network, no server. Safe
 * to run repeatedly. Exits 0 when every check passes, 1 otherwise.
 *
 * Usage: node scripts/audit-s01-ui-surface.mjs
 * Output: per-check PASS/FAIL lines plus a machine-readable JSON summary
 *         between the AUDIT_JSON_BEGIN / AUDIT_JSON_END markers on stdout.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// ── Tiny assertion harness ────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
const failures = [];
const sections = [];

function check(section, label, ok, detail = '') {
  if (ok) {
    passCount += 1;
    console.log(`PASS  [${section}] ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failCount += 1;
    failures.push({ section, label, detail });
    console.log(`FAIL  [${section}] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Section-aware existence check (empty file counts as missing). */
function filePresent(section, label, rel) {
  let ok = false;
  let detail = '';
  try {
    const content = readFile(rel);
    ok = content.trim().length > 0;
    detail = ok ? `${content.split('\n').length} lines` : 'file is empty';
  } catch {
    detail = 'file missing';
  }
  check(section, label, ok, detail);
  return ok;
}

/** Check that `rel` contains all of the given expected substrings. */
function fileContains(section, label, rel, expected) {
  let content = '';
  try {
    content = readFile(rel);
  } catch {
    check(section, label, false, 'file missing');
    return false;
  }
  const missing = expected.filter((s) => !content.includes(s));
  check(
    section,
    label,
    missing.length === 0,
    missing.length === 0
      ? `all ${expected.length} marker(s) present`
      : `missing marker(s): ${missing.join(' | ')}`,
  );
  return missing.length === 0;
}

/**
 * Check a route handler file exports the expected HTTP verb functions.
 * `expect` maps verb -> expected count of exports (1 = single handler).
 */
function routeHandlers(section, label, rel, expect) {
  let content = '';
  try {
    content = readFile(rel);
  } catch {
    check(section, label, false, 'file missing');
    return false;
  }
  const missing = [];
  for (const [verb, count] of Object.entries(expect)) {
    const re = new RegExp(`export\\s+async\\s+function\\s+${verb}\\s*\\(`, 'g');
    const found = (content.match(re) ?? []).length;
    if (found < count) {
      missing.push(`${verb} (found ${found}, expected >= ${count})`);
    }
  }
  check(
    section,
    label,
    missing.length === 0,
    missing.length === 0
      ? `handlers ${Object.keys(expect).join('/')} present`
      : `missing handler(s): ${missing.join(' | ')}`,
  );
  return missing.length === 0;
}

// ── 1. Account pages ──────────────────────────────────────────────────
{
  const S = 'Pages';
  const base = 'src/app/(legacy)';
  sections.push(S);

  filePresent(S, 'Account list page', `${base}/settings/accounts/page.tsx`);
  filePresent(S, 'Account detail shell (layout)', `${base}/settings/accounts/[id]/layout.tsx`);
  filePresent(S, 'Overview tab page', `${base}/settings/accounts/[id]/page.tsx`);
  filePresent(S, 'Ledger tab page', `${base}/settings/accounts/[id]/ledger/page.tsx`);
  filePresent(S, 'Positions tab page', `${base}/settings/accounts/[id]/positions/page.tsx`);
  filePresent(S, 'Reconciliation page', `${base}/settings/accounts/[id]/reconciliation/page.tsx`);
  filePresent(S, 'Account settings tab page', `${base}/settings/accounts/[id]/settings/page.tsx`);
  filePresent(S, '/account legacy redirect page', `${base}/account/page.tsx`);

  // Account list: fetches accounts, settings (default account), creates.
  fileContains(S, 'List page fetches /api/accounts', `${base}/settings/accounts/page.tsx`, [
    "fetch('/api/accounts')",
  ]);
  fileContains(S, 'List page reads default account from /api/settings', `${base}/settings/accounts/page.tsx`, [
    "fetch('/api/settings')",
    'defaultAccountId',
  ]);
  fileContains(S, 'List page creates accounts via POST /api/accounts', `${base}/settings/accounts/page.tsx`, [
    "fetch('/api/accounts',",
    "method: 'POST'",
  ]);

  // Detail shell: identity fetch + header + nav.
  fileContains(S, 'Detail shell fetches account identity', `${base}/settings/accounts/[id]/layout.tsx`, [
    '`/api/accounts/${id}`',
  ]);
  fileContains(S, 'Detail shell renders header and nav', `${base}/settings/accounts/[id]/layout.tsx`, [
    'AccountDetailHeader',
    'AccountDetailNav',
  ]);

  fileContains(S, '/account redirects to /settings/accounts', `${base}/account/page.tsx`, [
    "redirect('/settings/accounts')",
  ]);
}

// ── 2. Workspace infrastructure ───────────────────────────────────────
{
  const S = 'Workspace';
  sections.push(S);

  // Tab navigation contract: Overview (base route), Ledger, Positions,
  // Settings. Reconciliation is a deep-linked page, not a primary tab.
  const nav = readFile('src/components/accounting/account-detail-nav.tsx');
  const tabs = {
    Overview: `/settings/accounts/${'${accountId}'}`,
    Ledger: `${'${base}'}/ledger`,
    Positions: `${'${base}'}/positions`,
    Settings: `${'${base}'}/settings`,
  };
  for (const [label, href] of Object.entries(tabs)) {
    check(S, `Nav tab "${label}" defined`, nav.includes(href), href);
  }
  check(
    S,
    'Reconciliation excluded from primary nav (deep-linked)',
    !nav.includes('/reconciliation'),
    'reconciliation reached by direct URL only',
  );

  const header = readFile('src/components/accounting/account-detail-header.tsx');
  check(
    S,
    'Account detail header renders name/broker/currency/status',
    ['name', 'broker', 'currency', 'isActive'].every((p) => header.includes(p)),
    'identity props present',
  );
}

// ── 3. AccountProvider context ────────────────────────────────────────
{
  const S = 'AccountProvider';
  sections.push(S);

  fileContains(S, 'Context module exports AccountProvider', 'src/lib/account-context.tsx', [
    'export function AccountProvider',
    'createContext',
  ]);
  fileContains(S, 'Context persists selection to localStorage', 'src/lib/account-context.tsx', [
    "localStorage",
    'app:account',
  ]);
  fileContains(S, 'Mounted in (legacy) root layout', 'src/app/(legacy)/layout.tsx', [
    'AccountProvider',
  ]);
  fileContains(S, 'Mounted in (trades) root layout', 'src/app/(trades)/layout.tsx', [
    'AccountProvider',
  ]);
  filePresent(S, 'Context unit test', 'src/lib/account-context.test.tsx');
}

// ── 4. Accounting UI components ───────────────────────────────────────
{
  const S = 'Components';
  sections.push(S);
  const components = [
    'account-detail-header.tsx',
    'account-detail-nav.tsx',
    'account-overview.tsx',
    'account-ledger.tsx',
    'account-positions.tsx',
    'account-reconciliation-summary.tsx',
    'account-settings.tsx',
    'account-activity.tsx',
    'account-correction-form.tsx',
    'account-performance.tsx',
  ];
  for (const c of components) {
    filePresent(S, c, `src/components/accounting/${c}`);
  }
}

// ── 5. Account API routes ─────────────────────────────────────────────
{
  const S = 'API routes';
  sections.push(S);
  const api = 'src/app/api/accounts';

  routeHandlers(S, 'GET/POST /api/accounts (list/create)', `${api}/route.ts`, {
    GET: 1,
    POST: 1,
  });
  routeHandlers(S, 'GET /api/accounts/summary', `${api}/summary/route.ts`, {
    GET: 1,
  });
  routeHandlers(S, 'GET/PUT/DELETE /api/accounts/[id]', `${api}/[id]/route.ts`, {
    GET: 1,
    PUT: 1,
    DELETE: 1,
  });
  routeHandlers(S, 'GET /api/accounts/[id]/overview', `${api}/[id]/overview/route.ts`, {
    GET: 1,
  });
  routeHandlers(S, 'GET /api/accounts/[id]/ledger', `${api}/[id]/ledger/route.ts`, {
    GET: 1,
  });
  routeHandlers(S, 'GET /api/accounts/[id]/positions', `${api}/[id]/positions/route.ts`, {
    GET: 1,
  });
  routeHandlers(S, 'GET /api/accounts/[id]/reconciliation', `${api}/[id]/reconciliation/route.ts`, {
    GET: 1,
  });
  routeHandlers(S, 'GET/POST /api/accounts/[id]/financial-events', `${api}/[id]/financial-events/route.ts`, {
    GET: 1,
    POST: 1,
  });
  routeHandlers(S, 'GET/POST /api/accounts/[id]/transactions', `${api}/[id]/transactions/route.ts`, {
    GET: 1,
    POST: 1,
  });
  routeHandlers(S, 'GET/POST /api/accounts/[id]/valuations', `${api}/[id]/valuations/route.ts`, {
    GET: 1,
    POST: 1,
  });
  routeHandlers(S, 'GET/POST /api/accounts/[id]/executions', `${api}/[id]/executions/route.ts`, {
    GET: 1,
    POST: 1,
  });
  routeHandlers(
    S,
    'POST /api/accounts/[id]/executions/[executionId]/correct (correction surface)',
    `${api}/[id]/executions/[executionId]/correct/route.ts`,
    { POST: 1 },
  );
  routeHandlers(S, 'GET/POST /api/accounts/[id]/checks (reconciliation checks)', `${api}/[id]/checks/route.ts`, {
    GET: 1,
    POST: 1,
  });
  routeHandlers(S, 'GET/PUT/DELETE /api/accounts/[id]/checks/[checkId]', `${api}/[id]/checks/[checkId]/route.ts`, {
    GET: 1,
    PUT: 1,
    DELETE: 1,
  });
  routeHandlers(S, 'POST /api/accounts/[id]/close (deactivation)', `${api}/[id]/close/route.ts`, {
    POST: 1,
  });
  routeHandlers(S, 'POST /api/accounts/[id]/migration (rebuild path)', `${api}/[id]/migration/route.ts`, {
    POST: 1,
  });
  routeHandlers(S, 'GET/POST /api/accounts/[id]/performance', `${api}/[id]/performance/route.ts`, {
    GET: 1,
    POST: 1,
  });
}

// ── 6. Page -> component -> API connectivity ──────────────────────────
{
  const S = 'Connectivity';
  sections.push(S);
  const base = 'src/app/(legacy)/settings/accounts/[id]';

  const wiring = [
    {
      label: 'Overview page -> account-overview -> GET /overview',
      page: `${base}/page.tsx`,
      componentImport: 'account-overview',
      component: 'src/components/accounting/account-overview.tsx',
      apiMarker: '`/api/accounts/${accountId}/overview`',
    },
    {
      label: 'Ledger page -> account-ledger -> GET /ledger',
      page: `${base}/ledger/page.tsx`,
      componentImport: 'account-ledger',
      component: 'src/components/accounting/account-ledger.tsx',
      apiMarker: '`/api/accounts/${accountId}/ledger',
    },
    {
      label: 'Positions page -> account-positions -> GET /positions',
      page: `${base}/positions/page.tsx`,
      componentImport: 'account-positions',
      component: 'src/components/accounting/account-positions.tsx',
      apiMarker: '`/api/accounts/${accountId}/positions`',
    },
    {
      label: 'Reconciliation page -> account-reconciliation-summary -> GET /reconciliation',
      page: `${base}/reconciliation/page.tsx`,
      componentImport: 'account-reconciliation-summary',
      component: 'src/components/accounting/account-reconciliation-summary.tsx',
      apiMarker: '`/api/accounts/${accountId}/reconciliation`',
    },
    {
      label: 'Settings page -> account-settings -> PUT/DELETE /api/accounts/[id] + /close',
      page: `${base}/settings/page.tsx`,
      componentImport: 'account-settings',
      component: 'src/components/accounting/account-settings.tsx',
      apiMarker: '`/api/accounts/${accountId}/close`',
    },
  ];

  for (const w of wiring) {
    const pageOk = fileContains(S, `${w.label} (page imports component)`, w.page, [
      w.componentImport,
    ]);
    const compOk = fileContains(S, `${w.label} (component fetches endpoint)`, w.component, [
      w.apiMarker,
    ]);
    if (pageOk && compOk) {
      check(S, `${w.label} (wiring)`, true, 'page -> component -> API connected');
    }
  }

  // Reconciliation component also drives the migration/rebuild surface.
  fileContains(
    S,
    'Reconciliation component POSTs /migration (rebuild path)',
    'src/components/accounting/account-reconciliation-summary.tsx',
    ['`/api/accounts/${accountId}/migration`'],
  );
}

// ── 7. Test coverage ──────────────────────────────────────────────────
{
  const S = 'Tests';
  sections.push(S);

  // Component tests.
  const componentTests = [
    'account-overview.test.tsx',
    'account-ledger.test.tsx',
    'account-positions.test.tsx',
    'account-reconciliation-summary.test.tsx',
    'account-settings.test.tsx',
    'account-correction-form.test.tsx',
  ];
  for (const t of componentTests) {
    filePresent(S, `Component test ${t}`, `src/components/accounting/${t}`);
  }

  // Route tests.
  const routeTests = [
    'src/app/api/accounts/__tests__/route.test.ts',
    'src/app/api/accounts/__tests__/checks.test.ts',
    'src/app/api/accounts/[id]/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/__tests__/route.defaults.test.ts',
    'src/app/api/accounts/[id]/__tests__/route.accounting-regression.test.ts',
    'src/app/api/accounts/[id]/overview/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/ledger/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/positions/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/reconciliation/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/financial-events/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/transactions/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/valuations/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/executions/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/executions/[executionId]/correct/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/migration/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/performance/__tests__/route.test.ts',
    'src/app/api/accounts/[id]/close/__tests__/route.test.ts',
  ];
  for (const t of routeTests) {
    filePresent(S, `Route test ${path.relative('src', t)}`, t);
  }

  // vitest.config.ts uses an explicit include array — every component test
  // must be registered there or it silently never runs. Route tests may live
  // in either runner: vitest suites are registered in vitest.config.ts, while
  // standalone self-running scripts (top-level assert + process.exit pattern)
  // are registered in scripts/run-all-tests.ts TSX_TESTS.
  let vitest = '';
  let runAll = '';
  try {
    vitest = readFile('vitest.config.ts');
  } catch {
    check(S, 'vitest.config.ts readable', false, 'file missing');
  }
  try {
    runAll = readFile('scripts/run-all-tests.ts');
  } catch {
    check(S, 'scripts/run-all-tests.ts readable', false, 'file missing');
  }
  if (vitest) {
    for (const t of componentTests) {
      check(
        S,
        `vitest include registers ${t}`,
        vitest.includes(`src/components/accounting/${t}`),
        '',
      );
    }
    check(S, 'vitest include registers account-context test', vitest.includes('src/lib/account-context.test.tsx'), '');
  }
  if (vitest && runAll) {
    let unregistered = 0;
    const unregisteredNames = [];
    for (const t of routeTests) {
      const inVitest = vitest.includes(t);
      const inTsx = runAll.includes(t);
      if (!inVitest && !inTsx) {
        unregistered += 1;
        unregisteredNames.push(path.relative('src', t));
      }
    }
    check(
      S,
      'every account route test registered in vitest include or run-all-tests TSX_TESTS',
      unregistered === 0,
      unregistered === 0
        ? `${routeTests.length}/${routeTests.length} registered across both runners`
        : `${unregistered} unregistered: ${unregisteredNames.join(', ')}`,
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────
const summary = {
  tool: 'audit-s01-ui-surface',
  task: 'T01',
  slice: 'S01',
  milestone: 'M006-t7xrwf',
  timestamp: new Date().toISOString(),
  checksRun: passCount + failCount,
  passed: passCount,
  failed: failCount,
  sections,
  failures,
  verdict: failCount === 0 ? 'PASS' : 'FAIL',
};

console.log('');
console.log(`SUMMARY: ${passCount} passed, ${failCount} failed, ${passCount + failCount} total`);
console.log('AUDIT_JSON_BEGIN');
console.log(JSON.stringify(summary, null, 2));
console.log('AUDIT_JSON_END');

process.exit(failCount === 0 ? 0 : 1);
