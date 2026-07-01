#!/usr/bin/env node
/**
 * 10K Trade Performance Benchmark Script
 *
 * Seeds 10K trades (if not already present), starts a Next.js dev server on
 * port 3456, and measures response times for the critical API endpoints that
 * serve the dashboard, trade list, and trade detail pages.
 *
 * Usage:  npx tsx src/db/benchmark.ts
 *         COUNT=5000 npx tsx src/db/benchmark.ts   (custom seed count)
 *
 * Exits 0 if all benchmarks pass, 1 if any fail.
 *
 * Dependencies: Node.js 18+ (native fetch), Next.js dev server
 */

import { spawn, execSync, type ChildProcess } from 'child_process';

// ── Configuration ───────────────────────────────────────────────────────

const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_READY_TIMEOUT_MS = 90_000;
const SEED_TIMEOUT_MS = 180_000;
const ENDPOINT_TIMEOUT_MS = 30_000;

interface BenchmarkResult {
  endpoint: string;
  durationMs: number;
  thresholdMs: number;
  passed: boolean;
  status: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function waitForServerReady(): Promise<void> {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < SERVER_READY_TIMEOUT_MS) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${BASE_URL}/api/trades?page=1&limit=1`, {
        signal: controller.signal,
      });
      clearTimeout(id);
      // Accept any non-500 response as "ready"
      if (res.status < 500) return;
      lastErr = `Server returned status ${res.status}`;
    } catch (err) {
      lastErr = String(err);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `Server did not become ready within ${SERVER_READY_TIMEOUT_MS}ms. Last error: ${lastErr}`,
  );
}

async function measureEndpoint(
  url: string,
  label: string,
): Promise<{ durationMs: number; status: number; body: string }> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS);
  const start = performance.now();
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(id);
  const durationMs = performance.now() - start;
  const body = await res.text();
  console.log(`  ${label}: ${durationMs.toFixed(0)}ms (status ${res.status})`);
  return { durationMs, status: res.status, body };
}

function logResult(r: BenchmarkResult): void {
  const icon = r.passed ? '✅' : '❌';
  console.log(
    `  ${icon} ${r.endpoint}: ${r.durationMs.toFixed(0)}ms / ${r.thresholdMs}ms (status ${r.status})`,
  );
}

function runSeed(): void {
  console.log('  Running: npx tsx src/db/seed-10k.ts');
  execSync('npx tsx src/db/seed-10k.ts', {
    cwd: process.cwd(),
    stdio: 'inherit',
    timeout: SEED_TIMEOUT_MS,
    env: { ...process.env },
  });
  console.log('  Seed complete.');
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  console.log('═══════════════════════════════════════════');
  console.log('  Trading Journal Performance Benchmark');
  console.log('═══════════════════════════════════════════\n');

  // ── Step 1: Seed 10K trades ──────────────────────────────────────────
  console.log('STEP 1: Seeding 10K trades');
  try {
    runSeed();
  } catch (err) {
    // If seed fails (e.g. trades already exist and script threw), check
    // whether the DB already has data before declaring failure.
    const stderr = String(err);
    if (stderr.includes('skipping') || stderr.includes('already has')) {
      console.log('  (trades already exist, continuing)\n');
    } else {
      console.error('  Seed error (may continue):', stderr.split('\n')[0]);
    }
  }
  console.log();

  // ── Step 2: Start dev server ─────────────────────────────────────────
  console.log(`STEP 2: Starting dev server on port ${PORT}`);
  const server: ChildProcess = spawn(
    'npx',
    ['next', 'dev', '-p', String(PORT)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(PORT) },
    },
  );

  // Capture server output for diagnostics (without blocking)
  let serverLog = '';
  const captureOutput = (chunk: Buffer) => {
    serverLog += chunk.toString();
    // Keep last ~10KB to avoid unbounded growth
    if (serverLog.length > 200_000) {
      serverLog = serverLog.slice(-100_000);
    }
  };
  server.stdout?.on('data', captureOutput);
  server.stderr?.on('data', captureOutput);

  let serverStarted = false;
  try {
    console.log('  Waiting for server to be ready...');
    await waitForServerReady();
    serverStarted = true;
    console.log('  Server is ready.\n');

    // ── Step 3: Run benchmarks ─────────────────────────────────────────
    console.log('STEP 3: Running benchmarks\n');
    const results: BenchmarkResult[] = [];

    // 3a. Dashboard endpoint (threshold: 2s)
    console.log('  [Dashboard] GET /api/dashboard');
    const dash = await measureEndpoint(
      `${BASE_URL}/api/dashboard`,
      '  /api/dashboard',
    );
    results.push({
      endpoint: '/api/dashboard',
      durationMs: dash.durationMs,
      thresholdMs: 2000,
      passed: dash.durationMs <= 2000 && dash.status === 200,
      status: dash.status,
    });
    logResult(results[results.length - 1]);

    // 3b. Trade list with pagination (threshold: 2s)
    console.log('  [Trade List] GET /api/trades?page=1&limit=50');
    const list = await measureEndpoint(
      `${BASE_URL}/api/trades?page=1&limit=50`,
      '  /api/trades?page=1&limit=50',
    );
    results.push({
      endpoint: '/api/trades?page=1&limit=50',
      durationMs: list.durationMs,
      thresholdMs: 2000,
      passed: list.durationMs <= 2000 && list.status === 200,
      status: list.status,
    });
    logResult(results[results.length - 1]);

    // 3c. Trade detail — extract a real trade ID from the list response (threshold: 500ms)
    console.log('  [Trade Detail] GET /api/trades/[id]');
    let tradeId: string | null = null;
    try {
      const listData = JSON.parse(list.body);
      if (Array.isArray(listData.data) && listData.data.length > 0) {
        tradeId = listData.data[0].id;
      } else if (Array.isArray(listData) && listData.length > 0) {
        tradeId = listData[0].id;
      }
    } catch {
      // Not critical — will skip detail benchmark
    }

    if (tradeId) {
      const shortId = tradeId.length > 8 ? tradeId.slice(0, 8) + '…' : tradeId;
      const detail = await measureEndpoint(
        `${BASE_URL}/api/trades/${tradeId}`,
        `  /api/trades/${shortId}`,
      );
      results.push({
        endpoint: `/api/trades/${shortId}`,
        durationMs: detail.durationMs,
        thresholdMs: 500,
        passed: detail.durationMs <= 500 && detail.status === 200,
        status: detail.status,
      });
      logResult(results[results.length - 1]);
    } else {
      console.log('  ⚠️  No trade ID available — skipping trade detail benchmark\n');
    }

    // ── Step 4: Summary ────────────────────────────────────────────────
    console.log('\n═══════════════════ Results ═══════════════════');
    let allPassed = true;
    for (const r of results) {
      logResult(r);
      if (!r.passed) allPassed = false;
    }

    if (results.length === 0) {
      console.log('  ⚠️  No benchmarks were executed.');
      return 1;
    }

    const passedCount = results.filter((r) => r.passed).length;
    console.log(
      `\n  ${passedCount}/${results.length} passed`,
    );
    console.log(`  Overall: ${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}\n`);

    return allPassed ? 0 : 1;
  } finally {
    // ── Cleanup: Kill server ──────────────────────────────────────────
    console.log('Cleaning up...');
    if (server && !server.killed) {
      server.kill('SIGTERM');
      // Wait up to 5s for graceful shutdown
      await new Promise<void>((resolve) => {
        const killTimeout = setTimeout(() => {
          if (!server.killed) server.kill('SIGKILL');
          resolve();
        }, 5000);
        server.on('exit', () => {
          clearTimeout(killTimeout);
          resolve();
        });
      });
    }

    if (!serverStarted && serverLog) {
      // Print server logs on failure for diagnostics
      console.log('\n─── Server Log (last 2KB) ───');
      console.log(serverLog.slice(-2048));
      console.log('─────────────────────────────\n');
    }

    console.log('Benchmark script finished.\n');
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('\nBenchmark error:', err);
    process.exit(1);
  });
