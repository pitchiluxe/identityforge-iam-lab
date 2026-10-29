/**
 * The IAM cmdlets answer as the real modules do: Microsoft's synopsis and
 * parameter types in Get-Help, real property names, Graph ids that are GUIDs,
 * membership as bare directory objects, and Graph's own refusal to edit a
 * synced user.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { Shell } from '../src/terminal/shell.ts';
import { CMDLETS } from '../src/terminal/cmdlets.ts';
import { HELP } from '../src/terminal/helpdocs.ts';

let t = Date.parse('2026-10-20T20:00:00Z');
setClock(() => (t += 1000));

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function shell(graph = true): { sh: Shell; run: (s: string) => string } {
  const sh = new Shell(createWorld(5), CMDLETS);
  if (graph) sh.run('Connect-MgGraph -Scopes User.Read.All,RoleManagement.Read.Directory -NoWelcome');
  return { sh, run: (s) => sh.run(s).map((l) => l.text).join('\n') };
}

test('every command has its official synopsis, and Meridian practice only in NOTES', () => {
  for (const d of CMDLETS) {
    assert.ok(HELP[d.name], `${d.name} has a help entry`);
    assert.equal(d.synopsis, HELP[d.name]!.synopsis);
    assert.doesNotMatch(d.synopsis, /Meridian|SOP|in the range|IAM-POL|MHS-/, `${d.name}: lab text belongs in notes`);
  }
  const { run } = shell(false);
  const pw = run('Get-Help Set-ADAccountPassword');
  assert.match(pw, /SYNOPSIS\n {4}Modifies the password of an Active Directory account\./);
  assert.match(pw, /-NewPassword <SecureString>/);
  assert.match(pw, /-Identity <ADAccount>/);
  assert.match(pw, /NOTES\n {4}Meridian practice: .*ChangePasswordAtLogon/);
  assert.match(run('Get-Help Get-ADGroupMember'), /-Identity <ADGroup>/);
  assert.match(run('Get-Help Add-ADGroupMember'), /-Members <ADPrincipal\[\]>/);
});

test('domain password policy matches what the DC enforces', () => {
  const out = shell(false).run('Get-ADDefaultDomainPasswordPolicy');
  assert.match(out, /LockoutThreshold\s+: 5/);
  assert.match(out, /MinPasswordLength\s+: 12/);
  assert.match(out, /ComplexityEnabled\s+: True/);
  assert.equal(shell(false).run('Get-ADUserResultantPasswordPolicy vhale'), '');
});

test('Get-ADObject, token groups, domain controller', () => {
  const { run } = shell(false);
  assert.match(run("Get-ADObject -Filter \"ObjectClass -eq 'organizationalUnit'\""), /OU=Staging,OU=Corp,DC=meridianhealth,DC=test/);
  const token = run('Get-ADAccountAuthorizationGroup vhale | Select-Object Name');
  for (const g of ['Everyone', 'Authenticated Users', 'Domain Users', 'grp-all-staff']) assert.ok(token.includes(g), g);
  assert.match(run('Get-ADDomainController -Discover'), /OperationMasterRoles\s+: \{SchemaMaster, DomainNamingMaster, PDCEmulator, RIDMaster, InfrastructureMaster\}/);
});

test('OUs: created protected by default, removal refused until unprotected', () => {
  const { sh, run } = shell(false);
  run("New-ADOrganizationalUnit -Name Contractors -Path 'OU=Users,OU=Corp,DC=meridianhealth,DC=test'");
  assert.ok(sh.w.ad.ous.includes('Corp/Users/Contractors'));
  assert.match(run("Remove-ADOrganizationalUnit -Identity 'OU=Contractors,OU=Users,OU=Corp,DC=meridianhealth,DC=test'"), /Access is denied/);
  run("New-ADOrganizationalUnit -Name Temp -ProtectedFromAccidentalDeletion $false -Path 'OU=Users,OU=Corp,DC=meridianhealth,DC=test'");
  run("Remove-ADOrganizationalUnit -Identity 'OU=Temp,OU=Users,OU=Corp,DC=meridianhealth,DC=test'");
  assert.ok(!sh.w.ad.ous.includes('Corp/Users/Temp'));
});

test('Set-ADAccountControl changes the real flag', () => {
  const { sh, run } = shell(false);
  run('Set-ADAccountControl -Identity svc-backup -PasswordNeverExpires $false');
  assert.equal(sh.w.ad.users.find((u) => u.sam === 'svc-backup')!.passwordNeverExpires, false);
});

test('Graph needs Connect-MgGraph, and Get-MgContext reports the session', () => {
  const off = shell(false).run('Get-MgGroup');
  assert.match(off, /Authentication needed\. Please call Connect-MgGraph\./);
  assert.match(off, /AuthenticationException/);
  const { run } = shell();
  assert.match(run('Get-MgContext'), /Scopes\s+: \{User\.Read\.All, RoleManagement\.Read\.Directory/);
  run('Disconnect-MgGraph');
  assert.equal(run('Get-MgContext'), '');
});

test('Graph ids are GUIDs and membership returns directory objects', () => {
  const { sh, run } = shell();
  for (const e of sh.w.entra.users) assert.match(e.id, GUID, e.upn);
  const gid = /Id\s+: (\S+)/.exec(run("Get-MgGroup -Filter \"displayName eq 'grp-all-staff'\""))![1]!;
  assert.match(gid, GUID);
  const members = run(`Get-MgGroupMember -GroupId ${gid} -All`);
  assert.match(members, /^\nId\s+DeletedDateTime/);
  const ids = members.match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) ?? [];
  assert.ok(ids.length >= 30);
  assert.ok(ids.every((i) => GUID.test(i) && sh.w.entra.users.some((e) => e.id === i)));
  assert.match(run('Get-MgGroup -GroupId grp-all-staff'), /Request_ResourceNotFound/);
});

test('Update-MgUser refuses synced users with the Graph error and edits cloud-only ones', () => {
  const { sh, run } = shell();
  assert.match(run('Update-MgUser -UserId vhale@meridianhealth.test -Department Payroll'), /Unable to update the specified properties for on-premises mastered Directory Sync objects/);
  const bg = sh.w.entra.users.find((e) => e.source === 'cloud')!;
  run(`Update-MgUser -UserId ${bg.upn} -AccountEnabled:$false`);
  assert.equal(bg.accountEnabled, false);
  assert.ok(sh.w.audit.some((a) => a.source === 'Entra ID' && a.target === bg.upn && /accountEnabled=false/.test(a.detail)));
  assert.match(run('Get-MgAuditLogDirectoryAudit -Top 5'), /Update user/);
});

test('licences, roles and PIM use Microsoft SKU and role template ids', () => {
  const { run } = shell();
  assert.match(run('Get-MgUserLicenseDetail -UserId vhale@meridianhealth.test'), /05e9a617-0261-4cee-bb44-138d3ef5d965 SPE_E3/);
  assert.match(run('Get-MgSubscribedSku'), /SkuPartNumber\s+: SPE_E3/);
  assert.match(run('Get-MgDirectoryRole'), /Global Administrator .* 62e90394-69f5-4237-9190-012177145e10/);
  assert.match(run('Get-MgRoleManagementDirectoryRoleEligibilitySchedule'), /RoleDefinitionId : fe930be7-5e62-47db-91af-98c3a49a38b1/);
  const ga = run("Get-MgRoleManagementDirectoryRoleAssignment -Filter \"roleDefinitionId eq '62e90394-69f5-4237-9190-012177145e10'\"");
  assert.equal((ga.match(/62e90394-69f5-4237-9190-012177145e10/g) ?? []).length, 2, 'two break-glass Global Administrators');
});

test('Conditional Access, risky users, enterprise apps and sync connectors', () => {
  const { sh, run } = shell();
  assert.match(run('Get-MgIdentityConditionalAccessPolicy'), /State\s+: enabledForReportingButNotEnforced/);
  assert.match(run('Get-MgIdentityConditionalAccessPolicy'), /Id\s+: [0-9a-f]{8}-/);
  const e = sh.w.entra.users.find((x) => x.source === 'synced')!;
  e.riskLevel = 'high';
  assert.ok(run("Get-MgRiskyUser -Filter \"riskLevel eq 'high'\"").includes(e.upn));
  run(`Invoke-MgDismissRiskyUser -UserIds ${e.id}`);
  assert.equal(e.riskLevel, 'none');
  assert.match(run("Get-MgServicePrincipal -Filter \"displayName eq 'CareChart EHR'\""), /AppRoleAssignmentRequired\s+: True/);
  assert.match(run('Get-ADSyncConnector'), /Type\s+: Extensible2/);
});
