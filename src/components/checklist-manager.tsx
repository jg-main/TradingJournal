'use client';

import { useEffect, useState, useCallback } from 'react';
import { GripVertical, Trash2, Plus } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';

// ── Types ───────────────────────────────────────────────────────────────

interface ChecklistDefinition {
  id: string;
  accountId: string | null;
  setupId: string | null;
  description: string;
  sortOrder: number;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChecklistManagerProps {
  parentId: string;
  scope: 'account' | 'setup';
}

// ── Sortable Check Item ─────────────────────────────────────────────────

function SortableCheckItem({
  check,
  onStartEdit,
  onDelete,
}: {
  check: ChecklistDefinition;
  onStartEdit: (check: ChecklistDefinition) => void;
  onDelete: (checkId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: check.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : 0,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 border-b border-border px-1 py-2 last:border-b-0"
    >
      {/* Grip handle */}
      <button
        type="button"
        className="flex shrink-0 cursor-grab touch-none items-center text-muted-foreground hover:text-foreground active:cursor-grabbing aria-[disabled]:cursor-default"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      {/* Description text / inline edit trigger */}
      <button
        type="button"
        className="flex-1 truncate text-left text-sm text-foreground hover:text-muted-foreground"
        onClick={() => onStartEdit(check)}
        aria-label={`Edit check: ${check.description}`}
      >
        {check.description}
      </button>

      {/* Delete button */}
      <button
        type="button"
        className="flex shrink-0 items-center text-muted-foreground hover:text-destructive"
        aria-label="Delete check"
        onClick={() => onDelete(check.id)}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

// ── Inline Edit Row ─────────────────────────────────────────────────────

function InlineEditRow({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialValue) {
      onSave(trimmed);
    } else {
      onCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  useEffect(() => {
    // Focus the input on mount
    const input = document.querySelector<HTMLInputElement>(
      '[data-checklist-edit-input]',
    );
    input?.focus();
  }, []);

  return (
    <div className="flex items-center gap-2 border-b border-border px-1 py-2 last:border-b-0">
      <div className="w-4 shrink-0" />
      <Input
        data-checklist-edit-input
        aria-label="Edit check description"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={handleKeyDown}
        className="flex-1"
      />
      <div className="w-4 shrink-0" />
    </div>
  );
}

// ── ChecklistManager Component ──────────────────────────────────────────

export default function ChecklistManager({ parentId, scope }: ChecklistManagerProps) {
  const [checks, setChecks] = useState<ChecklistDefinition[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [newText, setNewText] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const apiBase = `/api/${scope}s/${parentId}/checks`;
  const sectionTitle = scope === 'account' ? 'Account Entry Checks' : 'Setup Entry Checks';

  // ── Sensors for dnd-kit ────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // ── Fetch checks ───────────────────────────────────────────────────

  const fetchChecks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: ChecklistDefinition[] = await res.json();
      setChecks(data);
    } catch {
      setError('Failed to load checks.');
      setChecks([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchChecks();
  }, [fetchChecks]);

  // ── Add new check ──────────────────────────────────────────────────

  const handleAdd = async () => {
    const trimmed = newText.trim();
    if (!trimmed) return;

    setCreating(true);
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: trimmed }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `HTTP ${res.status}`);
      }
      const created: ChecklistDefinition = await res.json();
      setChecks((prev) => [...prev, created]);
      setNewText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add check.');
    } finally {
      setCreating(false);
    }
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  // ── Inline edit ────────────────────────────────────────────────────

  const handleStartEdit = (check: ChecklistDefinition) => {
    setEditingId(check.id);
    setEditText(check.description);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleSaveEdit = async (checkId: string, newDescription: string) => {
    setError(null);
    const previousChecks = [...checks];
    // Optimistic update
    setChecks((prev) =>
      prev.map((c) =>
        c.id === checkId ? { ...c, description: newDescription } : c,
      ),
    );
    setEditingId(null);

    try {
      const res = await fetch(`${apiBase}/${checkId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newDescription }),
      });
      if (!res.ok) {
        throw new Error('Failed to update check.');
      }
    } catch (err) {
      // Revert on failure
      setChecks(previousChecks);
      setError(err instanceof Error ? err.message : 'Failed to update check.');
    }
  };

  // ── Delete check ───────────────────────────────────────────────────

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    const deleteId = confirmDeleteId;
    setConfirmDeleteId(null);
    setError(null);

    const previousChecks = [...checks];
    // Optimistic remove
    setChecks((prev) => prev.filter((c) => c.id !== deleteId));

    try {
      const res = await fetch(`${apiBase}/${deleteId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to delete check.');
      }
    } catch (err) {
      // Revert on failure
      setChecks(previousChecks);
      setError(err instanceof Error ? err.message : 'Failed to delete check.');
    }
  };

  // ── Drag-and-drop reorder ──────────────────────────────────────────

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = checks.findIndex((c) => c.id === active.id);
    const newIndex = checks.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previousChecks = [...checks];

    // Reorder the array
    const reordered = [...checks];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    setChecks(reordered);

    // If only 1 item, no API call needed (shouldn't happen with drag, but guard)
    if (reordered.length <= 1) return;

    // Compute new sort_orders (0-indexed by array position)
    const items = reordered.map((c, i) => ({
      id: c.id,
      sortOrder: i,
    }));

    setError(null);
    try {
      const res = await fetch('/api/checks/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        throw new Error('Failed to reorder checks.');
      }
    } catch (err) {
      // Revert on failure
      setChecks(previousChecks);
      setError(err instanceof Error ? err.message : 'Failed to reorder checks.');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      {/* Section heading */}
      <h3 className="mb-4 text-sm font-medium text-muted-foreground">
        {sectionTitle}
      </h3>

      {/* Loading state */}
      {loading && (
        <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>
      )}

      {/* Empty state */}
      {!loading && checks.length === 0 && (
        <p className="mb-4 text-sm italic text-muted-foreground">
          No entry checks yet. Add one below.
        </p>
      )}

      {/* Checklist items with drag-and-drop */}
      {!loading && checks.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={checks.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="mb-4">
              {checks.map((check) =>
                editingId === check.id ? (
                  <InlineEditRow
                    key={check.id}
                    initialValue={editText}
                    onSave={(value) => handleSaveEdit(check.id, value)}
                    onCancel={handleCancelEdit}
                  />
                ) : (
                  <SortableCheckItem
                    key={check.id}
                    check={check}
                    onStartEdit={handleStartEdit}
                    onDelete={(checkId) => setConfirmDeleteId(checkId)}
                  />
                ),
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add new check input */}
      <div className="flex items-center gap-2">
        <Input
          aria-label="New check description"
          placeholder="Add a new check..."
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={handleAddKeyDown}
          disabled={creating}
          className="flex-1"
        />
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={creating || !newText.trim()}
          aria-label="Add check"
        >
          {creating ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Plus className="size-4" />
          )}
          Add
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Delete Check"
        description="Remove this entry check?"
        confirmLabel="Delete"
        destructive={false}
      />
    </div>
  );
}
