# Milestone — UX Foundation / Consistency

## Status

**Pipeline position:** 1 of 6 roadmap phases before v1.0 Readiness
**Roadmap label:** v0.8 — UX Foundation (label only; does not drive `package.json` versioning)
**Type:** UX / design-system application and consolidation
**Priority:** High
**Risk:** Low–Medium

> **Naming note.** The "v0.8" label describes this milestone's position in the product roadmap. It does **not** control application versioning: `package.json` remains at its own application version, and the repository's GSD milestone identifiers (`M0XX`) are assigned by the GSD workflow, not derived from the roadmap label.

---

# 1. Context

TradingJournal is the current application being developed in this repository:

**Canonical project:**
`https://github.com/jg-main/TradingJournal`

TradingJournal is a **local-first trading workstation**, covering the complete trader lifecycle:

```text
Planning
→ Execution
→ Position Management
→ Risk
→ Account State
→ Performance
→ Review
```

The core trading-domain functionality and the application's **design system are already substantially implemented** (identity and design-system foundation from M014, restructured into `docs/design-system/` in M025).

The primary objective of this milestone is therefore **not to create a design system** and **not to add functionality** — it is to **apply, consolidate, and refine the existing TradingJournal design system across the current product surfaces**, using Tradenza as an external UX benchmark for evidence-backed improvements.

The milestone purpose is:

> Apply, consolidate, and refine the existing TradingJournal design system across current product surfaces, using Tradenza as an external UX benchmark for evidence-backed improvements.

---

# 2. Design System Sources of Truth (authoritative)

The repository already has an implemented and authoritative design system. Treat the following as the current sources of truth — do **not** instruct GSD to create a new design system, new visual identity, replacement token system, or replacement primitive library:

```text
PRODUCT.md
docs/design-system/          (README.md index, tokens.md, charts.md, workstation.md, trade-detail.md
                             — the M025 consolidation of the former monolithic docs/design-system.md)
src/app/globals.css          (authoritative token implementation)
src/lib/chart-palette.ts     (authoritative chart token implementation)
src/components/ui/*          (existing shared UI primitives, incl. __tests__)
AGENTS.md
```

The existing **Graphite + Steel Blue** identity is authoritative and must remain so unless a future milestone explicitly changes it.

**Working mode:** audit the current implementation against these sources of truth, then apply the existing system consistently — using the established tokens, primitives, and patterns. Where a surface drifts from the system, bring it into alignment. Do not redefine the system itself.

---

# 3. External UX Benchmark: Tradenza

During this milestone, use the following external open-source project as a **UX and product-design benchmark**:

**Reference project:**
`https://github.com/HonzaPrikryl/Tradenza`

Tradenza is another trading-journal application with a polished current user interface in several areas, particularly:

- overall visual hierarchy;
- dashboard presentation;
- navigation;
- typography;
- card composition;
- tables;
- forms;
- filtering controls;
- loading states;
- empty states;
- dialog consistency;
- trade review presentation;
- dashboard/widget presentation.

TradingJournal and Tradenza do **not** have the same product architecture.

TradingJournal is a **local-first active trading workstation**, with capabilities such as:

- planned trades;
- open positions;
- current market marks;
- open risk;
- portfolio heat;
- stop/target management;
- execution history;
- account state;
- risk snapshots;
- data freshness/reliability;
- post-trade review.

Tradenza should therefore be treated as:

> **a UX reference, not a dependency and not a design-system authority.**

Tradenza **may influence**:

```text
visual hierarchy
information grouping
composition
density
navigation presentation
filters
forms
dialogs
trade-review presentation
loading / empty / error states
interaction polish
```

Tradenza must **not** automatically redefine:

```text
color identity
semantic token meanings
typography system
chart palette
domain semantics
product information architecture
```

---

# 4. Reference Repository Inspection

As part of the initial audit (S01), inspect the current Tradenza repository.

The orchestrator may clone it into a temporary/read-only location if useful, for example:

```bash
git clone --depth 1 \
  https://github.com/HonzaPrikryl/Tradenza.git \
  /tmp/tradenza-reference
```

Do not:

- add Tradenza as a git submodule;
- add it as an application dependency;
- modify the Tradenza repository;
- migrate TradingJournal onto Tradenza's stack;
- copy large source files directly;
- make TradingJournal runtime-dependent on Tradenza.

Inspect Tradenza primarily for:

```text
app shell
navigation
page hierarchy
dashboard layout
cards
tables
forms
dialogs
filters
trade review UX
loading states
empty states
error states
spacing
typography
color semantics
responsive behavior
```

When identifying a useful pattern, extract the **design principle** and implement it using TradingJournal's own components, tokens, and architecture.

Example:

```text
Observed in Tradenza:
Consistent compact KPI cards with clear value hierarchy.

Correct response:
Apply TradingJournal's existing KPI presentation consistently.

Incorrect response:
Copy the Tradenza KPI component into TradingJournal.
```

---

# 5. Licensing Constraint

Tradenza is licensed under **AGPL-3.0**.

For this milestone:

- borrow UX concepts;
- borrow interaction concepts;
- borrow visual/design-system ideas;
- borrow general architectural patterns where appropriate;

but avoid direct source copying unless licensing implications have been deliberately reviewed.

The safest default is:

> **conceptual adaptation rather than source reuse.**

---

# 6. Purpose

Apply and consolidate TradingJournal's existing design system across the current user-facing product before additional workstation, workflow, and analytics development.

This milestone results in:

- one consistent application of the existing visual language;
- consistent application of the existing typography hierarchy;
- consistent application of the existing spacing system;
- consistent application of the existing semantic color system;
- consistent use of the existing component vocabulary (`src/components/ui/*`);
- consistent tables;
- consistent forms;
- consistent dialogs;
- consistent interaction states;
- consistent page structure;
- consistent application shell.

It does **not** create a new visual identity, token system, or primitive library.

---

# 7. Governing Principle

This milestone changes:

> **How TradingJournal presents information.**

It must NOT change:

> **What TradingJournal stores, calculates, or means.**

Given identical input data before and after this milestone, trading/accounting/risk outputs must remain semantically equivalent.

---

# 8. Primary Outcome

At milestone completion, all major TradingJournal screens should clearly appear to belong to the same professionally designed application.

The UX should feel deliberate rather than accumulated.

The application should remain optimized for a **dense desktop trading workstation**, not for a generic consumer SaaS aesthetic.

---

# 9. Scope

## 9.1 Design tokens — apply, do not recreate

Apply the **existing** semantic token vocabulary defined in `src/app/globals.css` (`:root` / `.dark`) and documented in `docs/design-system/tokens.md`.

Audit the current surfaces for:

- hard-coded colors / spacing / radii where an existing token applies;
- token drift from the documented values;
- inconsistent use of semantic states.

Bring drift into alignment using the existing tokens. Do not introduce a replacement token system and do not re-define semantic token meanings.

Semantic state meaning is already established:

```text
profit / favorable value      → positive
loss / adverse value          → negative
stale market data             → warning
unavailable/error state       → error
neutral informational value   → neutral
```

Do not communicate critical state through color alone.

## 9.2 Typography

Apply the **existing** typography hierarchy (globals.css + tokens.md) consistently:

```text
Page title
Section title
Panel title
Body
Secondary body
Table header
Table value
KPI value
KPI label
Caption
Metadata
Form label
Helper text
Error text
```

Requirements:

- use tabular numerals for financial values where supported;
- prices, P&L, percentages, quantities and R values must align cleanly;
- avoid excessive font-size variation;
- avoid unnecessary bold text;
- preserve high information density.

Do not replace the typography system.

## 9.3 Spacing and layout

Apply the existing spacing scale consistently:

- page margins;
- content gutters;
- vertical section spacing;
- card padding;
- grid gaps;
- table row heights;
- form spacing;
- dialog spacing;
- icon/button spacing.

Use the controlled spacing scale; eliminate one-off values where an existing token applies.

## 9.4 Application shell

Refine the application's existing global structure for consistency:

```text
Application
│
├── Navigation / Sidebar
│
└── Main
    ├── Page Header
    │   ├── Title
    │   └── Actions
    │
    └── Page Content
```

Review:

- sidebar dimensions;
- navigation alignment;
- selected state;
- hover state;
- page padding;
- page-title positioning;
- action placement;
- content alignment.

Do not restructure the application's information architecture in this milestone.

## 9.5 Shared UI primitives

Prefer the **existing** primitives in `src/components/ui/*`.

Refactor duplicated implementations into the existing primitives where a vertical slice demonstrates the need and doing so materially improves consistency.

Review surfaces against:

```text
Button
Card / Panel
Badge
Table
PageHeader patterns
Input
Textarea
Select
Tabs
Dialog / Sheet
Alert
EmptyState
Skeleton
Tooltip
```

Do not introduce a new UI framework or build a parallel primitive library. Shared primitive changes are allowed when a vertical slice demonstrates the need; do not create standalone broad refactor slices whose only outcome is "build components" or "improve styling".

## 9.6 Component and state guidance

The following component-level expectations apply while working through the vertical slices. They are **application** guidance for the existing system, not mandates to build new systems.

### Buttons

Apply existing button variants consistently:

```text
Primary
Secondary
Ghost
Destructive
Icon
```

Standardize size, padding, radius, typography, icon alignment, hover, active, focus, disabled, and loading across surfaces. Primary buttons remain visually distinctive and used sparingly.

### Cards and panels

Use the existing panel structure consistently. Allow controlled variants such as standard, compact, KPI, and warning. Avoid page-specific card implementations when the shared primitive is appropriate.

### Tables

Tables are a critical workstation component. Optimize for **clarity + density**, applying the established table patterns (header styling, row height, borders, hover, selected state, column spacing, numeric alignment, truncation, sorting presentation, action columns, overflow, empty/loading states).

General alignment rule:

```text
Identifiers / text → left
Numeric values     → right
```

Example:

```text
Ticker   Side      Qty       WAP       Last       P&L        R
AAPL     Long      500     212.45     215.20    +1,375    +1.2R
```

Do not reduce useful trading-data density simply to create more whitespace.

### KPI presentation

Apply the existing KPI presentation consistently (label, primary value, optional context, optional state/change). Do not introduce new KPIs during this milestone.

### Badges and statuses

Apply the existing semantic status presentation (Planned / Open / Closed, Long / Short, Live / Stale / Unavailable, Warning / Error, Grade, Setup). Avoid arbitrary colors per component.

### Forms

Apply the existing form styling consistently (field labels, input heights, focus state, borders, placeholders, helper text, validation text, textareas, selects, date/number fields, grouped fields, section spacing). Existing business validation remains unchanged unless correcting an existing confirmed defect.

### Dialogs / sheets

Apply the existing dialog/sheet patterns consistently (width, heading, content, footer, button order, backdrop, close behavior, spacing, keyboard behavior, destructive confirmation). Destructive operations remain explicit.

### Tabs

Apply the existing tab pattern consistently (active/inactive state, hover, focus, spacing, optional counts).

### Loading, empty, and error states

- **Loading:** prefer structural skeletons; avoid unnecessary whole-page spinners; prevent large layout shifts where practical.
- **Empty states:** answer what is empty, why it might be empty, and what the user should do.
- **Error states:** explain what failed, preserve unaffected surrounding UI, provide retry where meaningful, avoid exposing irrelevant technical traces.

### Focus and disabled states

Interactive controls must have intentional hover, focus, active, disabled, and loading states. Keyboard focus must remain visible. Do not replace semantic controls with clickable generic containers merely for styling.

## 9.7 Financial formatting

Apply the existing financial number conventions consistently (currency, percentage, R, quantity, missing-value presentation such as `—`). Do not inconsistently mix `NA / N/A / - / -- / null / undefined` unless they genuinely represent different states.

---

# 10. Watchlist and Weekly Review scope

The latest product architecture moved Watchlist and Weekly Review into **dashboard-hosted workflows** (M024). The milestone targets:

```text
Dashboard-hosted Watchlist workflow
Dashboard-hosted Weekly Review workflow
```

**Explicit rule:**

> Legacy `/watchlist` and `/reviews` routes are not primary UX-polish targets unless current repository inspection demonstrates that they remain part of an intended user journey. Do not spend milestone effort polishing deprecated or compatibility-only routes.

---

# 11. Responsive Targets

TradingJournal remains primarily desktop-first.

Validate major proving surfaces at minimum:

```text
1440 px
1280 px
1024 px
```

Requirements:

- no broken layouts;
- important financial information remains accessible;
- tables may scroll horizontally where appropriate;
- avoid hiding core data purely for visual simplicity.

A full mobile-first redesign is out of scope.

---

# 12. Accessibility Baseline

Modified/new UI should preserve basic accessibility:

- visible focus;
- form labels;
- semantic buttons;
- semantic table markup where practical;
- keyboard-accessible dialogs;
- appropriate headings;
- sufficient contrast;
- state not communicated by color alone.

---

# 13. Vertical Slice Decomposition

Do not execute the milestone as one monolithic change and do not use generic horizontal work packages. Execute it as **user-visible vertical slices** that map to routes, workflows, domain contracts, or verifiable outcomes, per `AGENTS.md`. Each slice is independently implemented, tested, reviewed, and committed.

---

## S01 — UX benchmark audit and locked visual direction

Inspect:

- current implementation;
- `PRODUCT.md`;
- `docs/design-system/`;
- `AGENTS.md`;
- existing shared UI primitives (`src/components/ui/*`);
- current Tradenza repository.

Identify:

- actual UX inconsistencies;
- opportunities to reuse existing primitives;
- Tradenza patterns worth conceptually adapting;
- Tradenza patterns that conflict with TradingJournal's workstation model.

Output:

- concise decisions/gap record;
- implementation plan for the remaining slices.

Do not perform broad product implementation in S01.

---

## S02 — Application shell and primary navigation coherence

Primary proving surfaces:

- Dashboard;
- Trades;
- Accounts;
- Settings / primary system navigation.

Improve:

- shell consistency;
- page headers;
- navigation states;
- spacing;
- page hierarchy;
- shared shell behavior.

Preserve the existing information architecture.

---

## S03 — Daily trading lists

Primary proving surfaces:

- Planned trades;
- Open trades / positions;
- Closed trades.

Improve:

- tables;
- filters;
- action placement;
- status presentation;
- density;
- loading;
- empty states;
- error states;
- responsive behavior.

Do not change trade-state semantics or calculations.

---

## S04 — Trade detail and trade-entry experience

Primary proving surfaces:

- Trade Detail;
- Plan/Create Trade;
- Edit Trade;
- execution/management dialogs already part of the current workflow.

Improve:

- information hierarchy;
- forms;
- dialogs;
- section structure;
- metadata presentation;
- action clarity.

Do not redesign the trade lifecycle.

---

## S05 — Dashboard / workstation visual consolidation

Improve the current workstation presentation only.

Focus on:

- hierarchy;
- panel consistency;
- density;
- KPI presentation;
- existing widget composition;
- state handling;
- alignment.

Do not add:

- new panel architecture;
- new saved-layout architecture;
- new metrics;
- new widgets solely for this milestone.

Those remain downstream work.

---

## S06 — Accounts and secondary operational surfaces

Cover current user-facing operational surfaces such as:

- Accounts;
- Checks;
- Sizing;
- Settings;
- other routes identified during S01 as still part of the intended product.

Apply the same existing design system and UX consistency rules.

---

## S07 — Cross-surface UX UAT and consistency closure

Perform:

- final cross-page consistency pass;
- screenshot review;
- light-theme UAT;
- dark-theme UAT;
- viewport validation;
- keyboard/focus validation;
- accessibility baseline;
- regression verification.

Close remaining milestone-scoped UX defects only.

---

# 14. Explicit Non-Goals

## No design-system recreation

Do not create:

- a new visual identity;
- a replacement token system;
- a replacement typography system;
- a replacement chart palette;
- a replacement primitive library;
- a competing design guide.

The existing **Graphite + Steel Blue** identity, `docs/design-system/`, `globals.css`, `chart-palette.ts`, and `src/components/ui/*` remain authoritative.

## No domain-model changes

Do not change:

- database schema unless unavoidable for a confirmed UX defect;
- execution model;
- FIFO accounting;
- account ledger semantics;
- risk semantics;
- market-data semantics;
- trade-state definitions;
- risk snapshots.

## No metric work

Do not introduce or redefine:

- KPIs;
- expectancy;
- profit factor;
- R calculations;
- drawdowns;
- strategy metrics;
- portfolio metrics;
- behavioral statistics.

Existing numbers may be visually reformatted only.

## No workstation architecture changes

Do not implement:

- panel registry;
- new dashboard zones;
- saved workstation layouts;
- new dashboard customization architecture.

Reserved for the downstream **Workstation Architecture** phase.

## No trading-workflow redesign

Do not redesign:

```text
Planned
→ Open
→ Managed
→ Closed
→ Reviewed
```

Reserved for the downstream **Trading Workflow** phase.

## No analytics expansion

Do not substantially redesign analytical functionality or introduce new charts. Visual containers may be normalized.

Reserved for the downstream **Analytics & Review** phase.

## No import redesign

Do not build:

- CSV wizard;
- import mapping system;
- broker import presets;
- import history redesign.

Reserved for the downstream **Product Polish** phase.

---

# 15. Engineering Constraints

Preserve the current TradingJournal technical stack unless a change is clearly justified.

Do not migrate technologies simply because the reference application uses something different.

Specifically avoid unnecessary migration of:

- persistence;
- routing;
- charts;
- CSS solution;
- component framework;
- authentication architecture.

TradingJournal's local-first architecture remains intentional.

---

# 16. Refactoring Policy

Refactor when directly useful to UX consistency and when a vertical slice demonstrates the need.

Good:

```text
Multiple inconsistent KPI implementations
→ reuse the existing KPI primitive consistently
```

Good:

```text
Repeated page-header markup
→ reuse the shared PageHeader pattern
```

Good:

```text
Duplicated display formatting
→ shared presentation helper
```

Avoid:

```text
Table styling work
→ unrelated repository/service rewrite
```

UX refactoring must remain orthogonal to domain refactoring.

---

# 17. Verification (aligned with AGENTS.md)

Use the repository's established GSD verification policy. Do not invent a parallel verification policy.

## At slice completion

Run, as separate commands:

```bash
make lint
make typecheck
make build
make test-all
```

For changed user-facing workflows, also run **targeted Playwright or browser verification** appropriate to the slice.

Do not run the entire multi-browser matrix after every task. `make playwright` is a full-matrix command reserved for an explicitly budgeted milestone-boundary or CI run.

## At milestone completion

Run the full repository quality gate plus the required milestone-level browser/UAT verification defined by `AGENTS.md`.

## Test policy

Do not weaken existing tests to accommodate styling changes. Where E2E tests rely on fragile visual selectors, replace them with stable semantic selectors where appropriate — without reducing coverage.

---

# 18. Visual UAT (both themes)

Visual UAT is **required in both themes**:

```text
Light theme
Dark theme
```

For major proving surfaces, validate representative desktop widths:

```text
1440 px
1280 px
1024 px
```

Review at minimum:

- clipping;
- broken grids;
- table overflow;
- wrapping;
- visual hierarchy;
- alignment;
- density;
- dialogs/sheets;
- loading states;
- empty states;
- error states;
- focus states;
- theme-specific contrast or token regressions.

Preserve screenshots or equivalent browser evidence for visual acceptance (per `AGENTS.md`).

---

# 19. Acceptance Criteria

## Application of the existing design system

- [ ] Existing semantic color vocabulary is applied consistently (no new ad-hoc colors).
- [ ] Existing typography hierarchy is applied consistently.
- [ ] Existing spacing scale is applied consistently.
- [ ] Financial numbers have consistent presentation.
- [ ] Missing-value formatting is consistent.

## Components

- [ ] Buttons use the existing variants consistently.
- [ ] Cards/panels use the existing structure consistently.
- [ ] Tables use consistent density and alignment.
- [ ] KPI presentation is consistent.
- [ ] Forms are consistent.
- [ ] Dialogs/sheets are consistent.
- [ ] Tabs are consistent.
- [ ] Status badges follow the existing semantic rules.

## States

- [ ] Important screens have appropriate loading states.
- [ ] Empty states are intentional.
- [ ] Errors are consistently presented.
- [ ] Disabled states are clear.
- [ ] Focus states remain visible.

## Shell

- [ ] Navigation is visually coherent.
- [ ] Selected navigation state is clear.
- [ ] Page headers are consistent.
- [ ] Major pages use consistent margins/padding.
- [ ] Application remains usable at 1024 px.

## Themes and viewports

- [ ] Light-theme visual UAT passes at 1440/1280/1024 px.
- [ ] Dark-theme visual UAT passes at 1440/1280/1024 px.
- [ ] No theme-specific contrast or token regressions.

## Domain safety

- [ ] Trading calculations are unchanged.
- [ ] Risk calculations are unchanged.
- [ ] Accounting semantics are unchanged.
- [ ] Trade lifecycle semantics are unchanged.
- [ ] Persistence behavior is unchanged except for confirmed bug fixes explicitly required by this milestone.

## Engineering

- [ ] Shared UI duplication is reduced (reuse over duplication).
- [ ] No unjustified dependency has been introduced.
- [ ] Lint passes.
- [ ] Typecheck passes.
- [ ] Build passes.
- [ ] Unit tests pass.
- [ ] Relevant targeted E2E tests pass.

---

# 20. Definition of Done

The milestone is complete when:

1. the existing design system is applied coherently across the current product surfaces;
2. major screens use it consistently;
3. visual inconsistencies are materially reduced;
4. TradingJournal's existing domain behavior remains intact;
5. the repository quality gates pass (`make lint`, `make typecheck`, `make build`, `make test-all`);
6. light- and dark-theme screenshot UAT passes at the required viewports;
7. no unresolved P0/P1 UX defects created by the milestone remain;
8. downstream ideas have been deferred rather than absorbed into this milestone.

---

# 21. Scope-Control Rule

When desirable functionality outside this milestone is discovered:

> **Do not implement it immediately.**

Classify it into the downstream pipeline:

```text
Dashboard architecture / panels / saved layouts
→ Workstation Architecture

Trade lifecycle / management
→ Trading Workflow

Metrics / analytics / charts
→ Analytics & Review

Imports / onboarding / final polish
→ Product Polish

Optional upstream Tradenza contribution
→ post-v1.0 evaluation
```

---

# 22. Roadmap Pipeline (labels only)

Milestone IDs are assigned by the GSD workflow. The roadmap pipeline is:

```text
UX Foundation / Consistency        (this milestone; formerly labelled v0.8)
→ Workstation Architecture
→ Trading Workflow
→ Analytics & Review
→ Product Polish
→ v1.0 Readiness
```

## Workstation Architecture

Purpose:

> Formalize TradingJournal as a curated active-trading workstation.

Planned scope:

- declarative panel registry;
- Live / Performance / Process zones;
- saved workstation views;
- layout editing;
- reset/default layouts;
- account context;
- date context where semantically appropriate;
- performance-unit context;
- clean panel-extension architecture.

Do not implement a completely unrestricted generic dashboard builder.

## Trading Workflow

Purpose:

> Optimize the complete trading lifecycle.

```text
Idea
→ Planned
→ Open
→ Managed
→ Closed
→ Reviewed
```

Planned scope:

- planned-trade UX;
- pre-trade checklist;
- entry/execution workflow;
- open-position UX;
- stop/target management;
- execution history;
- trade detail;
- closed-trade transition;
- review workflow;
- screenshots;
- notes.

## Analytics & Review

Purpose:

> Establish a centralized deterministic analytical layer and high-quality review experience.

Planned scope:

- metric-engine consolidation;
- canonical metric definitions;
- expectancy;
- profit factor;
- payoff ratio;
- R statistics;
- drawdowns;
- setup analytics;
- strategy analytics;
- behavioral metrics;
- grades;
- mistakes;
- ECharts improvements;
- distributions;
- comparative analytics;
- golden metric tests.

## Product Polish

Purpose:

> Move TradingJournal from a strong workstation to a complete polished product.

Planned scope:

- CSV import wizard;
- mapping;
- validation;
- preview;
- duplicate handling;
- import history;
- onboarding;
- first-run UX;
- keyboard workflows;
- secondary responsive work;
- accessibility;
- performance;
- final consistency review.

## v1.0 Readiness

The pipeline converges on:

> **TradingJournal v1.0 — Stable Local-First Trading Workstation**

It should reliably cover:

```text
Planning
+
Execution
+
Position Management
+
Risk
+
Account State
+
Performance
+
Review
```

with a coherent professional UX.

---

# 23. Post-v1.0 Candidates

Possible later work:

- broker-specific import adapters;
- additional broker integrations;
- MAE/MFE enrichment;
- advanced strategy analytics;
- AI-assisted reviews;
- automated review summaries;
- additional market-data integrations;
- selected contributions to Tradenza or other open-source trading-journal projects.

---

# 24. Final Orchestrator Directive

Execute this milestone under the following instruction:

> **Refine and consistently apply TradingJournal's existing Graphite + Steel Blue design system across the current user-facing product. Treat `PRODUCT.md`, `docs/design-system/`, `src/app/globals.css`, `src/lib/chart-palette.ts`, `src/components/ui/*`, and `AGENTS.md` as authoritative. Inspect `https://github.com/HonzaPrikryl/Tradenza` as an external UX benchmark for hierarchy, composition, density, interaction patterns, and state presentation, but do not replace TradingJournal's design system or architecture with Tradenza's. Execute the milestone as user-visible vertical GSD slices, preserve all domain/accounting/risk/metric semantics, and defer workstation architecture, workflow redesign, analytics expansion, and import redesign to their downstream milestones. Passing the repository quality gates and light/dark screenshot-based UAT are required for completion.**

When ambiguous, prefer:

```text
existing design-system authority > external benchmark
consistency > novelty
reuse > duplication
clarity > decoration
information density > excessive whitespace
domain stability > opportunistic refactoring
vertical user-visible slices > horizontal refactor packages
small coherent changes > broad rewrites
```
