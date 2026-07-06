'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ClipboardCheck,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Scale,
  AlertTriangle,
  Layers,
  ShieldCheck,
  Pencil,
  Check,
  X,
} from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/components/empty-state';

// ── Types ──────────────────────────────────────────────────────────────

interface ChecklistItem {
  id: string;
  text: string;
  weight: number; // 1 = normal, 2 = important, 3 = critical
  checked: boolean;
}

interface ChecklistTemplate {
  id: string;
  name: string;
  description: string;
  items: ChecklistItem[];
}

// ── Tab state ──────────────────────────────────────────────────────────

type Tab = 'checklists' | 'validation-rules';

// ── Validation rules derived from trade-calc.ts patterns ───────────────

interface ValidationRule {
  id: string;
  name: string;
  description: string;
  severity: 'info' | 'warning' | 'error';
  source: string;
  formula: string;
}

const VALIDATION_RULES: ValidationRule[] = [
  {
    id: 'max-risk-pct',
    name: 'Max Risk Per Trade',
    description:
      'Risk per trade should not exceed the configured max risk percentage of total account equity to preserve capital across multiple trades.',
    severity: 'warning',
    source: 'settings.maxRiskPerTradePct',
    formula: 'riskAmount / accountEquity <= maxRiskPerTradePct / 100',
  },
  {
    id: 'min-reward-risk',
    name: 'Minimum Reward-to-Risk Ratio',
    description:
      'Reward-to-risk ratio should be at least 2:1 for standard setups and 1:1 for high-conviction plays to ensure positive expectancy over time.',
    severity: 'warning',
    source: 'calculatePositionSize().rewardRiskRatio',
    formula: 'rewardRiskRatio >= 1.0 (target: >= 2.0)',
  },
  {
    id: 'position-size-limit',
    name: 'Position Size Limit',
    description:
      'Position size should not exceed a reasonable percentage of the portfolio to avoid over-concentration in any single trade.',
    severity: 'info',
    source: 'calculatePositionSize().positionSize',
    formula: 'positionValue / accountEquity <= 0.25',
  },
  {
    id: 'stop-dist-from-entry',
    name: 'Stop Distance from Entry',
    description:
      'Stop loss should be placed at a technically valid level — not too tight (risk of noise) and not too wide (excessive risk). Typically 1-5% from entry.',
    severity: 'info',
    source: 'trade-calc.ts: calculateRealizedPnL()',
    formula: 'abs(entryPrice - stopPrice) / entryPrice between 0.01 and 0.05',
  },
  {
    id: 'direction-action-valid',
    name: 'Direction-Action Consistency',
    description:
      'Entry/exit actions must match the trade direction. Long trades use buy/add for entries and sell/reduce for exits. Short trades use sell_short for entries and buy_to_cover for exits.',
    severity: 'error',
    source: 'trade-calc.ts: isEntryAction() / isExitAction()',
    formula: 'isEntryAction(action, direction) || isExitAction(action, direction)',
  },
  {
    id: 'r-multiple-positive',
    name: 'R-Multiple Positive Expectancy',
    description:
      'For profitable strategies, the average R-multiple (totalRealizedPnL / initialRiskAmount) should be positive over a sample of trades to confirm edge.',
    severity: 'info',
    source: 'trade-calc.ts: calculateRMultiple()',
    formula: 'rMultiple = totalRealizedPnL / initialRiskAmount > 0',
  },
  {
    id: 'open-quantity-valid',
    name: 'Open Quantity Integrity',
    description:
      'Open quantity must never be negative. Exit quantity must not exceed entry quantity. Status is derived from net open quantity (planned, open, closed, deleted).',
    severity: 'error',
    source: 'trade-calc.ts: deriveTradeStatus()',
    formula: 'openQuantity = max(0, totalEntryQty - totalExitQty)',
  },
  {
    id: 'fees-included-pnl',
    name: 'Fees Included in P&L',
    description:
      'All transaction fees (commissions, exchange fees) must be factored into P&L calculations. Null fees are treated as zero.',
    severity: 'info',
    source: 'trade-calc.ts: calculatePnL()',
    formula: 'totalRealizedPnL -= sum(execution.fees ?? 0)',
  },
];

// ── Helpers ────────────────────────────────────────────────────────────

let idCounter = Date.now();
function generateId(): string {
  return `chk_${++idCounter}`;
}

function severityColor(severity: ValidationRule['severity']): string {
  switch (severity) {
    case 'error':
      return 'border-red-200 bg-red-50 dark:border-red-800/30 dark:bg-red-900/10';
    case 'warning':
      return 'border-amber-200 bg-amber-50 dark:border-amber-800/30 dark:bg-amber-900/10';
    case 'info':
      return 'border-blue-200 bg-blue-50 dark:border-blue-800/30 dark:bg-blue-900/10';
  }
}

function severityIcon(severity: ValidationRule['severity']) {
  switch (severity) {
    case 'error':
      return <AlertTriangle className="size-4 shrink-0 text-red-500" />;
    case 'warning':
      return <AlertTriangle className="size-4 shrink-0 text-amber-500" />;
    case 'info':
      return <ShieldCheck className="size-4 shrink-0 text-blue-500" />;
  }
}

function severityBadgeClass(severity: ValidationRule['severity']): string {
  switch (severity) {
    case 'error':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'warning':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'info':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
  }
}

// ── Default Templates ──────────────────────────────────────────────────

function createDefaultTemplates(): ChecklistTemplate[] {
  return [
    {
      id: generateId(),
      name: 'Standard Pre-Trade',
      description: 'Core checklist for any trade — verify setup, risk, and plan before entry.',
      items: [
        { id: generateId(), text: 'Confirm technical setup (trend, support/resistance, pattern)', weight: 3, checked: false },
        { id: generateId(), text: 'Verify R:R ratio meets minimum threshold (>= 2:1)', weight: 3, checked: false },
        { id: generateId(), text: 'Position size calculated with correct account equity', weight: 2, checked: false },
        { id: generateId(), text: 'Stop loss placed at technically valid level', weight: 3, checked: false },
        { id: generateId(), text: 'Target prices identified and reasonable', weight: 2, checked: false },
        { id: generateId(), text: 'Check for earnings, news, or events this week', weight: 2, checked: false },
        { id: generateId(), text: 'Review higher timeframe context', weight: 1, checked: false },
        { id: generateId(), text: 'Invalidation conditions clearly defined', weight: 2, checked: false },
      ],
    },
    {
      id: generateId(),
      name: 'Earnings Play',
      description: 'Checklist for trades around earnings announcements — higher risk, requires extra diligence.',
      items: [
        { id: generateId(), text: 'Review implied move vs expected move', weight: 3, checked: false },
        { id: generateId(), text: 'Check option liquidity and bid/ask spreads', weight: 2, checked: false },
        { id: generateId(), text: 'Verify earnings date/time confirmed (no schedule changes)', weight: 3, checked: false },
        { id: generateId(), text: 'Position size reduced to 50% of normal risk', weight: 2, checked: false },
        { id: generateId(), text: 'Define exact exit criteria pre-earnings', weight: 3, checked: false },
        { id: generateId(), text: 'Check whisper numbers and analyst revisions', weight: 1, checked: false },
        { id: generateId(), text: 'Plan for post-earnings gap management', weight: 2, checked: false },
      ],
    },
    {
      id: generateId(),
      name: 'OCO Bracket',
      description: 'Checklist for One-Cancels-Other bracket orders with profit target and stop loss.',
      items: [
        { id: generateId(), text: 'Profit target set at technically valid resistance level', weight: 2, checked: false },
        { id: generateId(), text: 'Stop loss set below key support / above key resistance', weight: 3, checked: false },
        { id: generateId(), text: 'R:R ratio calculated and acceptable', weight: 3, checked: false },
        { id: generateId(), text: 'Verify direction consistency (long or short, not both)', weight: 2, checked: false },
        { id: generateId(), text: 'OCO pair created with the same contract/symbol', weight: 2, checked: false },
        { id: generateId(), text: 'Partial profit targets defined (e.g., 50% at target 1, 50% at target 2)', weight: 1, checked: false },
        { id: generateId(), text: 'Check for dividend/ex-dividend dates if holding overnight', weight: 1, checked: false },
      ],
    },
  ];
}

// ── Weight indicators ──────────────────────────────────────────────────

function weightLabel(weight: number): string {
  switch (weight) {
    case 1: return 'Standard';
    case 2: return 'Important';
    case 3: return 'Critical';
    default: return 'Standard';
  }
}

function weightColor(weight: number): string {
  switch (weight) {
    case 3: return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 2: return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    default: return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
  }
}

// ── localStorage key ───────────────────────────────────────────────────

const STORAGE_KEY = 'tj-checks-templates';

// ── Page ───────────────────────────────────────────────────────────────

export default function ChecksPage() {
  // ── State ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('checklists');
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  // ── New template form ──────────────────────────────────────────────
  const [showNewTemplateForm, setShowNewTemplateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  // ── Add item form (per template) ──────────────────────────────────
  const [addingItemToTemplate, setAddingItemToTemplate] = useState<string | null>(null);
  const [newItemText, setNewItemText] = useState('');
  const [newItemWeight, setNewItemWeight] = useState<number>(1);

  // ── Rename template ────────────────────────────────────────────────
  const [renamingTemplate, setRenamingTemplate] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ── Edit item ──────────────────────────────────────────────────────
  const [editingItem, setEditingItem] = useState<{ templateId: string; itemId: string } | null>(null);
  const [editItemText, setEditItemText] = useState('');

  // ── Load from localStorage on mount ────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ChecklistTemplate[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTemplates(parsed);
          return;
        }
      }
    } catch {
      // ignore parse errors, use defaults
    }
    const defaults = createDefaultTemplates();
    setTemplates(defaults);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
  }, []);

  // ── Persist to localStorage ────────────────────────────────────────
  const persist = useCallback((tpls: ChecklistTemplate[]) => {
    setTemplates(tpls);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tpls));
    } catch {
      // storage full — silently fail
    }
  }, []);

  // ── Toggle item check ──────────────────────────────────────────────
  function handleToggle(templateId: string, itemId: string) {
    const updated = templates.map((t) => {
      if (t.id !== templateId) return t;
      return {
        ...t,
        items: t.items.map((item) =>
          item.id === itemId ? { ...item, checked: !item.checked } : item
        ),
      };
    });
    persist(updated);
  }

  // ── Toggle expand ──────────────────────────────────────────────────
  function handleExpand(templateId: string) {
    setExpandedTemplate((prev) => (prev === templateId ? null : templateId));
  }

  // ── Create template ────────────────────────────────────────────────
  function handleCreateTemplate() {
    if (!newName.trim()) return;
    const tpl: ChecklistTemplate = {
      id: generateId(),
      name: newName.trim(),
      description: newDescription.trim(),
      items: [],
    };
    persist([...templates, tpl]);
    setNewName('');
    setNewDescription('');
    setShowNewTemplateForm(false);
    setExpandedTemplate(tpl.id);
  }

  // ── Delete template ────────────────────────────────────────────────
  function handleDeleteTemplate(templateId: string) {
    const tpl = templates.find((t) => t.id === templateId);
    if (!confirm(`Delete checklist "${tpl?.name ?? ''}"?`)) return;
    const updated = templates.filter((t) => t.id !== templateId);
    persist(updated);
    if (expandedTemplate === templateId) setExpandedTemplate(null);
  }

  // ── Add item ───────────────────────────────────────────────────────
  function handleAddItem(templateId: string) {
    if (!newItemText.trim()) return;
    const item: ChecklistItem = {
      id: generateId(),
      text: newItemText.trim(),
      weight: newItemWeight,
      checked: false,
    };
    const updated = templates.map((t) => {
      if (t.id !== templateId) return t;
      return { ...t, items: [...t.items, item] };
    });
    persist(updated);
    setNewItemText('');
    setNewItemWeight(1);
    setAddingItemToTemplate(null);
  }

  // ── Delete item ────────────────────────────────────────────────────
  function handleDeleteItem(templateId: string, itemId: string) {
    const updated = templates.map((t) => {
      if (t.id !== templateId) return t;
      return { ...t, items: t.items.filter((item) => item.id !== itemId) };
    });
    persist(updated);
    if (editingItem?.templateId === templateId && editingItem?.itemId === itemId) {
      setEditingItem(null);
    }
  }

  // ── Rename template ────────────────────────────────────────────────
  function handleRenameStart(tpl: ChecklistTemplate) {
    setRenamingTemplate(tpl.id);
    setRenameValue(tpl.name);
  }

  function handleRenameConfirm() {
    if (!renamingTemplate || !renameValue.trim()) {
      setRenamingTemplate(null);
      return;
    }
    const updated = templates.map((t) => {
      if (t.id !== renamingTemplate) return t;
      return { ...t, name: renameValue.trim() };
    });
    persist(updated);
    setRenamingTemplate(null);
  }

  // ── Edit item text ──────────────────────────────────────────────────
  function handleEditItemStart(templateId: string, item: ChecklistItem) {
    setEditingItem({ templateId, itemId: item.id });
    setEditItemText(item.text);
  }

  function handleEditItemConfirm() {
    if (!editingItem || !editItemText.trim()) {
      setEditingItem(null);
      return;
    }
    const updated = templates.map((t) => {
      if (t.id !== editingItem.templateId) return t;
      return {
        ...t,
        items: t.items.map((item) =>
          item.id === editingItem.itemId ? { ...item, text: editItemText.trim() } : item
        ),
      };
    });
    persist(updated);
    setEditingItem(null);
  }

  // ── Progress ──────────────────────────────────────────────────────
  function checkedCount(tpl: ChecklistTemplate): number {
    return tpl.items.filter((i) => i.checked).length;
  }

  function progressPct(tpl: ChecklistTemplate): number {
    if (tpl.items.length === 0) return 0;
    return Math.round((checkedCount(tpl) / tpl.items.length) * 100);
  }

  // ── Render tab bar ─────────────────────────────────────────────────

  const renderTabs = () => (
    <div className="mb-6 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
      <button
        onClick={() => setActiveTab('checklists')}
        className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          activeTab === 'checklists'
            ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
        }`}
      >
        <ClipboardCheck className="size-4" />
        Pre-Trade Checklists
      </button>
      <button
        onClick={() => setActiveTab('validation-rules')}
        className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          activeTab === 'validation-rules'
            ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
        }`}
      >
        <Scale className="size-4" />
        Validation Rules
      </button>
    </div>
  );

  // ── Render: Pre-Trade Checklists ────────────────────────────────────

  const renderChecklists = () => {
    if (templates.length === 0 && !showNewTemplateForm) {
      return (
        <EmptyState
          icon={<ClipboardCheck className="size-12 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />}
          title="No checklists configured"
          description="Create pre-trade checklists to ensure you follow your process on every trade. Start with standard templates or build your own."
          action={
            <Button onClick={() => setShowNewTemplateForm(true)}>
              <Plus className="size-4" />
              Create Checklist
            </Button>
          }
        />
      );
    }

    return (
      <div className="space-y-4">
        {/* New template form */}
        {showNewTemplateForm && (
          <Card className="border-dashed border-zinc-300 dark:border-zinc-600">
            <CardContent className="pt-4">
              <div className="space-y-3">
                <Input
                  placeholder="Template name (e.g. Swing Trade)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Input
                  placeholder="Short description (optional)"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button onClick={handleCreateTemplate} disabled={!newName.trim()}>
                    <Plus className="size-4" />
                    Create
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowNewTemplateForm(false);
                      setNewName('');
                      setNewDescription('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Add template button (not shown when form is open) */}
        {!showNewTemplateForm && (
          <button
            onClick={() => setShowNewTemplateForm(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
          >
            <Plus className="size-4" />
            New Checklist Template
          </button>
        )}

        {/* Template cards */}
        {templates.map((tpl) => {
          const isExpanded = expandedTemplate === tpl.id;
          const pct = progressPct(tpl);

          return (
            <Card key={tpl.id} className="overflow-hidden">
              <CardHeader
                className="cursor-pointer select-none"
                onClick={() => handleExpand(tpl.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <button
                      className="mt-0.5 shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      onClick={(e) => { e.stopPropagation(); handleExpand(tpl.id); }}
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                    <div>
                      {/* Template name or rename input */}
                      {renamingTemplate === tpl.id ? (
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="h-7 w-48 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameConfirm();
                              if (e.key === 'Escape') setRenamingTemplate(null);
                            }}
                          />
                          <button
                            className="rounded p-0.5 text-emerald-500 hover:text-emerald-600"
                            onClick={handleRenameConfirm}
                          >
                            <Check className="size-3.5" />
                          </button>
                          <button
                            className="rounded p-0.5 text-zinc-400 hover:text-zinc-600"
                            onClick={() => setRenamingTemplate(null)}
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <CardTitle className="flex items-center gap-2">
                          {tpl.name}
                          <button
                            className="opacity-0 text-zinc-400 hover:text-zinc-600 group-hover/card:opacity-100 dark:hover:text-zinc-300"
                            onClick={(e) => { e.stopPropagation(); handleRenameStart(tpl); }}
                          >
                            <Pencil className="size-3" />
                          </button>
                        </CardTitle>
                      )}
                      <CardDescription>{tpl.description}</CardDescription>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Progress */}
                    {tpl.items.length > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="flex h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                          <div
                            className="rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                          {checkedCount(tpl)}/{tpl.items.length}
                        </span>
                      </div>
                    )}

                    {/* Delete */}
                    <button
                      className="shrink-0 text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
                      onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl.id); }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent>
                  <Separator className="mb-4 -mx-0" />

                  {/* Items */}
                  {tpl.items.length === 0 && !addingItemToTemplate && (
                    <p className="mb-4 text-sm text-zinc-400 dark:text-zinc-500">
                      No checklist items yet. Add items below.
                    </p>
                  )}

                  <div className="space-y-1">
                    {tpl.items.map((item) => (
                      <div
                        key={item.id}
                        className="group flex items-start gap-3 rounded-lg px-1 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                      >
                        {/* Checkbox */}
                        <button
                          onClick={() => handleToggle(tpl.id, item.id)}
                          className="mt-0.5 shrink-0"
                        >
                          {item.checked ? (
                            <CheckCircle2 className="size-4 text-emerald-500" />
                          ) : (
                            <Circle className="size-4 text-zinc-300 dark:text-zinc-600" />
                          )}
                        </button>

                        {/* Item text */}
                        <div className="flex-1">
                          {editingItem?.templateId === tpl.id && editingItem?.itemId === item.id ? (
                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <Input
                                value={editItemText}
                                onChange={(e) => setEditItemText(e.target.value)}
                                className="h-7 text-sm"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleEditItemConfirm();
                                  if (e.key === 'Escape') setEditingItem(null);
                                }}
                              />
                              <button
                                className="rounded p-0.5 text-emerald-500 hover:text-emerald-600"
                                onClick={handleEditItemConfirm}
                              >
                                <Check className="size-3.5" />
                              </button>
                              <button
                                className="rounded p-0.5 text-zinc-400 hover:text-zinc-600"
                                onClick={() => setEditingItem(null)}
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span
                              className={`text-sm ${
                                item.checked
                                  ? 'text-zinc-400 line-through dark:text-zinc-500'
                                  : 'text-zinc-800 dark:text-zinc-200'
                              }`}
                            >
                              {item.text}
                            </span>
                          )}
                        </div>

                        {/* Weight badge */}
                        <Badge
                          variant="secondary"
                          className={`shrink-0 ${weightColor(item.weight)}`}
                        >
                          <GripVertical className="mr-1 size-2" />
                          {weightLabel(item.weight)}
                        </Badge>

                        {/* Actions */}
                        <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                          <button
                            className="rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                            onClick={() => handleEditItemStart(tpl.id, item)}
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            className="rounded p-1 text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
                            onClick={() => handleDeleteItem(tpl.id, item.id)}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add item form */}
                  {addingItemToTemplate === tpl.id ? (
                    <div className="mt-4 space-y-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-600">
                      <Input
                        placeholder="Checklist item text..."
                        value={newItemText}
                        onChange={(e) => setNewItemText(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddItem(tpl.id);
                          if (e.key === 'Escape') setAddingItemToTemplate(null);
                        }}
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-zinc-500 dark:text-zinc-400">
                            Importance:
                          </label>
                          <select
                            value={newItemWeight}
                            onChange={(e) => setNewItemWeight(Number(e.target.value))}
                            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            <option value={1}>Standard</option>
                            <option value={2}>Important</option>
                            <option value={3}>Critical</option>
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleAddItem(tpl.id)} disabled={!newItemText.trim()}>
                            <Plus className="size-3" />
                            Add
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setAddingItemToTemplate(null);
                              setNewItemText('');
                              setNewItemWeight(1);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingItemToTemplate(tpl.id)}
                      className="mt-3 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      <Plus className="size-3.5" />
                      Add item
                    </button>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    );
  };

  // ── Render: Validation Rules ────────────────────────────────────────

  const renderValidationRules = () => (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="size-4 text-zinc-500" />
            Validation Rules Reference
          </CardTitle>
          <CardDescription>
            Computed rules derived from position sizing and trade calculation patterns.
            These rules are enforced during trade planning and execution to maintain
            trading discipline.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {VALIDATION_RULES.map((rule) => (
          <Card
            key={rule.id}
            className={`border-t-2 ${severityColor(rule.severity)}`}
            style={{
              borderTopColor:
                rule.severity === 'error'
                  ? 'var(--color-red-500)'
                  : rule.severity === 'warning'
                    ? 'var(--color-amber-500)'
                    : 'var(--color-blue-500)',
            }}
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {severityIcon(rule.severity)}
                  {rule.name}
                </CardTitle>
                <Badge
                  variant="secondary"
                  className={severityBadgeClass(rule.severity)}
                >
                  {rule.severity.charAt(0).toUpperCase() + rule.severity.slice(1)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {rule.description}
              </p>
              <div className="space-y-1.5">
                <div className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 shrink-0 font-medium text-zinc-500 dark:text-zinc-400">
                    Source:
                  </span>
                  <code className="break-all rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {rule.source}
                  </code>
                </div>
                <div className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 shrink-0 font-medium text-zinc-500 dark:text-zinc-400">
                    Formula:
                  </span>
                  <code className="break-all rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {rule.formula}
                  </code>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Summary card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-red-500" />
              {VALIDATION_RULES.filter((r) => r.severity === 'error').length} Error rules
            </span>
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-amber-500" />
              {VALIDATION_RULES.filter((r) => r.severity === 'warning').length} Warning rules
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-blue-500" />
              {VALIDATION_RULES.filter((r) => r.severity === 'info').length} Info rules
            </span>
            <span className="text-zinc-300 dark:text-zinc-600">|</span>
            <span className="inline-flex items-center gap-1.5">
              <Layers className="size-3.5" />
              Source: {new Set(VALIDATION_RULES.map((r) => r.source)).size} unique modules
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Checks &amp; Validation
      </h1>

      {renderTabs()}

      {activeTab === 'checklists' && renderChecklists()}
      {activeTab === 'validation-rules' && renderValidationRules()}
    </div>
  );
}
