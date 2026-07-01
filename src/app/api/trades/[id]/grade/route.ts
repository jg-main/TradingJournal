import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeGrades } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { calculateGrade } from '@/lib/grading';

const upsertGradeSchema = z.object({
  setupScore: z.number().int().min(1).max(10),
  riskScore: z.number().int().min(1).max(10),
  entryScore: z.number().int().min(1).max(10),
  managementScore: z.number().int().min(1).max(10),
  exitScore: z.number().int().min(1).max(10),
  reviewScore: z.number().int().min(1).max(10),
  followedPlan: z.boolean().optional(),
  ruleViolation: z.boolean().optional(),
  notes: z.string().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const row = db
      .select()
      .from(tradeGrades)
      .where(eq(tradeGrades.tradeId, id))
      .get();

    if (!row) {
      return NextResponse.json(
        { error: 'Grade not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch grade', details: String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = upsertGradeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Check trade exists
    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    // Auto-calculate total score and grade label
    const { totalScore, gradeLabel } = calculateGrade({
      setupScore: parsed.data.setupScore,
      riskScore: parsed.data.riskScore,
      entryScore: parsed.data.entryScore,
      managementScore: parsed.data.managementScore,
      exitScore: parsed.data.exitScore,
      reviewScore: parsed.data.reviewScore,
    });

    const now = new Date().toISOString();

    // Upsert: onConflictDoUpdate targets the unique trade_id constraint
    db.insert(tradeGrades)
      .values({
        id: randomUUID(),
        tradeId: id,
        setupQualityScore: parsed.data.setupScore,
        riskQualityScore: parsed.data.riskScore,
        entryQualityScore: parsed.data.entryScore,
        managementQualityScore: parsed.data.managementScore,
        exitQualityScore: parsed.data.exitScore,
        reviewQualityScore: parsed.data.reviewScore,
        totalScore,
        gradeLabel,
        followedPlan: parsed.data.followedPlan ?? null,
        ruleViolation: parsed.data.ruleViolation ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tradeGrades.tradeId,
        set: {
          setupQualityScore: parsed.data.setupScore,
          riskQualityScore: parsed.data.riskScore,
          entryQualityScore: parsed.data.entryScore,
          managementQualityScore: parsed.data.managementScore,
          exitQualityScore: parsed.data.exitScore,
          reviewQualityScore: parsed.data.reviewScore,
          totalScore,
          gradeLabel,
          followedPlan: parsed.data.followedPlan ?? null,
          ruleViolation: parsed.data.ruleViolation ?? null,
          notes: parsed.data.notes ?? null,
          updatedAt: now,
        },
      })
      .run();

    // Fetch the row after upsert
    const row = db
      .select()
      .from(tradeGrades)
      .where(eq(tradeGrades.tradeId, id))
      .get();

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to upsert grade', details: String(error) },
      { status: 500 },
    );
  }
}
