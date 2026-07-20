# Mode: Migration and Cutover

Use after a parallel redesign has been approved.

Required checks:

- Feature parity decision: required, intentionally changed, or removed.
- Data compatibility.
- URL and navigation migration.
- Saved-state migration.
- Legacy fallback.
- User preference migration.
- Browser evidence.
- Regression tests.
- Backup and rollback plan.

Do not delete the legacy experience in the same slice that first introduces the replacement unless explicitly approved.
