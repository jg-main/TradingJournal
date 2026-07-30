'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  label: string;
  action: () => void;
}

export function useKeyboardShortcuts(extraShortcuts: Shortcut[] = []) {
  const router = useRouter();

  const defaultShortcuts: Shortcut[] = useMemo(
    () => [
      { key: 'd', label: 'Dashboard', action: () => router.push('/') },
      { key: 't', label: 'Trades', action: () => router.push('/trades') },
      { key: 'w', label: 'Watchlist', action: () => router.push('/watchlist') },
      { key: 's', label: 'Settings', action: () => router.push('/settings') },
      { key: 'r', label: 'Reviews', action: () => router.push('/reviews') },
      { key: 'c', label: 'Checks', action: () => router.push('/checks') },
      { key: 'n', label: 'New Trade', action: () => {
        const planBtn = document.querySelector<HTMLButtonElement>('button:has(svg.lucide-plus)');
        planBtn?.click();
      }},
    ],
    [router],
  );

  const allShortcuts = useMemo(
    () => [...defaultShortcuts, ...extraShortcuts],
    [defaultShortcuts, extraShortcuts],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Ignore if modifier is held (except for defined ctrl/meta shortcuts)
      if (e.metaKey || e.ctrlKey) return;

      const shortcut = allShortcuts.find((s) => s.key === e.key && !e.shiftKey && !e.altKey);
      if (shortcut) {
        e.preventDefault();
        shortcut.action();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [allShortcuts, router]);

  return { shortcuts: allShortcuts };
}
