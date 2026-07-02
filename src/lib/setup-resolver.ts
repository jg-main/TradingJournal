/**
 * Setup resolver: resolves a setup name string to a lookupValues UUID.
 *
 * Lookup order:
 * 1. Check lookupValues (type='setup') by lowercased value
 * 2. If not found, check setupDefinitions by name
 * 3. If found in setupDefinitions, create lookupValues entry (same UUID)
 * 4. If not found in either, auto-create in both tables (legacy bridge)
 */

import { db } from '@/db';
import { lookupValues, setupDefinitions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export interface ResolveSetupResult {
  id: string;
  wasAutoCreated: boolean;
}

export function resolveSetup(setupName: string | null | undefined): ResolveSetupResult | null {
  if (!setupName) return null;

  const lowerValue = setupName.toLowerCase();

  // Step 1: Try lookupValues first
  const existingLookup = db
    .select()
    .from(lookupValues)
    .where(and(eq(lookupValues.type, 'setup'), eq(lookupValues.value, lowerValue)))
    .get();

  if (existingLookup) {
    return { id: existingLookup.id, wasAutoCreated: false };
  }

  // Step 2: Try setupDefinitions by name
  const existingDef = db
    .select()
    .from(setupDefinitions)
    .where(eq(setupDefinitions.name, setupName))
    .get();

  if (existingDef) {
    // Step 3: Found in definitions but missing from lookupValues — create bridge entry
    const now = new Date().toISOString();
    db.insert(lookupValues)
      .values({
        id: existingDef.id,
        type: 'setup',
        value: lowerValue,
        description: existingDef.description,
        isActive: existingDef.isActive,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return { id: existingDef.id, wasAutoCreated: true };
  }

  // Step 4: Not found anywhere — auto-create in both tables (legacy bridge)
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(setupDefinitions)
    .values({
      id,
      name: setupName,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  db.insert(lookupValues)
    .values({
      id,
      type: 'setup',
      value: lowerValue,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { id, wasAutoCreated: true };
}
