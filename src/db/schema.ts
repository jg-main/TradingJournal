import { sqliteTable, text, integer, real, unique, index } from 'drizzle-orm/sqlite-core';
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
  backupEnabled: integer('backup_enabled', { mode: 'boolean' }).default(false),
  backupRetentionCount: integer('backup_retention_count').default(3),
  backupLastRunAt: text('backup_last_run_at'),
  backupLastRunStatus: text('backup_last_run_status'),
  backupCronTime: text('backup_cron_time').default('02:00'),
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
  analysisConfig: text('analysis_config'),
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
    enum: ['planned', 'open', 'closed', 'deleted'],
  }).notNull(),
  plannedEntry: real('planned_entry'),
  plannedStop: real('planned_stop'),
  plannedTarget1: real('planned_target_1'),
  plannedTarget2: real('planned_target_2'),
  plannedQuantity: real('planned_quantity'),
  thesis: text('thesis'),
  invalidationCondition: text('invalidation_condition'),
  preTradePlan: text('pre_trade_plan'),
  riskOverrideReason: text('risk_override_reason'),
  openedAt: text('opened_at'),
  closedAt: text('closed_at'),
  reviewedAt: text('reviewed_at'),
  exitNotes: text('exit_notes'),
  lesson: text('lesson'),
  currentPrice: real('current_price'),
  currentPriceFetchedAt: text('current_price_fetched_at'),
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
  idempotencyKey: text('idempotency_key'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  unique('uq_trade_executions_idempotency_key').on(t.idempotencyKey),
]);

export const positionPriceSnapshots = sqliteTable('position_price_snapshots', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id')
    .references(() => trades.id, { onDelete: 'cascade' })
    .notNull(),
  price: real('price').notNull(),
  source: text('source').notNull().default('yahoo'),
  marketState: text('market_state'),
  shortName: text('short_name'),
  quoteType: text('quote_type'),
  sector: text('sector'),
  industry: text('industry'),
  previousClose: real('previous_close'),
  dayHigh: real('day_high'),
  dayLow: real('day_low'),
  change: real('price_change'),
  changePercent: real('change_percent'),
  fetchedAt: text('fetched_at').notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  index('idx_position_price_snapshots_trade_id_fetched_at').on(t.tradeId, t.fetchedAt),
]);

export const tradeRiskSnapshots = sqliteTable('trade_risk_snapshots', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id')
    .references(() => trades.id, { onDelete: 'cascade' })
    .unique()
    .notNull(),
  accountEquityAtOpen: real('account_equity_at_open'),
  /** Provenance of accountEquityAtOpen (A2: current_projection / historical_rollforward / reconstructed_canonical / legacy_compatibility / unavailable). */
  accountEquitySource: text('account_equity_source'),
  /** As-of marker for accountEquityAtOpen (projection computed_as_of, rollforward date, or fill timestamp). */
  accountEquityAsOf: text('account_equity_as_of'),
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

export const tradeTargetAdjustments = sqliteTable('trade_target_adjustments', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id').references(() => trades.id, { onDelete: 'cascade' }).notNull(),
  // Which planned target level this adjustment rewrites: 1 = target 1, 2 = target 2.
  targetIndex: integer('target_index').notNull(),
  adjustedAt: text('adjusted_at'),
  previousTarget: real('previous_target'),
  newTarget: real('new_target'),
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
  name: text('name'),
  sector: text('sector'),
  industry: text('industry'),
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
  alertConfig: text('alert_config'),
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

// ── Checklist Definitions ───────────────────────────────────────────────

export const checklistDefinitions = sqliteTable('checklist_definitions', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id').references(() => accounts.id),
  setupId: text('setup_id').references(() => setupDefinitions.id),
  description: text('description').notNull(),
  isRequired: integer('is_required', { mode: 'boolean' }).default(true).notNull(),
  sortOrder: integer('sort_order'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  deletedAt: text('deleted_at'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

// ── Trade Check Results ──────────────────────────────────────────────────

export const tradeCheckResults = sqliteTable('trade_check_results', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id').references(() => trades.id, { onDelete: 'cascade' }).notNull(),
  checklistDefinitionId: text('checklist_definition_id').references(() => checklistDefinitions.id).notNull(),
  itemText: text('item_text'),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  comment: text('comment'),
  checkedAt: text('checked_at').default(sql`(current_timestamp)`),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
});

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

// ── Schwab Encrypted Tokens ────────────────────────────────────────────
//
// Stores OAuth tokens encrypted at rest using AES-256-GCM.
// Single-row table (always id='default') — only one Schwab connection at a time.
// The encrypted_access_token and encrypted_refresh_token columns contain
// JSON-serialized EncryptedData objects (iv, ciphertext, authTag as hex strings).
//
// Tokens are NEVER stored in market_data_settings.providers JSON blob;
// they live here so they are excluded from provider config reads.

export const schwabTokens = sqliteTable('schwab_tokens', {
  id: text('id').primaryKey().notNull(),
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  encryptedRefreshToken: text('encrypted_refresh_token'),
  scope: text('scope'),
  tokenType: text('token_type').default('Bearer'),
  expiresAt: text('expires_at'),
  refreshTokenExpiresAt: text('refresh_token_expires_at'),
  status: text('status').default('active'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

// ── Market Data Settings ────────────────────────────────────────────────

export const marketDataSettings = sqliteTable('market_data_settings', {
  id: text('id').primaryKey().notNull(),
  activeProvider: text('active_provider').default('clickhouse').notNull(),
  providers: text('providers').default('{}').notNull(),
  refreshIntervalSeconds: integer('refresh_interval_seconds').default(30).notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

// ── AI Trade Quality Assessment ────────────────────────────────────────

export const aiSettings = sqliteTable('ai_settings', {
  id: text('id').primaryKey().notNull(),
  provider: text('provider', {
    enum: ['openai', 'ollama', 'anthropic', 'google', 'custom'],
  }).notNull(),
  model: text('model').notNull(),
  apiKey: text('api_key'),
  baseUrl: text('base_url'),
  timeoutMs: integer('timeout_ms').default(30000),
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(4096),
  systemPrompt: text('system_prompt'),
  // ClickHouse connection config
  clickhouseHost: text('clickhouse_host').default('localhost'),
  clickhousePort: integer('clickhouse_port').default(8123),
  clickhouseUser: text('clickhouse_user').default('default'),
  clickhousePassword: text('clickhouse_password'),
  clickhouseDatabase: text('clickhouse_database').default('market'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
});

export const playEvaluationFields = sqliteTable('play_evaluation_fields', {
  id: text('id').primaryKey().notNull(),
  setupDefinitionId: text('setup_definition_id')
    .references(() => setupDefinitions.id, { onDelete: 'cascade' })
    .notNull(),
  fieldKey: text('field_key').notNull(),
  label: text('label').notNull(),
  description: text('description'),
  fieldType: text('field_type', {
    enum: ['boolean', 'score_1_5', 'score_1_10', 'text'],
  }).notNull(),
  weight: real('weight').default(1.0),
  minLookbackDays: integer('min_lookback_days'),
  sortOrder: integer('sort_order').default(0),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
}, (t) => [unique().on(t.setupDefinitionId, t.fieldKey)]);

export const tradeAssessmentSnapshots = sqliteTable('trade_assessment_snapshots', {
  id: text('id').primaryKey().notNull(),
  tradeId: text('trade_id')
    .references(() => trades.id, { onDelete: 'cascade' })
    .notNull(),
  assessedAt: text('assessed_at').default(sql`(current_timestamp)`),
  assessmentType: text('assessment_type', {
    enum: ['ai_quality', 'ai_review'],
  }).notNull(),
  overallScore: real('overall_score'),
  scorecardJson: text('scorecard_json'),
  modelUsed: text('model_used'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  promptText: text('prompt_text'),
  rawResponse: text('raw_response'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
});

// ── Alert Log ──────────────────────────────────────────────────────────
//
// Persistent log of fired alert conditions. Written by the alert polling
// engine (S04/T03) when a transition from unmet→met is detected. Read by
// the /alerts page (S04/T05) to display notification history.

export const alertLog = sqliteTable('alert_log', {
  id: text('id').primaryKey().notNull(),
  watchlistItemId: text('watchlist_item_id')
    .references(() => watchlistItems.id, { onDelete: 'cascade' })
    .notNull(),
  symbol: text('symbol').notNull(),
  condition: text('condition', {
    enum: ['above', 'below', 'rsiAbove', 'rsiBelow'],
  }).notNull(),
  threshold: real('threshold'),
  actualValue: real('actual_value'),
  firedAt: text('fired_at').notNull(),
  readAt: text('read_at'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  index('idx_alert_log_fired_at').on(t.firedAt),
  index('idx_alert_log_watchlist_item_id').on(t.watchlistItemId),
]);

// ── Accounting Ledger ────────────────────────────────────────────────────
//
// Three-table accounting kernel for balanced double-entry posting.
//
// financial_events  — Source documents triggering accounting actions
//                     (opening balance, trade execution, adjustment, transfer).
//                     Each event carries an optional idempotency_key for
//                     replay-safe posting.
//
// ledger_entries    — Journal entry headers (one per financial event).
//                     The entry groups a set of debit/credit postings into
//                     one accounting journal entry.
//
// ledger_postings   — Individual debit or credit posting rows. Every entry
//                     produces exactly two postings (one debit, one credit)
//                     that are balanced. Postings are immutable — UPDATE and
//                     DELETE are blocked by later migration-level triggers.
//
// All monetary amounts are stored as TEXT canonical decimals (e.g. "1000.00")
// with an INTEGER micros column (1 unit = 1_000_000 micros) for exact
// arithmetic without floating-point rounding.

export const financialEvents = sqliteTable('financial_events', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  eventType: text('event_type', {
    enum: [
      'opening_balance', 'trade_execution', 'adjustment', 'transfer',
      'deposit', 'withdrawal', 'dividend', 'interest',
      'fee', 'tax', 'stock_split', 'manual_adjustment',
    ],
  }).notNull(),
  idempotencyKey: text('idempotency_key'),
  description: text('description'),
  /** JSON blob of event-type-specific payload (e.g. cash amount, split ratio). */
  payload: text('payload'),
  /** JSON blob of standardised economic effect (e.g. cash direction, market symbol). */
  effect: text('effect'),
  postedAt: text('posted_at').notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  unique('uq_financial_events_idempotency_key').on(t.idempotencyKey),
  index('idx_financial_events_account_id').on(t.accountId),
  index('idx_financial_events_posted_at').on(t.postedAt),
]);

export const ledgerEntries = sqliteTable('ledger_entries', {
  id: text('id').primaryKey().notNull(),
  financialEventId: text('financial_event_id')
    .references(() => financialEvents.id, { onDelete: 'cascade' })
    .notNull(),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  description: text('description'),
  postedAt: text('posted_at').notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  index('idx_ledger_entries_financial_event_id').on(t.financialEventId),
  index('idx_ledger_entries_account_id').on(t.accountId),
  index('idx_ledger_entries_posted_at').on(t.postedAt),
]);

export const ledgerPostings = sqliteTable('ledger_postings', {
  id: text('id').primaryKey().notNull(),
  ledgerEntryId: text('ledger_entry_id')
    .references(() => ledgerEntries.id, { onDelete: 'cascade' })
    .notNull(),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  side: text('side', { enum: ['debit', 'credit'] }).notNull(),
  amount: text('amount').notNull(),
  amountMicros: integer('amount_micros').notNull(),
  currency: text('currency').default('USD').notNull(),
  sequence: integer('sequence').notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  index('idx_ledger_postings_ledger_entry_id').on(t.ledgerEntryId),
  index('idx_ledger_postings_account_id_side').on(t.accountId, t.side),
  index('idx_ledger_postings_sequence').on(t.sequence),
]);

// ── Accounting Executions & FIFO Positions ───────────────────────────────
//
// Immutable execution and position-projection tables for economic-side
// fills, separate from the journal-domain trade_executions table.
//
// instruments        — Canonical symbol references (one per unique symbol).
// accounting_executions — Immutable economic-side fill records with
//                         exact-decimal quantity/price/fees.
// account_positions    — Current rebuildable projection of positions per
//                         (account, instrument) pair.
// fifo_lots            — Open FIFO cost-basis lots per position.
// lot_matches          — Closed lot slice matches with realized P&L.
//
// All monetary amounts are TEXT canonical decimals (e.g. "1000.00")
// with INTEGER micros column for exact arithmetic.
// UPDATE/DELETE triggers enforce immutability.

export const instruments = sqliteTable('instruments', {
  id: text('id').primaryKey().notNull(),
  symbol: text('symbol').notNull().unique(),
  name: text('name'),
  type: text('type', {
    enum: ['stock', 'etf', 'option', 'future', 'forex', 'crypto', 'other'],
  }).default('stock').notNull(),
  currency: text('currency').default('USD').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
}, (t) => [
  index('idx_instruments_symbol').on(t.symbol),
]);

export const accountingExecutions = sqliteTable('accounting_executions', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  instrumentId: text('instrument_id')
    .references(() => instruments.id)
    .notNull(),
  action: text('action', {
    enum: ['buy', 'sell', 'sell_short', 'buy_to_cover', 'add', 'reduce'],
  }).notNull(),
  quantity: text('quantity').notNull(),
  price: text('price').notNull(),
  fees: text('fees').notNull().default('0.00'),
  idempotencyKey: text('idempotency_key'),
  journalTradeId: text('journal_trade_id'),
  description: text('description'),
  postedAt: text('posted_at').notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  unique('uq_accounting_executions_idempotency_key').on(t.idempotencyKey),
  index('idx_accounting_executions_account_id').on(t.accountId),
  index('idx_accounting_executions_instrument_id').on(t.instrumentId),
  index('idx_accounting_executions_posted_at').on(t.postedAt),
]);

export const accountPositions = sqliteTable('account_positions', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  instrumentId: text('instrument_id')
    .references(() => instruments.id)
    .notNull(),
  direction: text('direction', { enum: ['long', 'short'] }),
  quantity: text('quantity').notNull().default('0.00'),
  averageCost: text('average_cost').notNull().default('0.00'),
  totalCostBasis: text('total_cost_basis').notNull().default('0.00'),
  realizedGrossPnl: text('realized_gross_pnl').notNull().default('0.00'),
  realizedFees: text('realized_fees').notNull().default('0.00'),
  realizedNetPnl: text('realized_net_pnl').notNull().default('0.00'),
  lastUpdated: text('last_updated').notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
}, (t) => [
  unique('uq_account_positions_account_instrument').on(t.accountId, t.instrumentId),
  index('idx_account_positions_account_id').on(t.accountId),
  index('idx_account_positions_instrument_id').on(t.instrumentId),
]);

export const fifoLots = sqliteTable('fifo_lots', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  instrumentId: text('instrument_id')
    .references(() => instruments.id)
    .notNull(),
  direction: text('direction', { enum: ['long', 'short'] }).notNull(),
  remainingQuantity: text('remaining_quantity').notNull(),
  originalQuantity: text('original_quantity').notNull(),
  entryPrice: text('entry_price').notNull(),
  costBasisTotal: text('cost_basis_total').notNull(),
  allocatedFees: text('allocated_fees').notNull().default('0.00'),
  openingExecutionId: text('opening_execution_id')
    .references(() => accountingExecutions.id)
    .notNull(),
  openedAt: text('opened_at').notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  index('idx_fifo_lots_account_instrument').on(t.accountId, t.instrumentId),
  index('idx_fifo_lots_opening_execution_id').on(t.openingExecutionId),
]);

// ── Valuation Marks (immutable price observations) ──────────────────────
//
// Immutable exact-decimal price marks per (account, instrument, timestamp),
// append-only via UPDATE/DELETE triggers.
//
// price / price_micros follow the same exact-decimal pattern as ledger_postings
// (TEXT canonical decimal + INTEGER micros for exact arithmetic).

export const valuationMarks = sqliteTable('valuation_marks', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  instrumentId: text('instrument_id')
    .references(() => instruments.id)
    .notNull(),
  price: text('price').notNull(),
  priceMicros: integer('price_micros').notNull(),
  source: text('source', {
    enum: ['user', 'market_data', 'import', 'system'],
  }).notNull(),
  markTimestamp: text('mark_timestamp').notNull(),
  idempotencyKey: text('idempotency_key'),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  unique('uq_valuation_marks_idempotency_key').on(t.idempotencyKey),
  index('idx_valuation_marks_account_instrument').on(t.accountId, t.instrumentId),
  index('idx_valuation_marks_account_instrument_timestamp').on(t.accountId, t.instrumentId, t.markTimestamp),
]);

// ── Account Performance Projection (single-row per account, rebuildable) ──
//
// Rebuildable per-account performance projection containing NAV, P&L, fees,
// exposure, TWR, high-water mark, and drawdown with explicit data-quality
// warnings. Replaced atomically on each rebuild (upsert by account_id).

export const accountPerformance = sqliteTable('account_performance', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull()
    .unique(),
  computedAsOf: text('computed_as_of').notNull(),
  netCash: text('net_cash').notNull(),
  nav: text('nav').notNull(),
  markedPositions: text('marked_positions').notNull(),
  realizedPnl: text('realized_pnl').notNull(),
  unrealizedPnl: text('unrealized_pnl').notNull(),
  totalPnl: text('total_pnl').notNull(),
  realizedFees: text('realized_fees').notNull(),
  grossExposure: text('gross_exposure').notNull(),
  netExposure: text('net_exposure').notNull(),
  modifiedDietzReturn: text('modified_dietz_return'),
  twr: text('twr'),
  highWaterMark: text('high_water_mark'),
  drawdown: text('drawdown'),
  drawdownPct: text('drawdown_pct'),
  warnings: text('warnings').notNull().default('[]'),
  positionsJson: text('positions_json').notNull().default('[]'),
  rebuildCount: integer('rebuild_count').notNull().default(0),
  lastRebuiltAt: text('last_rebuilt_at').notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').default(sql`(current_timestamp)`),
}, (t) => [
  index('idx_account_performance_account_id').on(t.accountId),
]);

// ── Correction Lineage ──────────────────────────────────────────────────
//
// Tracks execution corrections that follow the reversal-and-replacement
// pattern. Every correction links an original execution to its reversal
// and replacement executions, preserving full audit lineage.

export const correctionLineage = sqliteTable('correction_lineage', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  originalExecutionId: text('original_execution_id')
    .references(() => accountingExecutions.id)
    .notNull(),
  reversalExecutionId: text('reversal_execution_id')
    .references(() => accountingExecutions.id)
    .notNull(),
  replacementExecutionId: text('replacement_execution_id')
    .references(() => accountingExecutions.id)
    .notNull(),
  idempotencyKey: text('idempotency_key'),
  reason: text('reason'),
  correctedAt: text('corrected_at').notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  unique('uq_correction_lineage_idempotency_key').on(t.idempotencyKey),
  index('idx_correction_lineage_account_id').on(t.accountId),
  index('idx_correction_lineage_original_execution_id').on(t.originalExecutionId),
  index('idx_correction_lineage_reversal_execution_id').on(t.reversalExecutionId),
  index('idx_correction_lineage_replacement_execution_id').on(t.replacementExecutionId),
]);

// ── Legacy Accounting Migration Audit ──────────────────────────────────

export const accountingMigrationRuns = sqliteTable('accounting_migration_runs', {
  id: text('id').primaryKey().notNull(),
  accountId: text('account_id').references(() => accounts.id).notNull(),
  status: text('status', {
    enum: ['in_progress', 'completed', 'failed', 'rolled_back'],
  }).notNull().default('in_progress'),
  totalRecords: integer('total_records').notNull().default(0),
  mappedCount: integer('mapped_count').notNull().default(0),
  anomalyCount: integer('anomaly_count').notNull().default(0),
  unsupportedCount: integer('unsupported_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  rebuildFingerprint: text('rebuild_fingerprint'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => [
  index('idx_migration_runs_account_id').on(t.accountId),
  index('idx_migration_runs_status').on(t.status),
]);

export const accountingMigrationRecords = sqliteTable('accounting_migration_records', {
  id: text('id').primaryKey().notNull(),
  runId: text('run_id').references(() => accountingMigrationRuns.id).notNull(),
  sourceTable: text('source_table').notNull(),
  sourceId: text('source_id').notNull(),
  status: text('status', {
    enum: ['mapped', 'anomaly', 'unsupported', 'duplicate'],
  }).notNull(),
  recordType: text('record_type', {
    enum: ['cash_event', 'execution', 'price_mark', 'unsupported'],
  }).notNull(),
  anomalyCode: text('anomaly_code'),
  anomalyField: text('anomaly_field'),
  anomalyDetail: text('anomaly_detail'),
  idempotencyKey: text('idempotency_key'),
  accountingEventId: text('accounting_event_id'),
  accountingExecutionId: text('accounting_execution_id'),
  accountingMarkId: text('accounting_mark_id'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => [
  index('idx_migration_records_run_id').on(t.runId),
  index('idx_migration_records_source').on(t.sourceTable, t.sourceId),
]);

// ── Lot Matches ─────────────────────────────────────────────────────────

export const lotMatches = sqliteTable('lot_matches', {
  id: text('id').primaryKey().notNull(),
  closingExecutionId: text('closing_execution_id')
    .references(() => accountingExecutions.id)
    .notNull(),
  lotId: text('lot_id')
    .references(() => fifoLots.id)
    .notNull(),
  matchQuantity: text('match_quantity').notNull(),
  matchPrice: text('match_price').notNull(),
  realizedGrossPnl: text('realized_gross_pnl').notNull(),
  allocatedFees: text('allocated_fees').notNull().default('0.00'),
  realizedNetPnl: text('realized_net_pnl').notNull(),
  sequence: integer('sequence').notNull(),
  createdAt: text('created_at').default(sql`(current_timestamp)`),
}, (t) => [
  index('idx_lot_matches_closing_execution_id').on(t.closingExecutionId),
  index('idx_lot_matches_lot_id').on(t.lotId),
]);

// ── Dashboard Views ──────────────────────────────────────────────────────
//
// Persisted dashboard view configurations. Each row stores the widget layout
// (JSON) and hidden-widget state so switching views instantly restores a
// different arrangement. System views have is_system = 1 and use a system-*
// id prefix; they are read-only in the Manage Views dialog.
//
// This table replaces localStorage-only persistence (key dashboard:views:v2).
// Views written here survive localStorage.clear().

export const dashboardViews = sqliteTable('dashboard_views', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  /** JSON-serialized LayoutItem[] — the react-grid-layout configuration. */
  layout: text('layout').notNull().default('[]'),
  /** JSON-serialized string[] — widget IDs hidden in this view. */
  hiddenWidgetIds: text('hidden_widget_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
});
