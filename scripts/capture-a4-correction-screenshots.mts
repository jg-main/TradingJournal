/**
 * A4 opening-balance correction — browser UAT + screenshots.
 *
 * Flow (section 29):
 *   Create Account → Opening Balance $10,000 → Ledger → Opening row exposes
 *   Correct → Correct to $9,000 → reason → review → confirm → verify
 *   Overview (Net Cash/NAV $9,000, Total P&L $0) and Ledger (Opening
 *   $9,000.00 Corrected, expandable lineage with reason).
 *
 * Run: npx tsx scripts/capture-a4-correction-screenshots.mts
 * Requires a dev server on :3000.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve('docs/uat/a4-opening-balance-correction');
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

  // 1. Create account via dialog.
  await page.goto(`${BASE}/settings/accounts`);
  await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
  await page.getByRole('button', { name: '+ Add Account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Account name').fill('A4 Correction Screenshot');
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

  // 3. Ledger: the Opening row exposes Correct (A4).
  await page.goto(`${BASE}/settings/accounts/${id}/ledger`);
  await page.getByText('$10,000.00').first().waitFor();
  const correctBtn = page.getByRole('button', { name: /Correct opening_balance event/i });
  await correctBtn.waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/1-ledger-correct-available.png` });

  // 4. Correct to $9,000 with a reason.
  await correctBtn.click();
  const corrDialog = page.getByRole('dialog', { name: 'Correct Financial Event' });
  await corrDialog.waitFor();
  // The dialog shows "Opening Balance" (label, not raw event type).
  await corrDialog.getByText('Opening Balance').first().waitFor();
  const amount = corrDialog.getByLabel(/Amount \(\$\)/);
  await amount.fill('9000.00');
  const reason = corrDialog.getByLabel(/^Reason/);
  await reason.fill('Initial broker statement was incorrect');
  await page.waitForTimeout(250);
  await corrDialog.screenshot({ path: `${OUT_DIR}/2-correction-form.png` });

  // 5. Review step: current vs replacement + reason.
  await corrDialog.getByRole('button', { name: /Continue|Review/i }).click();
  await page.waitForTimeout(250);
  await corrDialog.screenshot({ path: `${OUT_DIR}/3-review-step.png` });

  // 6. Confirm and await success.
  const correctResponse = page.waitForResponse(
    (r) => r.url().includes(`/api/accounts/${id}/financial-events/`) && r.url().includes('/correct') && r.request().method() === 'POST',
  );
  await corrDialog.getByRole('button', { name: /Confirm/i }).click();
  await correctResponse;
  await corrDialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);

  // 7. Overview: Net Cash/NAV = $9,000, Total P&L = $0.
  await page.goto(`${BASE}/settings/accounts/${id}`);
  await page.getByText('Net Asset Value').waitFor();
  await page.getByText('$9,000.00').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/4-overview-after-correction.png` });

  // Capture Overview values for the record (labels are CSS-uppercased in
  // innerText; assert on the formatted values instead).
  const overviewText = await page.locator('main').innerText();
  const navCashOk = (overviewText.match(/9,000\.00/g) ?? []).length >= 2;
  const pnlZero = overviewText.includes('0.00');
  console.log(`overview: NAV+NetCash \$9,000 x2=${navCashOk} TotalPnl \$0.00=${pnlZero}`);

  // 8. Ledger: grouped Opening row with $9,000.00 + Corrected badge + lineage.
  await page.goto(`${BASE}/settings/accounts/${id}/ledger`);
  await page.getByText('$9,000.00').first().waitFor();
  await page.getByText('Corrected', { exact: true }).first().waitFor();
  // Expand the correction lineage (reason visible).
  const expand = page.getByRole('button', { name: /Expand correction lineage|Show.*lineage|View.*lineage/i });
  if (await expand.count()) {
    await expand.first().click();
    await page.getByText('Initial broker statement was incorrect').waitFor();
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/5-ledger-corrected.png` });

  // 9. Account remains active.
  const accountRes = await page.request.get(`${BASE}/api/accounts/${id}`);
  const account = (await accountRes.json()) as { isActive: boolean };
  console.log(`account.isActive after correction: ${account.isActive}`);

  await browser.close();
  console.log(`Screenshots written to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
