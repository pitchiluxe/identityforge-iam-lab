import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { activeRole } from '../src/world/cloud.ts';
import { rolesOf } from '../src/world/entraAdmin.ts';
import { activateRole, addEligible, deactivateRole, ensurePimDefaults, pimSettings } from '../src/world/pim.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

function kestrel() {
  const w = createCompanyWorld(profileById('kestrel')!);
  return { w, me: `${MSP_ADMIN}@${w.entra.primaryDomain}` };
}

test('pim: the MSP admin is eligible (not active) for Authentication Administrator', () => {
  const { w, me } = kestrel();
  const e = w.entra.users.find((x) => x.upn === me)!;
  assert.equal(activeRole(e, 'Authentication Administrator'), 'eligible');
  assert.ok(!rolesOf(w, me).includes('Authentication Administrator'));
});

test('pim: activation needs eligibility, a justification and a duration within the role setting; it expires', () => {
  const { w, me } = kestrel();
  assert.throws(() => activateRole(w, me, 'Global Administrator', 1, 'need it'), /You are not eligible for the role 'Global Administrator'\./);
  assert.throws(() => activateRole(w, me, 'Authentication Administrator', 1, '  '), /Justification is required/);
  const max = pimSettings('Authentication Administrator').maxHours;
  assert.throws(() => activateRole(w, me, 'Authentication Administrator', max + 1, 'INC0012 MFA reset'), new RegExp(`at most ${max} hours`));
  activateRole(w, me, 'Authentication Administrator', 1, 'INC0012 MFA reset');
  const e = w.entra.users.find((x) => x.upn === me)!;
  assert.equal(activeRole(e, 'Authentication Administrator'), 'active', 'live activation wins over the eligible entry');
  assert.ok(rolesOf(w, me).includes('Authentication Administrator'));
  assert.throws(() => activateRole(w, me, 'Authentication Administrator', 1, 'again'), /already active/);
  t += 2 * 3_600_000;
  assert.ok(!rolesOf(w, me).includes('Authentication Administrator'), 'expired after the duration');
  assert.equal(activeRole(e, 'Authentication Administrator'), 'eligible');
  activateRole(w, me, 'Authentication Administrator', 1, 'INC0013');
  deactivateRole(w, me, 'Authentication Administrator');
  assert.ok(!rolesOf(w, me).includes('Authentication Administrator'));
});

test('pim: only a Privileged Role Administrator adds eligible assignments', () => {
  const { w, me } = kestrel();
  const user = w.entra.users.find((x) => x.source === 'synced')!;
  assert.throws(() => addEligible(w, me, user.upn, 'Helpdesk Administrator', 6), /Insufficient privileges/);
  const pra = w.entra.users.filter((x) => x.source === 'synced')[1]!;
  pra.roles.push({ role: 'Privileged Role Administrator', assignment: 'active', permanent: true, expires: null, justification: 't' });
  addEligible(w, pra.upn, user.upn, 'Helpdesk Administrator', 6);
  assert.equal(activeRole(user, 'Helpdesk Administrator'), 'eligible');
});

test('pim: saved company worlds from before get the MSP eligibility once', () => {
  const { w, me } = kestrel();
  const e = w.entra.users.find((x) => x.upn === me)!;
  e.roles = e.roles.filter((r) => r.role !== 'Authentication Administrator');
  delete w.entra.pimDefaults; // a world saved before the defaults existed has no marker
  ensurePimDefaults(w);
  ensurePimDefaults(w);
  assert.equal(e.roles.filter((r) => r.role === 'Authentication Administrator').length, 1);
});
