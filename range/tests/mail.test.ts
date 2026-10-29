import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { deleteMail, deliverMail, emptyDeletedItems, flagMail, markMailRead, moveMail, quoteForReply, saveDraft, sendMail } from '../src/world/itsm.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

function inbox() {
  const w = createWorld(3);
  const m = deliverMail(w, { from: 'vhale@meridianhealth.test', fromName: 'Victor Hale', minutesAgo: 5, subject: 'Budget review', body: 'Can you check the numbers?' });
  return { w, m };
}

test('mail: opening marks read; it can be marked unread again', () => {
  const { w, m } = inbox();
  assert.equal(m.read, false);
  markMailRead(w, m.id, true);
  assert.equal(w.mail.find((x) => x.id === m.id)!.read, true);
  markMailRead(w, m.id, false);
  assert.equal(w.mail.find((x) => x.id === m.id)!.read, false);
});

test('mail: flag, archive, junk, and delete goes to Deleted Items first, then permanently', () => {
  const { w, m } = inbox();
  flagMail(w, m.id, true);
  assert.equal(m.flagged, true);
  moveMail(w, m.id, 'Archive');
  assert.equal(m.folder, 'Archive');
  moveMail(w, m.id, 'Junk');
  assert.equal(m.folder, 'Junk');
  deleteMail(w, m.id);
  assert.equal(m.folder, 'Deleted');
  deleteMail(w, m.id);
  assert.ok(!w.mail.some((x) => x.id === m.id), 'deleting from Deleted Items removes it');
  const n = inbox();
  deleteMail(n.w, n.m.id);
  emptyDeletedItems(n.w);
  assert.ok(!n.w.mail.some((x) => x.folder === 'Deleted'));
  assert.throws(() => moveMail(n.w, 'nope', 'Inbox'), /not found/i);
});

test('mail: drafts are saved, updated, and sent (leaving Drafts) with Cc', () => {
  const { w } = inbox();
  const d = saveDraft(w, { to: 'hkovacs@meridianhealth.test', cc: '', subject: 'Draft', body: 'v1' });
  assert.equal(d.folder, 'Drafts');
  saveDraft(w, { id: d.id, to: 'hkovacs@meridianhealth.test', cc: 'vhale@meridianhealth.test', subject: 'Draft', body: 'v2' });
  assert.equal(w.mail.filter((x) => x.folder === 'Drafts').length, 1);
  assert.equal(w.mail.find((x) => x.id === d.id)!.body, 'v2');
  const sent = sendMail(w, 'hkovacs@meridianhealth.test', 'Final', 'Hello', { cc: 'vhale@meridianhealth.test', draftId: d.id });
  assert.equal(sent.folder, 'Sent');
  assert.equal(sent.cc, 'vhale@meridianhealth.test');
  assert.ok(!w.mail.some((x) => x.id === d.id), 'draft removed once sent');
});

test('mail: reply and forward quote the original the way Outlook does', () => {
  const { m } = inbox();
  const r = quoteForReply(m, 'reply');
  assert.equal(r.subject, 'RE: Budget review');
  assert.equal(r.to, 'vhale@meridianhealth.test');
  assert.match(r.body, /From: Victor Hale <vhale@meridianhealth\.test>[\s\S]*Subject: Budget review[\s\S]*Can you check the numbers\?/);
  const f = quoteForReply(m, 'forward');
  assert.equal(f.subject, 'FW: Budget review');
  assert.equal(f.to, '');
  assert.equal(quoteForReply({ ...m, subject: 'RE: Budget review' }, 'reply').subject, 'RE: Budget review', 'no RE: RE:');
});
