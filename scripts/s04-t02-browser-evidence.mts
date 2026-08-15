/**
 * M020/S04/T02 browser evidence — closed-phase dense grid.
 *
 * Runs the slice-verification checks at the 1600px workstation breakpoint,
 * 2560x1440, and 3840x2400@1.25:
 *  - .td scope on closed trades (page wrapper), no max-w-4xl cap
 *  - lifecycle-first grid-template-areas with independent side stacks
 *  - collapsible review sections: 4 sections, data-state=closed by
 *    default, click-to-expand flips data-state + chevron rotation
 *  - computed overflow-y on .td descendants (document scroll only)
 *  - console errors (pageerror/console.error) captured
 *  - network responses for the trade-detail APIs (all 200)
 * Saves screenshots to /tmp/s04-t02/ for the evidence bundle.
 */
import { chromium, type Browser } from '@playwright/test';
import fs from 'node:fs';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Run this helper only against an isolated evidence server/database.`);
  }
  return value;
}

const BASE = requiredEnv('M020_EVIDENCE_BASE_URL').replace(/\/$/, '');
const fixturePath = requiredEnv('M020_EVIDENCE_FIXTURE_PATH');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as { tradeId?: string };
const TRADE_ID = fixture.tradeId;
if (!TRADE_ID) {
  throw new Error(`Evidence fixture at ${fixturePath} does not include tradeId.`);
}
const TRADE_URL = `${BASE}/trades/${TRADE_ID}`;
const OUT = process.env.M020_EVIDENCE_OUTPUT_DIR ?? '/tmp/s04-t02';
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
function check(ok: boolean, msg: string) {
  if (ok) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

const EXPECTED_API_PATHS = [
  `/api/trades/${TRADE_ID}`,
  `/api/trades/${TRADE_ID}/executions`,
  `/api/trades/${TRADE_ID}/risk-snapshot`,
  `/api/trades/${TRADE_ID}/stop-adjustments`,
  `/api/trades/${TRADE_ID}/target-adjustments`,
  `/api/trades/${TRADE_ID}/level-history`,
  `/api/trades/${TRADE_ID}/assets`,
  `/api/trades/${TRADE_ID}/grade`,
  `/api/trades/${TRADE_ID}/mistakes`,
  `/api/trades/${TRADE_ID}/check-results`,
  `/api/trades/${TRADE_ID}/assessments`,
];

async function runViewport(
  browser: Browser,
  label: string,
  width: number,
  height: number,
  dpr: number,
  screenshotName: string,
) {
  console.log(`\n## ${label} (${width}x${height}@${dpr})`);
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 200)));

  const apiResponses: { path: string; status: number }[] = [];
  page.on('response', (res) => {
    const u = res.url();
    if (u.startsWith(`${BASE}/api/`) && !u.includes('/mtm/refresh')) {
      apiResponses.push({ path: new URL(u).pathname, status: res.status() });
    }
  });

  await page.goto(TRADE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('h1', { timeout: 20000 });

  // ── .td scope + no max-w-4xl cap ──
  const wrapper = await page.locator('.td').first();
  const wrapperInfo = await wrapper.evaluate((el) => ({
    className: el.className,
    maxWidth: getComputedStyle(el).maxWidth,
  }));
  check(
    wrapperInfo.className.includes('td') && wrapperInfo.className.includes('px-8'),
    `${label}: page wrapper carries the .td scope`,
  );
  check(
    wrapperInfo.maxWidth === 'none',
    `${label}: no max-w-4xl cap on the closed trade shell (computed max-width: ${wrapperInfo.maxWidth})`,
  );

  // ── Grid: closed variant + lifecycle-first template at >=1600px ──
  const grid = page.locator('.td-grid');
  const gridInfo = await grid.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      className: el.className,
      areas: cs.gridTemplateAreas,
      cols: cs.gridTemplateColumns,
      template: cs.gridTemplate,
    };
  });
  check(
    gridInfo.className.includes('td-grid--closed'),
    `${label}: grid carries td-grid--closed`,
  );
  const areaText = gridInfo.areas.replace(/\s+/g, ' ').trim();
  check(
    areaText.includes('lifecycle') && areaText.includes('left') &&
      areaText.includes('risk') && areaText.includes('right'),
    `${label}: grid-template-areas = ${JSON.stringify(areaText)}`,
  );
  const expectedWideAreas = '"lifecycle lifecycle lifecycle" "left risk right"';
  check(
    areaText === expectedWideAreas,
    `${label}: lifecycle-first wide hierarchy with independent side stacks`,
  );
  const colCount = gridInfo.cols.split(' ').length;
  check(
    colCount === 3,
    `${label}: grid resolves 3 operational columns (got ${colCount})`,
  );

  // Panels remain present inside the two side stacks.
  const panelAreas = await page.$$eval('.td-panel', (els) =>
    els.map((el) => ({ area: el.getAttribute('data-area'), gridArea: getComputedStyle(el).gridArea })),
  );
  check(
    panelAreas.length === 6 &&
      ['lifecycle', 'cockpit', 'risk', 'history', 'context', 'review'].every((a) =>
        panelAreas.some((p) => p.area === a),
      ),
    `${label}: panels resolve to lifecycle | cockpit | risk | history | context | review`,
  );
  const stackInfo = await page.$$eval('.td-grid-stack', (els) =>
    els.map((el) => ({
      area: el.getAttribute('data-area'),
      display: getComputedStyle(el).display,
    })),
  );
  check(
    stackInfo.length === 2 &&
      ['left', 'right'].every((area) => stackInfo.some((stack) => stack.area === area && stack.display === 'flex')),
    `${label}: left and right side stacks are independent flex columns`,
  );
  const sideFlow = await page.evaluate(() => {
    const context = document.querySelector<HTMLElement>('.td-panel[data-area="context"]');
    const review = document.querySelector<HTMLElement>('.td-panel[data-area="review"]');
    const right = document.querySelector<HTMLElement>('.td-grid-stack[data-area="right"]');
    if (!context || !review || !right) return null;
    const contextRect = context.getBoundingClientRect();
    const reviewRect = review.getBoundingClientRect();
    return {
      gap: parseFloat(getComputedStyle(right).gap),
      space: reviewRect.top - contextRect.bottom,
    };
  });
  check(
    sideFlow !== null && Math.abs(sideFlow.space - sideFlow.gap) < 1,
    `${label}: Review follows Context by one stack gap (measured ${sideFlow?.space}px)`,
  );

  // ── Collapsible review sections ──
  const sections = page.locator('.td-review-section');
  check(
    await sections.count() === 4,
    `${label}: review column has 4 collapsible sections (got ${await sections.count()})`,
  );
  const sectionTitles = await page.$$eval('.td-review-section-title', (els) => els.map((e) => e.textContent));
  check(
    JSON.stringify(sectionTitles) === JSON.stringify(['Grade', 'Mistakes', 'AI Assessment', 'Exit Notes']),
    `${label}: section headers = ${JSON.stringify(sectionTitles)}`,
  );
  const initialStates = await page.$$eval('.td-review-section', (els) =>
    els.map((el) => el.getAttribute('data-state')),
  );
  check(
    initialStates.every((s) => s === 'closed'),
    `${label}: all sections start collapsed (data-state=${JSON.stringify(initialStates)})`,
  );

  // Click the Grade section header → data-state flips, chevron rotates.
  const gradeTrigger = page.locator('.td-review-section-trigger', { hasText: 'Grade' });
  await gradeTrigger.click();
  await page.waitForTimeout(300);
  const gradeState = await page.locator('.td-review-section').first().getAttribute('data-state');
  const chevronTransform = await page
    .locator('.td-review-section').first()
    .locator('.td-review-section-chevron')
    .evaluate((el) => getComputedStyle(el).transform);
  check(
    gradeState === 'open',
    `${label}: clicking the Grade header expands the section (data-state=${gradeState})`,
  );
  check(
    chevronTransform !== 'none' && !chevronTransform.includes('0, 0, 0, 1, 0, 0') || chevronTransform.includes('matrix(-1'),
    `${label}: chevron rotates with the open state (transform=${chevronTransform})`,
  );
  await page.locator('.td-review-section-trigger', { hasText: 'Grade' }).click();
  await page.waitForTimeout(300);
  const gradeStateAfter = await page.locator('.td-review-section').first().getAttribute('data-state');
  check(
    gradeStateAfter === 'closed',
    `${label}: clicking again collapses the section (data-state=${gradeStateAfter})`,
  );

  // ── No nested scrollbars: computed overflow on .td descendants ──
  const overflow = await page.$$eval('.td *', (els) => {
    const bad = [];
    for (const el of els) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        bad.push({ cls: el.className?.toString().slice(0, 60), overflowY: cs.overflowY });
      }
    }
    return bad.slice(0, 5);
  });
  check(
    overflow.length === 0,
    `${label}: no nested vertical scrollbars on .td descendants (${overflow.length} scroll containers)`,
  );
  const docScroll = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    overflowY: getComputedStyle(document.documentElement).overflowY,
  }));
  // (the document-scroll contract is asserted below — inner scrollbars gate
  // already passed above)

  // ── Assets render below the grid in document flow ──
  const assetsBelowGrid = await page.evaluate(() => {
    const gridEl = document.querySelector('.td-grid');
    const assetsCard = [...document.querySelectorAll('[data-slot="card"]')].find((el) => {
      const title = el.querySelector('[data-slot="card-title"]')?.textContent?.trim() ?? '';
      return title === 'Assets';
    });
    if (!gridEl || !assetsCard) return { found: false };
    return {
      found: true,
      assetsBelow: assetsCard.getBoundingClientRect().top >= gridEl.getBoundingClientRect().bottom,
    };
  });
  check(
    assetsBelowGrid.found === true && assetsBelowGrid.assetsBelow === true,
    `${label}: assets card renders below the grid in document flow (must-have)`,
  );

  // ── Console errors ──
  check(
    pageErrors.length === 0,
    `${label}: no uncaught page errors (${pageErrors.length})`,
  );
  const realConsoleErrors = consoleErrors.filter((e) => !e.includes('Download the React DevTools'));
  check(
    realConsoleErrors.length === 0,
    `${label}: no console.error entries (${realConsoleErrors.length}: ${realConsoleErrors[0] ?? ''})`,
  );

  // ── Document-level scroll model ──
  // The must-have is "no nested scrollbars; document-level scroll only".
  // The inner-scrollbar gate above (no overflow-y on .td descendants) is
  // the real contract; whether the dense layout fits in one viewport or
  // scrolls is content-dependent. Completeness: the footer must be visible
  // (nothing clipped by the grid) and the document must be the scroll
  // container.
  const footerVisible = await page.locator('p', { hasText: /^Created / }).first().isVisible();
  check(
    footerVisible,
    `${label}: footer visible — grid content not clipped (docScroll ${docScroll.scrollHeight} vs client ${docScroll.clientHeight})`,
  );
  const docOverflow = await page.evaluate(() => ({
    htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
  }));
  check(
    docOverflow.htmlOverflowY !== 'hidden' && docOverflow.bodyOverflowY !== 'hidden',
    `${label}: document is the scroll container (html/body overflow not hidden)`,
  );

  // ── Network responses ──
  const missing = EXPECTED_API_PATHS.filter(
    (p) => !apiResponses.some((r) => r.path === p && r.status === 200),
  );
  check(
    missing.length === 0,
    `${label}: all trade-detail API endpoints respond 200 (${EXPECTED_API_PATHS.length} checked, missing: ${missing.join(', ') || 'none'})`,
  );
  const nonOk = apiResponses.filter((r) => r.status >= 400);
  check(
    nonOk.length === 0,
    `${label}: no API responses >= 400 (${JSON.stringify(nonOk.slice(0, 5))})`,
  );

  // ── Screenshot ──
  await page.screenshot({ path: `${OUT}/${screenshotName}`, fullPage: false });
  console.log(`  📸 screenshot saved: ${OUT}/${screenshotName}`);

  await context.close();
}

const browser = await chromium.launch();
try {
  await runViewport(browser, '1600x1200', 1600, 1200, 1, 'closed-1600x1200.png');
  await runViewport(browser, '2560x1440', 2560, 1440, 1, 'closed-2560x1440.png');
  await runViewport(browser, '3840x2400@125%', 3840, 2400, 1.25, 'closed-3840x2400-125.png');
} finally {
  await browser.close();
}

console.log(`\n## Results: ${passed}/${passed + failed} passed, ${failed}/${passed + failed} failed`);
process.exit(failed > 0 ? 1 : 0);
