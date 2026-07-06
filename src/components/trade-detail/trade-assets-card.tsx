'use client';

import { useState } from 'react';
import { ImageIcon, LinkIcon, Trash2, Upload } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TradeAsset } from './types';

interface TradeAssetsCardProps {
  assets: TradeAsset[];
  tradeId: string;
  onAssetsChanged: () => Promise<void>;
}

const phases = ['pre_trade', 'entry', 'management', 'exit', 'review'] as const;

const phaseLabel: Record<string, string> = {
  pre_trade: 'Pre-Trade',
  entry: 'Entry',
  management: 'Management',
  exit: 'Exit',
  review: 'Review',
};

export default function TradeAssetsCard({
  assets,
  tradeId,
  onAssetsChanged,
}: TradeAssetsCardProps) {
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'upload' | 'link'>('upload');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPhase, setUploadPhase] = useState<string>('pre_trade');
  const [uploadLabel, setUploadLabel] = useState('');

  // Link state
  const [linkUrl, setLinkUrl] = useState('');
  const [linkPhase, setLinkPhase] = useState<string>('pre_trade');
  const [linkLabel, setLinkLabel] = useState('');

  const resetForm = () => {
    setUploadFile(null);
    setUploadPhase('pre_trade');
    setUploadLabel('');
    setLinkUrl('');
    setLinkPhase('pre_trade');
    setLinkLabel('');
    setMessage(null);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!uploadFile) {
      setMessage({ type: 'error', text: 'Please select a file to upload.' });
      return;
    }

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('phase', uploadPhase);
    if (uploadLabel.trim()) formData.append('label', uploadLabel.trim());

    try {
      const res = await fetch(`/api/trades/${tradeId}/assets`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({
          type: 'error',
          text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Upload failed.'),
        });
        return;
      }

      setMessage({ type: 'success', text: 'Screenshot uploaded.' });
      setUploadFile(null);
      setUploadLabel('');
      await onAssetsChanged();
    } catch {
      setMessage({ type: 'error', text: 'Upload failed.' });
    }
  };

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!linkUrl.trim()) {
      setMessage({ type: 'error', text: 'URL is required.' });
      return;
    }

    try {
      const res = await fetch(`/api/trades/${tradeId}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetType: 'link',
          phase: linkPhase,
          externalUrl: linkUrl.trim(),
          label: linkLabel.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessage({
          type: 'error',
          text: err.details ? JSON.stringify(err.details) : (err.error ?? 'Failed to add link.'),
        });
        return;
      }

      setMessage({ type: 'success', text: 'Link added.' });
      setLinkUrl('');
      setLinkLabel('');
      await onAssetsChanged();
    } catch {
      setMessage({ type: 'error', text: 'Failed to add link.' });
    }
  };

  const handleDelete = async (assetId: string) => {
    try {
      const res = await fetch(`/api/trades/${tradeId}/assets?id=${assetId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('Failed to delete asset', err);
        return;
      }

      await onAssetsChanged();
    } catch (err) {
      console.error('Failed to delete asset', err);
    }
  };

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="size-4 text-zinc-500" />
            Assets
          </CardTitle>
          <button
            onClick={() => {
              setShowForm((v) => !v);
              if (showForm) resetForm();
            }}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {showForm ? 'Cancel' : '+ Add Asset'}
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Asset form — collapsible */}
        {showForm && (
          <div className="mb-6 space-y-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
            {message && (
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  message.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
                }`}
              >
                {message.text}
              </div>
            )}

            {/* Mode toggle */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormMode('upload')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
                  formMode === 'upload'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                <Upload className="size-3" />
                Upload Screenshot
              </button>
              <button
                type="button"
                onClick={() => setFormMode('link')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
                  formMode === 'link'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                <LinkIcon className="size-3" />
                Add Link
              </button>
            </div>

            {formMode === 'upload' ? (
              <form onSubmit={handleUpload} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Screenshot File
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    className="w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-300 dark:text-zinc-400 dark:file:bg-zinc-700 dark:file:text-zinc-300 dark:hover:file:bg-zinc-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Phase
                  </label>
                  <div className="inline-block">
                    <Select value={uploadPhase} onValueChange={setUploadPhase}>
                      <SelectTrigger className="w-36">
                        <SelectValue placeholder="Select phase" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pre_trade">Pre-Trade</SelectItem>
                        <SelectItem value="entry">Entry</SelectItem>
                        <SelectItem value="management">Management</SelectItem>
                        <SelectItem value="exit">Exit</SelectItem>
                        <SelectItem value="review">Review</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Label{' '}
                    <span className="text-zinc-400 dark:text-zinc-500">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={uploadLabel}
                    onChange={(e) => setUploadLabel(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="Chart setup screenshot"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Upload
                </button>
              </form>
            ) : (
              <form onSubmit={handleAddLink} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    URL *
                  </label>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="https://www.tradingview.com/chart/..."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Phase
                  </label>
                  <div className="inline-block">
                    <Select value={linkPhase} onValueChange={setLinkPhase}>
                      <SelectTrigger className="w-36">
                        <SelectValue placeholder="Select phase" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pre_trade">Pre-Trade</SelectItem>
                        <SelectItem value="entry">Entry</SelectItem>
                        <SelectItem value="management">Management</SelectItem>
                        <SelectItem value="exit">Exit</SelectItem>
                        <SelectItem value="review">Review</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Label{' '}
                    <span className="text-zinc-400 dark:text-zinc-500">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={linkLabel}
                    onChange={(e) => setLinkLabel(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="TradingView chart analysis"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Add Link
                </button>
              </form>
            )}
          </div>
        )}

        {/* Asset gallery — grouped by phase */}
        {assets.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No assets attached to this trade yet.
          </p>
        ) : (
          <div className="space-y-6">
            {phases.map((phase) => {
              const phaseAssets = assets.filter((a) => a.phase === phase);
              if (phaseAssets.length === 0) return null;

              return (
                <div key={phase}>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {phaseLabel[phase]}
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {phaseAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="group relative w-40 rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-800/50"
                      >
                        {/* Delete button */}
                        <button
                          onClick={() => handleDelete(asset.id)}
                          className="absolute -right-1.5 -top-1.5 z-10 flex size-5 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-500 opacity-0 shadow-sm transition-colors hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-red-900/30"
                          aria-label={`Delete ${asset.label ?? 'asset'}`}
                        >
                          <Trash2 className="size-3" />
                        </button>

                        {asset.filePath ? (
                          /* Screenshot thumbnail */
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={asset.filePath}
                              alt={asset.label ?? 'Screenshot'}
                              className="mb-1 h-20 w-full rounded object-cover"
                            />
                            {asset.label && (
                              <p className="truncate text-xs text-zinc-700 dark:text-zinc-300">
                                {asset.label}
                              </p>
                            )}
                          </>
                        ) : asset.externalUrl ? (
                          /* Link card */
                          <a
                            href={asset.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mb-1 flex h-20 w-full flex-col items-center justify-center rounded bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                          >
                            <LinkIcon className="mb-1 size-5" />
                            <span className="max-w-[120px] truncate text-[10px]">
                              {new URL(asset.externalUrl).hostname}
                            </span>
                          </a>
                        ) : null}

                        {asset.label && !asset.filePath && (
                          <p className="truncate text-xs text-zinc-700 dark:text-zinc-300">
                            {asset.label}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
