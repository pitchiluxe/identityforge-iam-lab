import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { createCompanyWorld } from '../src/world/mspSeed.ts';
import { MSP_COMPANIES, profileById } from '../src/world/profiles.ts';
import { createUser, deleteUser, renameUserSam } from '../src/world/directory.ts';
import { assignWorkstation, workstationOf } from '../src/world/workstations.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

const company = (id: string) => createCompanyWorld(profileById(id)!);

test('workstations: every seeded employee has exactly one machine, named by the company standard', () => {
  for (const p of MSP_COMPANIES) {
    const w = createCompanyWorld(p);
    const names = w.ad.computers.map((c) => c.name);
    assert.equal(new Set(names).size, names.length, `${p.id}: unique names`);
    for (const u of w.ad.users.filter((x) => x.kind === 'user')) {
      const mine = w.ad.computers.filter((c) => c.primaryUser === u.sam);
      assert.equal(mine.length, 1, `${p.id}: ${u.sam} has one machine`);
      assert.match(mine[0].name, new RegExp(`^${p.prefix}-WKS-\\d{4}$`));
    }
  }
});

test('workstations: a new hire gets one machine; asking again returns the same one', () => {
  const k = company('kestrel');
  const before = k.ad.computers.length;
  createUser(k, { sam: 'nhire', givenName: 'New', surname: 'Hire', ou: 'Kestrel/Staging' });
  assert.equal(k.ad.computers.length, before + 1);
  const m = workstationOf(k, 'nhire')!;
  assert.equal(m.ou, 'Kestrel/Computers');
  assert.equal(assignWorkstation(k, 'nhire'), m);
  assert.equal(k.ad.computers.length, before + 1);
});

test('workstations: admin and service accounts get none, and Meridian is untouched', () => {
  const k = company('kestrel');
  const before = k.ad.computers.length;
  createUser(k, { sam: 'svc-test', givenName: 'svc', surname: 'test', ou: 'Kestrel/ServiceAccounts', kind: 'service' });
  createUser(k, { sam: 'adm-test', givenName: 'adm', surname: 'test', ou: 'Kestrel/Admins', kind: 'admin' });
  assert.equal(k.ad.computers.length, before);
  const m = createWorld(3);
  const mBefore = m.ad.computers.length;
  createUser(m, { sam: 'zz', givenName: 'Z', surname: 'Z', ou: 'Corp/Staging' });
  assert.equal(m.ad.computers.length, mBefore);
});

test('workstations: on a greenfield domain machines land in the default Computers container', () => {
  const h = company('harborline');
  createUser(h, { sam: 'first.hire', givenName: 'First', surname: 'Hire', ou: 'Users' });
  assert.equal(workstationOf(h, 'first.hire')!.ou, 'Computers');
});

test('workstations: a deleted user leaves a reclaimed machine; a renamed user keeps theirs', () => {
  const k = company('kestrel');
  const u = k.ad.users.find((x) => x.kind === 'user')!;
  const m = workstationOf(k, u.sam)!;
  deleteUser(k, u.sam);
  assert.equal(m.primaryUser, null);
  assert.equal(m.description, `Reclaimed from ${u.displayName}`);
  assert.ok(k.ad.computers.includes(m));
  const v = k.ad.users.find((x) => x.kind === 'user')!;
  const vm = workstationOf(k, v.sam)!;
  renameUserSam(k, v.sam, 'renamed1');
  assert.equal(vm.primaryUser, 'renamed1');
});

// ---------------------------------------------------------------- Entra devices (Task 2)
import { runEntraSync } from '../src/world/cloud.ts';

test('devices: synced company workstations are hybrid-joined Entra devices owned by their user', () => {
  const b = company('brightwater');
  runEntraSync(b);
  for (const u of b.ad.users.filter((x) => x.kind === 'user' && x.enabled)) {
    const pc = workstationOf(b, u.sam)!;
    const d = b.entra.devices?.find((x) => x.name === pc.name);
    assert.ok(d, `${pc.name} is an Entra device`);
    assert.equal(d!.trustType, 'Hybrid Azure AD joined');
    assert.equal(d!.ownerUpn, u.upn);
    assert.equal(d!.accountEnabled, true);
  }
  const pc = workstationOf(b, b.ad.users.find((x) => x.kind === 'user')!.sam)!;
  pc.enabled = false;
  runEntraSync(b);
  assert.equal(b.entra.devices!.find((x) => x.name === pc.name)!.accountEnabled, false);
});

test('devices: Meridian gets no device list', () => {
  const m = createWorld(3);
  runEntraSync(m);
  assert.equal(m.entra.devices, undefined);
});

// ---------------------------------------------------------------- sign-ins and signedInOn (Task 3)
import { signIn } from '../src/world/directory.ts';
import { evaluate } from '../src/scenarios/grader.ts';
import { nowIso } from '../src/core/time.ts';

test('sign-in: signing in as a user on their own machine is audited in their company and checkable', () => {
  const k = company('kestrel');
  const u = k.ad.users.find((x) => x.kind === 'user' && x.enabled && x.labPassword)!;
  const pc = workstationOf(k, u.sam)!;
  const before = nowIso();
  const r = signIn(k, u.sam, u.labPassword!, pc.name);
  assert.equal(r.ok, true);
  assert.ok(k.audit.some((e) => e.eventId === 4624 && e.target === u.sam && e.origin === pc.name));
  assert.equal(evaluate(k, { k: 'signedInOn', sam: u.sam, host: pc.name, after: before }).pass, true);
  assert.equal(evaluate(k, { k: 'signedInOn', sam: u.sam, host: pc.name, after: nowIso() }).pass, false, 'older sign-ins do not count');
  assert.equal(evaluate(k, { k: 'signedInOn', sam: u.sam, host: 'KMF-WKS-9999', after: before }).pass, false, 'other machine does not count');
});

test('sign-in: a failed attempt does not satisfy signedInOn, and lockout names the company DC', () => {
  const k = company('kestrel');
  const u = k.ad.users.find((x) => x.kind === 'user' && x.enabled)!;
  const pc = workstationOf(k, u.sam)!;
  const before = nowIso();
  for (let i = 0; i < 5; i++) signIn(k, u.sam, 'wrong-password', pc.name);
  const check = evaluate(k, { k: 'signedInOn', sam: u.sam, after: before });
  assert.equal(check.pass, false);
  assert.match(check.detail, new RegExp(`No successful sign-in by ${u.sam}`));
  assert.equal(k.audit.find((e) => e.eventId === 4740 && e.target === u.sam)?.origin, 'KMF-DC01');
  const m = createWorld(3);
  for (let i = 0; i < 5; i++) signIn(m, 'vhale', 'wrong-password', 'MHS-TEST-WKS01');
  assert.equal(m.audit.find((e) => e.eventId === 4740 && e.target === 'vhale')?.origin, 'MHS-DC01');
});
