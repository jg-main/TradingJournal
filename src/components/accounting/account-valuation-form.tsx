'use client';

import { useState } from 'react';
import { Plus, XCircle, CheckCircle2, X } from 'lucide-react';

// ── Props ───────────────────────────────────────────────────────────────

interface AccountValuationFormProps {
  accountId: string;
  onMarkSubmitted: () => void;
}

// ── Mark Source Options ─────────────────────────────────────────────────

const MARK_SOURCE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'market_data', label: 'Market Data' },
  { value: 'import', label: 'Import' },
  { value: 'system', label: 'System' },
] as const;

// ── Component ──────────────────────────────────────────────────────────

export default function AccountValuationForm({ accountId, onMarkSubmitted }: AccountValuationFormProps) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form fields
  const [symbol, setSymbol] = useState('');
  const [price, setPrice] = useState('');
  const [source, setSource] = useState('user');
  const [markTimestamp, setMarkTimestamp] = useState(() => new Date().toISOString().slice(0, 16));

  const resetForm = () => {
    setSymbol('');
    setPrice('');
    setSource('user');
    setMarkTimestamp(new Date().toISOString().slice(0, 16));
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    // Client-side validation
    if (!symbol.trim()) {
      setMessage({ type: 'error', text: 'Symbol is required.' });
      setSaving(false);
      return;
    }

    const parsedPrice = parseFloat(price);
    if (!price || isNaN(parsedPrice) || parsedPrice <= 0) {
      setMessage({ type: 'error', text: 'Price must be a positive number.' });
      setSaving(false);
      return;
    }

    if (!markTimestamp) {
      setMessage({ type: 'error', text: 'Mark timestamp is required.' });
      setSaving(false);
      return;
    }

    try {
      const body = {
        symbol: symbol.trim().toUpperCase(),
        price: parsedPrice.toFixed(2),
        source,
        markTimestamp: new Date(markTimestamp).toISOString(),
      };

      const res = await fetch(`/api/accounts/${accountId}/valuations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 409) {
        setMessage({ type: 'error', text: 'Duplicate mark — idempotency key conflict.' });
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Submission failed' }));
        setMessage({
          type: 'error',
          text: typeof err.details === 'string' ? err.details : (err.error ?? 'Failed to post valuation mark.'),
        });
        return;
      }

      setMessage({ type: 'success', text: `Mark posted for ${symbol.trim().toUpperCase()} at $${parsedPrice.toFixed(2)}.` });
      resetForm();
      onMarkSubmitted();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to post valuation mark.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div>
      {/* Message Banner */}
      {message && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            message.type === 'success'
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <XCircle className="size-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        </div>
      )}

      {/* Toggle Button / Form */}
      {!showForm ? (
        <button
          onClick={() => { setShowForm(true); setMessage(null); }}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
          aria-label="Post valuation mark"
        >
          <Plus className="size-3.5" />
          Post Mark
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              New Valuation Mark
            </h3>
            <button
              type="button"
              onClick={() => { setShowForm(false); setMessage(null); }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cancel"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3">
            {/* Symbol */}
            <div>
              <label htmlFor="vm-symbol" className="mb-1 block text-xs font-medium text-foreground">
                Symbol
              </label>
              <input
                id="vm-symbol"
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="e.g. AAPL"
                autoFocus
                required
              />
            </div>

            {/* Price */}
            <div>
              <label htmlFor="vm-price" className="mb-1 block text-xs font-medium text-foreground">
                Price ($)
              </label>
              <input
                id="vm-price"
                type="number"
                step="0.01"
                min="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="e.g. 150.75"
                required
              />
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3">
            {/* Source */}
            <div>
              <label htmlFor="vm-source" className="mb-1 block text-xs font-medium text-foreground">
                Source
              </label>
              <select
                id="vm-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {MARK_SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Timestamp */}
            <div>
              <label htmlFor="vm-timestamp" className="mb-1 block text-xs font-medium text-foreground">
                Mark Timestamp
              </label>
              <input
                id="vm-timestamp"
                type="datetime-local"
                value={markTimestamp}
                onChange={(e) => setMarkTimestamp(e.target.value)}
                className="w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                required
              />
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-secondary/80"
            >
              {saving ? 'Posting...' : 'Post Mark'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setMessage(null); }}
              className="rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
