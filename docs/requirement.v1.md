# Trading Journal Web App — Local-First PRD & Technical Specification

**Version:** 1.1  
**Stage:** MVP / Stage 1  
**Primary user:** One active US stock trader  
**Deployment:** Local web app running on localhost  
**Database:** SQLite  
**Authentication:** None in Stage 1  
**Input mode:** Manual trade entry only  
**Screenshots:** Local uploads and external chart links  
**Future direction:** Cloud/web app with multi-user authentication, broker imports, cloud storage, and advanced analytics

---

## 0. How to Read This Document

This document is the first source-of-truth product specification for the development team.

- Treat this document as the implementation reference.
- Treat the Excel-derived material as background context only.
- Build a product workflow around trading decisions, not around spreadsheet sheets.
- Prioritize clarity, maintainability, and speed of use over feature volume.

The product should feel like a disciplined trading cockpit: minimal, calm, structured, and easy to operate under market pressure.

## 1. Executive Summary

Build a local-first trading journal web application for a single trader focused on improving decision quality, risk control, execution discipline, and review consistency.

The core product must help the trader answer:

- Was the trade valid according to the trader's playbook?
- Was the risk sized correctly?
- Was the entry executed according to plan?
- Was the trade managed according to the original plan?
- Did the exit improve or damage expectancy?
- Which mistakes repeat?
- Which setups actually have edge after enough sample size?

The product is organized around this workflow:

```text
Plan → Size → Execute → Manage → Exit → Grade → Review → Improve
```

Stage 1 should stay deliberately simple:

- US stocks only.
- Manual data entry.
- No broker integrations.
- No cloud deployment.
- No authentication.
- SQLite database.
- Local file storage for screenshots.
- External links allowed for TradingView, broker screenshots, or other chart references.
- Partial exits are required and must be modeled with execution rows, not a single exit field.

---

## 2. Research-Informed Product Principles

Competitive trading journals such as TradeZella, TraderSync, Tradervue, TradesViz, and Edgewonk converge around several useful product patterns:

1. **Trade analytics are table stakes.**
   - Win rate, profit factor, expectancy, R multiple, drawdown, setup performance, and monthly performance are expected baseline features.

2. **The real value is review quality.**
   - A journal should explain why performance happened, not merely record what happened.

3. **Setup, mistake, and tag analytics matter.**
   - The trader needs to isolate what is working and what is repeatedly damaging results.

4. **Screenshots are important.**
   - A serious journal should preserve visual context around entries, exits, and management decisions.

5. **Trade management deserves its own analysis.**
   - A profitable setup can still be poorly managed.
   - A losing trade can still be high-quality if it followed the plan.

6. **Process score should be tracked separately from P&L.**
   - P&L is noisy in small samples.
   - Execution quality, rule compliance, and risk discipline are more useful for short-cycle feedback.

Product implication:

```text
The app must treat grading, mistakes, trade management, and review as first-class workflows.
```

---

## 3. Stage 1 Scope

### 3.1 In Scope

Stage 1 must include:

- Local web app running on localhost.
- SQLite database.
- Single local profile, no login.
- Manual trade entry.
- US stock trades.
- Long and short trades.
- Partial exits.
- Optional scale-ins, if supported by the same execution model.
- Trade planning form.
- Position sizing calculator.
- Watchlist / trade ideas.
- Trade execution ledger.
- Trade detail page.
- Screenshot uploads.
- External chart links.
- Trade grading rubric.
- Mistake and lesson tracking.
- Account rollforward.
- Dashboard.
- Weekly review.
- Setup review.
- Validation/checks page.
- CSV export.
- Full local backup export.

### 3.2 Out of Scope

Stage 1 must not include:

- Cloud deployment.
- Multi-user authentication.
- OAuth.
- Broker integrations.
- Automatic imports.
- Real-time market data.
- AI trade review.
- Backtesting module.
- Public sharing.
- Coach/mentor portals.
- Mobile app.
- Payments/subscriptions.
- Cloud screenshot storage.
- Options, futures, forex, crypto.

---

## 4. Workflow Visibility Requirement

The trade workflow must be visible to the user at all times.

The application should make it obvious where every trade stands in the lifecycle and what the next valid action is. This is a core product requirement, not a cosmetic enhancement.

### 4.1 Trade Lifecycle Model

Use the following lifecycle as the canonical user-facing model:

```text
Idea → Planned → Sized → Open → Partially Closed → Closed → Graded → Reviewed
```

Not every trade must begin as a watchlist idea. A user may create a planned trade directly. However, once a trade exists, its stage must be explicit.

### 4.2 Required UX Pattern

Every trade detail page must include:

- A horizontal lifecycle stepper at the top.
- Current stage highlighted clearly.
- Completed stages marked as complete.
- Future stages shown but visually inactive.
- A "Next Action" panel showing the next logical action.
- A compact timeline of important events: idea created, plan created, sizing calculated, first execution, partial exits, final exit, grade, review.

Example:

```text
[Idea ✓] → [Planned ✓] → [Sized ✓] → [Open ✓] → [Partial Exit •] → [Closed] → [Graded] → [Reviewed]

Current Stage: Partially Closed
Next Action: Record final exit or update management notes.
```

### 4.3 Lifecycle Statuses

| Stage            | Meaning                                                            | Main User Action                       |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------- |
| Idea             | Trade exists only as a watchlist candidate                         | Promote to planned trade or archive    |
| Planned          | Trade thesis and intended levels exist                             | Run sizing calculator                  |
| Sized            | Position size and risk are calculated                              | Enter trade execution                  |
| Open             | Entry execution exists and open quantity > 0                       | Manage trade or record partial exit    |
| Partially Closed | At least one exit exists, but open quantity remains                | Record final exit or management update |
| Closed           | Open quantity is zero                                              | Grade and review the trade             |
| Graded           | Process score has been assigned                                    | Add lessons and corrective actions     |
| Reviewed         | Trade has been reviewed and any mistakes/action items are captured | Use in weekly/setup review             |

### 4.4 Trade Log Visibility

The trade log must show:

- Lifecycle stage badge.
- Trade status.
- Grade.
- Open quantity.
- Realized R.
- Risk status.
- Whether review is complete.
- Whether corrective actions remain open.

The user should not need to open a trade to know whether it needs attention.

### 4.5 Dashboard Workflow Widgets

The dashboard must include workflow health indicators:

- Ideas waiting for planning.
- Planned trades not sized.
- Open trades.
- Partially closed trades.
- Closed trades missing grade.
- Graded trades missing review.
- Open corrective actions.

This helps the app act as an operating system for trading improvement, not just a performance report.

### 4.6 State Machine Principle

Workflow transitions should be controlled by business rules.

Examples:

- A trade cannot move to `open` without at least one valid entry execution.
- A trade cannot be `closed` while open quantity remains.
- A trade cannot be `graded` until closed.
- A trade can be marked `reviewed` only after grade or review notes exist.
- A warning should appear when a user tries to execute a trade that has not been sized.

## 5. Product Design Thesis

The app should be decision-led, not transaction-led.

A transaction-led journal asks:

```text
What did I buy, where did I sell, and how much did I make?
```

A decision-led journal asks:

```text
Was this a valid trade?
Was the risk acceptable?
Was the execution clean?
Did I follow the plan?
What behavior needs to change?
```

Therefore, the data model and UI should not revolve around a single flat trade table. The journal should separate:

- Trade plan.
- Executions/fills.
- Risk snapshot.
- Management notes.
- Screenshots/assets.
- Grade.
- Mistakes.
- Review.

---

## 6. Primary Workflow

### 5.1 Watchlist / Idea Stage

User captures a potential trade before entry:

- Symbol.
- Setup.
- Direction.
- Thesis.
- Market context.
- Key level.
- Trigger price.
- Planned stop.
- Planned target.
- Notes.
- Screenshot or chart link.
- Status: Active, Triggered, Passed, Archived.

The idea may be promoted into a planned trade.

### 5.2 Pre-Trade Planning Stage

Before entry, user records:

- Symbol.
- Direction.
- Setup.
- Market condition.
- Thesis.
- Entry trigger.
- Planned stop.
- Planned target.
- Invalidation condition.
- Account.
- Planned risk percentage.
- Planned position size.
- Minimum acceptable reward/risk.
- Pre-trade checklist.

The app validates risk before the trade can be marked as ready.

### 5.3 Position Sizing Stage

The calculator must compute:

- Risk per share.
- Max risk amount.
- Suggested shares.
- Position value.
- Account exposure.
- Planned R/R.
- Planned target P&L.
- Risk check result.

The user can convert the sizing output into a draft trade.

### 5.4 Execution Stage

The user manually records actual fills:

- Entry fill.
- Partial exit.
- Full exit.
- Optional add/scale-in.
- Fees per execution.

Executions determine actual position quantity, realized P&L, and trade status.

### 5.5 Management Stage

During the trade, user can record:

- Stop adjustment.
- Partial exit reason.
- Management note.
- Screenshot after entry.
- Screenshot at partial exit.
- Screenshot at final exit.
- Rule violation, if any.

### 5.6 Exit Stage

A trade is closed when remaining quantity is zero.

After close, user records:

- Exit rationale.
- Whether exit followed the original plan.
- What was done well.
- What was done poorly.
- Lesson.
- Corrective action if needed.

### 5.7 Grading Stage

Each closed trade should receive a process grade independent of P&L.

Grade dimensions:

- Setup quality.
- Risk quality.
- Entry quality.
- Management quality.
- Exit quality.
- Review quality.

### 5.8 Review Stage

Weekly and setup reviews summarize:

- P&L.
- R multiple.
- Rule compliance.
- Process score.
- Mistakes.
- Best/worst setup.
- Corrective actions.
- Next week's focus.

---

## 7. Stage 1 Technical Architecture

### 7.1 Recommended Stack

The recommended Stage 1 stack is an opinionated, maintainable TypeScript monolith:

```text
Application: Next.js + React + TypeScript
Database: SQLite
SQLite driver: better-sqlite3 or libSQL local driver
ORM/query layer: Drizzle ORM
Validation: Zod
Styling: Tailwind CSS
Component system: shadcn/ui
Data grids: TanStack Table
Charts: Apache ECharts or Recharts
Forms: React Hook Form + Zod
Dates/times: date-fns or Luxon
Testing: Vitest + Playwright
File storage: local filesystem
Packaging: local localhost app first; optional Tauri wrapper later
```

### 7.2 Why This Stack

This stack is selected for:

- Low operational complexity.
- One main language: TypeScript.
- Good future cloud migration path.
- Strong UI/aesthetic capability.
- Easy local SQLite persistence.
- Mature table/grid ecosystem.
- Good maintainability for a non-full-time developer owner.
- Avoidance of unnecessary backend complexity.

The app should be built as a simple local web application first. Avoid microservices, separate worker infrastructure, container orchestration, external auth providers, and cloud storage in Stage 1.

### 7.3 Stack Decision Matrix

| Requirement        | Recommended Choice                  | Rationale                                          |
| ------------------ | ----------------------------------- | -------------------------------------------------- |
| Easy to maintain   | Next.js + TypeScript                | One full-stack codebase and strong ecosystem       |
| Local database     | SQLite                              | Simple, reliable, serverless, file-based           |
| Database access    | Drizzle ORM                         | Lightweight, explicit, TypeScript-friendly         |
| Minimalist UI      | Tailwind + shadcn/ui                | Clean design system with customizable components   |
| Large tables       | TanStack Table                      | Strong control over filtering, sorting, columns    |
| Dashboards         | ECharts or Recharts                 | Good charting without heavy BI tooling             |
| Forms              | React Hook Form + Zod               | Predictable validation and clean form handling     |
| Future desktop app | Tauri optional                      | Useful later, but not required for MVP             |
| Future cloud app   | PostgreSQL-compatible schema habits | UUIDs, migrations, service layer, clean data model |

### 7.4 Stack Non-Goals

Do not use the following in Stage 1 unless there is a strong reason:

- NestJS.
- Microservices.
- Kafka/queues.
- Kubernetes.
- Cloud object storage.
- OAuth providers.
- Supabase/Auth0/Clerk.
- Electron.
- Complex BI frameworks.
- DuckDB as the main transactional database.

### 7.5 Alternative Stack if the Team Is Python-Heavy

If the selected developer is materially stronger in Python than TypeScript, this alternative is acceptable:

```text
Frontend: React + TypeScript
Backend: FastAPI
Database: SQLite
ORM: SQLAlchemy or SQLModel
Validation: Pydantic
UI: Tailwind + shadcn/ui
```

However, this creates two application layers instead of one. The default recommendation remains a TypeScript monolith.

### 7.6 SQLite Justification

Use SQLite because Stage 1 is:

- Single-user.
- Local-first.
- Manual-entry.
- Transactional.
- Low-concurrency.
- Simple to back up.
- Easy to migrate later.

SQLite is the correct primary database for local CRUD operations. Do not use PostgreSQL in Stage 1.

### 7.7 DuckDB Position

DuckDB may be useful later for heavy analytics, imported broker files, large historical datasets, or offline research.

Do not use DuckDB as the Stage 1 transactional database.

Recommended future pattern:

```text
SQLite = application source of truth
DuckDB = optional analytics/query accelerator
```

### 7.8 Local File Structure

Recommended local storage:

```text
.trading-journal/
  journal.db
  screenshots/
    T-0001/
      pre-entry.png
      entry.png
      partial-exit-1.png
      final-exit.png
  exports/
  backups/
  logs/
```

Screenshot metadata belongs in SQLite. Image files belong on disk.

Do not store screenshots as database blobs.

### 7.9 SQLite Runtime Settings

On application initialization:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```

Recommended conventions:

- All schema changes must go through migrations.
- All multi-step trade updates must use transactions.
- Calculated metrics should be deterministic.
- Raw inputs and executions are source of truth.
- Derived dashboard values can be computed by service queries or materialized summaries if needed later.

---

## 8. Data Model

### 8.1 Design Rules

- Use execution rows for partial exits.
- Do not model a trade as one entry and one exit.
- Store raw user inputs and immutable snapshots.
- Recalculate derived metrics from executions and risk snapshots.
- Keep future cloud migration in mind, but do not add authentication complexity now.
- Use lookup tables for configurable dropdowns.

---

### 8.2 Core Tables

### app_profile

Single local profile.

```sql
CREATE TABLE app_profile (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Bogota',
  default_currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### settings

```sql
CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  default_account_id TEXT,
  starting_account_value NUMERIC NOT NULL,
  max_risk_per_trade_pct NUMERIC NOT NULL,
  default_commission NUMERIC NOT NULL DEFAULT 0,
  journal_start_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### accounts

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  broker TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### lookup_values

Used for setup, sector, market condition, mistake type, grade labels, tags, and account labels.

```sql
CREATE TABLE lookup_values (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Recommended `type` values:

```text
setup
sector
market_condition
mistake_type
mistake_phase
trade_tag
grade_label
watchlist_status
execution_reason
exit_reason
```

---

### 8.3 Watchlist Tables

### watchlist_items

```sql
CREATE TABLE watchlist_items (
  id TEXT PRIMARY KEY,
  date_added TEXT NOT NULL,
  symbol TEXT NOT NULL,
  sector_id TEXT,
  setup_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('long', 'short')),
  thesis TEXT,
  market_context TEXT,
  key_level NUMERIC,
  trigger_price NUMERIC,
  planned_stop NUMERIC,
  target_price NUMERIC,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  promoted_trade_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (sector_id) REFERENCES lookup_values(id),
  FOREIGN KEY (setup_id) REFERENCES lookup_values(id),
  FOREIGN KEY (promoted_trade_id) REFERENCES trades(id)
);
```

---

### 8.4 Trade Tables

### trades

Represents the trade idea and lifecycle.

```sql
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  trade_code TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('long', 'short')),
  sector_id TEXT,
  setup_id TEXT,
  market_condition_id TEXT,

  status TEXT NOT NULL DEFAULT 'planned'
    CHECK(status IN ('planned', 'open', 'partially_closed', 'closed', 'cancelled')),

  planned_entry NUMERIC,
  planned_stop NUMERIC,
  planned_target_1 NUMERIC,
  planned_target_2 NUMERIC,
  thesis TEXT,
  invalidation_condition TEXT,
  pre_trade_plan TEXT,

  opened_at TEXT,
  closed_at TEXT,

  exit_notes TEXT,
  lesson TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (sector_id) REFERENCES lookup_values(id),
  FOREIGN KEY (setup_id) REFERENCES lookup_values(id),
  FOREIGN KEY (market_condition_id) REFERENCES lookup_values(id)
);
```

### trade_executions

Represents actual fills. This table enables partial exits.

```sql
CREATE TABLE trade_executions (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL,
  executed_at TEXT NOT NULL,

  action TEXT NOT NULL CHECK(action IN (
    'buy',
    'sell',
    'sell_short',
    'buy_to_cover'
  )),

  quantity INTEGER NOT NULL CHECK(quantity > 0),
  price NUMERIC NOT NULL CHECK(price > 0),
  fees NUMERIC NOT NULL DEFAULT 0,

  reason_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
  FOREIGN KEY (reason_id) REFERENCES lookup_values(id)
);
```

### trade_risk_snapshots

Captures risk at the moment the trade is opened. This should not mutate after the fact except through explicit correction.

```sql
CREATE TABLE trade_risk_snapshots (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL UNIQUE,
  account_equity_at_open NUMERIC NOT NULL,
  initial_entry_price NUMERIC NOT NULL,
  initial_stop_price NUMERIC NOT NULL,
  initial_quantity INTEGER NOT NULL,
  risk_per_share NUMERIC NOT NULL,
  initial_risk_amount NUMERIC NOT NULL,
  account_risk_pct NUMERIC NOT NULL,
  planned_reward_risk NUMERIC,
  created_at TEXT NOT NULL,

  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
);
```

### trade_stop_adjustments

Stores management decisions after entry.

```sql
CREATE TABLE trade_stop_adjustments (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL,
  adjusted_at TEXT NOT NULL,
  previous_stop NUMERIC,
  new_stop NUMERIC NOT NULL,
  reason TEXT,
  rule_based INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
);
```

### trade_assets

Stores screenshots and external links.

```sql
CREATE TABLE trade_assets (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK(asset_type IN ('local_image', 'external_link')),
  phase TEXT NOT NULL CHECK(phase IN (
    'watchlist',
    'pre_trade',
    'entry',
    'management',
    'partial_exit',
    'final_exit',
    'review'
  )),
  label TEXT,
  file_path TEXT,
  external_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
);
```

Validation rule:

```text
If asset_type = local_image, file_path is required.
If asset_type = external_link, external_url is required.
```

---

### 8.5 Grading Tables

### trade_grades

```sql
CREATE TABLE trade_grades (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL UNIQUE,

  setup_quality_score INTEGER NOT NULL DEFAULT 0,
  risk_quality_score INTEGER NOT NULL DEFAULT 0,
  entry_quality_score INTEGER NOT NULL DEFAULT 0,
  management_quality_score INTEGER NOT NULL DEFAULT 0,
  exit_quality_score INTEGER NOT NULL DEFAULT 0,
  review_quality_score INTEGER NOT NULL DEFAULT 0,

  total_score INTEGER NOT NULL DEFAULT 0,
  grade_label TEXT,

  followed_plan INTEGER,
  rule_violation INTEGER NOT NULL DEFAULT 0,
  notes TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
);
```

### trade_mistakes

```sql
CREATE TABLE trade_mistakes (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL,
  mistake_type_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN (
    'pre_trade',
    'entry',
    'risk',
    'management',
    'exit',
    'review'
  )),
  severity TEXT NOT NULL CHECK(severity IN ('minor', 'moderate', 'major')),
  root_cause TEXT,
  corrective_action TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open', 'in_progress', 'resolved', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
  FOREIGN KEY (mistake_type_id) REFERENCES lookup_values(id)
);
```

---

### 8.6 Account Tables

### account_rollforward

```sql
CREATE TABLE account_rollforward (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  beginning_equity NUMERIC NOT NULL,
  deposits_withdrawals NUMERIC NOT NULL DEFAULT 0,
  realized_gross_pnl NUMERIC NOT NULL DEFAULT 0,
  fees NUMERIC NOT NULL DEFAULT 0,
  ending_equity NUMERIC NOT NULL,
  cumulative_pnl NUMERIC NOT NULL,
  high_water_mark NUMERIC NOT NULL,
  drawdown_amount NUMERIC NOT NULL,
  drawdown_pct NUMERIC NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE(account_id, date),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);
```

---

### 8.7 Review Tables

### weekly_reviews

```sql
CREATE TABLE weekly_reviews (
  id TEXT PRIMARY KEY,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  account_id TEXT,
  closed_trades INTEGER NOT NULL DEFAULT 0,
  net_pnl NUMERIC NOT NULL DEFAULT 0,
  avg_r NUMERIC,
  win_rate NUMERIC,
  avg_process_score NUMERIC,
  notes TEXT,
  focus_next_week TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (account_id) REFERENCES accounts(id)
);
```

### review_action_items

```sql
CREATE TABLE review_action_items (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('trade', 'weekly_review', 'setup_review')),
  source_id TEXT NOT NULL,
  action_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open', 'in_progress', 'resolved', 'archived')),
  due_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## 9. Trade Calculation Rules

### 8.1 Position Direction

Use normalized direction:

```text
long
short
```

Execution actions:

For long trades:

```text
Entry: buy
Exit: sell
```

For short trades:

```text
Entry: sell_short
Exit: buy_to_cover
```

### 8.2 Trade Status

Derived from executions:

```text
planned = no executions
open = position quantity > 0 and no exit quantity yet
partially_closed = position quantity > 0 and some exit quantity exists
closed = position quantity = 0 and entry quantity > 0
cancelled = manually cancelled before execution
```

### 8.3 Quantity Calculations

For long trades:

```text
entry_quantity = sum(quantity where action = 'buy')
exit_quantity = sum(quantity where action = 'sell')
open_quantity = entry_quantity - exit_quantity
```

For short trades:

```text
entry_quantity = sum(quantity where action = 'sell_short')
exit_quantity = sum(quantity where action = 'buy_to_cover')
open_quantity = entry_quantity - exit_quantity
```

Validation:

```text
exit_quantity cannot exceed entry_quantity
open_quantity cannot be negative
```

### 8.4 Average Entry Price

For Stage 1, use weighted average cost:

```text
avg_entry_price = sum(entry_quantity_i × entry_price_i) / sum(entry_quantity_i)
```

This is acceptable for journal analytics. It is not intended to be a tax-lot accounting engine.

### 8.5 Realized P&L

For long trades:

```text
gross_realized_pnl = sum(exit_quantity_i × (exit_price_i - avg_entry_price))
```

For short trades:

```text
gross_realized_pnl = sum(exit_quantity_i × (avg_entry_price - exit_price_i))
```

Fees:

```text
total_fees = sum(fees across all executions)
net_realized_pnl = gross_realized_pnl - total_fees
```

### 8.6 Unrealized P&L

Stage 1 has no live market price integration.

Optional manual mark price:

```text
unrealized_pnl = open_quantity × (manual_mark_price - avg_entry_price)
```

For short:

```text
unrealized_pnl = open_quantity × (avg_entry_price - manual_mark_price)
```

If no manual mark price exists, unrealized P&L should be blank.

### 8.7 Initial Risk Snapshot

When the first entry execution is added, create a risk snapshot:

For long trades:

```text
risk_per_share = initial_entry_price - initial_stop_price
```

For short trades:

```text
risk_per_share = initial_stop_price - initial_entry_price
```

Validation:

```text
risk_per_share must be > 0
```

Initial risk:

```text
initial_risk_amount = risk_per_share × initial_quantity
```

Account risk:

```text
account_risk_pct = initial_risk_amount / account_equity_at_open
```

### 8.8 R Multiple

Trade-level R:

```text
r_multiple = net_realized_pnl / initial_risk_amount
```

Only calculate if:

```text
trade is closed or partially closed
initial_risk_amount > 0
```

For open trades with partial exits, show:

```text
realized_r = net_realized_pnl / initial_risk_amount
```

### 8.9 Return Percentage

```text
return_pct = net_realized_pnl / total_entry_cost
```

Where:

```text
total_entry_cost = sum(entry_quantity_i × entry_price_i)
```

### 8.10 Holding Period

```text
holding_period = closed_at - opened_at
```

If the trade is still open:

```text
holding_period = current_time - opened_at
```

### 8.11 Outcome

For closed trades:

```text
net_realized_pnl > 0  → win
net_realized_pnl < 0  → loss
net_realized_pnl = 0  → breakeven
```

For open trades:

```text
outcome = blank
```

---

## 10. Position Sizing Calculator

### 9.1 Inputs

- Account.
- Account equity.
- Direction.
- Entry price.
- Stop price.
- Max risk percentage.
- Share increment.
- Max shares cap.
- Target price.
- Commission estimate.

### 9.2 Outputs

- Risk per share.
- Max risk amount.
- Raw share size.
- Suggested shares.
- Position value.
- Account exposure.
- Stop-loss risk amount.
- Reward per share.
- Reward/risk ratio.
- Target P&L.
- Risk check.
- Input check.

### 9.3 Formulas

Max risk amount:

```text
max_risk_amount = account_equity × max_risk_pct
```

Risk per share:

```text
long:  entry_price - stop_price
short: stop_price - entry_price
```

Raw share size:

```text
raw_share_size = max_risk_amount / risk_per_share
```

Suggested shares:

```text
suggested_shares = floor(raw_share_size / share_increment) × share_increment
```

If max shares cap exists:

```text
suggested_shares = min(suggested_shares, max_shares_cap)
```

Position value:

```text
position_value = suggested_shares × entry_price
```

Account exposure:

```text
account_exposure = position_value / account_equity
```

Stop-loss risk:

```text
stop_loss_risk_amount = suggested_shares × risk_per_share
```

Reward per share:

```text
long:  target_price - entry_price
short: entry_price - target_price
```

Reward/risk:

```text
reward_risk_ratio = reward_per_share / risk_per_share
```

Target P&L:

```text
target_pnl = suggested_shares × reward_per_share
```

### 9.4 Calculator Acceptance Criteria

- Calculator works independently.
- Calculator can create a planned trade.
- Calculator defaults account equity from latest account rollforward.
- Calculator blocks invalid direction/stop combinations.
- Calculator warns when risk exceeds configured max risk.
- Calculator warns when R/R is below configured minimum, if a minimum is configured.

---

## 11. Grading Rubric

### 10.1 Score Model

Each closed trade receives 0–100 points.

| Dimension             | Max Points |
| --------------------- | ---------: |
| Setup Quality         |         20 |
| Risk Quality          |         20 |
| Entry Quality         |         20 |
| Management Quality    |         20 |
| Exit / Review Quality |         20 |
| **Total**             |    **100** |

### 10.2 Grade Labels

|  Score | Grade |
| -----: | ----- |
| 90–100 | A     |
|  80–89 | B     |
|  70–79 | C     |
|  60–69 | D     |
|   < 60 | F     |

### 10.3 Setup Quality — 20 pts

Score whether the trade was worth taking.

| Criteria                                | Points |
| --------------------------------------- | -----: |
| Setup matched a defined playbook        |      5 |
| Market context supported the trade      |      5 |
| Technical structure was clean           |      5 |
| Reward/risk was acceptable before entry |      5 |

### 10.4 Risk Quality — 20 pts

Score whether risk was professional.

| Criteria                                 | Points |
| ---------------------------------------- | -----: |
| Stop was placed logically                |      5 |
| Position size respected max account risk |      5 |
| Initial risk was known before entry      |      5 |
| No impulsive oversizing or risk override |      5 |

### 10.5 Entry Quality — 20 pts

Score execution precision.

| Criteria                     | Points |
| ---------------------------- | -----: |
| Entry followed trigger plan  |      5 |
| Entry was not chased         |      5 |
| Slippage was acceptable      |      5 |
| Entry timing was appropriate |      5 |

### 10.6 Management Quality — 20 pts

Score behavior while trade was open.

| Criteria                                | Points |
| --------------------------------------- | -----: |
| Stop was not moved against the plan     |      5 |
| Partial exits followed predefined logic |      5 |
| Additions, if any, were rule-based      |      5 |
| No emotional interference               |      5 |

### 10.7 Exit / Review Quality — 20 pts

Score closure and learning.

| Criteria                                    | Points |
| ------------------------------------------- | -----: |
| Exit followed plan or valid updated logic   |      5 |
| Trade was reviewed objectively              |      5 |
| Mistakes were tagged if present             |      5 |
| Clear lesson/corrective action was recorded |      5 |

### 10.8 Rule Violation Override

If a major rule violation exists, the app should cap the grade.

Suggested caps:

| Violation                                  | Max Grade |
| ------------------------------------------ | --------: |
| No stop defined before entry               |        60 |
| Risk exceeded max without planned override |        70 |
| Moved stop farther away emotionally        |        70 |
| Entered without valid setup                |        65 |
| Revenge trade                              |        60 |
| Averaged down without rule                 |        60 |

---

## 12. Mistake Taxonomy

Default mistake categories should be editable in settings.

Recommended initial list:

### Pre-Trade

- No clear setup.
- Weak market context.
- Poor reward/risk.
- Trade outside playbook.
- Entered before trigger.

### Entry

- Chased entry.
- Late entry.
- Early entry.
- Oversized position.
- Entry without stop.

### Risk

- Risk exceeded limit.
- Stop too wide.
- Stop too tight.
- Position size miscalculated.
- Added risk after entry.

### Management

- Moved stop farther away.
- Took profits too early.
- Failed to take planned partial.
- Added outside plan.
- Overmanaged trade.
- Ignored invalidation.

### Exit

- Panic exit.
- Hope-based hold.
- Failed to respect stop.
- No exit plan.
- Exited due to noise, not thesis change.

### Psychology

- FOMO.
- Revenge trading.
- Impatience.
- Fear of losing unrealized gain.
- Overconfidence.
- Hesitation.

---

## 13. Dashboard Requirements

### 12.1 Dashboard Philosophy

Dashboard should not only summarize P&L. It should separate:

```text
Performance metrics
Risk metrics
Process metrics
Review metrics
```

### 12.2 KPI Cards

Minimum KPI cards:

| Category  | KPI                     |
| --------- | ----------------------- |
| Activity  | Total trades            |
| Activity  | Closed trades           |
| Activity  | Open trades             |
| P&L       | Net realized P&L        |
| P&L       | Average trade P&L       |
| P&L       | Best trade              |
| P&L       | Worst trade             |
| R Metrics | Average R               |
| R Metrics | Median R                |
| R Metrics | Total R                 |
| R Metrics | Average win R           |
| R Metrics | Average loss R          |
| Edge      | Win rate                |
| Edge      | Profit factor           |
| Edge      | Expectancy in R         |
| Risk      | Average account risk    |
| Risk      | Max account risk used   |
| Risk      | Max drawdown            |
| Risk      | Current open risk       |
| Process   | Average process score   |
| Process   | Rule violation rate     |
| Process   | Most common mistake     |
| Process   | Open corrective actions |

### 12.3 Charts

Required charts:

- Equity curve.
- Drawdown curve.
- Monthly net P&L.
- Monthly R.
- R multiple distribution.
- Win/loss distribution.
- Performance by setup.
- Process score over time.
- Mistakes by category.
- Open risk by symbol/account.

### 12.4 Filters

Dashboard must support:

- Date range.
- Account.
- Symbol.
- Sector.
- Setup.
- Direction.
- Status.
- Outcome.
- Grade.
- Mistake type.
- Market condition.

### 12.5 Sample Size Warning

For setup analytics, display a warning when sample size is low.

Suggested rule:

```text
< 20 closed trades: exploratory only
20–49 closed trades: directional signal
50+ closed trades: more reliable setup statistics
```

---

## 14. Review Workflow

### 13.1 Daily Review

Daily review should be lightweight.

Fields:

- Did I follow risk rules?
- Did I take only planned setups?
- Any emotional trades?
- Best decision today.
- Worst decision today.
- One correction for tomorrow.

### 13.2 Weekly Review

Weekly review is the main review unit.

Required fields:

- Week start.
- Week end.
- Closed trades.
- Net P&L.
- Total R.
- Average R.
- Win rate.
- Average process score.
- Rule violation count.
- Most common mistake.
- Best setup.
- Worst setup.
- Notes.
- One focus for next week.

### 13.3 Setup Review

For each setup:

- Trades.
- Closed trades.
- Net P&L.
- Total R.
- Average R.
- Median R.
- Win rate.
- Profit factor.
- Average process score.
- Most common mistake.
- Sample size warning.
- Continue / pause / refine decision.

### 13.4 Corrective Action Tracker

A mistake is not useful unless converted into action.

Each corrective action should have:

- Source trade or review.
- Action text.
- Status.
- Due date.
- Resolution note.

---

## 15. Validation & Checks

### 14.1 Validation Center

The app must include a checks page with PASS/WARN/FAIL states.

### 14.2 Required Checks

| Check                                   | Severity |
| --------------------------------------- | -------- |
| Trade missing symbol                    | FAIL     |
| Trade missing direction                 | FAIL     |
| Trade missing account                   | FAIL     |
| Planned trade missing stop              | WARN     |
| Open trade missing risk snapshot        | FAIL     |
| Risk per share <= 0                     | FAIL     |
| Execution quantity <= 0                 | FAIL     |
| Execution price <= 0                    | FAIL     |
| Exit quantity exceeds entry quantity    | FAIL     |
| Account risk exceeds max risk           | WARN     |
| Closed trade has open quantity          | FAIL     |
| Closed trade missing review             | WARN     |
| Closed trade missing grade              | WARN     |
| Major mistake without corrective action | WARN     |
| Negative ending equity                  | FAIL     |
| Missing account rollforward row         | WARN     |
| Local screenshot file missing from disk | WARN     |
| External link malformed                 | WARN     |

### 14.3 Save Flow

When saving a trade:

- Blocking failures prevent save.
- Warnings allow save with confirmation.
- All overrides should be logged.

### 14.4 Overall Status

```text
PASS = no failures and no warnings
WARN = warnings exist but no failures
FAIL = one or more failures
```

---

## 16. UI, Aesthetics, and Usability Requirements

### 16.1 Product Feel

The product should look minimal, calm, and professional.

Target feel:

```text
Clean trading cockpit
Structured operating system
Quiet analytics tool
Not gamified
Not noisy
Not retail-broker flashy
```

The app should be visually attractive, but aesthetic quality must come from spacing, typography, hierarchy, and interaction clarity rather than decoration.

### 16.2 Design Principles

Use these principles:

- Minimal surface area.
- Clear hierarchy.
- Dense but readable tables.
- Neutral base palette.
- Color only for meaningful states.
- Fast data entry.
- Low cognitive load.
- Obvious next action.
- Consistent spacing.
- Consistent labels.
- No visual clutter.
- No unnecessary animations.
- No gamified badges except process/risk states.

### 16.3 Color Usage

Color should be functional.

| State          | Color Intent       |
| -------------- | ------------------ |
| PASS           | Positive / valid   |
| WARN           | Needs attention    |
| FAIL           | Broken / must fix  |
| Open trade     | Active / neutral   |
| Closed win     | Positive outcome   |
| Closed loss    | Negative outcome   |
| Breakeven      | Neutral            |
| Review missing | Attention required |
| Rule violation | Serious warning    |

Do not overuse green/red. P&L color should not dominate the application. The product should emphasize process quality, not emotional reaction to wins/losses.

### 16.4 Layout Principles

The app should use:

- Left sidebar navigation.
- Persistent page title and context.
- Compact top summary area.
- Main content area optimized for tables/forms.
- Right-side detail panels where useful.
- Modal or drawer for quick entry.
- Full detail page for deep review.

### 16.5 Typography and Density

The interface should support high information density without becoming visually cramped.

Guidelines:

- Tables should be compact.
- Detail pages should use cards/sections.
- Important numbers should be easy to scan.
- Long notes should not dominate table views.
- Use progressive disclosure for advanced fields.

### 16.6 Minimalist Design System

Use a reusable design system from the start:

- Buttons.
- Inputs.
- Selects.
- Date/time fields.
- Numeric fields.
- Badges.
- Cards.
- Tables.
- Tabs.
- Drawers.
- Dialogs.
- Toasts.
- Empty states.
- Validation banners.

The UI implementation should not handcraft every component from scratch.

### 16.7 Data Entry UX

Trade entry must be fast.

Requirements:

- Keyboard-friendly forms.
- Sensible defaults.
- Inline validation.
- Clear numeric formatting.
- No hidden required fields.
- Save draft support.
- Convert watchlist idea to trade without retyping core data.
- Convert position sizing calculation to planned trade.
- Add execution from trade detail with minimal clicks.

### 16.8 Workflow Navigation UX

Each trade detail page must answer three questions immediately:

```text
Where is this trade in the lifecycle?
What has already happened?
What should I do next?
```

This should be visible through:

- Lifecycle stepper.
- Timeline.
- Next-action card.
- Completeness indicators.
- Missing-review warnings.

## 17. Page Requirements

### 15.1 Dashboard

Purpose:

```text
Show performance, risk, process quality, and current open exposure.
```

Main components:

- KPI cards.
- Equity curve.
- Drawdown chart.
- Monthly table.
- Setup performance.
- Mistake summary.
- Open trades.
- Validation banner.

### 15.2 Trade Log

Purpose:

```text
Fast browsing, filtering, and editing of trades.
```

Requirements:

- Table view.
- Quick filters.
- Status badges.
- Grade badges.
- R multiple.
- Net P&L.
- Open quantity.
- Account risk.
- Click row to trade detail.
- Export filtered rows to CSV.

### 15.3 Trade Detail

Purpose:

```text
One complete record of the trade.
```

Sections:

- Trade summary.
- Plan.
- Risk snapshot.
- Executions.
- Stop adjustments.
- Screenshots/links.
- P&L/R metrics.
- Grade.
- Mistakes.
- Lessons.
- Corrective actions.

### 15.4 Position Sizing

Purpose:

```text
Pre-trade risk control.
```

Requirements:

- Calculator form.
- Risk warnings.
- Create planned trade from calculator.
- Show computed values instantly.

### 15.5 Watchlist

Purpose:

```text
Capture ideas before execution.
```

Requirements:

- Add/edit/archive ideas.
- Convert idea to planned trade.
- Store screenshots/links.
- Filter by status/setup/symbol.

### 15.6 Account

Purpose:

```text
Track equity, deposits/withdrawals, drawdown, and realized P&L.
```

Requirements:

- Daily account rollforward.
- Manual deposits/withdrawals.
- Equity curve.
- Drawdown table.
- Recalculate button.

### 15.7 Review

Purpose:

```text
Turn trade history into decisions.
```

Tabs:

- Daily review.
- Weekly review.
- Setup review.
- Mistakes.
- Corrective actions.

### 15.8 Checks

Purpose:

```text
Find data integrity, risk, and review problems.
```

Requirements:

- Summary status.
- Severity filter.
- Click-through to affected record.
- Re-run checks.

### 15.9 Settings

Purpose:

```text
Configure journal assumptions and dropdowns.
```

Sections:

- General settings.
- Accounts.
- Risk settings.
- Setups/playbooks.
- Sectors.
- Market conditions.
- Mistake categories.
- Tags.
- Import/export/backup.

---

## 18. API / Service Layer

Even if implemented locally, use a clean service boundary.

Suggested endpoints if using Next.js API routes or equivalent local API:

```text
GET    /api/settings
PUT    /api/settings

GET    /api/accounts
POST   /api/accounts
PUT    /api/accounts/:id

GET    /api/lookups
POST   /api/lookups
PUT    /api/lookups/:id
DELETE /api/lookups/:id

GET    /api/watchlist
POST   /api/watchlist
PUT    /api/watchlist/:id
DELETE /api/watchlist/:id
POST   /api/watchlist/:id/promote

GET    /api/trades
POST   /api/trades
GET    /api/trades/:id
PUT    /api/trades/:id
DELETE /api/trades/:id

POST   /api/trades/:id/executions
PUT    /api/trades/:id/executions/:executionId
DELETE /api/trades/:id/executions/:executionId

POST   /api/trades/:id/stop-adjustments
POST   /api/trades/:id/assets
DELETE /api/trades/:id/assets/:assetId

GET    /api/trades/:id/grade
PUT    /api/trades/:id/grade

GET    /api/mistakes
POST   /api/mistakes
PUT    /api/mistakes/:id
DELETE /api/mistakes/:id

GET    /api/account-rollforward
POST   /api/account-rollforward/recalculate
PUT    /api/account-rollforward/:id

GET    /api/dashboard
GET    /api/reviews/weekly
PUT    /api/reviews/weekly/:id

GET    /api/reviews/setups
GET    /api/checks

GET    /api/export/trades.csv
GET    /api/export/full-backup.zip
```

No authentication endpoints in Stage 1.

---

## 19. Import / Export / Backup

### 17.1 Stage 1 Import

Manual entry only.

Do not implement CSV import in Stage 1 unless explicitly added later.

### 17.2 Stage 1 Export

Required:

- Export all trades to CSV.
- Export filtered trade log to CSV.
- Export full journal backup.

Full journal backup should include:

```text
journal.db
screenshots/
metadata.json
```

Packaged as:

```text
trading-journal-backup-YYYYMMDD-HHMM.zip
```

### 17.3 Future Import

Future versions may support:

- Broker CSV import.
- Thinkorswim export import.
- Interactive Brokers import.
- TradeStation import.
- Excel workbook migration.

But these are not Stage 1 features.

---

## 20. Future Cloud Migration Path

Stage 1 should not build cloud features, but should avoid blocking them.

### 18.1 Future Architecture

Potential migration:

```text
SQLite → PostgreSQL
Local file storage → S3 / Cloudflare R2 / Supabase Storage
Local profile → users table
Local app → hosted web app
Manual entry → broker import jobs
```

### 18.2 Migration-Friendly Practices

Use:

- UUID primary keys.
- Created/updated timestamps.
- Service layer.
- Migrations.
- Lookup tables.
- File metadata table.
- No hardcoded filesystem assumptions in business logic.
- No business logic inside UI components.

Avoid:

- Spreadsheet-style denormalized model.
- Calculated fields as manually editable fields.
- Screenshots as database blobs.
- User-specific logic scattered through tables.
- UI-only calculations as source of truth.

---

## 21. Non-Functional Requirements

### 19.1 Performance

Target:

```text
Dashboard loads under 2 seconds with 10,000 trades.
Trade log filters under 1 second with 10,000 trades.
```

### 19.2 Reliability

Requirements:

- Use transactions for multi-step writes.
- Recalculate trade summaries after execution changes.
- Recalculate account rollforward after trade close or execution edits.
- Prevent partial saves.
- Keep raw execution history.

### 19.3 Data Integrity

Requirements:

- Foreign keys enabled.
- Check constraints where practical.
- Server/service-side validation.
- UI-side validation for responsiveness.
- Deterministic calculation engine.

### 19.4 Security

Stage 1 has no authentication.

Minimum local security expectations:

- App binds to localhost only.
- No remote network exposure by default.
- Do not send journal data to external services.
- Do not load external scripts that could access local journal data.
- Future auth/cloud security is out of scope.

### 19.5 Privacy

Journal data is private local user data.

Stage 1 rule:

```text
No telemetry.
No external upload.
No cloud sync.
No third-party analytics.
```

---

## 22. MVP Acceptance Criteria

The MVP is complete when all of the following are true:

### Core

- User can initialize a local journal.
- User can configure settings, accounts, setups, sectors, market conditions, mistake categories, and tags.
- User can create watchlist ideas.
- User can promote a watchlist idea into a planned trade.
- User can create a planned trade directly.
- User can calculate position size before entry.
- User can manually enter executions.
- User can record partial exits.
- App correctly derives open quantity, realized P&L, net P&L, R multiple, and status.
- User can upload local screenshots.
- User can attach external chart links.

### Risk

- App captures initial risk snapshot when trade opens.
- App warns when planned risk exceeds configured max risk.
- App blocks invalid stop/direction combinations.
- App prevents exit quantity from exceeding entry quantity.
- App shows current open risk.

### Review

- User can grade a closed trade.
- User can tag mistakes.
- User can create corrective actions.
- Weekly review summarizes performance and process.
- Setup review summarizes edge by setup with sample size warning.

### Dashboard

- Dashboard shows P&L, R metrics, drawdown, setup performance, mistake summary, process score, and open risk.
- Dashboard filters work by date/account/symbol/setup/direction/outcome/grade.

### Checks

- Checks page identifies missing fields, invalid risk, bad executions, excessive risk, missing grades, unresolved mistakes, and broken screenshot references.
- Dashboard shows overall PASS/WARN/FAIL status.

### UX / Workflow

- User always sees the lifecycle stage of every trade.
- Trade detail page shows lifecycle stepper, timeline, and next-action panel.
- Trade log shows review completeness and workflow status.
- Dashboard shows workflow bottlenecks.
- UI follows minimalist, professional, low-noise design principles.
- Core forms are keyboard-friendly and fast to use.

### Export / Backup

- User can export trades to CSV.
- User can export full local backup as a zip containing database and screenshots.

---

## 23. Recommended Implementation Phases

### Phase 1 — Foundation

- Project setup.
- SQLite schema.
- Migrations.
- Settings.
- Accounts.
- Lookups.
- Basic layout/navigation.

### Phase 2 — Trade Lifecycle

- Watchlist.
- Planned trade creation.
- Position sizing.
- Execution ledger.
- Partial exits.
- Trade status derivation.
- Trade summary calculations.

### Phase 3 — Risk & Assets

- Risk snapshot.
- Risk validation.
- Screenshot upload.
- External links.
- Stop adjustments.
- Checks page v1.

### Phase 4 — Review System

- Grade rubric.
- Mistake tagging.
- Corrective actions.
- Trade detail review layout.
- Weekly review.

### Phase 5 — Analytics

- Dashboard.
- Setup review.
- Monthly performance.
- R distribution.
- Drawdown.
- Process score charts.

### Phase 6 — Export & Hardening

- CSV export.
- Full backup zip.
- Recalculation tests.
- Validation tests.
- Playwright smoke tests.
- Performance pass with 10,000 generated trades.

---

## 24. Engineering Standards

### 22.1 Calculation Engine

- Keep calculations in dedicated service functions.
- Unit test all formulas.
- Do not duplicate formula logic across UI components.
- UI may preview calculations, but service layer is source of truth.

### 22.2 Testing Priorities

Minimum unit tests:

- Long realized P&L.
- Short realized P&L.
- Partial exits.
- Fees.
- R multiple.
- Risk per share.
- Account risk percentage.
- Status derivation.
- Invalid exit quantity.
- Position sizing.
- Account rollforward.
- Drawdown.
- Grade caps.
- Validation checks.

### 22.3 Code Organization

Recommended structure:

```text
src/
  app/
  components/
  db/
    schema.ts
    migrations/
  modules/
    trades/
      trade-calculations.ts
      trade-service.ts
      trade-validation.ts
    risk/
    dashboard/
    reviews/
    settings/
  lib/
  tests/
```

---

## 25. Open Decisions

The following decisions can be made during implementation:

1. Whether Stage 1 supports scale-ins explicitly or only partial exits.
   - Recommendation: support both through execution model, but keep UI simple.

2. Whether to use Next.js or Vite.
   - Recommendation: Next.js if the app may become cloud-hosted soon.
   - Recommendation: Vite if the app is strictly local for now.

3. Whether to package as a desktop app.
   - Recommendation: not in MVP.
   - Future option: Tauri.

4. Whether to store derived summaries in database tables.
   - Recommendation: compute dynamically first.
   - Add summary tables only if performance requires it.

---

## 26. References Used for Product Direction

These sources informed the competitive baseline and technical recommendations:

Technical stack references:

- SQLite official documentation describes SQLite as a small, fast, self-contained, high-reliability SQL database engine and as a self-contained, serverless, zero-configuration transactional database.
- DuckDB official documentation describes DuckDB as an in-process SQL OLAP database management system.
- Tauri official documentation describes Tauri as frontend-independent and cross-platform, useful later if the local web app should become a desktop application.
- shadcn/ui describes itself as a customizable component foundation/design system for React applications.

- SQLite official documentation: serverless, self-contained, zero-configuration transactional database.
- SQLite WAL documentation.
- DuckDB official documentation: in-process OLAP database.
- TradeZella feature pages and blog material on journaling, analytics, risk, mistakes, and trade review.
- TraderSync feature and support pages covering setups, mistakes, screenshots, filters, and analytics.
- Tradervue feature material covering journals, reports, notes, tags, and chart review.
- Edgewonk feature and review material covering trade review, trade management, mistakes, psychology, and process improvement.
- TradesViz feature material covering analytics, simulator/replay, statistics, and broader trading-journal feature coverage.

---

## 27. Final Product Constraint

Do not build a generic trading tracker.

Do not build an Excel replica.

Build a local-first process-improvement system for US stock trading.

The highest-value MVP is not the one with the most features. It is the one that makes it hard for the trader to ignore bad risk, weak setups, repeated mistakes, and poor execution discipline.
