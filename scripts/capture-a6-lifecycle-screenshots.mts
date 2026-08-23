/**
 * A6 inactive-accounts read-only — browser UAT + screenshots.
 *
 * Flow (section 23/24):
 *   Create → Initialize $10,000 → Deposit → Close Account → Overview shows
 *   historical data read-only (no Add Transaction, guidance to Reactivate) →
 *   Reactivate → Add Transaction available → Deposit $500 succeeds.
 *   Plus draft-state verification (no Add Transaction before initialization).
 *
 * Run: npx tsx scripts/capture-a6-lifecycle-screenshots.mts
 * Requires a dev server on :3000.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve('docs/uat/a6-inactive-readonly');
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

  async function createViaDialog(name: string): Promise<string> {
    await page.goto(`${BASE}/settings/accounts`);
    await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
    await page.getByRole('button', { name: '+ Add Account' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Account name').fill(name);
    await dialog.getByLabel('Broker').fill('Screenshot Broker');
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    await page.waitForURL(/\/settings\/accounts\/[0-9a-f-]+$/);
    return page.url().match(/\/settings\/accounts\/([0-9a-f-]+)$/)![1];
  }

  // ── 24. Draft state: no Add Transaction before initialization ─────────
  const draftId = await createViaDialog('A6 Draft Screenshot');
  await page.getByRole('heading', { name: /Set up A6 Draft Screenshot/ }).waitFor();
  await page.getByRole('button', { name: /Add opening balance/ }).waitFor();
  await page.getByRole('button', { name: /Start with zero/ }).waitFor();
  const draftAddTx = await page.getByRole('button', { name: 'Add Transaction' }).count();
  console.log(`draft: Add Transaction exposed=${draftAddTx > 0} (expect 0)`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/1-draft-no-add-transaction.png` });

  // ── 23. Historical inactive account ───────────────────────────────────
  const id = await createViaDialog('A6 Lifecycle Screenshot');

  // Initialize $10,000.
  await page.getByRole('button', { name: /Add opening balance/ }).click();
  const panel = page.getByRole('region', { name: 'Opening balance' });
  await panel.getByLabel('Amount (USD)').fill('10000.00');
  await panel.getByRole('button', { name: 'Record Opening Balance' }).click();
  await page.getByText('Net Asset Value').waitFor();

  // Deposit $2,000.
  await page.getByRole('button', { name: 'Add Transaction' }).click();
  const composer = page.getByRole('dialog');
  await composer.getByLabel('Amount (USD)').fill('2000.00');
  await composer.getByRole('button', { name: 'Post Transaction' }).click();
  await composer.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);

  // Close the account via Settings.
  await page.goto(`${BASE}/settings/accounts/${id}/settings`);
  await page.getByText('Account Identity').waitFor();
  await page.getByRole('button', { name: 'Close Account' }).click();
  const closeDialog = page.getByRole('dialog', { name: 'Close Account' });
  await closeDialog.getByRole('button', { name: 'Confirm Close' }).click();
  await closeDialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);

  // Overview: read-only historical view.
  await page.goto(`${BASE}/settings/accounts/${id}`);
  await page.getByText('Net Asset Value').waitFor();
  await page.getByText(/Inactive account\./).waitFor();
  const addTxAfterClose = await page.getByRole('button', { name: 'Add Transaction' }).count();
  const navVisible = await page.getByText('Net Cash').count();
  console.log(`inactive overview: Add Transaction=${addTxAfterClose} (expect 0), NetCash rows=${navVisible}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/2-inactive-overview-readonly.png` });

  // Ledger still accessible.
  await page.goto(`${BASE}/settings/accounts/${id}/ledger`);
  await page.getByText('$10,000.00').first().waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/3-inactive-ledger-readable.png` });

  // Direct API: new deposit rejected with 409 ACCOUNT_INACTIVE.
  const rejectRes = await page.request.post(`${BASE}/api/accounts/${id}/financial-events`, {
    data: { eventType: 'deposit', amount: '500.00' },
  });
  const rejectBody = (await rejectRes.json()) as { code?: string };
  console.log(`direct deposit on inactive: status=${rejectRes.status()} code=${rejectBody.code}`);

  // Reactivate from Settings.
  await page.goto(`${BASE}/settings/accounts/${id}/settings`);
  await page.getByText('Account Identity').waitFor();
  await page.getByRole('button', { name: /Reactivate Account/ }).click();
  await page.waitForTimeout(400);

  // Overview: Add Transaction is back.
  await page.goto(`${BASE}/settings/accounts/${id}`);
  await page.getByRole('button', { name: 'Add Transaction' }).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/4-reactivated-add-transaction.png` });

  // Deposit $500 succeeds.
  await page.getByRole('button', { name: 'Add Transaction' }).click();
  const composer2 = page.getByRole('dialog');
  await composer2.getByLabel('Amount (USD)').fill('500.00');
  await composer2.getByRole('button', { name: 'Post Transaction' }).click();
  await composer2.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
  await page.getByText('$12,500.00').first().waitFor();
  console.log('post-reactivation deposit: succeeded (Net Cash $12,500.00)');

  await browser.close();
  console.log(`Screenshots written to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
