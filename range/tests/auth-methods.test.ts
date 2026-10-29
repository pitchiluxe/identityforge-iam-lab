import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { activateRole } from '../src/world/pim.ts';
import { deleteMethodAs, issueTap, methodPolicy, redeemTap, requireReregisterAs, setMethodPolicy } from '../src/world/authMethods.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));
const NO_RIGHTS = /Insufficient privileges to complete the operation\./;

function lumen() {
  const w = createCompanyWorld(profileById('lumen')!);
  const me = `${MSP_ADMIN}@${w.entra.primaryDomain}`;
  const user = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled && !e.roles.length)!;
  return { w, me, user };
}

test('auth methods: the MSP admin must activate Authentication Administrator first', () => {
  const { w, me, user } = lumen();
  assert.throws(() => issueTap(w, me, user.upn, 60, true), NO_RIGHTS);
  assert.throws(() => requireReregisterAs(w, me, user.upn), NO_RIGHTS);
  activateRole(w, me, 'Authentication Administrator', 1, 'INC0042 new phone');
  requireReregisterAs(w, me, user.upn);
  assert.equal(user.mfaMethods.length, 0);
});

test('auth methods: a Temporary Access Pass is single use and time-boxed', () => {
  const { w, me, user } = lumen();
  activateRole(w, me, 'Authentication Administrator', 1, 'INC0043 onboarding');
  assert.throws(() => issueTap(w, me, user.upn, 30, true), /between 60 and 480 minutes/);
  const tap = issueTap(w, me, user.upn, 60, true);
  assert.match(tap.code, /^[A-Za-z0-9]{8}$/);
  assert.equal(redeemTap(w, user.upn, 'wrongcode'), false);
  assert.equal(redeemTap(w, user.upn, tap.code), true);
  assert.equal(redeemTap(w, user.upn, tap.code), false, 'one time');
  const tap2 = issueTap(w, me, user.upn, 60, false);
  t += 61 * 60_000;
  assert.equal(redeemTap(w, user.upn, tap2.code), false, 'expired');
  assert.ok(w.audit.some((e) => e.action === 'Create Temporary Access Pass' && e.target === user.upn));
});

test('auth methods: admins as targets need Privileged Authentication Administrator', () => {
  const { w, me } = lumen();
  activateRole(w, me, 'Authentication Administrator', 1, 'INC0044');
  const admin = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled && !e.roles.length)!;
  admin.roles.push({ role: 'Exchange Administrator', assignment: 'active', permanent: true, expires: null, justification: 't' });
  assert.throws(() => issueTap(w, me, admin.upn, 60, true), NO_RIGHTS);
  assert.throws(() => deleteMethodAs(w, me, admin.upn, 0), NO_RIGHTS);
});

test('auth methods: the tenant policy gates methods and only a policy admin changes it', () => {
  const { w, me, user } = lumen();
  assert.equal(methodPolicy(w)['Temporary Access Pass'], true);
  assert.throws(() => setMethodPolicy(w, me, 'Temporary Access Pass', false), NO_RIGHTS);
  const pol = w.entra.users.filter((e) => e.source === 'synced')[2]!;
  pol.roles.push({ role: 'Authentication Policy Administrator', assignment: 'active', permanent: true, expires: null, justification: 't' });
  setMethodPolicy(w, pol.upn, 'Temporary Access Pass', false);
  activateRole(w, me, 'Authentication Administrator', 1, 'INC0045');
  assert.throws(() => issueTap(w, me, user.upn, 60, true), /Temporary Access Pass is not enabled in the authentication methods policy/);
});
