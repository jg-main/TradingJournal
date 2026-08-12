# M016 / S07 — Release Gate Screenshot Evidence

**Milestone:** M016 Risk First Dashboard Workstation
**Slice:** S07 Release Evidence and Acceptance
**Task:** S07-T02 Quality gate execution and viewport screenshot capture
**Date:** 2026-08-12
**Surface:** `http://localhost:<port>/dev/workstation` (deterministic fixture harness, default populated scenario, `liveMode: false`)

Per §11 of `docs/requirements/DASHBOARD_RISK_FIRST_REQUIREMENTS.md`, visual screenshots
must be captured at 2560×1440 and effective 1536×960, with an additional 1440×900
structural-fallback screenshot. This directory holds those captures, produced by
`scripts/capture-workstation-screenshots.mjs` (its own `--webpack` dev server on a
disposable port + database, chromium, full-page PNGs).

## Screenshots

| File | Viewport | Role |
|------|----------|------|
| `dash-2560x1440.png` | 2560×1440 | Primary desktop target (DASH-AC-10) |
| `dash-1536x960.png` | 1536×960 | Effective laptop target (DASH-AC-10) |
| `dash-1440x900-fallback.png` | 1440×900 | Structural fallback |

## Structural assertions (per viewport, captured in the script run)

- `ws-grid` visible; `ws-toolbar`, `ws-data-quality-alert-strip`, `ws-panel-risk` visible.
- `ws-positions-table` renders all 9 critical columns (`thead th` count = 9).
- Table bounding box fits inside the viewport width (no clipped columns).
- No document-level horizontal overflow (`scrollWidth <= innerWidth + 1`).
- No console errors during capture.

Result: **passed at all three viewports** (exit 0; run id `9d0e7ddd`).

## Browser project availability (recorded honestly, not silently passed)

- **chromium** — available; `e2e/dash-acceptance.spec.ts` 11/11 passed (all ten DASH-AC scenarios).
- **firefox** — available; `e2e/dash-acceptance.spec.ts` 11/11 passed.
- **webkit** — **unavailable on this host**: `browserType.launch` fails with
  "Host system is missing dependencies to run browsers" (`libicu74`, `libjpeg-turbo8`,
  `libwoff1`). Installation requires `sudo npx playwright install-deps` / apt, which
  autonomous execution must not perform. Recorded as unmet rather than silently passed;
  the targeted browser workflow for the release gate is chromium (per the slice plan).

## Related evidence

- All ten DASH-AC scenario assertions: `e2e/dash-acceptance.spec.ts` (chromium + firefox runs).
- Release-gate test categories all green via `make test-all` (vitest + tsx orchestrator),
  plus targeted runs: workstation component suites (155 passed), dashboard API contract
  suites (24 passed), freshness-policy pure-calc (37 passed), cross-surface integration (PASSED).
