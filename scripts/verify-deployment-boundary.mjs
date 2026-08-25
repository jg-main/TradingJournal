#!/usr/bin/env node
/**
 * verify-deployment-boundary.mjs
 *
 * Static verification of the TradingJournal deployment boundary.
 *
 * TradingJournal is a local-first trading journal that must remain private
 * LAN/VPN-only. This script statically checks the repository artifacts that
 * define the boundary:
 *
 *   1. The Dockerfile runs as a non-root user (USER nextjs)
 *   2. The Dockerfile uses `npm ci` for deterministic dependency resolution
 *   3. The Dockerfile declares a HEALTHCHECK against /api/health
 *   4. The Dockerfile mounts the database via DB_FILE_NAME=/data/journal.db
 *   5. The Dockerfile only EXPOSEs the container-internal port 3000
 *      (EXPOSE is documentation-only; it never publishes to a host interface)
 *   6. The health endpoint exists at src/app/api/health/route.ts
 *   7. The health endpoint returns JSON with a `status` field
 *   8. No source file hardcodes a 0.0.0.0 binding (the app binds to the
 *      HOSTNAME env var; the only 0.0.0.0 reference lives in the Dockerfile
 *      as the container-internal HOSTNAME)
 *   9. The backup/restore API routes exist and use the canonical pipeline —
 *      they never reference the retired account_transactions path
 *  10. If a docker-compose file exists, no service publishes ports to the
 *      host (no `ports:` mapping at all) — absence of a compose file passes
 *
 * Exit 0 when every check passes; exit 1 on any failure.
 *
 * Usage: node scripts/verify-deployment-boundary.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
let failures = 0;

function check(id, label, ok, detail = '') {
  results.push({ id, label, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] [${id}] ${label}${detail ? ` — ${detail}` : ''}`);
}

function readMaybe(relPath) {
  const abs = join(root, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

/** Recursively collect file paths under relDir whose extension is in exts. */
function walkFiles(relDir, exts) {
  const absDir = join(root, relDir);
  const out = [];
  if (!existsSync(absDir)) return out;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (exts.includes(extname(entry).toLowerCase())) {
        out.push(full);
      }
    }
  };
  walk(absDir);
  return out;
}

// ── Read artifacts ─────────────────────────────────────────────────────────
const dockerfile = readMaybe('Dockerfile');
const healthRoute = readMaybe('src/app/api/health/route.ts');
const backupNowRoute = readMaybe('src/app/api/backup/now/route.ts');
const backupListRoute = readMaybe('src/app/api/backup/route.ts');
const restoreRoute = readMaybe('src/app/api/restore/route.ts');

// ── Check 1: non-root runtime user ─────────────────────────────────────────
const hasUserNextjs = dockerfile !== null && /^\s*USER\s+nextjs\s*$/m.test(dockerfile);
check(
  'docker-nonroot',
  'Dockerfile runs as non-root user (USER nextjs)',
  hasUserNextjs,
  dockerfile === null ? 'Dockerfile missing' : '',
);

// ── Check 2: deterministic dependency install ──────────────────────────────
const hasNpmCi = dockerfile !== null && /npm\s+ci\b/.test(dockerfile);
check(
  'docker-npm-ci',
  'Dockerfile uses npm ci for deterministic deps',
  hasNpmCi,
  dockerfile === null ? 'Dockerfile missing' : '',
);

// ── Check 3: HEALTHCHECK directive ─────────────────────────────────────────
const hasHealthcheck = dockerfile !== null && /^\s*HEALTHCHECK\b/m.test(dockerfile);
const healthcheckTargetsHealth =
  hasHealthcheck && /HEALTHCHECK[\s\S]*\/api\/health/.test(dockerfile);
check(
  'docker-healthcheck',
  'Dockerfile declares HEALTHCHECK against /api/health',
  hasHealthcheck && healthcheckTargetsHealth,
  dockerfile === null ? 'Dockerfile missing' : '',
);

// ── Check 4: volume-mounted database ───────────────────────────────────────
const hasDbFileMount = dockerfile !== null && /DB_FILE_NAME\s*=\s*\/data\/journal\.db/.test(dockerfile);
check(
  'docker-db-mount',
  'Dockerfile sets DB_FILE_NAME=/data/journal.db (volume-mounted DB)',
  hasDbFileMount,
  dockerfile === null ? 'Dockerfile missing' : '',
);

// ── Check 5: EXPOSE is container-internal only ─────────────────────────────
// EXPOSE is documentation-only in Docker: it never publishes a port to the
// host. The boundary rule is that the image only documents the single
// container-internal port 3000 and nothing else.
const exposeLines = dockerfile === null
  ? []
  : dockerfile.split('\n').filter((l) => /^\s*EXPOSE\b/.test(l));
const exposeOk =
  exposeLines.length > 0 && exposeLines.every((l) => /^\s*EXPOSE\s+3000\s*(#.*)?$/.test(l));
check(
  'docker-expose-internal',
  'Dockerfile EXPOSE only documents container-internal port 3000',
  exposeOk,
  exposeLines.length === 0
    ? 'no EXPOSE directive found'
    : `found: ${exposeLines.join(' | ')}`,
);

// ── Check 6: health endpoint exists ────────────────────────────────────────
check(
  'health-route-exists',
  'Health endpoint exists at src/app/api/health/route.ts',
  healthRoute !== null,
  healthRoute === null ? 'route file missing' : '',
);

// ── Check 7: health endpoint returns JSON with status field ────────────────
const healthHasStatus =
  healthRoute !== null && /\bstatus\s*:/.test(healthRoute) && /NextResponse\.json/.test(healthRoute);
check(
  'health-json-status',
  'Health endpoint returns JSON with a `status` field',
  healthHasStatus,
  healthRoute === null ? 'route file missing' : '',
);

// ── Check 8: no 0.0.0.0 binding in source code ─────────────────────────────
// The app binds to the HOSTNAME env var (set to 0.0.0.0 inside the container
// by the Dockerfile — that is the container-internal loopback to the host
// network, not a public interface). Source code must never hardcode 0.0.0.0.
const srcFiles = walkFiles('src', ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const zeroBindings = srcFiles
  .map((abs) => ({ rel: abs.slice(root.length + 1), src: readFileSync(abs, 'utf8') }))
  .filter(({ src }) => /0\.0\.0\.0/.test(src))
  .map(({ rel }) => rel);

for (const extra of ['next.config.ts', 'next.config.mjs', 'next.config.js', 'middleware.ts', 'package.json']) {
  const content = readMaybe(extra);
  if (content !== null && /0\.0\.0\.0/.test(content)) {
    zeroBindings.push(extra);
  }
}
check(
  'no-public-bind',
  'No 0.0.0.0 binding in source code (app binds to HOSTNAME env var)',
  zeroBindings.length === 0,
  zeroBindings.length === 0 ? '' : `hardcoded in: ${zeroBindings.join(', ')}`,
);

// ── Check 9: backup/restore routes use canonical pipeline ──────────────────
const canonicalRoutes = [
  ['src/app/api/backup/now/route.ts', backupNowRoute],
  ['src/app/api/backup/route.ts', backupListRoute],
  ['src/app/api/restore/route.ts', restoreRoute],
];
const missingRoutes = canonicalRoutes.filter(([, content]) => content === null).map(([rel]) => rel);
const retiredPathRefs = canonicalRoutes
  .filter(([, content]) => content !== null && /account_transactions/.test(content))
  .map(([rel]) => rel);
check(
  'backup-restore-canonical',
  'Backup/restore routes exist and use canonical pipeline (no retired account_transactions path)',
  missingRoutes.length === 0 && retiredPathRefs.length === 0,
  [
    missingRoutes.length ? `missing: ${missingRoutes.join(', ')}` : '',
    retiredPathRefs.length ? `retired path referenced in: ${retiredPathRefs.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; '),
);

// ── Check 10: compose file (if present) publishes no host ports ────────────
const composeCandidates = readdirSync(root).filter(
  (f) => /^docker-compose(\.ya?ml|\.override\.ya?ml)?$|^compose(\.ya?ml)?$/.test(f) && !f.startsWith('.'),
);
let composeOk = true;
let composeDetail = 'no compose file present — nothing publishes host ports';
if (composeCandidates.length > 0) {
  const portMappings = [];
  for (const file of composeCandidates) {
    const content = readFileSync(join(root, file), 'utf8');
    if (/^\s*ports\s*:/m.test(content)) {
      portMappings.push(file);
    }
  }
  composeOk = portMappings.length === 0;
  composeDetail =
    portMappings.length === 0
      ? `${composeCandidates.join(', ')} present with no host ports mapping`
      : `host ports mapping found in: ${portMappings.join(', ')}`;
}
check(
  'compose-no-public-ports',
  'Compose service (if any) publishes no host ports',
  composeOk,
  composeDetail,
);

// ── Summary ────────────────────────────────────────────────────────────────
console.log('');
console.log(`deployment-boundary: ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${results.length} total)`);
process.exit(failures === 0 ? 0 : 1);
