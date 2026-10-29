import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { createCloudGroup, setCloudGroupMember } from '../src/world/entraAdmin.ts';
import {
  addRoleAssignment, createResource, createResourceGroup, deleteResource, effectiveRoles, ensureAzure, removeRoleAssignment, scopeOf,
} from '../src/world/azure.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

function cobalt() {
  const w = createCompanyWorld(profileById('cobalt')!);
  return { w, me: `${MSP_ADMIN}@${w.entra.primaryDomain}` };
}

test('azure: the estate is created on first use, the same way every time', () => {
  const { w } = cobalt();
  assert.equal(w.azure, undefined);
  const a = ensureAzure(w);
  assert.equal(ensureAzure(w), a);
  assert.deepEqual(a.subscriptions.map((s) => s.name), ['Cobalt Software - Production', 'Cobalt Software - Development']);
  assert.ok(a.resourceGroups.length >= 2 && a.resources.length >= 3);
  assert.equal(JSON.stringify(ensureAzure(cobalt().w).subscriptions), JSON.stringify(a.subscriptions));
  assert.ok(ensureAzure(createWorld(3)).subscriptions.length >= 1, 'Meridian has an estate too');
});

test('azure: roles inherit downwards and Check access shows where they come from', () => {
  const { w, me } = cobalt();
  const a = ensureAzure(w);
  const sub = a.subscriptions[0]!;
  const rg = a.resourceGroups.find((r) => r.subscription === sub.id)!;
  const res = a.resources.find((r) => r.rg === rg.name)!;
  const user = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled && !e.upn.startsWith('msp-'))!;
  addRoleAssignment(w, me, user.upn, 'Reader', scopeOf({ subscription: sub.id, rg: rg.name }));
  const onRes = effectiveRoles(w, user.upn, res.id);
  assert.ok(onRes.some((r) => r.role === 'Reader' && r.scope === scopeOf({ subscription: sub.id, rg: rg.name }) && r.via === 'Direct'));
  assert.ok(!effectiveRoles(w, user.upn, scopeOf({ subscription: sub.id })).some((r) => r.role === 'Reader'), 'not upwards');
  const mine = effectiveRoles(w, me, res.id).map((r) => r.role);
  assert.ok(mine.includes('Contributor') && mine.includes('User Access Administrator'), 'MSP inherits from the subscription');
});

test('azure: a group assignment counts for its members', () => {
  const { w, me } = cobalt();
  const a = ensureAzure(w);
  const g = createCloudGroup(w, me, { name: 'Azure Readers', type: 'Security', description: '', owners: [me] });
  const user = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled && !e.upn.startsWith('msp-'))!;
  setCloudGroupMember(w, me, g.name, user.upn, true);
  addRoleAssignment(w, me, g.name, 'Reader', scopeOf({ subscription: a.subscriptions[1]!.id }));
  assert.ok(effectiveRoles(w, user.upn, scopeOf({ subscription: a.subscriptions[1]!.id })).some((r) => r.role === 'Reader' && r.via === 'Group: Azure Readers'));
});

test('azure: no rights, duplicates, unknown principals and self lock-out are refused', () => {
  const { w, me } = cobalt();
  const a = ensureAzure(w);
  const scope = scopeOf({ subscription: a.subscriptions[0]!.id });
  const user = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled && !e.upn.startsWith('msp-'))!;
  assert.throws(() => addRoleAssignment(w, user.upn, user.upn, 'Owner', scope), /does not have authorization to perform action 'Microsoft\.Authorization\/roleAssignments\/write' over scope/);
  addRoleAssignment(w, me, user.upn, 'Reader', scope);
  assert.throws(() => addRoleAssignment(w, me, user.upn, 'Reader', scope), /The role assignment already exists\./);
  assert.throws(() => addRoleAssignment(w, me, 'nobody@nowhere.test', 'Reader', scope), /Principal .* does not exist in the directory/);
  const uaa = a.assignments.find((x) => x.principal === me && x.role === 'User Access Administrator' && x.scope === scope)!;
  assert.throws(() => removeRoleAssignment(w, me, uaa.id), /You cannot remove your own access to manage role assignments at this scope\./);
  const reader = a.assignments.find((x) => x.principal === user.upn && x.role === 'Reader')!;
  removeRoleAssignment(w, me, reader.id);
  assert.ok(!a.assignments.includes(reader));
  assert.ok(w.audit.some((e) => e.source === 'Azure' && e.action === 'Delete role assignment'));
});

test('azure: Contributors create and delete resource groups and resources; Readers cannot', () => {
  const { w, me } = cobalt();
  const a = ensureAzure(w);
  const sub = a.subscriptions[1]!.id;
  createResourceGroup(w, me, sub, 'rg-cobalt-dev-lab', 'eastus');
  const vm = createResource(w, me, { type: 'Microsoft.Compute/virtualMachines', name: 'vm-lab01', rg: 'rg-cobalt-dev-lab', subscription: sub, location: 'eastus' });
  assert.equal(vm.id, scopeOf({ subscription: sub, rg: 'rg-cobalt-dev-lab', resource: 'Microsoft.Compute/virtualMachines/vm-lab01' }));
  // Someone with no Azure role yet (Cobalt's engineers already hold Contributor on development through their group).
  const user = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled && !e.upn.startsWith('msp-') && !effectiveRoles(w, e.upn, scopeOf({ subscription: sub })).length)!;
  addRoleAssignment(w, me, user.upn, 'Reader', scopeOf({ subscription: sub }));
  assert.throws(() => deleteResource(w, user.upn, vm.id), /does not have authorization to perform action 'Microsoft\.Compute\/virtualMachines\/delete'/);
  deleteResource(w, me, vm.id);
  assert.ok(!a.resources.some((r) => r.id === vm.id));
  assert.throws(() => createResource(w, me, { type: 'Microsoft.Compute/virtualMachines', name: 'x', rg: 'no-such-rg', subscription: sub, location: 'eastus' }), /Resource group 'no-such-rg' could not be found\./);
});

// ---------------------------------------------------------------- stage 3a review fixes
import { createLabAccount } from '../src/world/portalAccounts.ts';

test('review: a deleted or disabled account keeps no Azure rights', () => {
  const { w } = cobalt();
  const a = ensureAzure(w);
  const acct = createLabAccount(w, { displayName: 'Gone', nickname: 'gone.lab', password: 'Gone-Passw0rd-2026!' });
  acct.deleted = true;
  assert.throws(() => createResourceGroup(w, acct.upn, a.subscriptions[0]!.id, 'rg-ghost', 'eastus'), /does not have authorization/);
  acct.deleted = false;
  acct.accountEnabled = false;
  assert.throws(() => createResourceGroup(w, acct.upn, a.subscriptions[0]!.id, 'rg-ghost', 'eastus'), /does not have authorization/);
});
