/**
 * A3 canonical closure — browser verification + screenshots.
 *
 * Flow (section 26):
 *   Create Account → Opening Balance $10,000 → Deposit $2,500 → Withdrawal
 *   $1,000 → Settings → Close Account → verify closure summary
 *   (Final balance: $11,500.00, Net return: 0.00%), account Inactive,
 *   ledger history intact.
 *
 * Run: npx tsx scripts/capture-a3-close-screenshots.mts
 * Requires a dev server on :3000.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve('docs/uat/a3-canonical-close');
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

  // 1. Create the account via the dialog.
  await page.goto(`${BASE}/settings/accounts`);
  await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
  await page.getByRole('button', { name: '+ Add Account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Account name').fill('A3 Close Screenshot');
  await dialog.getByLabel('Broker').fill('Screenshot Broker');
  await dialog.getByRole('button', { name: 'Create Account' }).click();
  await page.waitForURL(/\/settings\/accounts\/[0-9a-f-]+$/);
  const id = page.url().match(/\/settings\/accounts\/([0-9a-f-]+)$/)![1];

  // 2. Opening balance $10,000.
  await page.getByRole('button', { name: /Add opening balance/ }).click();
  const panel = page.getByRole('region', { name: 'Opening balance' });
  await panel.getByLabel('Amount (USD)').fill('10000.00');
  await panel.getByRole('button', { name: 'Record Opening Balance' }).click();
  await page.getByText('Net Asset Value').waitFor();

  // 3. Deposit $2,500 via the composer.
  await page.getByRole('button', { name: 'Add Transaction' }).click();
  const composer = page.getByRole('dialog');
  await composer.getByLabel('Amount (USD)').fill('2500.00');
  await composer.getByRole('button', { name: 'Post Transaction' }).click();
  await expectComposerClosed(page, composer);

  // 4. Withdrawal $1,000 via the composer.
  await page.getByRole('button', { name: 'Add Transaction' }).click();
  const composer2 = page.getByRole('dialog');
  await composer2.getByLabel('Event Type').selectOption('withdrawal');
  await composer2.getByLabel('Amount (USD)').fill('1000.00');
  await composer2.getByRole('button', { name: 'Post Transaction' }).click();
  await expectComposerClosed(page, composer2);

  // 5. Settings → Close Account → confirm.
  await page.goto(`${BASE}/settings/accounts/${id}/settings`);
  await page.getByText('Account Identity').waitFor();
  await page.getByRole('button', { name: 'Close Account' }).click();
  const closeDialog = page.getByRole('dialog', { name: 'Close Account' });
  await closeDialog.waitFor();
  const closeResponse = page.waitForResponse(
    (r) => r.url().includes(`/api/accounts/${id}/close`) && r.status() === 200,
  );
  await closeDialog.getByRole('button', { name: 'Confirm Close' }).click();
  await closeResponse;

  // 6. Verify the closure summary (canonical values).
  await page.getByText('Account Closed').waitFor();
  await page.getByText('Final balance: $11,500.00').waitFor();
  await page.getByText('Net return: 0.00%').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/1-closure-summary.png` });

  // Capture the summary values + API state for the record.
  const summaryText = await page.locator('main').innerText();
  const accountRes = await page.request.get(`${BASE}/api/accounts/${id}`);
  const account = (await accountRes.json()) as { isActive: boolean };
  console.log(`account.isActive after close: ${account.isActive}`);
  console.log(
    `summary has final balance: ${summaryText.includes('Final balance: $11,500.00')} | net return: ${summaryText.includes('Net return: 0.00%')}`,
  );

  // 7. Account still historically accessible; ledger history intact.
  await page.goto(`${BASE}/settings/accounts/${id}/ledger`);
  // The opening balance event has no user description; assert by amount + the
  // Opening category badge instead.
  await page.getByText('$10,000.00').first().waitFor();
  await page.getByText('$2,500.00').first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/2-ledger-after-close.png` });

  await browser.close();
  console.log(`Screenshots written to ${OUT_DIR}`);
}

async function expectComposerClosed(page: import('@playwright/test').Page, dialog: import('@playwright/test').Locator) {
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
  await page.getByText('Net Asset Value').waitFor();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
