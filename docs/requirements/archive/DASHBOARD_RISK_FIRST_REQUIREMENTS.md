# Risk-First Dashboard Requirements

> **Follow-on display requirement (2026-08-12):**
> [Dense Dashboard Layout and Data Display Requirements](DASHBOARD_DENSE_LAYOUT_REQUIREMENTS.md)
> supersedes this document's default-widget distribution and summary-panel
> presentation. The current-state, metric, provenance, and reconciliation
> contracts in this document remain authoritative.

**Status:** Ready for development planning  
**Owner:** Trading Journal product  
**Date:** 2026-08-12  
**Audience:** Development, QA, and product review

## 1. Purpose

Build the dashboard as a dependable trading workstation whose first job is to
help the trader manage open exposure. Its first screen must answer, without
browser zoom:

1. What positions are open in this account?
2. What capital is currently at risk, and which positions have no valid stop?
3. Is the displayed market state complete and current enough to trust?
4. What is the account state, including exposure, cash/NAV, and drawdown?

Retrospective performance and journal review remain important, but are the
second job. They must never displace current risk, open positions, or a
material data-quality warning from the normal dashboard view.

This document translates the Phase 2 production review into an implementable
contract. It does not authorize a visual-only patch that leaves computation
ambiguity in place.

## 2. Product decisions and precedence

This specification implements the approved risk-first dashboard direction:

- The normal dashboard is a curated **Risk & Positions** workstation.
- Saved views let a user organize information for a particular workflow, but
  customization is explicit and never turns the default into a blank canvas.
- The default risk workflow uses one browser/document scroll path. It must not
  make the trader scroll inside Account State, Performance, Open Positions, or
  Process Review to inspect their normal content.
- Watchlist is not part of the default Risk & Positions layout. It remains
  available from the Watchlist navigation surface and as an explicit addition
  to a saved custom view.
- The acceptance viewports are a **2560 × 1440** desktop at normal browser zoom
  and a laptop effectively **1536 × 960** CSS pixels (**1920 × 1200** at 125%
  display scaling).
- Price-derived values visibly identify their scope, data state, source, and
  as-of time. Stale, partial, or unavailable prices must not look like a
  complete current P&L value.
- The supplied Myfxbook examples are useful as an analytics catalogue and
  interaction reference, not a visual template. Trading Journal retains its
  established dark, data-dense workstation design.

For future dashboard implementation, this document supersedes conflicting
future-facing direction in the earlier dashboard redesign and follow-up
requirements. Historical documents remain useful as context, but their
mobile-first, terminal-at-1440 × 900, unrestricted blank-view, and
performance-first directions are not acceptance criteria for this delivery.

## 3. Review evidence and problem statement

The production review found both a visual hierarchy problem and a financial
truthfulness problem.

| Observation | Verified effect | Required outcome |
| --- | --- | --- |
| The current workstation reserves large areas for an empty watchlist and an empty equity surface while current risk is confined to a narrow rail. | The first screen does not prioritize actionable open exposure. | The default view must allocate its most useful first-screen space to the current-risk summary and open-position table. Empty secondary panels must collapse, move below the primary area, or use a compact actionable empty state. |
| Dashboard labels, table headers, rows, and controls use a terminal-scale type system. | On the supplied normal desktop and laptop views the dashboard is materially harder to read than the Trades page. | Use the established dashboard readability contract: decision labels and headers at least 12px, data cells at least 13px, primary values 16–20px, and normal table rows 36–40px. |
| The dashboard combines a journal-performance source with a separate accounting-position valuation source. | A single account can show different “open” counts and position universes in the same viewport. | Every displayed count and total must declare whether it represents account positions, journal trades, or a selected-period performance set. The default position table represents account positions. |
| The accounting valuation summary sums only positions with a calculated unrealized P&L and omits null values. | In the supplied production state, VCTR +$10.74 plus AMRX +$0.20 appeared as ordinary Open P&L +$10.94 even though CAKE had no dashboard mark and showed —. | A partial subset can never render as an ordinary Open P&L, NAV, marked positions, or Total P&L amount. Its state and missing count must be primary. |
| The Trades page showed CAKE +$24.10 and VCTR +$10.74, an aggregate +$34.84, while the dashboard showed a different open count and +$10.94. | The trader cannot tell whether the dashboard is stale, partial, or using a different calculation/universe. | Journal-linked values must reconcile exactly with Trades for the same mark snapshot. Account-only exposure must be separately identified, not silently blended into a journal figure. |

The +$10.94 observation is a release-blocking example of the partial-total
defect. Relabelling it or changing its color is not a fix.

## 4. Scope and non-goals

### In scope

- A reconciled current-account read model for risk, positions, market-data
  health, and account state.
- A curated risk-first default dashboard and explicit saved views.
- Accurate, scoped current P&L, open risk, exposure, stop coverage, and account
  state.
- A period-performance and analytics experience that exposes all currently
  supportable high-value journal metrics.
- Clear loading, error, fresh, stale, partial, unavailable, empty, and mixed
  attribution states.
- Unit, integration, API-contract, browser, and visual evidence for the
  calculation and workstation contracts.

### Not in scope

- Replacing the application identity, navigation shell, Trades workflow, or
  trade lifecycle.
- Inventing market-history data to fabricate MAE/MFE, risk-of-ruin, or other
  analytics that are not supported by the recorded data.
- A mobile redesign. The dashboard must remain structurally safe at narrower
  widths, but desktop workstation readability is the delivery target.
- A user-programmable dashboard, arbitrary widgets, executable view
  definitions, or a default blank workspace.
- Changing an established financial calculation merely to make two screens
  agree. Any domain change must have an explicit calculation contract and
  regression tests.

## 5. Information architecture

### 5.1 Normal view: Risk & Positions

The default view is fixed in normal mode and follows this vertical priority:

1. **Command and state bar** — account, current-performance period, active
   saved view, refresh state, and the latest successful market-data update.
2. **Data-quality alert strip** — shown whenever a current-value metric is
   stale, partial, unavailable, or has an integrity error. It is outside the
   customizable layout and cannot be dismissed as resolved until the condition
   is resolved.
3. **Current exposure and risk summary** — account-position count, journal
   trade count when different, Open P&L state, open risk, portfolio heat, stop
   coverage, gross/net exposure, and largest concentration.
4. **Performance and account state** — a balanced two-column overview row:
   Performance on the left and Account State on the right. Account State
   includes compact NAV, cash, marked-value state, current and maximum
   drawdown, and an appropriately sized equity/drawdown view when history
   exists.
5. **Open positions** — the full-width primary table. It must be large enough
   to scan and reconcile positions without opening a second page.
6. **Process review** — a full-width review area for setup, direction,
   execution-quality, checklist, and review metrics.
7. **Period KPI strip** — a compact supporting summary below the operational
   panels; it is never a competing first-row KPI wall.

The command/state bar, any material alert, risk summary, and the paired
Performance/Account State overview must be readable at the target desktop and
laptop viewports without browser zoom. Open Positions begins immediately after
that overview and remains the next primary object in the browser's normal page
scroll. The browser page is the only normal scrolling container for the default
workflow; the panels listed above must grow to their content rather than each
introducing its own scrollbar. An equity chart, watchlist, setup ranking, or
review widget must not consume first-screen space when it has no data or lower
operational value.

### 5.2 Position table contract

The table represents **non-flat account positions**, keyed by account and
instrument. Its title and count use **Open account positions: N** rather than
an ambiguous **Open: N**.

At the target viewports, the default columns are:

| Column | Requirement |
| --- | --- |
| Symbol | Sticky identifier; opens the underlying position/trade detail. |
| Attribution | Journal, Account only, or Mixed, with linked-journal-trade count where relevant. |
| Side and quantity | Direction and the actual open quantity. |
| Open average cost | Cost basis used by the displayed position calculation. |
| Mark | Price, data-state text, source, and as-of time; an age alone is insufficient. |
| Unrealized P&L | Position value or — when it cannot be calculated; never substitute zero. |
| Active stop | Effective active stop, or an explicit No valid stop state. |
| Current risk | Remaining risk to the active stop, or Incomplete when no valid stop exists. |
| Exposure | Current marked exposure, with the same mark-completeness state. |

The default sort is the most actionable risk ordering: missing/invalid stop,
missing/stale mark, then largest current risk or exposure. Users may select a
different saved sort, but the default must surface action required now.

On the target viewports, this table may use compact columns but must not rely
on horizontal scrolling to expose mark state, P&L, stop state, or current
risk. Narrow fallback views may scroll horizontally with Symbol retained.

### 5.3 Saved views and customization

Provide these curated starting views:

- **Risk & Positions** — immutable system default and startup view until the
  user explicitly selects another saved view. It contains the risk summary,
  paired Performance and Account State overview, full-width Open Positions,
  full-width Process Review, and compact KPI strip. Watchlist starts hidden.
- **Performance** — period performance, equity/drawdown, calendar, and
  performance breakdowns.
- **Process Review** — setup, direction, execution-quality, checklist, and
  review metrics.

Users may create a saved view from one of these templates, duplicate, rename,
reorder supported panels, resize declared-resizable panels, hide optional
panels, show Watchlist when it is useful to that saved workflow, delete their
own views, and reset a view to its template. A user view may be selected as
their startup view.

Normal mode has no drag handles or resize handles. **Customize** enters a clear
editing state with Save, Cancel, Undo, and Reset. Critical data-quality alerts
remain outside the editable layout. The system default can always be restored
and cannot be overwritten.

Saved layout configuration must be validated and versioned. It may reference
only the approved first-party widget catalogue and declared options; it must
not accept code, markup, queries, or arbitrary component names.

## 6. Data and calculation requirements

### 6.1 Separate the three data scopes

The dashboard must make these scopes explicit and must never use one as an
unlabelled substitute for another:

| Scope | Purpose | Filter behavior |
| --- | --- | --- |
| **Current account state** | Non-flat account positions, marks, exposure, risk, stop coverage, NAV, and current drawdown. | Ignores a retrospective date range. It is “now.” |
| **Current journal state** | Open journal trades and their canonical trade metrics. | Ignores a retrospective date range. It is “now.” |
| **Period performance** | Closed-trade P&L, review metrics, calendars, distributions, and comparisons. | Obeys account and selected period/filter controls. |

When counts differ, show both with these labels rather than choosing a single
ambiguous **Open** number. For example: **3 open account positions · 2 open
journal trades**.

### 6.2 One coherent dashboard snapshot

The normal dashboard must consume a single parent-owned overview snapshot for
the active account. It may compose existing journal, accounting, and market
data internally, but it must expose one timestamped, typed result to the
default panels.

Requirements:

- Panels do not independently fetch or recompute shared positions, P&L,
  account state, or price freshness.
- Every current-state field carries a common snapshot identifier or computed-at
  timestamp so a rendered view cannot mix values from unrelated refreshes.
- Live market refresh updates only current-state data. Historical performance
  refreshes only when its filters or journal data change.
- A transport or provider failure preserves the last known values as **stale
  last known**, with a visible failure state. It must not retain a **Live** or
  **Fresh** presentation merely because a polling loop is running.

### 6.3 Market data provenance and freshness

For each position mark and every aggregate derived from it, return enough
metadata to explain the number:

- market-data source/provider;
- source/as-of timestamp and dashboard computed-at timestamp;
- status: **fresh**, **stale**, **missing**, or **unavailable**;
- age or session context as secondary metadata;
- the configured freshness policy result, not a UI-local threshold.

Freshness policy belongs to one centrally configured market-data policy. It
must be testable by injecting a policy/clock and may vary by provider, asset
class, market session, or account where the product supports that distinction.
No dashboard surface may silently apply its own hard-coded 24-hour rule.

Status must use text and an accessible label in addition to color or an icon.
A price from a prior market session can be shown when useful, but it is not
presented as a current live mark.

### 6.4 Open P&L completeness contract

**Open P&L** means the net unrealized P&L over the explicitly named position
universe, after the product's canonical fee treatment. It is not a synonym for
the sum of whatever rows happened to have a price.

| Position-mark state in the metric universe | Required primary Open P&L presentation |
| --- | --- |
| No open positions | $0.00, 0 positions, and Not applicable for mark coverage. |
| All positions have fresh, calculable marks | Signed currency amount labelled Current Open P&L; show coverage and as-of metadata. |
| One or more marks are stale and none are missing | A value may be shown only as Stale Open P&L, with the oldest applicable as-of timestamp and stale count. It cannot be styled or included as a fully current account total. |
| One or more marks are missing, invalid, or unavailable | Primary value is — Partial — N unpriced. Do not show a normal signed total. An optional subordinate Marked subset P&L may show the known amount only with its M of N marked coverage and never as Open P&L. |
| Snapshot/provider error | Primary value is — Unavailable; retain a separately labelled last-known value only when timestamp and source are visible. |

The same completeness rule applies to price-derived NAV, marked positions,
Total P&L, exposure, concentration, and any chart point. A dashboard must not
render a numerical zero for unknown valuation.

### 6.5 Cross-surface P&L reconciliation

For a journal-linked trade or position at the same mark snapshot:

- Dashboard remaining quantity, average cost, realized P&L, and net unrealized
  P&L must equal the corresponding Trades list and trade-detail values to the
  currency precision used by the product.
- The dashboard must use the existing canonical trade-metrics calculation for
  journal-linked data. It must not create an independent average-cost/FIFO or
  fee calculation in a dashboard component or adapter.
- The exact mark used by the dashboard must be traceable to the same source and
  as-of state used for the compared Trades value.
- Partial exits, multiple entries, FIFO lot matching, fees, long/short
  direction, and a missing mark are required reconciliation cases, not edge
  cases.

Account-only exposure is valuable for risk management and belongs in the
account-position table. It must be labelled **Account only** and may contribute
to a separately labelled account-level valuation only when the valuation
completeness contract is satisfied. It must never be silently merged into a
journal-only P&L, trade count, win rate, or performance metric.

If an account position is **Mixed**, expose the attribution and drilldown needed
to see the journal-linked and account-only contributions. Do not claim exact
cross-surface reconciliation for the combined value until that attribution is
resolved.

### 6.6 Risk and stop contract

Use these distinct labels; do not relabel historical initial risk as current
risk:

| Metric | Required meaning |
| --- | --- |
| **Initial risk** | Risk recorded when the journal trade was opened. Historical and immutable except through an explicit domain correction. |
| **Current risk to stop** | For remaining quantity, loss between open cost basis and the effective active stop: long max(0, average cost − stop) × quantity; short max(0, stop − average cost) × quantity, with the product's approved fee treatment. A stop beyond breakeven yields zero current risk and may be shown as protected P&L separately. |
| **Open risk** | Sum of current risk to stop for the stated account-position universe, only when every included position has a valid active stop and calculable risk. |
| **Portfolio heat** | Open risk divided by the stated current account-equity/NAV denominator, expressed with the product's canonical percentage convention. |

If a position has no valid active stop, show **No valid stop**; do not treat it
as zero risk. Open risk and Portfolio heat become **Incomplete — N without a
valid stop** rather than ordinary complete values. The UI may show a labelled
known-risk subtotal, but it must state its coverage and must not conceal the
uncovered positions.

The current-risk summary must disclose its denominator and account scope. A
missing, zero, or non-trustworthy NAV makes heat unavailable rather than zero.

### 6.7 Account-state contract

Account-level balances and valuations need unambiguous labels:

- **Cash** is the ledger/account cash value and includes its effective time.
- **Marked positions** is the valuation of marked open account positions and
  inherits the valuation-completeness state.
- **NAV/Account value** declares whether it is ledger-only, fully current, or
  partial/stale because of marks.
- **Realized P&L**, **unrealized P&L**, and **Total P&L** state their period and
  universe. Total P&L is never silently a mixture of a selected historical
  period and current account valuation.
- **Drawdown** declares its equity series and as-of state. It is not coloured
  as positive merely because its numeric sign is negative.

All financial arithmetic is performed with the established decimal precision;
round only for presentation. Currency labels follow the active account and no
cross-currency aggregate is shown without an explicit conversion policy.

## 7. Metrics and analytics catalogue

The product should take the useful categories from the supplied Myfxbook
examples while retaining only metrics with clear domain definitions and real
data. A value that lacks a defined calculation or data source must be shown as
**Unavailable** with a short explanation, not as zero or a placeholder chart.

### 7.1 Tier 1 — required in the Risk & Positions view

| Group | Metrics |
| --- | --- |
| Data health | Fresh/stale/missing/unavailable mark counts, price source, oldest as-of, refresh/provider failure, snapshot time. |
| Positions | Open account positions, open journal trades, attribution coverage, quantity, mark, stop, current risk, exposure, and unrealized P&L state. |
| Risk | Open risk, portfolio heat, stop coverage, missing/invalid stops, largest position/concentration, gross exposure, net exposure. |
| Account | Cash, marked positions state, NAV/account value state, current drawdown, maximum drawdown when available. |
| Current P&L | Current/stale/partial/unavailable Open P&L according to the completeness contract; realized and total P&L only when their scope is clear. |

### 7.2 Tier 2 — required in the Performance and Process Review views

All metrics obey the selected account and retrospective filter unless the UI
explicitly labels them as current state.

| Group | Metrics |
| --- | --- |
| Period performance | Net and realized P&L, return, fees/commissions, trade count, win rate, profit factor, average R, payoff ratio, expectancy in currency and R, average win/loss, best/worst trade, and drawdown. |
| Activity and composition | Long/short performance, setup performance, symbol/sector or asset-class exposure, holding duration, trade frequency, day/week/month performance, and monthly analytics. |
| Review | Equity/balance/drawdown chart, calendar, period comparison, R distribution, setup ranking, process score/checklist/mistake analysis, and attention items. |
| Cash flows and account history | Deposits, withdrawals, high-water mark, balance/equity progression, and return calculations that identify their cash-flow methodology. |

Profit factor is gross profits divided by absolute gross losses and is
**Unavailable** when no qualifying losses exist. Win-rate denominators and
scratch/zero-trade treatment must use the existing approved metric policy and
be discoverable in metric help text. Ratio and percentage displays must use
their canonical raw-value contract exactly once.

### 7.3 Tier 3 — add only after data and definition prerequisites are met

| Metric | Prerequisite before display |
| --- | --- |
| MAE/MFE and MAE-vs-outcome scatter | Intratrade market-price history at a defined sampling interval, a documented calculation method, and enough data to disclose coverage. Current entry/exit records alone are insufficient. |
| Risk of ruin | An approved statistical model, explicit assumptions, minimum sample policy, and clear cautionary presentation. |
| Sharpe, Sortino, standard deviation, or other return statistics | A documented return series, cash-flow treatment, sampling cadence, risk-free-rate policy where needed, and coverage guardrails. |
| Pips/points/unit analytics | Asset-specific unit definitions and conversion rules. Do not show equity-oriented values as forex pips. |

## 8. Interaction, visual, and accessibility requirements

### 8.1 Desktop workstation readability

At both target viewports, the dashboard must be comfortably readable at normal
browser zoom and must use the remaining application width efficiently. The
following are acceptance criteria:

- Decision labels and table headers are 12px or larger.
- Table data cells are 13px or larger; primary financial values are 16–20px.
- Standard table rows are 36–40px high, with adequate contrast and tabular
  numerals for financial columns.
- Avoid a small-text terminal mode, tiny status abbreviations, or internal
  scrollbars as the normal way to inspect the default Risk & Positions flow.
- Do not allocate large blank panel surfaces to empty watchlist, chart, or
  insight content while primary risk information is compressed.
- Dense information is welcome; equally weighted KPI cards, presentation-scale
  whitespace, and a decorative executive-dashboard treatment are not.

The 1440 × 900 viewport remains a structural fallback test. It cannot replace
visual acceptance at the two real user environments.

### 8.2 State presentation

Every widget has distinct loading, empty, error, partial, stale, and
unavailable states. State is conveyed by text and semantics as well as color.

- A missing mark says **Unpriced** or **Missing mark**, not only —.
- A stale mark says **Stale** with source and as-of timestamp, not only an amber
  dot.
- An empty position list says **No open account positions** and uses compact
  space; it must not leave a large inert pane.
- A provider or snapshot failure uses an alert that states whether displayed
  values are last known, stale, or unavailable.
- Tooltips may explain a calculation but cannot be the only place where scope,
  partial coverage, or current-state health is revealed.

### 8.3 Accessible operation

Controls, table headers, saved views, alerts, and customization controls must
be keyboard reachable, have visible focus, and have useful accessible names.
Status changes that materially affect trust in P&L or risk must be announced
appropriately. Color alone must not communicate profit/loss, warning, or
market-data state.

## 9. Required acceptance scenarios

The development team must automate these as calculation/API contracts and
exercise them in a populated browser scenario.

| ID | Setup | Expected outcome |
| --- | --- | --- |
| DASH-AC-01 | All open account positions have fresh marks and valid stops. | Current account P&L, marked positions, Open risk, heat, coverage, and account state show a normal current value with source/as-of metadata. |
| DASH-AC-02 | One of three account positions has no mark; two marked rows total +$10.94. | The primary value is — Partial — 1 unpriced, not +$10.94. If a marked-subset amount is shown, it is labelled Marked subset P&L +$10.94 and 2 of 3 marked. |
| DASH-AC-03 | Two journal trades have the same current marks as Trades and one additional account-only position exists. | The dashboard states 3 open account positions · 2 open journal trades; journal-linked values reconcile exactly to Trades. The account-only position is visibly attributed and is not silently included in journal performance. |
| DASH-AC-04 | A journal-linked position has multiple entries, a partial exit, FIFO lot matching, and fees. | Remaining quantity, average cost, realized P&L, and net unrealized P&L exactly match the Trades list and detail for the same snapshot. |
| DASH-AC-05 | A price exists but fails freshness policy. | The row and aggregate are explicitly stale with source/as-of data. No fully current account/NAV/Open P&L presentation remains. |
| DASH-AC-06 | One open position has no valid effective stop. | The row says No valid stop; stop coverage and current-risk/heat display Incomplete — 1 without a valid stop, not a deceptively complete numeric total. |
| DASH-AC-07 | There are no non-flat account positions. | The table uses the compact no-position state; current Open P&L is $0.00; no price coverage is implied; polling does not claim live mark updates. |
| DASH-AC-08 | The user changes the retrospective period. | Period-performance metrics update; current positions, risk, and current P&L retain their current-state scope and do not disappear or become period-filtered. |
| DASH-AC-09 | The user creates a saved Performance view and returns to normal Risk & Positions. | Layout changes persist only in the saved user view; normal mode has no drag/resize affordances; the immutable system default can be restored. |
| DASH-AC-10 | At both target viewports with realistic populated data. | First screen shows the command/state bar, any material alert, risk summary, and paired Performance/Account State overview without browser zoom or clipped critical columns. Open Positions is the next full-width section in the normal browser scroll; Account State, Performance, Open Positions, and Process Review have no competing internal scrollbars. |

## 10. Delivery sequence

Implement in this order. Do not ship a visual layout slice that masks the
calculation defect.

1. **Current-state contract and reconciliation**
   - Define the one dashboard overview snapshot, scopes, attribution, mark
     provenance, completeness state, risk state, and explicit nullability.
   - Correct partial aggregate behavior and add cross-surface regression cases.
   - Establish central freshness-policy ownership.

2. **Risk & Positions default view**
   - Build the command/state bar, fixed alert strip, current-risk summary, and
     primary account-position table from the reconciled snapshot.
   - Meet readability, state, empty, and target-viewport requirements with
     realistic data.

3. **Account state and performance review**
   - Add clearly scoped account/drawdown/equity presentation and Tier 2
     performance and process widgets.
   - Do not show Tier 3 metrics until their prerequisites are delivered.

4. **Saved views and persistence**
   - Add validated, versioned template-derived saved views and explicit
     customization mode without weakening the fixed safety/data-quality areas.

5. **Release evidence**
   - Run the full required quality gate and record browser screenshots and
     scenario evidence before the dashboard is declared ready.

## 11. Verification and release gate

Before release, provide all of the following:

- Pure calculation tests for P&L completeness, freshness classification, stop
  coverage, current-risk semantics, heat denominator guards, and decimal/
  percentage conventions.
- API/read-model contract tests proving nullable/qualified aggregate states,
  provenance, attribution, scope separation, and no unknown-to-zero coercion.
- Cross-surface integration tests covering the complex FIFO/fee/partial-exit
  case and the account-position versus journal-trade count distinction.
- Component tests for partial, stale, unavailable, no-stop, empty, and
  provider-error presentation.
- Targeted browser tests with realistic populated fixtures/data for the ten
  acceptance scenarios, including saved-view persistence and keyboard access.
- Visual screenshots at 2560 × 1440 and effective 1536 × 960, with notes for
  any information below the fold. Include an additional 1440 × 900
  structural-fallback screenshot.
- The repository quality gate: lint, typecheck, production build, full test
  orchestrator, and the targeted browser workflow. Record any unavailable
  browser project or unmet visual criterion rather than silently treating it as
  passed.

## 12. Definition of done

The dashboard is done only when:

- It is visibly as readable as the Trades page at the user's normal desktop and
  laptop environments.
- Its default flow is genuinely risk and open-position first, with the paired
  Performance/Account State overview above the next full-width Open Positions
  section and no competing internal panel scrollbars.
- Every current-value total is complete, qualified, or unavailable according
  to the mark and stop coverage contracts.
- A user can reconcile a journal-linked dashboard value to Trades at the same
  market snapshot, and can identify account-only exposure when it exists.
- The prior +$10.94-style partial-total failure is impossible by contract and
  covered by automated regression evidence.
- Performance review exposes all supported high-value metrics without creating
  fictitious analytics or hiding their scope/assumptions.
- Saved views are useful but do not compromise the curated default or critical
  warnings.
