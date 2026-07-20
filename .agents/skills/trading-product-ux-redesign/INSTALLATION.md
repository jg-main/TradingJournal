# Installation

Copy `trading-product-ux-redesign` into the project-local skill location used by GSD-Pi.

Common locations:

```text
.agents/skills/trading-product-ux-redesign/
.claude/skills/trading-product-ux-redesign/
.github/skills/trading-product-ux-redesign/
```

Preserve the full structure.

## Full-product greenfield invocation

```text
Use the trading-product-ux-redesign skill.

Mode: full-application-greenfield

Create a GSD-Pi milestone for a parallel UX redesign of TradingJournal.
Reuse authoritative data and domain logic, but do not inherit the existing
information architecture or visual component structure. Decompose the work
into reviewable vertical slices. Every visual slice must include realistic
data, browser evidence, and explicit unmet acceptance criteria.
```

## Dashboard invocation

```text
Use the trading-product-ux-redesign skill.

Mode: dashboard-workstation

Build a new parallel workstation route. Reuse existing data and calculations,
but take no UI architecture from the current dashboard. Approve the 1440×900
fixture-data result before production integration.
```
