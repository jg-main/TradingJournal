/**
 * Corrective Task 4 — Performance by Setup horizontal ranking chart.
 *
 * Deterministic populated data at 1440px dark (normal mode, $):
 *  - horizontal orientation: yAxis category (Setup) + xAxis value (metric);
 *  - human-readable setup names on the category axis, ranked descending;
 *  - positive/negative Net P&L crossing zero with a vertical reference line;
 *  - full setup name + supporting metrics in the tooltip (no UUIDs);
 *  - Configure-driven metric switching (Net P&L → Win Rate → Average R →
 *    Trade Count): orientation stays horizontal, ranking follows the metric,
 *    axis formatter changes, semantic colors stay correct, tooltip primary
 *    metric changes — on the SAME widget instance;
 *  - responsive checks at 1280/1024 (no horizontal overflow);
 *  - screenshots as evidence artifacts.
 *
 * Setup matrix (per-trade net P&L, R = net / (|entry − stop| × qty)):
 *   Qullamaggie Breakout  (long name — truncation + full-name tooltip)
 *     4 trades: +1495, +1490, +1245, -505   → net +3725, winRate 0.75, avgR ~1.24
 *   Episodic Pivot        (stop 49 → tiny risk → highest avgR)
 *     3 trades: +995, +895, -405            → net +1485, winRate 0.667, avgR ~4.95
 *   Pullback
 *     2 trades: +445, -305                  → net +140,  winRate 0.5,  avgR ~0.35
 *   Mean Reversion
 *     1 trade: -355                         → net -355,  winRate 0,    avgR ~-1.42
 *
 * Rankings by metric:  netPnl/count/winRate → Q > E > P > MR
 *                      avgR                → E > Q > P > MR  (distinct!)
 */

import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

const TS = Date.now().toString(36);

interface SeededTradeSpec {
  symbol: string;
  direction: 'long' | 'short';
  setup: string;
  entryPrice: number;
  entryQuantity: number;
  exitPrice: number;
  exitQuantity: number;
  stopPrice: number;
  fees: number;
}

async function seedAccount(page: Page, name: string, currency: string) {
  const res = await page.request.post('/api/accounts', { data: { name, currency } });
  expect(res.status()).toBe(201);
  const account = (await res.json()) as { id: string };
  await page.request.put(`/api/accounts/${account.id}`, { data: { maxRiskPerTradePct: 2, defaultCommission: 1 } });
  await page.request.post(`/api/accounts/${account.id}/initialize`, { data: { mode: 'opening_balance', amount: '50000.00' } });
  return account;
}

async function seedTrade(page: Page, accountId: string, spec: SeededTradeSpec) {
  const tr = await page.request.post('/api/trades', {
    data: { symbol: spec.symbol, direction: spec.direction, accountId, setup: spec.setup },
  });
  expect(tr.ok()).toBeTruthy();
  const trade = (await tr.json()) as { id: string };
  const exec = await page.request.post(`/api/trades/${trade.id}/execute`, {
    data: {
      entryPrice: spec.entryPrice,
      entryQuantity: spec.entryQuantity,
      stopPrice: spec.stopPrice,
      exit1Price: spec.exitPrice,
      exit1Quantity: spec.exitQuantity,
      fees: spec.fees,
    },
  });
  expect(exec.ok()).toBeTruthy();
  return trade.id;
}

const Q = 'Qullamaggie Breakout';
const E = 'Episodic Pivot';
const P = 'Pullback';
const M = 'Mean Reversion';

// Trades are listed out of ranking order to prove the chart sorts.
const TRADES: SeededTradeSpec[] = [
  // Mean Reversion: 1 loss, net -355, avgR ≈ -1.42
  { symbol: 'MR01', direction: 'short', setup: M, entryPrice: 120, entryQuantity: 50, stopPrice: 125, exitPrice: 127, exitQuantity: 50, fees: 5 },
  // Pullback: 1 win + 1 loss, net +140, winRate 0.5, avgR ≈ 0.35
  { symbol: 'PB01', direction: 'long', setup: P, entryPrice: 80, entryQuantity: 50, stopPrice: 76, exitPrice: 89, exitQuantity: 50, fees: 5 },
  { symbol: 'PB02', direction: 'long', setup: P, entryPrice: 80, entryQuantity: 50, stopPrice: 76, exitPrice: 74, exitQuantity: 50, fees: 5 },
  // Episodic Pivot: 2 wins + 1 loss, net +1485, winRate 0.667, avgR ≈ 4.95 (stop 49)
  { symbol: 'EP01', direction: 'long', setup: E, entryPrice: 50, entryQuantity: 100, stopPrice: 49, exitPrice: 60, exitQuantity: 100, fees: 5 },
  { symbol: 'EP02', direction: 'long', setup: E, entryPrice: 50, entryQuantity: 100, stopPrice: 49, exitPrice: 59, exitQuantity: 100, fees: 5 },
  { symbol: 'EP03', direction: 'long', setup: E, entryPrice: 50, entryQuantity: 100, stopPrice: 49, exitPrice: 46, exitQuantity: 100, fees: 5 },
  // Qullamaggie Breakout: 3 wins + 1 loss, net +3725, winRate 0.75, avgR ≈ 1.24
  { symbol: 'QB01', direction: 'long', setup: Q, entryPrice: 100, entryQuantity: 100, stopPrice: 90, exitPrice: 115, exitQuantity: 100, fees: 5 },
  { symbol: 'QB02', direction: 'long', setup: Q, entryPrice: 50, entryQuantity: 100, stopPrice: 40, exitPrice: 65, exitQuantity: 100, fees: 10 },
  { symbol: 'QB03', direction: 'long', setup: Q, entryPrice: 200, entryQuantity: 50, stopPrice: 190, exitPrice: 225, exitQuantity: 50, fees: 5 },
  { symbol: 'QB04', direction: 'long', setup: Q, entryPrice: 100, entryQuantity: 100, stopPrice: 90, exitPrice: 95, exitQuantity: 100, fees: 5 },
];

/** Read a plain (serializable) part of the live option for a widget. */
function optionOf(page: Page, widgetType: string) {
  return page.evaluate((wt) => {
    const el = document.querySelector(`[data-widget-type="${wt}"]`) as
      (HTMLElement & { __echartsInstance?: { getOption: () => unknown } }) | null;
    const inst = el?.__echartsInstance;
    if (!inst) throw new Error(`no echarts instance for ${wt}`);
    return inst.getOption() as {
      xAxis?: Array<Record<string, unknown>> | Record<string, unknown>;
      yAxis?: Array<Record<string, unknown>> | Record<string, unknown>;
      series?: Array<Record<string, unknown>>;
      tooltip?: Array<Record<string, unknown>> | Record<string, unknown>;
    };
  }, widgetType);
}

/** Invoke the live tooltip formatter for a dataIndex and return the HTML. */
function tooltipHtmlFor(page: Page, widgetType: string, dataIndex: number) {
  return page.evaluate(({ wt, idx }) => {
    const el = document.querySelector(`[data-widget-type="${wt}"]`) as
      (HTMLElement & { __echartsInstance?: { getOption: () => unknown } }) | null;
    const opt = el?.__echartsInstance?.getOption() as { tooltip?: Array<{ formatter?: unknown }> | { formatter?: unknown } };
    const tt = Array.isArray(opt?.tooltip) ? opt.tooltip[0] : opt?.tooltip;
    const formatter = tt?.formatter;
    if (typeof formatter !== 'function') return '';
    try {
      return String(formatter([{ seriesName: 'Net P&L', dataIndex: idx, value: 0 }]));
    } catch {
      return '';
    }
  }, { wt: widgetType, idx: dataIndex });
}

async function readSetupChart(page: Page) {
  const opt = await optionOf(page, 'performance-by-setup');
  const y = (Array.isArray(opt.yAxis) ? opt.yAxis : opt.yAxis ? [opt.yAxis] : [])[0] as {
    type?: string; data?: string[]; inverse?: boolean; axisLabel?: { width?: number; overflow?: string };
  };
  const x = (Array.isArray(opt.xAxis) ? opt.xAxis : opt.xAxis ? [opt.xAxis] : [])[0] as {
    type?: string; name?: string; minInterval?: number; axisLabel?: { formatter?: (v: number) => string };
  };
  const series = (opt.series ?? [])[0] as {
    type?: string;
    data?: Array<{ value: number | null; itemStyle?: { color?: string } }>;
    markLine?: { data?: Array<{ xAxis?: number }> };
  };
  return { y, x, series };
}

test.describe('CT4 Performance by Setup horizontal ranking', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('renders ranked horizontal bars and switches metrics through Configure', async ({ page }) => {
    // ── Seed deterministic data ──────────────────────────────────────────
    const tag = `${TS}${Math.random().toString(36).slice(2, 6)}`;
    const account = await seedAccount(page, `CT4-${tag}`, 'USD');
    // Setup names resolve through the canonical bridge at the trade edge:
    // resolveSetup auto-creates setup_definitions.name (original case) +
    // lookup_values.value (lowercased), so the analytics route displays the
    // human-readable names. No pre-seeded lookup rows (those would short-
    // circuit the bridge and fall back to the lowercased lookup value).
    const tradeIds: string[] = [];
    for (const t of TRADES) {
      tradeIds.push(await seedTrade(page, account.id, { ...t, setup: `${t.setup} ${tag}` }));
    }
    // Positive holding durations so every closed trade counts as an observation
    // (the Trade Duration scatter shares the population; ISO timestamps in JS
    // to avoid SQLite naive-datetime timezone mismatches).
    const db = new Database(process.env.DB_FILE_NAME as string);
    const upd = db.prepare('UPDATE trades SET opened_at = ? WHERE id = ?');
    const closedBase = new Date();
    TRADES.forEach((t, i) => {
      const closed = new Date(closedBase.getTime() - i * 3600_000);
      upd.run(new Date(closed.getTime() - 90 * 60_000).toISOString(), tradeIds[i]);
    });
    db.close();

    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/performance');
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-widget-type="performance-by-setup"]')).toHaveAttribute('data-chart-series', /./, { timeout: 60_000 });

    const setupTag = (name: string) => `${name} ${tag}`;
    // The shared Playwright DB (accountScope=all) also carries other specs'
    // setups, so all assertions are relative: the four seeded setups must
    // appear in the metric-driven rank order among themselves.
    const rank = (c: Awaited<ReturnType<typeof readSetupChart>>, name: string) => c.y.data!.indexOf(setupTag(name));

    // ── Net P&L: horizontal, ranked, signed, zero line ───────────────────
    let c = await readSetupChart(page);
    expect(c.y.type).toBe('category');
    expect(c.x.type).toBe('value');
    expect(c.y.inverse).toBe(true);
    expect(c.x.name).toBe('Net P&L');
    expect(c.y.axisLabel?.width).toBeGreaterThan(0);
    expect(c.y.axisLabel?.overflow).toBe('truncate');
    // Descending ranking: Qullamaggie (top) > Episodic > Pullback > Mean Reversion.
    expect(rank(c, Q)).toBeGreaterThanOrEqual(0);
    expect(rank(c, Q)).toBeLessThan(rank(c, E));
    expect(rank(c, E)).toBeLessThan(rank(c, P));
    expect(rank(c, P)).toBeLessThan(rank(c, M));
    expect(c.y.data!.every((n) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(n))).toBe(true);
    const colorOf = (name: string) => c.series.data![rank(c, name)].itemStyle?.color ?? '';
    // Signed bars get semantic colors (positive setups share a color distinct
    // from the negative one); the vertical zero line is present.
    expect(colorOf(Q)).not.toBe(colorOf(M));
    expect(colorOf(E)).toBe(colorOf(Q));
    expect(c.series.markLine?.data?.[0]?.xAxis).toBe(0);

    // Tooltip: full setup name heading + primary metric first + supporting fields.
    const tip = await tooltipHtmlFor(page, 'performance-by-setup', rank(c, Q));
    expect(tip).toContain(`<b>${setupTag(Q)}</b>`);
    expect(tip).toContain('Net P&L');
    expect(tip).toContain('Trades');
    expect(tip).toContain('4');
    expect(tip).toContain('Win Rate');
    expect(tip).toContain('75%');
    expect(tip).toContain('Average R');
    expect(tip.indexOf('Net P&L')).toBeLessThan(tip.indexOf('Trades'));
    expect(tip).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);

    // ── Screenshots: full page + focused Net P&L chart + tooltip ─────────
    await page.screenshot({ path: '/tmp/ct4-full-1440-dark.png' });
    const box = await page.locator('[data-widget-type="performance-by-setup"]').boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
      await page.screenshot({ path: '/tmp/ct4-setup-netpnl-1440-dark.png', clip });
      const qIdx = rank(c, Q);
      await page.evaluate(({ idx }) => {
        const el = document.querySelector('[data-widget-type="performance-by-setup"]') as
          (HTMLElement & { __echartsInstance?: { dispatchAction: (a: object) => void } }) | null;
        el?.__echartsInstance?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx });
      }, { idx: qIdx });
      await page.waitForTimeout(400);
      await page.screenshot({ path: '/tmp/ct4-setup-tooltip-1440-dark.png', clip });
      await page.evaluate(() => {
        const el = document.querySelector('[data-widget-type="performance-by-setup"]') as
          (HTMLElement & { __echartsInstance?: { dispatchAction: (a: object) => void } }) | null;
        el?.__echartsInstance?.dispatchAction({ type: 'hideTip' });
      });
    }

    // ── Metric switching through the existing Configure UI (same instance) ─
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await page.getByRole('button', { name: 'Actions for Performance by Setup', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Configure' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Configure Performance by Setup' })).toBeVisible();

    // Win Rate: axis renames, ranking stays Q>E>P>MR, neutral bars, % ticks.
    await dialog.getByLabel('Primary series').click();
    await page.getByRole('option', { name: 'Win Rate' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await readSetupChart(page)).x.name).toBe('Win Rate');
    c = await readSetupChart(page);
    expect(c.y.type).toBe('category'); // orientation unchanged
    expect(c.x.type).toBe('value');
    expect(rank(c, Q)).toBeLessThan(rank(c, E));
    expect(rank(c, E)).toBeLessThan(rank(c, P));
    expect(rank(c, P)).toBeLessThan(rank(c, M));
    // Neutral — a rate is not signed P&L: all four seeded bars share one color.
    const wrColorOf = (name: string) => c.series.data![rank(c, name)].itemStyle?.color ?? '';
    expect(wrColorOf(Q)).toBe(wrColorOf(M));
    expect(c.series.markLine).toBeUndefined();
    const wrTick = await page.evaluate(() => {
      const el = document.querySelector('[data-widget-type="performance-by-setup"]') as
        (HTMLElement & { __echartsInstance?: { getOption: () => unknown } }) | null;
      const opt = el?.__echartsInstance?.getOption() as { xAxis?: Array<{ axisLabel?: { formatter?: (v: number) => string } }> | { axisLabel?: { formatter?: (v: number) => string } } };
      const x = Array.isArray(opt?.xAxis) ? opt.xAxis[0] : opt?.xAxis;
      const f = x?.axisLabel?.formatter;
      return typeof f === 'function' ? f(0.5) : '';
    });
    expect(wrTick).toBe('50%');
    const wrTip = await tooltipHtmlFor(page, 'performance-by-setup', rank(c, Q));
    expect(wrTip).toContain(`<b>${setupTag(Q)}</b>`);
    expect(wrTip).toContain('Win Rate');
    expect(wrTip).toContain('75%');
    expect(wrTip.indexOf('Win Rate')).toBeLessThan(wrTip.indexOf('Trades'));

    // Average R: Episodic Pivot ranks TOP (distinct from Net P&L order),
    // signed bar colors return, zero line returns, R axis ticks.
    await page.getByRole('button', { name: 'Actions for Performance by Setup', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Configure' }).click();
    await dialog.getByLabel('Primary series').click();
    await page.getByRole('option', { name: 'Average R' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await readSetupChart(page)).x.name).toBe('Average R');
    c = await readSetupChart(page);
    expect(rank(c, E)).toBeLessThan(rank(c, Q));
    expect(rank(c, Q)).toBeLessThan(rank(c, P));
    expect(rank(c, P)).toBeLessThan(rank(c, M));
    // Signed polarity among the seeded setups.
    const arColorOf = (name: string) => c.series.data![rank(c, name)].itemStyle?.color ?? '';
    expect(arColorOf(E)).not.toBe(arColorOf(M));
    expect(c.series.markLine?.data?.[0]?.xAxis).toBe(0);
    await page.screenshot({ path: '/tmp/ct4-setup-avgr-1440-dark.png', clip: box ?? undefined });

    // Trade Count: integer Trades axis, neutral bars, no zero line.
    await page.getByRole('button', { name: 'Actions for Performance by Setup', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Configure' }).click();
    await dialog.getByLabel('Primary series').click();
    await page.getByRole('option', { name: 'Trade Count' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await readSetupChart(page)).x.name).toBe('Trades');
    c = await readSetupChart(page);
    expect(c.x.minInterval).toBe(1);
    expect(rank(c, Q)).toBeLessThan(rank(c, E));
    expect(rank(c, E)).toBeLessThan(rank(c, P));
    expect(rank(c, P)).toBeLessThan(rank(c, M));
    expect(c.series.data![rank(c, Q)].value).toBe(4);
    expect(c.series.data![rank(c, E)].value).toBe(3);
    expect(c.series.data![rank(c, P)].value).toBe(2);
    expect(c.series.data![rank(c, M)].value).toBe(1);
    // Neutral treatment for counts.
    const cntColorOf = (name: string) => c.series.data![rank(c, name)].itemStyle?.color ?? '';
    expect(cntColorOf(Q)).toBe(cntColorOf(M));

    for (const f of ['ct4-full-1440-dark.png', 'ct4-setup-netpnl-1440-dark.png', 'ct4-setup-tooltip-1440-dark.png', 'ct4-setup-avgr-1440-dark.png']) {
      expect(existsSync(`/tmp/${f}`)).toBe(true);
    }
  });

  test('stays readable and overflow-free at 1280 and 1024', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/performance');
    await expect(page.locator('[data-widget-type="performance-by-setup"]')).toHaveAttribute('data-chart-series', /./, { timeout: 60_000 });
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      const c = await readSetupChart(page);
      expect(c.y.type).toBe('category');
      expect(c.x.type).toBe('value');
      expect((c.y.data ?? []).length).toBeGreaterThanOrEqual(4); // no setup dropped, no label overlap configuration
      expect(c.y.axisLabel?.overflow).toBe('truncate');
    }
  });
});
