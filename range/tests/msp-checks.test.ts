import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock, nowIso } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { evaluate } from '../src/scenarios/grader.ts';
import { assignLicense, createCloudGroup, inviteGuest, setCloudGroupMember, updateCloudUser } from '../src/world/entraAdmin.ts';
import { addRoleAssignment, ensureAzure, scopeOf } from '../src/world/azure.ts';
import { activateRole } from '../src/world/pim.ts';
import { issueTap, requireReregisterAs } from '../src/world/authMethods.ts';
import { createOu } from '../src/world/directory.ts';
import { openTicket } from '../src/world/itsm.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

function kestrel() {
  const w = createCompanyWorld(profileById('kestrel')!);
  const me = `${MSP_ADMIN}@${w.entra.primaryDomain}`;
  const user = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled && !e.roles.length)!;
  return { w, me, user };
}
const pass = (w: Parameters<typeof evaluate>[0], spec: Parameters<typeof evaluate>[1]): boolean => evaluate(w, spec).pass;

test('checks: neverChanged sees a matching change on the target after the marker, and nothing else', () => {
  const { w, me, user } = kestrel();
  const mark = w.counters.audit;
  const spec = { k: 'neverChanged' as const, target: user.upn, actions: ['Admin deleted security info'], afterAudit: mark };
  assert.equal(pass(w, spec), true);
  activateRole(w, me, 'Authentication Administrator', 1, 'x');
  assert.equal(pass(w, spec), true, 'unrelated change');
  requireReregisterAs(w, me, user.upn);
  assert.equal(pass(w, spec), false);
  assert.equal(pass(w, { ...spec, afterAudit: w.counters.audit }), true, 'before the marker does not count');
});

test('checks: escalatedTo reads the ticket escalations', () => {
  const { w } = kestrel();
  const tk = openTicket(w, { type: 'Request', short: 's', description: 'd', caller: 'x', category: 'Access', priority: 3 });
  assert.equal(pass(w, { k: 'escalatedTo', ticket: tk.id, team: 'Security Operations' }), false);
  tk.escalations = [{ team: 'Security Operations', reason: 'r', time: nowIso(), verdict: 'accepted' }];
  assert.equal(pass(w, { k: 'escalatedTo', ticket: tk.id, team: 'Security Operations' }), true);
  assert.equal(pass(w, { k: 'escalatedTo', ticket: tk.id, team: 'Customer approver' }), false);
});

test('checks: cloud group, licence, Azure role, TAP, guest and OU checks', () => {
  const { w, me, user } = kestrel();
  createCloudGroup(w, me, { name: 'Kiosk Users', type: 'Security', description: '', owners: [me] });
  assert.equal(pass(w, { k: 'cloudGroupMember', upn: user.upn, group: 'Kiosk Users', value: true }), false);
  setCloudGroupMember(w, me, 'Kiosk Users', user.upn, true);
  assert.equal(pass(w, { k: 'cloudGroupMember', upn: user.upn, group: 'Kiosk Users', value: true }), true);

  assert.equal(pass(w, { k: 'entraLicense', upn: user.upn, sku: 'Microsoft Entra ID P2', value: true }), false);
  updateCloudUser(w, me, user.upn, { usageLocation: 'US' });
  assignLicense(w, me, user.upn, 'Microsoft Entra ID P2', true);
  assert.equal(pass(w, { k: 'entraLicense', upn: user.upn, sku: 'Microsoft Entra ID P2', value: true }), true);

  const a = ensureAzure(w);
  const rg = a.resourceGroups[0]!;
  const scope = scopeOf({ subscription: rg.subscription, rg: rg.name });
  assert.equal(pass(w, { k: 'azureRole', principal: user.upn, role: 'Reader', scope, value: true }), false);
  addRoleAssignment(w, me, user.upn, 'Reader', scope);
  assert.equal(pass(w, { k: 'azureRole', principal: user.upn, role: 'Reader', scope, value: true }), true);
  assert.equal(pass(w, { k: 'azureRole', principal: user.upn, role: 'Reader', scope: scopeOf({ subscription: rg.subscription }), value: false }), true, 'exact scope only');

  const since = nowIso();
  assert.equal(pass(w, { k: 'tapIssuedSince', upn: user.upn, since }), false);
  activateRole(w, me, 'Authentication Administrator', 1, 'x');
  issueTap(w, me, user.upn, 60, true);
  assert.equal(pass(w, { k: 'tapIssuedSince', upn: user.upn, since }), true);

  assert.equal(pass(w, { k: 'entraGuest', email: 'ana@partner.test', value: true }), false);
  inviteGuest(w, me, 'ana@partner.test', 'Ana');
  assert.equal(pass(w, { k: 'entraGuest', email: 'ana@partner.test', value: true }), true);

  assert.equal(pass(w, { k: 'adOuExists', ou: 'Kestrel/Contractors', value: true }), false);
  createOu(w, 'Contractors', 'Kestrel');
  assert.equal(pass(w, { k: 'adOuExists', ou: 'Kestrel/Contractors', value: true }), true);
});
