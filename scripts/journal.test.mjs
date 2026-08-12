/**
 * journal.test.mjs — unit tests for the `journal` CLI (scripts/journal-lib.mjs).
 *
 * Uses a throwaway journal directory under the OS temp dir so the real
 * .gsd/journal is never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseArgs,
  loadEntries,
  summarize,
  formatEntry,
  runCLI,
  DEFAULT_JOURNAL_DIR,
  DEFAULT_LIMIT,
} from './journal-lib.mjs';

/** Minimal real-shaped fixture entries (mirrors .gsd/journal events). */
function fixtureEntries() {
  return [
    {
      ts: '2026-08-12T00:09:53.264Z',
      flowId: 'f1',
      seq: 1,
      eventType: 'unit-start',
      data: { iteration: 4, unitType: 'run-uat', unitId: 'M016/S03' },
    },
    {
      ts: '2026-08-12T00:09:53.312Z',
      flowId: 'f1',
      seq: 2,
      eventType: 'iteration-end',
      data: { iteration: 4 },
    },
    {
      ts: '2026-08-12T00:09:54.100Z',
      flowId: 'f2',
      seq: 1,
      eventType: 'orchestrator-guard-block',
      data: { source: 'auto-orchestrator', name: 'advance-blocked', reason: 'Slice ID drift in M002: unknown S01' },
    },
    {
      ts: '2026-08-12T00:10:00.000Z',
      flowId: 'f3',
      seq: 1,
      eventType: 'subagent-completed',
      data: { mode: 'parallel', agents: ['reviewer', 'reviewer'], successCount: 2, failureCount: 0, totalCost: 0.0341 },
    },
    {
      ts: '2026-08-12T00:10:05.500Z',
      flowId: 'f1',
      seq: 3,
      eventType: 'unit-end',
      data: { iteration: 4, unitType: 'run-uat', unitId: 'M016/S03', status: 'completed', artifactVerified: true },
    },
    {
      ts: '2026-08-12T00:11:00.000Z',
      flowId: 'f4',
      seq: 1,
      eventType: 'auto-exit',
      data: { reason: 'other', rawReason: 'Milestone M001 complete', milestoneId: 'M001' },
    },
  ];
}

/** Write fixture entries across two day-files, with junk and empty lines. */
function writeFixtureJournal(tmpRoot) {
  const dir = path.join(tmpRoot, DEFAULT_JOURNAL_DIR); // mirror the repo layout
  const entries = fixtureEntries();
  fs.mkdirSync(dir, { recursive: true });
  const day1 = entries.filter((e) => e.ts.startsWith('2026-08-12T00:0'));
  const day2 = entries.filter((e) => e.ts.startsWith('2026-08-12T00:1'));
  fs.writeFileSync(path.join(dir, '2026-08-12.jsonl'), day1.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(
    path.join(dir, '2026-08-13.jsonl'),
    ['not json at all', '', ...day2.map((e) => JSON.stringify(e)), '', '{"ts": 42}'].join('\n') + '\n'
  );
  return entries;
}

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-test-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it('defaults to 20 entries, human output', () => {
    const opts = parseArgs([]);
    expect(opts.limit).toBe(DEFAULT_LIMIT);
    expect(opts.json).toBe(false);
    expect(opts.all).toBe(false);
    expect(opts.errors).toEqual([]);
  });

  it('parses --limit N and --limit=N', () => {
    expect(parseArgs(['--limit', '5']).limit).toBe(5);
    expect(parseArgs(['-n', '0']).limit).toBe(0);
    expect(parseArgs(['--limit=12']).limit).toBe(12);
  });

  it('rejects non-numeric and negative limits', () => {
    expect(parseArgs(['--limit', 'abc']).errors).toHaveLength(1);
    expect(parseArgs(['--limit', '-3']).errors).toHaveLength(1);
    expect(parseArgs(['--limit']).errors).toHaveLength(1);
  });

  it('parses filters, json, all and help flags', () => {
    const opts = parseArgs(['--json', '--all', '--flow', 'f1', '--type', 'unit-end', '--since', '2026-08-12T00:10:00Z']);
    expect(opts.json).toBe(true);
    expect(opts.all).toBe(true);
    expect(opts.flow).toBe('f1');
    expect(opts.type).toBe('unit-end');
    expect(opts.since).toBe('2026-08-12T00:10:00Z');
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('reports unknown options', () => {
    expect(parseArgs(['--nope']).errors).toEqual(['unknown option: "--nope"']);
  });
});

describe('loadEntries', () => {
  it('reports a missing directory without throwing', () => {
    const loaded = loadEntries(path.join(tmpRoot, 'does-not-exist'));
    expect(loaded.exists).toBe(false);
    expect(loaded.entries).toEqual([]);
  });

  it('merges day files in chronological order', () => {
    writeFixtureJournal(tmpRoot);
    const loaded = loadEntries(path.join(tmpRoot, DEFAULT_JOURNAL_DIR));
    expect(loaded.exists).toBe(true);
    expect(loaded.files).toBe(2);
    expect(loaded.entries.map((e) => e.eventType)).toEqual([
      'unit-start',
      'iteration-end',
      'orchestrator-guard-block',
      'subagent-completed',
      'unit-end',
      'auto-exit',
    ]);
  });

  it('skips unparseable and non-object lines but keeps valid ones', () => {
    writeFixtureJournal(tmpRoot);
    const loaded = loadEntries(path.join(tmpRoot, DEFAULT_JOURNAL_DIR));
    // 'not json at all', '{"ts": 42}' (array check: 42 is not object -> skipped as number? it IS an object line but invalid shape)
    expect(loaded.skipped).toBe(2); // 'not json at all' (parse error) + '{"ts": 42}' (valid JSON, not an object entry)
    expect(loaded.entries).toHaveLength(6);
  });

  it('handles an empty directory', () => {
    const emptyDir = path.join(tmpRoot, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const loaded = loadEntries(emptyDir);
    expect(loaded.exists).toBe(true);
    expect(loaded.entries).toEqual([]);
    expect(loaded.skipped).toBe(0);
  });
});

describe('summarize / formatEntry', () => {
  it('summarizes unit events with unit, iteration and status', () => {
    const summary = summarize(fixtureEntries()[4]);
    expect(summary).toContain('run-uat M016/S03');
    expect(summary).toContain('it=4');
    expect(summary).toContain('completed');
    expect(summary).toContain('artifact-verified');
  });

  it('summarizes guard-block with truncated reason', () => {
    const summary = summarize(fixtureEntries()[2]);
    expect(summary).toContain('advance-blocked');
    expect(summary).toContain('Slice ID drift in M002: unknown S01');
  });

  it('summarizes subagent-completed with agent counts and cost', () => {
    const summary = summarize(fixtureEntries()[3]);
    expect(summary).toContain('agents=reviewerx2');
    expect(summary).toContain('ok=2');
    expect(summary).toContain('fail=0');
    expect(summary).toContain('cost=$0.034');
  });

  it('summarizes auto-exit with milestone and raw reason', () => {
    const summary = summarize(fixtureEntries()[5]);
    expect(summary).toContain('m=M001');
    expect(summary).toContain('Milestone M001 complete');
  });

  it('formatEntry produces aligned ts/eventType columns', () => {
    const line = formatEntry(fixtureEntries()[4]);
    expect(line.startsWith('2026-08-12T00:10:05.500Z ')).toBe(true);
    expect(line).toContain('unit-end');
  });

  it('falls back to raw JSON for empty data', () => {
    const summary = summarize({ eventType: 'iteration-end', data: {} });
    expect(summary).toBe('');
  });
});

describe('runCLI', () => {
  function capture() {
    const io = { cwd: tmpRoot, stdout: { write: () => {} }, stderr: { write: () => {} }, env: {} };
    const out = [];
    const err = [];
    io.stdout.write = (s) => out.push(s);
    io.stderr.write = (s) => err.push(s);
    return { io, out, err };
  }

  it('prints the last N entries in chronological order (newest last)', () => {
    writeFixtureJournal(tmpRoot);
    const { io, out } = capture();
    const code = runCLI(['--limit', '3'], io);
    expect(code).toBe(0);
    const lines = out.join('').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('subagent-completed');
    expect(lines[2]).toContain('auto-exit');
  });

  it('defaults to DEFAULT_LIMIT when no --limit is given', () => {
    const entries = fixtureEntries();
    // Pad the journal past the default limit so truncation is observable.
    const dir = path.join(tmpRoot, 'pad');
    fs.mkdirSync(path.join(dir, DEFAULT_JOURNAL_DIR), { recursive: true });
    const padded = [];
    for (let n = 0; n < DEFAULT_LIMIT + 3; n++) {
      padded.push({ ts: `2026-08-12T00:00:${String(n).padStart(2, '0')}.000Z`, eventType: `unit-start`, data: { unitId: `M000/S${String(n).padStart(2, '0')}` } });
    }
    fs.writeFileSync(path.join(dir, DEFAULT_JOURNAL_DIR, '2026-08-12.jsonl'), padded.map((e) => JSON.stringify(e)).join('\n') + '\n');
    void entries;

    const { io, out } = capture();
    const code = runCLI([], { ...io, cwd: dir });
    expect(code).toBe(0);
    expect(out.join('').trim().split('\n')).toHaveLength(DEFAULT_LIMIT);
  });

  it('prints nothing for --limit 0', () => {
    writeFixtureJournal(tmpRoot);
    const { io, out } = capture();
    const code = runCLI(['--limit', '0'], io);
    expect(code).toBe(0);
    expect(out.join('')).toBe('');
  });

  it('--json emits clean NDJSON without the _file artifact', () => {
    writeFixtureJournal(tmpRoot);
    const { io, out } = capture();
    const code = runCLI(['--limit', '2', '--json'], io);
    expect(code).toBe(0);
    const lines = out.join('').trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed._file).toBeUndefined();
      expect(typeof parsed.ts).toBe('string');
    }
    expect(JSON.parse(lines[0]).eventType).toBe('unit-end');
  });

  it('filters by flow and type', () => {
    writeFixtureJournal(tmpRoot);
    const { io, out } = capture();
    const code = runCLI(['--flow', 'f1', '--all'], io);
    expect(code).toBe(0);
    const lines = out.join('').trim().split('\n');
    expect(lines).toHaveLength(3); // unit-start, iteration-end, unit-end
    expect(lines.every((l) => l.includes('unit-start') || l.includes('iteration-end') || l.includes('unit-end'))).toBe(true);
  });

  it('filters by --type', () => {
    writeFixtureJournal(tmpRoot);
    const { io, out } = capture();
    const code = runCLI(['--type', 'unit-end', '--all'], io);
    expect(code).toBe(0);
    const lines = out.join('').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('unit-end');
  });

  it('filters by --since', () => {
    writeFixtureJournal(tmpRoot);
    const { io, out } = capture();
    const code = runCLI(['--since', '2026-08-12T00:10:03Z', '--all'], io);
    expect(code).toBe(0);
    const lines = out.join('').trim().split('\n');
    // unit-end (00:10:05.500) and auto-exit (00:11:00.000) are >= since;
    // subagent-completed (00:10:00.000) is before it.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('unit-end');
    expect(lines[1]).toContain('auto-exit');
  });

  it('fails with exit 1 on unknown options and reports to stderr', () => {
    writeFixtureJournal(tmpRoot);
    const { io, err } = capture();
    const code = runCLI(['--bogus'], io);
    expect(code).toBe(1);
    expect(err.join('')).toContain('unknown option');
  });

  it('fails with exit 1 when the journal directory is missing', () => {
    const { io, err } = capture();
    const code = runCLI([], io); // cwd = tmpRoot with no .gsd/journal dir
    expect(code).toBe(1);
    expect(err.join('')).toContain('no journal directory found');
  });

  it('honors --dir and GSD_JOURNAL_DIR overrides', () => {
    const nested = path.join(tmpRoot, 'nested', 'journal');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, '2026-08-12.jsonl'), JSON.stringify(fixtureEntries()[0]) + '\n');

    const viaFlag = capture();
    expect(runCLI(['--dir', nested, '--all'], viaFlag.io)).toBe(0);
    expect(viaFlag.out.join('')).toContain('unit-start');

    const viaEnv = capture();
    expect(runCLI([], { ...viaEnv.io, env: { GSD_JOURNAL_DIR: nested } })).toBe(0);
    expect(viaEnv.out.join('')).toContain('unit-start');
  });

  it('--help prints usage and exits 0', () => {
    const { io, out } = capture();
    const code = runCLI(['--help'], io);
    expect(code).toBe(0);
    expect(out.join('')).toContain('Usage: journal');
    expect(out.join('')).toContain('--limit');
  });

  it('warns on skipped unparseable lines but still exits 0', () => {
    writeFixtureJournal(tmpRoot);
    const { io, err } = capture();
    const code = runCLI(['--limit', '1'], io);
    expect(code).toBe(0);
    expect(err.join('')).toContain('skipped 2 unparseable line(s)');
  });

  it('DEFAULT_JOURNAL_DIR matches the repo layout', () => {
    expect(DEFAULT_JOURNAL_DIR).toBe('.gsd/journal');
  });
});
