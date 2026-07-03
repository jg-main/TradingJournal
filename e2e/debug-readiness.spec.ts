import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

test('debug: PUT app-profile then check readiness', async ({ page }) => {
  const DB_FILE = './.trading-journal/playwright-readiness.db';
  mkdirSync(dirname(resolve(DB_FILE)), { recursive: true });
  const db = new Database(resolve(DB_FILE));
  db.exec('DELETE FROM app_profile');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  // Step 1: Check readiness before
  const beforeResp = await page.request.get('/api/readiness');
  const before = await beforeResp.json();
  console.log('BEFORE readiness:', JSON.stringify(before));
  expect(before.ready).toBe(false);

  // Step 2: PUT app-profile via page.request
  const putResp = await page.request.put('/api/app-profile', {
    data: { displayName: 'Debug Trader', timezone: 'America/Bogota', defaultCurrency: 'USD' },
  });
  console.log('PUT status:', putResp.status(), 'body:', JSON.stringify(await putResp.json()));

  // Step 3: Check readiness after
  const afterResp = await page.request.get('/api/readiness');
  const after = await afterResp.json();
  console.log('AFTER readiness:', JSON.stringify(after));

  // Step 4: Navigate to settings and observe UI
  await page.goto('/settings', { waitUntil: 'networkidle' });
  const headingCount = await page.getByRole('heading', { name: 'Setup your journal' }).count();
  console.log('Checklist heading count:', headingCount);
  const setupLinkCount = await page.getByRole('link', { name: /^Setup / }).count();
  console.log('Setup link count:', setupLinkCount);
});
