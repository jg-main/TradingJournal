'use client';

import { useState, useRef } from 'react';
import { ImageIcon, LinkIcon, Trash2, Upload, X, ClipboardPaste } from 'lucide-react';

import { extractApiErrorMessage } from '@/lib/error-utils';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TradeAsset } from './types';

interface TradeAssetsCardProps {
  assets: TradeAsset[];
  tradeId: string;
  onAssetsChanged: () => Promise<void>;
  /** Default phase for paste/drop uploads — changes based on trade lifecycle stage */
  defaultPhase?: string;
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
  defaultPhase = 'pre_trade',
}: TradeAssetsCardProps) {
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'upload' | 'link'>('upload');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Drag state
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPhase, setUploadPhase] = useState<string>(defaultPhase ?? 'pre_trade');
  const [uploadLabel, setUploadLabel] = useState('');

  // Link state
  const [linkUrl, setLinkUrl] = useState('');
  const [linkPhase, setLinkPhase] = useState<string>('pre_trade');
  const [linkLabel, setLinkLabel] = useState('');

  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const resetForm = () => {
    setUploadFile(null);
    setUploadPhase(defaultPhase ?? 'pre_trade');
    setUploadLabel('');
    setLinkUrl('');
    setLinkPhase('pre_trade');
    setLinkLabel('');
    setMessage(null);
  };

  /** Upload a file via the API — shared by file input, paste, and drop */
  const uploadFileToTrade = async (file: File, phase: string, label?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('phase', phase);
    if (label?.trim()) formData.append('label', label.trim());

    const res = await fetch(`/api/trades/${tradeId}/assets`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(extractApiErrorMessage(err));
    }

    setUploadFile(null);
    setUploadLabel('');
    await onAssetsChanged();
  };

  /** Handle paste from clipboard */
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files = e.clipboardData.files;

    // Image from clipboard (screenshot)
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      e.preventDefault();
      setMessage(null);
      try {
        await uploadFileToTrade(files[0], uploadPhase, uploadLabel || 'Pasted screenshot');
        setMessage({ type: 'success', text: 'Screenshot pasted.' });
      } catch (err) {
        setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Paste failed.' });
      }
      return;
    }

    // Text from clipboard — save as .txt
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      e.preventDefault();
      const blob = new Blob([text], { type: 'text/plain' });
      const file = new File([blob], `note-${Date.now()}.txt`, { type: 'text/plain' });
      setMessage(null);
      try {
        await uploadFileToTrade(file, uploadPhase, uploadLabel || 'Pasted note');
        setMessage({ type: 'success', text: 'Note pasted.' });
      } catch (err) {
        setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Paste failed.' });
      }
    }
  };

  /** Handle drag events */
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    dragCounter.current = 0;

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Only image files are supported.' });
      return;
    }

    setMessage(null);
    try {
      await uploadFileToTrade(file, uploadPhase, uploadLabel || 'Dropped screenshot');
      setMessage({ type: 'success', text: 'Screenshot uploaded.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed.' });
    }
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
          text: extractApiErrorMessage(err),
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
          text: extractApiErrorMessage(err),
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
        {/* Paste / Drop zone — always visible */}
        <div
          onPaste={handlePaste}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`mb-4 flex cursor-default flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 transition-colors ${
            dragOver
              ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800'
              : 'border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500'
          }`}
        >
          <ClipboardPaste className="mb-1 size-5 text-zinc-400" />
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {dragOver ? 'Drop here' : 'Paste screenshot (Ctrl+V) or drag & drop'}
          </p>
        </div>

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
                  <label htmlFor="ta-screenshot" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Screenshot File
                  </label>
                  <input
                    id="ta-screenshot"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    className="w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-300 dark:text-zinc-400 dark:file:bg-zinc-700 dark:file:text-zinc-300 dark:hover:file:bg-zinc-600"
                  />
                </div>
                <div>
                  <label htmlFor="ta-uploadPhase" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Phase
                  </label>
                  <div className="inline-block">
                    <Select value={uploadPhase} onValueChange={setUploadPhase}>
                      <SelectTrigger id="ta-uploadPhase" className="w-36">
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
                  <label htmlFor="ta-uploadLabel" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Label{' '}
                    <span className="text-zinc-500 dark:text-zinc-400">(optional)</span>
                  </label>
                  <input
                    id="ta-uploadLabel"
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
                  disabled={!uploadFile}
                >
                  Upload
                </button>
              </form>
            ) : (
              <form onSubmit={handleAddLink} className="space-y-3">
                <div>
                  <label htmlFor="ta-linkUrl" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    URL *
                  </label>
                  <input
                    id="ta-linkUrl"
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    placeholder="https://www.tradingview.com/chart/..."
                  />
                </div>
                <div>
                  <label htmlFor="ta-linkPhase" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Phase
                  </label>
                  <div className="inline-block">
                    <Select value={linkPhase} onValueChange={setLinkPhase}>
                      <SelectTrigger id="ta-linkPhase" className="w-36">
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
                  <label htmlFor="ta-linkLabel" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Label{' '}
                    <span className="text-zinc-500 dark:text-zinc-400">(optional)</span>
                  </label>
                  <input
                    id="ta-linkLabel"
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
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No assets attached to this trade yet.
          </p>
        ) : (
          <div className="space-y-6">
            {phases.map((phase) => {
              const phaseAssets = assets.filter((a) => a.phase === phase);
              if (phaseAssets.length === 0) return null;

              return (
                <div key={phase}>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
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
                          className="absolute -right-1.5 -top-1.5 z-10 flex min-w-11 min-h-11 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 opacity-0 shadow-sm transition-colors hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-red-900/30"
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
                              className="mb-1 h-40 w-full rounded object-cover cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => setExpandedImage(asset.filePath ?? null)}
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

      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setExpandedImage(null)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setExpandedImage(null); }}
            className="absolute right-4 top-4 rounded-full bg-black/50 p-3 text-white hover:bg-black/70 z-10"
            aria-label="Close lightbox"
          >
            <X className="size-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={expandedImage}
            alt="Full-size screenshot"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Card>
  );
}
