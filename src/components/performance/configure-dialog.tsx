'use client';

import React, { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  PERFORMANCE_WIDGET_REGISTRY,
  getWidgetConfigSchema,
  sanitizeKpiConfig,
} from '@/lib/performance-widget-registry';
import type {
  WidgetConfig,
  WidgetConfigFieldSchema,
  WidgetConfigSchema,
} from '@/lib/performance-view-types';

export interface ConfigureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Effective display title of the widget being configured. */
  widgetTitle: string;
  /** Registry widget type id (the instance's widgetType). */
  widgetType: string;
  /** The instance's current persisted config. */
  config: WidgetConfig;
  /** Called with the sanitized config when the user saves. */
  onSave: (config: WidgetConfig) => void;
}

/**
 * Typed widget Configure dialog (R005 / S05 T2).
 *
 * One shared dialog for every Performance widget: KPI and chart alike. The
 * fields are driven entirely by the widget registry's configSchema (resolved
 * via getWidgetConfigSchema) — KPI widgets expose metric selection from the
 * KPI catalogue, a title override, and a per-widget unit override where the
 * metric supports convertible units; chart widgets expose visible series,
 * primary series (performance-by-setup), legend visibility, and a title
 * override. There is deliberately no unrestricted visualization builder: only
 * the widget's declared configSchema fields are editable.
 *
 * Config changes flow through onSave → updateInstanceConfig so they persist
 * via the instance model and the saved-dashboard flow.
 */
export function ConfigureDialog({
  open,
  onOpenChange,
  widgetTitle,
  widgetType,
  config,
  onSave,
}: ConfigureDialogProps) {
  const definition = PERFORMANCE_WIDGET_REGISTRY[widgetType];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configure {widgetTitle}</DialogTitle>
          <DialogDescription>
            {definition?.description ?? 'Widget settings'}
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while the dialog is open, so the draft state
            initializes fresh per open — Cancel never leaks edits and each
            instance opens with its own saved config. */}
        {open && (
          <ConfigureDialogFields
            widgetType={widgetType}
            config={config}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialog body owning the ephemeral draft state. Mounts/unmounts with the
 * dialog (see ConfigureDialog), so the lazy initializer runs once per open.
 */
function ConfigureDialogFields({
  widgetType,
  config,
  onSave,
  onCancel,
}: {
  widgetType: string;
  config: WidgetConfig;
  onSave: (config: WidgetConfig) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    applySchemaDefaults(getWidgetConfigSchema(widgetType, config), config),
  );

  // Re-derive the schema as the draft changes (e.g. KPI metric change swaps
  // the unit options) so the dialog always shows only valid, typed fields.
  const schema = useMemo(
    () => getWidgetConfigSchema(widgetType, { ...config, ...draft }),
    [widgetType, config, draft],
  );

  const definition = PERFORMANCE_WIDGET_REGISTRY[widgetType];

  const handleSave = () => {
    const next = buildConfigFromDraft(schema, draft);
    const sanitized = definition?.category === 'kpi' ? sanitizeKpiConfig(next, widgetType) : next;
    onSave(sanitized);
    onCancel();
  };

  const setField = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const toggleMulti = (key: string, value: string, checked: boolean) => {
    setDraft((d) => {
      const current = Array.isArray(d[key]) ? (d[key] as string[]) : [];
      const next = checked ? [...current, value] : current.filter((v) => v !== value);
      return { ...d, [key]: next };
    });
  };

  return (
    <>
      <div className="space-y-4">
        {Object.values(schema).map((field) => renderField(field, draft, setField, toggleMulti))}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave}>Save</Button>
      </DialogFooter>
    </>
  );
}

// ── Field rendering ─────────────────────────────────────────────────────────

function renderField(
  field: WidgetConfigFieldSchema,
  draft: Record<string, unknown>,
  setField: (key: string, value: unknown) => void,
  toggleMulti: (key: string, value: string, checked: boolean) => void,
) {
  switch (field.kind) {
    case 'select': {
      const value = String(draft[field.key] ?? field.default ?? '');
      return (
        <div key={field.key} className="space-y-1.5">
          <label id={`configure-${field.key}-label`} className="text-xs font-medium text-muted-foreground">
            {field.label}
          </label>
          <Select value={value} onValueChange={(v) => setField(field.key, v)}>
            <SelectTrigger aria-label={field.label} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    case 'multi-select': {
      const selected = (draft[field.key] as string[] | undefined) ?? field.default ?? [];
      return (
        <fieldset key={field.key} className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground">{field.label}</legend>
          {field.options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-foreground"
                  checked={checked}
                  onChange={(e) => toggleMulti(field.key, option.value, e.target.checked)}
                />
                {option.label}
              </label>
            );
          })}
        </fieldset>
      );
    }
    case 'boolean': {
      const checked = Boolean(draft[field.key] ?? field.default ?? false);
      return (
        <label key={field.key} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-foreground"
            checked={checked}
            onChange={(e) => setField(field.key, e.target.checked)}
          />
          {field.label}
        </label>
      );
    }
    case 'text': {
      return (
        <div key={field.key} className="space-y-1.5">
          <label htmlFor={`configure-${field.key}`} className="text-xs font-medium text-muted-foreground">
            {field.label}
          </label>
          <Input
            id={`configure-${field.key}`}
            value={String(draft[field.key] ?? '')}
            placeholder={field.placeholder}
            onChange={(e) => setField(field.key, e.target.value)}
          />
        </div>
      );
    }
    default:
      return null;
  }
}

// ── Pure draft helpers (unit-testable) ──────────────────────────────────────

/**
 * Build the initial draft from the saved config, filling missing fields with
 * their schema defaults. Only schema-declared fields appear in the draft.
 */
export function applySchemaDefaults(
  schema: WidgetConfigSchema,
  config: WidgetConfig,
): Record<string, unknown> {
  const draft: Record<string, unknown> = {};
  for (const field of Object.values(schema)) {
    const existing = config[field.key];
    if (existing !== undefined && existing !== null) {
      draft[field.key] = existing;
    } else if (field.kind === 'multi-select') {
      draft[field.key] = field.default ? [...field.default] : [];
    } else if (field.default !== undefined) {
      draft[field.key] = field.default;
    } else if (field.kind === 'text') {
      draft[field.key] = '';
    } else if (field.kind === 'boolean') {
      draft[field.key] = false;
    } else {
      draft[field.key] = '';
    }
  }
  return draft;
}

/**
 * Turn the draft into a clean persisted config: drop empty title overrides and
 * omit any field whose value matches its schema default (so a save that
 * changes nothing writes back an empty config, keeping the registry defaults
 * authoritative). The GLOBAL_UNIT_SENTINEL ("follow global unit") is dropped
 * the same way, so the KPI card falls back to the dashboard's global unit.
 */
export function buildConfigFromDraft(
  schema: WidgetConfigSchema,
  draft: Record<string, unknown>,
): WidgetConfig {
  const next: WidgetConfig = {};
  for (const field of Object.values(schema)) {
    const value = draft[field.key];
    if (value === undefined || value === null) continue;

    if (field.kind === 'text') {
      const trimmed = String(value).trim();
      if (trimmed) next[field.key] = trimmed;
      continue;
    }

    const defaultValue = field.default;
    if (field.kind === 'multi-select') {
      const arr = Array.isArray(value) ? value : [];
      const def = Array.isArray(defaultValue) ? defaultValue : [];
      if (JSON.stringify(arr) !== JSON.stringify(def)) next[field.key] = arr;
      continue;
    }

    if (defaultValue === value) continue;
    next[field.key] = value;
  }
  return next;
}
