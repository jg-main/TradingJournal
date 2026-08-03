#!/usr/bin/env node
/**
 * M014 S06 T02 — Multi-viewport visual evidence capture for the Trades page.
 *
 * Captures full-page screenshots of http://localhost:3000/trades at the M014
 * acceptance viewports (1440x900, 1920x1080) in both the light and dark theme
 * (the app theme is a `.dark` class on documentElement — no JS theme provider),
 * writing them to `docs/uat/m014-s06/` as the visual acceptance record.
 *
 * Prerequisites:
 *   - A dev server must already be running (e.g. `npm run dev`). The script
 *     polls the base URL for up to 30s and fails with a clear message if the
 *     server never becomes reachable — it does not boot its own server.
 *   - Playwright browsers installed (`npx playwright install chromium`).
 *
 * Usage:
 *   node scripts/capture-trades-uat.mjs
 *   TRADES_BASE_URL=http://localhost:3001 node scripts/capture-trades-uat.mjs
 *
 * Output (created if missing):
 *   docs/uat/m014-s06/trades-1440x900-light.png
 *   docs/uat/m014-s06/trades-1440x900-dark.png
 *   docs/uat/m014-s06/trades-1920x1080-light.png
 *   docs/uat/m014-s06/trades-1920x1080-dark.png
 *
 * Notes:
 *   - Each capture navigates fresh, waits for network idle (with a graceful
 *     fallback settle delay in case market-data polling keeps the network
 *     busy), waits for web fonts, then settles past the 150ms color transition
 *     before the screenshot so tokens are not captured mid-interpolation.
 *   - The Next.js dev-overlay badge is hidden via injected CSS so it never
 *     appears in evidence screenshots (mirrors e2e/helpers.ts).
 *   - The screenshots capture whatever data the running dev server's database
 *     currently holds; row counts are logged per capture so the evidence is
 *     self-describing. Seed via the T01 UAT spec for full trade-state coverage.
 */

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const BASE_URL = (process.env.TRADES_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TARGET_URL = `${BASE_URL}/trades`;
const OUT_DIR = path.join(PROJECT_ROOT, 'docs', 'uat', 'm014-s06');

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

const THEMES = [
  {
    name: 'light',
    apply: (page) =>
      page.evaluate(() => document.documentElement.classList.remove('dark')),
  },
  {
    name: 'dark',
    apply: (page) =>
      page.evaluate(() => document.documentElement.classList.add('dark')),
  },
];

// Colors transition over 150ms (Tailwind `transition-colors`); wait past it so
// sampled/computed tokens are settled before the screenshot.
const SETTLE_MS = 500;
const SERVER_READY_TIMEOUT_MS = 30_000;
const NETWORK_IDLE_TIMEOUT_MS = 15_000;

/**
 * Poll the base URL until the dev server answers (or timeout). Gives a clear
 * failure message instead of a bare connection-refused crash.
 */
async function waitForServer(url) {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status >= 400) return; // any HTTP answer means the server is up
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Dev server not reachable at ${url} within ${SERVER_READY_TIMEOUT_MS / 1000}s ` +
      `(${lastError ? lastError.cause?.code || lastError.message : 'no response'}). ` +
      'Start it with `npm run dev` (or point TRADES_BASE_URL at a running instance) and retry.',
  );
}

/** Hide the Next.js dev-overlay badge so it never appears in evidence. */
async function hideDevOverlay(page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

/**
 * Wait for the page to finish its initial data fetch. Prefer network idle;
 * fall back to a fixed settle delay if polling keeps the network busy.
 */
async function settlePage(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });
  } catch {
    console.warn(
      `  [warn] networkidle not reached within ${NETWORK_IDLE_TIMEOUT_MS / 1000}s ` +
        '(likely continuous market-data activity) — continuing after settle delay',
    );
  }
  await page.waitForSelector('h1:has-text("Trades")', { timeout: 10_000 });
  await page.evaluate(() => document.fonts.ready);
}

/** Snapshot one viewport x theme combo, returning the saved file path. */
async function captureOne(page, { width, height }, theme, index, total) {
  await page.setViewportSize({ width, height });
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30_000 });
  await hideDevOverlay(page);
  await settlePage(page);

  await theme.apply(page);
  await page.waitForTimeout(SETTLE_MS); // let the color transition settle

  // Self-describing evidence: record what data was on screen at capture time.
  const context = await page.evaluate(() => {
    const rowCount = document.querySelectorAll('tbody tr').length;
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) =>
      t.textContent.trim(),
    );
    return { rowCount, tabs };
  });

  const filePath = path.join(OUT_DIR, `trades-${width}x${height}-${theme.name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return { filePath, context };
}

async function main() {
  await waitForServer(BASE_URL);
  console.log(`Capture target: ${TARGET_URL}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Output directory: ${OUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  const captured = [];
  try {
    const page = await browser.newPage();
    try {
      const combos = VIEWPORTS.flatMap((viewport) =>
        THEMES.map((theme) => ({ viewport, theme })),
      );
      for (const [i, { viewport, theme }] of combos.entries()) {
        console.log(
          `[${i + 1}/${combos.length}] Capturing ${viewport.width}x${viewport.height} / ${theme.name}…`,
        );
        const { filePath, context } = await captureOne(
          page,
          viewport,
          theme,
          i,
          combos.length,
        );
        const relative = path.relative(PROJECT_ROOT, filePath);
        console.log(`  Saved ${relative}`);
        console.log(
          `  Rendered: ${context.rowCount} row(s), tabs: ${context.tabs.join(', ') || '(none)'}`,
        );
        captured.push(relative);
      }
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log('\nCaptured evidence (M014 S06 Trades page identity):');
  for (const rel of captured) console.log(`  ${rel}`);
  console.log(`\n${captured.length} screenshot(s) written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exitCode = 1;
});
