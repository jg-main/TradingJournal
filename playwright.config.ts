import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

const requestedPort = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '', 10);
const playwrightPort =
  Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65_536
    ? requestedPort
    : 31_000 + (process.pid % 1_000);
process.env.PLAYWRIGHT_PORT = String(playwrightPort);

const playwrightArtifactRoot =
  process.env.PLAYWRIGHT_ARTIFACT_DIR ??
  (process.env.CI ? process.cwd() : join('/tmp', `trading-journal-playwright-${process.pid}`));
const playwrightReportDir = join(playwrightArtifactRoot, 'playwright-report');
const playwrightTestResultsDir = join(playwrightArtifactRoot, 'test-results');

// A Playwright invocation owns one disposable database. Reusing a checked-out
// SQLite file lets immutable records from earlier runs leak into later suites
// (notably restore-readiness checks for open trades). The app server is shared,
// so running DB-mutating specs concurrently would still target the same file.
process.env.DB_FILE_NAME ??= `/tmp/trading-journal-playwright-${process.pid}/journal.db`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  outputDir: playwrightTestResultsDir,
  reporter: [['list'], ['html', { open: 'never', outputFolder: playwrightReportDir }]],
  use: {
    baseURL: `http://localhost:${playwrightPort}`,
    trace: 'on-first-retry',
  },
  webServer: {
    // Keep browser runs on the same stable Webpack dev path used by `make dev`.
    // Next's default Turbopack path can leave or reuse .next state in a way
    // that causes permission failures when the workspace was previously used
    // from a container.
    command: `npm run dev -- --webpack -p ${playwrightPort}`,
    port: playwrightPort,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      DB_FILE_NAME: process.env.DB_FILE_NAME,
      // Explicit deterministic-market-data fixture for the Playwright web
      // server: MTM quote fetching resolves to a stable mock provider instead
      // of live Yahoo/Schwab. The resolver's production guard means this can
      // never activate in a production build/runtime.
      PLAYWRIGHT_MOCK_MARKET_DATA: '1',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
