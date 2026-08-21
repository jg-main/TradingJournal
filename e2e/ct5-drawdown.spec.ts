/**
 * Corrective Task 5 — Drawdown downside area chart browser verification.
 *
 * Deterministic seeded drawdown/recovery history at 1440px dark:
 *   0% → -2% → -5% → -8% → -4% → -1% → 0% (high-water mark → max drawdown →
 *   partial recovery → full recovery) driven by REAL account_rollforward rows
 *   with canonical equity semantics (the route recomputes drawdown from the
 *   combined high-water mark — the same aggregation as production).
 *
 * The seeded account's equity sequence dominates the shared-DB combined
 * series: the base B is chosen above the pre-existing combined high-water
 * mark and the dates run after every pre-existing rollforward date, so the
 * drawn shape is exactly 0/2/5/8/4/1/0% in both $ and % modes.
 *
 * Verifies: single downside series (no dual axes), series entirely at or
 * below zero, zero-anchored domain (max 0), recovery returns to zero,
 * unit-driven series ($ → negated amount, % → negated canonical pct, R →
 * currency fallback with no refetch), unit-aware tooltips with the selected
 * measure first, and responsive 1280/1024. Screenshots as evidence.
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

/** Read the plain (serializable) live option for a widget. */
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
    };
  }, widgetType);
}

/** Invoke the live tooltip formatter for a dataIndex and return the HTML. */
function tooltipHtmlFor(page: Page, widgetType: string, dataIndex: number, axisValueLabel = '') {
  return page.evaluate(({ wt, idx, label }) => {
    const el = document.querySelector(`[data-widget-type="${wt}"]`) as
      (HTMLElement & { __echartsInstance?: { getOption: () => unknown } }) | null;
    const opt = el?.__echartsInstance?.getOption() as { tooltip?: Array<{ formatter?: unknown }> | { formatter?: unknown } };
    const tt = Array.isArray(opt?.tooltip) ? opt.tooltip[0] : opt?.tooltip;
    const formatter = tt?.formatter;
    if (typeof formatter !== 'function') return '';
    try {
      return String(formatter([{ seriesName: 'Drawdown', dataIndex: idx, value: 0, axisValueLabel: label, name: label }]));
    } catch {
      return '';
    }
  }, { wt: widgetType, idx: dataIndex, label: axisValueLabel });
}

async function readDrawdownChart(page: Page) {
  const opt = await optionOf(page, 'drawdown-curve');
  const y = Array.isArray(opt.yAxis) ? opt.yAxis : opt.yAxis ? [opt.yAxis] : [];
  const series = (opt.series ?? [])[0] as {
    data?: Array<number>;
    yAxisIndex?: number;
    markLine?: { data?: Array<{ yAxis?: number }> };
  };
  return { opt, y, series };
}

/** Count analytics API requests since the page loaded (unit switches must not refetch). */
function trackAnalyticsRequests(page: Page) {
  let count = 0;
  page.on('request', (req) => {
    if (req.url().includes('/api/performance/analytics')) count += 1;
  });
  return () => count;
}

test.describe('CT5 Drawdown downside area chart', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('renders a single downside series under $ / % / R with recovery to zero', async ({ page }) => {
    // ── Seed: account + a dominating rollforward sequence ────────────────
    const tag = `${TS}${Math.random().toString(36).slice(2, 6)}`;
    const account = await seedAccount(page, `CT5-${tag}`, 'USD');

    const dbFile = process.env.DB_FILE_NAME as string;
    expect(dbFile).toBeTruthy();
    const db = new Database(dbFile as string);

    // Compute the pre-existing combined equity series (all accounts) exactly
    // as the route's aggregateRollforwardByDate does, so the seeded sequence
    // reliably dominates: base B above the running high-water mark, dates
    // after every existing date.
    const existing = db.prepare(
      'SELECT date, ending_equity FROM account_rollforward WHERE ending_equity IS NOT NULL ORDER BY date ASC',
    ).all() as Array<{ date: string; ending_equity: number }>;
    const byDate = new Map<string, number>();
    for (const row of existing) {
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.ending_equity);
    }
    let priorHwm = 0;
    for (const date of [...byDate.keys()].sort()) {
      priorHwm = Math.max(priorHwm, byDate.get(date)!);
    }
    // Far-future fallback anchor: the S06 empty-state spec asserts a Custom
    // 2020 window shows 'No data' on every chart — the seeded rollforward must
    // never land inside 2020 regardless of spec run order, so the empty window
    // stays genuinely empty and the downside sequence stays isolated.
    const latestDate = existing.length > 0 ? existing[existing.length - 1].date : '2030-01-01';
    const base = priorHwm + 1_000_000;
    const lastDay = new Date(`${latestDate}T00:00:00Z`);
    const day = (offset: number) => {
      const d = new Date(lastDay.getTime() + offset * 86_400_000);
      return d.toISOString().slice(0, 10);
    };

    // Equity path: B → 0.98B → 0.95B → 0.92B → 0.96B → 0.99B → B
    // Drawdown: 0% → -2% → -5% → -8% → -4% → -1% → 0% (recovery)
    const path = [1, 0.98, 0.95, 0.92, 0.96, 0.99, 1].map((f) => base * f);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO account_rollforward
        (id, account_id, date, beginning_equity, deposits_withdrawals, realized_gross_pnl, fees,
         ending_equity, cumulative_pnl, high_water_mark, drawdown_amount, drawdown_pct, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    // Stored drawdown mirrors the equity path (base − equity) so BOTH the
    // single-account pass-through path (stored values) and the multi-account
    // aggregation path (recomputed from equity highs) produce the same shape.
    path.forEach((equity, i) => {
      insert.run(
        crypto.randomUUID(), account.id, day(i + 1), equity,
        equity, equity, Math.max(equity, base),
        base - equity, (base - equity) / base, now, now,
      );
    });
    db.close();

    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    const analyticsCount = trackAnalyticsRequests(page);
    await page.goto('/performance');
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-widget-type="drawdown-curve"]')).toHaveAttribute('data-chart-series', /./, { timeout: 60_000 });

    // ── Currency mode (default $) ────────────────────────────────────────
    let c = await readDrawdownChart(page);
    expect(c.y).toHaveLength(1); // single Y axis — no dual-axis model
    expect((c.y[0] as { name?: string }).name).toBe('Drawdown');
    expect((c.y[0] as { max?: number }).max).toBe(0); // zero-anchored domain
    expect(c.series.yAxisIndex).toBeUndefined();
    const expectedAmounts = path.map((equity) => -(base - equity));
    // The shared DB may carry other specs' rollforward rows before ours; the
    // seeded sequence is the tail (our dates run after every existing row).
    const tail = c.series.data!.slice(-7);
    expect(c.series.data!.length).toBeGreaterThanOrEqual(7);
    // One downside area: the negated canonical amounts (0 … -0.08B … 0).
    for (let i = 0; i < 7; i += 1) {
      expect(tail[i]).toBeCloseTo(expectedAmounts[i], 3);
    }
    // Entirely at or below zero; deepest drawdown exists; recovery returns to 0.
    expect(c.series.data!.every((v) => v <= 1e-6)).toBe(true);
    expect(Math.min(...tail)).toBeCloseTo(-0.08 * base, 3);
    expect(tail[6]).toBeCloseTo(0, 3);
    expect(c.series.markLine?.data?.[0]?.yAxis).toBe(0);

    // Tooltip: amount first, percentage second; negative signs on both.
    const tailStart = c.series.data!.length - 7;
    const minIdx = tailStart + tail.indexOf(Math.min(...tail));
    const minDate = day(minIdx - tailStart + 1); // x-axis dates are day(1..7)
    let tip = await tooltipHtmlFor(page, 'drawdown-curve', minIdx, minDate);
    expect(tip).toMatch(/<b>[A-Z][a-z]{2} \d{2}<\/b>/); // date heading
    expect(tip).toContain('Drawdown&nbsp;&nbsp;-$');
    expect(tip).toContain('Drawdown %&nbsp;&nbsp;-8%');
    expect(tip.indexOf('Drawdown&nbsp;&nbsp;')).toBeLessThan(tip.indexOf('Drawdown %&nbsp;&nbsp;'));
    await page.screenshot({ path: '/tmp/ct5-drawdown-currency-1440-dark.png' });
    const ddBox = await page.locator('[data-widget-type="drawdown-curve"]').boundingBox();
    expect(ddBox).not.toBeNull();
    if (ddBox) {
      const clip = { x: ddBox.x, y: ddBox.y, width: ddBox.width, height: ddBox.height };
      await page.screenshot({ path: '/tmp/ct5-drawdown-currency-widget-1440-dark.png', clip });
      await page.evaluate((idx) => {
        const el = document.querySelector('[data-widget-type="drawdown-curve"]') as
          (HTMLElement & { __echartsInstance?: { dispatchAction: (a: object) => void } }) | null;
        el?.__echartsInstance?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx });
      }, minIdx);
      await page.waitForTimeout(400);
      await page.screenshot({ path: '/tmp/ct5-drawdown-currency-tooltip-1440-dark.png', clip });
      await page.evaluate(() => {
        const el = document.querySelector('[data-widget-type="drawdown-curve"]') as
          (HTMLElement & { __echartsInstance?: { dispatchAction: (a: object) => void } }) | null;
        el?.__echartsInstance?.dispatchAction({ type: 'hideTip' });
      });
    }

    // ── Percent mode: same shape, negated canonical pct, % ticks ────────
    const requestsBeforePct = analyticsCount();
    await page.getByRole('button', { name: '%', exact: true }).click();
    await expect(page.getByRole('button', { name: '%', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => Math.min(...(await readDrawdownChart(page)).series.data ?? [])).toBeCloseTo(-0.08, 3);
    c = await readDrawdownChart(page);
    const expectedPcts = path.map((equity) => -((base - equity) / base));
    const tailPct = c.series.data!.slice(-7);
    for (let i = 0; i < 7; i += 1) {
      expect(tailPct[i]).toBeCloseTo(expectedPcts[i], 5);
    }
    expect(c.y).toHaveLength(1);
    expect(tailPct[6]).toBeCloseTo(0, 5); // recovery
    // No refetch from the unit toggle.
    expect(analyticsCount()).toBe(requestsBeforePct);
    // Percent axis ticks render -8% (not -0.08).
    const pctTick = await page.evaluate(() => {
      const el = document.querySelector('[data-widget-type="drawdown-curve"]') as
        (HTMLElement & { __echartsInstance?: { getOption: () => unknown } }) | null;
      const opt = el?.__echartsInstance?.getOption() as { yAxis?: Array<{ axisLabel?: { formatter?: (v: number) => string } }> | { axisLabel?: { formatter?: (v: number) => string } } };
      const y = Array.isArray(opt?.yAxis) ? opt.yAxis[0] : opt?.yAxis;
      const f = y?.axisLabel?.formatter;
      return typeof f === 'function' ? f(-0.08) : '';
    });
    expect(pctTick).toBe('-8%');
    // Tooltip: percentage first, amount second.
    tip = await tooltipHtmlFor(page, 'drawdown-curve', minIdx, minDate);
    expect(tip).toContain('Drawdown %&nbsp;&nbsp;-8%');
    expect(tip).toContain('Drawdown&nbsp;&nbsp;-$');
    expect(tip.indexOf('Drawdown %&nbsp;&nbsp;')).toBeLessThan(tip.indexOf('Drawdown&nbsp;&nbsp;'));
    if (ddBox) {
      await page.screenshot({ path: '/tmp/ct5-drawdown-percent-widget-1440-dark.png', clip: { x: ddBox.x, y: ddBox.y, width: ddBox.width, height: ddBox.height } });
    }

    // ── R mode: registry fallback → currency downside, no refetch ────────
    const requestsBeforeR = analyticsCount();
    await page.getByRole('button', { name: 'R', exact: true }).click();
    await expect(page.getByRole('button', { name: 'R', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => ((await readDrawdownChart(page)).y[0] as { name?: string }).name).toBe('Drawdown');
    c = await readDrawdownChart(page);
    const tailR = c.series.data!.slice(-7);
    for (let i = 0; i < 7; i += 1) {
      expect(tailR[i]).toBeCloseTo(expectedAmounts[i], 3); // currency fallback
    }
    expect(analyticsCount()).toBe(requestsBeforeR);

    // ── Full dashboard screenshot with the redesigned Drawdown in context ─
    await page.getByRole('button', { name: '$', exact: true }).click();
    await expect(page.getByRole('button', { name: '$', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(400);
    await page.screenshot({ path: '/tmp/ct5-full-1440-dark.png' });

    for (const f of ['ct5-drawdown-currency-1440-dark.png', 'ct5-drawdown-currency-widget-1440-dark.png', 'ct5-drawdown-currency-tooltip-1440-dark.png', 'ct5-drawdown-percent-widget-1440-dark.png', 'ct5-full-1440-dark.png']) {
      expect(existsSync(`/tmp/${f}`)).toBe(true);
    }
  });

  test('stays readable and overflow-free at 1280 and 1024', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/performance');
    await expect(page.locator('[data-widget-type="drawdown-curve"]')).toHaveAttribute('data-chart-series', /./, { timeout: 60_000 });
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      const c = await readDrawdownChart(page);
      expect(c.y).toHaveLength(1);
      expect((c.series.data ?? []).length).toBeGreaterThan(0);
    }
  });
});
