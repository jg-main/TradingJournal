/**
 * Corrective Task 3A — chart-label/tooltip/chart-type browser verification.
 *
 * Verifies at 1440px dark normal mode with deterministic populated data:
 *  1. Performance by Setup resolves human-readable setup names (Breakout,
 *     Pullback, Episodic Pivot) — never raw UUIDs — and the tooltip shows the
 *     full name even when the axis label truncates.
 *  2. Trade Duration Performance is a per-trade scatter: continuous duration
 *     X axis with humanized ticks, signed 'Trade result' Y axis, positive and
 *     negative points, semantic point colors, a zero reference line, and
 *     trade-specific tooltips (symbol heading + duration + P&L + R + setup +
 *     close date) for both a profitable and a losing point.
 *  3. R-Multiple Distribution tooltip heading is the R bucket, not a date.
 *
 * Primary verification reads the live ECharts instance (stored on the widget
 * container by ChartWidget for inspection) and invokes the real tooltip
 * formatter — deterministic and independent of DOM hit-testing. Screenshots
 * are captured as visual evidence artifacts.
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

/** Create an active account with risk params, opening cash and currency. */
async function seedAccount(page: Page, name: string, currency: string) {
  const createResp = await page.request.post('/api/accounts', { data: { name, currency } });
  expect(createResp.status()).toBe(201);
  const account = (await createResp.json()) as { id: string };
  const riskResp = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: 2, defaultCommission: 1 },
  });
  expect(riskResp.ok()).toBeTruthy();
  const cashResp = await page.request.post(`/api/accounts/${account.id}/financial-events`, {
    data: { eventType: 'opening_balance', amount: '50000.00' },
  });
  expect(cashResp.ok()).toBeTruthy();
  const activateResp = await page.request.put(`/api/accounts/${account.id}`, { data: { isActive: true } });
  expect(activateResp.ok()).toBeTruthy();
  return account;
}

/** Create a setup lookup value. */
async function seedSetup(page: Page, value: string) {
  const resp = await page.request.post('/api/lookups', { data: { type: 'setup', value } });
  expect(resp.status()).toBe(201);
  return (await resp.json()) as { id: string };
}

/** Create + fully exit a trade with a deterministic setup and direction. */
async function seedTrade(page: Page, accountId: string, spec: SeededTradeSpec) {
  const tradeResp = await page.request.post('/api/trades', {
    data: { symbol: spec.symbol, direction: spec.direction, accountId, setup: spec.setup },
  });
  expect(tradeResp.ok()).toBeTruthy();
  const trade = (await tradeResp.json()) as { id: string };
  const execResp = await page.request.post(`/api/trades/${trade.id}/execute`, {
    data: {
      entryPrice: spec.entryPrice,
      entryQuantity: spec.entryQuantity,
      stopPrice: spec.stopPrice,
      exit1Price: spec.exitPrice,
      exit1Quantity: spec.exitQuantity,
      fees: spec.fees,
    },
  });
  expect(execResp.ok()).toBeTruthy();
  return trade.id;
}

/**
 * Deterministic 12-trade matrix with varied holding durations, wins, losses,
 * and individual R values (R = net / (|entry − stop| × qty)):
 *   SYM  dir  setup          dur   net      R
 *   TD01 long  Breakout       30m  +95    +1.90
 *   TD02 short Breakout       75m  -105   -2.10
 *   TD03 long  Pullback      104m  +190   +1.90
 *   TD04 long  Pullback      190m  -55    -2.20
 *   TD05 long  Episodic Pivot 260m  -55    -2.75
 *   TD06 long  Episodic Pivot 330m  -55    -2.75
 *   TD07 long  Breakout      500m  +230   +2.30
 *   TD08 short Breakout      700m  +95    +0.95
 *   TD09 long  Pullback      950m  +115   +2.30
 *   TD10 long  Pullback     1500m  -25    -0.50
 *   TD11 short Episodic Pivot 2200m +45    +0.90
 *   TD12 long  Breakout      3800m  +95    +4.75
 */
const TRADES: Array<SeededTradeSpec & { durationMinutes: number; closeDay: number }> = [
  { symbol: 'TD01', direction: 'long', setup: 'Breakout', entryPrice: 100, entryQuantity: 10, stopPrice: 95, exitPrice: 110, exitQuantity: 10, fees: 5, durationMinutes: 30, closeDay: 3 },
  { symbol: 'TD02', direction: 'short', setup: 'Breakout', entryPrice: 100, entryQuantity: 10, stopPrice: 105, exitPrice: 110, exitQuantity: 10, fees: 5, durationMinutes: 75, closeDay: 4 },
  { symbol: 'TD03', direction: 'long', setup: 'Pullback', entryPrice: 50, entryQuantity: 20, stopPrice: 45, exitPrice: 60, exitQuantity: 20, fees: 10, durationMinutes: 104, closeDay: 5 },
  { symbol: 'TD04', direction: 'long', setup: 'Pullback', entryPrice: 200, entryQuantity: 5, stopPrice: 195, exitPrice: 190, exitQuantity: 5, fees: 5, durationMinutes: 190, closeDay: 8 },
  { symbol: 'TD05', direction: 'long', setup: 'Episodic Pivot', entryPrice: 80, entryQuantity: 10, stopPrice: 78, exitPrice: 75, exitQuantity: 10, fees: 5, durationMinutes: 260, closeDay: 9 },
  { symbol: 'TD06', direction: 'long', setup: 'Episodic Pivot', entryPrice: 60, entryQuantity: 10, stopPrice: 58, exitPrice: 55, exitQuantity: 10, fees: 5, durationMinutes: 330, closeDay: 10 },
  { symbol: 'TD07', direction: 'long', setup: 'Breakout', entryPrice: 100, entryQuantity: 20, stopPrice: 95, exitPrice: 112, exitQuantity: 20, fees: 10, durationMinutes: 500, closeDay: 12 },
  { symbol: 'TD08', direction: 'short', setup: 'Breakout', entryPrice: 150, entryQuantity: 10, stopPrice: 160, exitPrice: 140, exitQuantity: 10, fees: 5, durationMinutes: 700, closeDay: 15 },
  { symbol: 'TD09', direction: 'long', setup: 'Pullback', entryPrice: 40, entryQuantity: 25, stopPrice: 38, exitPrice: 45, exitQuantity: 25, fees: 10, durationMinutes: 950, closeDay: 18 },
  { symbol: 'TD10', direction: 'long', setup: 'Pullback', entryPrice: 90, entryQuantity: 10, stopPrice: 85, exitPrice: 88, exitQuantity: 10, fees: 5, durationMinutes: 1500, closeDay: 22 },
  { symbol: 'TD11', direction: 'short', setup: 'Episodic Pivot', entryPrice: 120, entryQuantity: 10, stopPrice: 125, exitPrice: 115, exitQuantity: 10, fees: 5, durationMinutes: 2200, closeDay: 25 },
  { symbol: 'TD12', direction: 'long', setup: 'Breakout', entryPrice: 70, entryQuantity: 10, stopPrice: 68, exitPrice: 80, exitQuantity: 10, fees: 5, durationMinutes: 3800, closeDay: 28 },
];

/** ECharts instance surface stored on the widget container (inspection only). */
type EchartsHandle = {
  getOption: () => {
    xAxis?: Array<Record<string, unknown>> | Record<string, unknown>;
    yAxis?: Array<Record<string, unknown>> | Record<string, unknown>;
    series?: Array<Record<string, unknown>>;
    tooltip?: Array<Record<string, unknown>> | Record<string, unknown>;
  };
  dispatchAction: (action: Record<string, unknown>) => void;
};

async function optionOf(page: Page, widgetType: string): Promise<ReturnType<EchartsHandle['getOption']>> {
  return page.evaluate((wt) => {
    const el = document.querySelector(`[data-widget-type="${wt}"]`) as
      (HTMLElement & { __echartsInstance?: { getOption: () => unknown } }) | null;
    const inst = el?.__echartsInstance;
    if (!inst) throw new Error(`no echarts instance for ${wt}`);
    return inst.getOption() as ReturnType<EchartsHandle['getOption']>;
  }, widgetType);
}

/** Dispatch an action on the live ECharts instance (e.g. showTip) inside the page. */
async function dispatchTip(page: Page, widgetType: string, action: Record<string, unknown>) {
  await page.evaluate(({ wt, act }) => {
    const el = document.querySelector(`[data-widget-type="${wt}"]`) as
      (HTMLElement & { __echartsInstance?: { dispatchAction: (a: object) => void } }) | null;
    el?.__echartsInstance?.dispatchAction(act);
  }, { wt: widgetType, act: action });
}

/** Invoke the live tooltip formatter for a dataIndex and return the HTML. */
async function tooltipHtmlFor(page: Page, widgetType: string, dataIndex: number): Promise<string> {
  return page.evaluate(({ wt, idx }) => {
    const el = document.querySelector(`[data-widget-type="${wt}"]`) as
      (HTMLElement & { __echartsInstance?: { getOption: () => unknown } }) | null;
    const opt = el?.__echartsInstance?.getOption() as { tooltip?: Array<{ formatter?: unknown }> | { formatter?: unknown } };
    const tt = Array.isArray(opt?.tooltip) ? opt.tooltip[0] : opt?.tooltip;
    const formatter = tt?.formatter;
    if (typeof formatter !== 'function') return '';
    try {
      return String(formatter([{ seriesName: 'Trade result', dataIndex: idx, value: [0, 0] }]));
    } catch {
      return '';
    }
  }, { wt: widgetType, idx: dataIndex });
}

test.describe('CT3A chart labels, tooltip semantics & chart-type contract', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('resolves setup names, renders the duration scatter, and formats tooltip headings', async ({ page }) => {
    // ── Seed deterministic data ──────────────────────────────────────────
    const tag = `${TS}${Math.random().toString(36).slice(2, 6)}`;
    const account = await seedAccount(page, `CT3A-${tag}`, 'USD');
    const setupBreakout = await seedSetup(page, `Breakout ${tag}`);
    const setupPullback = await seedSetup(page, `Pullback ${tag}`);
    const setupPivot = await seedSetup(page, `Episodic Pivot ${tag}`);

    // Setup display names are resolved through the canonical lookup bridge:
    // resolveSetup auto-creates setup_definitions.name (original case) +
    // lookup_values.value (lowercased) when the name is new, and the analytics
    // route prefers setupDefinitions.name for display. The TRADES matrix below
    // uses these exact human-readable names.
    const dbFile = process.env.DB_FILE_NAME;
    expect(dbFile).toBeTruthy();

    const tradeIds: string[] = [];
    for (const t of TRADES) {
      tradeIds.push(await seedTrade(page, account.id, t));
    }

    // Override opened_at/closed_at for varied holding durations. Close dates
    // are spread across the current year (default YTD filter spans all).
    const y = new Date().getFullYear();
    const db2 = new Database(dbFile as string);
    const update = db2.prepare('UPDATE trades SET opened_at = ?, closed_at = ? WHERE id = ?');
    TRADES.forEach((t, i) => {
      const closedAt = new Date(Date.UTC(y, 7, t.closeDay, 15, 0, 0)); // Aug <day> 15:00Z
      const openedAt = new Date(closedAt.getTime() - t.durationMinutes * 60_000);
      update.run(openedAt.toISOString(), closedAt.toISOString(), tradeIds[i]);
    });
    db2.close();

    // ── Navigate at 1440 dark ────────────────────────────────────────────
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/performance');
    await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-widget-type="trade-duration-performance"]')).toHaveAttribute('data-chart-series', /./, { timeout: 60_000 });
    await expect(page.locator('[data-widget-type="performance-by-setup"]')).toHaveAttribute('data-chart-series', /./, { timeout: 60_000 });

    // ── 1. Performance by Setup: human-readable names ────────────────────
    const setupOpt = await optionOf(page, 'performance-by-setup');
    const setupX = (Array.isArray(setupOpt.xAxis) ? setupOpt.xAxis : setupOpt.xAxis ? [setupOpt.xAxis] : [])[0];
    const categories = (setupX.data as string[]) ?? [];
    // The axis displays the human-readable setup names — never the raw setup
    // UUIDs the trades reference internally.
    expect(categories).toContain('Breakout');
    expect(categories).toContain('Pullback');
    expect(categories).toContain('Episodic Pivot');
    expect(categories.every((c) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(c))).toBe(true);

    // Setup tooltip heading = full setup display name. 'Episodic Pivot' is
    // longer than the 12-char axis truncation, so the axis label shows
    // 'Episodic Pi…' while the tooltip must show the full name from the data
    // row — and never a UUID or a date.
    const pivotIdx = categories.indexOf('Episodic Pivot');
    expect(pivotIdx).toBeGreaterThanOrEqual(0);
    const setupTooltip = await tooltipHtmlFor(page, 'performance-by-setup', pivotIdx);
    expect(setupTooltip).toContain('<b>Episodic Pivot</b>');
    expect(setupTooltip).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(setupTooltip).not.toContain('<b>Aug ');
    expect(setupTooltip).toContain('Net P&L');

    // ── 2. Trade Duration scatter ────────────────────────────────────────
    const scOpt = await optionOf(page, 'trade-duration-performance');
    const scSeries = (scOpt.series ?? [])[0] as {
      type?: string;
      data?: Array<{ value: [number, number]; itemStyle?: { color?: string } }>;
      markLine?: { data?: Array<{ yAxis?: number }> };
      label?: { show?: boolean };
    };
    expect(scSeries.type).toBe('scatter');
    // The scatter includes every eligible closed trade in the shared Playwright
    // DB (accountScope=all), so assert at least the 12 seeded observations
    // (plus any other specs' trades) and that the seeded symbols are present.
    expect((scSeries.data?.length ?? 0)).toBeGreaterThanOrEqual(TRADES.length);
    const scatterSymbols = await page.evaluate(() => {
      const el = document.querySelector('[data-widget-type="trade-duration-performance"]') as (HTMLElement & { __echartsInstance?: { getOption: () => unknown } }) | null;
      const opt = el?.__echartsInstance?.getOption() as { series?: Array<{ data?: Array<{ value: [number, number] }> }> };
      return (opt?.series?.[0]?.data ?? []).map((d) => d.value[0]); // x = minutes
    });
    expect(Math.max(...scatterSymbols)).toBeGreaterThanOrEqual(3800); // the longest seeded hold is present

    // X: continuous duration axis with humanized tick formatter.
    const scX = (Array.isArray(scOpt.xAxis) ? scOpt.xAxis : scOpt.xAxis ? [scOpt.xAxis] : [])[0] as {
      type?: string; name?: string; axisLabel?: { formatter?: (v: number) => string };
    };
    expect(scX.type).toBe('value');
    expect(scX.name).toBe('Holding duration');
    // The X tick formatter humanizes durations — invoked inside the page
    // because evaluate serialization drops functions from the returned option.
    const scTicks = await page.evaluate(() => {
      const el = document.querySelector('[data-widget-type="trade-duration-performance"]') as (HTMLElement & { __echartsInstance?: { getOption: () => unknown } }) | null;
      const opt = el?.__echartsInstance?.getOption() as { xAxis?: Array<{ axisLabel?: { formatter?: (v: number) => string } }> | { axisLabel?: { formatter?: (v: number) => string } } };
      const x = Array.isArray(opt?.xAxis) ? opt.xAxis[0] : opt?.xAxis;
      const fmt = x?.axisLabel?.formatter;
      if (typeof fmt !== 'function') return { ok: false };
      return { ok: true, h104: fmt(104), m4: fmt(4), h199: fmt(199) };
    });
    expect(scTicks).toEqual({ ok: true, h104: '1h 44m', m4: '4m', h199: '3h 19m' });

    // Y: signed 'Trade result' outcome axis.
    const scY = (Array.isArray(scOpt.yAxis) ? scOpt.yAxis : scOpt.yAxis ? [scOpt.yAxis] : [])[0] as { name?: string };
    expect(scY.name).toBe('Trade result');

    // Positive and negative points with distinct semantic colors + zero line.
    const ys = scSeries.data?.map((d) => d.value[1]) ?? [];
    expect(ys.some((v) => v > 0)).toBe(true);
    expect(ys.some((v) => v < 0)).toBe(true);
    const colors = scSeries.data?.map((d) => d.itemStyle?.color ?? '') ?? [];
    expect(new Set(colors).size).toBeGreaterThan(1);
    const positiveIdx = scSeries.data!.findIndex((d) => d.value[1] > 0);
    const negativeIdx = scSeries.data!.findIndex((d) => d.value[1] < 0);
    expect(positiveIdx).toBeGreaterThanOrEqual(0);
    expect(negativeIdx).toBeGreaterThanOrEqual(0);
    expect(scSeries.data![positiveIdx].itemStyle?.color).not.toBe(scSeries.data![negativeIdx].itemStyle?.color);
    expect(scSeries.markLine?.data?.[0]?.yAxis).toBe(0);
    // Restrained: no per-point labels.
    expect(scSeries.label?.show).toBe(false);

    // Positive-point tooltip: symbol heading + duration + P&L + R + setup + close.
    const posTip = await tooltipHtmlFor(page, 'trade-duration-performance', positiveIdx);
    const posSym = scSeries.data![positiveIdx].value[1];
    expect(posTip).toMatch(/<b>[A-Z0-9]+<\/b>/);
    expect(posTip).toContain('Holding time');
    expect(posTip).toContain('Net P&L');
    expect(posTip).toContain('+$');
    expect(posTip).toContain('R');
    expect(posTip).toContain('Setup');
    expect(posTip).toContain('Closed');
    expect(posTip).not.toContain('0-1 days');
    expect(posTip).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(posTip).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no raw ISO timestamp
    void posSym;

    // Negative-point tooltip: same fields with negative semantics.
    const negTip = await tooltipHtmlFor(page, 'trade-duration-performance', negativeIdx);
    expect(negTip).toMatch(/<b>[A-Z0-9]+<\/b>/);
    expect(negTip).toContain('Holding time');
    expect(negTip).toContain('-$');
    expect(negTip).toContain('R');
    expect(negTip).toContain('Closed');

    // ── 3. R-Distribution tooltip heading = R bucket, not a date ─────────
    const rOpt = await optionOf(page, 'r-distribution');
    const rSeries = (rOpt.series ?? [])[0] as { data?: Array<{ value: number }> };
    const bucketIdx = (rSeries.data ?? []).findIndex((d) => d.value > 0);
    expect(bucketIdx).toBeGreaterThanOrEqual(0);
    const rTip = await tooltipHtmlFor(page, 'r-distribution', bucketIdx);
    expect(rTip).toMatch(/<b>[-+≤>0-9R to]+<\/b>/);
    expect(rTip).not.toContain('<b>Aug ');
    expect(rTip).toContain('Trades');

    // ── Screenshots (evidence artifacts) ─────────────────────────────────
    await page.screenshot({ path: '/tmp/ct3a-full-1440-dark.png' });

    const scatterBox = await page.locator('[data-widget-type="trade-duration-performance"]').boundingBox();
    expect(scatterBox).not.toBeNull();
    if (scatterBox) {
      const clip = { x: scatterBox.x, y: scatterBox.y, width: scatterBox.width, height: scatterBox.height };
      await page.screenshot({ path: '/tmp/ct3a-scatter-1440-dark.png', clip });

      // Visible tooltips via the real ECharts instance (item trigger renders
      // on showTip dispatch) for the positive and negative points.
      await dispatchTip(page, 'trade-duration-performance', { type: 'showTip', seriesIndex: 0, dataIndex: positiveIdx });
      await page.waitForTimeout(400);
      await page.screenshot({ path: '/tmp/ct3a-scatter-positive-tooltip-1440-dark.png', clip });
      await dispatchTip(page, 'trade-duration-performance', { type: 'showTip', seriesIndex: 0, dataIndex: negativeIdx });
      await page.waitForTimeout(400);
      await page.screenshot({ path: '/tmp/ct3a-scatter-negative-tooltip-1440-dark.png', clip });
      await dispatchTip(page, 'trade-duration-performance', { type: 'hideTip' });
    }

    const setupBox = await page.locator('[data-widget-type="performance-by-setup"]').boundingBox();
    if (setupBox) {
      const clip = { x: setupBox.x, y: setupBox.y, width: setupBox.width, height: setupBox.height };
      await page.screenshot({ path: '/tmp/ct3a-setup-1440-dark.png', clip });
      await dispatchTip(page, 'performance-by-setup', { type: 'showTip', seriesIndex: 0, dataIndex: 0 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: '/tmp/ct3a-setup-tooltip-1440-dark.png', clip });
    }

    const rBox = await page.locator('[data-widget-type="r-distribution"]').boundingBox();
    if (rBox) {
      const clip = { x: rBox.x, y: rBox.y, width: rBox.width, height: rBox.height };
      await dispatchTip(page, 'r-distribution', { type: 'showTip', seriesIndex: 0, dataIndex: bucketIdx });
      await page.waitForTimeout(400);
      await page.screenshot({ path: '/tmp/ct3a-rdist-tooltip-1440-dark.png', clip });
    }

    for (const f of ['ct3a-full-1440-dark.png', 'ct3a-scatter-1440-dark.png', 'ct3a-scatter-positive-tooltip-1440-dark.png', 'ct3a-scatter-negative-tooltip-1440-dark.png', 'ct3a-setup-1440-dark.png', 'ct3a-setup-tooltip-1440-dark.png', 'ct3a-rdist-tooltip-1440-dark.png']) {
      expect(existsSync(`/tmp/${f}`)).toBe(true);
    }
  });

  test('scatter stays within bounds and readable at 1280 and 1024 (no horizontal overflow)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/performance');
    await expect(page.locator('[data-widget-type="trade-duration-performance"]')).toHaveAttribute('data-chart-series', /./, { timeout: 60_000 });
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      const scTicks2 = await page.evaluate(() => {
        const el = document.querySelector('[data-widget-type="trade-duration-performance"]') as (HTMLElement & { __echartsInstance?: { getOption: () => unknown } }) | null;
        const opt = el?.__echartsInstance?.getOption() as { xAxis?: Array<{ axisLabel?: { formatter?: (v: number) => string } }> | { axisLabel?: { formatter?: (v: number) => string } } };
        const x = Array.isArray(opt?.xAxis) ? opt.xAxis[0] : opt?.xAxis;
        const fmt = x?.axisLabel?.formatter;
        return typeof fmt === 'function' ? fmt(104) : '';
      });
      expect(scTicks2).toBe('1h 44m');
    }
  });
});
