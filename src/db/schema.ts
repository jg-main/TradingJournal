import { sqliteTable, text, integer, real, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ── Profile & Settings ──────────────────────────────────────────────────

export const appProfile = sqliteTable('app_profile', {
  id: text('id').primaryKey().notNull(),
  displayName: text('display_name'),
  timezone: text('timezone').default('America/Bogota'),
  defaultCurrency: text('default_currency').default('USD'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey().notNull(),
  defaultAccountId: text('default_account_id').references(() => accounts.id),
  startingAccountValue: real('starting_account_value'),
  maxRiskPerTradePct: real('max_risk_per_trade_pct'),
  defaultCommission: real('default_commission'),
  journalStartDate: text('journal_start_date'),
  currency: text('currency').default('USD'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

// ── Accounts ────────────────────────────────────────────────────────────

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  broker: text('broker'),
  currency: text('currency').default('USD'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  maxRiskPerTradePct: real('max_risk_per_trade_pct'),
  defaultCommission: real('default_commission'),
  startingBalance: real('starting_balance'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

// ── Lookups ─────────────────────────────────────────────────────────────

export const lookupValues = sqliteTable('lookup_values', {
  id: text('id').primaryKey().notNull(),
  type: text('type', {
    enum: [
      'sector', 'setup', 'market_condition', 'mistake_type',
      'execution_reason', 'asset_type', 'phase', 'severity',
      'source_type', 'action_item_status',
    ],
  }).notNull(),
  value: text('value').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

// ── Setup Definitions ────────────────────────────────────────────────────

export const setupDefinitions = sqliteTable('setup_definitions', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull().unique(),
  description: text('description'),
  howToPlay: text('how_to_play'),
  entryRules: text('entry_rules'),
  exitRules: text('exit_rules'),
  tags: text('tags'),
  defaultRiskPct: real('default_risk_pct'),
  positionSizingRules: text('position_sizing_rules'),
  chartPatterns: text('chart_patterns'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

// ── Trades ─────────────────────────────────────────────────────────────

export const trades = sqliteTable('trades', {
  id: text('id').primaryKey().notNull(),
  tradeCode: text('trade_code').unique().notNull(),
  accountId: text('account_id').references(() => accounts.id).notNull(),
  symbol: text('symbol').notNull(),
  direction: text('direction', { enum: ['long', 'short'] }).notNull(),
  sectorId: text('sector_id').references(() => lookupValues.id),
  setupId: text('setup_id').references(() => lookupValues.id),
  marketConditionId: text('market_condition_id').references(() => lookupValues.id),
  status: text('status', {
    enum: ['idea', 'planned', 'open', 'partially_closed', 'closed', 'scratched'],
  }).notNull(),
  plannedEntry: real('planned_entry'),
  plannedStop: real('planned_stop'),
  plannedTarget1: real('planned_target_1'),
  plannedTarget2: real('planned_target_2'),
  thesis: text('thesis'),
  invalidationCondition: text('invalidation_condition'),
  preTradePlan: text('pre_trade_plan'),
  openedAt: text('opened_at'),
  closedAt: text('closed_at'),
  exitNotes: text('exit_notes'),
  lesson: text('lesson'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

export const tradeExecutions = sqliteTable('trade_executions', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id').references(() => trades.id, { onDelete: 'cascade' }).notNull(),
  executedAt: text('executed_at'),
  action: text('action', {
    enum: ['buy', 'sell', 'buy_to_cover', 'sell_short', 'add', 'reduce'],
  }).notNull(),
  quantity: real('quantity').notNull(),
  price: real('price').notNull(),
  fees: real('fees').default(0),
  reasonId: text('reason_id').references(() => lookupValues.id),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
});

export const tradeRiskSnapshots = sqliteTable('trade_risk_snapshots', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id')
    .references(() => trades.id, { onDelete: 'cascade' })
    .unique()
    .notNull(),
  accountEquityAtOpen: real('account_equity_at_open'),
  initialEntryPrice: real('initial_entry_price'),
  initialStopPrice: real('initial_stop_price'),
  initialQuantity: real('initial_quantity'),
  riskPerShare: real('risk_per_share'),
  initialRiskAmount: real('initial_risk_amount'),
  accountRiskPct: real('account_risk_pct'),
  plannedRewardRisk: real('planned_reward_risk'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
});

export const tradeStopAdjustments = sqliteTable('trade_stop_adjustments', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id').references(() => trades.id, { onDelete: 'cascade' }).notNull(),
  adjustedAt: text('adjusted_at'),
  previousStop: real('previous_stop'),
  newStop: real('new_stop'),
  reason: text('reason'),
  ruleBased: integer('rule_based', { mode: 'boolean' }),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
});

export const tradeAssets = sqliteTable('trade_assets', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id').references(() => trades.id, { onDelete: 'cascade' }).notNull(),
  assetType: text('asset_type', {
    enum: ['screenshot', 'document', 'link', 'image', 'other'],
  }).notNull(),
  phase: text('phase', {
    enum: ['pre_trade', 'entry', 'management', 'exit', 'review'],
  }).notNull(),
  label: text('label'),
  filePath: text('file_path'),
  externalUrl: text('external_url'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
});

export const tradeGrades = sqliteTable('trade_grades', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id')
    .references(() => trades.id, { onDelete: 'cascade' })
    .unique()
    .notNull(),
  setupQualityScore: integer('setup_quality_score'),
  riskQualityScore: integer('risk_quality_score'),
  entryQualityScore: integer('entry_quality_score'),
  managementQualityScore: integer('management_quality_score'),
  exitQualityScore: integer('exit_quality_score'),
  reviewQualityScore: integer('review_quality_score'),
  totalScore: real('total_score'),
  gradeLabel: text('grade_label'),
  followedPlan: integer('followed_plan', { mode: 'boolean' }),
  ruleViolation: integer('rule_violation', { mode: 'boolean' }),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

export const tradeMistakes = sqliteTable('trade_mistakes', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id').references(() => trades.id, { onDelete: 'cascade' }).notNull(),
  mistakeTypeId: text('mistake_type_id').references(() => lookupValues.id),
  phase: text('phase', {
    enum: ['pre_trade', 'entry', 'management', 'exit', 'review'],
  }).notNull(),
  severity: text('severity', {
    enum: ['minor', 'moderate', 'major', 'critical'],
  }).notNull(),
  rootCause: text('root_cause'),
  correctiveAction: text('corrective_action'),
  status: text('status', {
    enum: ['open', 'addressed', 'improved', 'resolved'],
  }).notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

// ── Watchlist ───────────────────────────────────────────────────────────

export const watchlistItems = sqliteTable('watchlist_items', {
  id: text('id').primaryKey().notNull(),
  dateAdded: text('date_added'),
  symbol: text('symbol').notNull(),
  sectorId: text('sector_id').references(() => lookupValues.id),
  setupId: text('setup_id').references(() => lookupValues.id),
  direction: text('direction', { enum: ['long', 'short'] }).notNull(),
  thesis: text('thesis'),
  marketContext: text('market_context'),
  keyLevel: real('key_level'),
  triggerPrice: real('trigger_price'),
  plannedStop: real('planned_stop'),
  targetPrice: real('target_price'),
  status: text('status', {
    enum: ['pending', 'watching', 'triggered', 'skipped', 'expired'],
  }).notNull(),
  notes: text('notes'),
  promotedTradeId: text('promoted_trade_id').references(() => trades.id),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

// ── Account Transactions ────────────────────────────────────────────────

export const accountTransactions = sqliteTable('account_transactions', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id').references(() => accounts.id).notNull(),
  type: text('type', { enum: ['deposit', 'withdrawal'] }).notNull(),
  amount: real('amount').notNull(),
  balanceAfter: real('balance_after').notNull(),
  date: text('date').notNull(),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
});

// ── Accounting & Reviews ────────────────────────────────────────────────

export const accountRollforward = sqliteTable('account_rollforward', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id').references(() => accounts.id).notNull(),
  date: text('date').notNull(),
  beginningEquity: real('beginning_equity'),
  depositsWithdrawals: real('deposits_withdrawals').default(0),
  realizedGrossPnl: real('realized_gross_pnl').default(0),
  fees: real('fees').default(0),
  endingEquity: real('ending_equity'),
  cumulativePnl: real('cumulative_pnl'),
  highWaterMark: real('high_water_mark'),
  drawdownAmount: real('drawdown_amount').default(0),
  drawdownPct: real('drawdown_pct').default(0),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

export const weeklyReviews = sqliteTable('weekly_reviews', {
  id: text('id').primaryKey().notNull(),
  weekStart: text('week_start').notNull(),
  weekEnd: text('week_end').notNull(),
  accountId: text('account_id').references(() => accounts.id).notNull(),
  closedTrades: integer('closed_trades').default(0),
  netPnl: real('net_pnl').default(0),
  avgR: real('avg_r').default(0),
  winRate: real('win_rate').default(0),
  avgProcessScore: real('avg_process_score').default(0),
  notes: text('notes'),
  focusNextWeek: text('focus_next_week'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
}, (t) => [unique().on(t.accountId, t.weekStart, t.weekEnd)]);

export const reviewActionItems = sqliteTable('review_action_items', {
  id: text('id').primaryKey().notNull(),
  sourceType: text('source_type', {
    enum: ['weekly_review', 'trade_review', 'general'],
  }).notNull(),
  sourceId: text('source_id'),
  actionText: text('action_text').notNull(),
  status: text('status', {
    enum: ['open', 'in_progress', 'done', 'cancelled'],
  }).notNull(),
  dueDate: text('due_date'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});
