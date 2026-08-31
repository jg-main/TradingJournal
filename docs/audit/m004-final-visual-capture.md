# M004 Final Visual Capture — Kilo Execution Prompt

## Purpose

Mechanical evidence capture for the final M004 cross-app polish/acceptance audit.

**Kilo is not the reviewer.** Do not make product, UX, architecture, or close/no-close decisions. Do not modify production code. Capture the current application faithfully and return the evidence to the orchestrator for review.

## Production baseline

The accepted post-Tasks-20–26 production baseline is:

`f88e83124d1ec7abf53856f2b2da1d781f434ce0`

This document itself may be a later docs-only commit. Before capture:

```bash
git status --short
git rev-parse HEAD
git rev-parse origin/main
git diff --name-only f88e83124d1ec7abf53856f2b2da1d781f434ce0..HEAD
```

Required:

- `HEAD == origin/main`.
- Worktree clean before capture.
- The production source tree must still match the accepted baseline.
- Any commits after `f88e831...` must be documentation/audit-only. If any `src/`, runtime config, API, schema, test-harness, or production behavior file differs from `f88e831...`, **STOP and report**.

## Hard rules

- **NO production source changes.**
- **NO UX fixes.**
- **NO refactors.**
- **NO API changes.**
- **NO DB/schema changes.**
- **NO global CSS changes.**
- **NO Playwright/browser-harness configuration changes.**
- **NO Full Browser Qualification.**
- Do not weaken or alter the market-data mock safety guard.
- Do not commit or push screenshot artifacts unless explicitly instructed later.
- Temporary capture scripts/specs are allowed only if they are deleted before completion and leave the worktree clean except for the requested `docs/audit/m004-final-acceptance/` evidence files.

## Output directory

Create locally:

```text
docs/audit/m004-final-acceptance/
├── manifest.md
├── contact-sheet-1440.png
├── contact-sheet-1920.png
└── screenshots/
```

Screenshots and contact sheets are audit evidence, not production assets.

Do **not** commit or push these evidence files.

## Capture viewports

Use exactly:

- `1440x900`
- `1920x1080`

Use the same browser and rendering mode across all captures.

Prefer Chromium.

## Required primary surfaces

Capture realistic populated states for:

1. Workstation `/`
2. Trades `/trades`
3. Performance `/performance`
4. Accounts `/settings/accounts`
5. Account Detail `/settings/accounts/<representative-id>`
6. Settings hub `/settings`
7. Workspace `/settings/workspace`
8. Risk Defaults `/settings/risk-defaults`
9. Integrations `/settings/integrations`
10. Backup `/settings/backup`
11. AI Settings `/settings/ai`
12. Market Data `/settings/market-data`
13. Journal Setup `/settings/journal-setup`
14. Danger Zone `/settings/danger-zone`
15. Plays `/settings/plays`
16. Mistake Types `/settings/mistake-types`
17. Play Detail `/settings/plays/<representative-id>`
18. Trade Detail `/trades/<representative-id>`

For dynamic routes, use representative existing local/fixture records. Prefer meaningful realistic records over synthetic blank records.

If a required representative record is unavailable, do **not** modify application data architecture or production source. Record the limitation in `manifest.md`.

## Additional specialist evidence

Capture these extra states where available without modifying production code:

### Workstation

- normal populated state at 1440
- normal populated state at 1920
- customize mode at 1440

If a stale/partial market-data state is already available through an existing development fixture, capture it. Do not create a new fixture solely for this audit.

### Trade Detail

Where existing fixtures/data allow, capture representative:

- planned
- open
- closed/review

At minimum capture one realistic populated Trade Detail at both viewports.

### Management/configuration states

At 1440, additionally capture when practical:

- Plays: empty or loading state + New Play dialog
- Mistake Types: populated table + Add/Edit dialog
- Backup: initial loading if existing capture mechanism can hold initial requests without source changes
- Market Data: initial loading if practical
- Danger Zone: warning + confirm state
- Play Detail: loading or not-found state if practical
- Account Detail: one representative secondary tab (Ledger or Positions)

These are secondary evidence. Do not modify source to manufacture them.

## Screenshot naming

Use stable names:

```text
screenshots/01-workstation-1440.png
screenshots/01-workstation-1920.png
screenshots/02-trades-1440.png
screenshots/02-trades-1920.png
...
screenshots/18-trade-detail-1440.png
screenshots/18-trade-detail-1920.png
```

For alternate states:

```text
screenshots/01-workstation-customize-1440.png
screenshots/15-plays-new-dialog-1440.png
screenshots/16-mistake-types-dialog-1440.png
screenshots/14-danger-zone-confirm-1440.png
```

Keep numbering aligned with the primary-surface list.

## Contact sheets

Create two contact sheets:

`docs/audit/m004-final-acceptance/contact-sheet-1440.png`

`docs/audit/m004-final-acceptance/contact-sheet-1920.png`

Requirements:

- include all 18 primary surfaces;
- retain enough resolution that page hierarchy/keylines/control density are visible;
- label each tile with number + route/surface name;
- keep the same tile order on both sheets;
- do not crop away sidebars, page edges, headers, or primary actions;
- screenshots should show the complete browser content viewport, not only a component crop.

Do not apply decorative image styling that changes the application visuals.

## Manifest

Create:

`docs/audit/m004-final-acceptance/manifest.md`

Keep it factual and mechanical. No product recommendations.

Include:

### Repository state

- HEAD
- origin/main
- accepted production baseline `f88e831...`
- exact post-baseline changed-file list
- confirmation production source is unchanged

### Capture environment

- browser
- viewport sizes
- app URL/port
- capture date/time

### Primary captures

Table:

| # | Surface | Route used | 1440 file | 1920 file | Data/state used | Notes |
|---|---|---|---|---|---|---|

### Alternate-state captures

List exact files and states.

### Dynamic record mapping

Record IDs/routes used for:

- Account Detail
- Play Detail
- Trade Detail

Do not include secrets/tokens/API keys.

### Capture limitations

State any surface/state that could not be captured and why.

### Worktree state

At completion:

```bash
git status --short
```

Expected modifications/untracked files should be limited to:

`docs/audit/m004-final-acceptance/**`

and nothing else.

## Do not analyze

Do not answer questions such as:

- Does the app look like one product?
- Should M004 close?
- Should a control be replaced?
- Should a page be redesigned?
- Is an inconsistency acceptable?
- What should Task 28 be?

The orchestrator will make those judgments from the evidence.

You may report only mechanical capture failures or obvious inability to render a requested state.

## Validation before STOP

Confirm:

1. all available primary surfaces captured at 1440;
2. all available primary surfaces captured at 1920;
3. contact sheets created;
4. manifest created;
5. dynamic routes recorded;
6. no production source changed;
7. no runtime/config/API/schema change;
8. no browser-harness config change;
9. no commit;
10. no push;
11. no Full Browser Qualification;
12. worktree changes limited to `docs/audit/m004-final-acceptance/**`.

## Final response

Return only:

1. current HEAD;
2. confirmation accepted production baseline unchanged;
3. manifest path;
4. contact-sheet paths;
5. number of 1440 primary captures;
6. number of 1920 primary captures;
7. alternate-state capture paths;
8. any capture limitations;
9. final `git status --short` summary;
10. confirmation no production code changed, no commit, no push, no FBQ.

STOP.

Do not perform the acceptance analysis.
