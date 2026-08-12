#!/usr/bin/env node
/**
 * M016 S07 T02 — capture the §11 release-gate workstation screenshots at the
 * three target viewports into a git-tracked evidence directory (docs/uat/).
 *
 *   - 2560×1440           (desktop, populated default scenario)
 *   - 1536×960            (effective laptop, populated default scenario)
 *   - 1440×900            (structural fallback)
 *
 * Runs its own Next dev server on --webpack (the stable dev path used by the
 * Playwright config) with a disposable database, then drives chromium.
 *
 * Usage: node scripts/capture-workstation-screenshots.mjs
 * Output: docs/uat/m016-s07/*.png
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const PORT = 31_400 + (process.pid % 1_000);
const ARTIFACT_ROOT = `/tmp/trading-journal-shots-${process.pid}`;
process.env.DB_FILE_NAME ??= `${ARTIFACT_ROOT}/journal.db`;
process.env.PLAYWRIGHT_PORT = String(PORT);

const OUT_DIR = new URL('../docs/uat/m016-s07/', import.meta.url).pathname;

/** Wait until the server responds on /dev/workstation. */
async function waitForServer(url, timeoutMs = 60_000) {
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
      { name: 'dash-2560x1440.png', width: 2560, height: 1440, fullPage: true },
      { name: 'dash-1536x960.png', width: 1536, height: 960, fullPage: true },
      { name: 'dash-1440x900-fallback.png', width: 1440, height: 900, fullPage: true },
    ];

    for (const t of targets) {
      await page.setViewportSize({ width: t.width, height: t.height });
      await page.goto(`${base}/dev/workstation`); // default populated scenario
      await page.getByTestId('ws-grid').waitFor({ state: 'visible', timeout: 15_000 });
      // Allow the fixture client effect + layout to settle.
      await page.waitForTimeout(600);
      const out = `${OUT_DIR}${t.name}`;
      await page.screenshot({ path: out, fullPage: t.fullPage });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );

      // Structural fallback assertions (mirror DASH-AC-10): the 9 critical
      // columns are rendered and the table fits inside the viewport width.
      const table = page.getByTestId('ws-positions-table');
      const headers = await table.locator('thead th').count();
      const tableBox = await table.boundingBox();
      const fits =
        tableBox !== null &&
        tableBox.x >= 0 &&
        tableBox.x + tableBox.width <= t.width;
      const toolbarVisible = await page.getByTestId('ws-toolbar').isVisible();
      const alertVisible = await page
        .getByTestId('ws-data-quality-alert-strip')
        .isVisible();
      const riskVisible = await page.getByTestId('ws-panel-risk').isVisible();

      if (headers !== 9 || !fits || overflow || !toolbarVisible || !alertVisible || !riskVisible) {
        throw new Error(
          `${t.name}: structural fallback failed (headers=${headers}, fits=${fits}, overflow=${overflow}, toolbar=${toolbarVisible}, alert=${alertVisible}, risk=${riskVisible})`,
        );
      }
      console.log(
        `${t.name} captured (${t.width}×${t.height}, fullPage=${t.fullPage}, overflow=${overflow}, headers=${headers}, fits=${fits}, toolbar=${toolbarVisible}, alert=${alertVisible}, risk=${riskVisible})`,
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
