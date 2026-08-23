/**
 * A2 opening-balance-initialization screenshot capture.
 *
 * Captures the four required evidence screenshots:
 * 1. Draft initialization screen (Set up <account> with both paths)
 * 2. Opening balance entry (Amount (USD) form)
 * 3. Active Overview immediately after posting (NAV/Cash = amount, Active)
 * 4. Ledger showing the opening balance
 *
 * Run: npx tsx scripts/capture-a2-initialization-screenshots.mts
 * Requires a dev server on :3000 with a fresh DB.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve('docs/uat/a2-opening-balance-initialization');
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

  // ── 1. Draft initialization screen ───────────────────────────────────
  const create = await page.request.post(`${BASE}/api/accounts`, {
    data: { name: 'A2 Init Screenshot', broker: 'Screenshot Broker', currency: 'USD' },
  });
  expect201(create.status());
  const account = (await create.json()) as { id: string; name: string };

  await page.goto(`${BASE}/settings/accounts/${account.id}`);
  await page.getByRole('heading', { name: `Set up ${account.name}` }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/1-draft-initialization.png` });

  // ── 2. Opening balance entry ─────────────────────────────────────────
  await page.getByRole('button', { name: /Add opening balance/ }).click();
  const panel = page.getByRole('region', { name: 'Opening balance' });
  await panel.waitFor();
  await panel.getByLabel('Amount (USD)').fill('10000.00');
  await panel.getByLabel('Description (optional)').fill('Cash from previous broker');
  await page.waitForTimeout(300);
  await panel.screenshot({ path: `${OUT_DIR}/2-opening-balance-entry.png` });

  // ── 3. Active Overview immediately after posting ─────────────────────
  const initResponse = page.waitForResponse(
    (r) => r.url().includes(`/api/accounts/${account.id}/initialize`) && r.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Record Opening Balance' }).click();
  expect201((await initResponse).status());

  // Wait for the live overview: NAV + Net Cash = $10,000.00 and the active
  // header (no Inactive badge).
  await page.getByText('Net Asset Value').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT_DIR}/3-active-overview.png` });

  // Confirm state via API for the record.
  const accountRes = await page.request.get(`${BASE}/api/accounts/${account.id}`);
  const accountState = (await accountRes.json()) as { isActive: boolean; nav: number | null; netCash: number | null };
  console.log(
    `init result: isActive=${accountState.isActive} nav=${accountState.nav} netCash=${accountState.netCash}`,
  );

  // ── 4. Ledger showing the opening balance ────────────────────────────
  await page.goto(`${BASE}/settings/accounts/${account.id}/ledger`);
  // The ledger row shows the description (not the event type label), plus the
  // Opening category badge and the $10,000.00 cash impact.
  await page.getByText('Cash from previous broker').first().waitFor();
  await page.getByText('$10,000.00').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/4-ledger-opening-balance.png` });

  await browser.close();
  console.log(`Screenshots written to ${OUT_DIR}`);
}

function expect201(status: number): void {
  if (status !== 201) throw new Error(`Expected 201, got ${status}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
