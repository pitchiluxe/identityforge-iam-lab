import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import type { World } from '../src/core/types.ts';
import { createWorld } from '../src/world/seed.ts';
import { createOu, createUser, dnOf, setEnabled } from '../src/world/directory.ts';
import { findEntraUser, runEntraSync } from '../src/world/cloud.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

/** A minimal company world built by hand, so the world layer is tested without the MSP seed. */
function brightwaterLike(): World {
  const w = createWorld(5);
  w.profileId = 'brightwater';
  w.company = { name: 'Brightwater Law LLP', domain: 'brightwaterlaw.test' };
  w.ad = { domain: 'brightwaterlaw.test', netbios: 'BRIGHTWATER', ous: [], users: [], groups: [], computers: [] };
  w.entra = { ...w.entra, tenantName: 'Brightwater Law LLP', primaryDomain: 'brightwaterlaw.onmicrosoft.test', users: [], groups: [], syncScope: ['Firm/People'] };
  for (const [name, parent] of [['Firm', null], ['People', 'Firm'], ['Legal', 'Firm/People'], ['Staging', 'Firm']] as const) createOu(w, name, parent);
  return w;
}

test('world layer: a user created in a company gets that company UPN suffix and DN', () => {
  const w = brightwaterLike();
  const u = createUser(w, { sam: 'aruiz', givenName: 'Ana', surname: 'Ruiz', ou: 'Firm/People/Legal' });
  assert.equal(u.upn, 'aruiz@brightwaterlaw.test');
  assert.ok(dnOf(u, w).endsWith('OU=Legal,OU=People,OU=Firm,DC=brightwaterlaw,DC=test'), dnOf(u, w));
});

test('world layer: Entra sync follows the company own sync scope', () => {
  const w = brightwaterLike();
  createUser(w, { sam: 'aruiz', givenName: 'Ana', surname: 'Ruiz', ou: 'Firm/People/Legal', enabled: true, passwordSet: true });
  createUser(w, { sam: 'bstage', givenName: 'Ben', surname: 'Stage', ou: 'Firm/Staging' });
  setEnabled(w, 'aruiz', true);
  runEntraSync(w);
  assert.ok(findEntraUser(w, 'aruiz@brightwaterlaw.test'), 'in-scope user synced');
  assert.equal(findEntraUser(w, 'bstage@brightwaterlaw.test'), undefined, 'staging user not synced');
});

test('world layer: Meridian DNs are unchanged', () => {
  const w = createWorld(1);
  const u = w.ad.users.find((x) => x.kind === 'user')!;
  assert.ok(dnOf(u, w).endsWith('DC=meridianhealth,DC=test'));
  assert.equal(dnOf(u), dnOf(u, w));
});

// ---------------------------------------------------------------- seeding (Task 3)
import { MSP_COMPANIES, profileById } from '../src/world/profiles.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { TIER0_GROUPS } from '../src/world/directory.ts';

const employees = (w: World) => w.ad.users.filter((u) => u.kind === 'user');

test('seed: a company world is deterministic for a fixed clock', () => {
  setClock(() => Date.parse('2026-10-19T14:00:00Z'));
  try {
    for (const p of MSP_COMPANIES) assert.equal(JSON.stringify(createCompanyWorld(p)), JSON.stringify(createCompanyWorld(p)), p.id);
  } finally {
    setClock(() => (t += 1000));
  }
});

test('seed: identity, headcount and HR match the profile', () => {
  for (const p of MSP_COMPANIES) {
    const w = createCompanyWorld(p);
    assert.equal(w.profileId, p.id);
    assert.equal(w.ad.domain, p.domain);
    assert.equal(w.entra.primaryDomain, p.tenant);
    assert.deepEqual(w.entra.syncScope, p.syncScope);
    assert.equal(employees(w).length, p.staff, `${p.id} headcount`);
    for (const wk of w.hr.workers.filter((x) => x.status === 'Active')) {
      assert.ok(w.ad.users.some((u) => u.employeeId === wk.employeeId), `${p.id}: HR worker ${wk.employeeId} has an AD account`);
    }
    for (const u of employees(w).filter((x) => x.enabled)) {
      const role = p.roles.find((r) => r.title === u.title)!;
      assert.ok(role, `${p.id}: ${u.sam} has a profile job title`);
      for (const g of [...p.baseAccess, role.roleGroup, ...p.roleAccess[role.roleGroup]]) assert.ok(u.memberOf.includes(g), `${p.id}: ${u.sam} has birthright ${g}`);
    }
  }
});

test('seed: synced users reach the company tenant', () => {
  for (const p of MSP_COMPANIES) {
    const w = createCompanyWorld(p);
    for (const u of employees(w).filter((x) => x.enabled && p.syncScope.some((s) => x.ou.startsWith(s)))) {
      assert.ok(w.entra.users.some((e) => e.onPremSam === u.sam && e.upn.endsWith(`@${p.domain}`)), `${p.id}: ${u.sam} synced`);
    }
  }
});

test('seed: the MSP engineer is delegated, never Tier 0 or Global Administrator', () => {
  for (const p of MSP_COMPANIES) {
    const w = createCompanyWorld(p);
    const ad = w.ad.users.find((u) => u.sam === MSP_ADMIN)!;
    assert.ok(ad, `${p.id}: MSP admin exists`);
    assert.equal(w.player.adminSam, MSP_ADMIN);
    assert.ok(!ad.memberOf.some((g) => TIER0_GROUPS.includes(g)), `${p.id}: not Tier 0`);
    const cloud = w.entra.users.find((e) => e.upn === `${MSP_ADMIN}@${p.tenant}`)!;
    assert.ok(cloud, `${p.id}: MSP cloud admin exists`);
    assert.ok(!cloud.roles.some((r) => r.role === 'Global Administrator'));
    assert.ok(cloud.roles.some((r) => r.role === 'User Administrator' && r.assignment === 'active'));
  }
});

test('seed: greenfield Harborline is an empty domain', () => {
  const w = createCompanyWorld(profileById('harborline')!);
  assert.equal(employees(w).length, 0);
  assert.equal(w.hr.workers.length, 0);
  assert.ok(!w.ad.ous.includes('Harborline'), 'learner builds the OU tree');
  assert.ok(w.ad.ous.includes('Users'), 'default Users container');
});

test('seed: each starting reality shows in the data', () => {
  const now = Date.parse('2026-10-19T14:00:00Z');
  const k = createCompanyWorld(profileById('kestrel')!);
  assert.ok(employees(k).filter((u) => u.enabled && u.lastLogon && now - Date.parse(u.lastLogon) > 90 * 86400000).length >= 5, 'kestrel stale accounts');
  assert.ok(k.ad.groups.filter((g) => !g.privileged && g.ou !== 'Users' && !g.managedBy).length >= 3, 'kestrel ownerless groups');
  const a = createCompanyWorld(profileById('aldervalley')!);
  assert.ok(a.hr.transactions.filter((x) => Date.parse(x.effective) > now && Date.parse(x.effective) - now <= 30 * 86400000).length >= 10, 'aldervalley term churn');
  const l = createCompanyWorld(profileById('lumen')!);
  assert.ok(l.entra.users.filter((e) => e.userType === 'Guest').length >= 5, 'lumen guests');
  const r = createCompanyWorld(profileById('riverside')!);
  const contractors = r.hr.workers.filter((x) => x.workerType === 'Contractor');
  assert.ok(contractors.length >= 3 && contractors.every((c) => c.managerId && c.termDate), 'riverside sponsored contractors with end dates');
  const s = createCompanyWorld(profileById('summitridge')!);
  assert.ok(s.entra.users.some((e) => e.roles.some((x) => x.assignment === 'eligible')), 'summitridge PIM eligible roles');
  // Break-glass is the one standing exception every regulated tenant keeps (emergency access).
  assert.ok(!s.entra.users.some((e) => e.upn !== `${MSP_ADMIN}@${'summitridgecu.onmicrosoft.test'}` && !e.upn.startsWith('bg-emergency') && e.roles.some((x) => x.assignment === 'active' && x.permanent)), 'summitridge no permanent active roles');
  const at = createCompanyWorld(profileById('atlas')!);
  assert.ok(employees(at).some((u) => u.sam.includes('.')) && employees(at).some((u) => !u.sam.includes('.')), 'atlas two naming conventions');
});

test('seed: all ten companies fit the storage budget', () => {
  const total = MSP_COMPANIES.reduce((n, p) => n + JSON.stringify(createCompanyWorld(p)).length, 0);
  assert.ok(total < 4_000_000, `total ${total} characters`);
});

// ---------------------------------------------------------------- review fixes (MSP stage 1)
import { runEntraSync as sync } from '../src/world/cloud.ts';

test('review: company sync audit and licences use the company, not Meridian', () => {
  const w = createCompanyWorld(profileById('brightwater')!);
  sync(w);
  const ev = w.audit.filter((e) => e.source === 'Sync').pop()!;
  assert.equal(ev.target, 'brightwaterlaw.test');
  const staff = new Set(employees(w).map((u) => u.sam));
  const lic = w.entra.users.filter((e) => e.source === 'synced' && e.accountEnabled && staff.has(e.onPremSam ?? ''));
  assert.ok(lic.length > 0 && lic.every((e) => e.licenses.length > 0), 'birthright licence group grants a licence');
});
