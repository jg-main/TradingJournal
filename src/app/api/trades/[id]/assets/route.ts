import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { trades, tradeAssets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { cwd } from 'node:process';

const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

const ASSET_TYPE = ['screenshot', 'document', 'link', 'image', 'other'] as const;
const PHASE = ['pre_trade', 'entry', 'management', 'exit', 'review'] as const;

const createAssetSchema = z.object({
  assetType: z.enum(ASSET_TYPE),
  phase: z.enum(PHASE),
  label: z.string().nullable().optional(),
  externalUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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

    const assets = db
      .select()
      .from(tradeAssets)
      .where(eq(tradeAssets.tradeId, id))
      .orderBy(tradeAssets.createdAt)
      .all();

    return NextResponse.json(assets);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch assets', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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

    const contentType = request.headers.get('content-type') || '';

    // ── FormData / File upload path ──────────────────────────────

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const phase = formData.get('phase') as string | null;
      const label = formData.get('label') as string | null;
      const notes = formData.get('notes') as string | null;

      if (!file) {
        return NextResponse.json(
          { error: 'File is required for upload', details: { fieldErrors: { file: ['File field is required'] } } },
          { status: 400 },
        );
      }

      if (!phase || !PHASE.includes(phase as any)) {
        return NextResponse.json(
          { error: 'Validation failed', details: { fieldErrors: { phase: [`Phase must be one of: ${PHASE.join(', ')}`] } } },
          { status: 400 },
        );
      }

      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return NextResponse.json(
          {
            error: 'Invalid file type',
            details: {
              fieldErrors: {
                file: [`Unsupported file type "${file.type}". Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`],
              },
            },
          },
          { status: 400 },
        );
      }

      const ext = extname(file.name) || '.png';
      const uniqueName = `${randomUUID()}${ext}`;
      const uploadDir = join(cwd(), 'public', 'uploads', 'trades');
      const filePath = join(uploadDir, uniqueName);

      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer);

      const assetId = randomUUID();
      const now = new Date().toISOString();

      db.insert(tradeAssets)
        .values({
          id: assetId,
          tradeId: id,
          assetType: 'screenshot',
          phase: phase as any,
          label: label ?? null,
          filePath: `/uploads/trades/${uniqueName}`,
          externalUrl: null,
          notes: notes ?? null,
          createdAt: now,
        })
        .run();

      const created = db
        .select()
        .from(tradeAssets)
        .where(eq(tradeAssets.id, assetId))
        .get();

      return NextResponse.json(created, { status: 201 });
    }

    // ── JSON body path ───────────────────────────────────────────

    const body = await request.json();
    const parsed = createAssetSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // If assetType is "link", externalUrl is required
    if (parsed.data.assetType === 'link' && !parsed.data.externalUrl) {
      return NextResponse.json(
        { error: 'Validation failed', details: { fieldErrors: { externalUrl: ['External URL is required for link type'] } } },
        { status: 400 },
      );
    }

    // If assetType is "screenshot" without file upload, externalUrl is not applicable
    if (parsed.data.assetType === 'screenshot' && parsed.data.externalUrl) {
      return NextResponse.json(
        { error: 'Validation failed', details: { fieldErrors: { externalUrl: ['Screenshot type does not accept externalUrl; use file upload instead'] } } },
        { status: 400 },
      );
    }

    const assetId = randomUUID();
    const now = new Date().toISOString();

    db.insert(tradeAssets)
      .values({
        id: assetId,
        tradeId: id,
        assetType: parsed.data.assetType,
        phase: parsed.data.phase,
        label: parsed.data.label ?? null,
        filePath: null,
        externalUrl: parsed.data.externalUrl ?? null,
        notes: parsed.data.notes ?? null,
        createdAt: now,
      })
      .run();

    const created = db
      .select()
      .from(tradeAssets)
      .where(eq(tradeAssets.id, assetId))
      .get();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create asset', details: String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: tradeId } = await params;
    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get('id');

    if (!assetId) {
      return NextResponse.json(
        { error: 'Asset id query parameter is required' },
        { status: 400 },
      );
    }

    const trade = db
      .select()
      .from(trades)
      .where(eq(trades.id, tradeId))
      .get();

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 },
      );
    }

    const asset = db
      .select()
      .from(tradeAssets)
      .where(eq(tradeAssets.id, assetId))
      .get();

    if (!asset) {
      return NextResponse.json(
        { error: 'Asset not found' },
        { status: 404 },
      );
    }

    // If asset has a file on disk, delete it (fire-and-forget)
    if (asset.filePath) {
      const absolutePath = join(cwd(), 'public', asset.filePath);
      unlink(absolutePath).catch(() => {
        // File may have already been removed — not a failure
      });
    }

    db.delete(tradeAssets)
      .where(eq(tradeAssets.id, assetId))
      .run();

    return NextResponse.json({ message: 'Asset removed' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete asset', details: String(error) },
      { status: 500 },
    );
  }
}
