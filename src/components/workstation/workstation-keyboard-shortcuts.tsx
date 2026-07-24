'use client';

// WorkstationKeyboardShortcuts — keyboard navigation system for the
// workstation surface.
//
// Handles high-frequency workstation operations without modifier keys:
//   [ / ]  — cycle through accounts (previous / next)
//   1 – 6   — focus panels (KPIs, Equity, Positions, Watchlist, Risk, Setups)
//   ?       — toggle keyboard shortcut overlay
//   Escape  — dismiss the overlay
//
// Ignores keydown events when focus is inside input, textarea, select, or
// contentEditable elements.  Also ignores events when Ctrl, Alt, or Meta is
// held so system / browser shortcuts pass through unchanged.
//
// Isolated from the legacy KeyboardShortcutsProvider: the workstation layout
// at (workstation)/layout.tsx intentionally omits it, so no shortcut conflict
// is possible on the /workspace route.
//
// The shortcut overlay is rendered inline (no portal) inside the workstation
// component tree so it inherits the workstation CSS scope (.ws) and theme
// tokens.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWorkstation } from './workstation-context';

// ── Panel mapping ─────────────────────────────────────────────────────────

/** Grid-area label for each panel-number shortcut. */
const PANEL_MAP: Record<string, { area: string; label: string }> = {
  '1': { area: 'kpis', label: 'KPIs' },
  '2': { area: 'equity', label: 'Equity Curve' },
  '3': { area: 'positions', label: 'Positions' },
  '4': { area: 'watchlist', label: 'Watchlist' },
  '5': { area: 'risk', label: 'Risk' },
  '6': { area: 'insights', label: 'Setups & Insights' },
};

/** Ordered entries rendered in the shortcut overlay. */
const SHORTCUT_ENTRIES: { keys: string; label: string }[] = [
  { keys: '[', label: 'Previous Account' },
  { keys: ']', label: 'Next Account' },
  { keys: '1', label: 'Focus KPIs' },
  { keys: '2', label: 'Focus Equity Curve' },
  { keys: '3', label: 'Focus Positions' },
  { keys: '4', label: 'Focus Watchlist' },
  { keys: '5', label: 'Focus Risk' },
  { keys: '6', label: 'Focus Setups & Insights' },
  { keys: '?', label: 'Toggle Shortcut Overlay' },
  { keys: 'Escape', label: 'Dismiss Overlay' },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

// ── Shortcut overlay ──────────────────────────────────────────────────────

function KeyboardShortcutOverlay({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="ws-keynav-backdrop"
      data-testid="ws-keynav-backdrop"
      onClick={onDismiss}
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <section
        className="ws-keynav-overlay"
        data-testid="ws-keynav-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ws-keynav-header">
          <span className="ws-keynav-title">Keyboard Shortcuts</span>
          <button
            className="ws-keynav-close"
            onClick={onDismiss}
            aria-label="Close shortcut overlay"
            data-testid="ws-keynav-close"
            type="button"
          >
            ✕
          </button>
        </header>
        <div className="ws-keynav-body">
          {SHORTCUT_ENTRIES.map((entry) => (
            <div key={entry.keys} className="ws-keynav-row">
              <span className="ws-keynav-label">{entry.label}</span>
              <kbd className="ws-keynav-kbd">{entry.keys}</kbd>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function WorkstationKeyboardShortcuts() {
  const { accounts, activeAccountId, setActiveAccountId } = useWorkstation();

  const [overlayVisible, setOverlayVisible] = useState(false);
  // Ref so the event handler always reads the latest overlay state without
  // re-registering the listener on every toggle.
  const overlayRef = useRef(false);

  useEffect(() => {
    overlayRef.current = overlayVisible;
  }, [overlayVisible]);

  // ── Account cycling ────────────────────────────────────────────────

  const cycleAccount = useCallback(
    (direction: -1 | 1) => {
      if (accounts.length <= 1) return;
      const idx = accounts.findIndex((a) => a.id === activeAccountId);
      if (idx === -1) return;
      const next = (idx + direction + accounts.length) % accounts.length;
      setActiveAccountId(accounts[next].id);
    },
    [accounts, activeAccountId, setActiveAccountId],
  );

  // ── Panel focus ─────────────────────────────────────────────────────

  const focusPanel = useCallback((area: string) => {
    const el = document.querySelector<HTMLElement>(
      `[data-testid="ws-panel-${area}"]`,
    );
    if (!el) return;

    // Make the element focusable so :focus styles render a visible ring.
    if (el.getAttribute('tabindex') === null) {
      el.setAttribute('tabindex', '-1');
    }
    el.focus({ preventScroll: false });
  }, []);

  // ── Keydown listener ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const { key } = e;

      // Escape: dismiss overlay (only when it is visible)
      if (key === 'Escape') {
        if (overlayRef.current) {
          e.preventDefault();
          setOverlayVisible(false);
        }
        return;
      }

      // ?: toggle overlay
      if (key === '?') {
        e.preventDefault();
        setOverlayVisible((v) => !v);
        return;
      }

      // [: previous account
      if (key === '[') {
        e.preventDefault();
        cycleAccount(-1);
        return;
      }

      // ]: next account
      if (key === ']') {
        e.preventDefault();
        cycleAccount(1);
        return;
      }

      // 1-6: focus panel
      const panel = PANEL_MAP[key];
      if (panel) {
        e.preventDefault();
        focusPanel(panel.area);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cycleAccount, focusPanel]);

  // ── Overlay (conditional) ───────────────────────────────────────────

  if (!overlayVisible) return null;

  return <KeyboardShortcutOverlay onDismiss={() => setOverlayVisible(false)} />;
}
