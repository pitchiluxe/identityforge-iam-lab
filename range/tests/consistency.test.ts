/**
 * Every lab's paperwork must match its systems. A ticket that names a person,
 * a computer or an account the learner cannot find, or describes events the
 * logs do not show, teaches people to distrust the evidence instead of reading it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { TEMPLATES, startScenario } from '../src/scenarios/engine.ts';
import type { World } from '../src/core/types.ts';
import { labAccounts } from '../src/world/labaccounts.ts';
import { signIn } from '../src/world/directory.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

const SEEDS = [1, 7, 42, 1234, 98765];
/** Teams and systems that raise tickets on their own behalf. */
const NOT_PEOPLE = new Set(['Internal Audit', 'Sentinel (automated)']);
/** Twists whose whole point is that the person is missing from a system. */
const MISSING_ON_PURPOSE = new Set(['joiner/no-hr-record']);

function knownPerson(w: World, name: string): boolean {
  const n = name.trim().toLowerCase();
  return w.ad.users.some((u) => u.displayName.toLowerCase() === n || u.sam.toLowerCase() === n || u.upn.toLowerCase() === n)
    || w.hr.workers.some((x) => `${x.first} ${x.last}`.toLowerCase() === n)
    || w.entra.users.some((u) => u.displayName.toLowerCase() === n || u.upn.toLowerCase() === n);
}

function knownHost(w: World, name: string): boolean {
  return w.ad.computers.some((c) => c.name.toLowerCase() === name.toLowerCase());
}

for (const tpl of TEMPLATES) {
  for (const twist of tpl.twists) {
    test(`${tpl.id} / ${twist.id}: ticket and mail match the systems`, () => {
      for (const seed of SEEDS) {
        const w = createWorld(seed);
        const s = startScenario(w, { templateId: tpl.id, twist: twist.id, seed });
        for (const id of s.ticketIds) {
          const tk = w.tickets.find((x) => x.id === id)!;
          if (tk.requestedFor && !NOT_PEOPLE.has(tk.requestedFor) && !MISSING_ON_PURPOSE.has(`${tpl.id}/${twist.id}`)) assert.ok(knownPerson(w, tk.requestedFor), `seed ${seed} ${id}: requested-for "${tk.requestedFor}" is in no directory or HR record`);
          const text = `${tk.short}\n${tk.description}`;
          for (const host of text.match(/\bMHS-LT-\d+\b/g) ?? []) assert.ok(knownHost(w, host), `seed ${seed} ${id}: names ${host}, which is not in AD`);
          const subject = w.ad.users.find((u) => u.displayName === tk.requestedFor);
          if (subject) assert.ok(subject.created <= tk.opened, `seed ${seed} ${id}: ${subject.sam} was created after the ticket was opened`);
          if (subject && /\b(signed|logged|log|sign) ?in to (their|my|her|his) laptop\b/i.test(text)) {
            assert.ok(subject.lastLogon && subject.lastLogon <= tk.opened, `seed ${seed} ${id}: ticket says ${subject.sam} signed in, AD shows no logon before the ticket`);
            assert.equal(subject.mustChangePassword, false, `seed ${seed} ${id}: ${subject.sam} signed in but AD still says must change password`);
            assert.ok(w.audit.some((e) => e.eventId === 4624 && e.target === subject.sam), `seed ${seed} ${id}: no 4624 logon event for ${subject.sam}`);
            const pc = w.ad.computers.find((c) => c.primaryUser === subject.sam);
            assert.ok(pc, `seed ${seed} ${id}: ${subject.sam} has no laptop in AD`);
          }
          if (/changed my password last week/i.test(text)) {
            const caller = w.ad.users.find((u) => u.displayName === tk.caller)!;
            const age = (Date.parse(tk.opened) - Date.parse(caller.pwdLastSet)) / 86_400_000;
            assert.ok(age >= 5 && age <= 10, `seed ${seed} ${id}: says password changed last week, pwdLastSet is ${age.toFixed(1)} days old`);
          }
          assert.doesNotMatch(text, /\bSales\b|\bcustomer calls?\b/, `seed ${seed} ${id}: Meridian is a hospital and has no Sales team`);
        }
        for (const id of s.mailIds) {
          const m = w.mail.find((x) => x.id === id)!;
          for (const host of m.body.match(/\bMHS-LT-\d+\b/g) ?? []) assert.ok(knownHost(w, host), `seed ${seed} ${id}: mail names ${host}, which is not in AD`);
        }
      }
    });
  }
}

/**
 * Where a person is missing from a system on purpose, the lab is about that gap.
 * Anyone else must be findable everywhere: AD, Entra ID, Okta and PeopleHub.
 */
const GAPS_ON_PURPOSE: Record<string, readonly ('HR' | 'Entra' | 'Okta')[]> = {
  'hybrid-sync/staging-ou': ['Entra', 'Okta'],
  'hybrid-sync/soft-match-blocked': ['Entra', 'Okta'],
  'orphan-accounts/contractor-and-missed-leaver': ['HR'],
};

function gaps(w: World): string[] {
  const out: string[] = [];
  for (const u of w.ad.users.filter((x) => x.kind === 'user')) {
    const miss = [
      !w.hr.workers.some((x) => x.employeeId && x.employeeId === u.employeeId) && 'HR',
      !w.entra.users.some((x) => x.onPremSam === u.sam && !x.deleted) && 'Entra',
      !w.okta.users.some((x) => x.onPremSam === u.sam) && 'Okta',
    ].filter((x): x is string => !!x);
    for (const m of miss) out.push(`${m}:${u.sam}`);
  }
  for (const x of w.hr.workers.filter((x) => x.status === 'Active')) if (!w.ad.users.some((u) => u.employeeId === x.employeeId)) out.push(`AD:${x.employeeId}`);
  return out;
}

test('the starting company: every employee is in AD, Entra ID, Okta and PeopleHub', () => {
  for (const seed of SEEDS) assert.deepEqual(gaps(createWorld(seed)), [], `seed ${seed}`);
});

for (const tpl of TEMPLATES) {
  for (const twist of tpl.twists) {
    test(`${tpl.id} / ${twist.id}: nobody is missing from a system unless the lab is about it`, () => {
      const allowed = GAPS_ON_PURPOSE[`${tpl.id}/${twist.id}`] ?? [];
      for (const seed of SEEDS) {
        const w = createWorld(seed);
        startScenario(w, { templateId: tpl.id, twist: twist.id, seed });
        const unexpected = gaps(w).filter((g) => !allowed.includes(g.split(':')[0] as 'HR'));
        assert.deepEqual(unexpected, [], `seed ${seed}`);
      }
    });
  }
}

test('every password on the lab accounts sheet signs in', () => {
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    const rows = labAccounts(w);
    assert.ok(rows.length >= 30);
    for (const r of rows) {
      assert.ok(r.password, `seed ${seed}: ${r.sam} has no password`);
      assert.ok(r.password!.length >= 12 && [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((x) => x.test(r.password!)).length >= 3, `${r.password} meets the policy`);
      const res = signIn(w, r.sam, r.password!, 'MHS-TEST-WKS01');
      assert.equal(res.ok, true, `seed ${seed}: ${r.sam} could not sign in`);
    }
    assert.ok(!rows.some((r) => /^(adm-|svc-|bg-)/.test(r.sam) || r.sam === w.player.sam), 'privileged and own accounts stay off the sheet');
  }
});

test('accounts a lab creates for the backdrop have a working password too', () => {
  const w = createWorld(7);
  const s = startScenario(w, { templateId: 'hybrid-sync', twist: 'staging-ou', seed: 7 });
  const row = labAccounts(w).find((r) => r.sam === s.params.sam)!;
  assert.ok(row.password);
  assert.equal(signIn(w, row.sam, row.password!, 'MHS-TEST-WKS01').ok, true);
});
