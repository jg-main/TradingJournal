import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';

const TS = Date.now().toString(36);

/** Historical equity anchor for backdated fills (A2 historical_rollforward branch). */
function seedEquityRollforward(accountId: string, asOfDaysAgo: number, equity: number) {
  const db = new Database(process.env.DB_FILE_NAME as string);
  const date = new Date(Date.now() - asOfDaysAgo * 86400000).toISOString().slice(0, 10);
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO account_rollforward
     (id, account_id, date, beginning_equity, deposits_withdrawals, realized_gross_pnl, fees, ending_equity, cumulative_pnl, high_water_mark, drawdown_amount, drawdown_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 0, 0, ?, ?)`,
  ).run(crypto.randomUUID(), accountId, date, equity, equity, equity, equity, ts, ts);
  db.close();
}

/** Seed an account with wins+losses spread across days (same as ct1 metrics). */
async function seed(page: Page) {
  const res = await page.request.post('/api/accounts', { data: { name: `CT1R-${TS}`, currency: 'USD' } });
  expect(res.status()).toBe(201);
  const account = (await res.json()) as { id: string };
  await page.request.put(`/api/accounts/${account.id}`, { data: { maxRiskPerTradePct: 2, defaultCommission: 1 } });
  await page.request.post(`/api/accounts/${account.id}/initialize`, { data: { mode: 'opening_balance', amount: '100000.00', postedAt: new Date(Date.now() - 31 * 86400000).toISOString() } });
  seedEquityRollforward(account.id, 31, 100000);
  const now = new Date();
  const day = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() - offset); return d.toISOString(); };
  const trades = [
    { symbol: `RA${TS}`, direction: 'long' as const, entryPrice: 100, entryQuantity: 100, exitPrice: 150, exitQuantity: 100, stopPrice: 90, fees: 5, executedAt: day(9) },
    { symbol: `RB${TS}`, direction: 'long' as const, entryPrice: 50, entryQuantity: 200, exitPrice: 70, exitQuantity: 200, stopPrice: 45, fees: 10, executedAt: day(6) },
    { symbol: `RC${TS}`, direction: 'short' as const, entryPrice: 200, entryQuantity: 50, exitPrice: 180, exitQuantity: 50, stopPrice: 210, fees: 8, executedAt: day(4) },
    { symbol: `RD${TS}`, direction: 'long' as const, entryPrice: 80, entryQuantity: 150, exitPrice: 70, exitQuantity: 150, stopPrice: 75, fees: 5, executedAt: day(2) },
    { symbol: `RE${TS}`, direction: 'short' as const, entryPrice: 120, entryQuantity: 80, exitPrice: 135, exitQuantity: 80, stopPrice: 115, fees: 6, executedAt: day(0) },
  ];
  for (const t of trades) {
    const tr = await page.request.post('/api/trades', { data: { symbol: t.symbol, direction: t.direction, accountId: account.id } });
    const trade = await tr.json();
    await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: { entryPrice: t.entryPrice, entryQuantity: t.entryQuantity, exit1Price: t.exitPrice, exit1Quantity: t.exitQuantity, stopPrice: t.stopPrice, fees: t.fees, executedAt: t.executedAt },
    });
  }
}

for (const width of [1440, 1280, 1024]) {
  test(`supporting captions readable at ${width}px`, async ({ page }) => {
    await seed(page);
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/performance');
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-kpi-value="net-pnl"]')).not.toContainText('—', { timeout: 60_000 });
    await expect(page.locator('[data-kpi-microviz-slot]')).toHaveCount(4, { timeout: 60_000 });

    const report = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-kpi-card]'));
      const clipped: Array<{ id: string | null; texts: string[] }> = [];
      let docOverflowX = 0;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        const captionEls = Array.from(c.querySelectorAll('[data-testid="kpi-pnl-split-captions"] span')) as HTMLElement[];
        const bad = captionEls.filter((el) => {
          const er = el.getBoundingClientRect();
          return (el.scrollWidth - el.clientWidth) > 0.5 || er.right > r.right + 0.5 || er.left < r.left - 0.5;
        });
        if (bad.length > 0) clipped.push({ id: c.getAttribute('data-kpi-card'), texts: bad.map((b) => b.textContent ?? '') });
      }
      docOverflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      return { clipped, docOverflowX, rows: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))).size };
    });

    console.log(`[${width}px]`, JSON.stringify(report));
    // No supporting text clipped at any width; no doc overflow.
    expect(report.clipped).toEqual([]);
    expect(report.docOverflowX).toBeLessThanOrEqual(0);
  });
}
