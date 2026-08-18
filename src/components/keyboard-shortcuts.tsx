'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Shortcut {
  key: string;
  label: string;
}

const SHORTCUTS: Shortcut[] = [
  { key: 'd', label: 'Dashboard' },
  { key: 't', label: 'Trades' },
  { key: 's', label: 'Settings' },
  { key: 'c', label: 'Checks' },
  { key: 'n', label: 'New Trade' },
  { key: '?', label: 'Show shortcuts' },
];

export function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // A nested surface (for example the workstation) may own the same key.
      // Its capture-phase handler prevents the event before this global
      // navigation layer sees it, avoiding duplicate overlays/actions.
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey) return;

      switch (e.key) {
        case 'd': e.preventDefault(); router.push('/'); break;
        case 't': e.preventDefault(); router.push('/trades'); break;
        case 's': e.preventDefault(); router.push('/settings'); break;
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
          onClick={() => setShowOverlay(false)}
        >
          <div
            className="w-80 rounded-xl border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-base font-semibold text-foreground">
              Keyboard Shortcuts
            </h3>
            <div className="space-y-2">
              {SHORTCUTS.map((s) => (
                <div key={s.key} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                  <kbd className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Press <kbd className="rounded border border-border px-1 text-[10px]">?</kbd> to toggle this overlay.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
