import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock, nowIso } from '../src/core/time.ts';
import type { ScenarioInstance, World } from '../src/core/types.ts';
import { createCompanyWorld } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { openTicket } from '../src/world/itsm.ts';
import { setEnabled } from '../src/world/directory.ts';
import { escalateTicket, resolveGated } from '../src/world/servicenow.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

/** A hand-built scenario: disable one person, resolve Fulfilled; optionally an expected escalation. */
function setup(escalation?: ScenarioInstance['escalation']): { w: World; s: ScenarioInstance; ticket: string; sam: string } {
  const w = createCompanyWorld(profileById('brightwater')!);
  const sam = w.ad.users.find((u) => u.kind === 'user' && u.enabled)!.sam;
  const tk = openTicket(w, { type: 'Request', short: 'Leaver', description: `Please disable ${sam}.`, caller: 'HR', category: 'Access', priority: 2, scenarioId: 'SCN-0001' });
  const s: ScenarioInstance = {
    id: 'SCN-0001', templateId: 'test', twist: 'x', title: 'Leaver', category: 'Lifecycle' as ScenarioInstance['category'], difficulty: 1, skills: [], started: nowIso(),
    ticketIds: [tk.id], mailIds: [], params: {}, hints: ['Leavers are disabled first, then cleaned up.'], hintsUsed: 0, debrief: 'Disable, then resolve.', interview: { question: '', modelAnswer: '' },
    designedBy: null, result: null, status: 'active', escalation,
    checks: [
      { id: 'c1', label: 'The leaver is disabled', critical: true, spec: { k: 'adEnabled', sam, value: false } },
      { id: 'c2', label: 'Ticket resolved', critical: true, spec: { k: 'ticketResolved', ticket: tk.id, codes: escalation ? ['Escalated to Security'] : ['Solved (Fulfilled)'] } },
    ],
  };
  w.scenarios.push(s);
  return { w, s, ticket: tk.id, sam };
}

test('servicenow: Resolve is refused while a critical check fails, with a hint that sharpens; then accepted', () => {
  const { w, s, ticket, sam } = setup();
  const r1 = resolveGated(w, ticket, 'Solved (Fulfilled)', 'Disabled the account per HR.');
  assert.equal(r1.accepted, false);
  assert.match(r1.hint!, /The leaver is disabled/);
  const tk = w.tickets.find((x) => x.id === ticket)!;
  assert.notEqual(tk.state, 'Resolved', 'ticket restored');
  assert.equal(tk.resolution, null);
  const r2 = resolveGated(w, ticket, 'Solved (Fulfilled)', 'Disabled the account per HR.');
  assert.match(r2.hint!, /is enabled|Enabled/i, 'second hint gives the detail');
  assert.equal(s.attempts, 2);
  setEnabled(w, sam, false);
  const r3 = resolveGated(w, ticket, 'Solved (Fulfilled)', 'Disabled the account per HR.');
  assert.equal(r3.accepted, true);
  assert.equal(s.status, 'passed');
  assert.equal(tk.state, 'Resolved');
});

test('servicenow: tickets without a lab resolve normally', () => {
  const w = createCompanyWorld(profileById('brightwater')!);
  const tk = openTicket(w, { type: 'Incident', short: 'x', description: 'y', caller: 'z', category: 'Access', priority: 4 });
  assert.equal(resolveGated(w, tk.id, 'Solved (Fulfilled)', 'Answered the question for the caller.').accepted, true);
});

test('servicenow: escalation verdicts — declined when not needed, redirected to the wrong team, accepted and closed', () => {
  const plain = setup();
  const d = escalateTicket(plain.w, plain.ticket, 'Security Operations', 'Looks odd');
  assert.equal(d.verdict, 'declined');
  assert.match(d.response, /does not need/);
  assert.equal(plain.w.tickets.find((x) => x.id === plain.ticket)!.state, 'In Progress');

  const sus = setup({ team: 'Security Operations', outcome: 'closed', code: 'Escalated to Security', response: 'Security Operations has taken this over as a suspected social-engineering attempt.' });
  const wrong = escalateTicket(sus.w, sus.ticket, 'Customer approver', 'Need approval');
  assert.equal(wrong.verdict, 'redirected');
  const right = escalateTicket(sus.w, sus.ticket, 'Security Operations', 'Unverified request for privileged change');
  assert.equal(right.verdict, 'accepted');
  const tk = sus.w.tickets.find((x) => x.id === sus.ticket)!;
  assert.equal(tk.state, 'Resolved');
  assert.equal(tk.resolution!.code, 'Escalated to Security');
  assert.deepEqual(tk.escalations!.map((e) => e.verdict), ['redirected', 'accepted']);
});

test('servicenow: an accepted "returned" escalation hands the ticket back with instructions', () => {
  const r = setup({ team: 'Customer approver', outcome: 'returned', response: 'Approved by the customer: their Global Admin will assign the role. Resolve as Rejected - Not Approved for the MSP.' });
  const v = escalateTicket(r.w, r.ticket, 'Customer approver', 'Role assignment needs the customer');
  assert.equal(v.verdict, 'accepted');
  const tk = r.w.tickets.find((x) => x.id === r.ticket)!;
  assert.equal(tk.state, 'In Progress');
  assert.ok(tk.workNotes.some((n) => n.text.includes('Approved by the customer')));
});
