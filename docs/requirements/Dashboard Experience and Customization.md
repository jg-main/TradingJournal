# Milestone — Dashboard Experience & Customization

## Status

**Pipeline position:** Next milestone after M026 — Workstation Architecture Evolution
**Type:** Analytical dashboard experience, filtering, widget configuration, and saved dashboard composition
**Priority:** High
**Risk:** Medium–High
**Primary product benchmark:** Tradenza
**Primary architectural principle:** **build on the existing workstation architecture; do not replace it**

---

# 1. Purpose

Create a new **Tradenza-inspired analytical Performance dashboard** for TradingJournal that is:

- globally filterable;
- configurable;
- composed from typed first-party widgets;
- persistent through saved dashboard views;
- capable of supporting multiple analytical metrics and charts;
- extensible by the later Analytics & Review Expansion milestone.

The target experience is:

```text
Performance Dashboard
│
├── Global filter bar
│   ├── Account(s)
│   ├── Date range
│   ├── Filters
│   └── Performance unit
│
├── Configurable KPI cards
│
├── Configurable analytical charts
│
├── Configurable analytical widgets
│
└── Saved dashboard views
```

The new dashboard should adopt useful UX patterns from Tradenza while preserving TradingJournal's:

- local-first architecture;
- canonical domain calculations;
- Graphite + Steel Blue visual identity;
- typed widget catalogue;
- existing saved-view/layout architecture;
- accounting and risk semantics.

---

# 2. Critical Migration Rule — Preserve the Current Dashboard

The existing TradingJournal dashboard at:

```text
/
```

must remain intact throughout this milestone.

It is the current production dashboard and must **not** be:

- removed;
- replaced;
- redirected;
- materially redesigned;
- converted to the new analytical dashboard;
- silently migrated.

The new dashboard must be exposed independently at:

```text
/performance
```

The current root dashboard and the new Performance dashboard must coexist.

Conceptually:

```text
/                 → existing current Risk & Positions workstation

/performance      → new configurable analytical Performance dashboard
```

The current dashboard remains the production/default dashboard until the user explicitly approves its removal or replacement in a later decision.

## Hard rule

> **Do not redirect `/` to `/performance`, remove the current dashboard, or promote the new dashboard to the default application surface without explicit user approval after UAT.**

The purpose of this coexistence period is to allow direct comparison between:

```text
current workstation
vs
new analytical dashboard
```

before any migration decision is made.

---

# 3. Product Model

TradingJournal should support distinct dashboard experiences rather than forcing live operational state and retrospective analytics into one surface.

Target conceptual model:

```text
Risk & Positions
→ current/live operational workstation

Performance
→ fully filterable retrospective analytical dashboard

Process Review
→ behavioral/process review experience
```

For this milestone, the primary implementation target is:

> **Performance**

at:

```text
/performance
```

The existing `/` Risk & Positions workstation remains unchanged except for minimal navigation required to expose the new route.

---

# 4. Why the Performance Dashboard Is Separate

M026 established an important invariant:

> Historical or retrospective filters must not change current/live workstation state.

That remains authoritative.

For example:

```text
Date range = Jan 1 → Mar 31
```

must not redefine:

```text
current positions
current market marks
current open risk
portfolio heat
current unrealized P&L
current freshness state
```

Therefore the new `/performance` dashboard is explicitly a **historical / retrospective analytical surface**.

Within `/performance`:

> **Every analytical widget must respond consistently to the global dashboard filter state.**

This avoids mixed semantics where some widgets use historical filters and some do not.

---

# 5. Existing Architecture Is the Baseline

Before implementation, inspect and reuse the existing architecture created before and during M026.

At minimum inspect:

```text
AGENTS.md
PRODUCT.md

docs/design-system/README.md
docs/design-system/tokens.md
docs/design-system/charts.md
docs/design-system/workstation.md

src/lib/workstation-view-types.ts
src/components/workstation/*
src/lib/metrics.ts
src/lib/trade-calc.ts
src/lib/account-summary.ts
src/lib/risk-snapshot.ts
src/lib/mark-to-market.ts

current dashboard APIs
current performance APIs
current saved-view persistence
current chart implementations
current dashboard widgets
current workstation customization infrastructure
```

Do not assume functionality is missing merely because it is described in this requirement.

Use:

```text
inspect
→ inventory
→ identify gap
→ extend
```

not:

```text
assume
→ rebuild
```

---

# 6. External UX Benchmark — Tradenza

Use Tradenza as the principal external UX benchmark for this milestone.

Reference:

```text
https://github.com/HonzaPrikryl/Tradenza
```

Inspect conceptually for:

- dashboard composition;
- global filter-bar structure;
- KPI-card hierarchy;
- metric presentation;
- analytical card proportions;
- chart hierarchy;
- widget configuration UX;
- information grouping;
- spacing;
- visual density;
- controls;
- filters;
- empty states;
- loading states.

Do not copy source implementations.

Tradenza is:

> **UX reference, not architecture authority.**

TradingJournal's existing design system remains authoritative.

---

# 7. Target Dashboard Composition

The default `/performance` dashboard should conceptually follow:

```text
┌───────────────────────────────────────────────────────────────┐
│ Account(s) │ Date Range │ Filters │ $ / % / R               │
└───────────────────────────────────────────────────────────────┘

┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ KPI     │ │ KPI     │ │ KPI     │ │ KPI     │ │ KPI     │
└─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘

┌───────────────────────┐ ┌───────────────────────┐
│ analytical chart      │ │ analytical chart      │
└───────────────────────┘ └───────────────────────┘

┌─────────────────────────────────────────────────┐
│ additional configurable analytical widgets      │
└─────────────────────────────────────────────────┘
```

This is a composition target, not a requirement to reproduce Tradenza pixel-for-pixel.

---

# 8. Global Performance Filter Bar

The Performance dashboard must have one shared filter owner.

Conceptually:

```text
PerformanceDashboardContext
        │
        ├── Account scope
        ├── Date range
        ├── Advanced filters
        └── Performance unit
```

All analytical widgets must consume that shared context.

Do not allow widgets to independently maintain conflicting copies of these global filters.

---

# 9. Account Filter

The first control should support:

```text
All accounts
One account
Multiple selected accounts
```

The UI may use:

```text
[ All accounts ▾ ]
```

as the default presentation.

## Requirements

- selection is global to the Performance dashboard;
- all analytical widgets respond to it;
- multi-account aggregation must use canonical currency/account semantics;
- invalid account combinations must fail safely;
- account filtering must not mutate the global account selection used by the live `/` workstation unless explicitly designed to do so.

Prefer Performance dashboard account scope to be **dashboard-local analytical context**.

---

# 10. Date Range

Provide a global date-range control such as:

```text
[ Whole period ▾ ]
```

Minimum presets:

```text
Whole period
YTD
1 Year
6 Months
3 Months
1 Month
Custom
```

Additional useful presets may be added if existing product conventions justify them.

---

# 11. Trade Attribution Rule

For realized Performance dashboard metrics:

> **Trades belong to the selected date range by CLOSE DATE.**

Example:

```text
Trade entered:   Jan 28
Trade closed:    Feb 3

January filter   → excluded
February filter  → included
```

This is the canonical period attribution rule for realized Performance dashboard analytics.

Do not silently use entry date for realized P&L.

---

# 12. Entry-Time Analytical Exception

Some analytical dimensions may legitimately use entry timestamp as the grouping dimension, for example:

```text
performance by entry hour
performance by entry weekday
entry timing analysis
```

In those cases:

- trade eligibility remains determined by the global selected period according to the canonical analytical contract;
- the chart may group the selected trades by entry-time dimension.

Document such semantics explicitly.

---

# 13. Advanced Filters

The top-level UI should remain compact:

```text
Account(s)
Date Range
Filters
Performance Unit
```

Do not place every filter directly in the toolbar.

The `Filters` control should expose supported advanced filters.

Initial useful filters include:

```text
Setup / strategy
Direction: Long / Short
Symbol
Trade result
Tags
Mistakes / rule violations
Grade / process score where supported
```

S01 must determine which are already supported correctly by the current domain model.

Do not create speculative filter dimensions without reliable underlying data.

---

# 14. Global Filter Contract

Every analytical widget rendered in `/performance` must receive the same global analytical scope.

Conceptually:

```text
GlobalPerformanceFilters
        ↓
Analytics Query / Adapter
        ↓
Widget Data
```

A widget must not silently ignore a filter that applies to its underlying dataset.

For every registered widget, define which global filters it supports.

The normal expectation is:

```text
Account      → yes
Date range   → yes
Advanced     → yes when semantically applicable
Unit         → yes when mathematically applicable
```

If a filter is not applicable to a widget:

- the behavior must be explicit;
- the widget must not misrepresent itself as filtered when it is not.

---

# 15. Performance Unit

Introduce the analytical unit selector that M026 intentionally deferred because there was previously no demonstrated requirement.

The new requirement now exists.

UI concept:

```text
[ Dollars ($) ▾ ]
```

Supported units:

```text
$
%
R
```

where mathematically valid.

---

# 16. Unit Semantics

A global unit selection must **not redefine metric meaning**.

For example:

```text
Net performance
→ may support $, %, R

Profit Factor
→ ratio; remains Profit Factor

Win Rate
→ percentage by definition

Trade Count
→ count

Holding Duration
→ time

Average R
→ R by definition
```

Do not force every widget into `$ / % / R`.

Instead, widgets declare valid units.

Conceptually:

```ts
supportedUnits: ["currency", "percent", "r"];
```

or:

```ts
supportedUnits: ["fixed"];
```

The UI must gracefully preserve fixed-semantic metrics.

---

# 17. Configurable KPI Cards

The KPI row must not be a fixed hard-coded metric list.

Each top card is a registered **Metric Widget**.

Users must be able to choose which metrics appear.

Initial candidate catalogue:

```text
Net P&L
Gross P&L
Total Trades
Win Rate
Day Win Rate
Profit Factor
Expectancy
Average R
Median R
Average Win
Average Loss
Average Win / Average Loss
Largest Win
Largest Loss
Average Holding Duration
Max Drawdown
Current Drawdown where historically meaningful
Fees / Commissions
```

S01 must confirm which already have canonical implementations.

Do not implement every missing metric merely because it appears in this candidate list.

---

# 18. KPI Card Configuration

Each KPI card should support appropriate configuration such as:

```text
Metric
Display unit where supported
Secondary/comparison value where supported
Title override — optional
Size
Position
Duplicate
Remove
Reset
```

Not every setting needs to be exposed if the underlying widget does not support it.

---

# 19. KPI Widget Duplication

Widget duplication is explicitly required.

Example:

```text
Widget A
Average R

Widget B
Profit Factor

Widget C
Net P&L
```

or two instances of the same metric when useful.

Duplicate widgets must receive:

- a unique widget instance ID;
- independent presentation configuration;
- shared global filter context.

Do not confuse:

```text
widget type
```

with:

```text
widget instance
```

---

# 20. Analytical Chart Widgets

The Performance dashboard must support configurable chart widgets.

Initial priority chart catalogue:

## Must Have

```text
Daily Net Cumulative P&L
Net Daily P&L
Trade Duration Performance
Drawdown Curve
R-Multiple Distribution
Performance by Setup
```

## High Priority

```text
Performance by Day of Week
Performance by Time of Day
Long vs Short Performance
Monthly P&L
```

## Later / Analytics Expansion

```text
MAE
MFE
MAE vs realized result
MFE vs realized result
MFE / MAE vs duration
exit-efficiency analytics
advanced behavioral correlation
```

MAE/MFE must not be implemented until underlying data supports correct computation.

---

# 21. Chart Configuration

Chart widgets should support configuration appropriate to their registered type.

Potential settings:

```text
Metric
Visualization
Primary series
Additional supported series
Show / hide series
Grouping dimension
Aggregation
Legend visibility
Title override
Size
Position
Duplicate
Remove
Reset
```

Do not build an unrestricted generic chart constructor.

Each widget type has a typed set of valid configuration.

---

# 22. Series Visibility

Where a chart supports multiple series, users should be able to show/hide appropriate series.

Example:

```text
Cumulative Performance

☑ Net P&L
☐ Gross P&L
☑ Equity
```

or:

```text
Long vs Short

☑ Long
☑ Short
```

Visibility configuration must persist with the saved dashboard.

---

# 23. Widget Resize and Arrangement

Users must be able to:

```text
move
resize
duplicate
remove
configure
```

widgets.

Reuse the M026 workstation/layout infrastructure where possible.

Do not create a competing second drag/resize engine if the existing architecture can support the requirement.

Customization must remain explicit.

Normal dashboard use:

```text
read / analyze
```

Customization mode:

```text
configure / move / resize
```

Do not leave permanent drag/resize chrome visible in normal mode.

---

# 24. Fully Configurable Widgets

For this milestone, "fully configurable" means:

> **Every widget exposes all configuration that is semantically valid for that registered widget type.**

It does **not** mean:

```text
arbitrary SQL
arbitrary JavaScript
arbitrary user formulas
arbitrary REST endpoints
remote plugins
user-provided React components
```

The system remains a controlled first-party widget catalogue.

---

# 25. Widget Architecture

Target conceptual model:

```text
Dashboard Filter Context
          ↓
Analytics Query / Canonical Engine
          ↓
Registered Widget Definition
          ↓
Widget Instance Configuration
          ↓
Presentation
```

Each widget definition should provide, where appropriate:

```text
type
title
description
category
supported metrics
supported units
supported global filters
supported grouping dimensions
supported visualizations
default size
minimum size
maximum size
config schema
renderer
```

Do not add metadata speculatively.

S01 should determine the minimum contract required.

---

# 26. Widget Instances

A widget instance should conceptually own only:

```text
instance id
widget type
presentation configuration
series configuration
layout configuration
optional title override
```

It should **not own independent global account/date/filter state**.

This is critical.

Example:

```text
Performance by Setup — Widget A
metric = Net P&L

Performance by Setup — Widget B
metric = Average R
```

Both still obey:

```text
Accounts = All accounts
Date = YTD
Direction = Long
Unit = R
```

from the shared filter bar.

---

# 27. Saved Performance Dashboards

Users must be able to save dashboard configurations.

A saved Performance dashboard should persist:

```text
dashboard name
widget instances
widget types
widget configuration
series visibility
widget layout
widget sizes
```

Global filter persistence should be handled deliberately.

Recommended distinction:

```text
Dashboard composition
→ persistent

Transient analytical filter state
→ session/user preference unless explicitly saved
```

S01 should inspect existing saved-view behavior and determine the safest integration.

Do not introduce a second unrelated persistence architecture.

---

# 28. Default Performance Dashboard

Provide a curated default Performance dashboard.

Suggested initial composition:

## KPI row

```text
Net P&L
Win Rate
Profit Factor
Average R
Average Win / Loss
```

## Charts

```text
Daily Net Cumulative P&L
Net Daily P&L
Trade Duration Performance
R Distribution
Performance by Setup
```

The final composition may change during UX implementation if evidence supports a better default.

The default should be useful immediately without requiring customization.

---

# 29. Saved Dashboard Management

Users should be able to:

```text
Create dashboard
Rename dashboard
Duplicate dashboard
Switch dashboard
Delete user dashboard
Reset dashboard
```

System/default dashboards must remain protected according to existing saved-view conventions.

---

# 30. Dashboard Duplication

Dashboard duplication is desirable because it enables workflows such as:

```text
Performance — General

Performance — Breakouts

Performance — Long Only

Performance — Swing Trades
```

without rebuilding layouts from scratch.

The duplicated dashboard may share the same widget types but persist independent composition/configuration.

---

# 31. Visual Direction

The Performance dashboard should move closer to the visual/product quality of Tradenza while preserving TradingJournal identity.

Emphasize:

```text
stronger hierarchy
clean KPI cards
compact top controls
consistent widget chrome
better chart/card proportions
cleaner spacing
analytical density
less engineering-dashboard appearance
```

Do not simply increase whitespace everywhere.

TradingJournal remains a professional analytical workstation.

---

# 32. KPI Card Visual Language

Use the user's supplied Tradenza example as the conceptual benchmark:

```text
metric label
dominant value
small contextual visualization where useful
secondary context
restrained status color
```

Possible card micro-visualizations include:

```text
sparkline
gauge
donut
positive/negative balance bar
secondary ratio
```

But visualization must serve the metric.

Do not add decorative graphics merely to mimic Tradenza.

---

# 33. Chart UX

Continue using ECharts.

Improve chart experience where useful:

```text
tooltips
legends
series toggling
axes
reference lines
hover state
selection
responsive resizing
empty states
loading states
data labels where useful
```

Charts must use the authoritative TradingJournal chart palette and semantic tokens.

---

# 34. Analytical Data Contract

All dashboard analytics must flow through deterministic, typed data contracts.

Prefer:

```text
canonical computation
→ analytical query/service
→ typed response
→ widget
```

Avoid:

```text
React widget
→ fetch raw trades
→ calculate its own metric
```

No metric logic should be duplicated inside presentation components.

---

# 35. Analytics Query Foundation

S01 must determine whether the current APIs can support:

```text
multi-account
close-date period filtering
advanced filters
performance units
multiple widgets
```

efficiently and consistently.

If minor API evolution is required, implement it inside this milestone.

If S01 finds that supporting this dashboard correctly requires a **major analytics backend redesign**, stop and record the finding before expanding scope.

Do not silently turn this milestone into a complete analytics-engine rewrite.

---

# 36. Scope Boundary With Analytics & Review Expansion

This milestone is responsible for:

```text
dashboard architecture
filter context
widget configuration
widget registry
widget composition
saved analytical dashboards
core charts
core metric presentation
Tradenza-style UX
```

The later **Analytics & Review Expansion** milestone remains responsible for major new analytical capability such as:

```text
MAE / MFE
advanced excursion analytics
advanced behavioral analytics
new statistical families
complex strategy comparisons
new sophisticated metric definitions
```

This milestone creates the **platform into which those future analytics can plug**.

---

# 37. Required GSD Slice Structure

Use reviewable vertical slices.

---

## S01 — Current capability audit and analytical dashboard contract

### Inspect

At minimum:

```text
existing workstation architecture
existing Performance view
existing saved-view infrastructure
existing dashboard widgets
existing metric libraries
existing performance APIs
current chart implementations
existing filter state
current account context
current persistence model
Tradenza current UX
```

### Inventory

Classify:

```text
metric already canonical
metric available but presentation-only
metric missing
chart already implemented
chart reusable
filter already supported
filter missing
widget customization reusable
saved-view infrastructure reusable
API adequate
API requires refinement
```

### Lock contracts

Define:

```text
PerformanceDashboardFilter
WidgetDefinition
WidgetInstance
WidgetConfig
supported units
date attribution
filter propagation
persistence boundaries
```

### Stop condition

If a major analytics backend rewrite is required, document it before S02 and reassess milestone scope.

---

## S02 — New `/performance` route and global filter bar

Deliver a working new route:

```text
/performance
```

without changing `/`.

Implement the shared global filter context:

```text
Account(s)
Date Range
Filters
$ / % / R
```

Prove filtering against at least one KPI and one chart.

### Acceptance

Changing a top filter must update both proving widgets from the same analytical context.

---

## S03 — Configurable KPI row

Deliver:

- registered metric cards;
- metric selection;
- reorder;
- resize where appropriate;
- duplicate;
- remove;
- reset;
- persistence.

Use core existing metrics first.

---

## S04 — Configurable chart widgets

Deliver the first useful chart catalogue:

```text
Daily Net Cumulative P&L
Net Daily P&L
Trade Duration Performance
Drawdown
R Distribution
Performance by Setup
```

Support:

- resize;
- move;
- duplicate;
- remove;
- configuration;
- series visibility where valid.

Every chart must obey the top filter state.

---

## S05 — Saved Performance dashboard composition

Integrate configuration with existing saved-view/layout infrastructure.

Deliver:

```text
Create
Rename
Duplicate
Switch
Delete
Reset
Persist
Restore
```

for user-created Performance dashboards.

Do not modify current `/` saved workstation behavior unless required for shared infrastructure reuse.

---

## S06 — Tradenza-inspired Performance UX refinement

Use the functional dashboard from S02–S05 and refine:

```text
filter-bar hierarchy
KPI-card design
widget chrome
spacing
chart/card proportions
empty/loading/error states
configuration affordances
normal vs customization mode
```

Use Tradenza as benchmark but retain Graphite + Steel Blue.

Do not recreate architecture during this slice.

---

## S07 — Cross-filter, persistence, and coexistence UAT

Verify:

```text
/performance
```

and:

```text
/
```

side by side.

Prove:

- current `/` dashboard still works;
- `/` was not redirected;
- `/performance` works independently;
- filters propagate to every analytical widget;
- close-date attribution is correct;
- `$ / % / R` semantics are correct;
- duplicated widgets remain independent in configuration;
- global filters remain shared;
- dashboard layouts persist;
- saved dashboard switching works;
- remove/reset works;
- normal mode contains no editing chrome;
- light and dark themes work;
- responsive desktop layouts work.

---

# 38. Required Filter Propagation Tests

At minimum, test:

```text
Account:
All → Account A

Date:
Whole period → YTD → custom range

Direction:
All → Long → Short

Setup:
All → specific setup

Performance unit:
$ → % → R
```

For each global filter change, verify multiple different widget types change consistently.

Do not validate filter propagation using only one widget.

---

# 39. Close-Date Tests

Add explicit deterministic scenarios.

Example:

```text
Trade A
entry = 2026-01-30
close = 2026-02-03
P&L = +$500
```

Expected:

```text
January realized dashboard → excludes Trade A
February realized dashboard → includes Trade A
```

This must be contract-tested.

---

# 40. Multi-Account Tests

Validate:

```text
Account A
Account B
All accounts
A + B
```

where supported.

Aggregations must be deterministic and correctly scoped.

If currencies differ and the current architecture does not support normalized multi-currency aggregation:

> fail safely or constrain selection rather than silently summing incompatible currencies.

Do not invent an implicit FX policy.

---

# 41. Widget Duplication Tests

Example:

```text
Widget 1:
Performance by Setup
metric = Net P&L

Widget 2:
Performance by Setup
metric = Average R
```

Verify:

- both exist simultaneously;
- each preserves independent configuration;
- both receive the same global filters;
- resizing one does not corrupt the other;
- deleting one leaves the other;
- persistence restores both.

---

# 42. Performance Requirements

Avoid a model where every widget independently requests the entire trade history after every filter change.

Audit and optimize:

```text
duplicate API requests
duplicate computation
filter-change request storms
unnecessary chart rerenders
large trade histories
```

Prefer shared/cached analytical results where architecture supports it.

Do not prematurely introduce complex infrastructure without evidence.

---

# 43. Loading Behavior

Changing a filter should not cause the dashboard to visually collapse.

Prefer:

```text
current layout retained
→ widgets show localized loading state
→ updated result replaces old result coherently
```

Avoid:

```text
whole dashboard disappears
→ blank screen
→ full remount
```

where unnecessary.

---

# 44. Error Behavior

A widget failure must not destroy the complete dashboard.

Where practical:

```text
widget query failure
→ localized widget error
```

Global analytical-context failure may show an appropriate dashboard-level state.

Never silently display stale values as newly filtered values.

---

# 45. Accessibility

Ensure:

- filter controls have accessible labels;
- configuration actions are keyboard reachable;
- widget menus expose names/actions;
- series controls are accessible;
- drag-only actions have an alternative where existing workstation conventions provide one;
- color is not the only state indicator;
- focus is preserved through configuration dialogs.

---

# 46. Responsive Target

Desktop-first.

Validate at minimum:

```text
1440
1280
1024
```

in:

```text
light
dark
```

The top filter bar may wrap intelligently at compact widths.

Do not hide analytical scope without making it discoverable.

---

# 47. Current Dashboard Regression Rule

At every substantial slice, verify the current dashboard:

```text
/
```

still renders and behaves correctly.

At minimum confirm:

```text
risk visible
trades visible
account context functional
market-data trust behavior unchanged
saved current workstation views unchanged
```

No milestone task should require replacing `/`.

---

# 48. Navigation

Expose `/performance` through a clear navigation entry.

Recommended label:

```text
Performance
```

The existing root dashboard remains:

```text
Dashboard
```

Do not rename or remove the current Dashboard entry during this milestone unless required for clarity and explicitly approved.

---

# 49. Explicit Non-Goals

Do not:

- remove the current `/` dashboard;
- redirect `/` to `/performance`;
- make `/performance` the default route;
- redesign the live Risk & Positions workstation;
- merge live and historical filter semantics;
- create arbitrary SQL widgets;
- create arbitrary formulas;
- create a plugin marketplace;
- allow arbitrary remote widgets;
- rewrite accounting;
- rewrite FIFO;
- change R semantics;
- change canonical P&L semantics;
- implement MAE/MFE without correct supporting data;
- perform a broad Trading Workflow redesign;
- redesign CSV import;
- replace ECharts;
- replace the design system;
- replace the saved-view architecture without a documented blocker.

---

# 50. Verification

Follow `AGENTS.md`.

At completion of each implementation slice run separately:

```bash
make lint
make typecheck
make build
make test-all
```

Run targeted browser verification for changed user-facing workflows.

At milestone boundary run full required browser/UAT verification.

Do not weaken existing tests.

---

# 51. Milestone Acceptance Criteria

## Coexistence

- [ ] `/` remains the current production dashboard.
- [ ] `/performance` hosts the new analytical dashboard.
- [ ] `/` does not redirect to `/performance`.
- [ ] Existing root-dashboard functionality remains intact.
- [ ] Removal/replacement of `/` is explicitly deferred pending user approval.

## Global filters

- [ ] Account filter exists.
- [ ] Multi-account scope works where valid.
- [ ] Date-range filter exists.
- [ ] Realized performance uses close date.
- [ ] Advanced filters exist.
- [ ] `$ / % / R` context exists.
- [ ] Every analytical widget responds correctly to applicable global filters.
- [ ] Widgets do not maintain conflicting copies of global scope.

## KPI cards

- [ ] KPI metrics come from a registered catalogue.
- [ ] User can select KPI metrics.
- [ ] KPI cards can be reordered.
- [ ] KPI cards can be duplicated.
- [ ] KPI cards can be removed.
- [ ] Configuration persists.

## Charts

- [ ] Daily Net Cumulative P&L is available.
- [ ] Net Daily P&L is available.
- [ ] Trade Duration Performance is available.
- [ ] Drawdown is available.
- [ ] R Distribution is available.
- [ ] Performance by Setup is available.
- [ ] Charts resize correctly.
- [ ] Charts can be duplicated.
- [ ] Supported series can be shown/hidden.
- [ ] Chart configuration persists.

## Dashboard customization

- [ ] Widgets can be moved.
- [ ] Widgets can be resized.
- [ ] Widgets can be duplicated.
- [ ] Widgets can be removed.
- [ ] Widgets can be configured.
- [ ] Normal mode remains free of editing chrome.

## Saved dashboards

- [ ] User can create a Performance dashboard.
- [ ] User can rename it.
- [ ] User can duplicate it.
- [ ] User can switch dashboards.
- [ ] User can delete user dashboards.
- [ ] User can reset appropriately.
- [ ] Widget configuration/layout restores correctly.

## Architecture

- [ ] Existing M026 architecture is reused where appropriate.
- [ ] Canonical computations remain authoritative.
- [ ] No duplicate metric calculations are introduced in React.
- [ ] Widget definitions are typed.
- [ ] Widget instances have unique identity.
- [ ] Global filter context has one clear owner.
- [ ] Live/historical separation remains intact.

## UX

- [ ] Performance dashboard materially improves visual hierarchy.
- [ ] Tradenza-inspired patterns are adapted rather than copied.
- [ ] Graphite + Steel Blue remains authoritative.
- [ ] Light theme passes.
- [ ] Dark theme passes.
- [ ] 1440 passes.
- [ ] 1280 passes.
- [ ] 1024 passes.

## Engineering

- [ ] `make lint` passes.
- [ ] `make typecheck` passes.
- [ ] `make build` passes.
- [ ] `make test-all` passes.
- [ ] Targeted Playwright passes.
- [ ] Milestone UAT passes.

---

# 52. Definition of Done

This milestone is complete when:

1. TradingJournal has a new `/performance` analytical dashboard;
2. the existing `/` dashboard remains intact;
3. the new dashboard is globally filterable;
4. realized analytics use close-date attribution;
5. users can select the KPI metrics shown;
6. users can add/configure/move/resize/duplicate/remove supported widgets;
7. supported chart series can be configured;
8. every analytical widget obeys the shared applicable filter state;
9. Performance dashboards can be saved and restored;
10. the visual hierarchy is materially closer to the quality demonstrated by Tradenza;
11. existing canonical computation and workstation architecture remain authoritative;
12. no current dashboard migration occurs without explicit user approval;
13. all repository quality gates and required browser/UAT evidence pass.

---

# 53. Post-Milestone Decision Gate

Completion of this milestone does **not** authorize removal of the old dashboard.

After UAT, present both:

```text
/
```

and:

```text
/performance
```

for user evaluation.

Only after explicit user approval may a later change consider:

```text
promote /performance to /
redirect legacy dashboard
retire old dashboard
merge selected live functionality
```

Until then:

> **Both dashboards remain available.**

---

# 54. Downstream Roadmap

After this milestone:

```text
✅ M025 — Design System Evolution
✅ UX Foundation / Consistency
✅ M026 — Workstation Architecture Evolution
→ Dashboard Experience & Customization       ← this milestone
→ Trading Workflow
→ Analytics & Review Expansion
→ Product Polish
→ v1.0 Readiness
```

---

# 55. Scope-Control Routing

Discoveries should be routed as follows:

```text
Dashboard composition / filtering / widget configuration
→ this milestone

Trade lifecycle / planning / execution / position management
→ Trading Workflow

New sophisticated metrics / MAE / MFE / behavioral analytics
→ Analytics & Review Expansion

Import / onboarding / general product polish
→ Product Polish

Final recovery / migration / release hardening
→ v1.0 Readiness
```

Critical correctness defects should be handled according to `AGENTS.md`.

---

# 56. Final Orchestrator Directive

> **Build a new Tradenza-inspired, fully configurable analytical Performance dashboard at `/performance` while preserving the existing root dashboard `/` unchanged until explicit user approval authorizes migration or removal. Reuse the existing M026 workstation architecture, saved-view/layout mechanisms, Graphite + Steel Blue design system, ECharts stack, canonical computation libraries, and typed domain contracts. Establish one global Performance dashboard filter context for account scope, close-date-based period selection, advanced analytical filters, and valid `$ / % / R` presentation. Every analytical widget must consume the applicable shared filter state. Make KPI cards and chart widgets configurable, movable, resizable, duplicable, removable, and persistable within a controlled first-party widget catalogue. Support a curated default Performance dashboard plus user-created saved dashboards. Use Tradenza heavily as a UX benchmark, but do not copy its architecture or source. Do not redesign the current live Risk & Positions workstation, do not weaken the live/historical separation established by M026, and do not expand this milestone into advanced analytics that belong to Analytics & Review Expansion.**

When ambiguous, prefer:

```text
preserve current / dashboard > premature migration
new /performance route > replacing production dashboard
one global analytical filter owner > per-widget filter duplication
close date > entry date for realized period attribution
typed widget catalogue > generic widget builder
configurable widget instance > hard-coded dashboard
canonical calculation > React-local formula
reuse M026 architecture > second layout system
Tradenza UX pattern > Tradenza code
analytical consistency > feature count
clear metric semantics > forced $/%/R conversion
user approval > automatic dashboard replacement
```
