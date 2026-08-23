/**
 * S07/T02 — Account surfaces viewport × theme matrix UAT.
 *
 * Closes the milestone success criterion "Viewport × theme matrix: account
 * overview, ledger, and settings render correctly at 1440/1280/1024 in light
 * and dark with no horizontal overflow". T01's lifecycle journey runs at the
 * single default viewport in light theme; this spec proves the three core
 * account surfaces hold across all six theme × viewport combinations.
 *
 * Per matrix cell (light+dark × 1440/1280/1024) the spec drives the real
 * theme contract and asserts:
 *   - Rendering: overview (NAV/Net Cash, Recent Events, "No open
 *     positions." empty state), ledger (all lifecycle rows + cash impacts),
 *     settings (Account Identity + labeled form fields).
 *   - Numeric alignment: every $-bearing tabular-nums element computes to
 *     font-variant-numeric: tabular-nums (overview metrics + ledger table);
 *     ledger cash-impact cells are additionally right-aligned.
 *   - Theme tokens: the `.dark` class matches the requested theme and the
 *     body (--background) + card (--card) surfaces sample to the correct
 *     family — near-white in light, graphite in dark (color-space agnostic
 *     1×1 canvas readback, per m026-s04 pattern).
 *   - No document-level horizontal overflow at any width.
 *   - No console/page errors and no failed requests at any combination.
 *
 * Theme contract under test (identical on the (legacy) layout, the shell
 * that hosts every account surface): a pre-paint inline script reads
 * localStorage['theme'] (falling back to prefers-color-scheme) and
 * applies/omits the `.dark` class on <html>; the sidebar ThemeToggle flips
 * the class and persists the storage key. Matrix cells drive the real
 * contract by setting the storage key before navigation; the supplementary
 * tests exercise the real toggle button.
 *
 * Two supplementary tests extend the matrix:
 *   - Theme toggle round-trip on an account surface: keyboard-focus the
 *     sidebar ThemeToggle, Enter to switch to dark, reload (persistence via
 *     the layout script), click back to light — token deltas verified each
 *     way.
 *   - Keyboard at the narrowest matrix cell: Tab to the Ledger workspace
 *     tab at 1024px in dark with a visible focus indicator, Enter to
 *     activate, ledger renders correctly.
 *
 * Data: one shared account seeded via the real APIs in beforeAll (opening
 * balance 10000 + deposit 500 − withdrawal 250 → net cash $10,250.00),
 * mirroring the T01 lifecycle amounts so the matrix exercises realistic
 * multi-row ledger data. Serial suite, single worker (config).
 *
 * Run: npx playwright test e2e/account-viewport-theme-uat.spec.ts --project=chromium
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** localStorage key owned by the theme system (ThemeToggle + layout script). */
const THEME_STORAGE_KEY = 'theme';

/** Target viewport widths from the milestone matrix (height fixed at 900). */
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1024', width: 1024, height: 900 },
] as const;

/** The two themes of the product theme contract. */
const THEMES = ['light', 'dark'] as const;

// Journey constants — mirror S07/T01 so the matrix runs on the same
// realistic lifecycle data (opening 10000 + deposit 500 − withdrawal 250).
const OPENING_DESCRIPTION = 'Matrix opening balance';
const DEPOSIT_DESCRIPTION = 'Matrix deposit';
const WITHDRAWAL_DESCRIPTION = 'Matrix withdrawal';

/** Shared account id, seeded once for the whole suite. */
let accountId = '';

// ── Runtime capture ─────────────────────────────────────────────────────

function watchForErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (
      text.includes('favicon') ||
      text.includes('extension') ||
      text.includes('[turbopack]') ||
      text.includes('Failed to load chunk')
    ) {
      return;
    }
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? 'unknown'})`);
  });
  page.on('response', (res) => {
    if (!res.ok() && res.status() >= 400) {
      const url = res.url();
      if (!url.includes('favicon') && !url.includes('__next')) {
        failedRequests.push(`${url} (${res.status()})`);
      }
    }
  });
  return { consoleErrors, pageErrors, failedRequests };
}

function assertCleanRuntime(
  pageErrors: string[],
  consoleErrors: string[],
  failedRequests: string[],
) {
  expect(pageErrors, 'uncaught page errors').toEqual([]);
  expect(consoleErrors, 'console.error output').toEqual([]);
  expect(failedRequests, 'failed requests').toEqual([]);
}

/**
 * Hide the Next.js dev-overlay badge on every navigation. The shared
 * helper's addStyleTag only targets the current document, so this spec (which
 * navigates many times per test) registers the style via addInitScript to
 * keep the overlay out of the sidebar-footer hit area on every page. The
 * init script runs at document-start, where documentElement may not exist
 * yet — retry on the next animation frame until the document root is ready.
 */
async function hideDevOverlayPersistently(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal { display: none !important; }';
    const attach = () => {
      if (document.documentElement) {
        document.documentElement.appendChild(style);
      } else {
        requestAnimationFrame(attach);
      }
    };
    attach();
  });
}

// ── Theme token sampling (color-space agnostic, per m026-s04) ───────────

/**
 * Sample the computed background of the first element matching `selector`
 * through a 1×1 canvas. Identity tokens are declared in oklch (Tailwind v4),
 * so getComputedStyle serializes them as lab(...)/oklch(...); Chrome's
 * canvas fillStyle getter preserves that color space and the pixel readback
 * is always true sRGB rgb(r, g, b).
 */
async function sampleBackground(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = getComputedStyle(el as HTMLElement).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  });
}

/** Sum of the RGB channels of an `rgb(r, g, b)` string (0–765). */
function channelSum(rgb: string): number {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(rgb);
  expect(m, `color sample should be rgb (got ${rgb})`).not.toBeNull();
  return Number(m![1]) + Number(m![2]) + Number(m![3]);
}

/**
 * Assert the theme-token contract on an account surface: the `.dark` class
 * matches the requested theme, and the body (--background) plus a card
 * surface (--card) resolve to the correct family — near-white in light,
 * graphite in dark. The card surface is sampled via `.bg-card` (the sidebar
 * ThemeToggle button always carries it on shell-bearing pages), so the same
 * assertion works on the overview, ledger, and settings surfaces. Returns
 * the sampled colors for delta assertions.
 */
async function assertThemeTokens(
  page: Page,
  theme: (typeof THEMES)[number],
): Promise<{ body: string; card: string }> {
  const hasDark = await page.evaluate(() =>
    document.documentElement.classList.contains('dark'),
  );
  expect(hasDark, `documentElement .dark class should match ${theme} theme`).toBe(
    theme === 'dark',
  );

  const body = await sampleBackground(page, 'body');
  const card = await sampleBackground(page, '.bg-card');
  if (theme === 'dark') {
    expect(channelSum(body), `dark body should be graphite (got ${body})`).toBeLessThan(300);
    expect(channelSum(card), `dark card should be graphite (got ${card})`).toBeLessThan(300);
  } else {
    expect(channelSum(body), `light body should be near-white (got ${body})`).toBeGreaterThan(600);
    expect(channelSum(card), `light card should be near-white (got ${card})`).toBeGreaterThan(600);
  }
  return { body, card };
}

// ── Visual / a11y helpers ───────────────────────────────────────────────

/** No document-level horizontal overflow at the current viewport width. */
async function assertNoHorizontalOverflow(page: Page, viewportWidth: number) {
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    dims.scrollWidth,
    `no document horizontal overflow at ${viewportWidth}px ` +
      `(scrollWidth ${dims.scrollWidth} > innerWidth ${dims.innerWidth})`,
  ).toBeLessThanOrEqual(dims.innerWidth + 1);
}

/**
 * True when every $-bearing tabular-nums element really renders tabular
 * numerals (font-variant-numeric: tabular-nums) — stable, scannable columns.
 */
async function assertTabularNumericAlignment(page: Page) {
  const report = await page.evaluate(() => {
    const moneyEls = Array.from(document.querySelectorAll('.tabular-nums')).filter((el) =>
      (el.textContent ?? '').includes('$'),
    );
    return {
      count: moneyEls.length,
      nonTabular: moneyEls.filter(
        (el) => !getComputedStyle(el).fontVariantNumeric.includes('tabular-nums'),
      ).length,
    };
  });
  expect(report.count, 'at least one $-bearing tabular-nums element').toBeGreaterThan(0);
  expect(report.nonTabular, 'every $-bearing tabular-nums element computes tabular-nums').toBe(0);
}

/**
 * True when a keyboard-focused control shows a visible focus indicator:
 * either the Tailwind focus-visible ring (box-shadow) or the UA default
 * outline. Callers must focus the element via keyboard first (tabToFocus).
 */
async function focusIndicatorVisible(page: Page, locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    const hasRing = cs.boxShadow !== 'none' && cs.boxShadow !== '';
    const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    return hasRing || hasOutline;
  });
}

/**
 * Press Tab repeatedly until the target element is focused (keyboard-only
 * navigation). Throws if the cap is exhausted. The cap is generous because
 * the shared application shell (sidebar with account selector, nav links,
 * theme toggle) precedes the main content in tab order.
 */
async function tabToFocus(page: Page, target: Locator, maxTabs = 60): Promise<void> {
  for (let i = 0; i < maxTabs; i += 1) {
    const reached = await target.evaluate((el) => el === document.activeElement).catch(() => false);
    if (reached) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab navigation did not reach the target element');
}

// ── Surface render contracts ────────────────────────────────────────────

/** Overview: metrics, recent events, empty positions state, tabular values. */
async function assertOverviewRenders(page: Page) {
  await expect(page.getByText('Net Asset Value')).toBeVisible();
  await expect(page.getByText('Net Cash')).toBeVisible();

  // NAV and Net Cash both equal the net cash (10000 + 500 − 250).
  await expect(page.getByText('$10,250.00')).toHaveCount(2);

  // Recent Events lists all three lifecycle rows.
  await expect(page.getByText(OPENING_DESCRIPTION)).toBeVisible();
  await expect(page.getByText(DEPOSIT_DESCRIPTION)).toBeVisible();
  await expect(page.getByText(WITHDRAWAL_DESCRIPTION)).toBeVisible();

  // Empty positions state on an account with no trades.
  await expect(page.getByText('Open Positions', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No open positions.')).toBeVisible();

  await assertTabularNumericAlignment(page);
}

/** Ledger: all lifecycle rows, correct cash impacts, right-aligned tabular cells. */
async function assertLedgerRenders(page: Page) {
  await expect(page.getByText(OPENING_DESCRIPTION)).toBeVisible();
  await expect(page.getByText(DEPOSIT_DESCRIPTION)).toBeVisible();
  await expect(page.getByText(WITHDRAWAL_DESCRIPTION)).toBeVisible();
  await expect(page.getByText('$10,000.00')).toBeVisible();
  await expect(page.getByText('$500.00')).toBeVisible();
  await expect(page.getByText('-$250.00')).toBeVisible();

  // Numeric alignment: cash-impact values are right-aligned with tabular
  // numerals in the ledger table.
  const cashReport = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('p.tabular-nums')).filter((el) =>
      (el.textContent ?? '').includes('$'),
    );
    return els.map((el) => ({
      right: getComputedStyle(el).textAlign === 'right',
      tabular: getComputedStyle(el).fontVariantNumeric.includes('tabular-nums'),
    }));
  });
  expect(cashReport.length, 'ledger renders $-bearing cash cells').toBeGreaterThan(0);
  for (const cell of cashReport) {
    expect(cell.right, 'ledger cash cells right-align').toBe(true);
    expect(cell.tabular, 'ledger cash cells use tabular numerals').toBe(true);
  }
}

/** Settings: identity section + labeled form fields. */
async function assertSettingsRenders(page: Page) {
  await expect(page.getByText('Account Identity')).toBeVisible();
  await expect(page.getByLabel('Account Name')).toBeVisible();
  await expect(page.getByLabel('Broker')).toBeVisible();
  await expect(page.getByLabel('Base Currency')).toBeVisible();
}

// ── Shared fixture: seed the lifecycle account via the real APIs ─────────

test.beforeAll(async ({ request }) => {
  const create = await request.post('/api/accounts', {
    data: { name: `Matrix Account ${Date.now()}`, broker: 'Matrix Broker', currency: 'USD' },
  });
  expect(create.status()).toBe(201);
  const account = (await create.json()) as { id: string };
  accountId = account.id;

  const opening = await request.post(`/api/accounts/${accountId}/initialize`, {
    data: { mode: 'opening_balance', amount: '10000.00', description: OPENING_DESCRIPTION },
  });
  expect(opening.status()).toBe(201);

  const deposit = await request.post(`/api/accounts/${accountId}/financial-events`, {
    data: { eventType: 'deposit', amount: '500.00', description: DEPOSIT_DESCRIPTION },
  });
  expect(deposit.status()).toBe(201);

  const withdrawal = await request.post(`/api/accounts/${accountId}/financial-events`, {
    data: { eventType: 'withdrawal', amount: '250.00', description: WITHDRAWAL_DESCRIPTION },
  });
  expect(withdrawal.status()).toBe(201);
});

// ════════════════════════════════════════════════════════════════════════
// Viewport × theme matrix (light+dark × 1440/1280/1024)
// ════════════════════════════════════════════════════════════════════════

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    test(`[${theme}] account overview, ledger, and settings render at ${vp.width}x${vp.height}: theme tokens, numeric alignment, no overflow`, async ({
      page,
    }, testInfo) => {
      const { consoleErrors, pageErrors, failedRequests } = watchForErrors(page);
      await hideDevOverlayPersistently(page);

      // Drive the real theme contract: the (legacy) layout's pre-paint
      // inline script reads localStorage['theme'] and applies/omits the
      // `.dark` class.
      await page.addInitScript(
        ({ key, theme: t }) => {
          try {
            localStorage.setItem(key, t);
          } catch {
            /* storage unavailable — defaults to light */
          }
        },
        { key: THEME_STORAGE_KEY, theme },
      );
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // ── Overview ──
      await page.goto(`/settings/accounts/${accountId}`);
      await expect(page.getByText('Net Asset Value')).toBeVisible();
      await assertOverviewRenders(page);
      await assertThemeTokens(page, theme);
      await assertNoHorizontalOverflow(page, vp.width);

      // ── Ledger ──
      await page.goto(`/settings/accounts/${accountId}/ledger`);
      await expect(page.getByText(OPENING_DESCRIPTION)).toBeVisible();
      await assertLedgerRenders(page);
      await assertNoHorizontalOverflow(page, vp.width);

      // ── Settings ──
      await page.goto(`/settings/accounts/${accountId}/settings`);
      await expect(page.getByText('Account Identity')).toBeVisible();
      await assertSettingsRenders(page);
      await assertNoHorizontalOverflow(page, vp.width);

      // Back to the overview for the per-combination screenshot evidence.
      await page.goto(`/settings/accounts/${accountId}`);
      await expect(page.getByText('Net Asset Value')).toBeVisible();
      const shot = await page.screenshot({ fullPage: false });
      await testInfo.attach(`account-${theme}-${vp.name}.png`, {
        body: shot,
        contentType: 'image/png',
      });

      assertCleanRuntime(pageErrors, consoleErrors, failedRequests);
    });
  }
}

// ════════════════════════════════════════════════════════════════════════
// Theme toggle round-trip on an account surface
// ════════════════════════════════════════════════════════════════════════

test('theme toggle: the sidebar toggle switches account surfaces and persists across reload', async ({
  page,
}, testInfo) => {
  const { consoleErrors, pageErrors, failedRequests } = watchForErrors(page);
  await hideDevOverlayPersistently(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Start light deterministically, but only on the first document: the
  // layout script falls back to prefers-color-scheme when the key is absent,
  // so setting the key once removes any doubt. The "set if absent" guard
  // matters because addInitScript re-runs on every navigation — including
  // page.reload() below — and must not clobber the toggled 'dark' value that
  // the persistence round-trip relies on.
  await page.addInitScript(
    ({ key }) => {
      try {
        if (!localStorage.getItem(key)) localStorage.setItem(key, 'light');
      } catch {
        /* storage unavailable */
      }
    },
    { key: THEME_STORAGE_KEY },
  );
  await page.goto(`/settings/accounts/${accountId}`);
  await expect(page.getByText('Net Asset Value')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(false);
  const lightTokens = await assertThemeTokens(page, 'light');

  // Keyboard-only switch: Tab to the sidebar ThemeToggle (visible focus
  // indicator) and Enter — the toggle's onClick flips the class + storage.
  const toggle = page.getByRole('button', { name: 'Toggle dark mode' });
  await tabToFocus(page, toggle);
  expect(await focusIndicatorVisible(page, toggle), 'theme toggle shows a focus indicator').toBe(true);
  await page.keyboard.press('Enter');

  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true);
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark');
  // The card background carries transition-colors — poll until it settles.
  await expect
    .poll(() => sampleBackground(page, '.bg-card'))
    .not.toBe(lightTokens.card);
  const darkTokens = await assertThemeTokens(page, 'dark');
  expect(darkTokens.card, 'dark card token differs from light').not.toBe(lightTokens.card);
  expect(darkTokens.body, 'dark background token differs from light').not.toBe(lightTokens.body);

  // Data still renders after the switch.
  await expect(page.getByText('$10,250.00').first()).toBeVisible();

  // Persistence round-trip: reload re-applies dark from localStorage via the
  // layout pre-paint script; tokens remain graphite.
  await page.reload();
  await expect(page.getByText('Net Asset Value')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true);
  await assertThemeTokens(page, 'dark');
  await expect(page.getByText('$10,250.00').first()).toBeVisible();

  const darkShot = await page.screenshot({ fullPage: false });
  await testInfo.attach('account-theme-toggle-dark-after-reload.png', {
    body: darkShot,
    contentType: 'image/png',
  });

  // Toggle back to light restores the light surface (token delta round-trip).
  await toggle.click();
  // The click leaves the mouse hovering over the toggle, whose hover state
  // swaps bg-card for bg-muted — move the pointer away before sampling the
  // card token so the sample reflects the resting surface.
  await page.mouse.move(0, 0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(false);
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('light');
  await expect
    .poll(() => sampleBackground(page, '.bg-card'))
    .toBe(lightTokens.card);
  await assertThemeTokens(page, 'light');

  assertCleanRuntime(pageErrors, consoleErrors, failedRequests);
});

// ════════════════════════════════════════════════════════════════════════
// Keyboard at the narrowest matrix cell (1024px dark)
// ════════════════════════════════════════════════════════════════════════

test('keyboard: tab to the Ledger workspace at 1024px in dark with a visible focus indicator', async ({
  page,
}) => {
  const { consoleErrors, pageErrors, failedRequests } = watchForErrors(page);
  await hideDevOverlayPersistently(page);
  await page.addInitScript(
    ({ key }) => {
      try {
        localStorage.setItem(key, 'dark');
      } catch {
        /* storage unavailable */
      }
    },
    { key: THEME_STORAGE_KEY },
  );
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`/settings/accounts/${accountId}`);
  await expect(page.getByText('Net Asset Value')).toBeVisible();

  // Keyboard-only: Tab through the workspace tab bar to the Ledger tab,
  // verify the focus indicator, and activate it with Enter.
  const tabs = page.getByRole('tablist', { name: 'Account workspace tabs' });
  const ledgerTab = tabs.getByRole('tab', { name: 'Ledger' });
  const ledgerResponse = page.waitForResponse(
    (res) => res.url().includes(`/api/accounts/${accountId}/ledger`) && res.status() === 200,
    { timeout: 15_000 },
  );
  await tabToFocus(page, ledgerTab);
  expect(await focusIndicatorVisible(page, ledgerTab), 'workspace tab shows a focus indicator').toBe(
    true,
  );
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/settings/accounts/${accountId}/ledger$`));
  await ledgerResponse;

  // The ledger renders correctly at the narrowest matrix width in dark.
  await assertLedgerRenders(page);
  await assertThemeTokens(page, 'dark');
  await assertNoHorizontalOverflow(page, 1024);

  assertCleanRuntime(pageErrors, consoleErrors, failedRequests);
});
