import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { aiSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const aiSettingsSchema = z.object({
  provider: z.enum(['openai', 'ollama', 'anthropic', 'google', 'custom']).optional(),
  model: z.string().min(1, 'Model name is required').optional(),
  apiKey: z.string().min(1, 'API key is required').optional(),
  baseUrl: z.string().url().optional(),
  timeoutMs: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive('Must be positive').optional(),
  systemPrompt: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    const row = db.select().from(aiSettings).limit(1).get();
    if (!row) {
      return NextResponse.json(
        { message: 'No AI settings configured yet. Use PUT to create.' },
        { status: 200 }
      );
    }

    // Strip apiKey from the response — never expose secrets
    const { apiKey: _, ...safeRow } = row;
    return NextResponse.json(safeRow);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch AI settings', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = aiSettingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = db.select().from(aiSettings).limit(1).get();

    if (!existing) {
      const id = crypto.randomUUID();
      db.insert(aiSettings)
        .values({
          id,
          provider: parsed.data.provider ?? 'openai',
          model: parsed.data.model ?? 'gpt-4',
          ...(parsed.data.apiKey !== undefined && { apiKey: parsed.data.apiKey }),
          ...(parsed.data.baseUrl !== undefined && { baseUrl: parsed.data.baseUrl }),
          ...(parsed.data.timeoutMs !== undefined && { timeoutMs: parsed.data.timeoutMs }),
          ...(parsed.data.temperature !== undefined && { temperature: parsed.data.temperature }),
          ...(parsed.data.maxTokens !== undefined && { maxTokens: parsed.data.maxTokens }),
          ...(parsed.data.systemPrompt !== undefined && { systemPrompt: parsed.data.systemPrompt }),
          ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
        })
        .run();

      const row = db.select().from(aiSettings).where(eq(aiSettings.id, id)).get();
      if (!row) {
        return NextResponse.json(
          { error: 'Failed to create AI settings' },
          { status: 500 }
        );
      }
      const { apiKey: _, ...safeRow } = row;
      return NextResponse.json(safeRow, { status: 201 });
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.provider !== undefined) updateData.provider = parsed.data.provider;
    if (parsed.data.model !== undefined) updateData.model = parsed.data.model;
    if (parsed.data.apiKey !== undefined) updateData.apiKey = parsed.data.apiKey;
    if (parsed.data.baseUrl !== undefined) updateData.baseUrl = parsed.data.baseUrl;
    if (parsed.data.timeoutMs !== undefined) updateData.timeoutMs = parsed.data.timeoutMs;
    if (parsed.data.temperature !== undefined) updateData.temperature = parsed.data.temperature;
    if (parsed.data.maxTokens !== undefined) updateData.maxTokens = parsed.data.maxTokens;
    if (parsed.data.systemPrompt !== undefined) updateData.systemPrompt = parsed.data.systemPrompt;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

    if (Object.keys(updateData).length > 0) {
      db.update(aiSettings)
        .set(updateData)
        .where(eq(aiSettings.id, existing.id))
        .run();
    }

    const row = db.select().from(aiSettings).where(eq(aiSettings.id, existing.id)).get();
    if (!row) {
      return NextResponse.json(
        { error: 'Failed to fetch updated AI settings' },
        { status: 500 }
      );
    }
    const { apiKey: _, ...safeRow } = row;
    return NextResponse.json(safeRow);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update AI settings', details: String(error) },
      { status: 500 }
    );
  }
}
