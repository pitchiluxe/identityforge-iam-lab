import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { runEntraSync } from '../src/world/cloud.ts';
import {
  assignDirectoryRole, assignLicense, createCloudGroup, createCloudUser, deleteCloudUser, inviteGuest, resetCloudPassword, restoreCloudUser,
  rolesOf, setCloudGroupMember, tenantLicenses, updateCloudUser,
} from '../src/world/entraAdmin.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

const ON_PREM = /Unable to update the specified properties for on-premises mastered Directory Sync objects/;
const NO_RIGHTS = /Insufficient privileges to complete the operation\./;

function kestrel() {
  const w = createCompanyWorld(profileById('kestrel')!);
  return { w, me: `${MSP_ADMIN}@${w.entra.primaryDomain}` };
}

test('entra admin: the MSP admin creates, edits, resets, deletes and restores a cloud user', () => {
  const { w, me } = kestrel();
  const u = createCloudUser(w, me, { displayName: 'Cloud Kiosk', mailNickname: 'cloud.kiosk', password: 'Kiosk-Passw0rd!', forceChange: true, usageLocation: 'US' });
  assert.equal(u.upn, 'cloud.kiosk@kestrelmfg.onmicrosoft.test');
  assert.equal(u.source, 'cloud');
  assert.equal(u.labPassword, 'Kiosk-Passw0rd!');
  assert.throws(() => createCloudUser(w, me, { displayName: 'Dup', mailNickname: 'cloud.kiosk', password: 'Kiosk-Passw0rd!', forceChange: false }), /Another object with the same value for property userPrincipalName already exists\./);
  assert.equal(updateCloudUser(w, me, u.upn, { jobTitle: 'Kiosk' }).jobTitle, 'Kiosk');
  assert.equal(resetCloudPassword(w, me, u.upn, 'New-Passw0rd-2026!', true).labPassword, 'New-Passw0rd-2026!');
  deleteCloudUser(w, me, u.upn);
  assert.equal(w.entra.users.find((e) => e.upn === u.upn)!.deleted, true);
  assert.equal(restoreCloudUser(w, me, u.upn).deleted, false);
  assert.ok(w.audit.some((e) => e.action === 'Add user' && e.actor === me && e.target === u.upn));
});

test('entra admin: guests are invited with the #EXT# UPN', () => {
  const { w, me } = kestrel();
  const g = inviteGuest(w, me, 'jo.ng@supplierco.test', 'Jo Ng');
  assert.equal(g.upn, 'jo.ng_supplierco.test#EXT#@kestrelmfg.onmicrosoft.test');
  assert.equal(g.userType, 'Guest');
});

test('entra admin: synced users and groups are read-only in the cloud', () => {
  const { w, me } = kestrel();
  const synced = w.entra.users.find((e) => e.source === 'synced')!;
  assert.throws(() => updateCloudUser(w, me, synced.upn, { jobTitle: 'x' }), ON_PREM);
  assert.throws(() => resetCloudPassword(w, me, synced.upn, 'Whatever-2026!', true), ON_PREM);
  const adGroup = w.ad.groups.find((g) => g.ou === 'Kestrel/Groups')!.name;
  assert.throws(() => setCloudGroupMember(w, me, adGroup, synced.upn, true), ON_PREM);
});

test('entra admin: only Global or Privileged Role Administrators assign directory roles (as in Entra)', () => {
  const { w, me } = kestrel();
  const synced = w.entra.users.filter((e) => e.source === 'synced');
  assert.throws(() => assignDirectoryRole(w, me, synced[0].upn, 'Global Administrator', true), NO_RIGHTS);
  assert.throws(() => assignDirectoryRole(w, me, synced[0].upn, 'Helpdesk Administrator', true), NO_RIGHTS, 'User Administrator cannot assign any role');
  const pra = synced[1];
  pra.roles.push({ role: 'Privileged Role Administrator', assignment: 'active', permanent: true, expires: null, justification: 'test' });
  assignDirectoryRole(w, pra.upn, synced[0].upn, 'Helpdesk Administrator', true);
  assert.ok(rolesOf(w, synced[0].upn).includes('Helpdesk Administrator'));
  assignDirectoryRole(w, pra.upn, synced[0].upn, 'Helpdesk Administrator', false);
  assert.ok(!rolesOf(w, synced[0].upn).includes('Helpdesk Administrator'));
});

test('entra admin: cloud groups hold synced and cloud members, and membership survives a sync', () => {
  const { w, me } = kestrel();
  const g = createCloudGroup(w, me, { name: 'Kiosk Users', type: 'Security', description: 'Shop floor kiosks', owners: [me] });
  const synced = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled)!;
  setCloudGroupMember(w, me, g.name, synced.upn, true);
  runEntraSync(w);
  assert.ok(w.entra.users.find((e) => e.upn === synced.upn)!.groups.includes('Kiosk Users'));
  setCloudGroupMember(w, me, g.name, synced.upn, false);
  assert.ok(!w.entra.users.find((e) => e.upn === synced.upn)!.groups.includes('Kiosk Users'));
  assert.throws(() => createCloudGroup(w, me, { name: 'Kiosk Users', type: 'Security', description: '', owners: [] }), /already exists/);
});

test('entra admin: licences need a usage location, stop at the purchased total, and survive a sync', () => {
  const { w, me } = kestrel();
  const p2 = tenantLicenses(w).find((l) => l.sku === 'Microsoft Entra ID P2')!;
  const u = createCloudUser(w, me, { displayName: 'No Location', mailNickname: 'no.location', password: 'Kiosk-Passw0rd!', forceChange: false });
  assert.throws(() => assignLicense(w, me, u.upn, p2.sku, true), /License assignment cannot be done for user with invalid usage location\./);
  updateCloudUser(w, me, u.upn, { usageLocation: 'US' });
  assignLicense(w, me, u.upn, p2.sku, true);
  const synced = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled)!;
  updateCloudUserLocation(w, synced.upn);
  assignLicense(w, me, synced.upn, p2.sku, true);
  runEntraSync(w);
  assert.ok(w.entra.users.find((e) => e.upn === synced.upn)!.licenses.includes(p2.sku), 'direct licence kept after sync');
  const cap = createCloudUser(w, me, { displayName: 'Cap', mailNickname: 'cap', password: 'Kiosk-Passw0rd!', forceChange: false, usageLocation: 'US' });
  p2.total = w.entra.users.filter((e) => e.licenses.includes(p2.sku)).length;
  assert.throws(() => assignLicense(w, me, cap.upn, p2.sku, true), /License assignment failed because the subscription has no available licenses\./);
});

/** Usage location is a cloud-side property, so it can be set on synced users. */
function updateCloudUserLocation(w: ReturnType<typeof kestrel>['w'], upn: string): void {
  w.entra.users.find((e) => e.upn === upn)!.usageLocation = 'US';
}

// ---------------------------------------------------------------- stage 3a review fixes
import { createWorld } from '../src/world/seed.ts';
import { createLabAccount } from '../src/world/portalAccounts.ts';
import { revokeSessionsAs } from '../src/world/entraAdmin.ts';

test('review: a User Administrator cannot reset, edit, delete or revoke a privileged admin (break-glass escalation path)', () => {
  const m = createWorld(3);
  const me = createLabAccount(m, { displayName: 'Lab', nickname: 'lab.me', password: 'Lab-Passw0rd-2026!' }).upn;
  const bg = m.entra.users.find((e) => e.roles.some((r) => r.role === 'Global Administrator') && e.source === 'cloud')!;
  assert.throws(() => resetCloudPassword(m, me, bg.upn, 'Owned-2026-Passw0rd!', false), NO_RIGHTS);
  assert.throws(() => updateCloudUser(m, me, bg.upn, { jobTitle: 'x' }), NO_RIGHTS);
  assert.throws(() => deleteCloudUser(m, me, bg.upn), NO_RIGHTS);
  assert.throws(() => revokeSessionsAs(m, me, bg.upn), NO_RIGHTS);
  assert.equal(bg.labPassword, undefined);
});

test('review: revoking sessions needs an admin role', () => {
  const { w, me } = kestrel();
  const plain = createCloudUser(w, me, { displayName: 'Plain', mailNickname: 'plain', password: 'Plain-Passw0rd!', forceChange: false });
  const victim = w.entra.users.find((e) => e.source === 'synced')!;
  assert.throws(() => revokeSessionsAs(w, plain.upn, victim.upn), NO_RIGHTS);
  revokeSessionsAs(w, me, victim.upn);
});
