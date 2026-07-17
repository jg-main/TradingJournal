// T03 verification: All 8 M002 architectural decisions (D010-D017) captured as GSD memories
//
// This script parses .gsd/DECISIONS.md and asserts:
//   - D010 (slice decomposition strategy) exists with M002 planning context
//   - D011 (widget registry architecture) exists with registry details
//   - D012 (compact grouped metric panels) exists with panel descriptions
//   - D013 (DashboardV2 integration) exists with integration strategy
//   - D014 (view management storage) exists with storage details
//   - D015 (visibility tracking) exists with tracking strategy
//   - D016 (storage key naming) exists with key naming details
//   - D017 (grid density configuration) exists with density parameters
//
// Additionally, memory_query (run externally via GSD tool) confirms all 8
// decisions are retrievable as GSD memories.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const decisionsPath = path.resolve(__dirname, '../../.gsd/DECISIONS.md');

function parseDecisionRow(text, id) {
  // Decisions are in a markdown table. Find the row with | D010 |
  const rowMatch = text.match(new RegExp(`\\| ${id} \\|`, 'm'));
  if (!rowMatch) return null;

  // Find the full pipe-delimited row containing this ID
  const fullRowMatch = text.match(new RegExp(`^\\| ${id} \\|.*$`, 'm'));
  if (!fullRowMatch) return null;

  const row = fullRowMatch[0];
  // Split by pipe and trim each cell
  const cells = row.split('|').map(c => c.trim());
  // Expected structure: | # | When | Scope | Decision | Choice | Rationale | Revisable? | Made By |
  // cells[0] is empty (before first |), cells[1] = id, cells[6] = rationale
  if (cells.length < 7) return null;

  return {
    id: cells[1],
    when: cells[2] || '',
    scope: cells[3] || '',
    decision: cells[4] || '',
    choice: cells[5] || '',
    rationale: cells[6] || '',
    revisable: cells[7] || '',
    madeBy: cells[8] || ''
  };
}

describe('T03: M002 architectural decisions captured as GSD memories', () => {
  let decisionsText;

  it('DECISIONS.md exists and is readable', () => {
    assert.ok(fs.existsSync(decisionsPath), `.gsd/DECISIONS.md must exist`);
    decisionsText = fs.readFileSync(decisionsPath, 'utf-8');
    assert.ok(decisionsText.length > 0, 'DECISIONS.md should not be empty');
  });

  describe('D010 — Slice decomposition strategy for M002', () => {
    let d010;
    it('parses D010 row from DECISIONS.md', () => {
      d010 = parseDecisionRow(decisionsText, 'D010');
      assert.ok(d010 !== null, 'D010 row must be found in DECISIONS.md');
    });

    it('scope is architecture', () => {
      assert.equal(d010.scope, 'architecture', `D010 scope should be architecture. Got: "${d010.scope}"`);
    });

    it('decision mentions slice decomposition or M002 planning', () => {
      const d = d010.decision.toLowerCase();
      assert.ok(
        d.includes('slice decomposition') || d.includes('m002'),
        `D010 decision should mention slice decomposition or M002. Got: "${d010.decision}"`
      );
    });

    it('rationale mentions risk-first ordering or unified grid', () => {
      const r = d010.rationale.toLowerCase();
      assert.ok(
        r.includes('risk-first') || r.includes('unif') || r.includes('slice'),
        `D010 rationale should mention decomposition approach. Got: "${d010.rationale.substring(0, 80)}..."`
      );
    });
  });

  describe('D011 — Widget registry architecture', () => {
    let d011;
    it('parses D011 row from DECISIONS.md', () => {
      d011 = parseDecisionRow(decisionsText, 'D011');
      assert.ok(d011 !== null, 'D011 row must be found in DECISIONS.md');
    });

    it('scope is architecture', () => {
      assert.equal(d011.scope, 'architecture', `D011 scope should be architecture. Got: "${d011.scope}"`);
    });

    it('decision mentions widget registry or DashboardWidgetRegistry', () => {
      const d = d011.decision.toLowerCase();
      assert.ok(
        d.includes('widget registry') || d.includes('dashboardwidgetregistry'),
        `D011 decision should mention widget registry. Got: "${d011.decision}"`
      );
    });

    it('rationale mentions immutable source of truth', () => {
      const r = d011.rationale.toLowerCase();
      assert.ok(
        r.includes('immutable') || r.includes('source of truth'),
        `D011 rationale should mention immutability or source of truth. Got: "${d011.rationale.substring(0, 80)}..."`
      );
    });
  });

  describe('D012 — Compact grouped metric panels', () => {
    let d012;
    it('parses D012 row from DECISIONS.md', () => {
      d012 = parseDecisionRow(decisionsText, 'D012');
      assert.ok(d012 !== null, 'D012 row must be found in DECISIONS.md');
    });

    it('scope is architecture', () => {
      assert.equal(d012.scope, 'architecture', `D012 scope should be architecture. Got: "${d012.scope}"`);
    });

    it('decision mentions compact grouped metric panels or KPI cards replacement', () => {
      const d = d012.decision.toLowerCase();
      assert.ok(
        d.includes('compact') || d.includes('grouped') || d.includes('kpi'),
        `D012 decision should mention compact grouped panels. Got: "${d012.decision}"`
      );
    });

    it('rationale mentions grouped panel or customization unit', () => {
      const r = d012.rationale.toLowerCase();
      assert.ok(
        r.includes('grouped') || r.includes('customization unit') || r.includes('waste'),
        `D012 rationale should mention grouped panel benefits. Got: "${d012.rationale.substring(0, 80)}..."`
      );
    });
  });

  describe('D013 — DashboardV2 integration', () => {
    let d013;
    it('parses D013 row from DECISIONS.md', () => {
      d013 = parseDecisionRow(decisionsText, 'D013');
      assert.ok(d013 !== null, 'D013 row must be found in DECISIONS.md');
    });

    it('scope is architecture', () => {
      assert.equal(d013.scope, 'architecture', `D013 scope should be architecture. Got: "${d013.scope}"`);
    });

    it('decision mentions DashboardV2 or unified grid integration', () => {
      const d = d013.decision.toLowerCase();
      assert.ok(
        d.includes('dashboardv2') || d.includes('dashboard v2') || (d.includes('unified') && d.includes('widget')),
        `D013 decision should mention DashboardV2 integration. Got: "${d013.decision}"`
      );
    });

    it('rationale mentions registered widgets or architectural offender', () => {
      const r = d013.rationale.toLowerCase();
      assert.ok(
        r.includes('widget') || r.includes('grid') || r.includes('architectural'),
        `D013 rationale should mention widget integration. Got: "${d013.rationale.substring(0, 80)}..."`
      );
    });
  });

  describe('D014 — View management storage strategy', () => {
    let d014;
    it('parses D014 row from DECISIONS.md', () => {
      d014 = parseDecisionRow(decisionsText, 'D014');
      assert.ok(d014 !== null, 'D014 row must be found in DECISIONS.md');
    });

    it('scope is architecture', () => {
      assert.equal(d014.scope, 'architecture', `D014 scope should be architecture. Got: "${d014.scope}"`);
    });

    it('decision mentions view management storage or localStorage or DashboardView', () => {
      const d = d014.decision.toLowerCase();
      assert.ok(
        d.includes('view management') || d.includes('localstorage') || d.includes('dashboardview'),
        `D014 decision should mention view management storage. Got: "${d014.decision}"`
      );
    });

    it('rationale mentions versioned key or localStorage sufficiency', () => {
      const r = d014.rationale.toLowerCase();
      assert.ok(
        r.includes('versioned') || r.includes('localstorage') || r.includes('key'),
        `D014 rationale should mention storage strategy. Got: "${d014.rationale.substring(0, 80)}..."`
      );
    });
  });

  describe('D015 — Visibility tracking strategy', () => {
    let d015;
    it('parses D015 row from DECISIONS.md', () => {
      d015 = parseDecisionRow(decisionsText, 'D015');
      assert.ok(d015 !== null, 'D015 row must be found in DECISIONS.md');
    });

    it('scope is architecture', () => {
      assert.equal(d015.scope, 'architecture', `D015 scope should be architecture. Got: "${d015.scope}"`);
    });

    it('decision mentions visibility tracking or Set<WidgetId>', () => {
      const d = d015.decision.toLowerCase();
      assert.ok(
        d.includes('visibility') || d.includes('widgetid') || d.includes('hidden'),
        `D015 decision should mention visibility tracking. Got: "${d015.decision}"`
      );
    });

    it('rationale mentions layout array or backward compatible', () => {
      const r = d015.rationale.toLowerCase();
      assert.ok(
        r.includes('layout') || r.includes('backward'),
        `D015 rationale should mention layout array or compatibility. Got: "${d015.rationale.substring(0, 80)}..."`
      );
    });
  });

  describe('D016 — Storage key naming', () => {
    let d016;
    it('parses D016 row from DECISIONS.md', () => {
      d016 = parseDecisionRow(decisionsText, 'D016');
      assert.ok(d016 !== null, 'D016 row must be found in DECISIONS.md');
    });

    it('scope is architecture', () => {
      assert.equal(d016.scope, 'architecture', `D016 scope should be architecture. Got: "${d016.scope}"`);
    });

    it('decision mentions storage key naming or views:v2', () => {
      const d = d016.decision.toLowerCase();
      assert.ok(
        d.includes('key naming') || d.includes('storage key') || d.includes('views:v2'),
        `D016 decision should mention storage key naming. Got: "${d016.decision}"`
      );
    });

    it('rationale mentions version alignment or v2 sync', () => {
      const r = d016.rationale.toLowerCase();
      assert.ok(
        r.includes('v2') || r.includes('version') || r.includes('align'),
        `D016 rationale should mention version alignment. Got: "${d016.rationale.substring(0, 80)}..."`
      );
    });
  });

  describe('D017 — Grid density configuration', () => {
    let d017;
    it('parses D017 row from DECISIONS.md', () => {
      d017 = parseDecisionRow(decisionsText, 'D017');
      assert.ok(d017 !== null, 'D017 row must be found in DECISIONS.md');
    });

    it('scope is architecture', () => {
      assert.equal(d017.scope, 'architecture', `D017 scope should be architecture. Got: "${d017.scope}"`);
    });

    it('decision mentions rowHeight or 1440x900 or grid density', () => {
      const d = d017.decision.toLowerCase();
      assert.ok(
        d.includes('rowheight') || d.includes('1440') || d.includes('density') || d.includes('margin'),
        `D017 decision should mention grid density. Got: "${d017.decision}"`
      );
    });

    it('rationale mentions widget rows or grid space calculation', () => {
      const r = d017.rationale.toLowerCase();
      assert.ok(
        r.includes('widget') || r.includes('row') || r.includes('grid') || r.includes('px'),
        `D017 rationale should mention grid dimensions. Got: "${d017.rationale.substring(0, 80)}..."`
      );
    });
  });
});
