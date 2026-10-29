import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { MSP_COMPANIES, profileById } from '../src/world/profiles.ts';
import { createCompanyWorld } from '../src/world/mspSeed.ts';
import { startScenario } from '../src/scenarios/engine.ts';
import { grade } from '../src/scenarios/grader.ts';
import { generateLab, rewordFacts } from '../src/scenarios/msp/lab.ts';
import { resetPassword, setEnabled } from '../src/world/directory.ts';
import { escalateTicket, resolveGated } from '../src/world/servicenow.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

test('review C1: the lookalike sender domain is never the real domain', () => {
  for (const p of MSP_COMPANIES) {
    const w = createCompanyWorld(p);
    if (!w.ad.users.some((u) => u.kind === 'user')) continue;
    const s = startScenario(w, { templateId: 'msp-sus-lookalike', seed: 3 });
    const caller = w.tickets.find((x) => x.id === s.ticketIds[0])!.caller;
    assert.notEqual(caller.split('@')[1], p.domain, `${p.id}: ${caller}`);
  }
});

test('review I2: the gate refuses a ticket the grader fails (critical checks met, score below the bar)', () => {
  const w = createCompanyWorld(profileById('brightwater')!);
  const s = startScenario(w, { templateId: 'msp-leaver', twist: 'standard', seed: 4 });
  setEnabled(w, s.params.sam!, false);
  const r = resolveGated(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Disabled the account in AD only.');
  assert.equal(r.accepted, false);
  assert.equal(s.status, 'active');
  assert.equal(grade(w, s).passed, false);
});

test('review I3: an AD password reset on the impostor target fails the suspicious MFA ticket', () => {
  const w = createCompanyWorld(profileById('kestrel')!);
  const s = startScenario(w, { templateId: 'msp-sus-mfa-unverified', seed: 5 });
  const sam = w.ad.users.find((u) => u.upn === s.params.upn)!.sam;
  resetPassword(w, sam, { mustChange: true, password: 'Impostor-2026-Pass!' });
  resolveGated(w, s.ticketIds[0]!, 'Unable to Verify Identity', 'Could not verify, closing.');
  assert.equal(grade(w, s).passed, false);
});

test('review I4: no person is the subject of two tickets in one lab', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const w = createCompanyWorld(profileById('cobalt')!);
    const lab = generateLab(w, { count: 8, difficulty: 3, seed });
    const subjects = lab.flatMap((s) => {
      const out: string[] = [];
      if (s.params.sam) out.push(w.ad.users.find((u) => u.sam === s.params.sam)?.upn ?? s.params.sam);
      if (s.params.upn) out.push(s.params.upn);
      return [...new Set(out)];
    });
    assert.equal(new Set(subjects).size, subjects.length, `seed ${seed}: ${subjects.join(', ')}`);
  }
});

test('review I5: rewording must keep phone digits, short department names and the roles a trap hinges on', () => {
  const w = createCompanyWorld(profileById('kestrel')!);
  const mfa = startScenario(w, { templateId: 'msp-mfa-reset', seed: 6 });
  const tk = w.tickets.find((x) => x.id === mfa.ticketIds[0])!;
  const last4 = /are (\d{4})\./.exec(tk.description)![1]!;
  assert.ok(rewordFacts(tk, mfa).includes(last4));
  const ga = startScenario(w, { templateId: 'msp-sus-global-admin', seed: 6 });
  const gtk = w.tickets.find((x) => x.id === ga.ticketIds[0])!;
  assert.ok(rewordFacts(gtk, ga).includes('Global Administrator'));
  const rb = startScenario(w, { templateId: 'msp-rbac-reader', twist: 'asks-contributor', seed: 6 });
  const rtk = w.tickets.find((x) => x.id === rb.ticketIds[0])!;
  assert.ok(rewordFacts(rtk, rb).includes('Contributor'));
});

test('review I6: escalating the export request to Security is accepted, not answered with "proceed"', () => {
  const w = createCompanyWorld(profileById('kestrel')!);
  const s = startScenario(w, { templateId: 'msp-sus-export', seed: 7 });
  const v = escalateTicket(w, s.ticketIds[0]!, 'Security Operations', 'Bulk personal data to a personal mailbox.');
  assert.equal(v.verdict, 'accepted');
  assert.doesNotMatch(v.response, /proceed/i);
  assert.equal(grade(w, s).passed, true);
});

test('review I6: a declined escalation never tells the engineer to just do it', () => {
  const w = createCompanyWorld(profileById('kestrel')!);
  const s = startScenario(w, { templateId: 'msp-guest', seed: 8 });
  const v = escalateTicket(w, s.ticketIds[0]!, 'Security Operations', 'Not sure.');
  assert.equal(v.verdict, 'declined');
  assert.doesNotMatch(v.response, /proceed with it yourself/i);
});
