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
      'src/app/api/app-profile/__tests__/route.test.ts',
      'src/app/api/readiness/__tests__/route.test.ts',
      'src/app/api/accounts/__tests__/checks.test.ts',
      'src/app/api/setups/__tests__/checks.test.ts',
      'src/app/api/checks/__tests__/merged.test.ts',
      'src/app/api/checks/__tests__/reorder.test.ts',
      'src/app/api/trades/__tests__/execute.test.ts',
    ],
  },
});
