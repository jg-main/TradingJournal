# TradingJournal Architecture Guidance

Prefer the current stack unless a measured limitation exists:

- Next.js.
- React and TypeScript.
- Tailwind.
- shadcn/Radix.
- TanStack Table.
- ECharts.
- react-grid-layout.
- Drizzle and SQLite.
- Vitest and Playwright.

Principles:

- Reuse domain logic, not necessarily legacy UI.
- Keep business calculations outside visual components.
- Use adapters between old API shapes and new UX contracts.
- Use one owner for shared state.
- Use one polling lifecycle per live domain.
- Avoid fetching from every widget or panel.
- Validate persisted configuration.
- Use feature flags, separate routes, or namespaced persistence only when an
  explicitly approved coexistence strategy requires them.
