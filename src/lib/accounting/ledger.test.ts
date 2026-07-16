/**
 * Tests for the pure ledger projection/adapter.
 *
 * Pure function tests — no database, no Next.js.
 * All input data is plain objects matching the LedgerEventInput / LedgerEntryInput / etc. shapes.
 *
 * @module ledger.test
 */

import { describe, it, expect } from 'vitest';
import {
  buildLedgerProjection,
  EVENT_CATEGORIES,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type LedgerEventInput,
  type LedgerEntryInput,
  type LedgerPostingInput,
  type CorrectionGroupInput,
  type LedgerProjectionInput,
} from './ledger';

// ── Shared Constants ─────────────────────────────────────────────────────

const ACCOUNT_ID = 'acc-test-001';

// ── Fixture Helpers ──────────────────────────────────────────────────────

function event(
  id: string,
  overrides?: Partial<LedgerEventInput>,
): LedgerEventInput {
  return {
    id,
    account_id: ACCOUNT_ID,
    event_type: 'deposit',
    idempotency_key: null,
    description: null,
    payload: null,
    effect: null,
    posted_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function entry(
  id: string,
  financialEventId: string,
  overrides?: Partial<LedgerEntryInput>,
): LedgerEntryInput {
  return {
    id,
    financial_event_id: financialEventId,
    account_id: ACCOUNT_ID,
    description: null,
    posted_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function posting(
  id: string,
  ledgerEntryId: string,
  side: 'debit' | 'credit',
  amount: string,
  amountMicros: number,
  overrides?: Partial<LedgerPostingInput>,
): LedgerPostingInput {
  return {
    id,
    ledger_entry_id: ledgerEntryId,
    account_id: ACCOUNT_ID,
    side,
    amount,
    amount_micros: amountMicros,
    currency: 'USD',
    sequence: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Build a balanced pair of debit/credit postings for an entry.
 */
function balancedPostings(entryId: string, amount: string, micros: number): [LedgerPostingInput, LedgerPostingInput] {
  return [
    posting('p-debit-' + entryId, entryId, 'debit', amount, micros, { sequence: 1 }),
    posting('p-credit-' + entryId, entryId, 'credit', amount, micros, { sequence: 2 }),
  ];
}

/**
 * Effect JSON for a cash-increase event.
 */
function cashIncreaseEffect(amount: string, micros: number): string {
  return JSON.stringify({ kind: 'cash', direction: 'increase', amount, amountMicros: micros });
}

/**
 * Effect JSON for a cash-decrease event.
 */
function cashDecreaseEffect(amount: string, micros: number): string {
  return JSON.stringify({ kind: 'cash', direction: 'decrease', amount, amountMicros: micros });
}

/**
 * Effect JSON for a market (non-cash) event.
 */
function marketEffect(symbol: string): string {
  return JSON.stringify({ kind: 'market', symbol, details: 'stock split' });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Fixtures: Full mixed set
// ═══════════════════════════════════════════════════════════════════════════

// ── Events ───────────────────────────────────────────────────────────────

const EVT_OPENING = event('evt-ob-001', {
  event_type: 'opening_balance',
  description: 'Opening balance for account',
  effect: cashIncreaseEffect('100000.00', 100_000_000_000),
  posted_at: '2026-01-01T00:00:00.000Z',
});

const EVT_DEPOSIT = event('evt-dep-001', {
  event_type: 'deposit',
  description: 'Initial deposit',
  effect: cashIncreaseEffect('50000.00', 50_000_000_000),
  posted_at: '2026-01-02T10:00:00.000Z',
});

const EVT_TRADE_ORIGINAL = event('evt-trade-orig-001', {
  event_type: 'trade_execution',
  description: 'Buy 100 AAPL @ 150.00',
  effect: cashDecreaseEffect('15015.00', 15_015_000_000),
  posted_at: '2026-07-14T10:00:00.000Z',
});

const EVT_TRADE_REVERSAL = event('evt-trade-rev-001', {
  event_type: 'trade_execution',
  description: 'Correction reversal: Sell 100 AAPL @ 150.00',
  effect: cashIncreaseEffect('15015.00', 15_015_000_000),
  posted_at: '2026-07-15T14:00:00.000Z',
});

const EVT_TRADE_REPLACEMENT = event('evt-trade-repl-001', {
  event_type: 'trade_execution',
  description: 'Corrected: Buy 50 AAPL @ 150.00',
  effect: cashDecreaseEffect('7507.50', 7_507_500_000),
  posted_at: '2026-07-15T14:00:01.000Z',
});

const EVT_TRADE_UNCHANGED = event('evt-trade-uncorr-001', {
  event_type: 'trade_execution',
  description: 'Buy 200 MSFT @ 300.00',
  effect: cashDecreaseEffect('60030.00', 60_030_000_000),
  posted_at: '2026-07-16T10:00:00.000Z',
});

const EVT_DIVIDEND = event('evt-div-001', {
  event_type: 'dividend',
  description: 'AAPL dividend',
  effect: cashIncreaseEffect('50.00', 50_000_000),
  posted_at: '2026-07-17T09:00:00.000Z',
});

const EVT_FEE = event('evt-fee-001', {
  event_type: 'fee',
  description: 'Monthly platform fee',
  effect: cashDecreaseEffect('25.00', 25_000_000),
  posted_at: '2026-07-18T00:00:00.000Z',
});

const EVT_STOCK_SPLIT = event('evt-split-001', {
  event_type: 'stock_split',
  description: 'AAPL 4:1 stock split',
  effect: marketEffect('AAPL'),
  posted_at: '2026-07-19T00:00:00.000Z',
});

// ── Entries ──────────────────────────────────────────────────────────────

const ENTRY_OPENING = entry('entry-ob-001', EVT_OPENING.id, {
  posted_at: EVT_OPENING.posted_at,
});

const ENTRY_DEPOSIT = entry('entry-dep-001', EVT_DEPOSIT.id, {
  posted_at: EVT_DEPOSIT.posted_at,
});

const ENTRY_TRADE_ORIG = entry('entry-trade-orig-001', EVT_TRADE_ORIGINAL.id, {
  posted_at: EVT_TRADE_ORIGINAL.posted_at,
});

const ENTRY_TRADE_REV = entry('entry-trade-rev-001', EVT_TRADE_REVERSAL.id, {
  posted_at: EVT_TRADE_REVERSAL.posted_at,
});

const ENTRY_TRADE_REPL = entry('entry-trade-repl-001', EVT_TRADE_REPLACEMENT.id, {
  posted_at: EVT_TRADE_REPLACEMENT.posted_at,
});

const ENTRY_TRADE_UNCORR = entry('entry-trade-uncorr-001', EVT_TRADE_UNCHANGED.id, {
  posted_at: EVT_TRADE_UNCHANGED.posted_at,
});

const ENTRY_DIVIDEND = entry('entry-div-001', EVT_DIVIDEND.id, {
  posted_at: EVT_DIVIDEND.posted_at,
});

const ENTRY_FEE = entry('entry-fee-001', EVT_FEE.id, {
  posted_at: EVT_FEE.posted_at,
});

const ENTRY_SPLIT = entry('entry-split-001', EVT_STOCK_SPLIT.id, {
  posted_at: EVT_STOCK_SPLIT.posted_at,
});

// ── Postings ─────────────────────────────────────────────────────────────

const ALL_POSTINGS: LedgerPostingInput[] = [
  ...balancedPostings(ENTRY_OPENING.id, '100000.00', 100_000_000_000),
  ...balancedPostings(ENTRY_DEPOSIT.id, '50000.00', 50_000_000_000),
  ...balancedPostings(ENTRY_TRADE_ORIG.id, '15015.00', 15_015_000_000),
  ...balancedPostings(ENTRY_TRADE_REV.id, '15015.00', 15_015_000_000),
  ...balancedPostings(ENTRY_TRADE_REPL.id, '7507.50', 7_507_500_000),
  ...balancedPostings(ENTRY_TRADE_UNCORR.id, '60030.00', 60_030_000_000),
  ...balancedPostings(ENTRY_DIVIDEND.id, '50.00', 50_000_000),
  ...balancedPostings(ENTRY_FEE.id, '25.00', 25_000_000),
  ...balancedPostings(ENTRY_SPLIT.id, '0.00', 0),
];

// ── Correction Group ─────────────────────────────────────────────────────

const CORRECTION_GROUP: CorrectionGroupInput = {
  correctionId: 'grouped-corr-001',
  originalEventId: EVT_TRADE_ORIGINAL.id,
  reversalEventId: EVT_TRADE_REVERSAL.id,
  replacementEventId: EVT_TRADE_REPLACEMENT.id,
  reason: 'Wrong quantity entered — corrected from 100 to 50',
  correctedAt: '2026-07-15T14:00:00.000Z',
};

// ── Full Input ───────────────────────────────────────────────────────────

const FULL_INPUT: LedgerProjectionInput = {
  events: [
    EVT_OPENING,
    EVT_DEPOSIT,
    EVT_TRADE_ORIGINAL,
    EVT_TRADE_REVERSAL,
    EVT_TRADE_REPLACEMENT,
    EVT_TRADE_UNCHANGED,
    EVT_DIVIDEND,
    EVT_FEE,
    EVT_STOCK_SPLIT,
  ],
  entries: [
    ENTRY_OPENING,
    ENTRY_DEPOSIT,
    ENTRY_TRADE_ORIG,
    ENTRY_TRADE_REV,
    ENTRY_TRADE_REPL,
    ENTRY_TRADE_UNCORR,
    ENTRY_DIVIDEND,
    ENTRY_FEE,
    ENTRY_SPLIT,
  ],
  postings: ALL_POSTINGS,
  correctionGroups: [CORRECTION_GROUP],
};

// ═══════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('buildLedgerProjection', () => {
  describe('deterministic ordering', () => {
    it('returns events sorted by posted_at ASC, eventId ASC', () => {
      const result = buildLedgerProjection(FULL_INPUT);

      // Verify ordering
      for (let i = 1; i < result.events.length; i++) {
        const prev = result.events[i - 1];
        const curr = result.events[i];
        const dateCmp = prev.postedAt.localeCompare(curr.postedAt);
        expect(
          dateCmp < 0 || (dateCmp === 0 && prev.eventId.localeCompare(curr.eventId) < 0),
        ).toBe(true);
      }
    });

    it('produces deterministic output from same input', () => {
      const result1 = buildLedgerProjection(FULL_INPUT);
      const result2 = buildLedgerProjection(FULL_INPUT);
      expect(result1.events).toEqual(result2.events);
    });
  });

  describe('correction grouping', () => {
    it('collapses correction triple to one display row', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const eventIds = result.events.map((r) => r.eventId);

      // The 3 correction constituent event IDs should NOT appear in the primary list
      expect(eventIds).not.toContain(EVT_TRADE_ORIGINAL.id);
      expect(eventIds).not.toContain(EVT_TRADE_REVERSAL.id);
      expect(eventIds).not.toContain(EVT_TRADE_REPLACEMENT.id);

      // Instead, the grouped correction row should appear
      expect(eventIds).toContain(CORRECTION_GROUP.correctionId);
    });

    it('includes full correction group metadata on the grouped row', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const corrRow = result.events.find(
        (r) => r.eventId === CORRECTION_GROUP.correctionId,
      );
      expect(corrRow).toBeDefined();
      expect(corrRow!.correctionGroup).not.toBeNull();
      expect(corrRow!.correctionGroup!.correctionId).toBe(CORRECTION_GROUP.correctionId);
      expect(corrRow!.correctionGroup!.originalEventId).toBe(EVT_TRADE_ORIGINAL.id);
      expect(corrRow!.correctionGroup!.reversalEventId).toBe(EVT_TRADE_REVERSAL.id);
      expect(corrRow!.correctionGroup!.replacementEventId).toBe(EVT_TRADE_REPLACEMENT.id);
      expect(corrRow!.correctionGroup!.reason).toBe(CORRECTION_GROUP.reason);
      expect(corrRow!.correctionGroup!.correctedAt).toBe(CORRECTION_GROUP.correctedAt);
    });

    it('uses replacement event display data for the correction row', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const corrRow = result.events.find(
        (r) => r.eventId === CORRECTION_GROUP.correctionId,
      );
      expect(corrRow).toBeDefined();
      // Should use the replacement event's data
      expect(corrRow!.description).toBe(EVT_TRADE_REPLACEMENT.description);
      expect(corrRow!.cashImpact).toBe(
        cashDecreaseEffect('7507.50', 7_507_500_000).startsWith('{"kind":"cash","direction":"decrease"')
          ? '-7507.50'
          : '-7507.50',
      );
    });

    it('non-correction events have null correctionGroup', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const nonCorrRows = result.events.filter((r) => r.eventId !== CORRECTION_GROUP.correctionId);
      for (const row of nonCorrRows) {
        expect(row.correctionGroup).toBeNull();
      }
    });
  });

  describe('duplicate protection', () => {
    it('deduplicates when same event ID appears multiple times in input', () => {
      const dupInput: LedgerProjectionInput = {
        events: [EVT_OPENING, EVT_DEPOSIT, EVT_OPENING, EVT_DEPOSIT],
        entries: [ENTRY_OPENING, ENTRY_DEPOSIT],
        postings: [
          ...balancedPostings(ENTRY_OPENING.id, '100000.00', 100_000_000_000),
          ...balancedPostings(ENTRY_DEPOSIT.id, '50000.00', 50_000_000_000),
        ],
        correctionGroups: [],
      };

      const result = buildLedgerProjection(dupInput);
      expect(result.total).toBe(2);
      const ids = result.events.map((r) => r.eventId);
      expect(ids.filter((id) => id === EVT_OPENING.id).length).toBe(1);
      expect(ids.filter((id) => id === EVT_DEPOSIT.id).length).toBe(1);
    });
  });

  describe('event-type filtering', () => {
    it('returns all events when no filter is provided', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      // 9 events in - 3 correction constituents + 1 correction group row = 7 display rows
      expect(result.total).toBe(7);
    });

    it('filters to specific event types', () => {
      const result = buildLedgerProjection(FULL_INPUT, {
        eventTypes: ['deposit'],
      });
      expect(result.total).toBe(1);
      expect(result.events[0].eventType).toBe('deposit');
    });

    it('filters to multiple event types', () => {
      const result = buildLedgerProjection(FULL_INPUT, {
        eventTypes: ['deposit', 'fee'],
      });
      expect(result.total).toBe(2);
    });

    it('returns empty for non-matching filter', () => {
      const result = buildLedgerProjection(FULL_INPUT, {
        eventTypes: ['withdrawal'],
      });
      expect(result.total).toBe(0);
      expect(result.events).toEqual([]);
    });

    it('filters correction grouped rows by event type', () => {
      const result = buildLedgerProjection(FULL_INPUT, {
        eventTypes: ['trade_execution'],
      });
      // Should include: EVT_TRADE_UNCORR (primary) + correction group row
      expect(result.total).toBe(2);
      expect(result.events.some((r) => r.eventId === CORRECTION_GROUP.correctionId)).toBe(true);
      expect(result.events.some((r) => r.eventId === EVT_TRADE_UNCHANGED.id)).toBe(true);
    });
  });

  describe('pagination', () => {
    it('returns all rows on page 1 with default limit', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(DEFAULT_PAGE_LIMIT);
      expect(result.totalPages).toBe(1);
      expect(result.events.length).toBe(result.total);
    });

    it('paginates correctly with small limit', () => {
      const result = buildLedgerProjection(FULL_INPUT, {
        page: 1,
        limit: 2,
      });
      expect(result.events.length).toBe(2);
      expect(result.total).toBe(7);
      expect(result.totalPages).toBe(4);
    });

    it('returns correct page 2 rows', () => {
      const result = buildLedgerProjection(FULL_INPUT, {
        page: 2,
        limit: 2,
      });
      expect(result.events.length).toBe(2);
      expect(result.page).toBe(2);
    });

    it('clamps limit to MAX_PAGE_LIMIT', () => {
      const result = buildLedgerProjection(FULL_INPUT, {
        limit: 9999,
      });
      expect(result.limit).toBe(MAX_PAGE_LIMIT);
    });

    it('clamps limit to minimum 1', () => {
      const result = buildLedgerProjection(FULL_INPUT, {
        limit: 0,
      });
      expect(result.limit).toBe(1);
    });

    it('clamps page to minimum 1', () => {
      const result = buildLedgerProjection(FULL_INPUT, {
        page: -5,
      });
      expect(result.page).toBe(1);
    });

    it('returns empty page for out-of-range page', () => {
      const result = buildLedgerProjection(FULL_INPUT, {
        page: 999,
      });
      expect(result.events).toEqual([]);
      expect(result.page).toBe(999);
    });
  });

  describe('cash impact', () => {
    it('returns positive cash impact for increase events', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const depositRow = result.events.find((r) => r.eventId === EVT_DEPOSIT.id);
      expect(depositRow!.cashImpact).toBe('50000.00');
    });

    it('returns negative cash impact for decrease events', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const feeRow = result.events.find((r) => r.eventId === EVT_FEE.id);
      expect(feeRow!.cashImpact).toBe('-25.00');
    });

    it('returns null cash impact for non-cash events', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const splitRow = result.events.find((r) => r.eventId === EVT_STOCK_SPLIT.id);
      expect(splitRow!.cashImpact).toBeNull();
    });

    it('returns null cash impact when effect is null', () => {
      const noEffectInput: LedgerProjectionInput = {
        events: [event('evt-no-effect', { effect: null })],
        entries: [],
        postings: [],
        correctionGroups: [],
      };
      const result = buildLedgerProjection(noEffectInput);
      expect(result.events[0].cashImpact).toBeNull();
    });

    it('returns null cash impact for unparseable effect JSON', () => {
      const badEffectInput: LedgerProjectionInput = {
        events: [event('evt-bad-effect', { effect: '{invalid json'} )],
        entries: [],
        postings: [],
        correctionGroups: [],
      };
      const result = buildLedgerProjection(badEffectInput);
      expect(result.events[0].cashImpact).toBeNull();
    });
  });

  describe('event status', () => {
    it('shows posted status for events with entries and postings', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const depositRow = result.events.find((r) => r.eventId === EVT_DEPOSIT.id);
      expect(depositRow!.status.hasEntry).toBe(true);
      expect(depositRow!.status.isBalanced).toBe(true);
      expect(depositRow!.status.postingCount).toBe(2); // debit + credit
    });

    it('shows unposted status for events without entries', () => {
      const noEntryInput: LedgerProjectionInput = {
        events: [event('evt-unposted', {
          event_type: 'fee',
          description: 'Unposted fee',
          effect: cashDecreaseEffect('10.00', 10_000_000),
        })],
        entries: [],
        postings: [],
        correctionGroups: [],
      };
      const result = buildLedgerProjection(noEntryInput);
      expect(result.events[0].status.hasEntry).toBe(false);
      expect(result.events[0].status.isBalanced).toBe(false);
      expect(result.events[0].status.postingCount).toBe(0);
    });

    it('shows postingCount from the provided postings array', () => {
      const entryId = 'entry-extra-post';
      const threePostings: LedgerPostingInput[] = [
        posting('p1', entryId, 'debit', '100.00', 100_000_000),
        posting('p2', entryId, 'credit', '50.00', 50_000_000),
        posting('p3', entryId, 'credit', '50.00', 50_000_000),
      ];
      const multiPostInput: LedgerProjectionInput = {
        events: [event('evt-multi-post', {
          event_type: 'fee',
          effect: cashDecreaseEffect('100.00', 100_000_000),
        })],
        entries: [entry(entryId, 'evt-multi-post')],
        postings: threePostings,
        correctionGroups: [],
      };
      const result = buildLedgerProjection(multiPostInput);
      expect(result.events[0].status.postingCount).toBe(3);
    });
  });

  describe('empty states', () => {
    it('returns empty response for no events', () => {
      const emptyInput: LedgerProjectionInput = {
        events: [],
        entries: [],
        postings: [],
        correctionGroups: [],
      };
      const result = buildLedgerProjection(emptyInput);
      expect(result.events).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('category mapping', () => {
    it('maps all known event types to correct categories', () => {
      // Verify all EVENT_CATEGORIES have valid mappings
      expect(EVENT_CATEGORIES['opening_balance']).toBe('Opening Balance');
      expect(EVENT_CATEGORIES['deposit']).toBe('Cash');
      expect(EVENT_CATEGORIES['withdrawal']).toBe('Cash');
      expect(EVENT_CATEGORIES['dividend']).toBe('Cash');
      expect(EVENT_CATEGORIES['interest']).toBe('Cash');
      expect(EVENT_CATEGORIES['fee']).toBe('Fee/Tax');
      expect(EVENT_CATEGORIES['tax']).toBe('Fee/Tax');
      expect(EVENT_CATEGORIES['trade_execution']).toBe('Trade');
      expect(EVENT_CATEGORIES['adjustment']).toBe('Adjustment');
      expect(EVENT_CATEGORIES['transfer']).toBe('Transfer');
      expect(EVENT_CATEGORIES['stock_split']).toBe('Corporate Action');
      expect(EVENT_CATEGORIES['manual_adjustment']).toBe('Adjustment');
    });

    it('assigns correct categories to events', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const openingRow = result.events.find((r) => r.eventId === EVT_OPENING.id);
      expect(openingRow!.category).toBe('Opening Balance');

      const depositRow = result.events.find((r) => r.eventId === EVT_DEPOSIT.id);
      expect(depositRow!.category).toBe('Cash');

      const tradeRow = result.events.find((r) => r.eventId === EVT_TRADE_UNCHANGED.id);
      expect(tradeRow!.category).toBe('Trade');

      const feeRow = result.events.find((r) => r.eventId === EVT_FEE.id);
      expect(feeRow!.category).toBe('Fee/Tax');

      const splitRow = result.events.find((r) => r.eventId === EVT_STOCK_SPLIT.id);
      expect(splitRow!.category).toBe('Corporate Action');
    });
  });

  describe('posting pair building', () => {
    it('returns posting pair with debit and credit for balanced entries', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const feeRow = result.events.find((r) => r.eventId === EVT_FEE.id);
      expect(feeRow!.postings).not.toBeNull();
      expect(feeRow!.postings!.debit.side).toBe('debit');
      expect(feeRow!.postings!.credit.side).toBe('credit');
    });

    it('returns null postings when no postings exist', () => {
      const result = buildLedgerProjection({
        events: [event('evt-no-post', { effect: cashIncreaseEffect('100.00', 100_000_000) })],
        entries: [],
        postings: [],
        correctionGroups: [],
      });
      expect(result.events[0].postings).toBeNull();
    });
  });

  describe('idempotency keys', () => {
    it('preserves idempotency keys on rows that have them', () => {
      const key = 'idem-key-001';
      const input: LedgerProjectionInput = {
        events: [event('evt-with-key', {
          event_type: 'deposit',
          idempotency_key: key,
          effect: cashIncreaseEffect('100.00', 100_000_000),
        })],
        entries: [],
        postings: [],
        correctionGroups: [],
      };
      const result = buildLedgerProjection(input);
      expect(result.events[0].idempotencyKey).toBe(key);
    });

    it('returns null idempotencyKey when not set', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const openingRow = result.events.find((r) => r.eventId === EVT_OPENING.id);
      expect(openingRow!.idempotencyKey).toBeNull();
    });
  });

  describe('sorted row positions', () => {
    it('renders events in chronological order with correction grouped row at correct position', () => {
      const result = buildLedgerProjection(FULL_INPUT);
      const orderedIds = result.events.map((r) => r.eventId);

      // Expected order:
      // EVT_OPENING    2026-01-01
      // EVT_DEPOSIT    2026-01-02
      // correction     2026-07-15 (replacement timestamp)
      // EVT_TRADE_UNCORR 2026-07-16
      // EVT_DIVIDEND   2026-07-17
      // EVT_FEE        2026-07-18
      // EVT_STOCK_SPLIT 2026-07-19
      const openingIdx = orderedIds.indexOf(EVT_OPENING.id);
      const depositIdx = orderedIds.indexOf(EVT_DEPOSIT.id);
      const corrIdx = orderedIds.indexOf(CORRECTION_GROUP.correctionId);
      const tradeIdx = orderedIds.indexOf(EVT_TRADE_UNCHANGED.id);
      const divIdx = orderedIds.indexOf(EVT_DIVIDEND.id);
      const feeIdx = orderedIds.indexOf(EVT_FEE.id);
      const splitIdx = orderedIds.indexOf(EVT_STOCK_SPLIT.id);

      expect(openingIdx).toBeLessThan(depositIdx);
      expect(depositIdx).toBeLessThan(corrIdx);
      expect(corrIdx).toBeLessThan(tradeIdx);
      expect(tradeIdx).toBeLessThan(divIdx);
      expect(divIdx).toBeLessThan(feeIdx);
      expect(feeIdx).toBeLessThan(splitIdx);
    });
  });

  describe('focused page response', () => {
    it('returns correct totalPages for exact division', () => {
      const result = buildLedgerProjection(FULL_INPUT, { limit: 1 });
      expect(result.totalPages).toBe(7);
    });

    it('returns correct totalPages for uneven division', () => {
      const result = buildLedgerProjection(FULL_INPUT, { limit: 3 });
      expect(result.totalPages).toBe(3); // 7 / 3 = 2.33 → ceil → 3
    });
  });
});
