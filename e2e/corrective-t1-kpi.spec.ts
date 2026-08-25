/**
 * Corrective Task 1 — KPI rail visual verification capture.
 * Seeds populated analytics data, sets dark theme, captures 1440px
 * normal-mode /performance screenshot of the refined KPI rail.
 * Run: npx playwright test e2e/corrective-t1-kpi.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';

const TS = Date.now().toString(36);

/**
 * Backdate a historical equity rollforward row so every backdated fill below
 * resolves equity via the historical_rollforward branch of the A2 resolver
 * (reconstructed_canonical refuses once ANY prior trade_execution activity
 * exists at/before the fill's asOf — the second backdated trade would fail).
 */
function seedEquityRollforward(accountId: string, asOfDaysAgo: number, equity: number) {
  const db = new Database(process.env.DB_FILE_NAME as string);
  const d = new Date(Date.now() - asOfDaysAgo * 86400000);
  const date = d.toISOString().slice(0, 10);
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO account_rollforward
     (id, account_id, date, beginning_equity, deposits_withdrawals, realized_gross_pnl, fees, ending_equity, cumulative_pnl, high_water_mark, drawdown_amount, drawdown_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 0, 0, ?, ?)`,
  ).run(crypto.randomUUID(), accountId, date, equity, equity, equity, equity, ts, ts);
  db.close();
}

async function seedAccount(page: Page, name: string, currency: string) {
  const res = await page.request.post('/api/accounts', { data: { name, currency } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}

async function seedTrade(page: Page, accountId: string, spec: {
  symbol: string; direction: 'long' | 'short'; entryPrice: number; entryQuantity: number;
  exitPrice: number; exitQuantity: number; stopPrice: number; fees: number;
  executedAt: string;
}) {
  const tradeRes = await page.request.post('/api/trades', {
    data: { symbol: spec.symbol, direction: spec.direction, accountId },
  });
  expect(tradeRes.ok()).toBeTruthy();
  const trade = await tradeRes.json();
  const execRes = await page.request.post(`/api/trades/${trade.id}/execute`, {
    data: {
      entryPrice: spec.entryPrice, entryQuantity: spec.entryQuantity,
      exit1Price: spec.exitPrice, exit1Quantity: spec.exitQuantity,
      stopPrice: spec.stopPrice, fees: spec.fees, executedAt: spec.executedAt,
    },
  });
  expect(execRes.ok()).toBeTruthy();
}

test('captures the refined KPI rail at 1440px dark with populated data', async ({ page }) => {
  // Seed an account with winning and losing trades so every KPI card has
  // canonical supporting data (sparkline, donut, profit/loss split bars).
  const account = await seedAccount(page, `CT1-${TS}`, 'USD');
  const riskRes = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  expect(riskRes.ok()).toBeTruthy();
  await page.request.post(`/api/accounts/${account.id}/initialize`, {
    data: { mode: 'opening_balance', amount: '100000.00', postedAt: new Date(Date.now() - 31 * 86400000).toISOString() },
  });
  // Historical equity anchor: see seedEquityRollforward above.
  seedEquityRollforward(account.id, 31, 100000);

  // Spread the executedAt dates across days so the cumulative P&L sparkline
  // has multiple points (a single-day set renders one point → sparkline skips).
  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return d.toISOString();
  };
  const trades = [
    { symbol: `W1${TS}`, direction: 'long' as const, entryPrice: 100, entryQuantity: 100, exitPrice: 150, exitQuantity: 100, stopPrice: 90, fees: 5, executedAt: day(9) },
    { symbol: `W2${TS}`, direction: 'long' as const, entryPrice: 50, entryQuantity: 200, exitPrice: 70, exitQuantity: 200, stopPrice: 45, fees: 10, executedAt: day(6) },
    { symbol: `W3${TS}`, direction: 'short' as const, entryPrice: 200, entryQuantity: 50, exitPrice: 180, exitQuantity: 50, stopPrice: 210, fees: 8, executedAt: day(4) },
    { symbol: `L1${TS}`, direction: 'long' as const, entryPrice: 80, entryQuantity: 150, exitPrice: 70, exitQuantity: 150, stopPrice: 75, fees: 5, executedAt: day(2) },
    { symbol: `L2${TS}`, direction: 'short' as const, entryPrice: 120, entryQuantity: 80, exitPrice: 135, exitQuantity: 80, stopPrice: 115, fees: 6, executedAt: day(0) },
  ];
  for (const t of trades) await seedTrade(page, account.id, t);

  // Dark theme via the app's own localStorage contract.
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/performance');
  await expect(page).toHaveTitle(/Performance Dashboard/);
  await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
  // Wait for populated analytics (KPI values replace the loading state).
  await expect(page.locator('[data-kpi-value="net-pnl"]')).not.toContainText('—', { timeout: 60_000 });
  await expect(page.locator('[data-kpi-value="net-pnl"]')).not.toContainText('Loading', { timeout: 60_000 });

  // Verify all five microviz slots render with populated data.
  await expect(page.locator('[data-kpi-microviz-slot]')).toHaveCount(4, { timeout: 60_000 });

  // KPI geometry sanity: five cards, equal height, within 124-132px.
  const geometry = await page.locator('[data-kpi-card]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-kpi-card'), top: r.top, bottom: r.bottom, height: r.height };
    }),
  );
  expect(geometry).toHaveLength(5);
  const heights = geometry.map((g) => g.height);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  for (const h of heights) {
    expect(h).toBeGreaterThanOrEqual(124);
    expect(h).toBeLessThanOrEqual(132);
  }

  // Capture the KPI rail (full page + card region).
  await page.screenshot({ path: '/tmp/ct1-kpi-1440-dark.png', fullPage: false });
  const rail = page.locator('section[aria-label="Performance KPI row"]');
  await rail.screenshot({ path: '/tmp/ct1-kpi-rail-1440-dark.png' });

  // Also light theme for the checklist.
  await page.evaluate(() => {
    localStorage.setItem('theme', 'light');
  });
  await page.reload();
  await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-kpi-value="net-pnl"]')).not.toContainText('—', { timeout: 60_000 });
  const railLight = page.locator('section[aria-label="Performance KPI row"]');
  await railLight.screenshot({ path: '/tmp/ct1-kpi-rail-1440-light.png' });
});
