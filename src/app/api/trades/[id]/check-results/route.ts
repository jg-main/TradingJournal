import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeCheckResults, checklistDefinitions, tradeExecutions } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

type RouteParams = { params: Promise<{ id: string }> };

const backfillCheckResultsSchema = z.object({
  checkResults: z.array(z.object({
    checklistDefinitionId: z.string().min(1),
    passed: z.boolean(),
    comment: z.string().optional(),
  })).min(1),
});

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const trade = db.select().from(trades).where(eq(trades.id, id)).get();
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    const rows = db
      .select({
        id: tradeCheckResults.id,
        tradeId: tradeCheckResults.tradeId,
        checklistDefinitionId: tradeCheckResults.checklistDefinitionId,
        description: checklistDefinitions.description,
        // itemText is the immutable snapshot of the checklist description at
        // check time (F7); description is the current (possibly edited) text.
        itemText: tradeCheckResults.itemText,
        isRequired: checklistDefinitions.isRequired,
        passed: tradeCheckResults.passed,
        comment: tradeCheckResults.comment,
        checkedAt: tradeCheckResults.checkedAt,
        createdAt: tradeCheckResults.createdAt,
      })
      .from(tradeCheckResults)
      .innerJoin(
        checklistDefinitions,
        eq(checklistDefinitions.id, tradeCheckResults.checklistDefinitionId),
      )
      .where(eq(tradeCheckResults.tradeId, id))
      .orderBy(asc(tradeCheckResults.checkedAt), asc(tradeCheckResults.createdAt))
      .all();

    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch trade check results', details: String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/trades/:id/check-results
 *
 * Backfill checklist evidence for trades that filled before the checklist gate
 * existed (pre-gate fills have executions but no check results). Writes an
 * item-text snapshot from the live checklist definition at backfill time (F7).
 *
 * Guard rails:
 * - Trade must exist (404) and must have at least one execution (400) — there
 *   is nothing to backfill for a trade that never filled.
 * - Items that already have a check result are rejected (409) so historical
 *   evidence is never silently overwritten.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = backfillCheckResultsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const trade = db.select().from(trades).where(eq(trades.id, id)).get();
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    // Backfill is only meaningful for trades that actually filled.
    const executions = db
      .select()
      .from(tradeExecutions)
      .where(eq(tradeExecutions.tradeId, id))
      .all();
    if (executions.length === 0) {
      return NextResponse.json(
        { error: 'Cannot backfill check results for a trade with no executions' },
        { status: 400 },
      );
    }

    // Resolve live definitions — their descriptions become the item-text snapshot.
    const defsById = new Map<string, typeof checklistDefinitions.$inferSelect>();
    for (const cr of parsed.data.checkResults) {
      if (!defsById.has(cr.checklistDefinitionId)) {
        const def = db
          .select()
          .from(checklistDefinitions)
          .where(eq(checklistDefinitions.id, cr.checklistDefinitionId))
          .get();
        if (def) {
          defsById.set(cr.checklistDefinitionId, def);
        }
      }
    }

    const unknown = parsed.data.checkResults.filter((cr) => !defsById.has(cr.checklistDefinitionId));
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: {
            fieldErrors: {
              checklistDefinitionId: [
                `Unknown checklist definitions: ${unknown.map((u) => u.checklistDefinitionId).join(', ')}`,
              ],
            },
          },
        },
        { status: 400 },
      );
    }

    // Backfill is for missing evidence only — never overwrite existing results.
    const existing = db
      .select()
      .from(tradeCheckResults)
      .where(eq(tradeCheckResults.tradeId, id))
      .all();
    const existingIds = new Set(existing.map((r) => r.checklistDefinitionId));
    const alreadyRecorded = parsed.data.checkResults.filter((cr) =>
      existingIds.has(cr.checklistDefinitionId),
    );
    if (alreadyRecorded.length > 0) {
      return NextResponse.json(
        {
          error: 'Check results already exist for this trade',
          details: {
            checkResults: alreadyRecorded.map((cr) => cr.checklistDefinitionId),
          },
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const created = parsed.data.checkResults.map((cr) => {
      const def = defsById.get(cr.checklistDefinitionId);
      return db
        .insert(tradeCheckResults)
        .values({
          id: randomUUID(),
          tradeId: id,
          checklistDefinitionId: cr.checklistDefinitionId,
          itemText: def?.description ?? null,
          passed: cr.passed,
          comment: cr.comment ?? null,
          checkedAt: now,
          createdAt: now,
        })
        .returning()
        .get();
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to backfill trade check results', details: String(error) },
      { status: 500 },
    );
  }
}
