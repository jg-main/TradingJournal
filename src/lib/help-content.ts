/**
 * Help content data module.
 *
 * Central source of truth for all in-app documentation text.
 * Structured for rendering by `src/app/help/page.tsx`.
 */

// ── Types ───────────────────────────────────────────────────────────────

export type HelpBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'note'; text: string }
  | { type: 'warning'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'code'; text: string };

export interface HelpSection {
  id: string;
  title: string;
  description: string;
  blocks: HelpBlock[];
}

// ── Help Sections ───────────────────────────────────────────────────────

export const helpSections: HelpSection[] = [
  {
    id: 'quickstart',
    title: 'Quickstart Guide',
    description: 'Get up and running in a few minutes.',
    blocks: [
      {
        type: 'paragraph',
        text: 'Trading Journal helps you track, analyze, and improve your trading performance through structured journaling and evidence-based reviews. Follow these steps to start using the app.',
      },
      {
        type: 'ordered-list',
        items: [
          'Go to Settings > App Profile and set your display name and timezone.',
          'Go to Settings > Risk Settings and configure your max risk per trade, default commission, and journal start date.',
          'Go to Settings > Accounts and add at least one active brokerage account.',
          'Go to Settings > Plays and create at least one active trading setup (these appear in the trade planning form).',
          'Start logging trades from the Trades page using the "Plan Trade" button.',
        ],
      },
      {
        type: 'note',
        text: 'The dashboard shows a setup checklist until all required configuration steps are completed.',
      },
    ],
  },
  {
    id: 'trade-lifecycle',
    title: 'Trade Lifecycle',
    description: 'How trades flow from planning through grading.',
    blocks: [
      {
        type: 'paragraph',
        text: 'Every trade passes through six stages. Understanding this lifecycle helps you build a complete, well-documented journal.',
      },
      {
        type: 'strong',
        text: '1. Plan',
      },
      {
        type: 'paragraph',
        text: 'Open the Plan Trade dialog from the Trades page. Select the setup, instrument, direction (long/short), and entry criteria. The position sizing calculator will estimate your share quantity based on your risk settings.',
      },
      {
        type: 'strong',
        text: '2. Execute',
      },
      {
        type: 'paragraph',
        text: 'Once your order fills, record the execution details: fill price, quantity, commission, and timestamp. Each trade can have multiple partial fills logged as separate executions.',
      },
      {
        type: 'strong',
        text: '3. Manage',
      },
      {
        type: 'paragraph',
        text: 'Track the trade while it is open. Record risk snapshots to capture current P&L, stop distance, and position value. Log any stop adjustments as the trade develops.',
      },
      {
        type: 'strong',
        text: '4. Close',
      },
      {
        type: 'paragraph',
        text: 'When you exit the position, record the closing execution. The system calculates realized P&L and R-multiple (return relative to initial risk). Confirm the trade outcome — profitable or unprofitable.',
      },
      {
        type: 'strong',
        text: '5. Grade',
      },
      {
        type: 'paragraph',
        text: 'Every closed trade needs a process grade evaluating how well you followed your trading plan. Grades are letter-based (A through F) and cover entries, exits, risk management, and emotional discipline. Separate from P&L — a losing trade can still earn a high process grade if it was well-managed.',
      },
      {
        type: 'strong',
        text: '6. Review',
      },
      {
        type: 'paragraph',
        text: 'Tag mistakes (minor, moderate, major, critical) during grading to track recurring behavior patterns. Review the closed trade in Trade Detail to see the grade, mistakes, checklist results, AI assessment, and exit notes together.',
      },
    ],
  },
  {
    id: 'accounts',
    title: 'Accounts',
    description: 'Manage brokerage accounts, deposits, and withdrawals.',
    blocks: [
      {
        type: 'paragraph',
        text: 'The Accounts section lets you manage all your brokerage accounts in one place. Each account tracks its own balance, P&L, and trade history.',
      },
      {
        type: 'unordered-list',
        items: [
          'Add accounts with name, broker, currency, and starting balance.',
          'Record deposits and withdrawals to keep your balance accurate.',
          'View account roll-forward showing starting balance, net P&L, and ending balance over time.',
          'Mark accounts as inactive when you stop using them — existing trades are preserved.',
        ],
      },
      {
        type: 'note',
        text: 'At least one active account is required before you can log trades. Account validation is part of the setup checklist.',
      },
    ],
  },
  {
    id: 'ai-assessment',
    title: 'AI Assessment',
    description: 'Get AI-powered feedback on your trade execution quality.',
    blocks: [
      {
        type: 'paragraph',
        text: 'The AI assessment feature analyzes your closed trades and provides objective feedback on your decision-making process. This helps you identify blind spots and reinforce good habits.',
      },
      {
        type: 'ordered-list',
        items: [
          'Go to Settings > AI to configure your AI provider (OpenAI or Anthropic). Enter your API key and choose the model.',
          'After closing a trade, open the trade detail view and click "Assess" to request an AI evaluation.',
          'The assessment scores your process against your defined setup criteria and provides written feedback.',
          'AI assessments are stored alongside the trade for later reference in the trade\'s review.',
        ],
      },
      {
        type: 'warning',
        text: 'AI assessments require a valid API key. The app sends trade data (setup, entries, exits, grade) to the configured AI provider. No account credentials or personally identifiable information is shared.',
      },
      {
        type: 'note',
        text: 'You can disable AI features entirely by leaving the API key field blank. The app works fully without AI — assessment is an optional enhancement.',
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings Reference',
    description: 'Understand each settings section at a glance.',
    blocks: [
      {
        type: 'strong',
        text: 'App Profile',
      },
      {
        type: 'paragraph',
        text: 'Configure your display name, timezone, and default currency. These values appear on trade records and reports.',
      },
      {
        type: 'strong',
        text: 'Risk Settings',
      },
      {
        type: 'paragraph',
        text: 'Set your maximum risk per trade (as a percentage of account value), default commission rate, and journal start date. These values drive the position sizing calculator and P&L aggregation.',
      },
      {
        type: 'strong',
        text: 'Plays (Trading Setups)',
      },
      {
        type: 'paragraph',
        text: 'Define the specific setups you trade. Each setup has a name, description, and can be toggled active/inactive. Setups appear in the Plan Trade dropdown.',
      },
      {
        type: 'strong',
        text: 'Mistake Types',
      },
      {
        type: 'paragraph',
        text: 'Manage the categories used when tagging mistakes during trade grading. Each type has a severity (minor, moderate, major, critical).',
      },
      {
        type: 'strong',
        text: 'Accounts',
      },
      {
        type: 'paragraph',
        text: 'Add and manage brokerage accounts including deposits, withdrawals, and account status.',
      },
    ],
  },
  {
    id: 'backup-restore',
    title: 'Backup & Restore',
    description: 'Protect your data and recover from failures.',
    blocks: [
      {
        type: 'paragraph',
        text: 'Trading Journal supports exporting your full journal data as a ZIP archive and restoring from a previous backup.',
      },
      {
        type: 'strong',
        text: 'Export a Backup',
      },
      {
        type: 'ordered-list',
        items: [
          'Navigate to Settings > Export & Backup.',
          'Click the backup card to download a ZIP file containing all your journal data as versioned JSON files.',
          'Store the ZIP file in a safe location — it is the only way to recover your data.',
        ],
      },
      {
        type: 'strong',
        text: 'Restore from a Backup',
      },
      {
        type: 'ordered-list',
        items: [
          'From the Settings page, click the "Restore" card.',
          'Select a backup ZIP file from your computer.',
          'Preview the backup contents (tables and row counts) before restoring.',
          'Type RESTORE to confirm — this replaces ALL existing data.',
        ],
      },
      {
        type: 'warning',
        text: 'Restoring a backup permanently replaces all current journal data. You cannot undo this action. Always back up your current data before restoring an older backup.',
      },
      {
        type: 'strong',
        text: 'Factory Reset',
      },
      {
        type: 'paragraph',
        text: 'You can wipe all journal data and start fresh from the Settings page. A backup download is required before the reset button becomes active.',
      },
    ],
  },
];

// ── Metadata ────────────────────────────────────────────────────────────

export const helpPageTitle = 'Help & Documentation';
export const helpPageDescription =
  'Learn how to use Trading Journal to track, analyze, and improve your trading performance.';
