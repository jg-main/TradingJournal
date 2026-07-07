import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { checklistDefinitions } from '@/db/schema';
import { and, isNull, asc, or, eq } from 'drizzle-orm';
import { z } from 'zod';

const mergedQuerySchema = z.object({
  accountId: z.string().min(1, 'accountId is required'),
  setupId: z.string().min(1, 'setupId is required'),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = Object.fromEntries(searchParams.entries());
    const parsed = mergedQuerySchema.safeParse(rawQuery);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { accountId, setupId } = parsed.data;

    const rows = db
      .select()
      .from(checklistDefinitions)
      .where(
        and(
          or(
            eq(checklistDefinitions.accountId, accountId),
            eq(checklistDefinitions.setupId, setupId),
          ),
          isNull(checklistDefinitions.deletedAt),
        ),
      )
      .orderBy(asc(checklistDefinitions.sortOrder), asc(checklistDefinitions.createdAt))
      .all();

    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch merged checklist', details: String(error) },
      { status: 500 },
    );
  }
}
