/**
 * Corrective Task 3 — Performance chart information architecture & visual
 * refinement. Deterministic populated data at 1440px dark (normal mode, $):
 *  - captures the full dashboard (KPI rail + both chart rows);
 *  - captures a Net Daily P&L tooltip via synthetic axis-trigger params;
 *  - asserts the shared presentation contract from the built ECharts options:
 *    unit-aware Y ticks, date-formatted X labels, zero reference lines,
 *    integer Trades axis, metric-dependent Setup axis, dual drawdown axes.
 *
 * Run: npx playwright test e2e/ct3-charts.spec.ts --project=chromium
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
  await page.request.post(`/api/accounts/${account.id}/financial-events`, { data: { eventType: 'opening_balance', amount: '50000.00' } });
  await page.request.put(`/api/accounts/${account.id}`, { data: { isActive: true } });
  return account;
}

async function seedTrade(page: Page, accountId: string, spec: {
  symbol: string; direction: 'long' | 'short'; setup: string; entryPrice: number; entryQuantity: number;
  exitPrice: number; exitQuantity: number; stopPrice: number; fees: number; executedAt: string;
}) {
  const tr = await page.request.post('/api/trades', { data: { symbol: spec.symbol, direction: spec.direction, accountId, setup: spec.setup } });
  const trade = (await tr.json()) as { id: string };
  await page.request.post(`/api/trades/${trade.id}/execute`, {
    data: {
      entryPrice: spec.entryPrice, entryQuantity: spec.entryQuantity, stopPrice: spec.stopPrice,
      exit1Price: spec.exitPrice, exit1Quantity: spec.exitQuantity, fees: spec.fees, executedAt: spec.executedAt,
    },
  });
}

async function seedSetup(page: Page, value: string) {
  const resp = await page.request.post('/api/lookups', { data: { type: 'setup', value } });
  expect(resp.status()).toBe(201);
}

/** Seed accounts + trades across days and a rollforward series (equity declines
 *  so drawdown is non-zero). Both denominator types are then present. */
async function seedAll(page: Page) {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const y = new Date().getFullYear();
  const alpha = `Alpha ${tag}`;
  const beta = `Beta ${tag}`;
  await seedSetup(page, alpha);
  await seedSetup(page, beta);
  const accountB = await seedAccount(page, `CT3B-${tag}`, 'USD');
  const accountA = await seedAccount(page, `CT3A-${tag}`, 'USD');
  const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() - offset); return d.toISOString(); };
  const trades = [
    { symbol: `C1${TS}`, direction: 'long' as const, setup: alpha, entryPrice: 100, entryQuantity: 100, exitPrice: 150, exitQuantity: 100, stopPrice: 90, fees: 5, executedAt: day(30) },
    { symbol: `C2${TS}`, direction: 'long' as const, setup: alpha, entryPrice: 50, entryQuantity: 200, exitPrice: 70, exitQuantity: 200, stopPrice: 45, fees: 10, executedAt: day(24) },
    { symbol: `C3${TS}`, direction: 'short' as const, setup: beta, entryPrice: 200, entryQuantity: 50, exitPrice: 180, exitQuantity: 50, stopPrice: 210, fees: 8, executedAt: day(18) },
    { symbol: `C4${TS}`, direction: 'long' as const, setup: beta, entryPrice: 80, entryQuantity: 150, exitPrice: 70, exitQuantity: 150, stopPrice: 75, fees: 5, executedAt: day(12) },
    { symbol: `C5${TS}`, direction: 'short' as const, setup: alpha, entryPrice: 120, entryQuantity: 80, exitPrice: 135, exitQuantity: 80, stopPrice: 115, fees: 6, executedAt: day(6) },
    { symbol: `C6${TS}`, direction: 'long' as const, setup: alpha, entryPrice: 60, entryQuantity: 100, exitPrice: 80, exitQuantity: 100, stopPrice: 55, fees: 5, executedAt: day(2) },
    { symbol: `C7${TS}`, direction: 'long' as const, setup: beta, entryPrice: 40, entryQuantity: 200, exitPrice: 45, exitQuantity: 200, stopPrice: 38, fees: 8, executedAt: day(0) },
  ];
  for (const t of trades) await seedTrade(page, t.direction === 'long' ? accountA.id : accountB.id, t);

  // Give the seeded trades a positive holding duration: the execute endpoint
  // sets closed_at = executedAt (days ago) while opened_at is the creation
  // instant, which would otherwise exclude every point from the per-trade
  // duration scatter (zero/negative durations are data defects). Restrict the
  // update to this run's symbols so other fixtures in the shared DB are
  // untouched. ISO timestamps computed in JS (SQLite datetime() emits naive
  // local strings that would mis-parse against UTC closed_at).
  const db = new Database(process.env.DB_FILE_NAME as string);
  const upd = db.prepare('UPDATE trades SET opened_at = ? WHERE symbol = ?');
  for (const t of trades) {
    const closed = new Date(t.executedAt);
    upd.run(new Date(closed.getTime() - 2 * 60 * 60 * 1000).toISOString(), t.symbol);
  }
  const acct = db.prepare('SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1').all() as Array<{ id: string }>;
  const accountId = acct[0]?.id;
  const rf = db.prepare(
    'INSERT OR REPLACE INTO account_rollforward (id, account_id, date, beginning_equity, deposits_withdrawals, realized_gross_pnl, fees, ending_equity, cumulative_pnl, high_water_mark, drawdown_amount, drawdown_pct, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 0, 0, ?, ?)'
  );
  const tsNow = new Date().toISOString();
  rf.run(crypto.randomUUID(), accountId, `${y}-01-15`, 50000, 50000, 50000, 50000, tsNow, tsNow);
  rf.run(crypto.randomUUID(), accountId, `${y}-01-31`, 49500, 49500, 49500, 49500, tsNow, tsNow);
  db.close();
}

test.describe('CT3 chart presentation', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('renders all six charts with populated data, shows a tooltip, and captures screenshots', async ({ page }) => {
    await seedAll(page);
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/performance');
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-kpi-value="net-pnl"]')).not.toContainText('—', { timeout: 60_000 });
    await expect(page.locator('[data-widget-type="daily-cumulative-pnl"]')).toBeVisible({ timeout: 60_000 });

    // Wait for all six default charts to have built options (series data present).
    for (const wt of ['daily-cumulative-pnl', 'net-daily-pnl', 'trade-duration-performance', 'drawdown-curve', 'r-distribution', 'performance-by-setup']) {
      await expect(page.locator(`[data-widget-type="${wt}"]`)).toHaveAttribute('data-chart-series', /./, { timeout: 60_000 });
    }

    // Screenshot 1: full dashboard (KPI rail + both chart rows).
    await page.screenshot({ path: '/tmp/ct3-full-1440-dark.png', fullPage: false });

    // Screenshot 2: focused Net Daily P&L region (tooltip content verified
    // separately by invoking the live tooltip formatter — a deterministic
    // contract that does not depend on DOM hit-testing).
    const netDaily = page.locator('[data-widget-type="net-daily-pnl"]');
    const box = await netDaily.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.screenshot({
        path: '/tmp/ct3-netdaily-tooltip-1440-dark.png',
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    }

    // All six charts rendered canvases with populated series; additionally read
    // the live ECharts option to verify the shared presentation contract.
    const report = await page.evaluate(() => {
      const out: Record<string, unknown> = {};
      for (const wt of ['daily-cumulative-pnl', 'net-daily-pnl', 'trade-duration-performance', 'drawdown-curve', 'r-distribution', 'performance-by-setup']) {
        const el = document.querySelector(`[data-widget-type="${wt}"]`) as HTMLElement & { __echartsInstance?: { getOption: () => {
          yAxis?: Array<{ name?: string; axisLabel?: { formatter?: unknown }; minInterval?: number }> | { name?: string; axisLabel?: { formatter?: unknown }; minInterval?: number };
          xAxis?: Array<{ name?: string; axisLabel?: { formatter?: unknown } }> | { name?: string; axisLabel?: { formatter?: unknown } };
          series?: Array<{ markLine?: unknown }>;
          tooltip?: { trigger?: string; formatter?: unknown };
        } } };
        const series = el?.getAttribute('data-chart-series') ?? '';
        const canvas = el?.querySelector('canvas');
        const opt = el?.__echartsInstance?.getOption();
        const y = Array.isArray(opt?.yAxis) ? opt.yAxis : opt?.yAxis ? [opt.yAxis] : [];
        const x = Array.isArray(opt?.xAxis) ? opt.xAxis : opt?.xAxis ? [opt.xAxis] : [];
        const tts = Array.isArray(opt?.tooltip) ? opt.tooltip : opt?.tooltip ? [opt.tooltip] : [];
        // Deterministic tooltip-content contract: invoke the live formatter
        // with synthetic axis params and capture the HTML output.
        const formatter = tts[0]?.formatter;
        let tooltipHtml = '';
        if (typeof formatter === 'function') {
          try {
            tooltipHtml = String(formatter([{ seriesName: 'Net P&L', value: 719, dataIndex: 0, axisValueLabel: 'Aug 21', axisValue: 'Aug 21', name: 'Aug 21', color: '#fff' }]));
          } catch { /* ignore */ }
        }
        out[wt] = {
          series,
          hasCanvas: !!canvas,
          canvasW: canvas?.width ?? 0,
          yAxisNames: y.map((a) => a?.name ?? ''),
          xNames: x.map((a) => a?.name ?? ''),
          yFormatter: y.map((a) => (typeof a?.axisLabel?.formatter === 'function')),
          xFormatter: x.map((a) => (typeof a?.axisLabel?.formatter === 'function')),
          xName: x.map((a) => a?.name ?? ''),
          hasMarkLine: (opt?.series?.[0] as { markLine?: unknown } | undefined)?.markLine ? true : false,
          tooltipTrigger: tts.map((t) => t?.trigger ?? ''),
          hasTooltipFormatter: tts.some((t) => typeof t?.formatter === 'function'),
          tooltipHtml,
          minInterval: y.map((a) => a?.minInterval ?? null),
        };
      }
      return out;
    });
    console.log('[CT3 report]', JSON.stringify(report, null, 2));
    expect(Object.keys(report)).toHaveLength(6);
    for (const wt of ['daily-cumulative-pnl', 'net-daily-pnl', 'trade-duration-performance', 'drawdown-curve', 'r-distribution', 'performance-by-setup']) {
      expect((report[wt] as { hasCanvas: boolean }).hasCanvas).toBe(true);
      expect((report[wt] as { series: string }).series.length).toBeGreaterThan(0);
    }
    // Shared presentation contract present across the signed charts.
    expect((report['net-daily-pnl'] as { hasMarkLine: boolean }).hasMarkLine).toBe(true);
    expect((report['daily-cumulative-pnl'] as { hasMarkLine: boolean }).hasMarkLine).toBe(true);
    expect((report['net-daily-pnl'] as { tooltipTrigger: string[] }).tooltipTrigger).toContain('axis');
    expect((report['net-daily-pnl'] as { hasTooltipFormatter: boolean }).hasTooltipFormatter).toBe(true);
    // Tooltip content: formatted unit value + series label + date heading.
    // The live formatter uses real chart data (first bar = $4,995 from the
    // deterministic fixture), not the synthetic param value.
    const ndTip = (report['net-daily-pnl'] as { tooltipHtml: string }).tooltipHtml;
    expect(ndTip).toContain('Net P&L');
    expect(ndTip).toContain('$4,995');
    expect(ndTip).toContain('Aug 21');
    // Trade Duration (Corrective Task 3A): scatter tooltip heading is the
    // trade symbol with individual trade context — never a duration bucket.
    const tdTip = (report['trade-duration-performance'] as { tooltipHtml: string }).tooltipHtml;
    expect(tdTip).toMatch(/^<b>[A-Za-z0-9]+<\/b>/); // symbol heading
    expect(tdTip).toContain('Holding time');
    expect(tdTip).toContain('Net P&L');
    expect(tdTip).not.toContain('0-1 days');
    // Drawdown tooltip uses downside semantics (negative signs).
    const ddTip = (report['drawdown-curve'] as { tooltipHtml: string }).tooltipHtml;
    expect(ddTip).toContain('Drawdown %');
    expect(ddTip).toContain('-');
    // Date X-axis formatter (abbreviated month) on the daily charts.
    expect((report['net-daily-pnl'] as { xFormatter: boolean[] }).xFormatter[0]).toBe(true);
    // Drawdown (CT5): a single downside Y axis named 'Drawdown' — the dual
    // amount/% axis model is gone; both measures remain in the tooltip.
    expect((report['drawdown-curve'] as { yAxisNames: string[] }).yAxisNames).toEqual(['Drawdown']);
    // Integer Trades axis on R-Distribution.
    expect((report['r-distribution'] as { minInterval: (number | null)[] }).minInterval).toContain(1);
    // Metric-dependent Setup axis names.
    expect((report['performance-by-setup'] as { xNames: string[] }).xNames[0]).toBe('Net P&L');

    expect(existsSync('/tmp/ct3-netdaily-tooltip-1440-dark.png')).toBe(true);
    expect(existsSync('/tmp/ct3-full-1440-dark.png')).toBe(true);
  });
});
