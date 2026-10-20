import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colIndex, colName, evaluator, formatValue, literal, parseCsv, shiftFormula, toCsv } from '../src/core/sheet.ts';

test('column names and literals', () => {
  assert.deepEqual([colName(0), colName(25), colName(26), colName(701)], ['A', 'Z', 'AA', 'ZZ']);
  assert.equal(colIndex('AB'), 27);
  assert.deepEqual(['42', '1,234.5', '15%', '$3.50', 'TRUE', '00123x', "'42", ''].map(literal), [42, 1234.5, 0.15, 3.5, true, '00123x', '42', null]);
});

test('arithmetic, precedence, text and errors', () => {
  const e = evaluator({ A1: '10', A2: '4', A3: 'Nursing', A4: '=A1+A2*2', A5: '=(A1+A2)/0', A6: '=A3&" Unit"', A7: '=A1^2-50%', A8: '=A3+1', A9: '=NOPE(1)', B1: '=B2', B2: '=B1', B3: '=-A1>=-10' });
  assert.equal(e.get('A4'), 18);
  assert.deepEqual(e.get('A5'), { error: '#DIV/0!' });
  assert.equal(e.get('A6'), 'Nursing Unit');
  assert.equal(e.get('A7'), 99.5);
  assert.deepEqual(e.get('A8'), { error: '#VALUE!' });
  assert.deepEqual(e.get('A9'), { error: '#NAME?' });
  assert.deepEqual(e.get('B1'), { error: '#CIRC!' });
  assert.equal(e.get('B3'), true);
});

test('functions an access review needs', () => {
  const cells: Record<string, string> = { A1: 'User', B1: 'Status', C1: 'Days' };
  const rows = [['jdoe', 'Enabled', '3'], ['asmith', 'Disabled', '120'], ['bwong', 'Disabled', '95'], ['svc-backup', 'Enabled', '400']];
  rows.forEach((r, i) => { cells[`A${i + 2}`] = r[0]!; cells[`B${i + 2}`] = r[1]!; cells[`C${i + 2}`] = r[2]!; });
  Object.assign(cells, {
    E1: '=COUNTIF(B2:B5,"Disabled")', E2: '=COUNTIF(C2:C5,">90")', E3: '=SUM(C2:C5)', E4: '=AVERAGE(C2:C5)',
    E5: '=VLOOKUP("bwong",A2:C5,3,FALSE)', E6: '=VLOOKUP("nobody",A2:C5,2,FALSE)', E7: '=IF(C5>365,"Stale","OK")',
    E8: '=SUMIF(B2:B5,"Enabled",C2:C5)', E9: '=COUNTIF(A2:A5,"svc-*")', E10: '=IFERROR(E6,"not found")',
    E11: '=TEXTJOIN(", ",TRUE,A2:A3)', E12: '=UPPER(LEFT(A3,2))&LEN(A3)', E13: '=ROUND(E4,1)', E14: '=AND(C2<10,B2="enabled")', E15: '=COUNTA(A1:A10)',
  });
  const e = evaluator(cells);
  const v = (a: string): unknown => e.get(a);
  assert.deepEqual([v('E1'), v('E2'), v('E3'), v('E4')], [2, 3, 618, 154.5]);
  assert.equal(v('E5'), 95);
  assert.deepEqual(v('E6'), { error: '#N/A' });
  assert.deepEqual([v('E7'), v('E8'), v('E9'), v('E10')], ['Stale', 403, 1, 'not found']);
  assert.deepEqual([v('E11'), v('E12'), v('E13'), v('E14'), v('E15')], ['jdoe, asmith', 'AS6', 154.5, true, 5]);
});

test('formatting and copying formulas', () => {
  assert.equal(formatValue(1234.5, 'currency'), '$1,234.50');
  assert.equal(formatValue(0.256, 'percent', 1), '25.6%');
  assert.equal(formatValue(0.1 + 0.2), '0.3');
  assert.equal(formatValue(46315, 'date'), '10/20/2026');
  assert.equal(shiftFormula('=A1+$B$1+C$2&"A1"', 1, 2), '=B3+$B$1+D$2&"A1"');
  assert.equal(shiftFormula('=SUM(A1:A3)', 0, 1), '=SUM(A2:A4)');
  assert.equal(shiftFormula('=A1', -1, 0), '=#REF!');
});

test('CSV round trip with quotes, commas and new lines', () => {
  const text = 'EmployeeID,Name,Notes\r\nLAB-001,"Doe, Jane","said ""hi""\nthen left"\r\n';
  const rows = parseCsv(text);
  assert.deepEqual(rows, [['EmployeeID', 'Name', 'Notes'], ['LAB-001', 'Doe, Jane', 'said "hi"\nthen left']]);
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});
