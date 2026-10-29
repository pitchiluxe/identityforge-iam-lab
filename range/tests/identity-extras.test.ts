import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { inviteGuest } from '../src/world/entraAdmin.ts';
import { addAuMember, assignScopedRole, createAdminUnit, externalSettings, setExternalSettings, setUserRisk } from '../src/world/identityExtras.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));
const NO_RIGHTS = /Insufficient privileges to complete the operation\./;

function lumen() {
  const w = createCompanyWorld(profileById('lumen')!);
  const staff = w.entra.users.filter((e) => e.source === 'synced' && e.accountEnabled && !e.roles.length);
  return { w, me: `${MSP_ADMIN}@${w.entra.primaryDomain}`, staff };
}

const grant = (e: { roles: { role: string; assignment: 'active' | 'eligible'; permanent: boolean; expires: string | null; justification: string }[] }, role: string): void => {
  e.roles.push({ role, assignment: 'active', permanent: true, expires: null, justification: 't' });
};

test('identity protection: research, frontline and merger companies start with risky users; only security roles act on them', () => {
  for (const id of ['lumen', 'pinecrest', 'atlas']) {
    const w = createCompanyWorld(profileById(id)!);
    assert.ok(w.entra.users.some((e) => e.riskLevel !== 'none'), `${id} has a risky user`);
    assert.ok(w.entra.signIns.some((s) => s.risk !== 'none'), `${id} has a risky sign-in`);
  }
  const { w, me, staff } = lumen();
  const risky = w.entra.users.find((e) => e.riskLevel !== 'none')!;
  assert.throws(() => setUserRisk(w, me, risky.upn, 'dismiss'), NO_RIGHTS);
  grant(staff[0]!, 'Security Operator');
  setUserRisk(w, staff[0]!.upn, risky.upn, 'dismiss');
  assert.equal(risky.riskLevel, 'none');
  setUserRisk(w, staff[0]!.upn, risky.upn, 'compromised');
  assert.equal(risky.riskLevel, 'high');
});

test('admin units: only a Privileged Role Administrator creates them, adds members and scopes roles', () => {
  const { w, me, staff } = lumen();
  assert.throws(() => createAdminUnit(w, me, 'Clinical', 'Clinical staff'), NO_RIGHTS);
  grant(staff[0]!, 'Privileged Role Administrator');
  const au = createAdminUnit(w, staff[0]!.upn, 'Clinical', 'Clinical staff');
  addAuMember(w, staff[0]!.upn, au.id, staff[1]!.upn);
  assignScopedRole(w, staff[0]!.upn, au.id, staff[2]!.upn, 'Helpdesk Administrator');
  assert.deepEqual(au.members, [staff[1]!.upn]);
  assert.deepEqual(au.scopedRoles, [{ upn: staff[2]!.upn, role: 'Helpdesk Administrator' }]);
  assert.throws(() => addAuMember(w, staff[0]!.upn, au.id, staff[1]!.upn), /already a member/);
});

test('external identities: invite restrictions and domain allow/deny lists are enforced; only a Global Administrator changes them', () => {
  const { w, me, staff } = lumen();
  assert.equal(externalSettings(w).guestInviteRestrictions, 'admins');
  assert.throws(() => setExternalSettings(w, me, { denyDomains: ['rival.test'] }), NO_RIGHTS);
  const ga = w.entra.users.find((e) => e.upn.startsWith('bg-emergency01@'))!;
  setExternalSettings(w, ga.upn, { denyDomains: ['rival.test'] });
  assert.throws(() => inviteGuest(w, me, 'spy@rival.test', 'Spy'), /The invitation is blocked because the domain is not allowed by the collaboration restrictions\./);
  inviteGuest(w, me, 'ok@partner.test', 'Ok');
  setExternalSettings(w, ga.upn, { allowDomains: ['karolinska.test'], denyDomains: [] });
  assert.throws(() => inviteGuest(w, me, 'x@partner.test', 'X'), /collaboration restrictions/);
  inviteGuest(w, me, 'y@karolinska.test', 'Y');
  setExternalSettings(w, ga.upn, { guestInviteRestrictions: 'none' });
  assert.throws(() => inviteGuest(w, me, 'z@karolinska.test', 'Z'), /Guest invitations are turned off for this organization\./);
  void staff;
});
