import type { Metadata } from 'next';
import { helpSections, helpPageTitle, helpPageDescription } from '@/lib/help-content';

export const metadata: Metadata = {
  title: `${helpPageTitle} — Trading Journal`,
  description: helpPageDescription,
};

// ── Block Renderers ─────────────────────────────────────────────────────

function BlockParagraph({ text }: { text: string }) {
  return <p className="text-sm leading-relaxed text-foreground">{text}</p>;
}

function BlockOrderedList({ items }: { items: string[] }) {
  return (
    <ol className="ml-5 list-decimal space-y-1.5 text-sm leading-relaxed text-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

function BlockUnorderedList({ items }: { items: string[] }) {
  return (
    <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function BlockNote({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
      {text}
    </div>
  );
}

function BlockWarning({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
      ⚠ {text}
    </div>
  );
}

function BlockStrong({ text }: { text: string }) {
  return <p className="text-sm font-semibold text-foreground">{text}</p>;
}

function BlockCode({ text }: { text: string }) {
  return (
    <code className="inline-block rounded-md bg-muted px-2 py-0.5 font-mono text-sm text-foreground">
      {text}
    </code>
  );
}

function renderBlock(block: import('@/lib/help-content').HelpBlock, i: number) {
  switch (block.type) {
    case 'paragraph':
      return <BlockParagraph key={i} text={block.text} />;
    case 'ordered-list':
      return <BlockOrderedList key={i} items={block.items} />;
    case 'unordered-list':
      return <BlockUnorderedList key={i} items={block.items} />;
    case 'note':
      return <BlockNote key={i} text={block.text} />;
    case 'warning':
      return <BlockWarning key={i} text={block.text} />;
    case 'strong':
      return <BlockStrong key={i} text={block.text} />;
    case 'code':
      return <BlockCode key={i} text={block.text} />;
    default:
      return null;
  }
}

// ── Section ─────────────────────────────────────────────────────────────

function HelpSectionCard({ section }: { section: import('@/lib/help-content').HelpSection }) {
  return (
    <section
      id={section.id}
      className="scroll-mt-20 rounded-xl border border-border bg-card p-6"
    >
      <h2 className="mb-1 text-lg font-semibold text-foreground">
        {section.title}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {section.description}
      </p>
      <div className="space-y-3">
        {section.blocks.map((block, i) => renderBlock(block, i))}
      </div>
    </section>
  );
}

// ── Table of Contents ───────────────────────────────────────────────────

function TableOfContents() {
  return (
    <nav className="sticky top-6 space-y-1" aria-label="On this page">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        On this page
      </p>
      {helpSections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="block rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {section.title}
        </a>
      ))}
    </nav>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {helpPageTitle}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {helpPageDescription}
        </p>
      </div>

      {/* Two-column layout: ToC + content */}
      <div className="flex gap-8">
        {/* Sidebar navigation */}
        <aside className="hidden w-48 shrink-0 lg:block">
          <TableOfContents />
        </aside>

        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-6">
          {helpSections.map((section) => (
            <HelpSectionCard key={section.id} section={section} />
          ))}

          {/* Footer note */}
          <p className="text-center text-xs text-muted-foreground">
            Last updated with app version 0.1.0
          </p>
        </div>
      </div>
    </div>
  );
}
