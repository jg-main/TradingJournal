/**
 * A1 USD-only currency contract — screenshot capture.
 *
 * Captures the four required evidence screenshots:
 * 1. Add Account dialog (no currency selector, read-only USD + helper copy)
 * 2. USD opening balance form
 * 3. USD ledger
 * 4. Legacy non-USD account (unsupported warning, workflow blocked)
 *
 * Run: npx tsx scripts/capture-a1-usd-screenshots.mts
 */
import { chromium } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve('docs/uat/a1-usd-currency');
const BASE = 'http://localhost:3000';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Seed a legacy EUR account directly (pre-contract fixture).
  const sqlite = new Database('./.trading-journal/journal.db');
  sqlite.pragma('journal_mode = WAL');
  const legacyId = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(legacyId, 'Legacy EUR Account', 'EUR Broker', 'EUR', now, now);
  sqlite.close();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const hideOverlay = (p: typeof page) =>
    p.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent =
        'nextjs-portal{display:none!important}[data-nextjs-dialog-overlay],[data-nextjs-dialog-content]{display:none!important}';
      document.head.appendChild(style);
    });
  await hideOverlay(page);

  // ── 1. Add Account dialog ─────────────────────────────────────────
  await page.goto(`${BASE}/settings/accounts`);
  await page.getByRole('heading', { name: 'Accounts', exact: true }).waitFor();
  await page.getByRole('button', { name: '+ Add Account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Add Account' }).waitFor();
  await page.waitForTimeout(400);
  await dialog.screenshot({ path: `${OUT_DIR}/1-add-account-dialog.png` });

  // Close the dialog
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached' });

  // ── 2. USD opening balance form ────────────────────────────────────
  // Reuse an existing USD draft account if present, else create one.
  const usdDb = new Database('./.trading-journal/journal.db');
  usdDb.pragma('journal_mode = WAL');
  let usdId = (
    usdDb.prepare("SELECT id FROM accounts WHERE currency = 'USD' AND is_active = 0 AND id NOT IN (SELECT account_id FROM financial_events) ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined
  )?.id;
  usdDb.close();
  if (!usdId) {
    const create = await page.request.post(`${BASE}/api/accounts`, {
      data: { name: `USD Screenshot ${Date.now()}`, broker: 'Broker' },
    });
    usdId = ((await create.json()) as { id: string }).id;
  }
  await page.goto(`${BASE}/settings/accounts/${usdId}`);
  await page.getByRole('button', { name: /Add opening balance/i }).waitFor();
  await page.getByRole('button', { name: /Add opening balance/i }).click();
  const panel = page.getByRole('region', { name: 'Opening balance' });
  await panel.waitFor();
  await page.waitForTimeout(300);
  await panel.screenshot({ path: `${OUT_DIR}/2-usd-opening-balance.png` });

  // ── 3. USD ledger (post a deposit to have data, then view ledger) ──
  const deposit = await page.request.post(`${BASE}/api/accounts/${usdId}/financial-events`, {
    data: { eventType: 'deposit', amount: '5000.00', description: 'Evidence deposit' },
  });
  if (deposit.status() === 201) {
    await page.goto(`${BASE}/settings/accounts/${usdId}/ledger`);
    await page.getByText(/No ledger events yet|Deposit/).first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT_DIR}/3-usd-ledger.png` });
  } else {
    // No ledger rows: still capture the empty ledger surface.
    await page.goto(`${BASE}/settings/accounts/${usdId}/ledger`);
    await page.getByText('No ledger events yet.').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT_DIR}/3-usd-ledger.png` });
  }

  // ── 4. Legacy EUR account (unsupported warning, workflow blocked) ──
  await page.goto(`${BASE}/settings/accounts/${legacyId}`);
  await page.getByText(/not currently supported for new activity/i).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/4-legacy-eur-unsupported.png` });

  // Also capture the ledger surface for the legacy account (readable history).
  await page.goto(`${BASE}/settings/accounts/${legacyId}/ledger`);
  await page.getByText('No ledger events yet.').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/5-legacy-eur-ledger-readable.png` });

  await browser.close();
  console.log(`Screenshots written to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
