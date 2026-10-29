import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createCompanyWorld, MSP_ADMIN } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { addNamedLocation, deleteCaPolicyAs, ensureTenantSecurity, saveCaPolicyAs, whatIf } from '../src/world/tenantSettings.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));
const NO_RIGHTS = /Insufficient privileges to complete the operation\./;

function summit() {
  const w = createCompanyWorld(profileById('summitridge')!);
  ensureTenantSecurity(w);
  const user = w.entra.users.find((e) => e.source === 'synced' && e.accountEnabled && !e.roles.length)!;
  const caAdmin = w.entra.users.filter((e) => e.source === 'synced' && e.accountEnabled)[3]!;
  caAdmin.roles.push({ role: 'Conditional Access Administrator', assignment: 'active', permanent: true, expires: null, justification: 't' });
  return { w, me: `${MSP_ADMIN}@${w.entra.primaryDomain}`, user, caAdmin };
}

test('ca: each company gets baseline policies, a break-glass account excluded from them, and office named locations', () => {
  const { w } = summit();
  assert.ok(w.entra.caPolicies.length >= 3);
  const bg = w.entra.users.find((e) => e.upn.startsWith('bg-emergency01@'))!;
  assert.ok(bg.roles.some((r) => r.role === 'Global Administrator' && r.assignment === 'active'));
  for (const p of w.entra.caPolicies) assert.ok(p.excludeUsers.includes(bg.upn), `${p.name} excludes break-glass`);
  assert.ok((w.entra.namedLocations ?? []).some((n) => n.trusted));
  const n = w.entra.caPolicies.length;
  ensureTenantSecurity(w);
  assert.equal(w.entra.caPolicies.length, n, 'idempotent');
});

test('ca: only Conditional Access or Security Administrators change policies', () => {
  const { w, me, caAdmin } = summit();
  const p = w.entra.caPolicies[0]!;
  assert.throws(() => saveCaPolicyAs(w, me, { ...p, state: 'off' }), NO_RIGHTS);
  assert.throws(() => deleteCaPolicyAs(w, me, p.id), NO_RIGHTS);
  assert.throws(() => addNamedLocation(w, me, 'Home', ['198.51.100.0/24'], true), NO_RIGHTS);
  saveCaPolicyAs(w, caAdmin.upn, { ...p, state: 'report-only' });
  assert.equal(w.entra.caPolicies[0]!.state, 'report-only');
});

test('ca: What If evaluates users, exclusions, roles, legacy auth, risk and trusted locations', () => {
  const { w, user, caAdmin } = summit();
  const office = w.entra.namedLocations!.find((n) => n.trusted)!.ips[0]!.split('/')[0]!;
  saveCaPolicyAs(w, caAdmin.upn, { name: 'Require MFA outside offices', state: 'on', includeUsers: 'All users', excludeUsers: [], apps: 'All cloud apps', condition: 'outside-trusted-locations', grant: 'require-mfa' });
  const home = whatIf(w, { upn: user.upn, app: 'Office 365', ip: '203.0.113.200', risk: 'none', legacyAuth: false });
  assert.ok(home.find((r) => r.policy === 'Require MFA outside offices')!.applies);
  const inOffice = whatIf(w, { upn: user.upn, app: 'Office 365', ip: office, risk: 'none', legacyAuth: false });
  assert.equal(inOffice.find((r) => r.policy === 'Require MFA outside offices')!.applies, false);
  const legacy = whatIf(w, { upn: user.upn, app: 'Office 365', ip: office, risk: 'none', legacyAuth: true });
  assert.ok(legacy.some((r) => r.applies && r.grant === 'block' && r.state === 'on'));
  const bg = w.entra.users.find((e) => e.upn.startsWith('bg-emergency01@'))!;
  assert.ok(whatIf(w, { upn: bg.upn, app: 'Office 365', ip: '203.0.113.200', risk: 'high', legacyAuth: true }).filter((r) => r.policy !== 'Require MFA outside offices').every((r) => !r.applies && /excluded/i.test(r.reason)));
  const adminRes = whatIf(w, { upn: caAdmin.upn, app: 'Office 365', ip: office, risk: 'none', legacyAuth: false });
  assert.ok(adminRes.some((r) => r.applies && r.grant === 'require-mfa'), 'directory-role policy applies to an admin');
  assert.ok(!whatIf(w, { upn: user.upn, app: 'Office 365', ip: office, risk: 'none', legacyAuth: false }).some((r) => r.applies && r.grant === 'require-mfa' && r.policy.includes('admin')));
});
