import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock, nowIso } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { createCloudUser } from '../src/world/entraAdmin.ts';
import {
  addApiPermission, addSecret, assignApp, ensureApps, grantAdminConsent, registerApp, removeSecret, secretsExpiringWithin, setAssignmentRequired,
} from '../src/world/apps.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

const NO_RIGHTS = /Insufficient privileges to complete the operation\./;

function world(id = 'brightwater') {
  const w = createCompanyWorld(profileById(id)!);
  return { w, me: `${MSP_ADMIN}@${w.entra.primaryDomain}` };
}

test('apps: each company has its own industry apps, registered and as enterprise apps, created on first use', () => {
  const { w } = world();
  assert.equal(w.entra.appRegistrations, undefined);
  const regs = ensureApps(w);
  assert.ok(regs.length >= 2);
  for (const r of regs) assert.ok(w.entra.apps.some((a) => a.id === `ent-${r.appId}`), `${r.name} has an enterprise app`);
  assert.ok(secretsExpiringWithin(w, 30).length >= 1, 'at least one secret about to expire (a real ticket)');
  assert.deepEqual(ensureApps(world().w).map((r) => r.name), regs.map((r) => r.name), 'deterministic');
});

test('apps: members may register apps and own them; owners manage their secrets; others cannot', () => {
  const { w, me } = world();
  ensureApps(w);
  const dev = createCloudUser(w, me, { displayName: 'Dev', mailNickname: 'dev', password: 'Dev-Passw0rd-1!', forceChange: false });
  const app = registerApp(w, dev.upn, { name: 'Matter Intake Bot', redirectUris: ['https://intake.brightwaterlaw.test/auth'] });
  assert.deepEqual(app.owners, [dev.upn]);
  const s = addSecret(w, dev.upn, app.appId, 'ci', 6);
  assert.ok(s.expires > nowIso());
  assert.throws(() => addSecret(w, me, app.appId, 'msp', 6), NO_RIGHTS, 'MSP is not an owner or app admin');
  removeSecret(w, dev.upn, app.appId, s.id);
  assert.equal(w.entra.appRegistrations!.find((r) => r.appId === app.appId)!.secrets.length, 0);
});

test('apps: admin consent — delegated needs Cloud Application Administrator, Graph application permissions need Privileged Role Administrator', () => {
  const { w, me } = world();
  ensureApps(w);
  const reg = registerApp(w, me, { name: 'Reports Sync', redirectUris: [] });
  addApiPermission(w, me, reg.appId, { api: 'Microsoft Graph', name: 'User.Read.All', type: 'Delegated' });
  addApiPermission(w, me, reg.appId, { api: 'Microsoft Graph', name: 'Directory.Read.All', type: 'Application' });
  assert.throws(() => grantAdminConsent(w, me, reg.appId), NO_RIGHTS);
  const cappa = w.entra.users.find((e) => e.source === 'synced')!;
  cappa.roles.push({ role: 'Cloud Application Administrator', assignment: 'active', permanent: true, expires: null, justification: 't' });
  assert.throws(() => grantAdminConsent(w, cappa.upn, reg.appId), NO_RIGHTS, 'application permissions to Graph need PRA');
  cappa.roles.push({ role: 'Privileged Role Administrator', assignment: 'active', permanent: true, expires: null, justification: 't' });
  grantAdminConsent(w, cappa.upn, reg.appId);
  assert.ok(w.entra.appRegistrations!.find((r) => r.appId === reg.appId)!.permissions.every((p) => p.consented));
});

test('apps: enterprise app assignments need an app admin or the app owner', () => {
  const { w, me } = world();
  const [reg] = ensureApps(w);
  const ent = w.entra.apps.find((a) => a.id === `ent-${reg!.appId}`)!;
  const user = w.entra.users.find((e) => e.source === 'synced')!;
  assert.throws(() => assignApp(w, me, ent.id, user.upn, true), NO_RIGHTS);
  const admin = w.entra.users.filter((e) => e.source === 'synced')[1]!;
  admin.roles.push({ role: 'Application Administrator', assignment: 'active', permanent: true, expires: null, justification: 't' });
  assignApp(w, admin.upn, ent.id, user.upn, true);
  assert.ok(ent.assignedUsers.includes(user.upn));
  setAssignmentRequired(w, admin.upn, ent.id, false);
  assert.equal(ent.assignmentRequired, false);
});
