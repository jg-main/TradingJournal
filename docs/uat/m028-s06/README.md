# M028-S06 — Coexistence UAT & Quality Gate Evidence

**Milestone:** M028-0qdxbe — Performance Dashboard & Customization
**Slice:** S06 — Coexistence UAT & Quality Gate
**Last full gate run:** 2026-08-20 (T03)

## Verdict: PASS

## 1. Playwright UAT Spec — `e2e/performance-dashboard.spec.ts` (6/6 passed)

| # | Scenario | Result |
|---|----------|--------|
| 1 | Coexistence: `/` renders the Risk & Positions workstation with a Performance nav entry | PASS |
| 2 | `/performance` renders filter bar, KPI row (titles), and chart grid (6 widget titles) | PASS |
| 3 | Normal mode is free of editing chrome (no Add/Reset controls) | PASS |
| 4 | Unit selector toggles presentation; fixed-semantic KPIs keep their unit suffix (Win Rate %, Profit Factor ratio) | PASS |
| 5 | Customize reveals editing controls (+ Add KPI / + Add Chart / Done); Done restores normal mode | PASS |
| 6 | Saved dashboards: create → switch to system default → switch back → delete | PASS |

Run: `npx playwright test e2e/performance-dashboard.spec.ts --project=chromium` → 6 passed (26.7s), exit 0.

## 2. Contract Tests — `src/lib/__tests__/performance-close-date.test.ts` (13/13 passed)

**Close-date attribution contract (4 tests):**
- Trade entered Jan 28, closed Feb 3: EXCLUDED from a January-only window (only the Jan-closed trade's $490 appears), INCLUDED in a February window ($1,990 on 2024-02-03).
- Cumulative P&L orders by close date (Jan 10 then Feb 3, cumulative = 490 + 1990).
- Entry date alone is never used for realized attribution: a trade opened Jan 28 attributes to Feb 3 even in a January-only window.

**Unit semantics contract (5 tests):**
- Percent conversion is relative to period-start equity; returns null for missing/non-positive equity.
- R conversion uses P&L / initial risk with the R-multiple guard (null when initialRisk ≤ 0).
- Fixed-semantic metrics (win rate %, trade count, avg R) are never converted by the global unit.
- Currency metrics convert to both percent and R with the correct context.

**Kernel edge cases (4 tests):** empty trade sets return zero/null per metric; max drawdown null when all drawdowns zero/missing; median R averages middle values on even counts and skips null-R trades; day win rate averages per-day rates.

## 3. Browser Verification (gsd-browser + Playwright matrix, real seeded DB)

Verified against the production server (`npm run start`, port 3000) with the populated journal DB (126 accounts, 8,004 closed trades):

- `/performance` renders the curated default dashboard: KPI row (Net P&L -$83,594, Gross P&L -$83,594, Total Trades 8004, Win Rate 38.5%, Profit Factor 0.77, Average R -0.04R) + 6 chart widgets as RGL items with ECharts canvases. (KPI values shift run-to-run because analytics recompute from the live DB; the earlier UAT pass recorded -$85,830/38.4%/0.76 — same pipeline, recomputed data.)
- Global filter bar: Accounts (All/Single/Multiple), Period presets (Whole Period/YTD/1Y/6M/3M/1M/Custom), Unit ($/%/R).
- **Filter propagation across heterogeneous widget types:** switching Period to 1Y updated KPIs and charts together from the shared query (Net P&L -$83,594 → -$53,815, Total Trades 8004 → 5111, Win Rate 38.5% → 39.1%) with all 6 chart canvases re-rendered.
- Unit conversion: switching to % converts Net P&L to -110.6% of period-start equity; fixed-semantic metrics (Win Rate %, Trade Count, Profit Factor ratio, Average R) stay fixed. Unit-only changes do not refetch (fetch keyed on the serialized API query).
- Customize mode: editing chrome revealed (button count 5 → 58: drag handles, Add KPI/Chart dialogs, Reset); Done restores a chrome-free normal mode (5 buttons, no Add/Reset/Done text).
- Saved dashboards: create → `pd-user-…` envelope persisted in `localStorage['performance:dashboards:v1']` → survives reload (active view restored after page reload) → switch to system default (`pd-system-default`, immutable) → switch back → delete → only system default remains. Persistence is localStorage-based; there is no server API for performance views (the `/api/dashboard/views` route is the workstation's, not `/performance`'s).
- Dark mode: `.dark` class applies `oklch(0.145 …)` body background; toggle in the shell persists to localStorage.
- **Viewport × theme matrix (6/6):** `/performance` renders KPIs (no "Loading"), all 6 chart titles, and ≥6 canvases with 0 JS errors at 1440/1280/1024 in both light and dark, with the correct `.dark` class applied per theme. Screenshots: `/tmp/t03-uat/shots/{1440,1280,1024}-{light,dark}.png`.
- Coexistence: `/` renders the full Risk & Positions workstation unchanged (risk summary strip, open positions table TSLA/NVDA/AMD, account state, performance/review metrics); sidebar shows both Dashboard and Performance entries.

## 4. Operational Quality Gate

| Check | Result |
|-------|--------|
| `make lint` | PASS — 0 errors (185 pre-existing warnings) |
| `make typecheck` | PASS — `tsc --noEmit` clean |
| `make build` | PASS — `/performance` (static) + `/api/performance/analytics` (dynamic) |
| `make test` | PASS — 4118/4118 (182 files) |
| `make test-all` | PASS — vitest (4118) + 30 standalone tsx suites, "✓ ALL PASSED" |
| Playwright (chromium, targeted spec) | PASS — 6/6 |

Note: one `make test-all` run failed with a timer timeout in `account-reconciliation-summary.test.tsx` while the Playwright web-server boot ran concurrently (both on the same machine); the identical suite passed standalone (`make test` 4118/4118) and passed on a clean sequential `make test-all` re-run. The failure is a concurrent-run resource artifact, not a code defect.

## 5. Bugs Found & Fixed During UAT

1. **Dual dashboards-store instance** — `DashboardSwitcher` created its own `usePerformanceDashboards` store, so switching from the shell never updated the switcher's trigger. Fixed: the shell owns the store and passes state/actions to the switcher as props (single owner).
2. **System default dropped after API hydrate** — API rows replaced the local list, removing the never-persisted `pd-system-default`. Fixed: `ensureSystemDefault()` merges it into every hydrate.
3. **Analytics API O(n²) setup-P&L** — per-setup net P&L recomputed trade metrics per setup. Fixed: single-pass `computeSetupNetPnlBySetup` + shared `computeTradeMetricsCache` across all aggregation functions (~30s → ~10s on 8k trades).
4. **Unit-only filter changes refetched** — unit is client-side presentation; the provider now keys the fetch on the serialized API query so unit changes don't refetch.
5. **Period-start equity baseline** — % conversion used `accountValue` (aggregated ending equity, unreliable across accounts). Fixed: earliest rollforward equity with starting-balance fallback, exposed as `metadata.periodStartEquity`.

## 6. Known Limitations

- The analytics route still recomputes `computeTradeMetrics` inside the canonical `computeKpiMetrics`/chart functions (4–5 passes over closed trades). Sharing their cache would require modifying the shared `dashboard.ts` contract — deferred, not a correctness issue.
- Multi-currency accounts: aggregation warns (`mixedCurrencies` flag) but the app is effectively USD-only; no implicit FX policy as specified.
- Tags advanced filter scoped out: the trades table has no tags field (audited in S01); setup-tags filtering is the only data-backed option.
