---
name: trading-product-ux
description: Plan, critique, implement, and verify substantial TradingJournal UX work using GSD-Pi. Use for navigation and information architecture, dashboards and workstations, trade planning and journaling flows, account and ledger workflows, review experiences, forms, tables, dialogs, settings, import/export, and other user-facing milestones. Prioritizes trader utility, workflow clarity, information density, evidence-driven visual review, and preservation of domain logic.
---

# Trading Product UX

## Purpose

Use this skill for substantial TradingJournal UX work, not only dashboards.

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

This skill governs product reasoning, information architecture, interaction
design, visual acceptance, and GSD-Pi decomposition. For visual tokens,
primitives, density values, and prohibited patterns, follow
`docs/design-system.md`; do not restate or replace it here.

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

- `evolutionary-redesign`
- `dashboard-workstation`
- `workflow-redesign`
- `visual-critique`
- `implementation`

Read the matching file under `modes/` and record the selected mode in GSD
context. Use `implementation` when the workflow and visual direction are
already approved.

## Mandatory Discovery

Before proposing a material workflow or structure change:

1. Read `AGENTS.md`.
2. Read the active GSD milestone and prior slice evidence.
3. Inspect relevant routes, components, schemas, APIs, and domain services.
4. Identify domain invariants that must survive.
5. Identify the current user journey and failure points.
6. Inspect realistic data states.
7. Render the current surface when browser tooling is available.
8. Capture current viewport and interaction evidence.
9. Separate reusable domain logic from optional UI reuse.

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
- Visual direction.
- Required routes and journeys.
- Evidence plan.
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

UX work must not weaken accounting integrity, trade lifecycle semantics,
execution relationships, R calculations, risk limits, review states,
reconciliation, or auditability.

### Explicit modes

Normal mode and editing/configuration mode must be visibly distinct.

### Desktop-first

Unless scope explicitly changes:

- Optimize for desktop.
- Support keyboard speed.
- Preserve data density.
- Do not collapse into mobile card stacks.
- Support desktop window resizing without sacrificing structure.

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
- Realistic data was used.
- Visual evidence was reviewed.
- Primary degraded states were reviewed.
- Navigation and keyboard behavior are coherent.
- No duplicate state or conflicting controls remain.
- The result is recognizably TradingJournal.
- Unmet acceptance criteria are recorded.

## References

Read only what the active mode requires:

- `references/gsd-pi-workflow.md`
- `references/product-principles.md`
- `references/visual-qa.md`
- `references/tradingjournal-architecture.md`
- `references/dashboard-workstation.md`
