import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import * as groups from '../src/world/entraAdmin.ts';
import * as apps from '../src/world/apps.ts';
import type { SignIn } from '../src/core/types.ts';

setClock(() => Date.parse('2026-10-30T12:00:00Z'));
function fixture() {
  const w = createCompanyWorld(profileById('kestrel')!);
  const me = `${MSP_ADMIN}@${w.entra.primaryDomain}`;
  const u = groups.createCloudUser(w, me, { displayName: 'LAB Owner', mailNickname: 'lab-owner', password: 'Lab-Only!2026', forceChange: true });
  return { w, me, u };
}
const denied = /Insufficient privileges/;

test('Azure groups: descriptions and owners change without altering memberships or identity', () => {
  const { w, me, u } = fixture();
  const g = groups.createCloudGroup(w, me, { name: 'lab-project', description: '', type: 'Security', owners: [] });
  groups.setCloudGroupMember(w, me, g.name, u.upn, true);
  groups.updateCloudGroup(w, me, g.name, { description: ' Project access ' });
  groups.setCloudGroupOwner(w, me, g.name, u.upn.toUpperCase(), true);
  assert.deepEqual(g.owners, [u.upn]);
  groups.updateCloudGroup(w, u.upn, g.name, { description: 'Owner maintained' });
  assert.equal(g.description, 'Owner maintained');
  assert.ok(u.groups.includes(g.name));
  assert.equal(g.name, 'lab-project');
  assert.ok(w.audit.some(e => e.action === 'Add owner to group' && e.target === g.name && e.actor === me));
  groups.setCloudGroupOwner(w, me, g.name, u.upn, false);
  assert.deepEqual(g.owners, []);
});

test('Azure groups: denied, invalid and synced edits leave existing state intact', () => {
  const { w, me, u } = fixture();
  const g = groups.createCloudGroup(w, me, { name: 'lab-project', description: 'Keep', type: 'Security', owners: [] });
  const before = JSON.stringify(w);
  assert.throws(() => groups.updateCloudGroup(w, u.upn, g.name, { description: 'Bad' }), denied);
  assert.throws(() => groups.setCloudGroupOwner(w, me, g.name, 'other@outside.invalid', true), /not.*found|does not exist/i);
  assert.equal(JSON.stringify(w), before);
  const synced = groups.syncedGroupNames(w)[0]!;
  assert.throws(() => groups.updateCloudGroup(w, me, synced, { description: 'Bad' }), /on-premises mastered/);
  assert.throws(() => groups.setCloudGroupOwner(w, me, synced, u.upn, true), /on-premises mastered/);
});

test('Azure apps: owner management and redirect URL editing preserve other application configuration', () => {
  const { w, me, u } = fixture();
  const r = apps.registerApp(w, me, { name: 'LAB Client', redirectUris: ['https://lab-app.invalid/old'] });
  const old = { appId: r.appId, objectId: r.objectId, permissions: structuredClone(r.permissions) };
  apps.setAppOwner(w, me, r.appId, u.upn.toUpperCase(), true);
  apps.setAppRedirectUris(w, u.upn, r.appId, ['https://lab-app.invalid/Callback', 'http://localhost:5173/']);
  assert.equal(r.redirectUris[0], 'https://lab-app.invalid/Callback');
  assert.deepEqual({ appId: r.appId, objectId: r.objectId, permissions: r.permissions }, old);
  assert.ok(w.audit.some(e => e.action === 'Update application' && e.detail.includes('Redirect')));
  assert.ok(!w.entra.apps.find(a => a.id === `ent-${r.appId}`)!.owners!.includes(u.upn), 'service principal owners remain distinct');
  apps.setAppOwner(w, me, r.appId, u.upn, false);
  assert.throws(() => apps.setAppRedirectUris(w, u.upn, r.appId, []), denied);
});

test('Azure apps: invalid URL lists and nonexistent owners fail atomically', () => {
  const { w, me } = fixture();
  const r = apps.registerApp(w, me, { name: 'LAB Client', redirectUris: ['https://lab-app.invalid/old'] });
  for (const urls of [['https://lab-app.invalid/good', 'javascript:alert(1)'], ['http://lab-app.invalid/callback'], ['https://lab-app.invalid/#token'], ['https://*.invalid/callback'], ['https://user:pass@lab-app.invalid/'], ['https://lab-app.invalid/a', 'https://lab-app.invalid/a']]) {
    const before = JSON.stringify(w);
    assert.throws(() => apps.setAppRedirectUris(w, me, r.appId, urls), /redirect|duplicate/i);
    assert.equal(JSON.stringify(w), before);
  }
  assert.throws(() => apps.setAppOwner(w, me, r.appId, 'absent@outside.invalid', true), /not.*found|does not exist/i);
});

test('Azure ownership: disabled and deleted owners cannot manage groups or applications', () => {
  for (const state of ['disabled', 'deleted']) {
    const { w, me, u } = fixture();
    const g = groups.createCloudGroup(w, me, { name: 'lab-project', description: '', type: 'Security', owners: [u.upn] });
    const r = apps.registerApp(w, me, { name: 'LAB Client', redirectUris: [] });
    apps.setAppOwner(w, me, r.appId, u.upn, true);
    if (state === 'disabled') u.accountEnabled = false; else u.deleted = true;
    assert.throws(() => groups.updateCloudGroup(w, u.upn, g.name, { description: 'Bad' }), denied);
    assert.throws(() => apps.setAppRedirectUris(w, u.upn, r.appId, []), denied);
  }
});

test('Azure apps: malformed slash and whitespace variants are rejected rather than silently normalized', () => {
  const { w, me } = fixture();
  const r = apps.registerApp(w, me, { name: 'LAB Client', redirectUris: [] });
  for (const uri of ['https:lab-app.invalid/callback', 'https://lab-app.invalid/call\tback', 'https://lab-app.invalid/call back', 'https://lab-app.invalid\\callback']) {
    assert.throws(() => apps.setAppRedirectUris(w, me, r.appId, [uri]), /redirect/i);
    assert.deepEqual(r.redirectUris, []);
  }
});

test('Azure permissions: delegated administrators need active, unexpired roles', () => {
  const { w, me, u } = fixture();
  const g = groups.createCloudGroup(w, me, { name: 'lab-project', description: '', type: 'Security', owners: [] });
  const r = apps.registerApp(w, me, { name: 'LAB Client', redirectUris: [] });
  const groupRole = { role: 'Groups Administrator', assignment: 'active' as const, permanent: false, expires: '2026-10-30T13:00:00Z', justification: 'LAB-001' };
  const appRole = { ...groupRole, role: 'Cloud Application Administrator' };
  u.roles.push(groupRole, appRole);
  groups.updateCloudGroup(w, u.upn, g.name, { description: 'Delegated edit' });
  apps.setAppRedirectUris(w, u.upn, r.appId, ['https://lab-app.invalid/callback']);
  groupRole.expires = '2026-10-30T11:00:00Z'; appRole.expires = groupRole.expires;
  assert.throws(() => groups.updateCloudGroup(w, u.upn, g.name, { description: 'Expired' }), denied);
  assert.throws(() => apps.setAppRedirectUris(w, u.upn, r.appId, []), denied);
  u.roles = [{ ...groupRole, assignment: 'eligible', expires: null }, { ...appRole, assignment: 'eligible', expires: null }];
  assert.throws(() => groups.setCloudGroupOwner(w, u.upn, g.name, u.upn, true), denied);
  assert.throws(() => apps.setAppOwner(w, u.upn, r.appId, u.upn, true), denied);
});

test('Azure logs: combined filters are inclusive, case-insensitive and run before the display limit', async () => {
  const { filterSignIns, filterAudit } = await import('../src/core/portalLogs.ts');
  const { w } = fixture();
  const mk = (i: number): SignIn => ({ id: String(i), time: '2026-10-30T12:00:00Z', upn: 'lab@lab.invalid', app: 'CareChart', result: 'Success', ip: '203.0.113.4', location: 'Lab', device: 'LAB-PC', failureReason: '', mfa: 'Not required', ca: '', risk: 'none' });
  const list = Array.from({ length: 205 }, (_, i) => mk(i));
  list[204] = { ...mk(204), result: 'Failure', failureReason: 'AADSTS50011', time: '2026-10-29T23:59:59Z' };
  assert.equal(filterSignIns(list, { query: 'aadsts50011', status: 'Failure', from: '2026-10-29', to: '2026-10-29' }).length, 1);
  assert.equal(filterSignIns(list, { query: 'CARECHART', status: 'Success' }).length, 200);
  assert.equal(filterSignIns(list, { from: '2026-10-31', to: '2026-10-29' }).length, 0);
  const before = JSON.stringify(w.audit);
  const events = filterAudit(w.audit, { query: 'lab-owner', source: 'Entra ID' });
  assert.ok(events.length > 0);
  assert.equal(JSON.stringify(w.audit), before);
  assert.equal(list.length, 205);
});
