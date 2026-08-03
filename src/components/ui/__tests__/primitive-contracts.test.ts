/**
 * primitive-contracts.test.ts — M014/S03/T04
 *
 * Structural contract tests for the 14 UI primitives in src/components/ui.
 * The parallel guard to src/lib/__tests__/token-structure.test.ts (which
 * protects the CSS token definitions in globals.css); this file protects the
 * component source code that consumes those tokens:
 *
 *   1. Inventory — all 14 primitives exist as non-empty source files.
 *   2. data-slot — every primitive carries a kebab-case data-slot on its
 *      structural elements; a required slot inventory is enforced per file.
 *   3. No arbitrary color literals — hex / oklch( / rgb( / hsl( values are
 *      banned from primitive class strings; colors must come from semantic
 *      tokens.
 *   4. Arbitrary-value color utilities must reference var(--) tokens (e.g.
 *      button's hover:bg-[color-mix(...)]), never literals.
 *   5. Overlay + separator tokens — dialog/sheet overlays consume the
 *      semantic bg-overlay (not the theme-blind bg-black/10 that S01
 *      replaced), and Separator consumes bg-separator.
 *   6. Density tokens — interactive control heights come from the
 *      --density-* scale, not hardcoded h-6..h-10 Tailwind classes.
 *   7. Focus-visible — interactive primitives expose the normalized ring
 *      pattern (focus-visible:ring-3 + focus-visible:ring-ring/50) and
 *      suppress the default outline (WCAG 2.4.7 Focus Visible).
 *
 * Reading the .tsx sources from disk is intentional: this test guards the
 * component source itself, not a compiled or rendered copy. Runs under vitest
 * (jsdom env is fine — no DOM interaction here).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

/* ── Source loading ─────────────────────────────────────────────────────── */

const UI_DIR = path.resolve(process.cwd(), 'src/components/ui');

/** The 14 primitives normalized in M014/S03. */
const PRIMITIVES = [
  'badge',
  'button',
  'card',
  'collapsible',
  'dialog',
  'dropdown-menu',
  'input',
  'select',
  'separator',
  'sheet',
  'skeleton',
  'table',
  'tabs',
  'tooltip',
] as const;

type Primitive = (typeof PRIMITIVES)[number];

function loadPrimitive(name: Primitive): string {
  const file = path.join(UI_DIR, `${name}.tsx`);
  const src = fs.readFileSync(file, 'utf-8');
  expect(src.length, `${name}.tsx should not be empty`).toBeGreaterThan(50);
  return src;
}

const sources: Record<Primitive, string> = Object.fromEntries(
  PRIMITIVES.map((name) => [name, loadPrimitive(name)]),
) as Record<Primitive, string>;

/* ── Shared helpers ─────────────────────────────────────────────────────── */

/** Every data-slot="..." value declared in a source file. */
function slotNames(src: string): string[] {
  const slots: string[] = [];
  for (const m of src.matchAll(/data-slot="([^"]+)"/g)) slots.push(m[1]);
  return slots;
}

/**
 * Focus-visible indicator check. The normalized ring pattern (S03/T01–T03)
 * is `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`.
 * ring-3 is Tailwind v4's 3px ring width; ring-ring/50 is the 50%-alpha
 * semantic ring color. Ring-only controls (collapsible trigger) keep
 * `focus-visible:ring-3 focus-visible:ring-ring/50` without border-ring.
 */
function hasNormalizedFocusRing(src: string): boolean {
  return src.includes('focus-visible:ring-3') && src.includes('focus-visible:ring-ring/50');
}

/** Custom focus indicator present at all (ring, border, or background). */
function hasAnyFocusVisible(src: string): boolean {
  return /focus-visible:[\w-]+/.test(src);
}

/** Default outline suppressed (either outline-none or focus-visible:outline-none). */
function suppressesDefaultOutline(src: string): boolean {
  return src.includes('outline-none') || src.includes('focus-visible:outline-none');
}

/** Required root-level data-slots per primitive file. */
const REQUIRED_SLOTS: Record<Primitive, string[]> = {
  badge: ['badge'],
  button: ['button'],
  card: ['card', 'card-header', 'card-content', 'card-footer'],
  collapsible: ['collapsible', 'collapsible-trigger', 'collapsible-content'],
  dialog: ['dialog', 'dialog-overlay', 'dialog-content', 'dialog-trigger', 'dialog-close', 'dialog-title', 'dialog-description'],
  'dropdown-menu': ['dropdown-menu', 'dropdown-menu-trigger', 'dropdown-menu-content', 'dropdown-menu-item', 'dropdown-menu-separator'],
  input: ['input'],
  select: ['select', 'select-trigger', 'select-content', 'select-item', 'select-value'],
  separator: ['separator'],
  sheet: ['sheet', 'sheet-overlay', 'sheet-content', 'sheet-title', 'sheet-description'],
  skeleton: ['skeleton'],
  table: ['table', 'table-header', 'table-body', 'table-head', 'table-cell', 'table-row'],
  tabs: ['tabs', 'tabs-list', 'tabs-trigger', 'tabs-content'],
  tooltip: ['tooltip', 'tooltip-trigger', 'tooltip-content', 'tooltip-provider'],
};

/**
 * Interactive primitives that must expose the normalized focus-visible ring
 * pattern. Table rows intentionally use a background-highlight indicator
 * (focus-visible:bg-muted/80) because a ring on <tr> is not reliably
 * rendered; it is verified separately via hasAnyFocusVisible.
 */
const RING_PRIMITIVES: Primitive[] = ['badge', 'button', 'collapsible', 'dropdown-menu', 'input', 'select', 'tabs'];

/** Primitives that are keyboard-operable and must show *some* focus indicator. */
const FOCUSABLE_PRIMITIVES: Primitive[] = [...RING_PRIMITIVES, 'table'];

/**
 * Primitives whose heights are control/row sizes governed by the density
 * scale. badge's h-5 pill is a fixed decorative height (not a control) and
 * is exempt; card/separator/skeleton/tooltip have no control-height contract.
 */
const DENSITY_PRIMITIVES: Record<string, string[]> = {
  button: ['--density-control-h', '--density-control-h-sm'],
  input: ['--density-control-h'],
  select: ['--density-control-h'],
  table: ['--density-row-md'],
  tabs: ['--density-control-h-lg'],
};

/** Banned hardcoded Tailwind control heights (pre-S03 the scale was h-6..h-10). */
const BANNED_HEIGHTS = /\bh-(?:6|7|8|9|10)\b/;

/* ── 1. Inventory ───────────────────────────────────────────────────────── */

describe('primitive inventory', () => {
  it('all 14 primitives exist as non-empty source files', () => {
    for (const name of PRIMITIVES) {
      const src = sources[name];
      expect(src.length, `${name}.tsx should be non-trivial`).toBeGreaterThan(200);
    }
  });

  it('every primitive imports the cn() utility', () => {
    for (const name of PRIMITIVES) {
      expect(sources[name], `${name}.tsx should import cn from @/lib/utils`).toContain('cn');
    }
  });
});

/* ── 2. data-slot contract ──────────────────────────────────────────────── */

describe('data-slot contract', () => {
  it('every primitive declares at least one data-slot', () => {
    for (const name of PRIMITIVES) {
      const slots = slotNames(sources[name]);
      expect(slots.length, `${name}.tsx should declare data-slot attributes`).toBeGreaterThan(0);
    }
  });

  it('all data-slot values are kebab-case', () => {
    const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    for (const name of PRIMITIVES) {
      for (const slot of slotNames(sources[name])) {
        expect(slot, `${name}.tsx has malformed slot "${slot}"`).toMatch(kebab);
      }
    }
  });

  it('each primitive declares its required structural slots', () => {
    for (const name of PRIMITIVES) {
      const slots = slotNames(sources[name]);
      for (const required of REQUIRED_SLOTS[name]) {
        expect(slots, `${name}.tsx must declare data-slot="${required}"`).toContain(required);
      }
    }
  });
});

/* ── 3. No arbitrary color literals ─────────────────────────────────────── */

describe('semantic color contract (no arbitrary literals)', () => {
  const COLOR_LITERAL_PATTERNS: Array<[string, RegExp]> = [
    ['hex (#rgb/#rrggbb)', /#[0-9a-fA-F]{3,8}\b/],
    // Raw oklch( literal. button.tsx's color-mix(in_oklch,var(--secondary),...)
    // is safe: it reads "oklch," (a color-space keyword) not "oklch(".
    ['oklch( literal', /oklch\(/i],
    ['rgb( literal', /rgb\(/i],
    ['rgba( literal', /rgba\(/i],
    ['hsl( literal', /hsl\(/i],
    ['hsla( literal', /hsla\(/i],
  ];

  it.each(PRIMITIVES)('%s: no arbitrary color literals in class strings', (name) => {
    const src = sources[name];
    for (const [label, re] of COLOR_LITERAL_PATTERNS) {
      expect(src, `${name}.tsx contains a ${label}`).not.toMatch(re);
    }
  });

  it('no theme-blind scrim remnants (bg-black/* or bg-white/*)', () => {
    for (const name of PRIMITIVES) {
      expect(sources[name], `${name}.tsx reintroduced bg-black/*`).not.toMatch(/bg-black\//);
      expect(sources[name], `${name}.tsx reintroduced bg-white/*`).not.toMatch(/bg-white\//);
    }
  });

  it('arbitrary-value color utilities must reference var(--) tokens', () => {
    const arbitraryColor = /\b(?:bg|text|border|ring|fill|stroke)-\[([^\]]+)\]/g;
    // Pure lengths (e.g. text-[0.8rem]) are font sizes, not colors.
    const LENGTH_RE = /^[\d.]+(?:rem|em|px|%)?$/;
    for (const name of PRIMITIVES) {
      const matches = [...sources[name].matchAll(arbitraryColor)];
      for (const m of matches) {
        const inner = m[1];
        if (LENGTH_RE.test(inner.trim())) continue;
        expect(
          inner,
          `${name}.tsx arbitrary-value color ${m[0]} must reference a var(--) token, not a literal`,
        ).toContain('var(--');
      }
    }
  });
});

/* ── 4. Overlay + separator semantic tokens ─────────────────────────────── */

describe('overlay and separator semantic tokens', () => {
  it('dialog overlay consumes bg-overlay', () => {
    expect(sources.dialog).toContain('bg-overlay');
  });

  it('sheet overlay consumes bg-overlay', () => {
    expect(sources.sheet).toContain('bg-overlay');
  });

  it('neither dialog nor sheet uses the legacy bg-black/10 scrim', () => {
    expect(sources.dialog).not.toContain('bg-black/10');
    expect(sources.sheet).not.toContain('bg-black/10');
  });

  it('separator consumes the dedicated bg-separator token', () => {
    expect(sources.separator).toContain('bg-separator');
    expect(sources.separator).not.toContain('bg-border');
  });

  it('dialog and sheet overlays share byte-identical class sets', () => {
    // S03/T02 decision: stacking-context parity via `isolate` on both overlays.
    expect(sources.dialog).toContain('isolate');
    expect(sources.sheet).toContain('isolate');
  });
});

/* ── 5. Density token contract ──────────────────────────────────────────── */

describe('density token contract', () => {
  it.each(['button', 'input', 'select', 'table', 'tabs'] as const)(
    '%s consumes its density tokens',
    (name) => {
      for (const token of DENSITY_PRIMITIVES[name]) {
        expect(sources[name], `${name}.tsx must reference ${token}`).toContain(token);
      }
    },
  );

  it.each(PRIMITIVES)('%s: no hardcoded control-height classes (h-6..h-10)', (name) => {
    expect(sources[name], `${name}.tsx contains a hardcoded control height`).not.toMatch(BANNED_HEIGHTS);
  });
});

/* ── 6. Focus-visible contract (WCAG 2.4.7) ─────────────────────────────── */

describe('focus-visible contract', () => {
  it.each(FOCUSABLE_PRIMITIVES)('%s exposes a focus-visible indicator', (name) => {
    expect(hasAnyFocusVisible(sources[name]), `${name}.tsx must declare a focus-visible style`).toBe(true);
  });

  it.each(RING_PRIMITIVES)('%s uses the normalized ring pattern (ring-3 + ring-ring/50)', (name) => {
    expect(hasNormalizedFocusRing(sources[name]), `${name}.tsx must keep the normalized focus ring`).toBe(true);
  });

  it.each(FOCUSABLE_PRIMITIVES)('%s suppresses the default outline in favor of the custom indicator', (name) => {
    expect(suppressesDefaultOutline(sources[name]), `${name}.tsx must set outline-none (or focus-visible:outline-none)`).toBe(true);
  });

  it('table row uses a background-highlight focus indicator', () => {
    const rowBlock = sources.table;
    expect(rowBlock).toMatch(/focus-visible:outline-none/);
    expect(rowBlock).toMatch(/focus-visible:bg-muted\/80/);
  });
});

/* ── 7. Interaction-state consistency ───────────────────────────────────── */

describe('interaction-state consistency', () => {
  it.each(['button', 'input', 'select'] as const)('%s styles disabled state via opacity', (name) => {
    expect(sources[name]).toMatch(/disabled:opacity-50/);
  });

  it.each(['button', 'input', 'select'] as const)('%s handles aria-invalid with the destructive token', (name) => {
    expect(sources[name]).toContain('aria-invalid:border-destructive');
  });

  it('select trigger heights switch on data-size (sm vs default)', () => {
    expect(sources.select).toContain('data-[size=sm]:h-(--density-control-h-sm)');
    expect(sources.select).toContain('data-[size=default]:h-(--density-control-h)');
  });
});
