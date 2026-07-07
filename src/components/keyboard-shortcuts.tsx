'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Shortcut {
  key: string;
  label: string;
}

const SHORTCUTS: Shortcut[] = [
  { key: 'd', label: 'Dashboard' },
  { key: 't', label: 'Trade Log' },
  { key: 'w', label: 'Watchlist' },
  { key: 's', label: 'Settings' },
  { key: 'r', label: 'Reviews' },
  { key: 'c', label: 'Checks' },
  { key: 'n', label: 'New Trade' },
  { key: '?', label: 'Show shortcuts' },
];

export function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey) return;

      switch (e.key) {
        case 'd': e.preventDefault(); router.push('/'); break;
        case 't': e.preventDefault(); router.push('/trades'); break;
        case 'w': e.preventDefault(); router.push('/watchlist'); break;
        case 's': e.preventDefault(); router.push('/settings'); break;
        case 'r': e.preventDefault(); router.push('/reviews'); break;
        case 'c': e.preventDefault(); router.push('/checks'); break;
        case 'n': e.preventDefault(); {
          const planBtn = document.querySelector<HTMLButtonElement>(
            'a[href*="trades"], button:has(svg.lucide-plus)'
          );
          if (planBtn) planBtn.click();
          else router.push('/trades');
          break;
        }
        case '?': e.preventDefault(); setShowOverlay((v) => !v); break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);

  return (
    <>
      {children}

      {/* Shortcuts overlay */}
      {showOverlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowOverlay(false)}
        >
          <div
            className="w-80 rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Keyboard Shortcuts
            </h3>
            <div className="space-y-2">
              {SHORTCUTS.map((s) => (
                <div key={s.key} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">{s.label}</span>
                  <kbd className="rounded-md border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
              Press <kbd className="rounded border border-zinc-300 px-1 text-[10px] dark:border-zinc-600">?</kbd> to toggle this overlay.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
