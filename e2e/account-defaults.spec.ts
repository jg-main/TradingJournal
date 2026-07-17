import { expect, test, type Page } from '@playwright/test';

async function createActiveInheritedAccount(page: Page, name: string) {
  const createResponse = await page.request.post('/api/accounts', {
    data: { name, broker: 'Defaults E2E Broker', currency: 'USD' },
  });
  expect(createResponse.status()).toBe(201);
  const account = (await createResponse.json()) as { id: string; name: string };

  const configureResponse = await page.request.put(`/api/accounts/${account.id}`, {
    data: {
      maxRiskPerTradePct: 2,
      defaultCommission: 1,
    },
  });
  expect(configureResponse.status()).toBe(200);

  const activateResponse = await page.request.put(`/api/accounts/${account.id}`, {
    data: { isActive: true },
  });
  expect(activateResponse.status()).toBe(200);

  const inheritResponse = await page.request.put(`/api/accounts/${account.id}`, {
    data: { maxRiskPerTradePct: null, defaultCommission: null },
  });
  expect(inheritResponse.status()).toBe(200);

  return account;
}

function captureDiagnostics(page: Page) {
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  return { pageErrors, failedResponses };
}

test('owns the default account and preserves truthful defaults through reload, reset, and failed saves', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One browser owns the shared local settings row for this persistence journey.');

  const diagnostics = captureDiagnostics(page);
  const account = await createActiveInheritedAccount(page, `Account Defaults ${Date.now()}`);

  const globalSettingsResponse = await page.request.put('/api/settings', {
    data: { maxRiskPerTradePct: 1.25, defaultCommission: 0 },
  });
  expect(globalSettingsResponse.ok()).toBeTruthy();

  await page.goto('/accounts');
  const defaultAccount = page.getByLabel('Account used by default');
  await expect(defaultAccount).toBeVisible();

  await defaultAccount.selectOption(account.id);
  await expect(page.getByRole('status').filter({ hasText: 'Selection not saved.' })).toBeVisible();

  const defaultSaveResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/settings') &&
      response.request().method() === 'PUT' && response.ok(),
  );
  await page.getByRole('button', { name: 'Save default' }).click();
  await defaultSaveResponse;
  await expect(page.getByRole('status').filter({ hasText: 'Default account saved.' })).toBeVisible();

  const accountRow = page.getByRole('row').filter({ hasText: account.name });
  await expect(accountRow.getByText('Default', { exact: true })).toBeVisible();

  await page.reload();
  await expect(defaultAccount).toHaveValue(account.id);
  await expect(page.getByText(`Saved default: ${account.name}`)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: account.name }).getByText('Default', { exact: true })).toBeVisible();

  await page.route('**/api/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Default save unavailable', details: 'Simulated settings failure' }),
      });
      return;
    }
    await route.fallback();
  });

  await defaultAccount.selectOption('');
  await page.getByRole('button', { name: 'Save default' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Default save unavailable' })).toBeVisible();
  await expect(defaultAccount).toHaveValue('');
  await expect(page.getByText(`Saved default: ${account.name}`)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: account.name }).getByText('Default', { exact: true })).toBeVisible();
  await page.unroute('**/api/settings');

  await page.goto(`/accounts/${account.id}/settings`);
  const maxRiskStatus = page.getByRole('status', { name: 'Effective max risk per trade' });
  const commissionStatus = page.getByRole('status', { name: 'Effective default commission' });
  await expect(maxRiskStatus).toContainText('Inherited');
  await expect(maxRiskStatus).toContainText('1.25%');
  await expect(commissionStatus).toContainText('Inherited');
  await expect(commissionStatus).toContainText('$0.00');

  const maxRiskInput = page.getByLabel('Max Risk Per Trade (%)');
  await maxRiskInput.fill('3.5');
  await expect(maxRiskStatus).toContainText('Inherited');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Settings saved successfully.' })).toBeVisible();
  await expect(maxRiskStatus).toContainText('Overridden');
  await expect(maxRiskStatus).toContainText('3.5%');

  await page.reload();
  await expect(maxRiskInput).toHaveValue('3.5');
  await expect(maxRiskStatus).toContainText('Overridden');

  await page.getByRole('button', { name: 'Reset max risk to global default' }).click();
  await expect(maxRiskInput).toHaveValue('');
  await expect(maxRiskStatus).toContainText('Overridden');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(maxRiskStatus).toContainText('Inherited');
  await expect(maxRiskStatus).toContainText('1.25%');

  await page.reload();
  await expect(maxRiskInput).toHaveValue('');
  await expect(maxRiskStatus).toContainText('Inherited');

  await page.route(`**/api/accounts/${account.id}`, async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Account save unavailable', details: 'Simulated account failure' }),
      });
      return;
    }
    await route.fallback();
  });

  await maxRiskInput.fill('4.5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Account save unavailable' })).toBeVisible();
  await expect(maxRiskInput).toHaveValue('4.5');
  await expect(maxRiskStatus).toContainText('Inherited');
  await expect(maxRiskStatus).toContainText('1.25%');

  const unexpectedPageErrors = diagnostics.pageErrors.filter(
    (error) => !error.includes('[turbopack]') && !error.includes('Failed to load chunk'),
  );
  expect(unexpectedPageErrors).toEqual([]);

  const unexpectedFailures = diagnostics.failedResponses.filter(
    (failure) => !failure.includes('503 PUT') && !failure.includes('favicon') && !failure.includes('__next'),
  );
  expect(unexpectedFailures).toEqual([]);
});
