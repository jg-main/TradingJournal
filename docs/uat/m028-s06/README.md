# M028-S06 — Coexistence UAT & Quality Gate Evidence

**Milestone:** M028-0qdxbe — Performance Dashboard & Customization
**Slice:** S06 — Coexistence UAT & Quality Gate
**Date:** 2026-08-20

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

Run: `npx playwright test e2e/performance-dashboard.spec.ts --project=chromium` → 6 passed (17s).

## 2. Contract Tests — `src/lib/__tests__/performance-close-date.test.ts` (9/9 passed)

- Trade entered Jan 28, closed Feb 3: EXCLUDED from a January window, INCLUDED in February (close-date attribution).
- Cumulative P&L orders by close date; entry date alone never used for realized attribution.
- Unit semantics: percent conversion relative to period-start equity (null when missing/non-positive); R conversion with the R-multiple guard (null when initialRisk ≤ 0); fixed-semantic metrics never convert.

## 3. Browser Verification (gsd-browser, real seeded DB)

Verified against the live dev server with the populated journal DB (126 accounts, 8,004 closed trades):

- `/performance` renders a curated default dashboard: KPI row (Net P&L -$85,830, Win Rate 38.4%, Profit Factor 0.76, Average R -0.04R, Total Trades 8004) + 6 chart widgets as RGL items with ECharts canvases.
- Global filter bar: Accounts (All/Single/Multiple), Period presets (Whole period/YTD/1Y/6M/3M/1M/Custom), Unit ($/%/R).
- Unit conversion: switching to % converts Net P&L to -171.7% of period-start equity; fixed-semantic metrics (Win Rate %, Trade Count, Profit Factor ratio, Average R) stay fixed.
- Customize mode: 6 drag handles, Add KPI/Chart dialogs, series-visibility toggles, Reset; Done restores a chrome-free normal mode.
- Saved dashboards: create (pd-user- id persisted via `/api/dashboard/views`), switch away/back restores state, delete works; system default immutable and always restorable.
- Coexistence: `/` renders the full Risk & Positions workstation unchanged (risk summary, open positions table, account state); sidebar shows both Dashboard and Performance entries.

## 4. Operational Quality Gate

| Check | Result |
|-------|--------|
| `make lint` | PASS — 0 errors (187 pre-existing warnings) |
| `make typecheck` | PASS |
| `make build` | PASS — `/performance` (static) + `/api/performance/analytics` (dynamic) |
| `make test` | PASS — 4028/4028 |
| Playwright (chromium, targeted spec) | PASS — 6/6 |

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
