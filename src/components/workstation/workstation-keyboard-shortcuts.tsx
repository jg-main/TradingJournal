'use client';

// WorkstationKeyboardShortcuts — keyboard navigation system for the
// workstation surface.
//
// Handles high-frequency workstation operations without modifier keys:
//   [ / ]  — cycle through accounts (previous / next)
//   1 – 7   — focus panels (KPIs, Account State, Positions, Watchlist, Risk,
//             Process Review, Performance)
//   ↑ / ↓   — navigate table rows within focused Positions / Watchlist panels
//   Enter   — highlight/unhighlight the active row
//   ?       — toggle keyboard shortcut overlay
//   Escape  — dismiss the overlay
//
// Ignores keydown events when focus is inside input, textarea, select, or
// contentEditable elements.  Also ignores events when Ctrl, Alt, or Meta is
// held so system / browser shortcuts pass through unchanged.
//
// The development harness is isolated from the application shortcut provider.
// On the production root, this listener runs in the capture phase and prevents
// handled workstation keys before the global navigation layer sees them.
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
  '2': { area: 'account-state', label: 'Account State' },
  '3': { area: 'positions', label: 'Positions' },
  '4': { area: 'watchlist', label: 'Watchlist' },
  '5': { area: 'risk', label: 'Risk' },
  '6': { area: 'process-review', label: 'Process Review' },
  '7': { area: 'performance', label: 'Performance' },
};

/** Ordered entries rendered in the shortcut overlay. */
const SHORTCUT_ENTRIES: { keys: string; label: string }[] = [
  { keys: '[', label: 'Previous Account' },
  { keys: ']', label: 'Next Account' },
  { keys: '1', label: 'Focus KPIs' },
  { keys: '2', label: 'Focus Account State' },
  { keys: '3', label: 'Focus Positions' },
  { keys: '4', label: 'Focus Watchlist' },
  { keys: '5', label: 'Focus Risk' },
  { keys: '6', label: 'Focus Process Review' },
  { keys: '7', label: 'Focus Performance' },
  { keys: '?', label: 'Toggle Shortcut Overlay' },
  { keys: 'Escape', label: 'Dismiss Overlay' },
];

// ── Helpers ───────────────────────────────────────────────────────────────

/** Table panel areas that support row navigation. */
const TABLE_PANELS = new Set(['positions', 'watchlist']);

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/** Determine which panel area (if any) currently holds focus. */
function getFocusedTablePanel(): { area: string; el: HTMLElement; tbody: HTMLTableSectionElement } | null {
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) return null;
  const area = el.getAttribute('data-testid')?.replace('ws-panel-', '') ?? null;
  if (!area || !TABLE_PANELS.has(area)) return null;
  const tbody = el.querySelector('tbody');
  if (!tbody) return null;
  return { area, el, tbody };
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
  // Table row navigation state.
  const focusedPanelRef = useRef<string | null>(null);
  const activeRowIndexRef = useRef<number>(0);
  const activeRowCountRef = useRef<number>(0);
  // Track highlighted rows (Enter-pinned) by row element dataset.
  const highlightedRowsRef = useRef<Set<string>>(new Set());
  // Announcer ref for ARIA live announcements.
  const announcerRef = useRef<HTMLDivElement | null>(null);

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
    // 1. Clear prior row-active class on any currently-focused panel.
    const priorPanel = document.activeElement;
    if (priorPanel && priorPanel instanceof HTMLElement) {
      const priorArea = priorPanel.getAttribute('data-testid')?.replace('ws-panel-', '');
      if (priorArea && TABLE_PANELS.has(priorArea)) {
        const priorRows = priorPanel.querySelectorAll<HTMLElement>('.ws-row-active');
        priorRows.forEach((r) => r.classList.remove('ws-row-active'));
      }
    }

    const el = document.querySelector<HTMLElement>(
      `[data-testid="ws-panel-${area}"]`,
    );
    if (!el) return;

    // Make the element focusable so :focus styles render a visible ring.
    if (el.getAttribute('tabindex') === null) {
      el.setAttribute('tabindex', '-1');
    }
    el.focus({ preventScroll: false });

    // 2. If it's a table panel, reset row navigation to first row.
    if (TABLE_PANELS.has(area)) {
      activeRowIndexRef.current = 0;
      // Schedule DOM update after React / browser render cycle.
      requestAnimationFrame(() => {
        const tbody = el.querySelector('tbody');
        if (!tbody) return;
        const rows = tbody.querySelectorAll<HTMLTableRowElement>('tr');
        if (rows.length > 0) {
          rows[0].classList.add('ws-row-active');
          activeRowCountRef.current = rows.length;
          focusedPanelRef.current = area;
        }
      });
    } else {
      focusedPanelRef.current = null;
    }
  }, []);

  // ── Announce helper ────────────────────────────────────────────────

  const announce = useCallback((message: string) => {
    const el = announcerRef.current;
    if (!el) return;
    // Clear first so repeated identical messages are re-announced.
    el.textContent = '';
    requestAnimationFrame(() => {
      el.textContent = message;
    });
  }, []);

  // Announce account changes via the ARIA live region.
  useEffect(() => {
    const account = accounts.find((a) => a.id === activeAccountId);
    if (account) {
      announce(`Active account: ${account.name}`);
    }
  }, [activeAccountId, accounts, announce]);

  // ── Keydown listener ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const { key } = e;

      // ── Overlay / account / panel shortcuts ───────────────────────
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

      // 1-7: focus panel
      const panel = PANEL_MAP[key];
      if (panel) {
        e.preventDefault();
        focusPanel(panel.area);
        return;
      }

      // ── Table row navigation (ArrowUp / ArrowDown / Enter) ─────────
      // Only when focus is on a table panel (positions / watchlist).
      const focused = getFocusedTablePanel();
      if (!focused) return;

      if (key === 'ArrowDown') {
        e.preventDefault();
        const rows = focused.tbody.querySelectorAll<HTMLTableRowElement>('tr');
        if (rows.length === 0) return;
        const maxIdx = rows.length - 1;
        const curIdx = activeRowIndexRef.current;
        // Remove active class from current row
        if (curIdx >= 0 && curIdx < rows.length) {
          rows[curIdx].classList.remove('ws-row-active');
        }
        // Advance, clamp
        const nextIdx = Math.min(curIdx + 1, maxIdx);
        rows[nextIdx].classList.add('ws-row-active');
        activeRowIndexRef.current = nextIdx;
        activeRowCountRef.current = rows.length;
        focusedPanelRef.current = focused.area;
        return;
      }

      if (key === 'ArrowUp') {
        e.preventDefault();
        const rows = focused.tbody.querySelectorAll<HTMLTableRowElement>('tr');
        if (rows.length === 0) return;
        const curIdx = activeRowIndexRef.current;
        // Remove active class from current row
        if (curIdx >= 0 && curIdx < rows.length) {
          rows[curIdx].classList.remove('ws-row-active');
        }
        // Retreat, clamp
        const nextIdx = Math.max(curIdx - 1, 0);
        rows[nextIdx].classList.add('ws-row-active');
        activeRowIndexRef.current = nextIdx;
        activeRowCountRef.current = rows.length;
        focusedPanelRef.current = focused.area;
        return;
      }

      if (key === 'Enter') {
        e.preventDefault();
        const rows = focused.tbody.querySelectorAll<HTMLTableRowElement>('tr');
        if (rows.length === 0) return;
        const curIdx = activeRowIndexRef.current;
        if (curIdx < 0 || curIdx >= rows.length) return;
        const row = rows[curIdx];
        const isHighlighted = row.classList.toggle('ws-row-highlighted');

        // Track in ref set for persistence across scenario changes.
        const rowKey =
          row.getAttribute('data-testid') ?? `${focused.area}-row-${curIdx}`;
        if (isHighlighted) {
          highlightedRowsRef.current.add(rowKey);
          announce(`Row highlighted: ${row.textContent?.trim().split(/\s+/)[0] ?? 'unknown'}`);
        } else {
          highlightedRowsRef.current.delete(rowKey);
        }
        return;
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [cycleAccount, focusPanel, announce]);

  // ── Overlay (conditional) / ARIA announcer ──────────────────────────

  // The announcer is always rendered (visually hidden) so screen readers
  // can announce account switches and row highlight toggles.
  // The overlay renders only when visible.
  return (
    <>
      <div
        ref={announcerRef}
        className="ws-a11y-announcer"
        aria-live="polite"
        aria-atomic="true"
        data-testid="ws-a11y-announcer"
      />
      {overlayVisible && (
        <KeyboardShortcutOverlay
          onDismiss={() => setOverlayVisible(false)}
        />
      )}
    </>
  );
}
