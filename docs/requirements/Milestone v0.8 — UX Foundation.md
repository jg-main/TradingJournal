# Milestone v0.8 — UX Foundation

## Status

**Pipeline position:** 1 of 5 core milestones before v1.0
**Type:** UX / design-system consolidation
**Priority:** High
**Risk:** Low–Medium

---

# 1. Context

TradingJournal is the current application being developed in this repository:

**Canonical project:**
`https://github.com/jg-main/TradingJournal`

TradingJournal is intended to become a **local-first trading workstation**, covering the complete trader lifecycle:

```text
Planning
→ Execution
→ Position Management
→ Risk
→ Account State
→ Performance
→ Review
```

The core trading-domain functionality is already substantially implemented.

The primary objective of this milestone is therefore **not to add functionality**, but to improve visual consistency, UX quality, information hierarchy, reusable components, and interaction polish.

---

# 2. External UX Benchmark: Tradenza

During this milestone, use the following external open-source project as a **UX and product-design benchmark**:

**Reference project:**
`https://github.com/HonzaPrikryl/Tradenza`

Tradenza is another trading-journal application with a more polished current user interface in several areas, particularly:

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

TradingJournal is intended to remain a **local-first active trading workstation**, with capabilities such as:

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

> **a UX reference, not a replacement architecture and not a dependency.**

---

# 3. Reference Repository Inspection

As part of the initial audit, inspect the current Tradenza repository.

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

When identifying a useful pattern, extract the **design principle** and implement it using TradingJournal's own components and architecture.

Example:

```text
Observed in Tradenza:
Consistent compact KPI cards with clear value hierarchy.

Correct response:
Implement a reusable TradingJournal KPI primitive.

Incorrect response:
Copy the Tradenza KPI component into TradingJournal.
```

---

# 4. Licensing Constraint

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

# 5. Purpose

Improve TradingJournal's UX foundation before additional workstation, workflow, and analytics development.

This milestone establishes:

- one visual language;
- one typography hierarchy;
- one spacing system;
- one semantic color system;
- one component vocabulary;
- consistent tables;
- consistent forms;
- consistent dialogs;
- consistent interaction states;
- consistent page structure;
- consistent application shell.

---

# 6. Governing Principle

This milestone changes:

> **How TradingJournal presents information.**

It must NOT change:

> **What TradingJournal stores, calculates, or means.**

Given identical input data before and after this milestone, trading/accounting/risk outputs must remain semantically equivalent.

---

# 7. Primary Outcome

At milestone completion, all major TradingJournal screens should clearly appear to belong to the same professionally designed application.

The UX should feel deliberate rather than accumulated.

The application should remain optimized for a **dense desktop trading workstation**, not for a generic consumer SaaS aesthetic.

---

# 8. Scope

## 8.1 Design Tokens

Create or normalize semantic tokens.

### Surface

```text
background
surface
surface-elevated
surface-muted
```

### Text

```text
text-primary
text-secondary
text-muted
```

### Borders

```text
border-default
border-subtle
```

### Semantic states

```text
positive
negative
warning
info
neutral
focus
selected
hover
disabled
```

Trading-related semantics must be consistent.

Example:

```text
profit / favorable value      → positive
loss / adverse value          → negative
stale market data             → warning
unavailable/error state       → error
neutral informational value   → neutral
```

Do not communicate critical state through color alone.

---

# 9. Typography

Define a deliberate hierarchy covering:

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

---

# 10. Spacing and Layout

Normalize:

- page margins;
- content gutters;
- vertical section spacing;
- card padding;
- grid gaps;
- table row heights;
- form spacing;
- dialog spacing;
- icon/button spacing.

Prefer a controlled spacing scale rather than one-off values.

---

# 11. Application Shell

Normalize the application's global structure.

Target conceptual structure:

```text
Application
│
├── Navigation / Sidebar
│
└── Main
    ├── Page Header
    │   ├── Title
    │   ├── Optional context
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
- page maximum width where relevant;
- page-title positioning;
- action placement;
- content alignment.

Do not restructure the application's information architecture in this milestone.

---

# 12. Shared UI Primitives

Prefer existing components where adequate.

Refactor duplicated implementations into reusable primitives where doing so materially improves consistency.

At minimum review:

```text
Button
Card / Panel
KPI
Badge
Table
PageHeader
Input
Textarea
Select
Tabs
Dialog
Alert
EmptyState
Skeleton
Tooltip
```

Do not introduce a new UI framework unless clearly necessary.

---

# 13. Buttons

Normalize variants such as:

```text
Primary
Secondary
Ghost
Destructive
Icon
```

Standardize:

- size;
- padding;
- radius;
- typography;
- icon alignment;
- hover;
- active;
- focus;
- disabled;
- loading.

Primary buttons should remain visually distinctive and used sparingly.

---

# 14. Cards and Panels

Use consistent panel structure.

Conceptually:

```text
┌─────────────────────────────────────┐
│ Title                      Actions  │
│ Optional supporting context         │
├─────────────────────────────────────┤
│                                     │
│ Content                             │
│                                     │
└─────────────────────────────────────┘
```

Allow controlled variants such as:

```text
standard
compact
KPI
warning
```

Avoid page-specific card implementations when a shared primitive is appropriate.

---

# 15. Tables

Tables are a critical workstation component.

Optimize for **clarity + density**.

Normalize:

- header styling;
- row height;
- borders;
- hover;
- selected state;
- column spacing;
- numeric alignment;
- truncation;
- sorting presentation;
- action columns;
- overflow;
- empty state;
- loading state.

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

---

# 16. KPI Presentation

Normalize KPI components.

Conceptual anatomy:

```text
Label
Primary value
Optional context
Optional state/change
```

Examples:

```text
Net P&L
+$12,450
```

```text
Open Risk
$2,310
3.2% equity
```

```text
Profit Factor
2.14
```

Do not introduce new KPIs during this milestone.

---

# 17. Badges and Statuses

Normalize semantics for states including:

```text
Planned
Open
Closed

Long
Short

Live
Stale
Unavailable

Warning
Error

Grade
Setup
```

Avoid arbitrary colors per component.

---

# 18. Forms

Normalize:

- field labels;
- input heights;
- focus state;
- borders;
- placeholders;
- helper text;
- validation text;
- textarea styling;
- selects;
- date fields;
- number inputs;
- grouped fields;
- section spacing.

Existing business validation must remain unchanged unless correcting an existing confirmed defect.

---

# 19. Dialogs

Normalize:

- width;
- heading;
- content;
- footer;
- button order;
- backdrop;
- close behavior;
- spacing;
- keyboard behavior;
- destructive confirmation.

Destructive operations must remain explicit.

---

# 20. Tabs

Normalize:

- active state;
- inactive state;
- hover;
- focus;
- spacing;
- optional counts.

The same tab pattern should look and behave consistently across the application.

---

# 21. Loading States

Prefer structural skeletons.

Desired behavior:

```text
Shell renders
↓
Expected content geometry appears
↓
Data populates
```

Avoid unnecessary whole-page spinners.

Prevent large layout shifts where practical.

---

# 22. Empty States

Useful empty states answer:

1. What is empty?
2. Why might it be empty?
3. What should the user do?

Example:

```text
No planned trades

Trades prepared for future execution will appear here.

[Add planned trade]
```

Keep copy concise.

---

# 23. Error States

Errors should:

- explain what failed;
- preserve unaffected surrounding UI;
- provide retry where meaningful;
- avoid exposing irrelevant technical traces.

Example:

```text
Market prices could not be refreshed.

Stored prices are still being displayed.

[Retry]
```

---

# 24. Focus and Disabled States

Interactive controls must have intentional:

```text
hover
focus
active
disabled
loading
```

Keyboard focus must remain visible.

Do not replace semantic controls with clickable generic containers merely for styling.

---

# 25. Financial Formatting

Consolidate presentation formatting where appropriate without changing underlying values.

### Currency

```text
$12,450
-$1,240
$0
```

### Percentage

```text
+3.24%
-1.12%
0.00%
```

### R

```text
+2.4R
-1.0R
0.0R
```

### Quantity

```text
1,250
```

### Missing value

Prefer:

```text
—
```

Do not inconsistently mix:

```text
NA
N/A
-
--
null
undefined
```

unless they genuinely represent different states.

---

# 26. Responsive Targets

TradingJournal remains primarily desktop-first.

Validate at minimum:

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

# 27. Accessibility Baseline

Modified/new UI should preserve basic accessibility.

At minimum:

- visible focus;
- form labels;
- semantic buttons;
- semantic table markup where practical;
- keyboard-accessible dialogs;
- appropriate headings;
- sufficient contrast;
- state not communicated by color alone.

---

# 28. Pages in Scope

Inspect the current repository and determine the actual route structure.

At minimum normalize major surfaces representing:

- Dashboard / Workstation;
- Open Trades / Positions;
- Closed Trades;
- Planned Trades;
- Trade Detail;
- Trade creation/editing;
- Accounts;
- Reviews;
- Watchlist if currently active;
- primary settings/configuration pages.

Do not assume route names without inspecting the repository.

---

# 29. Explicit Non-Goals

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

---

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

---

## No workstation architecture changes

Do not implement:

- panel registry;
- new dashboard zones;
- saved workstation layouts;
- new dashboard customization architecture.

Reserved for:

**v0.9 — Workstation Architecture**

---

## No trading-workflow redesign

Do not redesign:

```text
Planned
→ Open
→ Managed
→ Closed
→ Reviewed
```

Reserved for:

**v0.10 — Trading Workflow**

---

## No analytics expansion

Do not substantially redesign analytical functionality or introduce new charts.

Visual containers may be normalized.

Reserved for:

**v0.11 — Analytics & Review**

---

## No import redesign

Do not build:

- CSV wizard;
- import mapping system;
- broker import presets;
- import history redesign.

Reserved for:

**v0.12 — Product Polish**

---

# 30. Engineering Constraints

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

# 31. Refactoring Policy

Refactor when directly useful to the UX foundation.

Good:

```text
Multiple inconsistent KPI implementations
→ one reusable KPI primitive
```

Good:

```text
Repeated page-header markup
→ reusable PageHeader
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

# 32. Implementation Sequence

## Phase A — Audit

Inspect TradingJournal.

Inventory:

- routes;
- components;
- design tokens;
- colors;
- typography;
- spacing;
- cards;
- tables;
- forms;
- dialogs;
- navigation;
- loading states;
- empty states;
- error states;
- formatting helpers.

Also inspect the external Tradenza reference repository defined above.

Identify:

1. TradingJournal inconsistencies;
2. reusable primitives that already exist;
3. duplicated implementations;
4. Tradenza UX patterns worth conceptually adopting;
5. patterns that should NOT be adopted because they conflict with TradingJournal's workstation purpose.

Produce a concise internal implementation plan.

Avoid producing a large standalone design document unless required by the GSD workflow.

---

## Phase B — Design Foundation

Normalize:

- tokens;
- typography;
- spacing;
- surfaces;
- borders;
- state semantics;
- formatting conventions.

---

## Phase C — Shared Components

Normalize/reuse:

```text
Button
Card
Panel
KPI
Badge
Table
PageHeader
Input
Select
Textarea
Tabs
Dialog
Alert
EmptyState
Skeleton
```

---

## Phase D — Shell

Normalize:

- navigation;
- sidebar;
- page container;
- page header;
- global spacing.

---

## Phase E — Page Migration

Suggested sequence:

```text
1. Dashboard
2. Open Trades / Positions
3. Planned Trades
4. Closed Trades
5. Trade Detail
6. Accounts
7. Reviews
8. Secondary surfaces
```

---

## Phase F — State Consistency

Normalize:

```text
loading
empty
error
disabled
focus
selected
```

---

## Phase G — Final Consistency Pass

Search for remaining:

- hard-coded colors;
- one-off spacing;
- duplicated cards;
- duplicated buttons;
- inconsistent formatting;
- inconsistent loaders;
- inconsistent empty states;
- inconsistent table styles.

---

# 33. GSD Work Packages

Do not execute the milestone as one monolithic change.

Recommended work decomposition:

```text
01-ux-audit-and-reference-analysis
02-design-system-foundation
03-shared-ui-primitives
04-app-shell-navigation
05-dashboard-visual-normalization
06-trade-lists-normalization
07-trade-detail-and-forms
08-accounts-reviews-secondary-pages
09-loading-empty-error-states
10-responsive-accessibility-pass
11-final-ux-consistency-qc
```

Each plan/work package should be independently:

- implemented;
- tested;
- reviewed;
- committed.

Prefer coherent commits.

---

# 34. Testing Requirements

Run the repository's established verification suite.

At minimum, where available:

```text
lint
typecheck
unit tests
build
Playwright / E2E
```

Do not weaken domain tests because of visual changes.

When E2E tests rely on fragile visual selectors, replace them with stable semantic selectors where appropriate.

---

# 35. Visual Validation

Perform screenshot/visual inspection of major pages at:

```text
1440 px
1280 px
1024 px
```

Inspect for:

- clipping;
- broken grids;
- bad wrapping;
- inconsistent spacing;
- table overflow;
- incorrect alignment;
- typography issues;
- dialog overflow;
- loading states;
- empty states;
- error states;
- focus states.

Use screenshot review as a required acceptance step.

---

# 36. Acceptance Criteria

## Design system

- [ ] Semantic color vocabulary is defined and consistently used.
- [ ] Typography hierarchy is consistent.
- [ ] Spacing uses a controlled system.
- [ ] Financial numbers have consistent presentation.
- [ ] Missing-value formatting is consistent.

## Components

- [ ] Buttons use consistent variants.
- [ ] Cards/panels use consistent structure.
- [ ] Tables use consistent density and alignment.
- [ ] KPI presentation is consistent.
- [ ] Forms are consistent.
- [ ] Dialogs are consistent.
- [ ] Tabs are consistent.
- [ ] Status badges follow semantic rules.

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

## Domain safety

- [ ] Trading calculations are unchanged.
- [ ] Risk calculations are unchanged.
- [ ] Accounting semantics are unchanged.
- [ ] Trade lifecycle semantics are unchanged.
- [ ] Persistence behavior is unchanged except for confirmed bug fixes explicitly required by this milestone.

## Engineering

- [ ] Shared UI duplication is reduced.
- [ ] No unjustified dependency has been introduced.
- [ ] Lint passes.
- [ ] Typecheck passes.
- [ ] Build passes.
- [ ] Unit tests pass.
- [ ] Relevant E2E tests pass.

---

# 37. Definition of Done

The milestone is complete when:

1. a coherent UX foundation exists;
2. major screens use it;
3. visual inconsistencies are materially reduced;
4. TradingJournal's existing domain behavior remains intact;
5. automated verification passes;
6. desktop screenshot review passes;
7. no unresolved P0/P1 UX defects created by the milestone remain;
8. downstream ideas have been deferred rather than absorbed into this milestone.

---

# 38. Scope-Control Rule

When desirable functionality outside this milestone is discovered:

> **Do not implement it immediately.**

Classify it into the downstream pipeline.

```text
Dashboard architecture / panels
→ v0.9

Trade lifecycle / management
→ v0.10

Metrics / analytics / charts
→ v0.11

Imports / onboarding / final polish
→ v0.12

Optional upstream Tradenza contribution
→ post-v1.0 evaluation
```

---

# 39. Remaining Milestone Pipeline

## v0.9 — Workstation Architecture

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

---

## v0.10 — Trading Workflow

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

---

## v0.11 — Analytics & Review

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

---

## v0.12 — Product Polish

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

---

# 40. v1.0 Target

The core pipeline converges on:

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

# 41. Post-v1.0 Candidates

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

# 42. Final Orchestrator Directive

Execute this milestone under the following instruction:

> **Improve TradingJournal's visual system, reusable UI primitives, application shell, information hierarchy, and interaction-state consistency. Preserve all trading-domain behavior, metric semantics, persistence semantics, risk calculations, and existing workflows. Inspect `https://github.com/HonzaPrikryl/Tradenza` as an external UX benchmark during the audit, but treat it only as a reference: do not make TradingJournal dependent on it, do not migrate TradingJournal onto its architecture, and prefer conceptual adaptation over source copying. Do not introduce functionality reserved for downstream milestones. Automated verification and screenshot-based visual review are required completion criteria.**

When ambiguity exists, prefer:

```text
consistency > novelty
reuse > duplication
clarity > decoration
information density > excessive whitespace
domain stability > opportunistic refactoring
small coherent changes > broad rewrites
```
