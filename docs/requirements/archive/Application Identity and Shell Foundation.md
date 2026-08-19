# M014 — Application Identity and Shell Foundation

**Repository:** `jg-main/TradingJournal`  
**Starting point:** `main` at or after `f1534b60717376d5ade7b48ef500099f1315a5bc`  
**Milestone type:** Design-system foundation and application-shell implementation  
**Primary proving surface:** Trades page  
**Priority:** High  
**Risk classification:** User-facing, cross-application presentation change with strict functional-regression constraints

---

## 1. Purpose

Establish a coherent visual identity and application shell for TradingJournal, then apply that foundation to the accepted Trades page.

The product should feel:

> **Industrial. Precise. Restrained. Analytical. Fast. Quiet until attention is required.**

The result must look like a professional trading workstation rather than a generic dashboard assembled from unrelated UI components.

This milestone is not a speculative redesign exercise. It must produce implemented, reusable tokens and components that become the foundation for subsequent Dashboard, Trade Detail, Review, and Account Detail milestones.

---

## 2. Context

The Trades page has completed its functional and financial-accuracy remediation work. Its current calculations, API contracts, lifecycle protections, filters, columns, totals, and warning states are the accepted baseline.

The current application already uses:

- Tailwind CSS 4
- shadcn/Radix primitives
- Geist Sans and Geist Mono
- semantic CSS variables in `src/app/globals.css`
- light and dark themes
- tabular-number formatting in financial surfaces

However, the current visual system is still generic and inconsistent across surfaces. The existing primary color is green-toned, which conflicts with the financial meaning of positive P&L. Navigation, page hierarchy, density, status colors, and component treatment require a unified product identity.

---

## 3. Milestone objective

By completion:

1. TradingJournal has a documented semantic color and typography system.
2. Green and red are reserved for financial or operational meaning, not general navigation or primary actions.
3. The application shell has consistent navigation hierarchy, active states, page headers, spacing, and responsive behavior.
4. Core UI primitives follow one density, border, radius, focus, and state system.
5. The Trades page demonstrates the identity without changing its accepted behavior.
6. Both light and dark themes are production-ready.
7. Accessibility, keyboard use, loading states, and warning states remain correct.
8. The complete repository quality gate passes at the final milestone SHA.

---

## 4. Design direction

### 4.1 Identity

Use a **Graphite + Steel Blue** identity.

- **Graphite/slate neutrals** define the workspace, surfaces, borders, and typography.
- **Steel blue** is the primary interaction and selection color.
- **Green** is reserved for gains, positive P&L, valid positive outcomes, and confirmed healthy states.
- **Red** is reserved for losses, destructive actions, validation errors, and genuine failures.
- **Amber** is reserved for warnings, stale prices, incomplete data, pending review, and attention states.
- **Muted gray** represents unavailable, missing, disabled, or not-applicable data.
- Decorative color must be limited. Most surfaces should remain neutral.

Primary actions, active navigation, selected tabs, focus rings, and links must not use profit green.

### 4.2 Visual character

The application should use:

- restrained contrast;
- border-driven separation rather than large shadows;
- compact workstation density;
- clear visual hierarchy;
- minimal gradients;
- limited corner radius;
- consistent tabular numerals;
- color only where it carries information;
- high information density without visual clutter.

Avoid:

- oversized KPI cards;
- bright decorative backgrounds;
- excessive rounded containers;
- multiple competing accent colors;
- card-within-card layouts without hierarchy;
- large unused whitespace;
- green as the general brand or action color;
- decorative animation.

---

## 5. Semantic token requirements

### 5.1 Token families

Implement or normalize semantic tokens for:

#### Surfaces

- `background`
- `surface`
- `surface-raised`
- `surface-subtle`
- `surface-selected`
- `popover`
- `sidebar`

#### Text

- `foreground`
- `foreground-muted`
- `foreground-subtle`
- `foreground-inverse`
- `foreground-disabled`

#### Structure

- `border`
- `border-strong`
- `border-subtle`
- `input`
- `ring`

#### Interaction

- `primary`
- `primary-hover`
- `primary-active`
- `primary-foreground`
- `secondary`
- `secondary-hover`
- `accent`
- `link`

#### Financial and operational state

- `positive`
- `positive-subtle`
- `negative`
- `negative-subtle`
- `warning`
- `warning-subtle`
- `info`
- `info-subtle`
- `destructive`
- `destructive-subtle`
- `missing`
- `stale`
- `success`

#### Charts

Provide a restrained chart palette with:

- one primary series;
- one comparison series;
- positive and negative series;
- neutral reference/grid colors;
- up to five distinguishable categorical series.

Chart colors must remain legible in both themes and must not redefine the application’s status semantics.

### 5.2 Implementation rules

- Tokens must be defined centrally in `src/app/globals.css` or a directly imported token file.
- Components must consume semantic classes/tokens instead of arbitrary color literals.
- Do not spread `text-blue-*`, `bg-green-*`, `border-red-*`, or equivalent one-off values through page code when a semantic token applies.
- Existing shadcn-compatible variable names may remain, but their values and usage must align with this specification.
- Create an explicit mapping between shadcn tokens and TradingJournal semantic intent.
- Light and dark themes must be designed separately; dark mode must not be a simple inversion.
- Any new token must have a clear semantic purpose documented in the design-system document.

---

## 6. Typography and numeric presentation

### 6.1 Font policy

Retain the existing fonts:

- **Geist Sans:** primary interface font
- **Geist Mono:** trade codes, identifiers, technical values, and selected dense numeric contexts

Do not add another font dependency in this milestone.

### 6.2 Hierarchy

Define reusable typography treatments for:

- application/product name;
- page title;
- page description;
- section heading;
- card/panel heading;
- table header;
- body text;
- helper text;
- metadata;
- badge/status label;
- empty state;
- numeric KPI;
- technical identifier.

### 6.3 Financial numbers

- Use `font-variant-numeric: tabular-nums`.
- Preserve explicit signs where they help interpretation.
- Currency, price, percentage, quantity, and R-multiple formatting must remain consistent with the accepted formatters.
- Do not replace existing financial formatters with local formatting.
- Missing values must remain visually distinct from zero.
- Negative and positive values must not rely on color alone; sign, label, icon, or contextual text must remain available.

---

## 7. Density, spacing, radius, and elevation

### 7.1 Density target

Use a compact desktop-workstation density:

- primary control height: approximately 32–36 px;
- standard table row height: approximately 36–40 px;
- compact table row height where appropriate: approximately 32–36 px;
- panel padding: generally 12–16 px;
- page section gap: generally 16–24 px;
- dense inline groups: generally 6–12 px.

These are targets, not requirements to hardcode every component to the same size.

### 7.2 Radius

- Use a restrained default radius, approximately 6–8 px.
- Inputs, buttons, tabs, cards, dropdowns, and alerts must share a consistent radius family.
- Avoid pill shapes except for compact badges, statuses, and segmented controls.

### 7.3 Elevation

- Use borders and surface contrast as the primary separation mechanism.
- Reserve shadows for floating overlays, dialogs, dropdowns, and genuinely raised content.
- Ordinary page panels should not use large shadows.

---

## 8. Application shell requirements

### 8.1 Navigation model

Organize existing routes by user job rather than by database entity.

Recommended top-level grouping:

1. **Trading**
   - Dashboard / Workstation
   - Trades
   - Review, only if an existing functional route is available

2. **Accounts**
   - Accounts
   - Account operations reachable through Account Detail

3. **Analysis**
   - Existing performance, reports, or analytics routes only

4. **System**
   - Settings
   - Backup, import, export, or maintenance routes where already available

Rules:

- Do not add navigation items for unfinished or nonexistent pages.
- Do not rename routes in a way that breaks bookmarks unless redirects are provided.
- Keep the number of top-level navigation items limited.
- Rare maintenance actions belong under System, not alongside daily trading actions.

### 8.2 Sidebar

The sidebar must provide:

- clear active-route treatment;
- group labels with low visual weight;
- consistent icon size and alignment;
- visible product identity;
- collapsed mode if the current shell supports it or it can be implemented without destabilizing navigation;
- accessible tooltips or labels in collapsed mode;
- keyboard-accessible links;
- clear separation between navigation and account/system controls;
- no decorative green active state.

### 8.3 Page frame

Create or normalize a reusable page-frame pattern containing:

- page title;
- optional description;
- optional breadcrumbs where they add real orientation;
- primary actions;
- secondary actions;
- optional status/context line;
- consistent top and side spacing;
- full-width content support for table-heavy pages.

Pages must not independently invent header layouts.

### 8.4 Responsive behavior

This remains a desktop-first trading application, but the shell must:

- remain usable at common laptop widths;
- avoid clipped primary actions;
- collapse or reflow navigation predictably;
- preserve horizontal table behavior;
- avoid silently hiding critical risk or warning information.

Mobile-phone optimization is not a primary objective for this milestone.

---

## 9. Core component normalization

Normalize the following shared primitives without changing their functional contracts:

- Buttons
- Icon buttons
- Inputs
- Selects
- Date inputs
- Tabs
- Badges
- Alerts
- Tooltips
- Dropdown menus
- Dialogs
- Cards/panels
- Empty states
- Loading skeletons
- Tables
- Pagination
- Page headers
- Section headers

### 9.1 State requirements

Every interactive primitive must define:

- default;
- hover;
- active/pressed;
- focus-visible;
- disabled;
- loading where relevant;
- validation error where relevant.

### 9.2 Warning hierarchy

Use visibly different treatments for:

| State | Required semantic treatment |
|---|---|
| Positive P&L / confirmed healthy | Positive |
| Negative P&L | Negative |
| Destructive operation | Destructive; visually stronger than ordinary loss |
| Validation failure | Error/destructive |
| Stale price | Warning/stale |
| Missing market price | Missing or warning, depending on operational impact |
| Missing stop / risk breach | High-attention warning or destructive |
| Pending review | Warning/attention |
| Informational note | Info |
| Disabled or not applicable | Muted |

A monetary loss must not look identical to a destructive-delete action.

---

## 10. Trades page proving-surface requirements

Apply the new identity and shell to the latest accepted Trades page.

### 10.1 Strict preservation rule

This milestone must not alter:

- trade calculations;
- FIFO behavior;
- P&L semantics;
- Open Risk;
- Risk to Account;
- Portfolio Heat;
- missing-market-price handling;
- planned-risk direction validation;
- stop lifecycle protections;
- stop chronology;
- API response contracts;
- filters;
- date behavior;
- pagination behavior;
- column calculations;
- export behavior;
- row navigation;
- action-menu behavior;
- Planned, Open, and Closed footer content;
- current table column availability;
- current accepted tests, except where selectors require stable semantic updates.

### 10.2 Permitted Trades changes

Permitted changes are presentation-level:

- page header structure;
- tab styling;
- filter-bar layout;
- button hierarchy;
- table density and header treatment;
- selected/hover/focus states;
- totals-panel styling;
- warning-state styling;
- empty/loading/error presentation;
- spacing and responsive behavior;
- consistent use of semantic tokens;
- replacement of arbitrary color classes with semantic classes.

### 10.3 Trades page visual hierarchy

The page should visually prioritize:

1. Page identity and primary actions
2. Planned/Open/Closed navigation
3. Filters and date controls
4. Trade table
5. Current tab totals
6. Pagination and secondary operations

Do not convert the page into a card grid.

### 10.4 Totals panels

Preserve these accepted content contracts:

#### Open Positions Total

- Unrealized P&L
- Portfolio Heat $
- Portfolio Heat %
- Open Positions
- Complete, partial, and awaiting-market-price states

#### Closed Trades Total

- Gross P&L
- Fees
- Net P&L
- Trades
- No By Currency section

#### Planned Totals

- Planned Risk
- Planned Capital
- Trades

The redesign must improve hierarchy without duplicating these values elsewhere.

---

## 11. Documentation deliverables

Create:

### `docs/design-system.md`

It must document:

- product design principles;
- semantic color meanings;
- light and dark token tables;
- typography hierarchy;
- density rules;
- radius and elevation rules;
- financial number conventions;
- warning-state hierarchy;
- component usage guidance;
- examples of prohibited arbitrary color usage.

### Optional component reference page

A development-only component reference route may be created if it materially helps verify the system. It must not be linked in production navigation unless explicitly intended.

---

## 12. Implementation slices

### S01 — Identity audit and semantic tokens

- Inventory current color variables and arbitrary color usages.
- Define the Graphite + Steel Blue identity.
- Implement semantic tokens for light and dark themes.
- Map existing shadcn tokens to the new system.
- Document color-state rules.
- Add contrast checks for core text and controls.

**Exit condition:** A tokenized light/dark foundation exists and no core identity decision remains unresolved.

### S02 — Typography, density, and primitive normalization

- Normalize typography hierarchy.
- Normalize numeric presentation.
- Standardize radius, spacing, control heights, borders, and elevation.
- Update shared buttons, inputs, tabs, badges, alerts, dialogs, dropdowns, cards, skeletons, and empty states.
- Ensure focus-visible behavior is consistent.

**Exit condition:** Shared primitives display consistently in both themes without page-specific hacks.

### S03 — Application shell and navigation

- Implement the navigation hierarchy using existing routes.
- Normalize sidebar active, hover, collapsed, and focus states.
- Implement the reusable page-frame/header pattern.
- Verify laptop-width and full-width-table behavior.
- Preserve route compatibility.

**Exit condition:** Existing major pages render within one consistent shell.

### S04 — Apply identity to Trades

- Apply the page frame.
- Restyle tabs, controls, table, totals, pagination, and warnings.
- Remove arbitrary presentation colors in the Trades surface.
- Preserve all accepted behavior and contracts.
- Add or update presentation-focused component tests as needed.

**Exit condition:** Trades is the canonical example of the new identity with no functional regression.

### S05 — Accessibility, regression, and visual acceptance

- Verify keyboard navigation and focus visibility.
- Verify light and dark themes.
- Verify contrast for body text, muted text, controls, warnings, P&L, and disabled states.
- Run complete quality gates.
- Capture acceptance screenshots.
- Perform browser-based UAT with realistic Planned, Open, and Closed data.

**Exit condition:** All quality gates pass and visual acceptance evidence is retained.

---

## 13. Required acceptance scenarios

### 13.1 Theme and shell

- Light theme at 1440×900
- Dark theme at 1440×900
- Light theme at 1920×1080
- Dark theme at 1920×1080
- Sidebar active state
- Sidebar collapsed state, if implemented
- Keyboard traversal through navigation
- Page title and actions at laptop width
- Dialog, dropdown, tooltip, and alert layering

### 13.2 Trades

Populate realistic data that demonstrates:

- at least one Planned Long trade;
- at least one Planned Short trade;
- valid and invalid planned-stop feedback;
- at least two Open positions;
- positive and negative P&L;
- one open position without a current market price;
- Partial Unrealized P&L state;
- Awaiting market prices state;
- Portfolio Heat values;
- Closed trades with gains and losses;
- pagination;
- account and direction filters;
- date presets;
- action menus;
- empty state;
- API error state;
- loading skeleton.

### 13.3 Accessibility

- Visible keyboard focus on all actionable controls
- No keyboard trap in dialogs or dropdowns
- Form errors associated with their inputs
- Color is not the only carrier of financial or validation meaning
- Minimum acceptable contrast for normal text and controls
- Disabled controls remain distinguishable

---

## 14. Automated verification

At the final milestone SHA, run:

```bash
make lint
make typecheck
make test-all
make build
make playwright
```

If the repository does not expose one of these Make targets, run the authoritative equivalent and document the exact command.

### Required regression focus

At minimum, preserve passing coverage for:

- Trades page footer states
- Planned-stop validation
- Stop-adjustment lifecycle
- Signed stop/trigger distances
- Filters and pagination
- Actions-menu propagation
- Missing-market-price behavior
- Open/Closed/Planned tab behavior

Add browser tests for:

- shell navigation;
- light/dark rendering;
- Trades page primary actions;
- tab selection;
- filter layout;
- totals visibility;
- warning-state appearance;
- keyboard focus.

---

## 15. Visual acceptance evidence

Retain screenshots or an equivalent review artifact for:

1. Full shell — light
2. Full shell — dark
3. Trades Open tab — normal priced data
4. Trades Open tab — partial/unpriced market data
5. Trades Closed tab
6. Trades Planned tab with validation error
7. Dropdown/action menu
8. Dialog/form state
9. Laptop-width layout
10. Empty or degraded state

Screenshots must use realistic data and must not rely solely on blank fixtures.

---

## 16. Non-goals

This milestone does **not** include:

- Dashboard information-architecture redesign
- Trade Detail lifecycle redesign
- Post-trade Review redesign
- Account Detail tab redesign
- New analytics
- Changes to trading calculations
- New financial metrics
- Changes to database schema for presentation purposes
- Route renaming without redirects
- New unfinished navigation destinations
- Full mobile-phone redesign
- Replacing Geist fonts
- Introducing Storybook unless independently justified
- Adding decorative animation
- Reopening the accepted Trades Page Final Accuracy requirements

Those surfaces will consume the M014 foundation in later milestones.

---

## 17. Definition of done

M014 is complete only when:

- [ ] The semantic design system is implemented, not merely documented.
- [ ] Light and dark palettes have been intentionally designed.
- [ ] General interaction color no longer conflicts with profit green.
- [ ] Shared primitives follow consistent states and density.
- [ ] The application shell and navigation hierarchy are implemented.
- [ ] The page-frame/header pattern is reusable.
- [ ] The accepted Trades page uses the new identity.
- [ ] No accepted Trades calculation, contract, or workflow has changed.
- [ ] Arbitrary presentation colors are materially reduced.
- [ ] Keyboard and focus behavior are verified.
- [ ] Realistic browser UAT is complete.
- [ ] Acceptance screenshots are retained.
- [ ] Lint passes.
- [ ] Typecheck passes.
- [ ] Full tests pass.
- [ ] Production build passes.
- [ ] Playwright passes.
- [ ] `docs/design-system.md` is complete.
- [ ] The final commit records the exact quality-gate results.

---

## 18. Completion report requirements

The final GSD completion report must include:

- milestone start and end SHA;
- files changed;
- tokens introduced or changed;
- components normalized;
- routes included in the shell;
- explicit confirmation that Trades business logic was not changed;
- automated test results;
- Playwright result;
- screenshots or artifact locations;
- known limitations;
- deferred work for Dashboard, Trade Detail, Review, and Account Detail;
- exact model routing and escalation events used during the milestone, where available.

---

## 19. Product-owner acceptance statement

The milestone should be accepted when the application has a recognizable, restrained trading-workstation identity; navigation and page hierarchy are coherent; the Trades page looks materially more deliberate and professional; financial state colors remain semantically trustworthy; and the accepted functionality remains unchanged.
