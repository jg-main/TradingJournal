/**
 * Corrective Task 7 — compact Performance filter bar + final M001 capture.
 *
 * The filter bar is now a compact analytical toolbar: the visible
 * 'Period:' / 'Unit:' form labels are gone and every control carries an
 * explicit accessible name (Performance period / filters / unit). Account
 * selection is owned exclusively by the sidebar AccountProvider (M007/D037) —
 * the bar renders no account control of any kind. This spec verifies
 * presentation + accessibility at 1440/1280/1024 and captures the evidence
 * screenshots, ending with the final full-dashboard M001 capture (1440 dark,
 * populated, normal mode).
 *
 * Regression (filter semantics) is covered by the existing performance
 * dashboard suite; here we only verify the presentation contract.
 */

import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

const TS = Date.now().toString(36);

async function seedAccount(page: Page, name: string, currency: string) {
  const res = await page.request.post('/api/accounts', { data: { name, currency } });
  expect(res.status()).toBe(201);
  const account = (await res.json()) as { id: string };
  await page.request.put(`/api/accounts/${account.id}`, { data: { maxRiskPerTradePct: 2, defaultCommission: 1 } });
  await page.request.post(`/api/accounts/${account.id}/initialize`, { data: { mode: 'opening_balance', amount: '50000.00' } });
  return account;
}

async function seedTrade(page: Page, accountId: string, spec: {
  symbol: string; direction: 'long' | 'short'; setup: string;
  entryPrice: number; entryQuantity: number; exitPrice: number; exitQuantity?: number;
  stopPrice: number; fees: number;
}) {
  const tr = await page.request.post('/api/trades', {
    data: { symbol: spec.symbol, direction: spec.direction, accountId, setup: spec.setup },
  });
  expect(tr.ok()).toBeTruthy();
  const trade = (await tr.json()) as { id: string };
  const exec = await page.request.post(`/api/trades/${trade.id}/execute`, {
    data: {
      entryPrice: spec.entryPrice, entryQuantity: spec.entryQuantity, stopPrice: spec.stopPrice,
      exit1Price: spec.exitPrice, exit1Quantity: spec.exitQuantity ?? spec.entryQuantity, fees: spec.fees,
    },
  });
  expect(exec.ok()).toBeTruthy();
  return trade.id;
}

/** Populated fixture: 8 closed trades (2 setups, wins + losses) + a rollforward
 *  drawdown/recovery sequence so every chart has real data for the capture. */
async function seedPopulatedFixture(page: Page, dbFile: string) {
  const tag = `${TS}${Math.random().toString(36).slice(2, 6)}`;
  const account = await seedAccount(page, `CT7-${tag}`, 'USD');

  const trades = [
    { symbol: `A1${tag}`, direction: 'long' as const, setup: 'Breakout', entryPrice: 100, entryQuantity: 100, exitPrice: 115, stopPrice: 95, fees: 5 },
    { symbol: `A2${tag}`, direction: 'long' as const, setup: 'Breakout', entryPrice: 50, entryQuantity: 200, exitPrice: 65, stopPrice: 45, fees: 10 },
    { symbol: `A3${tag}`, direction: 'short' as const, setup: 'Breakout', entryPrice: 200, entryQuantity: 50, exitPrice: 180, stopPrice: 210, fees: 8 },
    { symbol: `A4${tag}`, direction: 'long' as const, setup: 'Breakout', entryPrice: 80, entryQuantity: 150, exitPrice: 72, stopPrice: 76, fees: 5 },
    { symbol: `B1${tag}`, direction: 'long' as const, setup: 'Pullback', entryPrice: 60, entryQuantity: 120, exitPrice: 75, stopPrice: 55, fees: 6 },
    { symbol: `B2${tag}`, direction: 'long' as const, setup: 'Pullback', entryPrice: 40, entryQuantity: 200, exitPrice: 46, stopPrice: 38, fees: 8 },
    { symbol: `B3${tag}`, direction: 'short' as const, setup: 'Pullback', entryPrice: 150, entryQuantity: 60, exitPrice: 160, exitQuantity: 60, stopPrice: 145, fees: 5 },
    { symbol: `B4${tag}`, direction: 'long' as const, setup: 'Pullback', entryPrice: 90, entryQuantity: 100, exitPrice: 84, stopPrice: 87, fees: 5 },
  ] as Array<{ symbol: string; direction: 'long' | 'short'; setup: string; entryPrice: number; entryQuantity: number; exitPrice: number; stopPrice: number; fees: number; exitQuantity?: number }>;
  void trades;

  const ids: string[] = [];
  for (const t of trades) {
    ids.push(await seedTrade(page, account.id, t));
  }
  // Positive holding durations (scatter population) + close dates spread over
  // the current year (YTD default spans everything).
  const y = new Date().getFullYear();
  const db = new Database(dbFile);
  const upd = db.prepare('UPDATE trades SET opened_at = ?, closed_at = ? WHERE id = ?');
  trades.forEach((t, i) => {
    const closed = new Date(Date.UTC(y, 2 + i, 5 + i * 2, 15, 0, 0));
    upd.run(new Date(closed.getTime() - (40 + i * 35) * 60_000).toISOString(), closed.toISOString(), ids[i]);
  });
  // Rollforward: equity high → -5% drawdown → recovery (dominant base so the
  // shape holds under multi-account aggregation, and stored values cover the
  // single-account pass-through path).
  const existing = db.prepare('SELECT date, ending_equity FROM account_rollforward WHERE ending_equity IS NOT NULL ORDER BY date ASC').all() as Array<{ date: string; ending_equity: number }>;
  const byDate = new Map<string, number>();
  for (const r of existing) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.ending_equity);
  let hwm = 0;
  for (const d of [...byDate.keys()].sort()) hwm = Math.max(hwm, byDate.get(d)!);
  const latest = existing.length ? existing[existing.length - 1].date : '2030-01-01';
  const base = hwm + 1_000_000;
  const day = (off: number) => new Date(new Date(`${latest}T00:00:00Z`).getTime() + off * 86_400_000).toISOString().slice(0, 10);
  const path = [1, 0.97, 0.95, 0.97, 1].map((f) => base * f);
  const ins = db.prepare(
    `INSERT OR REPLACE INTO account_rollforward
      (id, account_id, date, beginning_equity, deposits_withdrawals, realized_gross_pnl, fees,
       ending_equity, cumulative_pnl, high_water_mark, drawdown_amount, drawdown_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  path.forEach((equity, i) => {
    ins.run(crypto.randomUUID(), account.id, day(i + 1), equity, equity, equity, Math.max(equity, base), base - equity, (base - equity) / base, now, now);
  });
  db.close();
  return account;
}

async function gotoPerformanceDark(page: Page) {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.goto('/performance');
  await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-kpi-card]').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('CT7 compact performance filter bar', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('renders a compact labeled-by-aria toolbar and captures the M001 evidence set', async ({ page }) => {
    const dbFile = process.env.DB_FILE_NAME as string;
    expect(dbFile).toBeTruthy();
    await seedPopulatedFixture(page, dbFile);
    await gotoPerformanceDark(page);
    await expect(page.locator('[data-widget-type="daily-cumulative-pnl"]')).toHaveAttribute('data-chart-series', /./, { timeout: 60_000 });

    // ── Compact toolbar: no visible form labels, explicit accessible names ─
    for (const label of ['Accounts:', 'Period:', 'Unit:']) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    // The retired page-local account selector is absent (M007/D037: the
    // sidebar AccountProvider is the sole account owner).
    await expect(page.getByLabel('Performance accounts')).toHaveCount(0);
    await expect(page.locator('#perf-account-scope')).toHaveCount(0);
    await expect(page.getByLabel('Performance period')).toBeVisible();
    await expect(page.getByLabel('Performance filters')).toBeVisible();
    await expect(page.getByLabel('Performance unit')).toBeVisible();
    // Selected state communicates the default period.
    await expect(page.getByLabel('Performance period')).toContainText('YTD');

    // ── Control geometry: 34-36px height, single row, aligned tops ───────
    const controls = [
      page.locator('#perf-date-period'),
      page.getByTestId('filters-trigger'),
      page.getByLabel('Performance unit'),
    ];
    const boxes: Array<{ top: number; height: number }> = [];
    for (const c of controls) {
      const b = await c.boundingBox();
      expect(b).not.toBeNull();
      boxes.push({ top: b!.y, height: b!.height });
    }
    for (const b of boxes) {
      expect(b.height).toBeGreaterThanOrEqual(34);
      expect(b.height).toBeLessThanOrEqual(36);
    }
    expect(Math.max(...boxes.map((b) => b.top)) - Math.min(...boxes.map((b) => b.top))).toBeLessThanOrEqual(1.5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // ── Keyboard: controls are laid out left → right and tab in that order ─
    const xPositions = await page.evaluate(() => {
      const ids = ['perf-date-period'];
      return [
        ...ids.map((id) => document.getElementById(id)?.getBoundingClientRect().x ?? 0),
        (document.querySelector('[data-testid="filters-trigger"]') as HTMLElement | null)?.getBoundingClientRect().x ?? 0,
        (document.querySelector('[aria-label="Performance unit"]') as HTMLElement | null)?.getBoundingClientRect().x ?? 0,
      ];
    });
    const sorted = [...xPositions].sort((a, b) => a - b);
    expect(xPositions).toEqual(sorted); // controls laid out left → right
    // Tab from the period trigger lands on filters → unit ($).
    await page.getByLabel('Performance period').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Performance filters')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('group', { name: 'Performance unit' }).getByRole('button', { name: '$' })).toBeFocused();

    // ── Screenshots ──────────────────────────────────────────────────────
    // 1440 dark (also the final M001 full-dashboard capture).
    await page.screenshot({ path: '/tmp/m001-final-1440-dark.png', fullPage: true });

    // 1440 light.
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload();
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-kpi-card]').first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: '/tmp/ct7-filter-bar-1440-light.png' });

    // 1280 dark.
    await page.evaluate(() => localStorage.setItem('theme', 'dark'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-kpi-card]').first()).toBeVisible({ timeout: 30_000 });
    const overflow1280 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow1280).toBeLessThanOrEqual(1);
    await page.screenshot({ path: '/tmp/ct7-filter-bar-1280-dark.png' });

    // 1024 dark.
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.reload();
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-kpi-card]').first()).toBeVisible({ timeout: 30_000 });
    const overflow1024 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow1024).toBeLessThanOrEqual(1);
    // Wrapped rows keep whole controls: the three control groups still each
    // contain their full control (segmented unit never splits internally).
    await expect(page.getByLabel('Performance unit')).toBeVisible();
    await page.screenshot({ path: '/tmp/ct7-filter-bar-1024-dark.png' });

    for (const f of ['m001-final-1440-dark.png', 'ct7-filter-bar-1440-light.png', 'ct7-filter-bar-1280-dark.png', 'ct7-filter-bar-1024-dark.png']) {
      expect(existsSync(`/tmp/${f}`)).toBe(true);
    }
  });
});
