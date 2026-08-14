/**
 * Shared backup/restore table metadata.
 *
 * This module intentionally contains no database imports so the restore UI
 * can use the same labels and table set as the server-side backup pipeline.
 */

export interface BackupTableDefinition {
  name: string;
  label: string;
  restoreOrder: number;
  optionalInExistingBackups?: boolean;
}

/** File names produced by the trade screenshot upload route. */
export const BACKUP_ASSET_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|gif|webp|svg)$/i;

export const BACKUP_TABLES = [
  { name: 'app_profile', label: 'App Profile', restoreOrder: 1 },
  { name: 'ai_settings', label: 'AI Settings', restoreOrder: 2 },
  { name: 'market_data_settings', label: 'Market Data Settings', restoreOrder: 3 },
  { name: 'schwab_tokens', label: 'Schwab Tokens', restoreOrder: 4 },
  { name: 'settings', label: 'Settings', restoreOrder: 6 },
  { name: 'accounts', label: 'Accounts', restoreOrder: 5 },
  { name: 'instruments', label: 'Instruments', restoreOrder: 7 },
  { name: 'accounting_executions', label: 'Accounting Executions', restoreOrder: 8 },
  { name: 'correction_lineage', label: 'Correction Lineage', restoreOrder: 9 },
  {
    name: 'accounting_migration_runs',
    label: 'Accounting Migration Runs',
    restoreOrder: 10,
    optionalInExistingBackups: true,
  },
  {
    name: 'accounting_migration_records',
    label: 'Accounting Migration Records',
    restoreOrder: 11,
    optionalInExistingBackups: true,
  },
  { name: 'account_positions', label: 'Account Positions', restoreOrder: 12 },
  { name: 'account_performance', label: 'Account Performance', restoreOrder: 13 },
  { name: 'valuation_marks', label: 'Valuation Marks', restoreOrder: 14 },
  { name: 'fifo_lots', label: 'FIFO Lots', restoreOrder: 15 },
  { name: 'financial_events', label: 'Financial Events', restoreOrder: 16 },
  { name: 'ledger_entries', label: 'Ledger Entries', restoreOrder: 17 },
  { name: 'ledger_postings', label: 'Ledger Postings', restoreOrder: 18 },
  { name: 'lot_matches', label: 'Lot Matches', restoreOrder: 19 },
  { name: 'lookup_values', label: 'Lookup Values', restoreOrder: 20 },
  { name: 'setup_definitions', label: 'Setup Definitions', restoreOrder: 21 },
  { name: 'checklist_definitions', label: 'Checklist Definitions', restoreOrder: 22 },
  { name: 'play_evaluation_fields', label: 'Play Evaluation Fields', restoreOrder: 23 },
  { name: 'trades', label: 'Trades', restoreOrder: 24 },
  { name: 'trade_executions', label: 'Trade Executions', restoreOrder: 25 },
  { name: 'trade_risk_snapshots', label: 'Trade Risk Snapshots', restoreOrder: 26 },
  { name: 'trade_stop_adjustments', label: 'Trade Stop Adjustments', restoreOrder: 27 },
  { name: 'trade_target_adjustments', label: 'Trade Target Adjustments', restoreOrder: 28 },
  { name: 'trade_assets', label: 'Trade Assets', restoreOrder: 29 },
  { name: 'trade_grades', label: 'Trade Grades', restoreOrder: 30 },
  { name: 'position_price_snapshots', label: 'Position Price Snapshots', restoreOrder: 31 },
  { name: 'trade_assessment_snapshots', label: 'Trade Assessment Snapshots', restoreOrder: 32 },
  { name: 'trade_mistakes', label: 'Trade Mistakes', restoreOrder: 33 },
  { name: 'trade_check_results', label: 'Trade Check Results', restoreOrder: 34 },
  { name: 'watchlist_items', label: 'Watchlist Items', restoreOrder: 35 },
  { name: 'alert_log', label: 'Alert Log', restoreOrder: 36 },
  { name: 'account_transactions', label: 'Account Transactions', restoreOrder: 37 },
  { name: 'account_rollforward', label: 'Account Rollforward', restoreOrder: 38 },
  { name: 'weekly_reviews', label: 'Weekly Reviews', restoreOrder: 39 },
  { name: 'review_action_items', label: 'Review Action Items', restoreOrder: 40 },
  { name: 'dashboard_views', label: 'Dashboard Views', restoreOrder: 41, optionalInExistingBackups: true },
] as const satisfies readonly BackupTableDefinition[];

export const BACKUP_TABLE_LABELS: Record<string, string> = Object.fromEntries(
  BACKUP_TABLES.map(({ name, label }) => [name, label]),
);
