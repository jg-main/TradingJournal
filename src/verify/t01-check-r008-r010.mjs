// T01 verification: R008 and R008 updated to reflect M002 actual deliverables
//
// This script parses .gsd/REQUIREMENTS.md and asserts:
//   - R008 description mentions unified grid, view management, dropdown
//   - R008 primary owning slice includes S05
//   - R008 validation mentions M002 or unified grid or view management
//   - R010 description mentions grouped panels or neutral widget surfaces
//   - R010 primary owning slice includes S05
//   - R010 validation mentions M002 or grouped panels or AccountPerformancePanel

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requirementsPath = path.resolve(__dirname, '../../.gsd/REQUIREMENTS.md');

function parseRequirementBlock(text, id) {
  const startMarker = `### ${id} — `;
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) return null;

  const endIdx = text.indexOf('\n### ', startIdx + 1);
  const block = endIdx === -1 ? text.slice(startIdx) : text.slice(startIdx, endIdx);

  const description = block.match(/^- Description: (.+)$/m)?.[1] ?? '';
  const primary_owner = block.match(/^- Primary owning slice: (.+)$/m)?.[1] ?? '';
  const validation = block.match(/^- Validation: (.+)$/m)?.[1] ?? '';
  const notes = block.match(/^- Notes: (.+)$/m)?.[1] ?? '';

  return { description, primary_owner, validation, notes };
}

describe('T01: R008 and R010 reflect M002 deliverables', () => {
  let requirementsText;

  it('REQUIREMENTS.md exists and is readable', () => {
    assert.ok(fs.existsSync(requirementsPath), `.gsd/REQUIREMENTS.md must exist`);
    requirementsText = fs.readFileSync(requirementsPath, 'utf-8');
    assert.ok(requirementsText.length > 0, 'REQUIREMENTS.md should not be empty');
  });

  describe('R008 — Unified grid with view management', () => {
    let r008;
    it('parses R008 block from REQUIREMENTS.md', () => {
      r008 = parseRequirementBlock(requirementsText, 'R008');
      assert.ok(r008 !== null, 'R008 block must be found in REQUIREMENTS.md');
    });

    it('description mentions unified grid or view management or dropdown', () => {
      const desc = r008.description.toLowerCase();
      const matches = ['unified', 'view management', 'dropdown', 'react-grid-layout'];
      const found = matches.some(m => desc.includes(m));
      assert.ok(found, `R008 description must mention one of: ${matches.join(', ')}. Got: "${r008.description}"`);
    });

    it('primary owning slice includes S05', () => {
      assert.ok(
        r008.primary_owner.includes('S05'),
        `R008 primary owning slice should include S05. Got: "${r008.primary_owner}"`
      );
    });

    it('validation references M002 delivery or unified grid or view management', () => {
      const v = r008.validation.toLowerCase();
      const matches = ['m002', 'unified', 'view management', 'dashboard:views', 'widget registry'];
      const found = matches.some(m => v.includes(m));
      assert.ok(found, `R008 validation must reference M002 delivery. Got: "${r008.validation}"`);
    });

    it('notes reference M002', () => {
      assert.ok(
        r008.notes.includes('M002'),
        `R008 notes should reference M002. Got: "${r008.notes}"`
      );
    });
  });

  describe('R010 — Compact grouped panels with neutral surfaces', () => {
    let r010;
    it('parses R010 block from REQUIREMENTS.md', () => {
      r010 = parseRequirementBlock(requirementsText, 'R010');
      assert.ok(r010 !== null, 'R010 block must be found in REQUIREMENTS.md');
    });

    it('description mentions grouped panels or neutral widget surfaces or category accents', () => {
      const desc = r010.description.toLowerCase();
      const matches = ['grouped panel', 'neutral widget surface', 'category accent', 'accountperformancepanel', 'ptdperformancepanel', 'currentriskpanel'];
      const found = matches.some(m => desc.includes(m));
      assert.ok(found, `R010 description must reflect grouped panels or neutral surfaces. Got: "${r010.description}"`);
    });

    it('primary owning slice includes S05', () => {
      assert.ok(
        r010.primary_owner.includes('S05'),
        `R010 primary owning slice should include S05. Got: "${r010.primary_owner}"`
      );
    });

    it('validation references M002 or grouped panels', () => {
      const v = r010.validation.toLowerCase();
      const matches = ['m002', 'grouped panel', 'accountperformancepanel', 'currentriskpanel'];
      const found = matches.some(m => v.includes(m));
      assert.ok(found, `R010 validation must reference M002 grouped panels. Got: "${r010.validation}"`);
    });

    it('notes reference M002 grouped panels replacement', () => {
      assert.ok(
        r010.notes.includes('M002'),
        `R010 notes should reference M002. Got: "${r010.notes}"`
      );
      assert.ok(
        r010.notes.includes('grouped'),
        `R010 notes should mention grouped panels. Got: "${r010.notes}"`
      );
    });
  });
});
