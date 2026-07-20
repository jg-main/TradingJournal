---
name: trading-product-ux-redesign
description: Plan, design, critique, implement, and verify substantial UX redesigns for TradingJournal using GSD-Pi. Use for full-application UX redesign, navigation and information architecture, dashboards and workstations, trade planning and journaling flows, account and ledger workflows, review experiences, forms, tables, dialogs, settings, import/export, and other user-facing milestones. Supports greenfield parallel builds and evolutionary redesigns. Prioritizes trader utility, workflow clarity, information density, evidence-driven visual review, and preservation of domain logic. Rejects generic SaaS, executive-dashboard, marketing-site, and mobile-first defaults unless explicitly required.
compatibility: GSD-Pi, Next.js, React, TypeScript, Tailwind CSS, shadcn/Radix, react-grid-layout, ECharts, TanStack Table, SQLite, Drizzle, Vitest, Playwright
---

# Trading Product UX Redesign

## Purpose

Use this skill for any substantial redesign of TradingJournal’s user experience, not only the dashboard.

Applicable surfaces include:

- Application shell and navigation.
- Trading workstation and dashboard.
- Trade planning and pre-trade workflow.
- Trade entry, execution, and position management.
- Trade log and journal.
- Trade review and grading.
- Account, ledger, cash, and performance views.
- Risk monitoring.
- Analytics and comparisons.
- Import and export.
- Settings and configuration.
- Empty, loading, error, and reconciliation states.
- Cross-surface user journeys.

This skill governs product reasoning, information architecture, interaction design, visual hierarchy, density, component architecture, migration strategy, screenshot review, and GSD-Pi decomposition.

Read `AGENTS.md`, repository preferences, and the active GSD context first.

## Product Identity

TradingJournal is:

- A serious trading tool.
- Used primarily by one trader.
- Desktop-first and data-intensive.
- Local-first unless explicitly changed.
- Intended for repeated operational use.
- A system for decisions, execution records, accountability, review, and improvement.

TradingJournal is not automatically:

- A generic SaaS admin product.
- An executive BI dashboard.
- A fintech marketing interface.
- A mobile-first card stack.
- A social or collaborative platform.
- A blank-canvas no-code builder.

Use the language and interaction patterns of trading, accounting, journaling, review, and analysis.

## Instruction Priority

1. Safety and repository integrity.
2. `AGENTS.md` and explicit project rules.
3. Active GSD-Pi milestone, slice, and task context.
4. Explicit user requirements.
5. This skill’s UX principles.
6. General frontend or aesthetic skills.
7. Framework defaults and template conventions.

General design skills may refine the result but must not override product identity, workflow logic, density, or approved evidence.

## Select One Mode

At the start of a milestone or substantial UX task, select exactly one primary mode:

- `full-application-greenfield`
- `surface-greenfield`
- `evolutionary-redesign`
- `dashboard-workstation`
- `workflow-redesign`
- `visual-critique`
- `implementation`
- `migration-cutover`

Read the matching file under `modes/` and record the selected mode in GSD context.

Do not combine greenfield and evolutionary assumptions silently.

## Mandatory Discovery

Before proposing a redesign:

1. Read `AGENTS.md`.
2. Read the active GSD milestone and prior slice evidence.
3. Inspect relevant routes, components, schemas, APIs, and domain services.
4. Identify domain invariants that must survive.
5. Identify the current user journey and failure points.
6. Inspect realistic data states.
7. Render the current surface when browser tooling is available.
8. Capture current viewport and interaction evidence.
9. Separate reusable domain logic from optional UI reuse.
10. Identify legacy assumptions that must not be inherited.

Do not infer UX from filenames alone.

## GSD-Pi Operating Model

Use:

```text
Milestone → Slice → Task → Subtask
```

Follow the repository’s configured lifecycle, normally:

```text
explore → plan → implement loop → review → verify → archive → commit
```

### Milestone must define

- User problem.
- Target user and context.
- Scope and exclusions.
- Selected UX mode.
- Domain invariants.
- Reuse and non-reuse boundaries.
- Visual direction.
- Required routes and journeys.
- Evidence plan.
- Coexistence or cutover strategy.
- Acceptance criteria.

### Slice must deliver

A reviewable vertical user outcome.

Good slices:

- New shell with working navigation.
- Complete trade-planning flow using fixtures.
- Account summary with ledger drill-down.
- New workstation route with realistic data.
- Trade review page with keyboard workflow.
- Dense table system proven on one real surface.

Weak slices:

- Create design system.
- Build components.
- Refactor UI.
- Improve styling.
- Add all pages.
- Implement all widgets.

At the end of every slice, render, record evidence, and reassess later slices.

## Universal UX Principles

### Workflow before decoration

Start with:

- User intent.
- Decision required.
- Information required.
- Action sequence.
- Validation.
- Error recovery.
- Confirmation.
- Next likely action.

Do not begin with cards, colors, gradients, or animation.

### Operational density

Allocate space by frequency, risk, and decision value.

High-frequency or high-risk information must be visible, compact, comparable, and close to related actions.

### One source of truth

Avoid duplicated account selectors, filter state, P&L, drawdown, position state, form state, review state, and validation rules.

### Progressive disclosure

Show immediate operational state first, supporting context second, and rare configuration on demand.

Do not hide current risk or required actions behind optional disclosure.

### Preserve domain semantics

A redesign must not weaken accounting integrity, trade lifecycle semantics, execution relationships, R calculations, risk limits, review states, reconciliation, or auditability.

### Explicit modes

Normal mode and editing/configuration mode must be visibly distinct.

### Desktop-first

Unless scope explicitly changes:

- Optimize for desktop.
- Support keyboard speed.
- Preserve data density.
- Do not collapse into mobile card stacks.
- Support desktop window resizing without sacrificing structure.

## Forbidden Defaults

Reject or challenge these unless the workflow clearly justifies them:

- One large card per metric.
- Oversized icon boxes.
- Large empty headers.
- Marketing gradients.
- Excessive rounding and shadows.
- Generic KPI grids.
- Full-width low-information charts.
- Repeated section descriptions.
- Long pages created by stacked dashboard sections.
- Mobile-first stacking on a desktop operational tool.
- Hidden critical warnings.
- Multiple selectors controlling the same domain.
- Components independently refetching shared data.
- Generic CRUD forms that ignore the decision sequence.
- Modal overload.
- Wizard flows for simple expert tasks.
- Empty states that consume large areas.
- Visual polish without realistic data.
- Completion claims based only on tests.

## Visual Character

Default character:

- Industrial.
- Precise.
- Restrained.
- Analytical.
- Fast.
- Quiet until attention is required.

Use neutral surfaces, fine borders, compact headers, tabular numerals, clear alignment, restrained semantic color, dense tables/forms, strong focus states, short labels, and contextual help.

Color communicates P&L, risk breach, missing/stale data, integrity failure, selection, validation, and workflow status—not decoration.

## Evidence Requirements

Every substantial visual slice must include:

- Realistic populated data.
- Exact viewport.
- Screenshot or browser evidence.
- Normal state.
- Relevant loading, empty, error, stale, or validation states.
- Interaction evidence for key actions.
- Explicit list of unmet acceptance criteria.

Tests support evidence; they do not replace it.

## Visual Review Questions

1. What can the user understand within three seconds?
2. What decision is the screen helping the user make?
3. Is the most important state visually dominant?
4. Does every large area earn its space?
5. Are related values and actions adjacent?
6. Are warnings distinguishable from ordinary negative outcomes?
7. Can the user recover from errors?
8. Does the screen preserve expert speed?
9. Does realistic data break the layout?
10. Does it look like TradingJournal rather than a generic template?

## Completion Gate

Do not call a UX milestone complete unless:

- The redesigned workflow is end-to-end usable.
- Domain invariants are preserved.
- Reuse and non-reuse boundaries were respected.
- Realistic data was used.
- Visual evidence was reviewed.
- Primary degraded states were reviewed.
- Navigation and keyboard behavior are coherent.
- No duplicate state or conflicting controls remain.
- The result is recognizably TradingJournal.
- Unmet acceptance criteria are recorded.
- Cutover or coexistence behavior is defined.

## References

Read only what the active mode requires:

- `references/gsd-pi-workflow.md`
- `references/product-principles.md`
- `references/visual-qa.md`
- `references/tradingjournal-architecture.md`
- `references/dashboard-workstation.md`
