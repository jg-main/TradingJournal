'use client';

import { useEffect } from 'react';

type RestoreUploadHandler = (file: File) => void;

declare global {
  interface Window {
    __tradingJournalRestoreUploadHandler?: RestoreUploadHandler;
    __tradingJournalRestoreUploadBridgeInstalled?: boolean;
  }
}

// Brave's native file picker can bypass React's delegated input/change events
// during local development. Install one browser-level capture listener outside
// React, then forward the actual File to the mounted modal handler.
if (typeof window !== 'undefined' && !window.__tradingJournalRestoreUploadBridgeInstalled) {
  window.__tradingJournalRestoreUploadBridgeInstalled = true;
  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.id !== 'backup-upload-file') return;
    const file = target.files?.[0];
    if (file) window.__tradingJournalRestoreUploadHandler?.(file);
  }, true);
}

export function useRestoreUploadBridge(handler: RestoreUploadHandler): void {
  useEffect(() => {
    window.__tradingJournalRestoreUploadHandler = handler;
    return () => {
      if (window.__tradingJournalRestoreUploadHandler === handler) {
        delete window.__tradingJournalRestoreUploadHandler;
      }
    };
  }, [handler]);
}
