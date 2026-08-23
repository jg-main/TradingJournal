/**
 * A8 default-account eligibility — browser UAT + screenshots.
 *
 * Flow:
 *   1. Add Account dialog has NO make-default checkbox.
 *   2. Initialize an account → Settings shows "Make Default" → click →
 *      "Default" badge; the saved default is set.
 *   3. A draft account's Settings shows initialization guidance (no action).
 *   4. Direct PUT /api/settings with a draft default → 409.
 *
 * Run: npx tsx scripts/capture-a8-default-screenshots.mts
 * Requires a dev server on :3000.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve('docs/uat/a8-default-eligibility');
const BASE = 'http://localhost:3000';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent =
      'nextjs-portal{display:none!important}[data-nextjs-dialog-overlay],[data-nextjs-dialog-content]{display:none!important}';
    document.head.appendChild(style);
  });

  // 1. Add Account dialog: no default checkbox.
  await page.goto(`${BASE}/settings/accounts`);
  await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
  await page.getByRole('button', { name: '+ Add Account' }).click();
  const dialog = page.getByRole('dialog');
  const checkboxCount = await dialog
    .getByRole('checkbox', { name: /Make this my default account/ })
    .count();
  console.log(`add-account dialog: default checkbox present=${checkboxCount > 0} (expect 0)`);
  await page.waitForTimeout(250);
  await dialog.screenshot({ path: `${OUT_DIR}/1-add-account-no-default-checkbox.png` });
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // 2. Create + initialize + Make Default from Settings.
  await page.getByRole('button', { name: '+ Add Account' }).click();
  const d2 = page.getByRole('dialog');
  await d2.getByLabel('Account name').fill('A8 Default Screenshot');
  await d2.getByLabel('Broker').fill('Screenshot Broker');
  await d2.getByRole('button', { name: 'Create Account' }).click();
  await page.waitForURL(/\/settings\/accounts\/[0-9a-f-]+$/);
  const id = page.url().match(/\/settings\/accounts\/([0-9a-f-]+)$/)![1];

  // Draft Settings: guidance, no Make Default.
  await page.goto(`${BASE}/settings/accounts/${id}/settings`);
  await page.getByText('Account Identity').waitFor();
  await page.getByText(/Initialize this account.*before making it the default/).waitFor();
  const draftMakeDefault = await page.getByRole('button', { name: /Make Default/ }).count();
  console.log(`draft settings: Make Default offered=${draftMakeDefault > 0} (expect 0)`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT_DIR}/2-draft-settings-guidance.png` });

  // Direct PUT with a draft default must be rejected.
  const rejectRes = await page.request.put(`${BASE}/api/settings`, {
    data: { defaultAccountId: id },
  });
  console.log(`PUT default=draft: status=${rejectRes.status()} (expect 409)`);

  // Initialize, then Make Default from Settings.
  await page.goto(`${BASE}/settings/accounts/${id}`);
  await page.getByRole('button', { name: /Add opening balance/ }).click();
  const panel = page.getByRole('region', { name: 'Opening balance' });
  await panel.getByLabel('Amount (USD)').fill('10000.00');
  await panel.getByRole('button', { name: 'Record Opening Balance' }).click();
  await page.getByText('Net Asset Value').waitFor();

  await page.goto(`${BASE}/settings/accounts/${id}/settings`);
  await page.getByRole('button', { name: /Make Default/ }).waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/3-active-settings-make-default.png` });

  await page.getByRole('button', { name: /Make Default/ }).click();
  await page.getByText('Default', { exact: true }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/4-default-badge.png` });

  const settingsRes = await page.request.get(`${BASE}/api/settings`);
  const settings = (await settingsRes.json()) as { defaultAccountId: string };
  console.log(`saved default after Make Default = ${settings.defaultAccountId === id}`);

  await browser.close();
  console.log(`Screenshots written to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
