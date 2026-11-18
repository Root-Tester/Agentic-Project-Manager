import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { parseCsv, parseSpreadsheet, parseXlsx } from '../../backend/src/services/sheet-parser.js';

test('parseCsv handles simple and quoted CSV text with custom headers', () => {
  const csv = `Emp ID,Full Name,Work Email,Department,Job Title,Seniority,Role
EMP-01,"Connor, Sarah",sarah@skynet.test,Engineering,Software developer,Senior,Team Lead
EMP-02,"Smith, John",john@matrix.test,People,HR,Mid-level,HR`;

  const candidates = parseSpreadsheet(csv);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].displayName, 'Connor, Sarah');
  assert.equal(candidates[0].email, 'sarah@skynet.test');
  assert.equal(candidates[0].experienceLevel, 'senior');
  assert.equal(candidates[0].accessRole, 'team-leader');

  assert.equal(candidates[1].displayName, 'Smith, John');
  assert.equal(candidates[1].email, 'john@matrix.test');
  assert.equal(candidates[1].accessRole, 'hr');
});

test('parseXlsx reads worksheet rows and shared strings', () => {
  const zip = new AdmZip();
  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>Full Name</t></si>
  <si><t>Email</t></si>
  <si><t>Alice Walker</t></si>
  <si><t>alice@test.org</t></si>
</sst>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2" t="s"><v>3</v></c>
    </row>
  </sheetData>
</worksheet>`;

  zip.addFile('xl/sharedStrings.xml', Buffer.from(sharedStringsXml));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheetXml));
  const buffer = zip.toBuffer();

  const candidates = parseSpreadsheet(buffer, { filename: 'roster.xlsx' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].displayName, 'Alice Walker');
  assert.equal(candidates[0].email, 'alice@test.org');
});
