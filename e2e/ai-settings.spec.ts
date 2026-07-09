import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import * as schema from '@/db/schema';

const DB_FILE = process.env.DB_FILE_NAME ?? './.trading-journal/journal.db';

function wipeAiSettings() {
  mkdirSync(dirname(resolve(DB_FILE)), { recursive: true });
  const sqlite = new Database(resolve(DB_FILE));
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('src/db/migrations') });

  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(`DELETE FROM ai_settings;`);
  sqlite.pragma('wal_checkpoint(TRUNCATE)');
  sqlite.close();
}

// UI-only tests (no DB writes) run in parallel safely
test.describe('AI Settings — UI', () => {
  test.beforeEach(() => {
    wipeAiSettings();
  });

  test('page renders with heading, back link, and default openai form', async ({ page }) => {
    await page.goto('/settings/ai');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toContainText('AI Settings');
    await expect(page.getByRole('link', { name: /back to settings/i })).toBeVisible();

    // Default provider is OpenAI
    await expect(page.locator('#provider')).toHaveValue('openai');
    await expect(page.locator('#model')).toHaveValue('gpt-4');
    await expect(page.locator('#apiKey')).toHaveValue('');
    // API key field must be password type (redaction constraint)
    await expect(page.locator('#apiKey')).toHaveAttribute('type', 'password');
    // Timeout default
    await expect(page.locator('#timeoutMs')).toHaveValue('30000');
    // isActive toggle defaults to true
    const toggle = page.getByRole('switch', { name: /toggle ai provider/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    // Save button present
    await expect(page.getByRole('button', { name: /save ai settings/i })).toBeVisible();
    // Endpoint URL should NOT be visible for openai
    await expect(page.locator('#baseUrl')).not.toBeVisible();
  });

  test('switching provider to ollama shows endpoint URL field', async ({ page }) => {
    await page.goto('/settings/ai');
    await page.waitForLoadState('networkidle');

    // Endpoint URL should be hidden initially (openai default)
    await expect(page.locator('#baseUrl')).not.toBeVisible();

    // Switch to ollama
    await page.locator('#provider').selectOption('ollama');

    // Endpoint URL should now be visible with default value
    await expect(page.locator('#baseUrl')).toBeVisible();
    await expect(page.locator('#baseUrl')).toHaveValue('http://localhost:11434/v1');

    // Switching to custom shows the field too
    await page.locator('#provider').selectOption('custom');
    await expect(page.locator('#baseUrl')).toBeVisible();
    await expect(page.locator('#baseUrl')).toHaveValue('');

    // Switching to anthropic hides it again
    await page.locator('#provider').selectOption('anthropic');
    await expect(page.locator('#baseUrl')).not.toBeVisible();
  });

  test('isActive toggle can be toggled on and off', async ({ page }) => {
    await page.goto('/settings/ai');
    await page.waitForLoadState('networkidle');

    const toggle = page.getByRole('switch', { name: /toggle ai provider/i });

    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  test('API key visibility toggle works', async ({ page }) => {
    await page.goto('/settings/ai');
    await page.waitForLoadState('networkidle');

    const apiKeyInput = page.locator('#apiKey');

    await expect(apiKeyInput).toHaveAttribute('type', 'password');

    await apiKeyInput.fill('sk-test-key-12345');
    await expect(apiKeyInput).toHaveValue('sk-test-key-12345');

    const showButton = page.getByRole('button', { name: /show api key/i });
    await showButton.click();

    await expect(apiKeyInput).toHaveAttribute('type', 'text');
    await expect(apiKeyInput).toHaveValue('sk-test-key-12345');

    const hideButton = page.getByRole('button', { name: /hide api key/i });
    await hideButton.click();

    await expect(apiKeyInput).toHaveAttribute('type', 'password');
  });
});

// Form submission tests must be serial because they all write to the shared
// ai_settings row in SQLite (single-row table). Parallel workers would
// overwrite each other's data.
test.describe('AI Settings — Save and Persist', () => {
  test.describe.configure({ mode: 'serial' });

  test('fills form, submits, and shows success feedback', async ({ page }) => {
    wipeAiSettings();

    await page.goto('/settings/ai');
    await page.waitForLoadState('networkidle');

    // Fill in the form
    await page.locator('#provider').selectOption('ollama');
    await page.locator('#apiKey').fill('sk-olama-test');
    await page.locator('#model').fill('llama3.1:8b');
    await page.locator('#timeoutMs').fill('60000');
    await page.locator('#maxTokens').fill('2048');
    await page.locator('#systemPrompt').fill('You are a helpful trading assistant.');

    // Toggle isActive off and on
    const toggle = page.getByRole('switch', { name: /toggle ai provider/i });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Submit the form
    const saveButton = page.getByRole('button', { name: /save ai settings/i });
    await saveButton.click();

    // Verify success message appears
    const successMsg = page.locator('text=AI settings saved');
    await expect(successMsg).toBeVisible({ timeout: 5000 });

    // Verify data was persisted via the API directly
    const resp = await page.request.get('/api/ai-settings');
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();

    expect(data.provider).toBe('ollama');
    expect(data.model).toBe('llama3.1:8b');
    expect(data.timeoutMs).toBe(60000);
    expect(data.maxTokens).toBe(2048);
    expect(data.isActive).toBe(false);
    // apiKey must be absent from GET response (redaction constraint)
    expect(data).not.toHaveProperty('apiKey');
  });

  test('submits without apiKey for ollama and persists isActive toggle', async ({ page }) => {
    wipeAiSettings();

    await page.goto('/settings/ai');
    await page.waitForLoadState('networkidle');

    // Use ollama (no API key needed)
    await page.locator('#provider').selectOption('ollama');
    await page.locator('#model').fill('qwen2.5-coder:7b');
    await page.locator('#timeoutMs').fill('45000');

    // Toggle off
    const toggle = page.getByRole('switch', { name: /toggle ai provider/i });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Submit
    await page.getByRole('button', { name: /save ai settings/i }).click();

    // Verify success message
    await expect(page.locator('text=AI settings saved')).toBeVisible({ timeout: 5000 });

    // Verify via API that settings were persisted
    const resp = await page.request.get('/api/ai-settings');
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();

    expect(data.provider).toBe('ollama');
    expect(data.model).toBe('qwen2.5-coder:7b');
    expect(data.timeoutMs).toBe(45000);
    expect(data.isActive).toBe(false);
    // apiKey not sent, so it should be absent from response
    expect(data).not.toHaveProperty('apiKey');
  });
});
