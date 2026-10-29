import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { Dir, localYmd, runCapability } from '../src/ui/aduc/shim/session.ts';
import { getUser, findGroup, ouInfo } from '../src/world/directory.ts';
import { startScenario } from '../src/scenarios/engine.ts';
import { grade } from '../src/scenarios/grader.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

test('the ported console reads the world through the IAM Range directory interface', () => {
  const w = createWorld(4);
  const dir = new Dir(() => w);
  assert.ok(dir.childOus(undefined).some((o) => o.id === 'Corp'));
  assert.deepEqual(dir.childOus('Corp/Users').map((o) => o.name).sort(), ['Finance', 'HR', 'Help Desk', 'IT', 'Nursing', 'Radiology', 'Security']);
  const v = dir.getUserByUsername('vhale')!;
  assert.equal(v.ouId, 'Corp/Users/Finance');
  assert.equal(v.attrs?.physicalDeliveryOfficeName, 'Boston Main Campus');
  assert.ok(dir.getGroupByName('grp-finance-analysts')!.memberIds.includes('vhale'));
  assert.equal(dir.getGroupByName('Domain Admins')!.ouId, undefined, 'built-in groups live in CN=Users');
});

test('property sheet changes land on the world the grader reads', () => {
  const w = createWorld(4);
  runCapability(w, 'user.update', { Identity: 'praman', Office: 'Cambridge Clinic', OfficePhone: '+1 512 555 0100', Manager: 'hkovacs', AccountExpirationDate: '2026-12-31', Replace: 'employeeID=E999999', PasswordNeverExpires: 'true' });
  const u = getUser(w, 'praman');
  assert.equal(u.office, 'Cambridge Clinic');
  assert.equal(u.manager, 'hkovacs');
  assert.equal(u.employeeId, 'E999999');
  assert.equal(u.passwordNeverExpires, true);
  assert.equal(localYmd(u.accountExpires!), '2026-12-31');
  assert.equal(new Dir(() => w).getUserByUsername('praman')!.attrs!.accountExpires, '2026-12-31');
  assert.equal(w.ad.extra!.userAttrs.praman!.telephoneNumber, '+1 512 555 0100');
  runCapability(w, 'user.update', { Identity: 'praman', Clear: 'manager' });
  assert.equal(getUser(w, 'praman').manager, null);
  assert.throws(() => runCapability(w, 'password.reset', { Identity: 'praman', NewPassword: 'short' }), /complexity|requirement/);
  runCapability(w, 'password.reset', { Identity: 'praman', NewPassword: 'Correct-Horse-9', ChangePasswordAtLogon: 'true' });
  assert.equal(getUser(w, 'praman').mustChangePassword, true);
});

test('OU, group and rename operations behave like AD', () => {
  const w = createWorld(4);
  runCapability(w, 'ou.create', { Name: 'Contractors', Path: 'Corp/Users', ProtectedFromAccidentalDeletion: 'false' });
  assert.ok(w.ad.ous.includes('Corp/Users/Contractors'));
  runCapability(w, 'group.create', { Name: 'grp-contractors', Path: 'Corp/Users/Contractors', GroupScope: 'Global' });
  runCapability(w, 'group.addMember', { Identity: 'praman', Group: 'grp-contractors' });
  runCapability(w, 'object.rename', { Identity: 'grp-contractors', NewName: 'grp-vendors' });
  assert.ok(getUser(w, 'praman').memberOf.includes('grp-vendors'));
  runCapability(w, 'user.move', { Identity: 'praman', TargetPath: 'Corp/Users/Contractors' });
  runCapability(w, 'object.rename', { Identity: 'Corp/Users/Contractors', NewName: 'Vendors' });
  assert.equal(getUser(w, 'praman').ou, 'Corp/Users/Vendors', 'objects move with a renamed OU');
  assert.throws(() => runCapability(w, 'ou.delete', { Name: 'Corp/Users/Vendors' }), /child objects/);
  assert.throws(() => runCapability(w, 'ou.delete', { Name: 'Corp' }), /protected|privileges/);
  runCapability(w, 'group.delete', { Name: 'grp-vendors' });
  assert.equal(findGroup(w, 'grp-vendors'), undefined);
  assert.ok(!getUser(w, 'praman').memberOf.includes('grp-vendors'));
  assert.throws(() => runCapability(w, 'group.addMember', { Identity: 'praman', Group: 'Domain Admins' }), /Insufficient access/);
  runCapability(w, 'ou.update', { Identity: 'Corp/Users/Vendors', Description: 'Third parties', ProtectedFromAccidentalDeletion: 'true' });
  assert.equal(ouInfo(w, 'Corp/Users/Vendors').description, 'Third parties');
});

test('a leaver scenario can be completed through the console operations', () => {
  const w = createWorld(9);
  const s = startScenario(w, { templateId: 'mover', twist: 'standard', seed: 2 });
  const sam = s.params.sam!;
  const before = grade(w, s).results.filter((r) => r.pass).length;
  runCapability(w, 'user.update', { Identity: sam, Department: s.params.to!, Manager: s.params.manager! });
  runCapability(w, 'user.move', { Identity: sam, TargetPath: `Corp/Users/${s.params.to}` });
  const after = grade(w, s).results.filter((r) => r.pass).length;
  assert.ok(after > before, 'console changes move the grade');
});

// ---------------------------------------------------------------- Change Domain (MSP companies)
import { createCompanyWorld } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';
import { userDn, sidFor } from '../src/ui/aduc/shim/adObjects.ts';

test('the console works on another company domain: tree, DNs and new users follow it', () => {
  const k = createCompanyWorld(profileById('kestrel')!);
  const dir = new Dir(() => k);
  assert.equal(dir.domainName, 'kestrelmfg.test');
  assert.deepEqual(dir.childOus(undefined).map((o) => o.id), ['Kestrel']);
  runCapability(k, 'user.create', { Name: 'Ana Ruiz', SamAccountName: 'aruiz', Path: 'kestrelmfg.test/Kestrel/Staging' });
  const u = getUser(k, 'aruiz');
  assert.equal(u.upn, 'aruiz@kestrelmfg.test');
  assert.equal(userDn(dir, dir.getUserByUsername('aruiz')!), 'CN=Ana Ruiz,OU=Staging,OU=Kestrel,DC=kestrelmfg,DC=test');
  const m = new Dir(() => createWorld(4));
  assert.notEqual(sidFor('x', 'x', dir.domainName).split('-').slice(0, 7).join('-'), sidFor('x', 'x', m.domainName).split('-').slice(0, 7).join('-'), 'each domain has its own SID');
});
