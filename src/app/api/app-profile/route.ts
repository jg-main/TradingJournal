import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { appProfile, settings } from '@/db/schema';
import { reschedule, cronTimeToUTCExpression, isSchedulerActive } from '@/lib/scheduler';
import { runBackupJob } from '@/lib/backup-job';

const appProfileSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required'),
  timezone: z.string().trim().min(1).max(100),
  defaultCurrency: z.string().trim().min(1).max(3),
});

function getProfileRow() {
  return db.select().from(appProfile).limit(1).get();
}

export async function GET() {
  try {
    const row = getProfileRow();

    if (!row) {
      return NextResponse.json(
        { message: 'No app profile configured yet. Use PUT to create.' },
        { status: 200 },
      );
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch app profile', details: String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = appProfileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const existing = getProfileRow();
    const now = new Date().toISOString();

    if (!existing) {
      const id = crypto.randomUUID();
      db.insert(appProfile)
        .values({
          id,
          ...parsed.data,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const row = db.select().from(appProfile).where(eq(appProfile.id, id)).get();
      return NextResponse.json(row, { status: 201 });
    }

    db.update(appProfile)
      .set({
        ...parsed.data,
        updatedAt: now,
      })
      .where(eq(appProfile.id, existing.id))
      .run();

    // If the timezone changed and the scheduler is active, reschedule
    // the cron so backup times stay correct in the new timezone.
    if (parsed.data.timezone && parsed.data.timezone !== (existing.timezone ?? '')) {
      const schedRow = db.select().from(settings).limit(1).get();
      if (schedRow?.backupEnabled && isSchedulerActive()) {
        const cronTime = schedRow.backupCronTime ?? '02:00';
        reschedule(cronTimeToUTCExpression(cronTime, parsed.data.timezone), runBackupJob);
        console.log(
          `[app-profile] Timezone changed to "${parsed.data.timezone}" — rescheduled cron to keep "${cronTime}" local time`,
        );
      }
    }

    const row = db.select().from(appProfile).where(eq(appProfile.id, existing.id)).get();
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update app profile', details: String(error) },
      { status: 500 },
    );
  }
}
