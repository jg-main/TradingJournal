// T02 verification: 4 new M002 requirements registered in REQUIREMENTS.md
//
// This script parses .gsd/REQUIREMENTS.md and asserts:
//   - R019 (compact grouped metric panels) exists with correct class and validation
//   - R020 (customization mode) exists with correct class and validation
//   - R021 (view management) exists with correct class and validation
//   - R022 (first-screen density) exists with correct class and validation
//   - All 4 requirements appear in the Traceability table
//   - Coverage count reflects 18 validated requirements

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

  const cls = block.match(/^- Class: (.+)$/m)?.[1] ?? '';
  const status = block.match(/^- Status: (.+)$/m)?.[1] ?? '';
  const description = block.match(/^- Description: (.+)$/m)?.[1] ?? '';
  const primary_owner = block.match(/^- Primary owning slice: (.+)$/m)?.[1] ?? '';
  const validation = block.match(/^- Validation: (.+)$/m)?.[1] ?? '';
  const notes = block.match(/^- Notes: (.+)$/m)?.[1] ?? '';
  const source = block.match(/^- Source: (.+)$/m)?.[1] ?? '';

  return { cls, status, description, primary_owner, validation, notes, source };
}

describe('T02: New M002 requirements registered', () => {
  let requirementsText;

  it('REQUIREMENTS.md exists and is readable', () => {
    assert.ok(fs.existsSync(requirementsPath), `.gsd/REQUIREMENTS.md must exist`);
    requirementsText = fs.readFileSync(requirementsPath, 'utf-8');
    assert.ok(requirementsText.length > 0, 'REQUIREMENTS.md should not be empty');
  });

  describe('R019 — Compact grouped metric panels', () => {
    let r019;
    it('parses R019 block from REQUIREMENTS.md', () => {
      r019 = parseRequirementBlock(requirementsText, 'R019');
      assert.ok(r019 !== null, 'R019 block must be found in REQUIREMENTS.md');
    });

    it('has class quality-attribute', () => {
      assert.equal(r019.cls, 'quality-attribute', `R019 class should be quality-attribute. Got: "${r019.cls}"`);
    });

    it('has status validated', () => {
      assert.equal(r019.status, 'validated', `R019 status should be validated. Got: "${r019.status}"`);
    });

    it('has source M002 S05', () => {
      assert.ok(r019.source.includes('M002'), `R019 source should reference M002. Got: "${r019.source}"`);
    });

    it('primary owning slice is S05', () => {
      assert.ok(r019.primary_owner.includes('S05'), `R019 primary owning slice should include S05. Got: "${r019.primary_owner}"`);
    });

    it('description mentions compact grouped panels or panel', () => {
      const desc = r019.description.toLowerCase();
      assert.ok(
        desc.includes('grouped panel') || desc.includes('compact'),
        `R019 description should mention grouped panels. Got: "${r019.description}"`
      );
    });

    it('validation references M002 and mentions panel replacements', () => {
      const v = r019.validation.toLowerCase();
      assert.ok(v.includes('m002'), `R019 validation should reference M002. Got: "${r019.validation}"`);
      assert.ok(
        v.includes('accountperformancepanel') || v.includes('ptdperformancepanel') || v.includes('currentriskpanel'),
        `R019 validation should mention panel names. Got: "${r019.validation}"`
      );
    });
  });

  describe('R020 — Customization mode', () => {
    let r020;
    it('parses R020 block from REQUIREMENTS.md', () => {
      r020 = parseRequirementBlock(requirementsText, 'R020');
      assert.ok(r020 !== null, 'R020 block must be found in REQUIREMENTS.md');
    });

    it('has class primary-user-loop', () => {
      assert.equal(r020.cls, 'primary-user-loop', `R020 class should be primary-user-loop. Got: "${r020.cls}"`);
    });

    it('has status validated', () => {
      assert.equal(r020.status, 'validated', `R020 status should be validated. Got: "${r020.status}"`);
    });

    it('has source M002 S05', () => {
      assert.ok(r020.source.includes('M002'), `R020 source should reference M002. Got: "${r020.source}"`);
    });

    it('description mentions Edit Layout button or customization mode', () => {
      const desc = r020.description.toLowerCase();
      assert.ok(
        desc.includes('edit layout') || desc.includes('customization mode'),
        `R020 description should mention Edit Layout or customization. Got: "${r020.description}"`
      );
    });

    it('validation mentions drag handles or add-remove or save/cancel/reset', () => {
      const v = r020.validation.toLowerCase();
      assert.ok(
        v.includes('drag handle') || v.includes('add widget') || v.includes('save/cancel') || v.includes('edit layout'),
        `R020 validation should mention customization mode features. Got: "${r020.validation}"`
      );
    });
  });

  describe('R021 — View management', () => {
    let r021;
    it('parses R021 block from REQUIREMENTS.md', () => {
      r021 = parseRequirementBlock(requirementsText, 'R021');
      assert.ok(r021 !== null, 'R021 block must be found in REQUIREMENTS.md');
    });

    it('has class primary-user-loop', () => {
      assert.equal(r021.cls, 'primary-user-loop', `R021 class should be primary-user-loop. Got: "${r021.cls}"`);
    });

    it('has status validated', () => {
      assert.equal(r021.status, 'validated', `R021 status should be validated. Got: "${r021.status}"`);
    });

    it('has source M002 S05', () => {
      assert.ok(r021.source.includes('M002'), `R021 source should reference M002. Got: "${r021.source}"`);
    });

    it('description mentions create/name/duplicate/rename/delete/switch or dropdown', () => {
      const desc = r021.description.toLowerCase();
      assert.ok(
        desc.includes('create') || desc.includes('duplicate') || desc.includes('rename') || desc.includes('dropdown'),
        `R021 description should mention view management actions. Got: "${r021.description}"`
      );
    });

    it('validation mentions dropdown or system views or dashboard:views', () => {
      const v = r021.validation.toLowerCase();
      assert.ok(
        v.includes('dropdown') || v.includes('system view') || v.includes('dashboard:views'),
        `R021 validation should mention view management features. Got: "${r021.validation}"`
      );
    });
  });

  describe('R022 — First-screen density', () => {
    let r022;
    it('parses R022 block from REQUIREMENTS.md', () => {
      r022 = parseRequirementBlock(requirementsText, 'R022');
      assert.ok(r022 !== null, 'R022 block must be found in REQUIREMENTS.md');
    });

    it('has class quality-attribute', () => {
      assert.equal(r022.cls, 'quality-attribute', `R022 class should be quality-attribute. Got: "${r022.cls}"`);
    });

    it('has status validated', () => {
      assert.equal(r022.status, 'validated', `R022 status should be validated. Got: "${r022.status}"`);
    });

    it('has source M002 S05', () => {
      assert.ok(r022.source.includes('M002'), `R022 source should reference M002. Got: "${r022.source}"`);
    });

    it('description mentions 1440x900 or first-screen density or visible without scrolling', () => {
      const desc = r022.description.toLowerCase();
      assert.ok(
        desc.includes('1440') || desc.includes('first-screen') || desc.includes('without scrolling') || desc.includes('visible'),
        `R022 description should mention density requirements. Got: "${r022.description}"`
      );
    });

    it('validation mentions row height or D017 or compact grouped panels', () => {
      const v = r022.validation.toLowerCase();
      assert.ok(
        v.includes('row height') || v.includes('d017') || v.includes('compact'),
        `R022 validation should mention density mechanisms. Got: "${r022.validation}"`
      );
    });
  });

  describe('Traceability table', () => {
    it('contains R019 row', () => {
      assert.ok(requirementsText.includes('| R019 |'), 'Traceability table must contain R019 row');
    });

    it('contains R020 row', () => {
      assert.ok(requirementsText.includes('| R020 |'), 'Traceability table must contain R020 row');
    });

    it('contains R021 row', () => {
      assert.ok(requirementsText.includes('| R021 |'), 'Traceability table must contain R021 row');
    });

    it('contains R022 row', () => {
      assert.ok(requirementsText.includes('| R022 |'), 'Traceability table must contain R022 row');
    });
  });

  describe('Coverage summary', () => {
    it('reports 18 validated requirements including R019, R020, R021, R022', () => {
      const summaryLine = requirementsText.match(/^- Validated: 18 \(.+\)$/m);
      assert.ok(summaryLine !== null, 'Coverage summary must report 18 validated requirements');
      assert.ok(summaryLine[0].includes('R019'), 'Coverage summary must include R019');
      assert.ok(summaryLine[0].includes('R020'), 'Coverage summary must include R020');
      assert.ok(summaryLine[0].includes('R021'), 'Coverage summary must include R021');
      assert.ok(summaryLine[0].includes('R022'), 'Coverage summary must include R022');
    });
  });
});
