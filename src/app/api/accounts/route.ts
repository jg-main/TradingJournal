import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { accounts } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';

const createAccountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  broker: z.string().max(200).nullable().optional(),
  currency: z.string().min(1).max(3).default('USD'),
  isActive: z.boolean().optional().default(true),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  broker: z.string().max(200).nullable().optional(),
  currency: z.string().min(1).max(3).optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    const rows = db.select().from(accounts).orderBy(desc(accounts.createdAt)).all();
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch accounts', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createAccountSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.insert(accounts)
      .values({
        id,
        name: parsed.data.name,
        broker: parsed.data.broker ?? null,
        currency: parsed.data.currency,
        isActive: parsed.data.isActive,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create account', details: String(error) },
      { status: 500 }
    );
  }
}
