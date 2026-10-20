import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { CARECHART, SHIFTWISE, activateCert, ensureFederation, getFedApp, newClientSecret, newSamlCert, setSpSettings, simulateSso } from '../src/world/federation.ts';
import { addUsage, connect, endSession, ensurePam, getAccount, onboard, requestAccess, rotate, showPassword, usageHealth } from '../src/world/pam.ts';
import { aggregate, correlate, createSourceCampaign, decide, ensureIga, identityOf, signOff, uncorrelatedAccounts } from '../src/world/iga.ts';
import { openTicket } from '../src/world/itsm.ts';

let t = Date.parse('2026-10-20T14:00:00Z');
setClock(() => (t += 1000));

const nurse = (w: ReturnType<typeof createWorld>): string => w.ad.users.find((u) => u.department === 'Nursing' && u.title === 'Registered Nurse')!.upn;

test('SSO: each broken setting fails with the code the real one gives', () => {
  const w = createWorld(11);
  ensureFederation(w);
  const upn = nurse(w);
  assert.equal(simulateSso(w, SHIFTWISE, upn).ok, true, 'healthy SAML trust signs in');
  assert.equal(simulateSso(w, CARECHART, upn).ok, true, 'healthy OIDC trust signs in');
  const sw = getFedApp(w, SHIFTWISE).fed;
  const keep = JSON.stringify(sw);
  sw.sp.entityId = 'https://other/sp';
  assert.equal(simulateSso(w, SHIFTWISE, upn).code, 'AADSTS700016');
  Object.assign(sw, JSON.parse(keep));
  sw.sp.acsUrl = 'https://shiftwise.meridianhealth.test/elsewhere';
  assert.equal(simulateSso(w, SHIFTWISE, upn).code, 'AADSTS50011');
  Object.assign(sw, JSON.parse(keep));
  sw.saml!.nameIdSource = 'user.objectid';
  const r = simulateSso(w, SHIFTWISE, upn);
  assert.equal(r.failedAt, 'application');
  assert.match(r.evidence, /<NameID[^>]*>[0-9a-f-]{30,}<\/NameID>/, 'the decoded response shows the GUID NameID');
  Object.assign(sw, JSON.parse(keep));
  // Rotating only in Entra breaks the app until it trusts the new certificate.
  const c = newSamlCert(w, SHIFTWISE);
  activateCert(w, SHIFTWISE, c.thumbprint);
  assert.match(simulateSso(w, SHIFTWISE, upn).message, /Signature validation failed/);
  setSpSettings(w, SHIFTWISE, { idpCertThumbprint: c.thumbprint });
  assert.equal(simulateSso(w, SHIFTWISE, upn).ok, true);
  // OIDC: an expired secret, then a new one the app has not been given.
  const cc = getFedApp(w, CARECHART).fed;
  cc.oidc!.secrets[0]!.expires = '2026-01-01T00:00:00Z';
  assert.equal(simulateSso(w, CARECHART, upn).code, 'AADSTS7000222');
  const s = newClientSecret(w, CARECHART, 12);
  assert.equal(simulateSso(w, CARECHART, upn).code, 'AADSTS7000222');
  setSpSettings(w, CARECHART, { clientSecretId: s.id });
  const ok = simulateSso(w, CARECHART, upn);
  assert.equal(ok.ok, true);
  assert.match(ok.evidence, /"aud": "[0-9a-f-]{30,}"/, 'the decoded ID token shows aud');
  assert.throws(() => newClientSecret(w, CARECHART, 36), /24 months/);
});

test('Vault: Use connects without seeing the password; Tier 0 needs an approved change; rotation follows usages', () => {
  const w = createWorld(12);
  ensurePam(w);
  assert.throws(() => showPassword(w, 't0-adm-ghopper', 'x'), /needs Retrieve.*Connect through a session/);
  assert.throws(() => connect(w, 't0-adm-ghopper', 'MHS-DC01'), /approved access request/);
  assert.equal(requestAccess(w, 't0-adm-ghopper', 'x', 'CHG0099999').state, 'Rejected');
  const chg = openTicket(w, { type: 'Change', category: 'AD', priority: 3, caller: 'x', short: 'Change', description: '', approvals: [{ approver: 'IT', role: 'CAB', state: 'Approved', time: null }] });
  assert.equal(requestAccess(w, 't0-adm-ghopper', 'work', chg.id).state, 'Approved');
  const before = getAccount(w, 't0-adm-ghopper').passwordVersion;
  const s = connect(w, 't0-adm-ghopper', 'MHS-DC01');
  endSession(w, s.id);
  assert.equal(getAccount(w, 't0-adm-ghopper').passwordVersion, before + 1, 'changed at check-in');
  // Onboard svc-sql01: rotating before registering usages breaks SQL Server.
  onboard(w, 'svc-sql01', 'SVC-Windows', 30);
  rotate(w, 'svc-sql01');
  assert.ok(usageHealth(w, 'svc-sql01').every((u) => !u.ok && !u.registered));
  addUsage(w, 'svc-sql01', { type: 'Windows Service', host: 'MHS-SQL01', name: 'MSSQLSERVER' });
  addUsage(w, 'svc-sql01', { type: 'Windows Service', host: 'mhs-sql01', name: 'SQLSERVERAGENT' });
  assert.ok(usageHealth(w, 'svc-sql01').every((u) => u.registered && !u.ok), 'usages added after a change still hold the old password');
  rotate(w, 'svc-sql01');
  assert.ok(usageHealth(w, 'svc-sql01').every((u) => u.ok));
});

test('Governance: correlation is by key, self-review is blocked, sign-off needs every line and raises manual work', () => {
  const w = createWorld(13);
  ensureIga(w);
  w.saas.find((a) => a.id === 'carechart')!.accounts.push({ login: 'temp.user@meridianhealth.test', displayName: 'Temp User', role: 'Clinician', active: true, lastLogin: null, managedBy: 'Manual', employeeId: 'E100401' });
  aggregate(w, 'carechart');
  const acct = uncorrelatedAccounts(w).find((a) => a.nativeId === 'temp.user@meridianhealth.test');
  assert.ok(acct, 'an app account the rule cannot match is uncorrelated, even if it stores an employee ID');
  correlate(w, 'carechart', acct!.nativeId, 'E100401');
  assert.equal(identityOf(w, acct!), 'E100401');
  assert.throws(() => correlate(w, 'carechart', acct!.nativeId, 'E999999'), /No identity/);

  const c = createSourceCampaign(w, { name: 'Finance', departments: ['Finance'], reviewer: w.player.sam, due: '2026-12-31T00:00:00Z', description: '' });
  assert.ok(c.items.length > 20);
  assert.throws(() => signOff(w, c.id), /pending/);
  const payroll = c.items.find((i) => i.entitlement === 'app-payrollpro')!;
  decide(w, c.id, [payroll.id], 'revoke');
  decide(w, c.id, c.items.filter((i) => i.id !== payroll.id).map((i) => i.id), 'approve');
  const r = signOff(w, c.id);
  assert.equal(r.manual.length, 1, 'PayrollPro has no connector: a manual work item is raised');
  assert.ok(!w.ad.users.find((u) => u.sam === payroll.account)!.memberOf.includes('app-payrollpro'), 'AD revocation provisioned');
  assert.ok(w.saas.find((a) => a.id === 'payrollpro')!.accounts.find((a) => a.login === w.ad.users.find((u) => u.sam === payroll.account)!.upn)!.active, 'the app account stays until someone removes it');
  const sec = createSourceCampaign(w, { name: 'Security', departments: ['Security'], reviewer: w.player.sam, due: '2026-12-31T00:00:00Z', description: '' });
  const own = sec.items.find((i) => i.account === w.player.sam)!;
  assert.throws(() => decide(w, sec.id, [own.id], 'approve'), /your own access/);
});
