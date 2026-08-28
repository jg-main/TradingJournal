import { test, expect } from '@playwright/test';

test('/checks renders the removed-surface contract (404)', async ({ page }) => {
  // M002 maintenance: the obsolete localStorage-backed legacy /checks page
  // was removed; GET /checks now 404s and the canonical checklist system is
  // DB-backed and rendered through the trade-execution flow.
  const res = await page.goto('/checks');
  expect(res?.status()).toBe(404);
});
