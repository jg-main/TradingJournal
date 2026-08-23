import { NextRequest, NextResponse } from 'next/server';
import { db, getSqliteHandle } from '@/db';
import { settings, appProfile } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { startScheduler, stopScheduler, reschedule, cronTimeToUTCExpression } from '@/lib/scheduler';
import { runBackupJob } from '@/lib/backup-job';
import { assertAccountEligibleAsDefault } from '@/lib/accounting/default-account-guard';
import {
  AccountNotFoundError,
  AccountInactiveError,
  UnsupportedAccountCurrencyError,
} from '@/lib/accounting/errors';

const settingsSchema = z.object({
  startingAccountValue: z.number().positive('Must be positive').optional(),
  maxRiskPerTradePct: z.number().min(0).max(100).optional(),
  defaultCommission: z.number().min(0).optional(),
  defaultAccountId: z.string().uuid().nullable().optional(),
  currency: z.string().min(1).max(3).optional(),
  journalStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  backupEnabled: z.boolean().optional(),
  backupRetentionCount: z.number().int().min(1).optional(),
  backupLastRunAt: z.string().nullable().optional(),
  backupLastRunStatus: z.enum(['success', 'error']).nullable().optional(),
  backupCronTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM (24h format)').optional(),
});

export async function GET() {
  try {
    const row = db.select().from(settings).limit(1).get();
    if (!row) {
      return NextResponse.json(
        { message: 'No settings configured yet. Use PUT to create.' },
        { status: 200 }
      );
    }
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch settings', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = settingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = db.select().from(settings).limit(1).get();
    const now = new Date().toISOString();

    // A8 default-account lifecycle validation: when the request carries a
    // non-null defaultAccountId, the referenced account must exist, be
    // ACTIVE, and use a supported currency (USD). null clears the default.
    // The API remains authoritative — direct requests cannot persist an
    // invalid default. Validation happens before any settings mutation.
    if (parsed.data.defaultAccountId !== undefined && parsed.data.defaultAccountId !== null) {
      try {
        assertAccountEligibleAsDefault(getSqliteHandle(), parsed.data.defaultAccountId);
      } catch (error) {
        if (error instanceof AccountNotFoundError) {
          return NextResponse.json(
            {
              error: 'Default account not found',
              details: error.message,
            },
            { status: 404 },
          );
        }
        if (error instanceof AccountInactiveError) {
          return NextResponse.json(
            {
              error: 'Account is inactive',
              code: error.code,
              details: error.message,
            },
            { status: 409 },
          );
        }
        if (error instanceof UnsupportedAccountCurrencyError) {
          return NextResponse.json(
            {
              error: error.message,
              details: {
                accountId: error.accountId,
                currency: error.currency,
              },
            },
            { status: 400 },
          );
        }
        throw error;
      }
    }

    if (!existing) {
      const id = crypto.randomUUID();
      db.insert(settings)
        .values({ id, ...parsed.data, createdAt: now, updatedAt: now })
        .run();

      const row = db.select().from(settings).where(eq(settings.id, id)).get();
      return NextResponse.json(row, { status: 201 });
    }

    db.update(settings)
      .set({ ...parsed.data, updatedAt: now })
      .where(eq(settings.id, existing.id))
      .run();

    const row = db.select().from(settings).where(eq(settings.id, existing.id)).get();

    // ── Scheduler lifecycle ──────────────────────────────────────────
    // Determine the effective cron time: use the new value if provided,
    // otherwise fall back to existing or default.
    const cronTime = parsed.data.backupCronTime ?? existing.backupCronTime ?? '02:00';

    // Read the user's configured timezone from app_profile
    const profileRow = db.select().from(appProfile).limit(1).get();
    const timezone = profileRow?.timezone ?? 'America/Bogota';

    if (parsed.data.backupEnabled !== undefined) {
      const wasEnabled = existing.backupEnabled ?? false;
      const nowEnabled = parsed.data.backupEnabled;
      if (nowEnabled && !wasEnabled) {
        // Backup was disabled, now enabled → start scheduler
        startScheduler(cronTimeToUTCExpression(cronTime, timezone), runBackupJob);
      } else if (!nowEnabled && wasEnabled) {
        // Backup was enabled, now disabled → stop scheduler
        stopScheduler();
      }
    } else if (parsed.data.backupCronTime !== undefined && (existing.backupEnabled ?? false)) {
      // Cron time changed while scheduler is active → reschedule
      reschedule(cronTimeToUTCExpression(cronTime, timezone), runBackupJob);
    }

    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update settings', details: String(error) },
      { status: 500 }
    );
  }
}
