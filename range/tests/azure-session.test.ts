import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { assignDirectoryRole } from '../src/world/entraAdmin.ts';
import { effectiveRoles, ensureAzure, scopeOf } from '../src/world/azure.ts';
import { createLabAccount } from '../src/world/portalAccounts.ts';
import { authenticate, tenantForUpn } from '../src/ui/azureSession.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

const WS = 'Meridian!2026';
const NO_USER = /This username may be incorrect\. Make sure you typed it correctly\. Otherwise, contact your admin\./;
const BAD_PW = /Your account or password is incorrect\. If you don't remember your password, reset it now\./;

test('portal sign-in: the MSP admin uses the workstation password; wrong passwords and unknown accounts are refused', () => {
  const w = createCompanyWorld(profileById('lumen')!);
  const me = `${MSP_ADMIN}@${w.entra.primaryDomain}`;
  assert.deepEqual(authenticate(w, me, WS, WS), { ok: true, upn: me });
  const bad = authenticate(w, me, 'nope', WS);
  assert.ok(!bad.ok && BAD_PW.test(bad.message));
  const ghost = authenticate(w, `ghost@${w.entra.primaryDomain}`, WS, WS);
  assert.ok(!ghost.ok && NO_USER.test(ghost.message));
});

test('portal sign-in: real-looking outside accounts never resolve to a tenant', () => {
  const tenants = [{ domain: 'lumenbio.test', tenant: 'lumenbio.onmicrosoft.test' }, { domain: 'meridianhealth.test', tenant: 'meridianhealth.onmicrosoft.test' }];
  assert.equal(tenantForUpn('someone@outlook.com', tenants), null);
  assert.equal(tenantForUpn('someone@contoso.onmicrosoft.com', tenants), null);
  assert.equal(tenantForUpn('msp-admin@lumenbio.onmicrosoft.test', tenants), 'lumenbio.test');
  assert.equal(tenantForUpn('a.b@LUMENBIO.test', tenants), 'lumenbio.test');
});

test('portal sign-in: a created lab account signs in to its own tenant only and is a delegated admin, not Global Admin', () => {
  const w = createCompanyWorld(profileById('lumen')!);
  const acct = createLabAccount(w, { displayName: 'Ana Lab', nickname: 'ana.lab', password: 'Ana-Lab-2026!' });
  assert.equal(acct.upn, 'ana.lab@lumenbio.onmicrosoft.test');
  assert.deepEqual(authenticate(w, acct.upn, 'Ana-Lab-2026!', WS), { ok: true, upn: acct.upn });
  const other = createCompanyWorld(profileById('kestrel')!);
  assert.equal(authenticate(other, acct.upn, 'Ana-Lab-2026!', WS).ok, false);
  assert.throws(() => assignDirectoryRole(w, acct.upn, acct.upn, 'Global Administrator', true), /Insufficient privileges/);
  const sub = ensureAzure(w).subscriptions[0]!;
  assert.ok(effectiveRoles(w, acct.upn, scopeOf({ subscription: sub.id })).some((r) => r.role === 'User Access Administrator'));
  assert.ok(w.audit.some((e) => e.action === 'Add user' && e.actor === 'Lab account sign-up' && e.target === acct.upn));
});

test('portal sign-in: disabled accounts are refused; Meridian admin signs in with the workstation password', () => {
  const w = createCompanyWorld(profileById('lumen')!);
  const acct = createLabAccount(w, { displayName: 'Off', nickname: 'off.lab', password: 'Off-Lab-2026!' });
  acct.accountEnabled = false;
  const r = authenticate(w, acct.upn, 'Off-Lab-2026!', WS);
  assert.ok(!r.ok && /Your account has been locked\./.test(r.message));
  const m = createWorld(3);
  const admin = m.entra.users.find((e) => e.onPremSam === 'admin')!;
  assert.equal(authenticate(m, admin.upn, WS, WS).ok, true);
});

// ---------------------------------------------------------------- stage 3a review fixes
import { labTenants, sessionValid } from '../src/ui/azureSession.ts';
import { revokeSessions } from '../src/world/cloud.ts';
import { nowIso } from '../src/core/time.ts';

test('review: the tenant list for sign-in comes from profiles, without opening any company', () => {
  const list = labTenants({ domain: 'meridianhealth.test', tenant: 'meridianhealth.test' });
  assert.equal(list.length, 11);
  assert.ok(list.some((x) => x.domain === 'kestrelmfg.test' && x.tenant === 'kestrelmfg.onmicrosoft.test'));
});

test('review: a portal session ends when the account is deleted, disabled or its sessions are revoked', () => {
  const w = createCompanyWorld(profileById('lumen')!);
  const acct = createLabAccount(w, { displayName: 'S', nickname: 's.lab', password: 'S-Lab-Passw0rd-2026!' });
  const since = nowIso();
  assert.equal(sessionValid(w, acct.upn, since), true);
  revokeSessions(w, acct.upn, 'test');
  assert.equal(sessionValid(w, acct.upn, since), false, 'revoked');
  assert.equal(sessionValid(w, acct.upn, nowIso()), true, 'a new sign-in is fine');
  acct.accountEnabled = false;
  assert.equal(sessionValid(w, acct.upn, nowIso()), false, 'disabled');
  assert.equal(sessionValid(w, 'nobody@lumenbio.onmicrosoft.test', nowIso()), false, 'missing');
});
