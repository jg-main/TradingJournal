# Mode: Full Application Greenfield

Use when redesigning most or all of TradingJournal while preserving the current application.

## Boundary

Reuse authoritative data, domain logic, schemas, APIs, accounting calculations, risk calculations, market-data services, and import/export logic.

Do not automatically reuse route structure, navigation, page composition, visual components, dashboard architecture, form layout, or state boundaries.

Build a parallel application experience under a clearly separated route or shell, such as `/next/*`, `/workspace/*`, or `/preview/*`.

Do not cut over until reviewed.

## Required milestone outputs

- Product-wide UX audit.
- New information architecture.
- Navigation model.
- Core user journeys.
- Surface inventory.
- Visual direction.
- Parallel-build strategy.
- Slice map.
- Cutover criteria.

## Recommended slice order

1. New shell and navigation.
2. One representative core workflow.
3. Shared primitives proven on that workflow.
4. Remaining high-frequency workflows.
5. Dashboard and analytical surfaces.
6. Settings and secondary workflows.
7. Migration and cutover.

Do not build a design system in isolation before a real workflow proves it.
