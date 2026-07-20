# Mode: Surface Greenfield

Use when replacing one major surface while preserving the current version.

Examples: dashboard, trade log, trade review, account detail, settings.

The existing surface is not a visual or architectural reference.

Reuse only authoritative data and domain logic. Build a separate route or feature flag.

Sequence:

1. Audit available data and domain operations.
2. Define the user decision and workflow.
3. Build realistic fixture prototype.
4. Review screenshots and interactions.
5. Approve the direction.
6. Integrate authoritative data.
7. Verify degraded states.
8. Compare old and new.
9. Decide cutover separately.

Do not refactor the old UI during the greenfield slice.
