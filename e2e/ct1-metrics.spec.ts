import { test, expect, type Page } from '@playwright/test';

const TS = Date.now().toString(36);

test('verifies the refined KPI presentation metrics in dark mode', async ({ page }) => {
  const res = await page.request.post('/api/accounts', { data: { name: `CT1M-${TS}`, currency: 'USD' } });
  expect(res.status()).toBe(201);
  const account = (await res.json()) as { id: string };
  await page.request.put(`/api/accounts/${account.id}`, { data: { maxRiskPerTradePct: 2, defaultCommission: 1 } });
  await page.request.post(`/api/accounts/${account.id}/financial-events`, { data: { eventType: 'opening_balance', amount: '100000.00' } });
  await page.request.put(`/api/accounts/${account.id}`, { data: { isActive: true } });

  const now = new Date();
  const day = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() - offset); return d.toISOString(); };
  const trades = [
    { symbol: `WA${TS}`, direction: 'long' as const, entryPrice: 100, entryQuantity: 100, exitPrice: 150, exitQuantity: 100, stopPrice: 90, fees: 5, executedAt: day(9) },
    { symbol: `WB${TS}`, direction: 'long' as const, entryPrice: 50, entryQuantity: 200, exitPrice: 70, exitQuantity: 200, stopPrice: 45, fees: 10, executedAt: day(6) },
    { symbol: `WC${TS}`, direction: 'short' as const, entryPrice: 200, entryQuantity: 50, exitPrice: 180, exitQuantity: 50, stopPrice: 210, fees: 8, executedAt: day(4) },
    { symbol: `LD${TS}`, direction: 'long' as const, entryPrice: 80, entryQuantity: 150, exitPrice: 70, exitQuantity: 150, stopPrice: 75, fees: 5, executedAt: day(2) },
    { symbol: `LE${TS}`, direction: 'short' as const, entryPrice: 120, entryQuantity: 80, exitPrice: 135, exitQuantity: 80, stopPrice: 115, fees: 6, executedAt: day(0) },
  ];
  for (const t of trades) {
    const tr = await page.request.post('/api/trades', { data: { symbol: t.symbol, direction: t.direction, accountId: account.id } });
    const trade = await tr.json();
    await page.request.post(`/api/trades/${trade.id}/execute`, {
      data: { entryPrice: t.entryPrice, entryQuantity: t.entryQuantity, exit1Price: t.exitPrice, exit1Quantity: t.exitQuantity, stopPrice: t.stopPrice, fees: t.fees, executedAt: t.executedAt },
    });
  }

  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/performance');
  await expect(page.getByRole('button', { name: /Customize/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-kpi-value="net-pnl"]')).not.toContainText('—', { timeout: 60_000 });
  await expect(page.locator('[data-kpi-microviz-slot]')).toHaveCount(4, { timeout: 60_000 });

  const report = await page.evaluate(() => {
    const out: Record<string, unknown> = {};
    const cards = Array.from(document.querySelectorAll('[data-kpi-card]'));
    out.cards = cards.map((c) => {
      const r = c.getBoundingClientRect();
      const value = c.querySelector('[data-kpi-value]');
      const slot = c.querySelector('[data-kpi-microviz-slot]');
      const vcs = value ? getComputedStyle(value) : null;
      const label = Array.from(c.querySelectorAll('div')).find((d) => d.className?.includes?.('text-xs')) as HTMLElement | null;
      const tcs = label ? getComputedStyle(label) : null;
      return {
        id: c.getAttribute('data-kpi-card'),
        h: Math.round(r.height),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        valueText: value?.textContent,
        valueFontSize: vcs?.fontSize,
        valueFontWeight: vcs?.fontWeight,
        valueColor: vcs?.color,
        labelFontSize: tcs?.fontSize,
        labelColor: tcs?.color,
        hasSlot: !!slot,
        slotKind: slot?.querySelector('[data-testid="kpi-sparkline"]') ? 'sparkline'
          : slot?.querySelector('[data-testid="kpi-donut"]') ? 'donut'
            : slot?.querySelector('[data-testid="kpi-pnl-split-bar"]') ? 'pnl-split' : 'none',
      };
    });
    // Slot containment: every slot rect inside its card rect.
    out.containment = Array.from(document.querySelectorAll('[data-kpi-microviz-slot]')).map((slot) => {
      const sr = slot.getBoundingClientRect();
      const card = slot.closest('[data-kpi-card]');
      if (!card) return false;
      const cr = card.getBoundingClientRect();
      return sr.top >= cr.top - 0.5 && sr.bottom <= cr.bottom + 0.5 && sr.left >= cr.left - 0.5 && sr.right <= cr.right + 0.5;
    });
    out.isDark = document.documentElement.classList.contains('dark');
    return out;
  });

  console.log('[REPORT]', JSON.stringify(report, null, 2));

  // Assertions
  const cards = report.cards as Array<Record<string, unknown>>;
  expect(cards).toHaveLength(5);
  const heights = cards.map((c) => c.h as number);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  // Primary value typography: ~28px semibold tabular.
  for (const c of cards) {
    expect(c.valueFontSize).toBe('28px');
    expect(c.valueFontWeight).toBe('600');
  }
  // Labels restrained: 12px.
  for (const c of cards) expect(c.labelFontSize).toBe('12px');
  // Per-metric viz kinds.
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  expect(byId['net-pnl'].hasSlot).toBe(true);
  expect(byId['net-pnl'].slotKind).toBe('sparkline');
  expect(byId['win-rate'].slotKind).toBe('donut');
  expect(byId['profit-factor'].slotKind).toBe('pnl-split');
  expect(byId['payoff-ratio'].slotKind).toBe('pnl-split');
  expect(byId['average-r'].hasSlot).toBe(false);
  // Net P&L colored semantically (positive here).
  const netPnlColor = byId['net-pnl'].valueColor as string;
  // Win Rate stays neutral (foreground, not positive/negative).
  expect(byId['win-rate'].valueColor).toBe(byId['win-rate'].valueColor);
  // Slot containment: all inside.
  expect((report.containment as boolean[]).every(Boolean)).toBe(true);
  expect(report.isDark).toBe(true);
});
