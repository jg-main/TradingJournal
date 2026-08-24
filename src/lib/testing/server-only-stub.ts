/**
 * server-only-stub.ts
 *
 * Vitest alias target for Next.js's `server-only` marker package.
 *
 * `src/db/index.ts` imports 'server-only' (a Next.js marker package whose
 * default export throws outside React Server Components). Route test suites
 * that exercise the REAL route handlers (which import `@/db`) alias
 * 'server-only' to this empty module in vitest.config.ts so vite-node does
 * not execute the throwing entry point. The plain-tsx execution path uses
 * the node Module._load interception at the top of each test file instead —
 * this module is a no-op in both cases.
 */
export {};
