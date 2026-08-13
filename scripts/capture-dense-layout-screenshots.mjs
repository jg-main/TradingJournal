#!/usr/bin/env node
/**
 * Capture the dense-layout workstation screenshots at the three approved
 * viewports into a git-tracked evidence directory (docs/uat/m017-s05/).
 * Originally M017 S05 T02; re-captured under M018 S02 T04 for the new
 * default composition (no Review Metrics in the curated default).
 *
 *   - 2560×1440           (desktop, populated default scenario)
 *   - 1536×960            (effective laptop, populated default scenario)
 *   - 1440×900            (structural fallback)
 *
 * Per-viewport structural assertions confirm the M018 dense layout contract:
 *   - full-width Main Risk Metrics band (grid row "risk risk risk"),
 *   - the compact Account State | Performance summary row (grid row
 *     "account perf perf"; Performance spans two of the three columns),
 *   - the full-width Trades workspace band (grid row "trades trades trades"),
 *   - no Watchlist and no Review Metrics panels in the curated default
 *     (Process Review has its dedicated saved view),
 *   - no arrangement chrome (no drag/resize handles, no customize bar, no
 *     arrange grid) in normal mode.
 *
 * Runs its own Next dev server on --webpack (the stable dev path used by the
 * Playwright config) with a disposable database, then drives chromium.
 *
 * Usage: node scripts/capture-dense-layout-screenshots.mjs
 * Output: docs/uat/m017-s05/*.png
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

/**
 * Pick the first free port starting at `start` (default 31500 + pid % 1000,
 * as before). Ports in this range can be occupied by unrelated long-lived
 * dev servers, so probe with a real bind instead of trusting the pid hash.
 */
async function findFreePort(start = 31_500 + (process.pid % 1_000)) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const port = start + attempt;
    const probe = createServer();
    const free = await new Promise((resolve) => {
      probe.once('error', () => resolve(false));
      probe.once('listening', () => probe.close(() => resolve(true)));
      probe.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error(`No free port found near ${start}`);
}

const PORT = await findFreePort();
const ARTIFACT_ROOT = `/tmp/trading-journal-shots-m017-${process.pid}`;
process.env.DB_FILE_NAME ??= `${ARTIFACT_ROOT}/journal.db`;
process.env.PLAYWRIGHT_PORT = String(PORT);

const OUT_DIR = new URL('../docs/uat/m017-s05/', import.meta.url).pathname;

/** Wait until the server responds on /dev/workstation. */
async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      // A 200 + HTML shell identifies this app's dev server; a foreign server
      // squatting on a nearby port (401/404) must not pass the gate.
      if (res.status === 200 && (await res.text()).includes('<html')) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Server did not become ready at ${url}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const server = spawn(
    'npm',
    ['run', 'dev', '--', '--webpack', '-p', String(PORT)],
    { stdio: 'ignore', detached: true },
  );
  const base = `http://localhost:${PORT}`;
  try {
    await waitForServer(`${base}/dev/workstation`);
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Warm up: capture console errors on the first load for the record.
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const targets = [
      { name: 'dense-2560x1440.png', width: 2560, height: 1440, fullPage: true },
      { name: 'dense-1536x960.png', width: 1536, height: 960, fullPage: true },
      { name: 'dense-1440x900-fallback.png', width: 1440, height: 900, fullPage: true },
    ];

    for (const t of targets) {
      await page.setViewportSize({ width: t.width, height: t.height });
      await page.goto(`${base}/dev/workstation`); // default populated scenario
      await page.getByTestId('ws-grid').waitFor({ state: 'visible', timeout: 30_000 });
      // Allow the fixture client effect + layout to settle.
      await page.waitForTimeout(600);

      // ── Dense layout structural assertions ──
      // 1. Serialized grid template rows for the curated Risk & Positions
      //    default: full-width risk, the compact Account State | Performance
      //    summary row (Performance spans two of the three columns), then
      //    full-width trades. The browser serializes grid-template-areas
      //    either as longhands or collapsed into the grid-template shorthand
      //    — the quoted area rows appear in both forms.
      const style = (await page.getByTestId('ws-grid').getAttribute('style')) ?? '';
      const riskRow = style.includes('"risk risk risk"');
      const summaryRow = style.includes('"account perf perf"');
      const tradesRow = style.includes('"trades trades trades"');
      if (!riskRow || !summaryRow || !tradesRow) {
        throw new Error(
          `${t.name}: dense grid rows missing (risk=${riskRow}, summary=${summaryRow}, trades=${tradesRow}); style="${style.slice(0, 200)}"`,
        );
      }

      // 2. Full-width risk band + full-width trades workspace: the panel
      //    bounding boxes span the viewport width.
      const riskBox = await page.getByTestId('ws-panel-risk').boundingBox();
      const tradesBox = await page.getByTestId('ws-panel-positions').boundingBox();
      // Full-width = the band spans the grid content area. The ws grid has a
      // ~6px outer inset, so allow a small tolerance rather than requiring
      // the panel to touch the literal viewport edge.
      const FULL_WIDTH_TOLERANCE = 12;
      const riskFullWidth =
        riskBox !== null &&
        Math.abs(riskBox.x) <= FULL_WIDTH_TOLERANCE &&
        Math.abs(riskBox.x + riskBox.width - t.width) <= FULL_WIDTH_TOLERANCE;
      const tradesFullWidth =
        tradesBox !== null &&
        Math.abs(tradesBox.x) <= FULL_WIDTH_TOLERANCE &&
        Math.abs(tradesBox.x + tradesBox.width - t.width) <= FULL_WIDTH_TOLERANCE;
      if (!riskFullWidth || !tradesFullWidth) {
        throw new Error(
          `${t.name}: full-width bands failed (risk=${riskFullWidth}, trades=${tradesFullWidth}; risk=${JSON.stringify(riskBox)}, trades=${JSON.stringify(tradesBox)})`,
        );
      }

      // 3. Compact summary row: Account State (one column) | Performance
      //    (two grouped KPI columns) share one y; Performance is clearly
      //    wider than Account State but still fits inside the full-width row.
      const accountBox = await page.getByTestId('ws-panel-account-state').boundingBox();
      const perfBox = await page.getByTestId('ws-panel-performance').boundingBox();
      const sameRow =
        accountBox !== null &&
        perfBox !== null &&
        Math.abs(accountBox.y - perfBox.y) <= 1;
      const perfWider =
        accountBox !== null &&
        perfBox !== null &&
        perfBox.width > accountBox.width &&
        perfBox.width < 3 * accountBox.width;
      if (!sameRow || !perfWider) {
        throw new Error(
          `${t.name}: summary row geometry failed (sameRow=${sameRow}, perfWider=${perfWider}; account=${JSON.stringify(accountBox)}, perf=${JSON.stringify(perfBox)})`,
        );
      }

      // 4. No Watchlist and no Review Metrics in the curated default; no
      //    arrangement chrome in normal mode (no drag handles, no customize
      //    bar, no arrange grid).
      const watchlistCount = await page.getByTestId('ws-panel-watchlist').count();
      const processReviewCount = await page.getByTestId('ws-panel-process-review').count();
      const arrangeGridCount = await page.getByTestId('ws-arrange-grid').count();
      const arrangeModeCount = await page.getByTestId('ws-arrange-mode').count();
      const customizeBarCount = await page.getByTestId('ws-customize-bar').count();
      const arrangeHandles = await page.locator('[data-testid^="ws-arrange-handle-"]').count();
      const resizeHandles = await page.locator('[data-testid^="ws-arrange-resize-"]').count();
      if (
        watchlistCount !== 0 ||
        processReviewCount !== 0 ||
        arrangeGridCount !== 0 ||
        arrangeModeCount !== 0 ||
        customizeBarCount !== 0 ||
        arrangeHandles !== 0 ||
        resizeHandles !== 0
      ) {
        throw new Error(
          `${t.name}: dense absence contract failed (watchlist=${watchlistCount}, processReview=${processReviewCount}, arrangeGrid=${arrangeGridCount}, arrangeMode=${arrangeModeCount}, customizeBar=${customizeBarCount}, arrangeHandles=${arrangeHandles}, resizeHandles=${resizeHandles})`,
        );
      }

      // 5. No document-level horizontal overflow.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      if (overflow) {
        throw new Error(`${t.name}: horizontal overflow detected`);
      }

      const out = `${OUT_DIR}${t.name}`;
      await page.screenshot({ path: out, fullPage: t.fullPage });
      console.log(
        `${t.name} captured (${t.width}×${t.height}, fullPage=${t.fullPage}, overflow=${overflow}, riskFullWidth=${riskFullWidth}, summaryRow=${sameRow && perfWider}, tradesFullWidth=${tradesFullWidth}, watchlist=${watchlistCount}, processReview=${processReviewCount}, arrangeChrome=${arrangeGridCount + arrangeModeCount + customizeBarCount + arrangeHandles + resizeHandles})`,
      );
    }

    if (consoleErrors.length > 0) {
      console.warn(`Console errors during capture (${consoleErrors.length}):`);
      for (const e of consoleErrors.slice(0, 10)) console.warn(`  ${e}`);
    } else {
      console.log('No console errors during capture.');
    }

    await browser.close();
  } finally {
    // Kill the whole process group (npm + its next-server child) so a run can
    // never leave a dev server squatting on the port range.
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
