#!/usr/bin/env node
/**
 * journal-lib.mjs
 *
 * Core logic for the `journal` CLI: reads the GSD event journal
 * (.gsd/journal/*.jsonl — one file per day, one JSON event per line),
 * merges it in chronological order, and renders a human-readable or
 * machine-readable (NDJSON) view of the most recent entries.
 *
 * Zero-dependency: only Node built-ins. Importable by the CLI wrapper
 * (scripts/journal.mjs) and by tests.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Default journal directory, relative to the working directory. */
export const DEFAULT_JOURNAL_DIR = '.gsd/journal';

/** Number of entries shown when no --limit is given. */
export const DEFAULT_LIMIT = 20;

/** Wrap a long string with an ellipsis. */
export function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + '...';
}

/**
 * Parse CLI arguments.
 * @param {string[]} argv
 * @returns {{ limit: number, json: boolean, all: boolean, help: boolean,
 *             flow: string|null, type: string|null, since: string|null,
 *             dir: string|null, errors: string[] }}
 */
export function parseArgs(argv) {
  const opts = {
    limit: DEFAULT_LIMIT,
    json: false,
    all: false,
    help: false,
    flow: null,
    type: null,
    since: null,
    dir: null,
    errors: [],
  };

  const valueOf = (flag, inline) => {
    if (inline !== undefined && inline !== '') return inline;
    const v = argv[++i];
    if (v === undefined) opts.errors.push(`${flag} requires a value`);
    return v;
  };

  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(0, eq) : arg;
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;

    switch (name) {
      case '--limit':
      case '-n': {
        const v = valueOf(name, inline);
        if (v === undefined) break;
        if (!/^\d+$/.test(v)) {
          opts.errors.push(`invalid --limit value: "${v}" (expected a non-negative integer)`);
          break;
        }
        opts.limit = Number(v);
        break;
      }
      case '--all':
        opts.all = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--flow':
        opts.flow = valueOf(name, inline);
        break;
      case '--type':
        opts.type = valueOf(name, inline);
        break;
      case '--since':
        opts.since = valueOf(name, inline);
        break;
      case '--dir':
        opts.dir = valueOf(name, inline);
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        opts.errors.push(`unknown option: "${arg}"`);
    }
  }

  return opts;
}

/**
 * List journal files (*.jsonl) in a directory, sorted by name (dates sort
 * lexicographically as ISO YYYY-MM-DD).
 */
export function findJournalFiles(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Load and merge every journal file in a directory.
 *
 * Returns { exists, entries, skipped, files } where entries are sorted in
 * ascending chronological order (stable for equal timestamps) and `skipped`
 * counts lines that were not valid JSON objects.
 */
export function loadEntries(dir) {
  let exists = false;
  try {
    exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch (err) {
    return { exists: false, entries: [], skipped: 0, files: 0, error: String(err.message || err) };
  }
  if (!exists) {
    return { exists: false, entries: [], skipped: 0, files: 0 };
  }

  const files = findJournalFiles(dir);
  const entries = [];
  let skipped = 0;
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      skipped += 1;
      continue;
    }
    const fileName = path.basename(file);
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        // A journal event must at least carry a string eventType; anything
        // else (scalars, arrays, malformed records) is not a usable event.
        if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.eventType === 'string' && entry.eventType.length > 0) {
          entry._file = fileName;
          entries.push(entry);
        } else {
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
    }
  }

  // Ascending chronological order. Node's sort is stable, so entries with
  // equal/missing timestamps keep their on-disk (file + line) order.
  entries.sort((a, b) => {
    const ta = a.ts ?? '';
    const tb = b.ts ?? '';
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return 0;
  });

  return { exists: true, entries, skipped, files: files.length };
}

/**
 * Build a compact human-readable detail string for one journal entry.
 * Picks the meaningful fields of `data`; falls back to raw JSON.
 */
export function summarize(entry) {
  const data = entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) ? entry.data : {};
  const parts = [];

  if (data.unitId) {
    const unitType = data.unitType && data.unitType !== 'null' ? `${data.unitType} ` : '';
    parts.push(`${unitType}${data.unitId}`);
  }
  if (typeof data.iteration === 'number') parts.push(`it=${data.iteration}`);
  if (typeof data.attempt === 'number') parts.push(`attempt=${data.attempt}`);
  if (data.status) parts.push(String(data.status));
  if (data.action) parts.push(String(data.action));
  if (data.milestoneId) parts.push(`m=${data.milestoneId}`);
  if (data.name && !['start', 'advance', 'stop'].includes(data.name)) parts.push(String(data.name));
  if (Array.isArray(data.agents)) {
    const counts = {};
    for (const agent of data.agents) counts[agent] = (counts[agent] || 0) + 1;
    const summary = Object.entries(counts)
      .map(([agent, n]) => (n > 1 ? `${agent}x${n}` : agent))
      .join('+');
    parts.push(`agents=${summary}`);
  }
  if (typeof data.successCount === 'number') parts.push(`ok=${data.successCount}`);
  if (typeof data.failureCount === 'number') parts.push(`fail=${data.failureCount}`);
  if (typeof data.totalCost === 'number') parts.push(`cost=$${data.totalCost.toFixed(3)}`);
  if (data.artifactVerified === true) parts.push('artifact-verified');
  if (data.artifactVerified === false) parts.push('artifact-missing');
  if (data.mode) parts.push(`mode=${data.mode}`);
  if (data.exitCode !== undefined) parts.push(`exit=${data.exitCode}`);
  if (typeof data.durationMs === 'number') parts.push(`${data.durationMs}ms`);
  if (data.reason) parts.push(truncate(String(data.reason).replace(/\s+/g, ' ').trim(), 80));
  if (data.rawReason) parts.push(truncate(String(data.rawReason).replace(/\s+/g, ' ').trim(), 60));

  if (parts.length === 0) {
    const raw = JSON.stringify(data);
    if (raw && raw !== '{}') parts.push(truncate(raw, 100));
  }

  return parts.join('  ');
}

/** Render one entry as an aligned, single-line record. */
export function formatEntry(entry) {
  const ts = String(entry.ts ?? '').padEnd(25);
  const eventType = String(entry.eventType ?? '?').padEnd(30);
  return `${ts} ${eventType} ${summarize(entry)}`;
}

/** Render a list of entries as text lines. */
export function formatEntries(entries) {
  return entries.map(formatEntry).join('\n');
}

export const HELP = `Usage: journal [options]

Reads the GSD event journal (.gsd/journal/*.jsonl — one file per day) and
prints the most recent entries in chronological order (newest last).

Options:
  -n, --limit <N>   Show only the last N entries (default: ${DEFAULT_LIMIT})
      --all         Show all entries (ignores --limit)
      --flow <id>   Only entries with the given flowId
      --type <et>   Only entries with the given eventType
      --since <ts>  Only entries at or after the given ISO timestamp
      --dir <path>  Journal directory (default: ${DEFAULT_JOURNAL_DIR},
                    or $GSD_JOURNAL_DIR)
      --json        Emit raw entries as NDJSON (one JSON object per line)
  -h, --help        Show this help

Examples:
  journal --limit 5              # last 5 events
  journal --type unit-end -n 10  # last 10 unit-end events
  journal --flow <flowId> --json # machine-readable view of one flow
`;

/**
 * Run the CLI with injected IO (testable without spawning a process).
 * Returns the process exit code.
 */
export function runCLI(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;

  const opts = parseArgs(argv);
  if (opts.help) {
    stdout.write(HELP);
    return 0;
  }
  if (opts.errors.length > 0) {
    for (const err of opts.errors) stderr.write(`journal: ${err}\n`);
    stderr.write("Run 'journal --help' for usage.\n");
    return 1;
  }

  const dir = path.resolve(cwd, opts.dir || env.GSD_JOURNAL_DIR || DEFAULT_JOURNAL_DIR);
  const loaded = loadEntries(dir);
  if (!loaded.exists) {
    stderr.write(`journal: no journal directory found at ${dir}\n`);
    return 1;
  }

  let filtered = loaded.entries;
  if (opts.flow) filtered = filtered.filter((e) => e.flowId === opts.flow);
  if (opts.type) filtered = filtered.filter((e) => e.eventType === opts.type);
  if (opts.since) filtered = filtered.filter((e) => (e.ts ?? '') >= opts.since);

  const limit = opts.all ? filtered.length : Math.max(0, opts.limit);
  // Note: Array#slice(-0) === slice(0) (whole array), so guard limit 0 explicitly.
  const shown = limit === 0 ? [] : filtered.slice(-limit);

  if (opts.json) {
    for (const entry of shown) {
      const { _file, ...clean } = entry;
      stdout.write(`${JSON.stringify(clean)}\n`);
    }
  } else {
    if (shown.length > 0) stdout.write(`${formatEntries(shown)}\n`);
  }

  if (loaded.skipped > 0) {
    stderr.write(`journal: skipped ${loaded.skipped} unparseable line(s)\n`);
  }

  return 0;
}
