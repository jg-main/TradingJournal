#!/usr/bin/env node
/**
 * journal — CLI for the GSD event journal.
 *
 * Reads .gsd/journal/*.jsonl and prints the most recent events.
 *
 *   journal --limit 5
 *
 * See scripts/journal-lib.mjs for the implementation (kept separate so the
 * core logic is unit-testable without spawning a process).
 */

import { runCLI } from './journal-lib.mjs';

process.exitCode = runCLI(process.argv.slice(2));
