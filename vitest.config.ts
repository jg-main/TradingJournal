import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: [
      'src/lib/account-lifecycle.test.ts',
      'src/lib/readiness.test.ts',
      'src/lib/restore.test.ts',
      'src/lib/__tests__/error-utils.test.ts',
      'src/lib/__tests__/scorecard.test.ts',
      'src/app/api/app-profile/__tests__/route.test.ts',
      'src/app/api/readiness/__tests__/route.test.ts',
      'src/app/api/ai-settings/__tests__/route.test.ts',
      'src/app/api/trades/__tests__/execute.test.ts',
      'src/app/api/trades/__tests__/check-results.test.ts',
      'src/app/api/health/__tests__/route.test.ts',
      'src/lib/__tests__/clickhouse-client.test.ts',
      'src/lib/__tests__/ai-provider.test.ts',
      'src/lib/__tests__/ai-settings-integration.test.ts',
      'src/lib/__tests__/assessment-engine.test.ts',
      'src/app/api/trades/[id]/assessments/__tests__/route.test.ts',
      'src/lib/__tests__/market-quote.test.ts',
      'src/lib/__tests__/scheduler.test.ts',
    ],
  },
});
