# ESLint Warnings — Pre-Existing Debt

This file documents all 58 ESLint warnings as of the M028-n7jwa9 lint cleanup.
These are acknowledged pre-existing code quality debt — not introduced by any
M028 change. Future milestones may address individual warnings when touching
the affected file; bulk cleanup is deferred.

**Total: 58 warnings, 0 errors.** Generated from `make lint` output.

---

## `src/app/api/backup/__tests__/server-restore.test.ts` (1)

- Line 24: `readdirSync` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/app/api/trades/mtm/refresh/route.ts` (3)

- Line 31: `_resetRateLimit` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 38: `_getRateLimitMs` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 46: `_getRemainingCooldownMs` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/app/trades/[id]/page.tsx` (1)

- Line 350: `handleRiskSnapshotSave` is assigned a value but never used (`@typescript-eslint/no-unused-vars`)

## `src/components/add-exit-dialog.tsx` (2)

- Line 61: `pad2` is assigned a value but never used (`@typescript-eslint/no-unused-vars`)
- Line 62: `toLocalDatetime` is assigned a value but never used (`@typescript-eslint/no-unused-vars`)

## `src/components/dynamic-table.tsx` (3)

- Line 3: `useMemo` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 105: `router` is assigned a value but never used (`@typescript-eslint/no-unused-vars`)
- Line 153: TanStack Table's `useReactTable()` API returns functions that cannot be memoized safely — `react-hooks/incompatible-library`

## `src/components/lifecycle-stepper.tsx` (1)

- Line 78: `isLastStep` is assigned a value but never used (`@typescript-eslint/no-unused-vars`)

## `src/components/restore-modal.tsx` (1)

- Line 3: `useCallback` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/components/trade-detail/closed-phase-view.tsx` (5)

- Line 4: `Brain` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 4: `Loader2` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 67: `onRefreshPrice` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 75: `onAssess` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 76: `assessing` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/components/trade-detail/risk-snapshot-card.tsx` (1)

- Line 24: `onRefreshPrice` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/components/trade-detail/trade-assets-card.tsx` (1)

- Line 90: `items` is assigned a value but never used (`@typescript-eslint/no-unused-vars`)

## `src/components/trade-detail/trade-executions-card.tsx` (2)

- Line 26: `formatDate` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 170: React Hook useCallback has a missing dependency: `timezone` (`react-hooks/exhaustive-deps`)

## `src/components/trade-detail/trade-pnl-card.tsx` (1)

- Line 6: `MtmData` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/__fixtures__/golden-scenarios.test.tsx` (3)

- Line 40: `RiskSnapshotInput` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 59: `FeePolicy` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 64: `PositionSizingParams` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/__fixtures__/response-contracts.test.ts` (17)

- Line 37: `calculatePnL` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 37: `calculateRMultiple` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 37: `deriveTradeStatus` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 37: `Direction` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 39: `computeEquityAtOpen` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 40: `deriveInitialRiskAmount` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 41: `computeRealizedPnLFromClosedTrades` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 42: `computeRiskSnapshotValues` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 52: `computeWinRate` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 52: `averageRMultiples` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 52: `averageProcessScore` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 53: `computeOpenPosition` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 54: `calculatePositionSize` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 66: `MonthlyPerformanceItem` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 67: `RDistributionBin` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 68: `DirectionalPerformanceResult` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 69: `ProcessScoreBin` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 72: `computeEquityCurve` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 73: `computeDrawdown` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 74: `computeTradeMarkers` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 156: `assertFieldPresent` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/__tests__/scheduler.test.ts` (1)

- Line 198: `calls` is assigned a value but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/ai-provider.ts` (1)

- Line 154: `options` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/assessment-engine.ts` (2)

- Line 47: `FeatureConfig` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 656: `total` is assigned a value but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/create-backup.ts` (2)

- Line 31: `getDbFilePath` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 51: `nodeStreamToWeb` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/mark-to-market.test.ts` (2)

- Line 15: `FeePolicy` is defined but never used (`@typescript-eslint/no-unused-vars`)
- Line 55: `assertDeepEqual` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/metrics.test.ts` (1)

- Line 18: `WinRatePolicy` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/restore.ts` (1)

- Line 18: `existsSync` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/risk-snapshot.test.ts` (1)

- Line 54: `assertNotNull` is defined but never used (`@typescript-eslint/no-unused-vars`)

## `src/lib/timezone-context.tsx` (1)

- Line 82: `pad` is assigned a value but never used (`@typescript-eslint/no-unused-vars`)

---

## Summary

| File | Warnings |
|------|----------|
| `src/app/api/backup/__tests__/server-restore.test.ts` | 1 |
| `src/app/api/trades/mtm/refresh/route.ts` | 3 |
| `src/app/trades/[id]/page.tsx` | 1 |
| `src/components/add-exit-dialog.tsx` | 2 |
| `src/components/dynamic-table.tsx` | 3 |
| `src/components/lifecycle-stepper.tsx` | 1 |
| `src/components/restore-modal.tsx` | 1 |
| `src/components/trade-detail/closed-phase-view.tsx` | 5 |
| `src/components/trade-detail/risk-snapshot-card.tsx` | 1 |
| `src/components/trade-detail/trade-assets-card.tsx` | 1 |
| `src/components/trade-detail/trade-executions-card.tsx` | 2 |
| `src/components/trade-detail/trade-pnl-card.tsx` | 1 |
| `src/lib/__fixtures__/golden-scenarios.test.tsx` | 3 |
| `src/lib/__fixtures__/response-contracts.test.ts` | 17 |
| `src/lib/__tests__/scheduler.test.ts` | 1 |
| `src/lib/ai-provider.ts` | 1 |
| `src/lib/assessment-engine.ts` | 2 |
| `src/lib/create-backup.ts` | 2 |
| `src/lib/mark-to-market.test.ts` | 2 |
| `src/lib/metrics.test.ts` | 1 |
| `src/lib/restore.ts` | 1 |
| `src/lib/risk-snapshot.test.ts` | 1 |
| `src/lib/timezone-context.tsx` | 1 |
| **Total** | **58** |

Almost all warnings are `@typescript-eslint/no-unused-vars` (unused imports/variables).
Two non-unused-vars warnings:
- `src/components/dynamic-table.tsx:153` — `react-hooks/incompatible-library` (TanStack Table API)
- `src/components/trade-detail/trade-executions-card.tsx:170` — `react-hooks/exhaustive-deps` (missing timezone dep)

## Risk Assessment

- **None of these warnings represent runtime defects.** They are unused imports/variables (dead code) and two React hooks lint rule violations.
- **Bulk cleanup risk:** Changing test files could affect golden-scenario validation. Changing trade detail components could affect rendering. Each warning should be addressed when the owning file is already being modified for feature work.
