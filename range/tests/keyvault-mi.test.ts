import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import {
  addRoleAssignment, canReadSecret, createResource, deleteResource, ensureAzure, setAccessPolicy, setSystemIdentity, setVaultModel, vaultOf,
} from '../src/world/azure.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

function setup(id: string) {
  const w = createCompanyWorld(profileById(id)!);
  const a = ensureAzure(w);
  const kv = a.resources.find((r) => r.type === 'Microsoft.KeyVault/vaults')!;
  const user = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled && !e.upn.startsWith('msp-'))!;
  return { w, a, kv, user, me: `${MSP_ADMIN}@${w.entra.primaryDomain}` };
}

test('key vault: RBAC vaults need a data-plane role; Contributor alone cannot read secrets', () => {
  const { w, kv, user, me } = setup('cobalt');
  assert.equal(vaultOf(w, kv.id).model, 'rbac');
  assert.ok(vaultOf(w, kv.id).secrets.length >= 2);
  assert.equal(canReadSecret(w, me, kv.id), false, 'MSP is Contributor + UAA: management plane only');
  addRoleAssignment(w, me, user.upn, 'Key Vault Secrets User', kv.id);
  assert.equal(canReadSecret(w, user.upn, kv.id), true);
  assert.throws(() => setAccessPolicy(w, me, kv.id, user.upn, ['get']), /uses Azure role-based access control/);
});

test('key vault: access-policy vaults ignore RBAC data roles, and switching the model changes who can read', () => {
  const { w, kv, user, me } = setup('kestrel');
  assert.equal(vaultOf(w, kv.id).model, 'accessPolicy', 'older companies still use access policies');
  addRoleAssignment(w, me, user.upn, 'Key Vault Secrets User', kv.id);
  assert.equal(canReadSecret(w, user.upn, kv.id), false, 'RBAC role ignored in access-policy mode');
  setAccessPolicy(w, me, kv.id, user.upn, ['get', 'list']);
  assert.equal(canReadSecret(w, user.upn, kv.id), true);
  setVaultModel(w, me, kv.id, 'rbac');
  assert.equal(canReadSecret(w, user.upn, kv.id), true, 'now the RBAC role counts');
});

test('managed identities: a user-assigned identity is an RBAC principal, cleaned up on delete; system-assigned too', () => {
  const { w, a, kv, me } = setup('cobalt');
  const rg = kv.rg;
  const mi = createResource(w, me, { type: 'Microsoft.ManagedIdentity/userAssignedIdentities', name: 'id-portal-app', rg, subscription: kv.subscription, location: 'eastus' });
  const ra = addRoleAssignment(w, me, 'id-portal-app', 'Key Vault Secrets User', kv.id);
  assert.equal(ra.principalType, 'ServicePrincipal');
  assert.equal(canReadSecret(w, 'id-portal-app', kv.id), true);
  deleteResource(w, me, mi.id);
  assert.ok(!a.assignments.some((x) => x.principal === 'id-portal-app'), 'assignments of a deleted identity are removed');
  const web = a.resources.find((r) => r.type === 'Microsoft.Web/sites')!;
  assert.throws(() => addRoleAssignment(w, me, web.name, 'Reader', kv.id), /does not exist in the directory/);
  setSystemIdentity(w, me, web.id, true);
  addRoleAssignment(w, me, web.name, 'Key Vault Secrets User', kv.id);
  setSystemIdentity(w, me, web.id, false);
  assert.ok(!a.assignments.some((x) => x.principal === web.name), 'turning the identity off removes its assignments');
});
