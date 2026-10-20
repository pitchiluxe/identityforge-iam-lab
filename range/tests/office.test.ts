import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDoc, docText, normalizeRuns, readBook, readDeck, readWord, wordCount, writeBook, writeDeck, writeWord, newDeck, newSlide } from '../src/core/office.ts';

test('runs merge, and documents read back from disk are validated', () => {
  assert.deepEqual(normalizeRuns([{ text: 'a', b: true }, { text: 'b', b: true }, { text: '' }, { text: 'c' }]), [{ text: 'ab', b: true }, { text: 'c' }]);
  const evil = cleanDoc({ paras: [
    { style: 'h1', align: 'center', runs: [{ text: 'Hi', color: 'red;background:url(x)', bg: '#FFFF00', font: 'Arial', size: 400, b: 'yes' }] },
    { style: '<script>', runs: [{ text: 'x', font: 'Comic Sans;}*{display:none}' }, { nope: 1 }] },
  ] });
  assert.deepEqual(evil.paras[0], { style: 'h1', align: 'center', runs: [{ text: 'Hi', bg: '#ffff00', font: 'Arial', size: 96 }] });
  assert.deepEqual(evil.paras[1], { style: 'p', runs: [{ text: 'x' }] });
  assert.deepEqual(cleanDoc('garbage'), { paras: [{ style: 'p', runs: [] }] });
});

test('Word files round-trip, and text files open as paragraphs', () => {
  const w = readWord('Line one\r\n\r\nLine three');
  assert.equal(w.doc.paras.length, 3);
  assert.equal(docText(w.doc), 'Line one\n\nLine three');
  assert.equal(wordCount(docText(w.doc)), 4);
  const back = readWord(writeWord({ ...w, margins: 'narrow', landscape: true }));
  assert.deepEqual([back.margins, back.landscape, docText(back.doc)], ['narrow', true, 'Line one\n\nLine three']);
});

test('decks and workbooks round-trip; CSV opens as a sheet named after the file', () => {
  const d = newDeck();
  d.slides.push(newSlide('content'));
  d.theme = 'meridian';
  const d2 = readDeck(writeDeck(d));
  assert.deepEqual([d2.theme, d2.slides.length, d2.slides[1]!.layout], ['meridian', 2, 'content']);
  assert.equal(readDeck('{"type":"powerpoint","theme":"x","slides":[]}').slides.length, 1);

  const b = readBook('User,Status\njdoe,Enabled\n"Doe, J",Disabled\n', 'access-review.csv');
  assert.equal(b.sheets[0]!.name, 'access-review');
  assert.deepEqual(b.sheets[0]!.cells, { A1: 'User', B1: 'Status', A2: 'jdoe', B2: 'Enabled', A3: 'Doe, J', B3: 'Disabled' });
  const tampered = JSON.parse(writeBook(b)) as { sheets: { cells: Record<string, string>; formats: Record<string, unknown> }[] };
  tampered.sheets[0]!.cells['../x'] = 'bad';
  tampered.sheets[0]!.formats.A1 = { b: true, color: 'expression(alert(1))', fmt: 'currency' };
  const b2 = readBook(JSON.stringify({ type: 'excel', ...tampered }));
  assert.equal(b2.sheets[0]!.cells['../x'], undefined);
  assert.deepEqual(b2.sheets[0]!.formats.A1, { b: true, fmt: 'currency' });
});
