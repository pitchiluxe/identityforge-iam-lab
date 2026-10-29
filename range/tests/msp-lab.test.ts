import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { generateLab, labReport } from '../src/scenarios/msp/lab.ts';
import { MSP_TEMPLATES } from '../src/scenarios/msp/index.ts';
import { resolveGated, escalateTicket } from '../src/world/servicenow.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

test('lab: a generated lab fits the company, has the requested size and at least one suspicious ticket', () => {
  const w = createCompanyWorld(profileById('kestrel')!);
  const lab = generateLab(w, { count: 5, difficulty: 3, seed: 42 });
  assert.equal(lab.length, 5);
  const tpl = (id: string) => MSP_TEMPLATES.find((x) => x.id === id)!;
  assert.ok(lab.some((s) => tpl(s.templateId).suspicious), 'has a suspicious ticket');
  assert.ok(lab.every((s) => tpl(s.templateId).fits !== undefined));
  assert.equal(new Set(lab.map((s) => s.params.sam ?? s.params.upn ?? s.id)).size, lab.length, 'no two tickets about the same person');
});

test('lab: a greenfield company gets only what fits (the OU build-out)', () => {
  const w = createCompanyWorld(profileById('harborline')!);
  const lab = generateLab(w, { count: 4, difficulty: 3, seed: 1 });
  assert.deepEqual(lab.map((s) => s.templateId), ['msp-greenfield-ou']);
});

test('lab: difficulty caps the templates used', () => {
  const w = createCompanyWorld(profileById('brightwater')!);
  const lab = generateLab(w, { count: 6, difficulty: 1, seed: 9 });
  assert.ok(lab.every((s) => s.difficulty <= 1));
});

test('report: solved tickets score 100; rejected attempts and wrong escalations cost points', () => {
  const w = createCompanyWorld(profileById('brightwater')!);
  const lab = generateLab(w, { count: 4, difficulty: 3, seed: 5 });
  const [first, second] = lab;
  const tpl = (id: string) => MSP_TEMPLATES.find((x) => x.id === id)!;
  tpl(first!.templateId).solve(w, first!);
  if (first!.status === 'active') first!.status = 'passed';
  // second: one rejected resolve, then a declined/redirected escalation, then solved.
  resolveGated(w, second!.ticketIds[0]!, 'Solved (Fulfilled)', 'Trying to close it early.');
  const exp = second!.escalation;
  escalateTicket(w, second!.ticketIds[0]!, exp?.team === 'Tier 3 Engineering' ? 'Change Advisory Board' : 'Tier 3 Engineering', 'Not sure who owns this.');
  const r = labReport(w, lab.map((s) => s.id));
  const a = r.tickets.find((x) => x.id === first!.id)!;
  const b = r.tickets.find((x) => x.id === second!.id)!;
  assert.equal(a.score, 100);
  assert.equal(b.attempts, 1);
  assert.equal(b.wrongEscalations, 1);
  assert.ok(b.score <= 75, `penalised: ${b.score}`);
  assert.ok(b.senior.length > 20, 'senior engineer explanation');
  assert.equal(r.tickets.length, 4);
  assert.ok(r.score >= 0 && r.score <= 100);
});
