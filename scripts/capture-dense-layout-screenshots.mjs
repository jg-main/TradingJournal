#!/usr/bin/env node
/**
 * M017 S05 T02 — capture the release-gate dense-layout workstation screenshots
 * at the three approved viewports into a git-tracked evidence directory
 * (docs/uat/m017-s05/).
 *
 *   - 2560×1440           (desktop, populated default scenario)
 *   - 1536×960            (effective laptop, populated default scenario)
 *   - 1440×900            (structural fallback)
 *
 * Per-viewport structural assertions confirm the M017 dense layout contract:
 *   - full-width Main Risk Metrics band (grid row "risk risk risk"),
 *   - the compact equal-width Account State | Performance | Review Metrics
 *     summary row (grid row "account perf review"),
 *   - the full-width Trades workspace band (grid row "trades trades trades"),
 *   - no Watchlist panel in the curated default,
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
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const PORT = 31_500 + (process.pid % 1_000);
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
      if (res.status < 500) return;
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
    { stdio: 'ignore', detached: false },
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
      await page.getByTestId('ws-grid').waitFor({ state: 'visible', timeout: 15_000 });
      // Allow the fixture client effect + layout to settle.
      await page.waitForTimeout(600);

      // ── Dense layout structural assertions ──
      // 1. Serialized grid template rows for the curated Risk & Positions
      //    default: full-width risk, equal-width summary row, full-width
      //    trades. The browser serializes grid-template-areas either as
      //    longhands or collapsed into the grid-template shorthand — the
      //    quoted area rows appear in both forms.
      const style = (await page.getByTestId('ws-grid').getAttribute('style')) ?? '';
      const riskRow = style.includes('"risk risk risk"');
      const summaryRow = style.includes('"account perf review"');
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
      const riskFullWidth =
        riskBox !== null && Math.abs(riskBox.x) <= 1 && Math.abs(riskBox.x + riskBox.width - t.width) <= 1;
      const tradesFullWidth =
        tradesBox !== null &&
        Math.abs(tradesBox.x) <= 1 &&
        Math.abs(tradesBox.x + tradesBox.width - t.width) <= 1;
      if (!riskFullWidth || !tradesFullWidth) {
        throw new Error(
          `${t.name}: full-width bands failed (risk=${riskFullWidth}, trades=${tradesFullWidth}; risk=${JSON.stringify(riskBox)}, trades=${JSON.stringify(tradesBox)})`,
        );
      }

      // 3. Equal-width summary row: Account State | Performance | Review
      //    Metrics share one y and one equal width.
      const accountBox = await page.getByTestId('ws-panel-account-state').boundingBox();
      const perfBox = await page.getByTestId('ws-panel-performance').boundingBox();
      const reviewBox = await page.getByTestId('ws-panel-process-review').boundingBox();
      const sameRow =
        accountBox !== null &&
        perfBox !== null &&
        reviewBox !== null &&
        Math.abs(accountBox.y - perfBox.y) <= 1 &&
        Math.abs(reviewBox.y - accountBox.y) <= 1;
      const equalWidth =
        accountBox !== null &&
        perfBox !== null &&
        reviewBox !== null &&
        Math.abs(accountBox.width - perfBox.width) <= 1 &&
        Math.abs(reviewBox.width - accountBox.width) <= 1;
      if (!sameRow || !equalWidth) {
        throw new Error(
          `${t.name}: summary row geometry failed (sameRow=${sameRow}, equalWidth=${equalWidth}; account=${JSON.stringify(accountBox)}, perf=${JSON.stringify(perfBox)}, review=${JSON.stringify(reviewBox)})`,
        );
      }

      // 4. No Watchlist in the curated default; no arrangement chrome in
      //    normal mode (no drag handles, no customize bar, no arrange grid).
      const watchlistCount = await page.getByTestId('ws-panel-watchlist').count();
      const arrangeGridCount = await page.getByTestId('ws-arrange-grid').count();
      const arrangeModeCount = await page.getByTestId('ws-arrange-mode').count();
      const customizeBarCount = await page.getByTestId('ws-customize-bar').count();
      const arrangeHandles = await page.locator('[data-testid^="ws-arrange-handle-"]').count();
      const resizeHandles = await page.locator('[data-testid^="ws-arrange-resize-"]').count();
      if (
        watchlistCount !== 0 ||
        arrangeGridCount !== 0 ||
        arrangeModeCount !== 0 ||
        customizeBarCount !== 0 ||
        arrangeHandles !== 0 ||
        resizeHandles !== 0
      ) {
        throw new Error(
          `${t.name}: dense absence contract failed (watchlist=${watchlistCount}, arrangeGrid=${arrangeGridCount}, arrangeMode=${arrangeModeCount}, customizeBar=${customizeBarCount}, arrangeHandles=${arrangeHandles}, resizeHandles=${resizeHandles})`,
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
        `${t.name} captured (${t.width}×${t.height}, fullPage=${t.fullPage}, overflow=${overflow}, riskFullWidth=${riskFullWidth}, summaryEqualWidth=${equalWidth}, tradesFullWidth=${tradesFullWidth}, watchlist=${watchlistCount}, arrangeChrome=${arrangeGridCount + arrangeModeCount + customizeBarCount + arrangeHandles + resizeHandles})`,
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
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
