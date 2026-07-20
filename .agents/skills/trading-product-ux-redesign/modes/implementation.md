# Mode: Implementation

Use after a UX direction has been approved.

Required inputs:

- Approved workflow or screenshot.
- Acceptance criteria.
- Data contracts.
- Reuse boundary.
- Target route.
- Degraded-state requirements.
- Active GSD slice.

Rules:

- Implement the approved behavior, not a new design.
- Keep route components thin.
- Centralize shared state.
- Avoid duplicate fetching.
- Preserve domain invariants.
- Use existing packages unless a limitation is demonstrated.
- Add tests for behavior and contracts.
- Add browser evidence for visual results.
- Do not hide unmet visual criteria behind passing tests.
