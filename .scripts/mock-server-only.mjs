/**
 * Preload hook to mock `server-only` for test suites that
 * import modules which use the `server-only` guard.
 *
 * Usage:
 *   node --import ./.scripts/mock-server-only.mjs ./node_modules/.bin/tsx src/lib/create-backup.test.ts
 *
 * This registers a resolution hook that returns an empty module
 * whenever `server-only` is required/imported, preventing the
 * guard from throwing outside a Next.js server context.
 */
import { register } from 'node:module';

register('/dev/null', import.meta.url, {
  data: { url: 'file:///dev/null/mock-server-only.js' },
  parentURL: import.meta.url,
  transferArgs: true,
});
