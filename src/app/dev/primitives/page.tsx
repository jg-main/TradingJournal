'use client';

/**
 * /dev/primitives — M014 S03 primitive proof surface.
 *
 * Dev-only page that renders all 14 normalized UI primitives (badge, button,
 * card, collapsible, dialog, dropdown-menu, input, select, separator, sheet,
 * skeleton, table, tabs, tooltip) through the real `src/components/ui/*`
 * components in both light and dark themes.
 *
 * Purpose: browser evidence for S03 — consistent hover/active/focus/disabled
 * states, full keyboard traversal, and WCAG AA contrast. Every control is
 * interactive: dialogs open/close, dropdowns navigate, selects select, tabs
 * switch, collapsibles expand, tooltips appear on focus, sheets slide in.
 *
 * Theme state is external DOM state consumed via useSyncExternalStore — the
 * toggle mutates the `.dark` class + localStorage exactly like the app's other
 * theme controls, and a MutationObserver drives re-renders.
 */

import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type ThemeName = 'light' | 'dark';

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

/* ── Presentation scaffolding ─────────────────────────────────────────── */

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

function DemoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 text-xs font-medium text-foreground">{title}</div>
      {children}
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
      {(['light', 'dark'] as const).map((t) => (
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

const NAV_LINKS = [
  { id: 'badge', label: 'Badge' },
  { id: 'button', label: 'Button' },
  { id: 'card', label: 'Card' },
  { id: 'collapsible', label: 'Collapsible' },
  { id: 'dialog', label: 'Dialog' },
  { id: 'dropdown', label: 'Dropdown' },
  { id: 'input', label: 'Input' },
  { id: 'select', label: 'Select' },
  { id: 'separator', label: 'Separator' },
  { id: 'sheet', label: 'Sheet' },
  { id: 'skeleton', label: 'Skeleton' },
  { id: 'table', label: 'Table' },
  { id: 'tabs', label: 'Tabs' },
  { id: 'tooltip', label: 'Tooltip' },
] as const;

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function PrimitivesProofPage() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as ThemeName);

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
                Primitives Proof — M014 S03
              </h1>
              <p className="truncate text-[11px] text-muted-foreground">
                14 normalized UI primitives · light &amp; dark · keyboard traversal · WCAG AA
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
            <ThemeToggle theme={theme} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1600px] flex-col gap-10 px-6 py-8">
        {/* ── Badge ─────────────────────────────────────────────────────── */}
        <Section
          id="badge"
          title="Badge"
          description="Semantic variants: default (primary), secondary, destructive, outline, ghost, link. Compact h-5 chip with focus-visible ring when interactive."
        >
          <DemoCard title="Variants">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="ghost">Ghost</Badge>
              <Badge variant="link">Link</Badge>
            </div>
          </DemoCard>
        </Section>

        {/* ── Button ────────────────────────────────────────────────────── */}
        <Section
          id="button"
          title="Button"
          description="Semantic variants and density-scaled sizes (xs 24px / sm 28px / default 32px / lg 36px / icon). Disabled state shown on the right."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <DemoCard title="Variants × sizes">
              <div className="flex flex-wrap items-center gap-2">
                <Button>Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-separator pt-3">
                <Button size="xs">xs</Button>
                <Button size="sm">sm</Button>
                <Button size="default">default</Button>
                <Button size="lg">lg</Button>
                <Button size="icon" aria-label="Icon only">
                  <span aria-hidden className="size-4 rounded-full bg-current" />
                </Button>
              </div>
            </DemoCard>
            <DemoCard title="States">
              <div className="flex flex-wrap items-center gap-2">
                <Button>Active</Button>
                <Button disabled>Disabled</Button>
                <Button variant="outline" disabled>
                  Outline disabled
                </Button>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Keyboard: Tab to focus — the normalized <code className="font-mono">focus-visible:ring-3 ring-ring/50</code>{' '}
                pattern draws a visible ring. Enter/Space activate. Disabled controls are skipped.
              </p>
            </DemoCard>
          </div>
        </Section>

        {/* ── Card ──────────────────────────────────────────────────────── */}
        <Section
          id="card"
          title="Card"
          description="Surface container: header, title, description, content, footer, and action slot."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Position summary</CardTitle>
                <CardDescription>Current open risk exposure.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Open P&amp;L</span>
                    <span className="font-medium tabular-nums text-positive">+$2,410.80</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Day change</span>
                    <span className="font-medium tabular-nums text-negative">−$640.25</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="justify-between">
                <Button size="sm" variant="outline">
                  Details
                </Button>
                <Button size="sm">Close position</Button>
              </CardFooter>
            </Card>
            <DemoCard title="Content-only card">
              <p className="text-sm text-muted-foreground">
                A card without header/footer — used for dense widgets like the watchlist. The card
                surface uses <code className="font-mono">--card</code> with a <code className="font-mono">--border</code> edge.
              </p>
            </DemoCard>
          </div>
        </Section>

        {/* ── Collapsible ───────────────────────────────────────────────── */}
        <Section
          id="collapsible"
          title="Collapsible"
          description="Trigger + content with default styling: cursor-pointer trigger, normalized focus ring, and animated expand/collapse."
        >
          <DemoCard title="Trade rationale">
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
                <span>Setup — inside-bar breakout</span>
                <span aria-hidden className="text-muted-foreground">
                  ▾
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden px-2 pt-1 text-sm leading-relaxed text-muted-foreground data-closed:animate-collapsible-up data-open:animate-collapsible-down">
                <p>
                  Entered on the inside-bar breakout at the 9:45 volume spike. Initial stop below the
                  bar low; target at the prior swing high. Risk 0.25% of equity.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </DemoCard>
        </Section>

        {/* ── Dialog ────────────────────────────────────────────────────── */}
        <Section
          id="dialog"
          title="Dialog"
          description="Modal with semantic --overlay scrim, focus trap, Escape to close, and title/description/footer slots."
        >
          <DemoCard title="Trade execution dialog">
            <Dialog>
              <DialogTrigger asChild>
                <Button>Open dialog</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add execution</DialogTitle>
                  <DialogDescription>
                    Record a fill for the active position. Prices settle at market close.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <label className="grid gap-1.5 text-xs font-medium text-foreground">
                    Shares
                    <Input defaultValue="100" inputMode="numeric" />
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium text-foreground">
                    Fill price
                    <Input defaultValue="182.40" inputMode="decimal" />
                  </label>
                </div>
                <DialogFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button>Save execution</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </DemoCard>
        </Section>

        {/* ── Dropdown menu ─────────────────────────────────────────────── */}
        <Section
          id="dropdown"
          title="Dropdown menu"
          description="Menu with items, group, labels, separators, and checkbox items. Opens on Enter/Space, navigates with arrows, closes on Escape."
        >
          <DemoCard title="Account menu">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Open menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="start">
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuItem disabled>Billing (soon)</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuCheckboxItem checked>Email alerts</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem>Executions feed</DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </DemoCard>
        </Section>

        {/* ── Input ─────────────────────────────────────────────────────── */}
        <Section
          id="input"
          title="Input"
          description="Density-scaled text inputs with placeholder, disabled, and read-only states."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <DemoCard title="States">
              <div className="grid gap-3">
                <Input placeholder="Symbol — e.g. AAPL" />
                <Input defaultValue="182.40" aria-label="Price" />
                <Input defaultValue="0.25" disabled aria-label="Risk % (disabled)" />
                <Input defaultValue="read-only value" readOnly aria-label="Read-only" />
              </div>
            </DemoCard>
            <DemoCard title="Density sizes">
              <div className="grid gap-3">
                <Input className="h-(--density-control-h-sm)" defaultValue="sm — 28px" aria-label="Compact input" />
                <Input defaultValue="default — 32px" aria-label="Default input" />
                <Input className="h-(--density-control-h-lg)" defaultValue="lg — 36px" aria-label="Large input" />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Height comes from the density scale; focus draws the normalized ring on <code className="font-mono">--ring</code>.
              </p>
            </DemoCard>
          </div>
        </Section>

        {/* ── Select ────────────────────────────────────────────────────── */}
        <Section
          id="select"
          title="Select"
          description="Native-feeling listbox with items, labels, and separators. Opens with Space/Enter, navigates with arrows, selects with Enter."
        >
          <DemoCard title="Timeframe">
            <Select defaultValue="1d">
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select timeframe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1m">1 minute</SelectItem>
                <SelectItem value="5m">5 minutes</SelectItem>
                <SelectItem value="1h">1 hour</SelectItem>
                <SelectItem value="1d">1 day</SelectItem>
                <SelectItem value="1w">1 week</SelectItem>
              </SelectContent>
            </Select>
          </DemoCard>
        </Section>

        {/* ── Separator ─────────────────────────────────────────────────── */}
        <Section
          id="separator"
          title="Separator"
          description="Semantic --separator token: horizontal and vertical dividers."
        >
          <DemoCard title="Horizontal + vertical">
            <div className="flex h-10 items-center gap-3">
              <span className="text-xs text-muted-foreground">Left</span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-xs text-muted-foreground">Middle</span>
              <Separator orientation="vertical" className="h-6" />
              <span className="text-xs text-muted-foreground">Right</span>
            </div>
            <Separator className="my-3" />
            <p className="text-xs text-muted-foreground">Divides stacked content without a visible border.</p>
          </DemoCard>
        </Section>

        {/* ── Sheet ─────────────────────────────────────────────────────── */}
        <Section
          id="sheet"
          title="Sheet"
          description="Slide-over panel with semantic --overlay scrim, focus trap, and Escape to close."
        >
          <DemoCard title="Position details">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Open sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Position details</SheetTitle>
                  <SheetDescription>
                    Full execution history and mark-to-market for the open position.
                  </SheetDescription>
                </SheetHeader>
                <div className="space-y-3 py-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Symbol</span>
                    <span className="font-medium">AAPL</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quantity</span>
                    <span className="font-medium tabular-nums">100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unrealized P&amp;L</span>
                    <span className="font-medium tabular-nums text-positive">+$412.60</span>
                  </div>
                </div>
                <SheetFooter>
                  <Button size="sm">Export</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </DemoCard>
        </Section>

        {/* ── Skeleton ──────────────────────────────────────────────────── */}
        <Section
          id="skeleton"
          title="Skeleton"
          description="Loading placeholder with pulse animation."
        >
          <DemoCard title="Loading watchlist">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-md" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-md" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
          </DemoCard>
        </Section>

        {/* ── Table ─────────────────────────────────────────────────────── */}
        <Section
          id="table"
          title="Table"
          description="Compact rows on the --density-row-md scale, right-aligned numerics, tabular numerals."
        >
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableCaption>Open positions — intraday snapshot</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Avg price</TableHead>
                  <TableHead className="text-right">P&amp;L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">AAPL</TableCell>
                  <TableCell>Long</TableCell>
                  <TableCell className="text-right tabular-nums">100</TableCell>
                  <TableCell className="text-right tabular-nums">182.40</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-positive">+$412.60</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">SPY</TableCell>
                  <TableCell>Short</TableCell>
                  <TableCell className="text-right tabular-nums">50</TableCell>
                  <TableCell className="text-right tabular-nums">554.10</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-negative">−$88.25</TableCell>
                </TableRow>
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4}>Net open P&amp;L</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">+$324.35</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </Section>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <Section
          id="tabs"
          title="Tabs"
          description="Segmented control with arrow-key navigation (WCAG tabs pattern)."
        >
          <DemoCard title="Execution view">
            <Tabs defaultValue="fills">
              <TabsList>
                <TabsTrigger value="fills">Fills</TabsTrigger>
                <TabsTrigger value="journal">Journal</TabsTrigger>
                <TabsTrigger value="mistakes">Mistakes</TabsTrigger>
              </TabsList>
              <TabsContent value="fills" className="mt-3 text-sm text-muted-foreground">
                3 fills recorded today. Arrow keys switch tabs; Enter activates.
              </TabsContent>
              <TabsContent value="journal" className="mt-3 text-sm text-muted-foreground">
                Journal entries are synced after market close.
              </TabsContent>
              <TabsContent value="mistakes" className="mt-3 text-sm text-muted-foreground">
                1 mistake tagged on the last session.
              </TabsContent>
            </Tabs>
          </DemoCard>
        </Section>

        {/* ── Tooltip ───────────────────────────────────────────────────── */}
        <Section
          id="tooltip"
          title="Tooltip"
          description="Floating label on hover and keyboard focus."
        >
          <DemoCard title="Risk badge">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" tabIndex={0} className="cursor-help">
                    Risk 0.25%
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Initial risk per trade — 0.25% of current equity</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </DemoCard>
        </Section>

        <footer className="pb-6 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            M014 · S03 · dev-only primitive proof surface. Components:{' '}
            <code className="font-mono">src/components/ui/*</code> · tokens:{' '}
            <code className="font-mono">src/app/globals.css</code>. Verify keyboard traversal with
            Tab/Shift+Tab, Enter/Space to activate, Escape to close overlays.
          </p>
        </footer>
      </main>
    </div>
  );
}
