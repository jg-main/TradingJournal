import type { Metadata } from 'next';
import { helpSections, helpPageTitle, helpPageDescription } from '@/lib/help-content';

export const metadata: Metadata = {
  title: `${helpPageTitle} — Trading Journal`,
  description: helpPageDescription,
};

// ── Block Renderers ─────────────────────────────────────────────────────

function BlockParagraph({ text }: { text: string }) {
  return <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{text}</p>;
}

function BlockOrderedList({ items }: { items: string[] }) {
  return (
    <ol className="ml-5 list-decimal space-y-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

function BlockUnorderedList({ items }: { items: string[] }) {
  return (
    <ul className="ml-5 list-disc space-y-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function BlockNote({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
      {text}
    </div>
  );
}

function BlockWarning({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
      ⚠ {text}
    </div>
  );
}

function BlockStrong({ text }: { text: string }) {
  return <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{text}</p>;
}

function BlockCode({ text }: { text: string }) {
  return (
    <code className="inline-block rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-sm text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
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
      className="scroll-mt-20 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 className="mb-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {section.title}
      </h2>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
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
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        On this page
      </p>
      {helpSections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="block rounded-md px-2 py-1 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
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
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {helpPageTitle}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
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
          <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
            Last updated with app version 0.1.0
          </p>
        </div>
      </div>
    </div>
  );
}
