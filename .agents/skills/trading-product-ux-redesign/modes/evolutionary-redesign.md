# Mode: Evolutionary Redesign

Use only when the existing workflow and component structure are substantially correct.

Before choosing this mode, demonstrate that:

- Information architecture is sound.
- State ownership is coherent.
- Component boundaries support the intended UX.
- Parallel routing is unnecessary.
- Incremental changes will not preserve known structural defects.

Change one vertical workflow at a time, preserve working behavior, add characterization tests before risky changes, and render after each slice.

Switch to greenfield mode if legacy structure blocks the approved UX.
