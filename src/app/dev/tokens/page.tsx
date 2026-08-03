'use client';

/**
 * /dev/tokens — M014 token proof surface.
 *
 * Dev-only page that visually renders the complete Graphite + Steel Blue
 * semantic token system from src/app/globals.css in both light and dark
 * themes, plus the resolved ECharts palette from src/lib/chart-palette.ts.
 *
 * Design: industrial, precise, dense — the page itself is a working sample of
 * the token system. Every swatch renders through the actual Tailwind utility
 * (e.g. bg-card, text-positive) or the raw CSS variable (typography, density),
 * and every color card shows the live computed value read from the stylesheet.
 *
 * Theme and computed values are external DOM state, so they are consumed via
 * useSyncExternalStore (no setState-in-effect, no re-render cascade): the
 * toggle mutates the `.dark` class + localStorage exactly like the app's other
 * theme controls, and a MutationObserver drives re-renders.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { chartPalette, THEMES, type ThemeName } from '@/lib/chart-palette';
import { cn } from '@/lib/utils';

/* ── External store: active theme ─────────────────────────────────────── */

function getTheme(): ThemeName {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function subscribeTheme(onStoreChange: () => void): () => void {
  const el = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/* ── External store: live computed token values ───────────────────────── */

const TOKEN_VARS = [
  // Surfaces
  '--background', '--card', '--popover', '--muted', '--secondary',
  '--sidebar', '--sidebar-accent',
  // Text
  '--foreground', '--card-foreground', '--popover-foreground',
  '--muted-foreground', '--secondary-foreground', '--accent-foreground',
  '--primary-foreground', '--sidebar-foreground', '--sidebar-accent-foreground',
  // Financial state
  '--positive', '--negative', '--warning', '--missing', '--info',
  '--destructive', '--destructive-foreground',
  // Interaction
  '--primary', '--accent', '--ring',
  // Structure
  '--border', '--input', '--separator', '--radius',
  '--shadow-sm', '--shadow-md', '--shadow-lg',
  // Sidebar extras
  '--sidebar-primary', '--sidebar-primary-foreground', '--sidebar-border',
  '--sidebar-ring',
  // Charts
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
  '--chart-grid', '--chart-axis', '--chart-reference',
  // Typography
  '--font-size-xs', '--font-size-sm', '--font-size-md', '--font-size-base',
  '--font-size-lg', '--font-size-xl', '--font-size-2xl', '--font-size-3xl',
  // Density
  '--density-control-h-sm', '--density-control-h',
  '--density-row-sm', '--density-row-md',
  '--density-space-1', '--density-space-2', '--density-space-3',
  '--density-space-4', '--density-space-5', '--density-space-6',
] as const;

function readTokenValues(): string {
  if (typeof document === 'undefined') return '';
  const cs = getComputedStyle(document.documentElement);
  return TOKEN_VARS.map((v) => `${v}:${cs.getPropertyValue(v).trim()}`).join('|');
}

function subscribeTokens(onStoreChange: () => void): () => void {
  const el = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function parseTokenValues(blob: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!blob) return out;
  for (const pair of blob.split('|')) {
    const idx = pair.indexOf(':');
    if (idx > 0) out[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return out;
}

/* ── Small helpers ────────────────────────────────────────────────────── */

/**
 * Extract a hue angle (degrees, 0–360) from a browser-serialized color.
 *
 * Chromium serializes computed colors as `lab()`; other engines may return
 * `oklch()`/`lch()`. oklch hue and lab (atan2) hue angles are in the same
 * perceptual family — Steel Blue is ≈235° in oklch / ≈245° in lab — so the
 * green/steel family ranges below hold in both spaces.
 */
function hueOfComputedColor(value: string): number | null {
  const v = value.trim();
  const ok = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(v);
  if (ok) return Number(ok[3]);
  const lch = /^lch\(([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i.exec(v);
  if (lch) return Number(lch[3]);
  const lab = /^lab\(([\d.]+)%?\s+(-?[\d.]+)\s+(-?[\d.]+)/i.exec(v);
  if (lab) {
    const a = Number(lab[2]);
    const b = Number(lab[3]);
    const deg = (Math.atan2(b, a) * 180) / Math.PI;
    return deg < 0 ? deg + 360 : deg;
  }
  const hsl = /^hsl\(([\d.]+)/i.exec(v);
  if (hsl) return Number(hsl[1]);
  const rgb = parseRgb(v);
  if (rgb) return rgbToHue(rgb[0], rgb[1], rgb[2]);
  return null;
}

function parseRgb(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const rgb = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function rgbToHue(r: number, g: number, b: number): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  const deg = h * 60;
  return deg < 0 ? deg + 360 : deg;
}

/** Green family hues — reserved exclusively for financial --positive. */
function isGreenHue(h: number): boolean {
  return h >= 127 && h <= 165;
}

/** Steel Blue family hues — the M014 identity range. */
function isSteelHue(h: number): boolean {
  return h >= 200 && h <= 260;
}

/* ── Presentation primitives ──────────────────────────────────────────── */

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-section={id} className="scroll-mt-24 border-b border-border pb-10">
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SwatchCard({
  label,
  swatchClass,
  value,
  note,
  role,
}: {
  label: string;
  swatchClass: string;
  value?: string;
  note?: string;
  role?: string;
}) {
  return (
    <div data-token={label} data-role={role ?? 'token'} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className={cn('h-14 w-full rounded-md border border-separator', swatchClass)} />
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-foreground">{label}</div>
        {note ? (
          <div className="truncate text-[11px] leading-tight text-muted-foreground">{note}</div>
        ) : null}
        {value ? (
          <code className="mt-1 block truncate font-mono text-[10px] text-muted-foreground" title={value}>
            {value}
          </code>
        ) : null}
      </div>
    </div>
  );
}

function ThemeToggle({ theme }: { theme: ThemeName }) {
  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex overflow-hidden rounded-md border border-border bg-card p-0.5 shadow-sm"
    >
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={theme === t}
          onClick={() => {
            document.documentElement.classList.toggle('dark', t === 'dark');
            try {
              localStorage.setItem('theme', t);
            } catch {
              /* private browsing — class toggle still applies */
            }
          }}
          className={cn(
            'rounded-[4px] px-3 py-1 text-xs font-medium transition-colors',
            theme === t
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {t === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

const IDENTITY_TOKENS = [
  { varName: '--primary', label: 'primary', note: 'action color' },
  { varName: '--ring', label: 'ring', note: 'focus indicator' },
  { varName: '--sidebar-primary', label: 'sidebar-primary', note: 'nav identity' },
  { varName: '--chart-1', label: 'chart-1', note: 'primary series' },
] as const;

const SURFACES = [
  { varName: '--background', label: 'background', swatch: 'bg-background', note: 'App canvas' },
  { varName: '--card', label: 'card', swatch: 'bg-card', note: 'Panels & widgets' },
  { varName: '--popover', label: 'popover', swatch: 'bg-popover', note: 'Floating overlays' },
  { varName: '--muted', label: 'muted', swatch: 'bg-muted', note: 'Subtle fills' },
  { varName: '--secondary', label: 'secondary', swatch: 'bg-secondary', note: 'Secondary fills' },
  { varName: '--sidebar', label: 'sidebar', swatch: 'bg-sidebar', note: 'Navigation rail' },
  { varName: '--sidebar-accent', label: 'sidebar-accent', swatch: 'bg-sidebar-accent', note: 'Active nav item' },
] as const;

const TEXT_TOKENS = [
  { varName: '--foreground', label: 'foreground', text: 'text-foreground' },
  { varName: '--card-foreground', label: 'card-foreground', text: 'text-card-foreground' },
  { varName: '--popover-foreground', label: 'popover-foreground', text: 'text-popover-foreground' },
  { varName: '--muted-foreground', label: 'muted-foreground', text: 'text-muted-foreground' },
  { varName: '--secondary-foreground', label: 'secondary-foreground', text: 'text-secondary-foreground' },
  { varName: '--accent-foreground', label: 'accent-foreground', text: 'text-accent-foreground' },
  { varName: '--primary-foreground', label: 'primary-foreground', text: 'text-primary-foreground' },
  { varName: '--sidebar-foreground', label: 'sidebar-foreground', text: 'text-sidebar-foreground' },
  { varName: '--sidebar-accent-foreground', label: 'sidebar-accent-foreground', text: 'text-sidebar-accent-foreground' },
] as const;

const FINANCIAL = [
  { varName: '--positive', label: 'positive', swatch: 'bg-positive', text: 'text-positive', sample: '+$2,410.80', note: 'Profit — green reserved here only' },
  { varName: '--negative', label: 'negative', swatch: 'bg-negative', text: 'text-negative', sample: '−$640.25', note: 'Loss' },
  { varName: '--warning', label: 'warning', swatch: 'bg-warning', text: 'text-warning', sample: 'Margin below threshold', note: 'Caution' },
  { varName: '--missing', label: 'missing', swatch: 'bg-missing', text: 'text-missing', sample: 'No data available', note: 'Stale / absent data' },
  { varName: '--info', label: 'info', swatch: 'bg-info', text: 'text-info', sample: 'Informational note', note: 'Info' },
  { varName: '--destructive', label: 'destructive', swatch: 'bg-destructive', text: 'text-destructive', sample: 'Delete execution', note: 'Destructive / error' },
] as const;

const CHART_SERIES = [
  { varName: '--chart-1', label: 'chart-1', swatch: 'bg-chart-1', note: 'Steel blue — primary series' },
  { varName: '--chart-2', label: 'chart-2', swatch: 'bg-chart-2', note: 'Graphite — comparison / neutral' },
  { varName: '--chart-3', label: 'chart-3', swatch: 'bg-chart-3', note: 'Steel cyan — secondary series' },
  { varName: '--chart-4', label: 'chart-4', swatch: 'bg-chart-4', note: 'Indigo — categorical' },
  { varName: '--chart-5', label: 'chart-5', swatch: 'bg-chart-5', note: 'Warm gold — categorical accent' },
] as const;

const RADII = [
  { varName: '--radius-sm', label: 'sm' },
  { varName: '--radius-md', label: 'md' },
  { varName: '--radius-lg', label: 'lg' },
  { varName: '--radius-xl', label: 'xl' },
  { varName: '--radius-2xl', label: '2xl' },
  { varName: '--radius-3xl', label: '3xl' },
  { varName: '--radius-4xl', label: '4xl' },
] as const;

const SHADOWS = [
  { varName: '--shadow-sm', label: 'shadow-sm' },
  { varName: '--shadow-md', label: 'shadow-md' },
  { varName: '--shadow-lg', label: 'shadow-lg' },
] as const;

const TYPO = [
  { varName: '--font-size-xs', label: 'xs', note: 'metadata · table headers · badges' },
  { varName: '--font-size-sm', label: 'sm', note: 'compact body' },
  { varName: '--font-size-md', label: 'md', note: 'table cells · dense UI' },
  { varName: '--font-size-base', label: 'base', note: 'default body' },
  { varName: '--font-size-lg', label: 'lg', note: 'section headings' },
  { varName: '--font-size-xl', label: 'xl', note: 'page titles' },
  { varName: '--font-size-2xl', label: '2xl', note: 'panel / product headings' },
  { varName: '--font-size-3xl', label: '3xl', note: 'numeric KPIs' },
] as const;

const CONTROLS = [
  { varName: '--density-control-h-sm', label: 'control-h-sm', note: '28px — compact controls' },
  { varName: '--density-control-h', label: 'control-h', note: '32px — standard controls' },
] as const;

const ROWS = [
  { varName: '--density-row-sm', label: 'row-sm', note: '36px — dense table rows' },
  { varName: '--density-row-md', label: 'row-md', note: '40px — standard rows' },
] as const;

const SPACING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

const NAV_LINKS = [
  { id: 'identity', label: 'Identity' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'text', label: 'Text' },
  { id: 'financial', label: 'Financial' },
  { id: 'interaction', label: 'Interaction' },
  { id: 'structure', label: 'Structure' },
  { id: 'charts', label: 'Charts' },
  { id: 'typography', label: 'Typography' },
  { id: 'density', label: 'Density' },
] as const;

/** Dev-only console handle for the resolved palette (module-scope window exposure below). */
const PALETTE_IMPORT_HINT = `window.tjChartPalette`;

// Dev-only console handle: the slice demo requires the palette constants to be
// inspectable from the browser console. Next.js dev does not serve raw source
// paths as fetchable URLs, so expose the resolved light+dark palette on window
// (module scope — runs once on client import; SSR is guarded by typeof check).
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).tjChartPalette = chartPalette;
}

export default function TokenProofPage() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as ThemeName);
  const tokenBlob = useSyncExternalStore(subscribeTokens, readTokenValues, () => '');
  const values = useMemo(() => parseTokenValues(tokenBlob), [tokenBlob]);
  const palette = chartPalette[theme];

  // Identity audit: the no-green-primary proof, computed from live CSS values.
  const identityHues = IDENTITY_TOKENS.map((t) =>
    hueOfComputedColor(values[t.varName] ?? ''),
  );
  const positiveHue = hueOfComputedColor(values['--positive'] ?? '');
  const auditReady =
    identityHues.every((h) => h !== null) && positiveHue !== null;
  const auditPass =
    auditReady &&
    identityHues.every((h) => h !== null && isSteelHue(h) && !isGreenHue(h)) &&
    positiveHue !== null &&
    isGreenHue(positiveHue);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
              dev
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                Token Proof — M014 Graphite + Steel Blue
              </h1>
              <p className="truncate text-[11px] text-muted-foreground">
                Semantic token verification · light &amp; dark · 1440×900 / 1920×1080
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <nav aria-label="Sections" className="hidden items-center gap-1 xl:flex">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div
              data-audit={auditReady ? (auditPass ? 'pass' : 'fail') : 'checking'}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold tabular-nums',
                !auditReady && 'border-border text-muted-foreground',
                auditReady && auditPass && 'border-transparent bg-positive/10 text-positive',
                auditReady && !auditPass && 'border-transparent bg-destructive/10 text-destructive',
              )}
              title={
                auditReady
                  ? auditPass
                    ? 'Identity hues are Steel Blue (200–260°); green (127–165°) appears only in --positive.'
                    : 'Identity audit FAILED — a Steel Blue identity token resolved to a green hue.'
                  : 'Waiting for computed token values…'
              }
            >
              <span aria-hidden className={cn('size-1.5 rounded-full', auditPass ? 'bg-positive' : auditReady ? 'bg-destructive' : 'bg-muted-foreground')} />
              Identity {auditReady ? (auditPass ? 'PASS' : 'FAIL') : '…'}
            </div>
            <ThemeToggle theme={theme} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1600px] flex-col gap-10 px-6 py-8">
        {/* ── Identity audit ─────────────────────────────────────────────── */}
        <Section
          id="identity"
          title="Identity audit — no green primary hue"
          description="Steel Blue (oklch hue ≈ 235) is the action identity. Green (hue ≈ 152) is reserved exclusively for the --positive financial token. The audit below reads the live computed values from globals.css and fails loudly if any identity token resolves to a green hue."
        >
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
            {IDENTITY_TOKENS.map((t) => {
              const cssValue = values[t.varName] ?? '';
              const hue = cssValue ? hueOfComputedColor(cssValue) : null;
              return (
                <div
                  key={t.varName}
                  data-token={t.label}
                  data-role="identity"
                  className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3"
                >
                  <div
                    className="h-12 w-full rounded-md border border-separator"
                    style={{ backgroundColor: `var(${t.varName})` }}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground">{t.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{t.note}</div>
                    </div>
                    <span
                      data-hue={hue ?? ''}
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
                        hue !== null && isGreenHue(hue)
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {hue !== null ? `${Math.round(hue)}°` : '…'}
                    </span>
                  </div>
                  <code className="block truncate font-mono text-[10px] text-muted-foreground" title={cssValue}>
                    {cssValue || '…'}
                  </code>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Positive token: {values['--positive'] ?? '…'} — hue{' '}
            {positiveHue !== null
              ? `${Math.round(positiveHue)}° (green family: 127–165°)`
              : '…'}
            . Hue angles are read from the browser&apos;s computed color (serialized as{' '}
            <code className="font-mono">oklch()</code> or <code className="font-mono">lab()</code> depending on
            engine; the ranges above hold for both spaces). The resolved chart palette (below) derives its hex
            values from the same oklch tokens via convertOklchToHex in src/lib/chart-palette.ts.
          </p>
        </Section>

        {/* ── Surfaces ──────────────────────────────────────────────────── */}
        <Section
          id="surfaces"
          title="Surfaces"
          description="Light: white / cool graphite. Dark: designed graphite (not inversion). Borders and surface contrast carry separation; shadows are reserved for floating overlays."
        >
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
            {SURFACES.map((s) => (
              <SwatchCard
                key={s.varName}
                label={s.label}
                swatchClass={s.swatch}
                note={s.note}
                value={values[s.varName]}
              />
            ))}
          </div>
        </Section>

        {/* ── Text ──────────────────────────────────────────────────────── */}
        <Section
          id="text"
          title="Text"
          description="Foreground tokens rendered on a card surface. Tabular numerals for numeric data are a product convention."
        >
          <div className="divide-y divide-separator rounded-lg border border-border bg-card">
            {TEXT_TOKENS.map((t) => (
              <div key={t.varName} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className={cn('text-sm tabular-nums', t.text)}>
                  Ag 0123456789 — {t.label}
                </span>
                <code className="shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                  {values[t.varName]}
                </code>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Financial state ───────────────────────────────────────────── */}
        <Section
          id="financial"
          title="Financial state"
          description="The financial semantics of the palette. Green appears here — and only here — as profit. Each card shows the filled swatch and the same color used as text on a card surface."
        >
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
            {FINANCIAL.map((f) => (
              <div
                key={f.varName}
                data-token={f.label}
                className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-3"
              >
                <div className={cn('h-12 w-full rounded-md border border-separator', f.swatch)} />
                <div className={cn('mt-2 truncate text-sm font-semibold tabular-nums', f.text)}>
                  {f.sample}
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] text-muted-foreground">{f.note}</span>
                  <code className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {values[f.varName]}
                  </code>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Interaction ───────────────────────────────────────────────── */}
        <Section
          id="interaction"
          title="Interaction"
          description="Primary/action color is Steel Blue. Accent is a cool steel tint; the ring marks focus. Sampled on real controls."
        >
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium text-foreground">Primary action — bg-primary</div>
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                New trade
              </button>
              <code className="mt-3 block truncate font-mono text-[10px] text-muted-foreground">
                {values['--primary']}
              </code>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium text-foreground">Accent — bg-accent</div>
              <span className="inline-flex items-center rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                AAPL · Long
              </span>
              <code className="mt-3 block truncate font-mono text-[10px] text-muted-foreground">
                {values['--accent']}
              </code>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium text-foreground">Focus ring — ring-ring</div>
              <div className="inline-flex items-center gap-2 rounded-md ring-2 ring-ring ring-offset-2 ring-offset-background">
                <span className="px-2.5 py-1 text-xs text-muted-foreground">Focus target</span>
              </div>
              <code className="mt-3 block truncate font-mono text-[10px] text-muted-foreground">
                {values['--ring']}
              </code>
            </div>
          </div>
        </Section>

        {/* ── Structure ─────────────────────────────────────────────────── */}
        <Section
          id="structure"
          title="Structure — borders, radius, elevation"
          description="Border/input/separator separation colors, the radius scale, and elevation shadows. Shadows float overlays; borders carry everyday separation."
        >
          <div className="mb-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 text-xs font-medium text-foreground">--border</div>
              <div className="h-10 rounded-md border-2 border-border" />
              <code className="mt-2 block truncate font-mono text-[10px] text-muted-foreground">
                {values['--border']}
              </code>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 text-xs font-medium text-foreground">--input</div>
              <input
                readOnly
                value="0.25% risk / trade"
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground"
                aria-label="Input sample"
              />
              <code className="mt-2 block truncate font-mono text-[10px] text-muted-foreground">
                {values['--input']}
              </code>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 text-xs font-medium text-foreground">--separator</div>
              <div className="h-10 space-y-3">
                <div className="h-px bg-separator" />
                <div className="border-t border-dashed border-separator" />
              </div>
              <code className="mt-2 block truncate font-mono text-[10px] text-muted-foreground">
                {values['--separator']}
              </code>
            </div>
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium text-foreground">Radius scale — base {values['--radius'] || '…'}</div>
              <div className="flex flex-wrap items-end gap-3">
                {RADII.map((r) => (
                  <div key={r.varName} className="flex flex-col items-center gap-1">
                    <div
                      className="h-12 w-12 border border-separator bg-muted"
                      style={{ borderRadius: `var(${r.varName})` }}
                    />
                    <code className="font-mono text-[10px] text-muted-foreground">{r.label}</code>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium text-foreground">Elevation — shadow-sm / md / lg</div>
              <div className="grid gap-3 sm:grid-cols-3">
                {SHADOWS.map((s) => (
                  <div
                    key={s.varName}
                    data-shadow={s.label}
                    className="rounded-md bg-muted p-3"
                    style={{ boxShadow: `var(${s.varName})` }}
                  >
                    <div className="text-[11px] font-medium text-foreground">{s.label}</div>
                    <div className="mt-2 h-12 rounded border border-separator bg-card" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* ── Charts ────────────────────────────────────────────────────── */}
        <Section
          id="charts"
          title="Charts — CSS tokens + ECharts palette"
          description="Categorical series, grid/axis/reference tokens, and the 8-stop heatmap ramp. Hex values are the resolved chartPalette from src/lib/chart-palette.ts — pure JS, consumed by the ECharts widgets in S04."
        >
          <div className="mb-4 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
            {CHART_SERIES.map((c) => (
              <SwatchCard
                key={c.varName}
                label={c.label}
                swatchClass={c.swatch}
                note={c.note}
                value={values[c.varName]}
              />
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium text-foreground">Categorical series — palette.series</div>
              <div
                className="flex h-28 items-end gap-1.5 rounded-md border border-separator bg-background p-3"
                data-series-mock
              >
                {palette.series.map((c, i) => (
                  <div
                    key={i}
                    data-series={i + 1}
                    className="flex-1 rounded-t-sm"
                    style={{ height: `${[45, 70, 55, 85, 62][i]}%`, backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-x-3 font-mono text-[10px] text-muted-foreground">
                {palette.series.map((c, i) => (
                  <span key={i}>c{i + 1} {c}</span>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium text-foreground">Grid · axis · reference — ECharts</div>
              <div className="flex h-28 flex-col justify-between rounded-md border border-separator bg-background p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted-foreground">axis label</span>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--chart-axis)' }}>
                    {values['--chart-axis']}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <div className="h-px" style={{ backgroundColor: 'var(--chart-grid)' }} data-grid-line />
                  <div className="h-px" style={{ backgroundColor: 'var(--chart-grid)' }} />
                </div>
                <div className="h-0.5 rounded-full" style={{ backgroundColor: 'var(--chart-reference)' }} data-reference-line />
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-x-3 font-mono text-[10px] text-muted-foreground">
                <span>grid {palette.grid}</span>
                <span>axis {palette.axis}</span>
                <span>ref {palette.reference}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            <div className="mb-3 text-xs font-medium text-foreground">
              Heatmap ramp — palette.heatmap (8 stops, negative → positive)
            </div>
            <div className="flex h-9 overflow-hidden rounded-md border border-separator">
              {palette.heatmap.map((c, i) => (
                <div key={i} data-heatmap-stop={i} className="flex-1" style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>{palette.heatmap[0]} deepest negative</span>
              <span>{palette.heatmap[7]} deepest positive</span>
            </div>
          </div>
        </Section>

        {/* ── Typography ────────────────────────────────────────────────── */}
        <Section
          id="typography"
          title="Typography scale"
          description="Theme-independent font-size tokens consumed as var(--font-size-*). The product is dense: base body is 14px, table cells 13px."
        >
          <div className="divide-y divide-separator rounded-lg border border-border bg-card">
            {TYPO.map((t) => (
              <div key={t.varName} className="flex items-baseline justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div
                    className="truncate font-medium text-foreground"
                    style={{ fontSize: `var(${t.varName})` }}
                  >
                    Ag 0123456789 — The quick brown fox
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t.label} · {t.note}
                  </div>
                </div>
                <code className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {values[t.varName]}
                </code>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Density ───────────────────────────────────────────────────── */}
        <Section
          id="density"
          title="Density tokens"
          description="Control heights, row heights, and spacing scale. Consumed as var(--density-*); the compact variants are the workstation default."
        >
          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium text-foreground">Control heights</div>
              <div className="flex items-end gap-3">
                {CONTROLS.map((c) => (
                  <div key={c.varName} className="flex min-w-0 flex-col gap-1">
                    <button
                      type="button"
                      className="rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
                      style={{ height: `var(${c.varName})` }}
                    >
                      {c.label}
                    </button>
                    <code className="truncate font-mono text-[10px] text-muted-foreground">
                      {c.label} {values[c.varName]}
                    </code>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium text-foreground">Row heights</div>
              <div className="space-y-2">
                {ROWS.map((r) => (
                  <div key={r.varName} className="flex items-center gap-2">
                    <div
                      className="flex flex-1 items-center rounded-md border border-separator bg-background px-2"
                      style={{ height: `var(${r.varName})` }}
                    >
                      <span className="truncate text-[11px] text-muted-foreground">{r.label} · {r.note}</span>
                    </div>
                    <code className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {values[r.varName]}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 text-xs font-medium text-foreground">Spacing scale</div>
            <div className="flex flex-col gap-2">
              {SPACING_LEVELS.map((n) => (
                <div key={n} className="flex items-center gap-3">
                  <code className="w-24 shrink-0 font-mono text-[10px] text-muted-foreground">space-{n}</code>
                  <div
                    className="h-3 rounded-sm border border-separator bg-primary/40"
                    style={{ width: `var(--density-space-${n})` }}
                  />
                  <code className="font-mono text-[10px] text-muted-foreground">
                    {values[`--density-space-${n}`]}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </Section>

        <footer className="pb-6 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            M014 · dev-only token proof surface. Tokens: <code className="font-mono">src/app/globals.css</code> · ECharts
            palette: <code className="font-mono">src/lib/chart-palette.ts</code> — inspect in the console via{' '}
            <code className="font-mono">{PALETTE_IMPORT_HINT}</code>.
          </p>
        </footer>
      </main>
    </div>
  );
}
