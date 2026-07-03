/**
 * export-csv.test.ts
 *
 * Comprehensive tests for the CSV export library.
 * Covers positive, negative, and edge cases.
 *
 * Run: npx tsx src/lib/export-csv.test.ts
 */

import {
  exportTradesToCsv,
  escapeCsvField,
  CSV_COLUMNS,
  type ExportTradeRow,
} from './export-csv';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} (FAILED)`);
  }
}

function assertNull(v: unknown, msg: string) {
  if (v === null) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg} — expected null, got ${v} (FAILED)`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: escapeCsvField
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## escapeCsvField');

  // 1. Null → empty string
  {
    const r = escapeCsvField(null);
    assert(r === '', 'null → empty string');
  }

  // 2. Undefined → empty string
  {
    const r = escapeCsvField(undefined);
    assert(r === '', 'undefined → empty string');
  }

  // 3. Simple string (no special chars) → unchanged
  {
    const r = escapeCsvField('hello');
    assert(r === 'hello', 'simple string → unchanged');
  }

  // 4. Number → stringified
  {
    const r = escapeCsvField(42.5);
    assert(r === '42.5', 'number → stringified');
  }

  // 5. Boolean → stringified
  {
    const r = escapeCsvField(true);
    assert(r === 'true', 'boolean → stringified');
  }

  // 6. Value with comma → quoted
  {
    const r = escapeCsvField('USD,INR');
    assert(r === '"USD,INR"', 'comma → quoted');
  }

  // 7. Value with double quote → quoted and escaped
  {
    const r = escapeCsvField('He said "hello"');
    assert(r === '"He said ""hello"""', 'double quote → escaped');
  }

  // 8. Value with newline → quoted
  {
    const r = escapeCsvField('line1\nline2');
    assert(r === '"line1\nline2"', 'newline → quoted');
  }

  // 9. Value with carriage return → quoted
  {
    const r = escapeCsvField('line1\r\nline2');
    assert(r === '"line1\r\nline2"', 'CRLF → quoted');
  }

  // 10. Value with multiple special characters
  {
    const r = escapeCsvField('a,b "c" d');
    assert(r === '"a,b ""c"" d"', 'mixed special chars → properly escaped');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests: exportTradesToCsv
// ────────────────────────────────────────────────────────────────────────
{
  console.log('\n## exportTradesToCsv');

  // 1. Empty array → header row only + BOM
  {
    const csv = exportTradesToCsv([]);

    // Check BOM prefix
    assert(csv.startsWith('\uFEFF'), 'empty array → BOM prefix present');

    // Count lines: header + empty data row (since we always have \n at end)
    const lines = csv.split('\n');
    // BOM + header, trailing newline gives one line in array
    const headerLabels = CSV_COLUMNS.map((c) => c.label).join(',');
    assert(lines[0] === '\uFEFF' + headerLabels, 'empty array → header row contains all column labels');

    // Should be exactly header + trailing newline (no data rows)
    // lines: [BOM+header, ''] because we end with \n
    assert(lines.length === 2, 'empty array → only header row');
    assert(lines[1] === '', 'empty array → trailing newline');
  }

  // 2. Single trade with all fields populated
  {
    const trade: ExportTradeRow = {
      tradeCode: 'T001',
      symbol: 'AAPL',
      direction: 'long',
      status: 'closed',
      setup: 'Breakout',
      sector: 'Technology',
      marketCondition: 'Bull Market',
      plannedEntry: 150.00,
      plannedStop: 145.00,
      plannedTarget1: 165.00,
      thesis: 'Strong earnings growth',
      invalidationCondition: 'Below 145 support',
      preTradePlan: 'Enter on breakout above 152',
      exitNotes: 'Exited at target 1',
      lesson: 'Stick to the plan',
      openedAt: '2026-01-10T10:00:00Z',
      closedAt: '2026-01-10T14:00:00Z',
      createdAt: '2026-01-10T09:00:00Z',
      updatedAt: '2026-01-10T14:30:00Z',
      realizedPnL: 1500.00,
      rMultiple: 3.0,
      avgEntryPrice: 150.00,
      totalEntryQty: 100,
      totalExitQty: 100,
      openQuantity: 0,
      totalFees: 4.50,
      setupQualityScore: 8,
      riskQualityScore: 7,
      entryQualityScore: 9,
      managementQualityScore: 6,
      exitQualityScore: 8,
      reviewQualityScore: 7,
      totalScore: 45,
      gradeLabel: 'B',
      followedPlan: true,
      ruleViolation: false,
      gradeNotes: 'Good trade overall',
      initialRiskAmount: 500.00,
      accountRiskPct: 1.5,
      executionCount: 2,
      mistakeCount: 0,
      stopAdjustmentCount: 1,
    };

    const csv = exportTradesToCsv([trade]);

    // Check BOM prefix
    assert(csv.startsWith('\uFEFF'), 'single trade → BOM prefix present');

    // Split into rows
    const rows = csv.split('\n').filter((r) => r.length > 0);

    // First row is header (without BOM prefix for comparison)
    assert(rows.length === 2, 'single trade → 2 rows (header + data)');

    // Check that the data row has the same number of columns as CSV_COLUMNS
    const dataRowParts = rows[1].split(',');
    assert(
      dataRowParts.length === CSV_COLUMNS.length,
      `single trade → data row has ${CSV_COLUMNS.length} columns (got ${dataRowParts.length})`,
    );

    // Check specific values in the data row
    assert(rows[1].includes('T001'), 'single trade → contains tradeCode');
    assert(rows[1].includes('AAPL'), 'single trade → contains symbol');
    assert(rows[1].includes('closed'), 'single trade → contains status');
    assert(rows[1].includes('Breakout'), 'single trade → contains setup name');
    assert(rows[1].includes('Technology'), 'single trade → contains sector name');
  }

  // 3. Multiple trades produce multiple data rows
  {
    const trades: ExportTradeRow[] = [
      {
        tradeCode: 'T001', symbol: 'AAPL', direction: 'long', status: 'closed',
        setup: null, sector: null, marketCondition: null,
        thesis: null, invalidationCondition: null, preTradePlan: null, exitNotes: null, lesson: null,
        openedAt: null, closedAt: null, createdAt: null, updatedAt: null,
        realizedPnL: null, rMultiple: null, avgEntryPrice: null,
        totalEntryQty: null, totalExitQty: null, openQuantity: null, totalFees: null,
        setupQualityScore: null, riskQualityScore: null, entryQualityScore: null,
        managementQualityScore: null, exitQualityScore: null, reviewQualityScore: null,
        totalScore: null, gradeLabel: null, followedPlan: null, ruleViolation: null, gradeNotes: null,
        initialRiskAmount: null, accountRiskPct: null,
        executionCount: null, mistakeCount: null, stopAdjustmentCount: null,
      },
      {
        tradeCode: 'T002', symbol: 'GOOGL', direction: 'short', status: 'open',
        setup: null, sector: null, marketCondition: null,
        thesis: null, invalidationCondition: null, preTradePlan: null, exitNotes: null, lesson: null,
        openedAt: null, closedAt: null, createdAt: null, updatedAt: null,
        realizedPnL: null, rMultiple: null, avgEntryPrice: null,
        totalEntryQty: null, totalExitQty: null, openQuantity: null, totalFees: null,
        setupQualityScore: null, riskQualityScore: null, entryQualityScore: null,
        managementQualityScore: null, exitQualityScore: null, reviewQualityScore: null,
        totalScore: null, gradeLabel: null, followedPlan: null, ruleViolation: null, gradeNotes: null,
        initialRiskAmount: null, accountRiskPct: null,
        executionCount: null, mistakeCount: null, stopAdjustmentCount: null,
      },
    ];

    const csv = exportTradesToCsv(trades);
    const rows = csv.split('\n').filter((r) => r.startsWith('T'));
    assert(rows.length === 2, 'multiple trades → 2 data rows');
    assert(rows[0].startsWith('T001'), 'multiple trades → first row T001');
    assert(rows[1].startsWith('T002'), 'multiple trades → second row T002');
  }

  // 4. Commas and quotes in thesis/notes are properly escaped
  {
    const trade: ExportTradeRow = {
      tradeCode: 'T001', symbol: 'AAPL', direction: 'long', status: 'closed',
      setup: null, sector: null, marketCondition: null,
      thesis: 'Entry on breakout above $152.50, with stop at $149.00', // contains comma
      invalidationCondition: '"Below $145" is the key level', // contains quotes
      preTradePlan: 'Plan A:\nEnter at open\nPlan B:\nWait for pullback', // contains newlines
      exitNotes: null, lesson: null,
      openedAt: null, closedAt: null, createdAt: null, updatedAt: null,
      realizedPnL: null, rMultiple: null, avgEntryPrice: null,
      totalEntryQty: null, totalExitQty: null, openQuantity: null, totalFees: null,
      setupQualityScore: null, riskQualityScore: null, entryQualityScore: null,
      managementQualityScore: null, exitQualityScore: null, reviewQualityScore: null,
      totalScore: null, gradeLabel: null, followedPlan: null, ruleViolation: null, gradeNotes: null,
      initialRiskAmount: null, accountRiskPct: null,
      executionCount: null, mistakeCount: null, stopAdjustmentCount: null,
    };

    const csv = exportTradesToCsv([trade]);
    const csvWithoutBom = csv.replace('\uFEFF', '');

    // Count CSV data rows (handles multi-line quoted fields)
    // A data row starts after the header line or a line ending with a
    // complete (non-quoted-escaped) newline.
    function countCsvDataRows(csvBody: string): number {
      let rowCount = 0;
      let inQuotes = false;
      for (let i = 0; i < csvBody.length; i++) {
        const ch = csvBody[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === '\n' && !inQuotes) {
          // End of a logical row
          rowCount++;
        }
      }
      // If csvBody does not end with \n, count the last partial line
      if (csvBody.length > 0 && !csvBody.endsWith('\n')) {
        rowCount++;
      }
      return rowCount;
    }

    // 1 header row + 1 data row
    const totalRows = countCsvDataRows(csvWithoutBom);
    assert(totalRows === 2, 'special chars → header + 1 data row (got ' + totalRows + ')');

    // thesis contains a comma → field must be quoted
    assert(csv.includes('"Entry on breakout above $152.50, with stop at $149.00"'),
      'special chars → comma in thesis is quoted');

    // invalidationCondition contains double quotes → field must be quoted with escaped quotes
    assert(csv.includes('"""Below $145"" is the key level"'),
      'special chars → double quotes in invalidationCondition are escaped');

    // preTradePlan contains newlines → field must be quoted
    assert(csv.includes('"Plan A:'),
      'special chars → newlines in preTradePlan are quoted');
    assert(csv.includes('Wait for pullback"'),
      'special chars → multiline preTradePlan captured correctly');
  }

  // 5. UTF-8 BOM prefix is present
  {
    const trades: ExportTradeRow[] = [
      {
        tradeCode: 'T001', symbol: 'AAPL', direction: 'long', status: 'closed',
        setup: null, sector: null, marketCondition: null,
        thesis: null, invalidationCondition: null, preTradePlan: null, exitNotes: null, lesson: null,
        openedAt: null, closedAt: null, createdAt: null, updatedAt: null,
        realizedPnL: null, rMultiple: null, avgEntryPrice: null,
        totalEntryQty: null, totalExitQty: null, openQuantity: null, totalFees: null,
        setupQualityScore: null, riskQualityScore: null, entryQualityScore: null,
        managementQualityScore: null, exitQualityScore: null, reviewQualityScore: null,
        totalScore: null, gradeLabel: null, followedPlan: null, ruleViolation: null, gradeNotes: null,
        initialRiskAmount: null, accountRiskPct: null,
        executionCount: null, mistakeCount: null, stopAdjustmentCount: null,
      },
    ];

    const csv = exportTradesToCsv(trades);

    // Check BOM is the very first character
    assert(csv.charCodeAt(0) === 0xFEFF, 'BOM → first char code is 0xFEFF');

    // After BOM, the header row should start
    const afterBom = csv.substring(1);
    const headerLabels = CSV_COLUMNS.map((c) => c.label).join(',');
    assert(afterBom.startsWith(headerLabels), 'BOM → header follows immediately');
  }

  // 6. Null fields render as empty strings
  {
    const trade: ExportTradeRow = {
      tradeCode: 'T001', symbol: 'AAPL', direction: 'long', status: 'closed',
      setup: null, sector: null, marketCondition: null,
      thesis: null, invalidationCondition: null, preTradePlan: null, exitNotes: null, lesson: null,
      openedAt: null, closedAt: null, createdAt: null, updatedAt: null,
      realizedPnL: null, rMultiple: null, avgEntryPrice: null,
      totalEntryQty: null, totalExitQty: null, openQuantity: null, totalFees: null,
      setupQualityScore: null, riskQualityScore: null, entryQualityScore: null,
      managementQualityScore: null, exitQualityScore: null, reviewQualityScore: null,
      totalScore: null, gradeLabel: null, followedPlan: null, ruleViolation: null, gradeNotes: null,
      initialRiskAmount: null, accountRiskPct: null,
      executionCount: null, mistakeCount: null, stopAdjustmentCount: null,
    };

    const csv = exportTradesToCsv([trade]);

    // The data row should only have commas (no values between them)
    const csvWithoutBom = csv.replace('\uFEFF', '');
    const lines = csvWithoutBom.trim().split('\n');
    const dataRow = lines[1];

    // For a trade with all nulls, the data row should be all commas with the
    // first value (tradeCode T001) and second value (symbol AAPL) populated
    // since those are the only non-null fields
    const expectedColumns = CSV_COLUMNS.length;
    const parts = dataRow.split(',');
    assert(parts.length === expectedColumns, `null fields → ${expectedColumns} parts in data row`);

    // Check that non-null fields appear
    assert(parts[0] === 'T001', 'null fields → tradeCode is T001');
    assert(parts[1] === 'AAPL', 'null fields → symbol is AAPL');
    assert(parts[2] === 'long', 'null fields → direction is long');
    assert(parts[3] === 'closed', 'null fields → status is closed');

    // Check that null fields are empty string
    // Column index 4 is 'setup' — should be empty
    assert(parts[4] === '', 'null fields → setup is empty string');
  }

  // 7. Number formatting — financial values have 2 decimal places
  {
    const trade: ExportTradeRow = {
      tradeCode: 'T001', symbol: 'AAPL', direction: 'long', status: 'closed',
      setup: null, sector: null, marketCondition: null,
      plannedEntry: 150.5, plannedStop: 145, plannedTarget1: 165.75,
      thesis: null, invalidationCondition: null, preTradePlan: null, exitNotes: null, lesson: null,
      openedAt: null, closedAt: null, createdAt: null, updatedAt: null,
      realizedPnL: 1500, rMultiple: 3, avgEntryPrice: 150.5,
      totalEntryQty: 100, totalExitQty: 100, openQuantity: 0, totalFees: 4.5,
      setupQualityScore: 8, riskQualityScore: 7, entryQualityScore: 9,
      managementQualityScore: null, exitQualityScore: null, reviewQualityScore: null,
      totalScore: null, gradeLabel: null, followedPlan: null, ruleViolation: null, gradeNotes: null,
      initialRiskAmount: null, accountRiskPct: null,
      executionCount: null, mistakeCount: null, stopAdjustmentCount: null,
    };

    const csv = exportTradesToCsv([trade]);
    const csvWithoutBom = csv.replace('\uFEFF', '');
    const lines = csvWithoutBom.trim().split('\n');
    const header = lines[0].split(',');
    const dataRow = lines[1];
    const parts = dataRow.split(',');
    const valueFor = (label: string) => parts[header.indexOf(label)];

    assert(valueFor('Planned Entry') === '150.50', 'number format → plannedEntry is 150.50');
    assert(valueFor('Planned Stop') === '145.00', 'number format → plannedStop is 145.00');
    assert(valueFor('Planned Target 1') === '165.75', 'number format → plannedTarget1 is 165.75');
    assert(valueFor('Realized P&L') === '1500.00', 'number format → realizedPnL is 1500.00');
    assert(valueFor('R Multiple') === '3.00', 'number format → rMultiple is 3.00');
  }

  // 8. Boolean formatting — Yes/No instead of true/false
  {
    const trade: ExportTradeRow = {
      tradeCode: 'T001', symbol: 'AAPL', direction: 'long', status: 'closed',
      setup: null, sector: null, marketCondition: null,
      thesis: null, invalidationCondition: null, preTradePlan: null, exitNotes: null, lesson: null,
      openedAt: null, closedAt: null, createdAt: null, updatedAt: null,
      realizedPnL: null, rMultiple: null, avgEntryPrice: null,
      totalEntryQty: null, totalExitQty: null, openQuantity: null, totalFees: null,
      setupQualityScore: null, riskQualityScore: null, entryQualityScore: null,
      managementQualityScore: null, exitQualityScore: null, reviewQualityScore: null,
      totalScore: null, gradeLabel: null, followedPlan: true, ruleViolation: false, gradeNotes: null,
      initialRiskAmount: null, accountRiskPct: null,
      executionCount: null, mistakeCount: null, stopAdjustmentCount: null,
    };

    const csv = exportTradesToCsv([trade]);
    const csvWithoutBom = csv.replace('\uFEFF', '');
    const lines = csvWithoutBom.trim().split('\n');
    const dataRow = lines[1];
    const parts = dataRow.split(',');

    // Need to find which column indices correspond to followedPlan and ruleViolation
    const followedPlanIdx = CSV_COLUMNS.findIndex((c) => c.key === 'followedPlan');
    const ruleViolationIdx = CSV_COLUMNS.findIndex((c) => c.key === 'ruleViolation');

    assert(followedPlanIdx !== -1, 'bool format → found followedPlan column');
    assert(ruleViolationIdx !== -1, 'bool format → found ruleViolation column');

    assert(parts[followedPlanIdx] === 'Yes', 'bool format → followedPlan=true shows Yes');
    assert(parts[ruleViolationIdx] === 'No', 'bool format → ruleViolation=false shows No');
  }
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
