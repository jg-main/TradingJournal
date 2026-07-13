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
      'src/lib/__tests__/backup.test.ts',
      'src/lib/create-backup.test.ts',
      'src/lib/__tests__/backup-job-runtime.test.ts',
      'src/lib/backup-serializer.test.ts',
    ],
  },
});
