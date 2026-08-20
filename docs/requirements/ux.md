# Milestone — Performance Dashboard Product UX Remediation

## Status

**Repository:** `jg-main/TradingJournal`  
**Type:** Existing-feature UX remediation and application-shell integration  
**Priority:** High  
**Risk:** Medium  
**Primary UX benchmark:** Tradenza  https://github.com/HonzaPrikryl/Tradenza
**Scope:** Improve the existing `/performance` implementation in the current codebase.  
**Critical principle:** **Preserve the existing technical foundation; correct the product experience.**

---

# 1. Objective

TradingJournal already contains a configurable analytical Performance dashboard at:

```text
/performance
```

The technical foundation is substantially implemented, including:

- performance analytics API;
- close-date-based realized-performance attribution;
- account and date filtering;
- `$ / % / R` presentation semantics;
- typed Performance widget registry;
- widget-instance model;
- widget duplication;
- saved Performance dashboards;
- KPI widgets;
- ECharts chart widgets;
- `react-grid-layout` chart arrangement;
- persistent widget configuration.

However, the current user experience is not acceptable as a finished product.

The objective of this milestone is:

> **Transform the existing `/performance` implementation from a technically functional engineering dashboard into a polished, dense, configurable analytical trading dashboard integrated into the normal TradingJournal application shell.**

Use Tradenza as the principal benchmark for:

- information hierarchy;
- dashboard density;
- filter presentation;
- KPI-card geometry;
- analytical chart composition;
- customization affordances;
- overall visual polish.

Do not clone Tradenza's branding or source code.

---

# 2. Existing Codebase — Inspect Before Planning

Before making changes, inspect the actual repository.

At minimum inspect:

```text
AGENTS.md
PRODUCT.md

docs/design-system/README.md
docs/design-system/tokens.md
docs/design-system/charts.md
docs/design-system/workstation.md

docs/requirements/Dashboard Experience and Customization.md

src/app/(workstation)/performance/page.tsx
src/app/(workstation)/layout.tsx
src/app/(legacy)/layout.tsx

src/components/performance/*
src/hooks/use-performance-dashboard.tsx
src/hooks/use-performance-dashboards.ts
src/hooks/use-performance-instances.ts

src/lib/performance-view-types.ts
src/lib/performance-widget-registry.ts
src/lib/performance-kpi-catalogue.ts
src/lib/performance-analytics.ts
src/lib/performance-chart-options.ts

src/app/api/performance/analytics/route.ts

src/components/sidebar/*
src/lib/account-context.tsx

e2e/performance-dashboard.spec.ts
docs/uat/m028-s06/README.md
```

Also inspect any additional files imported by these paths.

Do not assume repository behavior from this document where the implementation can answer the question directly.

---

# 3. Existing Technical Foundation Is the Baseline

The following systems already exist and should be preserved unless a concrete defect requires modification.

## Analytics

There is an existing:

```text
/api/performance/analytics
```

analytical route supporting:

- multi-account analytical scope;
- close-date filtering;
- setup filtering;
- direction filtering;
- symbol filtering;
- trade-result filtering;
- canonical metric computation reuse;
- chart datasets;
- period-start-equity metadata.

Do not replace this with client-side raw-trade aggregation.

Do not introduce a second analytics engine.

---

## Global analytical context

There is an existing shared Performance dashboard context responsible for analytical scope.

Preserve the principle:

```text
GlobalPerformanceFilters
        ↓
Analytics Query
        ↓
Typed Analytics Response
        ↓
All Dashboard Widgets
```

A widget must not independently invent its own global account/date scope.

---

## Widget architecture

There is an existing typed registry:

```text
PERFORMANCE_WIDGET_REGISTRY
```

with separate:

```text
widget type
widget instance
```

semantics.

Instances support independent configuration and duplication.

Preserve that architecture.

---

## Saved dashboards

There is an existing saved Performance dashboard system.

Preserve existing:

```text
create
rename
duplicate
switch
delete
reset
persist
restore
```

behavior unless repository inspection reveals a correctness defect.

---

## Charts

Existing analytical charts use ECharts.

Existing chart layout uses:

```text
react-grid-layout
```

Do not replace either technology merely to implement this remediation.

---

# 4. Critical Issue — `/performance` Loses the Application Sidebar

The current `/performance` route lives under:

```text
src/app/(workstation)/performance/page.tsx
```

The `(workstation)` layout is intentionally isolated from the normal application shell and excludes the standard Sidebar.

This causes:

```text
Trades
→ sidebar visible

Performance
→ sidebar disappears
```

This is incorrect.

---

# 5. Required Application-Shell Behavior

`/performance` must behave as a normal TradingJournal application page.

It must retain the same application shell as:

```text
Trades
Checks
Accounts
Sizing
Settings
```

The sidebar must remain visible when navigating:

```text
Dashboard
→ Performance
→ Trades
→ Performance
```

The URL remains:

```text
/performance
```

Route-group placement may change as necessary.

Likely repository direction:

```text
/workstation route-group isolation
```

is inappropriate for this user-facing analytical page.

Do not solve this by manually rendering a second Sidebar inside the Performance component.

Use the existing normal application shell.

---

# 6. Preserve the Existing Root Dashboard

The existing:

```text
/
```

dashboard must remain untouched.

Do not:

- replace it;
- redirect it;
- merge it into `/performance`;
- migrate its saved workstation layouts;
- change its live-risk behavior.

Required coexistence:

```text
/             → existing live Risk / Positions dashboard

/performance  → analytical configurable Performance dashboard
```

No migration decision is part of this milestone.

---

# 7. Performance Page Hierarchy

The current Performance page hierarchy is weak.

The final page should read approximately:

```text
Performance
Overview of your trading performance

[ All accounts ▾ ] [ YTD ▾ ] [ Filters ▾ ] [ Dollars ($) ▾ ]

KPI rail

Analytical widget grid
```

Saved-dashboard selection and `Customize` remain available but must not visually dominate the page.

Establish the analytical context before secondary dashboard-management controls.

---

# 8. Global Filter Bar

The target filter bar should follow the compact product pattern:

```text
[ All accounts ▾ ] [ YTD ▾ ] [ Filters ▾ ] [ Dollars ($) ▾ ]
```

rather than a traditional form layout such as:

```text
Accounts: [...]
Period: [...]
Unit: [...]
```

Use existing TradingJournal primitives and tokens.

Target control height:

```text
approximately 34–36 px
```

with:

- consistent height;
- consistent radius;
- consistent border treatment;
- compact spacing;
- aligned icon/text treatment where appropriate.

---

# 9. Required Global Controls

The filter bar must expose four primary controls:

```text
Account(s)
Date Range
Filters
Performance Unit
```

## Account

Support existing valid analytical scopes:

```text
All accounts
Single account
Multiple accounts
```

Preserve existing mixed-currency safety behavior.

Do not invent implicit FX conversion.

---

## Date Range

Support at minimum:

```text
Whole Period
YTD
1 Year
6 Months
3 Months
1 Month
Custom
```

Realized performance remains attributed by:

> **close date**

Do not change that semantic.

---

## Performance Unit

Support:

```text
$
%
R
```

where mathematically valid.

Fixed-semantic metrics remain fixed:

```text
Win Rate       → %
Profit Factor  → ratio
Trade Count    → count
Average R      → R
Duration       → time
```

Do not reinterpret metric meaning merely to satisfy the selected global unit.

---

# 10. Missing Advanced Filters UX

The analytics backend already supports filters including:

```text
setupIds
directions
symbols
tradeResults
```

The current UI does not adequately expose them.

Add the required:

```text
[ Filters ▾ ]
```

control.

Use an appropriate existing:

```text
popover
sheet
dropdown
dialog
```

primitive.

Do not create a visually heavy permanent filter panel.

---

# 11. Advanced Filter Contents

Expose only dimensions backed by current reliable data.

At minimum:

```text
Setup / Strategy
Direction
Symbol
Trade Result
```

Possible interaction:

```text
Filters

Setup
[ All setups ▾ ]

Direction
☑ Long
☑ Short

Symbol
[ Search / select ]

Result
☑ Winner
☑ Loser
☑ Scratch

[ Clear ] [ Apply ]
```

The exact interaction may adapt to existing component conventions.

---

# 12. Global Filter Contract

All analytical widgets must obey the applicable global filter state.

A change to:

```text
Account
Date
Setup
Direction
Symbol
Result
```

must update all relevant:

```text
KPI widgets
chart widgets
future analytical widgets
```

through the shared analytical query.

Do not fetch and independently filter full trade histories inside each widget.

---

# 13. Current KPI Rail Is Rejected

The existing top KPI cards do not form a visually coherent row.

Some cards are taller because they include microvisualizations while others do not.

This is unacceptable.

---

# 14. KPI Geometry — Hard Requirement

At desktop widths where the default KPI row fits:

```text
ALL KPI cards must have identical height.
ALL KPI cards must share the same top edge.
ALL KPI cards must share the same bottom edge.
Metric titles must align consistently.
Primary values must align consistently.
Microvisualizations must fit inside the common card geometry.
```

Target default height:

```text
108–112 px
```

A sparkline, donut, gauge, or other microvisualization must **never change card height**.

---

# 15. Default KPI Composition

Use a curated five-card default row.

Recommended starting composition:

```text
Net P&L
Win Rate
Profit Factor
Average R
Payoff Ratio
```

If repository data supports a materially better fifth metric, document the choice.

Do not treat the KPI rail as a place to display every available metric.

The default should be curated.

---

# 16. KPI Visual Language

Each KPI should conceptually contain:

```text
metric label
dominant metric value
optional secondary context
optional restrained microvisualization
```

Potential appropriate treatments:

```text
Net P&L
→ value + sparkline

Win Rate
→ value + donut / restrained gauge

Profit Factor
→ strong value; microvisual optional

Average R
→ strong value

Payoff Ratio
→ value + positive/negative relation bar where useful
```

Do not add decorative charts simply because another KPI has one.

---

# 17. KPI Customization

The existing KPI instance architecture must remain.

In Customize mode, support:

```text
change metric
reorder
duplicate
remove
optional constrained width change
```

Do not allow uncontrolled vertical KPI resizing.

KPI height remains standardized.

---

# 18. KPI Direct Manipulation

The current small:

```text
↑
↓
```

buttons are not sufficient as the primary desktop reordering interaction.

Use visible direct manipulation in Customize mode.

The user should immediately understand:

```text
this card can be moved
```

Arrow controls may remain as an accessibility fallback where useful.

---

# 19. Current Chart Default Layout Is Rejected

The current dashboard gives major charts full-width rows, producing excessive vertical stacking.

This is technically valid but is not an acceptable curated analytical dashboard.

The default layout should use the available horizontal space aggressively while preserving chart readability.

---

# 20. Default Analytical Grid at Large Desktop Width

At approximately 1440px+ application width, target a composition similar to:

```text
┌──────────────────┬──────────────────┬──────────────────┐
│ Cumulative P&L   │ Net Daily P&L    │ Trade Duration   │
│                  │                  │                  │
└──────────────────┴──────────────────┴──────────────────┘

┌──────────────────┬──────────────────┬──────────────────┐
│ Drawdown         │ R Distribution   │ Setup Performance│
│                  │                  │                  │
└──────────────────┴──────────────────┴──────────────────┘
```

Target:

```text
approximately 3 analytical widgets per row
```

where the chart remains readable.

Users may resize widgets afterward.

---

# 21. Responsive Analytical Layout

Use responsive dashboard geometry.

Target behavior:

```text
1440+ px
→ approximately 3 chart columns

1280 px
→ 2–3 columns depending on chart legibility

1024 px
→ usually 2 columns
→ 1 column only where necessary
```

Do not use one static grid configuration for all desktop widths if it produces poor composition.

Do not introduce document-level horizontal scrolling.

---

# 22. Chart Customization Must Be Discoverable

The current implementation technically enables drag/resize through `react-grid-layout`.

That is not sufficient.

When the user clicks:

```text
Customize
```

each configurable widget must visibly enter editing state.

Conceptual target:

```text
┌─ ⠿ Daily Net P&L ───────────────────────── ⋯ ┐
│                                              │
│                    chart                     │
│                                              │
│                                            ◢ │
└──────────────────────────────────────────────┘
```

Required:

```text
clear drag handle
clear resize affordance
clear widget actions menu
subtle edit-state chrome
```

Normal mode remains visually clean.

---

# 23. Widget Actions

Do not use scattered tiny controls such as:

```text
+
×
Series
```

as the primary management interaction.

Use a consistent:

```text
⋯
```

actions menu.

Minimum actions where valid:

```text
Configure
Duplicate
Remove
Reset
```

Use existing dropdown/menu primitives.

---

# 24. Widget Configure Experience

`Configure` should expose only semantically valid options for that widget.

Possible settings:

```text
Metric
Visible series
Primary series
Grouping dimension
Legend visibility
Title override
Widget-specific presentation
```

Configuration must remain typed and widget-specific.

Do not create an unrestricted visualization builder.

---

# 25. Widget Resize

Users must be able to resize chart widgets in Customize mode.

This is not satisfied merely because `react-grid-layout` has `resizeConfig.enabled`.

Browser UAT must prove:

```text
initial widget bounding box
→ resize interaction
→ new bounding box differs
```

and persistence must restore that size after reload.

---

# 26. Widget Movement

Similarly, prove actual movement:

```text
initial position
→ drag
→ new position
→ save/reload
→ new position restored
```

Do not treat the presence of a drag handle as sufficient verification.

---

# 27. Preserve Widget Extensibility

The dashboard architecture must remain extensible to future first-party widget types.

Concrete future example:

> **Year × Month Performance Heatmap**

Concept:

```text
             Jan    Feb    Mar    Apr ... Dec

2024          ●      ●      ●      ●
2025          ●      ●      ●      ●
2026          ●      ●      ●      ●
```

where:

```text
X axis     → month
Y axis     → year
cell color → monthly performance
```

The future widget should automatically consume applicable:

```text
account scope
date range
advanced filters
$ / % / R
```

from the existing global Performance analytical context.

---

# 28. Future Widget Addition Contract

Adding a future first-party analytical widget should conceptually require:

```text
typed WidgetDefinition
+
registry entry
+
data mapping/query definition
+
renderer
```

It should **not** require modifications to:

```text
/performance page shell
global filter system
dashboard switching
saved-dashboard persistence
layout engine
general Customize mode
```

If the current code special-cases initial widgets in a way that prevents this, refactor only as much as necessary to restore this contract.

Do not broadly rebuild the widget architecture.

---

# 29. Saved Dashboards

Preserve existing saved-dashboard behavior.

Users should continue to be able to:

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

Dashboard composition should persist:

```text
widget instances
widget configuration
layout
sizes
series visibility
```

Do not rewrite this subsystem unless a concrete bug is found.

---

# 30. Normal Mode vs Customize Mode

## Normal mode

Must optimize for:

```text
reading
analysis
clean chart presentation
minimal chrome
```

Must NOT show:

```text
drag handles
resize controls
delete controls
editing overlays
```

## Customize mode

Must clearly expose:

```text
move
resize
configure
duplicate
remove
add widget
save/reset
```

The difference between the two modes must be visually obvious.

---

# 31. Tradenza UX Benchmark

Use Tradenza as the explicit quality benchmark for:

```text
compact analytical controls
strong KPI hierarchy
balanced dashboard composition
multiple charts per row
clean card proportions
restrained widget chrome
dense information presentation
configuration discoverability
professional visual rhythm
```

Do not copy:

```text
Tradenza branding
Tradenza colors
Tradenza source code
Tradenza architecture
```

TradingJournal retains:

```text
Graphite + Steel Blue
existing semantic token system
existing typography
existing ECharts palette
existing application shell
existing UI primitives
```

---

# 32. Product Quality Bar

This milestone must produce a **material visual transformation**.

Minor:

```text
padding
font size
border color
```

changes alone are not sufficient.

The final dashboard should move clearly from:

```text
functional engineering dashboard
```

to:

```text
polished analytical trading product
```

---

# 33. Use Appropriate Model Capacity

For work requiring product judgment, including:

```text
layout planning
KPI composition
dashboard information hierarchy
responsive chart geometry
Customize interaction design
visual refinement
```

prefer the repository/orchestrator's higher-capability planning or execution tier.

Do not optimize this portion of the milestone solely for cheapest-token execution.

Mechanical changes and repetitive tests may use cheaper execution models.

---

# 34. Required Vertical Slices

Do not structure this milestone as horizontal "styling" tasks.

Use user-visible vertical slices.

---

## S01 — Application Shell & Performance Page Hierarchy

Deliver:

- `/performance` inside the normal TradingJournal shell;
- Sidebar remains visible;
- page has clear `Performance` identity;
- saved-dashboard controls and Customize are positioned appropriately;
- `/` remains unchanged.

### Browser proof

Navigate:

```text
/
→ /performance
→ /trades
→ /performance
```

and verify shell continuity.

---

## S02 — Complete Analytical Filter Experience

Deliver:

```text
[ Account ] [ Period ] [ Filters ] [ Unit ]
```

with functional:

```text
Setup
Direction
Symbol
Trade Result
```

where supported.

Prove global propagation across heterogeneous widget types.

---

## S03 — KPI Rail Product Remediation

Deliver:

- curated five-card default;
- equal card heights;
- aligned title/value geometry;
- contained microvisualizations;
- direct manipulation;
- metric configuration;
- duplicate/remove;
- persistence.

---

## S04 — Analytical Grid Product Remediation

Deliver:

- dense responsive default chart composition;
- multiple charts per row;
- visible drag handles;
- visible resize affordances;
- chart movement;
- chart resizing;
- persistent layouts;
- clean normal mode.

---

## S05 — Widget Configuration UX

Deliver consistent:

```text
⋯
├── Configure
├── Duplicate
├── Remove
└── Reset
```

behavior.

Expose valid chart-series/widget settings through typed configuration.

---

## S06 — Visual Refinement & Final Product UAT

Perform final refinement using actual rendered screenshots.

Verify both:

```text
functionality
and
visual product quality
```

Do not close based on component-presence tests alone.

---

# 35. Hard Geometry Assertions

At 1440px verify programmatically:

## Sidebar

```text
sidebar visible
sidebar dimensions consistent with Trades route
```

## KPI row

```text
5 default KPI cards
same top position
height delta <= 2 px
same bottom alignment
```

## Chart grid

```text
multiple charts share the first analytical row
no default full-width stacking unless intentionally justified
no horizontal document overflow
```

---

# 36. Customization Browser Tests

Playwright must prove actual interaction.

## Chart resize

```text
enter Customize
capture chart bounding box
resize chart
capture new bounding box
assert width and/or height changed
save
reload
assert resized geometry restored
```

## Chart movement

```text
capture initial x/y
drag widget
assert x/y changed
save
reload
assert moved position restored
```

## KPI reorder

```text
capture KPI order
reorder
save
reload
assert order restored
```

---

# 37. Filter Propagation Tests

Using deterministic seeded data, verify at least:

```text
Account:
All → Account A

Period:
Whole Period → YTD

Direction:
All → Long

Setup:
All → Setup A

Trade Result:
All → Winner

Symbol:
All → Symbol A
```

For each applicable change, verify at least:

```text
one KPI changes
one chart changes
```

consistently.

---

# 38. Visual UAT Matrix

Capture actual screenshots at:

```text
1440 dark
1440 light
1280 dark
1280 light
1024 dark
1024 light
```

Inspect all of them.

Do not merely assert:

```text
canvas exists
title exists
page has no JS errors
```

Those conditions are necessary but insufficient.

---

# 39. Visual Review Checklist

Explicitly inspect:

```text
sidebar continuity
page hierarchy
filter-bar density
KPI equal-height geometry
KPI visual balance
chart/card proportions
number of charts visible per row
use of empty space
widget chrome
Customize affordances
alignment
spacing rhythm
responsive wrapping
empty states
loading states
dark-mode quality
light-mode quality
```

---

# 40. Benchmark Comparison

For the final **1440 dark** dashboard, compare directly against the supplied/available Tradenza dashboard reference.

This is not pixel matching.

Assess:

```text
information density
visual hierarchy
KPI consistency
space utilization
chart composition
filter clarity
configuration discoverability
professional polish
```

TradingJournal should be materially comparable in compositional quality while maintaining its own design language.

---

# 41. Completion Requires Human Product Review

Automated tests are necessary but are **not sufficient** for completion.

After implementation:

1. generate final screenshots;
2. present the resulting `/performance` dashboard for product review;
3. do not treat the milestone as product-complete solely because automated quality gates are green.

If this orchestrator cannot obtain interactive user approval during execution, record:

```text
Technical verification: complete
Product UX acceptance: pending user review
```

rather than falsely declaring visual acceptance.

---

# 42. Quality Gates

Follow `AGENTS.md`.

Run separately:

```bash
make lint
make typecheck
make build
make test-all
```

Also run targeted browser tests for:

```text
shell continuity
advanced filters
filter propagation
KPI geometry
KPI reorder
chart drag
chart resize
layout persistence
saved dashboards
theme × viewport
```

Do not weaken existing tests.

---

# 43. Explicit Non-Goals

Do not use this milestone to implement:

```text
MAE / MFE
new advanced statistical families
behavioral analytics
trade workflow redesign
accounting changes
FIFO changes
risk-semantic changes
CSV import redesign
plugin architecture
arbitrary SQL widgets
arbitrary formulas
remote widgets
generic visualization builder
```

Do not replace:

```text
ECharts
react-grid-layout
canonical analytics calculations
saved-dashboard architecture
Performance widget registry
```

without a concrete blocker.

---

# 44. Acceptance Criteria

## Application integration

- [ ] `/performance` uses the normal application shell.
- [ ] Sidebar remains visible.
- [ ] Sidebar behavior matches Trades and other normal pages.
- [ ] `/` remains unchanged.
- [ ] Performance remains a separate route.

## Global filters

- [ ] Compact Account control exists.
- [ ] Compact Date Range control exists.
- [ ] Filters control exists.
- [ ] Unit control exists.
- [ ] Setup filter works where supported.
- [ ] Direction filter works.
- [ ] Symbol filter works.
- [ ] Result filter works.
- [ ] Filters propagate consistently across analytical widgets.

## KPI rail

- [ ] Default KPI rail is intentionally curated.
- [ ] Approximately five cards are shown by default.
- [ ] All default KPI cards have equal height.
- [ ] KPI titles align.
- [ ] KPI primary values align.
- [ ] Microvisualizations fit inside common geometry.
- [ ] KPI can be reconfigured.
- [ ] KPI can be reordered.
- [ ] KPI can be duplicated.
- [ ] KPI can be removed.
- [ ] KPI composition persists.

## Analytical grid

- [ ] Default charts are not unnecessarily full-width.
- [ ] Approximately three widgets per row appear at large desktop width where legible.
- [ ] 1280 layout remains dense and usable.
- [ ] 1024 layout remains usable.
- [ ] Chart drag affordance is obvious.
- [ ] Chart resize affordance is obvious.
- [ ] Actual drag changes position.
- [ ] Actual resize changes geometry.
- [ ] Geometry persists through reload.
- [ ] Normal mode contains no editing chrome.

## Widget configuration

- [ ] Consistent actions menu exists.
- [ ] Configure is discoverable.
- [ ] Duplicate is available.
- [ ] Remove is available.
- [ ] Reset is available where meaningful.
- [ ] Supported series/configuration can be edited.
- [ ] Typed registry remains authoritative.

## Extensibility

- [ ] Future first-party widgets can be registered without Performance-shell modification.
- [ ] Future widgets automatically receive global analytical scope.
- [ ] Future widgets participate in saved dashboards.
- [ ] Future widgets participate in the existing layout engine.
- [ ] Architecture can accommodate a future Year × Month Performance Heatmap.

## Visual quality

- [ ] Dashboard hierarchy is materially improved.
- [ ] Filter bar is compact and polished.
- [ ] KPI rail is visually coherent.
- [ ] Analytical grid uses space efficiently.
- [ ] Dashboard no longer appears as an engineering prototype.
- [ ] Dark mode passes visual review.
- [ ] Light mode passes visual review.
- [ ] 1440 passes visual review.
- [ ] 1280 passes visual review.
- [ ] 1024 passes visual review.
- [ ] Final 1440 dark composition is materially comparable to Tradenza's information density and polish.

## Engineering

- [ ] `make lint` passes.
- [ ] `make typecheck` passes.
- [ ] `make build` passes.
- [ ] `make test-all` passes.
- [ ] Targeted Playwright tests pass.
- [ ] Visual UAT evidence is recorded.

---

# 45. Definition of Done

This milestone is complete when:

1. `/performance` is integrated into the normal TradingJournal application shell;
2. the Sidebar no longer disappears;
3. the four-control global analytical filter bar is complete;
4. advanced analytical filters are exposed;
5. global filters consistently drive analytical widgets;
6. KPI cards have disciplined equal geometry;
7. the default KPI set is curated;
8. the chart grid uses a dense responsive default composition;
9. chart movement and resizing are obvious and functional;
10. widget configuration is coherent and discoverable;
11. saved dashboard persistence continues to work;
12. future widget extensibility remains intact;
13. existing analytics/domain semantics remain authoritative;
14. automated quality gates pass;
15. visual UAT demonstrates substantial product-quality improvement;
16. final product UX is presented for human review rather than inferred from green tests.

---

# 46. Final Orchestrator Directive

> **Treat the existing `/performance` implementation as a technically credible foundation that requires product UX remediation, not as a greenfield dashboard build. First inspect the actual repository and preserve the existing analytics API, close-date attribution, Performance dashboard context, canonical metric calculations, widget registry, widget-instance architecture, saved dashboards, ECharts integration, and react-grid-layout system unless a concrete defect requires change. Integrate `/performance` into the normal TradingJournal application shell so the Sidebar remains visible. Complete the missing Filters control using the analytical filter dimensions already supported by the backend. Rebuild the visible dashboard composition around a compact four-control filter bar, an equal-height curated five-card KPI rail, and a dense responsive analytical grid targeting approximately three charts per row at large desktop widths where legible. Make Customize mode visibly actionable with direct drag, resize, Configure, Duplicate, Remove, and Reset affordances while keeping normal mode clean. Use Tradenza as the explicit benchmark for density, hierarchy, proportions, and polish while retaining TradingJournal's Graphite + Steel Blue design system. Preserve typed widget extensibility so future widgets such as a Year × Month Performance Heatmap can be registered without modifying the dashboard shell, filter architecture, saved-dashboard system, or layout engine. Automated tests are necessary but not sufficient: final completion requires real screenshot-based visual UAT and honest reporting of whether the product-quality target has been met.**

When ambiguous, prefer:

```text
current repository evidence > assumptions
preserve working architecture > rebuild
normal application shell > isolated Performance shell
global analytical scope > per-widget filtering
equal KPI geometry > content-driven card height
dense curated dashboard > unnecessary full-width charts
direct manipulation > tiny control buttons
typed configuration > generic dashboard builder
existing design system > visual reinvention
Tradenza quality benchmark > Tradenza clone
visual product quality > checkbox completion
actual interaction proof > component-presence test
human review > automated declaration of visual success
```
