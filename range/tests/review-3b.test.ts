import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { Shell } from '../src/terminal/shell.ts';
import { CMDLETS } from '../src/terminal/cmdlets.ts';
import { addRoleAssignment, createResource, deleteResource, ensureAzure } from '../src/world/azure.ts';
import { createCloudGroup, resetCloudPassword } from '../src/world/entraAdmin.ts';
import { activateRole, addEligible, ensurePimDefaults, removeEligible } from '../src/world/pim.ts';
import { ensureTenantSecurity, deleteCaPolicyAs, saveCaPolicyAs } from '../src/world/tenantSettings.ts';
import { addAuMember, assignScopedRole, createAdminUnit } from '../src/world/identityExtras.ts';
import { caOutcome } from '../src/world/tenantSettings.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

function company(id = 'kestrel') {
  const w = createCompanyWorld(profileById(id)!);
  return { w, me: `${MSP_ADMIN}@${w.entra.primaryDomain}` };
}
const grant = (w: ReturnType<typeof company>['w'], upn: string, role: string): void => {
  w.entra.users.find((e) => e.upn === upn)!.roles.push({ role, assignment: 'active', permanent: true, expires: null, justification: 't' });
};

test('review C1: Graph cmdlets in a company tenant are authorised by the admin account roles', () => {
  const { w } = company();
  const sh = new Shell(w, CMDLETS);
  sh.graphConnected = true;
  const run = (s: string): string => sh.run(s).map((l) => l.text).join('\n');
  const bg = w.entra.users.find((e) => e.upn.startsWith('bg-emergency01@'))!;
  assert.match(run(`Update-MgUser -UserId ${bg.upn} -AccountEnabled:$false`), /Insufficient privileges to complete the operation\./);
  assert.equal(bg.accountEnabled, true, 'break-glass untouched');
  const risky = w.entra.users.find((e) => e.source === 'synced')!;
  risky.riskLevel = 'high';
  assert.match(run(`Invoke-MgDismissRiskyUser -UserIds @('${risky.id}')`), /Insufficient privileges/);
  assert.equal(risky.riskLevel, 'high');
  assert.match(run(`Revoke-MgUserSignInSession -UserId ${bg.upn}`), /Insufficient privileges/);
});

test('review I2: a managed identity cannot take a user or group name, and deleting one never removes group assignments', () => {
  const { w, me } = company('cobalt');
  const a = ensureAzure(w);
  const rg = a.resourceGroups[0]!;
  createCloudGroup(w, me, { name: 'Finance-Admins', type: 'Security', description: '', owners: [me] });
  assert.throws(() => createResource(w, me, { type: 'Microsoft.ManagedIdentity/userAssignedIdentities', name: 'Finance-Admins', rg: rg.name, subscription: rg.subscription, location: 'eastus' }), /already exists in the directory/);
  const scope = `/subscriptions/${rg.subscription}`;
  addRoleAssignment(w, me, 'Finance-Admins', 'Reader', scope);
  const mi = createResource(w, me, { type: 'Microsoft.ManagedIdentity/userAssignedIdentities', name: 'id-batch', rg: rg.name, subscription: rg.subscription, location: 'eastus' });
  deleteResource(w, me, mi.id);
  assert.ok(a.assignments.some((x) => x.principal === 'Finance-Admins' && x.principalType === 'Group'));
});

test('review I3: Conditional Access is enforced at sign-in', () => {
  const { w } = company('summitridge');
  ensureTenantSecurity(w);
  const user = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled && !e.roles.length)!;
  assert.equal(caOutcome(w, user.upn, { ip: '198.51.100.24', legacyAuth: false }).allowed, true);
  const caAdmin = w.entra.users.find((e) => e.upn.startsWith('bg-emergency01@'))!;
  saveCaPolicyAs(w, caAdmin.upn, { name: 'Block all', state: 'on', includeUsers: user.upn, excludeUsers: [], apps: 'All cloud apps', condition: 'none', grant: 'block' });
  const r = caOutcome(w, user.upn, { ip: '198.51.100.24', legacyAuth: false });
  assert.equal(r.allowed, false);
  assert.match(r.message, /AADSTS53003: Access has been blocked by Conditional Access policies\./);
  assert.equal(r.policy, 'Block all');
});

test('review I4: an expired eligibility cannot be activated, and activation never outlives eligibility', () => {
  const { w, me } = company();
  const pra = w.entra.users.filter((e) => e.source === 'synced')[1]!;
  grant(w, pra.upn, 'Privileged Role Administrator');
  const user = w.entra.users.filter((e) => e.source === 'synced')[2]!;
  addEligible(w, pra.upn, user.upn, 'Helpdesk Administrator', 1);
  const elig = user.roles.find((r) => r.role === 'Helpdesk Administrator')!;
  elig.expires = new Date(t + 30 * 60_000).toISOString();
  activateRole(w, user.upn, 'Helpdesk Administrator', 8, 'INC1');
  const act = user.roles.find((r) => r.role === 'Helpdesk Administrator' && r.assignment === 'active')!;
  assert.ok(act.expires! <= elig.expires!, 'capped at the end of eligibility');
  user.roles = user.roles.filter((r) => r !== act);
  t += 60 * 60_000;
  assert.throws(() => activateRole(w, user.upn, 'Helpdesk Administrator', 1, 'INC2'), /not eligible/);
  void me;
});

test('review I5: load-time defaults are applied once, not after the admin removed them', () => {
  const { w, me } = company();
  const bg = w.entra.users.find((e) => e.upn.startsWith('bg-emergency01@'))!;
  for (const p of [...w.entra.caPolicies]) deleteCaPolicyAs(w, bg.upn, p.id);
  ensureTenantSecurity(w);
  assert.equal(w.entra.caPolicies.length, 0, 'deleted policies stay deleted');
  grant(w, bg.upn, 'Privileged Role Administrator');
  removeEligible(w, bg.upn, me, 'Authentication Administrator');
  ensurePimDefaults(w);
  assert.ok(!w.entra.users.find((e) => e.upn === me)!.roles.some((r) => r.role === 'Authentication Administrator'), 'removed eligibility stays removed');
});

test('review I6: a role scoped to an administrative unit works on its members only', () => {
  const { w } = company();
  const bg = w.entra.users.find((e) => e.upn.startsWith('bg-emergency01@'))!;
  const helper = w.entra.users.filter((e) => e.source === 'synced' && !e.roles.length)[0]!;
  const au = createAdminUnit(w, bg.upn, 'Kiosks', 'Kiosk accounts');
  // Two cloud users: one in the unit, one outside it.
  const mk = (n: string) => { const u = { ...w.entra.users.find((e) => e.upn === bg.upn)!, upn: `${n}@${w.entra.primaryDomain}`, id: n, roles: [], displayName: n, mfaMethods: [] }; w.entra.users.push(u); return u; };
  const a = mk('kiosk.a');
  const b = mk('kiosk.b');
  addAuMember(w, bg.upn, au.id, a.upn);
  assignScopedRole(w, bg.upn, au.id, helper.upn, 'Helpdesk Administrator');
  resetCloudPassword(w, helper.upn, a.upn, 'Kiosk-Reset-2026!', true);
  assert.throws(() => resetCloudPassword(w, helper.upn, b.upn, 'Kiosk-Reset-2026!', true), /Insufficient privileges/);
});
