# Milestone — Workstation Architecture Evolution

## Status

**Pipeline position:** 2 of 6 roadmap phases before v1.0 Readiness
**Depends on:** UX Foundation / Consistency completed
**Type:** Workstation architecture audit and targeted evolution
**Priority:** High
**Risk:** Medium–High
**Primary principle:** **evolve the existing architecture; do not rebuild it**

---

# 1. Context

TradingJournal is a **local-first active trading workstation** whose primary workstation must answer, with minimal friction:

```text
What positions are open?
What is currently at risk?
What is my account state?
Is the market-data state trustworthy?
How am I performing?
What requires review or attention?
```

The workstation architecture is **already substantially implemented**.

Existing capabilities include, or are expected to include based on prior workstation milestones:

- approved workstation panel catalogue;
- curated system templates;
- Risk & Positions default view;
- saved workstation views;
- validated and versioned view configuration;
- persisted layouts;
- panel hide/show;
- explicit customization mode;
- Save / Cancel / Undo / Reset;
- arrangement mode;
- constrained drag/resize;
- protected Main Risk Metrics and Trades anchors;
- account, performance, process/review, watchlist and trade surfaces;
- dashboard-hosted Watchlist and Weekly Review workflows.

The previous roadmap therefore explicitly defines this milestone as an **architecture evolution milestone**, not an architecture build.

The milestone must begin by establishing what is actually complete, what needs refinement, what is genuinely missing, and what should deliberately remain unimplemented.

---

# 2. Purpose

Audit and evolve TradingJournal's current workstation architecture only where current product needs expose real gaps.

The desired result is:

> **A stable, extensible, risk-first workstation architecture capable of supporting the Trading Workflow, Analytics & Review Expansion, Product Polish, and v1.0 milestones without requiring repeated structural dashboard rewrites.**

This milestone is primarily about **architectural contracts, context ownership, extension boundaries, saved-view safety, layout semantics, and future maintainability**.

It is not primarily a visual-redesign milestone.

---

# 3. Governing Rule

> **Current repository evidence wins over roadmap assumptions.**

Do not implement a capability merely because it is mentioned in this requirement.

For every proposed architectural change:

```text
Inspect current implementation
→ determine whether capability already exists
→ identify concrete deficiency
→ implement only the deficiency
```

If an existing implementation already satisfies the requirement:

```text
verify it
document it if necessary
test it if coverage is insufficient
mark the requirement satisfied
do not rebuild it
```

---

# 4. Authoritative Sources

Before planning implementation, inspect:

```text
AGENTS.md
PRODUCT.md

docs/design-system/README.md
docs/design-system/workstation.md
docs/design-system/tokens.md

src/lib/workstation-view-types.ts
src/components/workstation/*
src/app/(workstation)/*
```

Also discover and inspect the current implementations responsible for:

```text
workstation saved-view persistence
view configuration validation
layout migration/versioning
customization state
account selection/context
date/range selection
performance units
shared workstation data fetching
market-data freshness
responsive workstation layout
```

Do not assume exact filenames for these secondary concerns without repository inspection.

---

# 5. Existing Architecture Is the Baseline

The following capabilities must be treated as **existing architecture unless S01 proves otherwise**.

## 5.1 Panel catalogue

TradingJournal already has an approved first-party workstation panel catalogue.

Do not replace it with:

- arbitrary component registration;
- executable configuration;
- user-provided component names;
- arbitrary queries;
- dynamic remote widgets.

The workstation remains a controlled first-party environment.

---

## 5.2 Curated templates

Existing curated system views/templates are intentional.

The workstation is not intended to become a blank canvas.

The default experience must continue to prioritize:

```text
Data Quality / Trust
↓
Main Risk Metrics
↓
Account / Performance context
↓
Trades Workspace
```

Other views may emphasize performance or process/review, but the system default remains risk-first.

---

## 5.3 Saved views

Saved views are an existing capability.

Preserve:

- validation;
- versioning;
- persistence;
- migration safety;
- template ancestry where currently modeled;
- safe reset behavior;
- compatibility with existing user-owned views.

Do not introduce a second saved-view system.

---

## 5.4 Arrangement mode

Drag/resize behavior already exists.

Preserve the distinction:

```text
Normal mode
→ workstation is for reading and trading

Customize / Arrange mode
→ explicit editing state
```

Normal workstation use must not expose distracting layout-editing chrome.

---

## 5.5 Protected anchors

Safety-critical areas remain protected.

At minimum, preserve the current architectural intent that:

```text
Main Risk Metrics
Trades Workspace
```

are not casually removable or rearranged in ways that undermine the risk-first workstation.

Data-quality/trust state must likewise remain structurally prominent.

---

# 6. Architecture Objectives

The audit should evaluate the architecture against the following objectives.

---

## 6.1 Panel Extension Contract

Adding a legitimate future workstation panel should not require broad dashboard surgery.

The desired developer experience is conceptually:

```text
implement panel
→ declare/register supported metadata
→ connect approved data contract
→ define allowed layout behavior
→ test
→ available to appropriate views
```

Evaluate whether the existing panel catalogue provides sufficient metadata for future needs.

Potential metadata may include, **only if evidence shows it is needed**:

```text
id
title
description
category / role
default visibility
canHide
canDrag
canResize
layout bounds
supported contexts
data scope
historical vs live semantics
```

Do not add metadata speculatively.

---

## 6.2 Context Ownership

The workstation must have clear ownership for shared context.

Audit at minimum:

### Account context

Determine:

- where selected account state is owned;
- which panels consume it;
- whether panels independently duplicate account selection;
- whether changing account propagates consistently;
- whether saved views incorrectly persist transient account selection.

There should be one clear owner for shared account context.

---

### Date / period context

Historical analytics may need:

```text
YTD
12M
3M
1M
custom
```

or the repository's currently supported ranges.

But **live state must not blindly inherit historical date filters**.

Examples:

```text
Open Risk
Current Positions
Current Market Marks
Portfolio Heat
Data Freshness
```

are current-state concepts.

They should not disappear or change meaning because the user selects a retrospective analytics period.

By contrast:

```text
Closed-trade performance
Win rate
Profit factor
Expectancy
Historical returns
Review analytics
```

may legitimately use historical periods.

The architecture must make this distinction explicit.

---

### Performance unit context

Audit whether performance presentation needs a coherent shared unit context such as:

```text
$
%
R
```

Do not implement a global unit switch merely because this roadmap mentions it.

First determine:

- what already exists;
- which metrics can validly support each unit;
- whether global switching improves usability;
- whether some metrics have fixed semantics.

If implemented, unit context must not alter underlying metric definitions.

---

## 6.3 Live vs Historical Data Contract

The workstation must preserve a strong conceptual separation between:

```text
LIVE / CURRENT STATE
and
HISTORICAL / RETROSPECTIVE ANALYTICS
```

Audit for accidental coupling.

Conceptually:

```text
Live State
├── market marks
├── positions
├── unrealized P&L
├── current open risk
├── portfolio heat
├── account state
└── freshness / trust

Historical
├── closed P&L
├── returns
├── expectancy
├── profit factor
├── R distributions
├── setup analytics
└── review metrics
```

Do not let retrospective filters alter live-state semantics unless explicitly meaningful.

---

# 7. Data Ownership and Fetching

Follow the repository rule:

> Give shared state one clear owner.

Audit workstation data flows for:

- duplicate API calls;
- multiple panels fetching the same account state;
- duplicated market-data refreshes;
- duplicated position derivations;
- duplicated metric calculations;
- independent copies of shared filters;
- unnecessary React state mirrors.

Prefer:

```text
canonical domain computation
→ API / typed adapter
→ shared workstation state where appropriate
→ panels
```

Avoid:

```text
Panel A → fetches same state independently
Panel B → fetches same state independently
Panel C → reimplements calculation locally
```

Do not create a large global store unless evidence demonstrates that one is required.

Use the simplest ownership model compatible with clear state boundaries.

---

# 8. Market-Data Trust Semantics

Current market-state reliability is a workstation-level concern.

The architecture must preserve meaningful distinctions such as:

```text
live / current
stale
missing
unavailable
refresh failed
```

Do not allow a panel to present current P&L/risk as authoritative when the underlying market marks are known to be stale or unavailable.

Audit:

- where freshness metadata is owned;
- how panels consume it;
- whether refresh state is duplicated;
- whether stale state is visually and semantically consistent;
- whether live-state panels can explain their data condition.

This milestone must not redefine the market-data domain semantics.

It may improve architectural propagation of already-defined state.

---

# 9. Saved-View Architecture

Audit saved views as a persistent user-owned contract.

Verify:

```text
schema validation
layout versioning
migration behavior
unknown-panel handling
invalid configuration handling
template reset
user-view preservation
safe defaults
```

Required behavior:

- invalid persisted configuration must not break workstation startup;
- unknown/future panel IDs must be handled safely according to current migration policy;
- migrations must preserve user-owned views whenever representable;
- system templates remain immutable where currently intended;
- reset returns to the appropriate template baseline;
- saved layout configuration must contain data/configuration only, never executable code.

---

# 10. Layout Architecture

Audit normal rendering and arrangement rendering separately.

## Normal mode

Optimize for:

- workstation readability;
- predictable document flow;
- no unnecessary nested scrollbars;
- full-width risk/trade areas where required;
- compact summary surfaces;
- stable layouts;
- useful desktop density.

## Arrange mode

Preserve:

- visible drag handles only in explicit arrangement state;
- constrained resizing;
- protected anchors;
- validation before persistence;
- Cancel;
- Save;
- Undo;
- Reset;
- keyboard accessibility where currently supported.

Do not convert normal mode into permanently draggable cards.

---

# 11. Responsive Architecture

TradingJournal remains desktop-first.

Architecture should support useful rendering at:

```text
1440 px
1280 px
1024 px
```

Audit:

- grid behavior;
- panel minimum widths;
- table overflow;
- summary-row behavior;
- customize mode;
- arrangement mode;
- critical risk/state visibility.

Do not solve compact widths by silently hiding safety-critical information.

Mobile-first workstation architecture is out of scope.

---

# 12. Workstation Roles

The architecture should be capable of supporting three conceptual workstation emphases:

```text
Live / Risk
Performance
Process / Review
```

These are **roles**, not necessarily a requirement for new zones, routes, or containers.

Existing curated templates may already satisfy this need.

S01 must determine whether any architectural change is actually required.

Do not introduce a new "zone" abstraction if the existing template/catalogue model already expresses the product adequately.

---

# 13. Required GSD Slice Structure

The milestone must begin with S01.

Do not pre-commit to implementation slices before the audit establishes actual gaps.

---

## S01 — Existing workstation architecture audit

### Inspect

At minimum:

```text
AGENTS.md
PRODUCT.md
docs/design-system/workstation.md

src/lib/workstation-view-types.ts
src/components/workstation/*
src/app/(workstation)/*
```

Discover the exact current implementations for:

- saved views;
- persistence;
- validation;
- migrations;
- customize mode;
- arrangement mode;
- account context;
- date context;
- unit context;
- shared data ownership;
- market-data trust state.

### Produce a capability matrix

Classify each area:

| Capability                    | Classification                         |
| ----------------------------- | -------------------------------------- |
| Panel catalogue               | Complete / Refine / Missing / Obsolete |
| Curated templates             | Complete / Refine / Missing / Obsolete |
| Saved views                   | Complete / Refine / Missing / Obsolete |
| Validation                    | Complete / Refine / Missing / Obsolete |
| Versioning/migration          | Complete / Refine / Missing / Obsolete |
| Hide/show                     | Complete / Refine / Missing / Obsolete |
| Arrange mode                  | Complete / Refine / Missing / Obsolete |
| Drag/resize constraints       | Complete / Refine / Missing / Obsolete |
| Protected anchors             | Complete / Refine / Missing / Obsolete |
| Account context               | Complete / Refine / Missing / Obsolete |
| Date/period context           | Complete / Refine / Missing / Obsolete |
| Performance-unit context      | Complete / Refine / Missing / Obsolete |
| Live/historical separation    | Complete / Refine / Missing / Obsolete |
| Shared data ownership         | Complete / Refine / Missing / Obsolete |
| Market-data trust propagation | Complete / Refine / Missing / Obsolete |
| Responsive architecture       | Complete / Refine / Missing / Obsolete |

For every item classified **Refine** or **Missing**, document:

```text
current behavior
concrete deficiency
user/product impact
proposed architectural change
affected files/contracts
verification strategy
```

### Exit rule

If no material architectural gap exists in an area:

> mark it complete and do not create an implementation slice for it.

---

# 14. Subsequent Slice Planning

After S01, generate only the vertical slices justified by audit evidence.

Likely categories may include the following, but these are **not mandatory slices**.

---

## Candidate S02 — Shared workstation context

Only if S01 identifies deficiencies in:

- account context;
- period context;
- performance units;
- filter propagation;
- panel scope semantics.

Outcome must be observable through actual workstation workflows.

---

## Candidate S03 — Saved-view lifecycle hardening

Only if S01 identifies deficiencies in:

- persistence;
- migration;
- versioning;
- validation;
- reset;
- compatibility.

Outcome should be a safer user-owned view lifecycle, not an abstract refactor.

---

## Candidate S04 — Panel extension and layout contract

Only if S01 demonstrates that future panel additions currently require unnecessary workstation surgery.

Improve the existing catalogue/metadata contract rather than introducing a parallel registry.

---

## Candidate S05 — Live-state architecture

Only if S01 identifies problematic coupling between:

```text
current/live state
historical filters
market-data freshness
shared data ownership
```

Outcome should be reliable operational state.

---

## Candidate S06 — Workstation ergonomics / responsive architecture

Only if structural issues remain after UX Foundation / Consistency.

Focus on architectural layout behavior rather than another visual-redesign pass.

---

## Final slice — Architecture UAT and contract closure

Always perform a final verification slice appropriate to the actual changes made.

---

# 15. Explicit Non-Goals

## No generic dashboard builder

Do not build:

- arbitrary user widgets;
- plugin marketplace;
- user-authored queries;
- executable layouts;
- remotely loaded panels;
- unrestricted component registration.

---

## No design-system replacement

Do not replace:

- Graphite + Steel Blue;
- existing semantic tokens;
- normalized primitives;
- workstation CSS conventions.

Visual inconsistencies belong to the completed UX Foundation / Consistency milestone unless architectural changes directly require presentation work.

---

## No Trading Workflow redesign

Do not redesign:

```text
Idea
→ Planned
→ Open
→ Managed
→ Closed
→ Reviewed
```

That belongs to the downstream **Trading Workflow** milestone.

Small UI adaptations required to prove architecture are allowed, but do not absorb the workflow milestone.

---

## No analytics expansion

Do not add:

- new strategy analytics;
- new expectancy metrics;
- MAE/MFE;
- new retrospective analytical engines;
- broad chart expansion.

That belongs to **Analytics & Review Expansion**.

---

## No import redesign

CSV/import architecture belongs to **Product Polish**.

---

## No domain-semantic changes

Do not change:

- FIFO;
- account ledger;
- execution semantics;
- risk calculations;
- R semantics;
- mark-to-market definitions;
- win-rate policy;
- trade-state semantics;
- market-data freshness definitions.

Architectural refactoring must preserve existing outputs unless a separately approved defect requires correction.

---

# 16. Computation Ownership

Canonical computation libraries remain authoritative.

Do not move calculation logic into workstation components.

Where workstation architecture needs derived values:

```text
existing canonical computation
→ existing/new typed adapter where required
→ workstation presentation
```

Do not create parallel versions of:

- P&L;
- R;
- risk;
- account summary;
- mark-to-market;
- position sizing;
- canonical metrics.

---

# 17. Engineering Constraints

Preserve unless a concrete audited deficiency requires change:

```text
Next.js
React
SQLite
Drizzle
ECharts
react-grid-layout
local-first architecture
current component system
```

New dependencies require documented justification.

Prefer extending the existing architecture over importing a new dashboard/state-management framework.

---

# 18. Refactoring Policy

Allowed:

```text
duplicated shared workstation context
→ one clear owner

panel-specific duplicate layout metadata
→ existing catalogue extended with justified metadata

unsafe persisted-config parsing
→ validated migration boundary

duplicate data fetch
→ shared typed source
```

Not allowed:

```text
workstation architecture audit
→ application-wide state-management rewrite

layout refinement
→ new generic dashboard framework

context cleanup
→ domain computation rewrite
```

---

# 19. Testing and Verification

Follow `AGENTS.md`.

At each completed implementation slice, run separately:

```bash
make lint
make typecheck
make build
make test-all
```

Run targeted Playwright/browser verification for every user-facing workstation behavior changed by the slice.

Use focused unit/contract tests for:

- view validation;
- migration;
- layout normalization;
- catalogue rules;
- context propagation;
- state ownership;
- live/historical semantics;

where applicable.

Do not run the complete multi-browser matrix after every task.

At milestone completion, run the repository-required milestone-level browser/UAT matrix.

---

# 20. Architecture Safety Tests

Where the milestone touches these areas, tests should prove relevant invariants.

Examples:

```text
protected panels cannot be removed
unknown panel ids are rejected or safely migrated
invalid saved views cannot break startup
future/unsupported layout versions fail safely
Cancel does not persist draft changes
Save persists valid configuration
Reset restores template state
historical range does not alter current open-risk semantics
account context propagates consistently
stale market data remains explicitly stale
normal mode exposes no accidental drag/resize behavior
```

Do not add tests for behaviors that do not exist or are not changed merely to inflate coverage.

---

# 21. Visual / Interaction UAT

For affected workstation surfaces validate:

```text
Light
Dark
```

at:

```text
1440 px
1280 px
1024 px
```

Check:

- risk state remains prominent;
- trades remain operationally usable;
- summary panels remain readable;
- no nested scrolling regression;
- no layout overflow;
- normal vs customize mode remains clear;
- drag/resize chrome appears only when appropriate;
- saved-view controls remain understandable;
- keyboard/focus behavior remains usable;
- market-data trust state remains visible.

---

# 22. Acceptance Criteria

## Audit

- [ ] Existing capabilities are inventoried before implementation.
- [ ] Every proposed architectural change has a documented concrete gap.
- [ ] Already-complete capabilities are not rebuilt.
- [ ] Obsolete/not-desirable ideas are explicitly rejected rather than implemented.

## Architecture

- [ ] Existing panel catalogue remains the approved panel authority.
- [ ] Curated risk-first default remains intact.
- [ ] Protected workstation anchors remain protected.
- [ ] Saved views remain validated and versioned.
- [ ] User-owned layouts survive supported migrations.
- [ ] Invalid configuration fails safely.
- [ ] Arrangement remains an explicit edit mode.
- [ ] Normal workstation mode remains stable and uncluttered.

## Context

- [ ] Shared account context has one clear owner.
- [ ] Historical period context does not incorrectly alter live state.
- [ ] Any performance-unit context has explicit supported semantics.
- [ ] Panels do not independently create conflicting copies of shared filters.

## Data

- [ ] Shared workstation data has clear ownership.
- [ ] No unnecessary duplicate calculation paths are introduced.
- [ ] No unnecessary duplicate live-data refresh loops are introduced.
- [ ] Market-data freshness/trust state remains semantically correct.

## Domain safety

- [ ] P&L semantics are unchanged.
- [ ] R semantics are unchanged.
- [ ] Risk semantics are unchanged.
- [ ] Accounting/FIFO semantics are unchanged.
- [ ] Trade-state semantics are unchanged.
- [ ] Market-data state definitions are unchanged.

## Engineering

- [ ] Lint passes.
- [ ] Typecheck passes.
- [ ] Build passes.
- [ ] `make test-all` passes.
- [ ] Targeted E2E/browser tests pass.
- [ ] Milestone-level UAT passes.

---

# 23. Definition of Done

This milestone is complete when:

1. the existing workstation architecture has been explicitly audited;
2. actual architectural gaps have been identified and resolved;
3. capabilities already implemented were preserved rather than rebuilt;
4. panel/view/layout architecture is sufficient for the next v1.0 milestones;
5. live and historical context semantics are unambiguous;
6. shared context and data ownership are clear;
7. saved-view persistence remains safe, validated and migration-aware;
8. the curated risk-first workstation remains intact;
9. domain computations and semantics remain unchanged;
10. repository quality gates pass;
11. browser/UAT evidence confirms affected workstation workflows remain usable in both themes and target desktop widths;
12. remaining workflow, analytics and polish ideas are deferred to their appropriate downstream milestones.

---

# 24. Downstream Pipeline

After this milestone:

```text
✅ UX Foundation / Consistency
→ Workstation Architecture Evolution      ← this milestone
→ Trading Workflow
→ Analytics & Review Expansion
→ Product Polish
→ v1.0 Readiness
```

---

# 25. Scope-Control Routing

When new work is discovered:

```text
Trade lifecycle / planning / management / review workflow
→ Trading Workflow

Metrics / strategy analytics / behavioral analytics / charts
→ Analytics & Review Expansion

CSV / onboarding / first-run / general polish
→ Product Polish

Release hardening / migration / recovery / final audit
→ v1.0 Readiness
```

Critical integrity defects should be handled according to `AGENTS.md` rather than deferred solely because they fall outside roadmap scope.

---

# 26. Final Orchestrator Directive

> **Audit and evolve TradingJournal's existing workstation architecture; do not rebuild it. Treat the current panel catalogue, curated templates, saved views, validated/versioned configuration, explicit customization/arrangement modes, persistence model, and protected risk/trades anchors as the baseline unless repository inspection proves otherwise. Begin with a capability/gap audit and create implementation slices only for concrete deficiencies. Preserve the curated risk-first workstation, local-first architecture, Graphite + Steel Blue design system, canonical computation libraries, domain/accounting/risk semantics, and market-data trust semantics. Establish clear ownership for workstation contexts and shared data, keep live/current state separate from retrospective period filtering, maintain safe saved-view migration and validation, and avoid turning TradingJournal into an unrestricted generic dashboard builder. Passing repository quality gates and targeted workstation browser/UAT evidence are required for completion.**

When ambiguous, prefer:

```text
current repository evidence > roadmap assumption
evolve existing architecture > rebuild
concrete product gap > speculative abstraction
curated workstation > generic widget builder
risk-first default > unrestricted customization
single state owner > duplicated context
live-state semantics > retrospective-filter convenience
validated configuration > flexible unsafe configuration
canonical computation > UI-local calculation
domain stability > opportunistic refactoring
small vertical change > broad architectural rewrite
```
