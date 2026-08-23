/**
 * USD-only account currency contract — browser verification (A1).
 *
 * Verifies the enforced product boundary end-to-end:
 * 1. Add Account dialog offers no currency selector and shows USD + helper copy.
 * 2. POST /api/accounts rejects EUR (400) and accepts USD (201).
 * 3. A legacy EUR account (seeded directly into the DB, as pre-contract rows
 *    exist in real installations) remains historically readable, shows an
 *    unsupported-currency warning, and blocks opening-balance and transaction
 *    workflows from the UI.
 *
 * The legacy EUR row is inserted with raw SQL because the API now correctly
 * refuses to create it — mirroring installations that persisted EUR before
 * the USD-only contract existed.
 */

import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DB_FILE = process.env.DB_FILE_NAME ?? './.trading-journal/journal.db';

/** Apply all migrations so the accounts table exists in the run-owned DB. */
function applyAllMigrations(sqlite: Database.Database): void {
  const migrationsDir = join(process.cwd(), 'src/db/migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
    .sort();
  for (const file of migrations) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed.length > 0) {
        try {
          sqlite.exec(trimmed);
        } catch {
          // dependency ordering between migrations — safe to skip
        }
      }
    }
  }
}

/** Insert a legacy EUR account row directly (pre-contract fixture). */
function seedLegacyEurAccount(sqlite: Database.Database): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, broker, currency, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(id, 'Legacy EUR Account', 'EUR Broker', 'EUR', now, now);
  return id;
}

test.describe('USD-only account currency contract', () => {
  test.describe.configure({ mode: 'serial' });

  let legacyEurAccountId: string;

  test.beforeAll(() => {
    const sqlite = new Database(resolve(DB_FILE));
    sqlite.pragma('journal_mode = WAL');
    applyAllMigrations(sqlite);
    legacyEurAccountId = seedLegacyEurAccount(sqlite);
    sqlite.close();
  });

  test('Add Account dialog offers no currency choices and displays USD with helper copy', async ({ page }) => {
    await page.goto('/settings/accounts');
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '+ Add Account' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add Account' })).toBeVisible();

    // Base currency is a read-only USD field — no combobox/options.
    await expect(dialog.getByText('Base currency')).toBeVisible();
    await expect(dialog.getByText('USD', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Base currency' })).toHaveCount(0);
    await expect(
      dialog.getByText(/currently supports USD account accounting only/),
    ).toBeVisible();

    // The form otherwise keeps Name, Broker, and the make-default option.
    await expect(dialog.getByLabel('Account name')).toBeVisible();
    await expect(dialog.getByLabel('Broker')).toBeVisible();
    await expect(
      dialog.getByRole('checkbox', { name: /Make this my default account/ }),
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('POST /api/accounts accepts USD and rejects EUR/GBP with 400', async ({ page }) => {
    // USD → 201
    const usdRes = await page.request.post('/api/accounts', {
      data: { name: `USD Only ${Date.now()}`, currency: 'USD' },
    });
    expect(usdRes.status()).toBe(201);
    expect(((await usdRes.json()) as { currency: string }).currency).toBe('USD');

    // Omitted currency → 201, defaults to USD
    const omittedRes = await page.request.post('/api/accounts', {
      data: { name: `Omitted ${Date.now()}` },
    });
    expect(omittedRes.status()).toBe(201);
    expect(((await omittedRes.json()) as { currency: string }).currency).toBe('USD');

    // EUR → 400, never silently coerced
    const eurRes = await page.request.post('/api/accounts', {
      data: { name: `EUR Reject ${Date.now()}`, currency: 'EUR' },
    });
    expect(eurRes.status()).toBe(400);
    expect(((await eurRes.json()) as { error: string }).error).toBe('Validation failed');

    // GBP → 400
    const gbpRes = await page.request.post('/api/accounts', {
      data: { name: `GBP Reject ${Date.now()}`, currency: 'GBP' },
    });
    expect(gbpRes.status()).toBe(400);
  });

  test('legacy EUR account is preserved, readable, and blocks new financial activity', async ({ page }) => {
    // The Overview tab lives at the account base path (no /overview segment).
    await page.goto(`/settings/accounts/${legacyEurAccountId}`);

    // The actual EUR identity remains visible (never relabeled as USD)…
    // Scoped to the heading: the sidebar selector can also show the name when
    // this fixture is the provider's selected account.
    await expect(page.getByRole('heading', { name: 'Legacy EUR Account' })).toBeVisible();
    // …and the unsupported-currency warning is shown.
    await expect(
      page.getByText(/EUR account — not currently supported for new activity/i),
    ).toBeVisible();
    await expect(
      page.getByText(/currently supports USD account accounting only/i),
    ).toBeVisible();

    // The workflow is blocked at the UI: no Add Transaction button, no
    // opening-balance initialization paths.
    await expect(page.getByRole('button', { name: /Add Transaction/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Add opening balance/i })).toHaveCount(0);

    // Historical records remain readable on the Ledger tab (empty for this
    // fixture, but the surface must still render without error).
    await page.goto(`/settings/accounts/${legacyEurAccountId}/ledger`);
    await expect(page.getByText('No ledger events yet.')).toBeVisible();
  });

  test('financial events API rejects posting to a legacy EUR account with zero ledger mutation', async ({ page }) => {
    const res = await page.request.post(
      `/api/accounts/${legacyEurAccountId}/financial-events`,
      { data: { eventType: 'deposit', amount: '100.00' } },
    );
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Unsupported account currency');
    expect(body.error).toContain('USD');

    // No ledger entry or posting was created.
    const ledgerRes = await page.request.get(`/api/accounts/${legacyEurAccountId}/ledger`);
    expect(ledgerRes.status()).toBe(200);
    const ledger = (await ledgerRes.json()) as { total: number };
    expect(ledger.total).toBe(0);
  });

  test('opening balance is initialization-only: the generic route rejects it with 409 (A2)', async ({ page }) => {
    // Even for a pristine USD account, opening_balance cannot be posted through
    // the generic financial-event route — it must go through /initialize, which
    // posts the event AND activates the account in one transaction.
    const create = await page.request.post('/api/accounts', {
      data: { name: `USD Init Guard ${Date.now()}`, broker: 'E2E', currency: 'USD' },
    });
    expect(create.status()).toBe(201);
    const account = (await create.json()) as { id: string };

    const res = await page.request.post(`/api/accounts/${account.id}/financial-events`, {
      data: { eventType: 'opening_balance', amount: '100.00' },
    });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Opening balance must be recorded');

    // Nothing was created and the account is still a draft.
    const events = await (await page.request.get(`/api/accounts/${account.id}/financial-events`)).json() as { total: number };
    expect(events.total).toBe(0);
    const accountAfter = (await (await page.request.get(`/api/accounts/${account.id}`)).json()) as { isActive: boolean };
    expect(accountAfter.isActive).toBe(false);
  });

  test('executions API rejects posting to a legacy EUR account', async ({ page }) => {
    const res = await page.request.post(
      `/api/accounts/${legacyEurAccountId}/executions`,
      {
        data: {
          symbol: 'MSFT',
          action: 'buy',
          quantity: '5.00',
          price: '200.00',
          fees: '0.00',
        },
      },
    );
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Unsupported account currency');
  });
});
