import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newPdf, parsePdf, writePdf, addAnnot, removeAnnot, insertPages, deletePages, rotatePages, movePage,
  searchPdf, setBlockText, addTextBlock, markRedactions, applyRedactions, fillField, setOpenPassword, checkOpenPassword,
  isProtected, pdfText, STAMPS, type PdfDoc,
} from '../src/core/pdfdoc.ts';
import { samplePdfs } from '../src/world/pdfSamples.ts';

const doc = (): PdfDoc => {
  let d = newPdf('Access Review', 'admin');
  d = addTextBlock(d, 0, 'Quarterly access review for Finance. Owner: vhale.', 'text');
  d = insertPages(d, 1, 2);
  d = addTextBlock(d, 1, 'Page two lists grp-finance members. SSN 123-45-6789.', 'text');
  d = addTextBlock(d, 2, 'Sign-off page.', 'text');
  return d;
};
const at = '2026-10-28T09:00:00.000Z';

test('pdf: a saved document starts like a PDF and reads back the same', () => {
  const d = doc();
  const raw = writePdf(d);
  assert.match(raw, /^%PDF-1\.7\n/);
  assert.deepEqual(parsePdf(raw), d);
  assert.throws(() => parsePdf('hello'), /Format error: not a PDF or corrupted/);
  assert.throws(() => parsePdf('%PDF-1.7\n{"pages":"x"}'), /Format error/);
});

test('pdf: hand-edited files are validated (colours, kinds, page numbers)', () => {
  const d = addAnnot(doc(), { page: 0, kind: 'highlight', x: 10, y: 10, w: 30, h: 4, color: '#ffff00', author: 'admin' }, at);
  const raw = writePdf(d).replace('#ffff00', 'red;background:url(x)').replace('"page":0', '"page":99');
  const back = parsePdf(raw);
  assert.equal(back.annots.length, 0, 'an annotation on a page that does not exist is dropped');
  const bad = writePdf(addAnnot(doc(), { page: 0, kind: 'rect', x: 0, y: 0, w: 5, h: 5, color: '#ff0000', author: 'admin' }, at)).replace('#ff0000', 'expression(1)');
  assert.equal(parsePdf(bad).annots[0]!.color, '#ff0000', 'unsafe colours fall back to the kind default');
});

test('pdf: comments are added and removed with ids, author and time', () => {
  let d = addAnnot(doc(), { page: 1, kind: 'note', x: 50, y: 20, w: 4, h: 4, text: 'Why is this user still here?', color: '#ffd400', author: 'admin' }, at);
  d = addAnnot(d, { page: 0, kind: 'stamp', x: 60, y: 5, w: 25, h: 8, text: 'Approved', color: '#2e7d32', author: 'admin' }, at);
  assert.deepEqual(d.annots.map((a) => a.id), ['a1', 'a2']);
  assert.equal(d.annots[0]!.created, at);
  assert.ok(STAMPS.includes('Approved'));
  d = removeAnnot(d, 'a1');
  assert.deepEqual(d.annots.map((a) => a.id), ['a2']);
});

test('pdf: Organize keeps comments and form fields on their pages', () => {
  let d = addAnnot(doc(), { page: 2, kind: 'note', x: 1, y: 1, w: 4, h: 4, text: 'p3', color: '#ffd400', author: 'admin' }, at);
  d = addAnnot(d, { page: 1, kind: 'note', x: 1, y: 1, w: 4, h: 4, text: 'p2', color: '#ffd400', author: 'admin' }, at);
  const del = deletePages(d, [1]);
  assert.equal(del.pages.length, 2);
  assert.deepEqual(del.annots.map((a) => [a.text, a.page]), [['p3', 1]], 'comments on a deleted page go with it; later pages shift up');
  assert.throws(() => deletePages(d, [0, 1, 2]), /cannot delete all pages/i);
  const moved = movePage(d, 2, 0);
  assert.equal(moved.pages[0]!.blocks.at(-1)!.text, 'Sign-off page.');
  assert.deepEqual(moved.annots.map((a) => [a.text, a.page]), [['p3', 0], ['p2', 2]]);
  const ins = insertPages(d, 0, 1);
  assert.deepEqual(ins.annots.map((a) => a.page), [3, 2]);
  const rot = rotatePages(d, [0, 2], 90);
  assert.deepEqual(rot.pages.map((p) => p.rotate), [90, 0, 90]);
  assert.equal(rotatePages(rot, [0], 270).pages[0]!.rotate, 0);
});

test('pdf: Find searches page text with match case and whole words', () => {
  const d = doc();
  assert.deepEqual(searchPdf(d, 'grp-finance').map((x) => x.page), [1]);
  assert.equal(searchPdf(d, 'FINANCE').length, 2);
  assert.equal(searchPdf(d, 'FINANCE', { matchCase: true }).length, 0);
  assert.equal(searchPdf(d, 'page', { wholeWord: true }).length, 2);
  assert.equal(pdfText(d).split('\f').length, 3, 'one form feed between pages');
});

test('pdf: Edit Text changes the words on the page', () => {
  const d = setBlockText(doc(), 2, 0, 'Signed off by vhale.');
  assert.equal(d.pages[2]!.blocks[0]!.text, 'Signed off by vhale.');
  assert.throws(() => setBlockText(d, 9, 0, 'x'), /page/i);
});

test('pdf: Search & Redact marks, then Apply removes the text for good', () => {
  let d = markRedactions(doc(), '123-45-6789', 'admin', at);
  assert.equal(d.annots.filter((a) => a.kind === 'redact').length, 1);
  assert.equal(searchPdf(d, '123-45-6789').length, 1, 'marked is not yet removed');
  d = applyRedactions(d);
  assert.equal(searchPdf(d, '123-45-6789').length, 0);
  assert.match(pdfText(d), /SSN ███████████\./);
  assert.equal(d.annots.filter((a) => a.kind === 'redact').length, 0);
});

test('pdf: forms fill, and an open password protects the file', () => {
  const form = samplePdfs('MERIDIAN', 'meridianhealth.test').find((s) => s.name === 'Access-Request-Form.pdf')!;
  const d0 = parsePdf(form.content);
  assert.ok(d0.fields.length >= 6);
  const f = d0.fields.find((x) => x.name === 'Requester')!;
  const d1 = fillField(d0, f.id, 'Jordan Doe');
  assert.equal(d1.fields.find((x) => x.id === f.id)!.value, 'Jordan Doe');
  const chk = d0.fields.find((x) => x.type === 'check')!;
  assert.equal(fillField(d0, chk.id, 'yes').fields.find((x) => x.id === chk.id)!.value, 'Yes');
  const locked = setOpenPassword(d1, 'S3cure!');
  assert.ok(isProtected(locked));
  assert.ok(!writePdf(locked).includes('S3cure!'), 'the password itself is not stored');
  assert.ok(checkOpenPassword(parsePdf(writePdf(locked)), 'S3cure!'));
  assert.ok(!checkOpenPassword(locked, 's3cure!'));
  assert.ok(!isProtected(setOpenPassword(locked, null)));
});

test('pdf: sample documents are valid and use the company names', () => {
  const all = samplePdfs('MERIDIAN', 'meridianhealth.test');
  assert.ok(all.length >= 3);
  for (const s of all) {
    const d = parsePdf(s.content);
    assert.ok(d.pages.length >= 1, s.name);
    assert.match(s.folder, /^(Documents\\Policies|Documents\\Reference|Downloads)$/);
  }
  assert.match(all.map((s) => s.content).join(''), /meridianhealth\.test/);
});
