import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { Shell } from '../src/terminal/shell.ts';
import { CMDLETS } from '../src/terminal/cmdlets.ts';
import { getUser } from '../src/world/directory.ts';
import { startScenario } from '../src/scenarios/engine.ts';
import { grade } from '../src/scenarios/grader.ts';
import { TEMPLATES } from '../src/scenarios/engine.ts';
import type { World } from '../src/core/types.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

function shell(seed = 11): { w: World; sh: Shell; run: (s: string) => string } {
  const w = createWorld(seed);
  const sh = new Shell(w, CMDLETS);
  return { w, sh, run: (s) => sh.run(s).map((l) => l.text).join('\n') };
}

test('Get-ADUser by identity and filter', () => {
  const { run } = shell();
  assert.match(run('Get-ADUser vhale'), /SamAccountName\s+: vhale/);
  const out = run("Get-ADUser -Filter \"Department -eq 'Finance'\" | Select-Object SamAccountName");
  assert.match(out, /vhale/);
  assert.doesNotMatch(out, /ghopper/);
  assert.match(run("Get-ADUser -Filter {Title -like '*Controller*'} -Properties Title | Select-Object -ExpandProperty Title"), /Financial Controller/);
});

test('pipelines, variables, foreach and string methods', () => {
  const { run } = shell();
  assert.equal(run("$n = 'Grace Hopper'; $n.Split(' ')[0].ToLower()"), 'grace');
  assert.match(run('(Get-ADGroupMember -Identity grp-finance-analysts | Measure-Object).Count'), /^[0-9]+$/);
  assert.match(run("foreach ($g in @('grp-vpn-users','grp-sec-ops')) { Get-ADGroup $g | Select-Object -ExpandProperty Name }"), /grp-vpn-users\ngrp-sec-ops/);
  assert.match(run('Get-ADUser -Filter * | Where-Object { $_.SamAccountName -like \'svc-*\' } | Measure-Object | Select-Object -ExpandProperty Count'), /^4$/);
});

test('mutations go through the directory and respect -WhatIf', () => {
  const { w, run } = shell();
  assert.match(run('Disable-ADAccount -Identity vhale -WhatIf'), /What if/);
  assert.equal(getUser(w, 'vhale').enabled, true);
  run('Disable-ADAccount vhale');
  assert.equal(getUser(w, 'vhale').enabled, false);
  run("Set-ADUser -Identity vhale -Description \"Disabled $(Get-Date -Format yyyy-MM-dd) per RITM1\"");
  assert.match(getUser(w, 'vhale').description, /^Disabled \d{4}-\d{2}-\d{2} per RITM1$/);
  run("Move-ADObject -Identity (Get-ADUser vhale).DistinguishedName -TargetPath 'OU=Disabled Users,OU=Corp,DC=meridianhealth,DC=test'");
  assert.equal(getUser(w, 'vhale').ou, 'Corp/Disabled Users');
});

test('the offboarding template on disk works as written', () => {
  const { w, run } = shell();
  const f = w.files.find((x) => x.path.endsWith('Offboard-Template.ps1'))!;
  f.content = f.content.replace("$sam = 'jdoe'", "$sam = 'praman'").replace("'RITM00XXXXX'", "'RITM0099'");
  const out = run('.\\Documents\\Scripts\\Offboard-Template.ps1');
  assert.doesNotMatch(out, /CategoryInfo/, out);
  const u = getUser(w, 'praman');
  assert.equal(u.enabled, false);
  assert.deepEqual(u.memberOf, []);
  assert.equal(u.ou, 'Corp/Disabled Users');
});

test('errors read like PowerShell and Tier 0 is protected', () => {
  const { run } = shell();
  assert.match(run('Get-ADUser nobody'), /Cannot find an object with identity: 'nobody'/);
  assert.match(run('Get-ADUsr x'), /is not recognized as the name of a cmdlet/);
  assert.match(run('Add-ADGroupMember -Identity "Domain Admins" -Members admin'), /Insufficient access rights/);
  assert.match(run('Get-ADUser -Bogus 1'), /A parameter cannot be found that matches parameter name 'Bogus'/);
  assert.match(run('Revoke-MgUserSignInSession -UserId vhale@meridianhealth.test'), /Connect-MgGraph/);
});

test('investigation cmdlets: Search-ADAccount, Get-WinEvent, Graph sign-ins', () => {
  const { w, sh, run } = shell(21);
  const s = startScenario(w, { templateId: 'lockout', twist: 'stale-device', seed: 3 });
  sh.setWorld(w);
  assert.match(run('Search-ADAccount -LockedOut | Select-Object -ExpandProperty SamAccountName'), new RegExp(s.params.sam!));
  assert.match(run("Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4740} | Select-Object -First 1 | Select-Object -ExpandProperty Message"), new RegExp(`Caller Computer Name: ${s.params.device}`));
  run('Connect-MgGraph -Scopes AuditLog.Read.All -NoWelcome');
  assert.match(run(`Get-MgAuditLogSignIn -Filter "userPrincipalName eq '${getUser(w, s.params.sam!).upn}'" -Top 3`), /Success|Interrupted/);
});

test('a scenario can be solved entirely from PowerShell', () => {
  const { w, sh } = shell(8);
  const s = startScenario(w, { templateId: 'leaver', twist: 'voluntary', seed: 4 });
  const sam = s.params.sam!;
  const ticket = s.ticketIds[0]!;
  const script = `
$sam = '${sam}'
Disable-ADAccount -Identity $sam
Get-ADPrincipalGroupMembership -Identity $sam | Where-Object { $_.Name -ne 'Domain Users' } | ForEach-Object { Remove-ADGroupMember -Identity $_.Name -Members $sam -Confirm:$false }
Set-ADUser -Identity $sam -Description "Disabled $(Get-Date -Format yyyy-MM-dd) per ${ticket}"
Move-ADObject -Identity (Get-ADUser $sam).DistinguishedName -TargetPath 'OU=Disabled Users,OU=Corp,DC=meridianhealth,DC=test'
Invoke-Command -ComputerName MHS-SYNC01 -ScriptBlock { Start-ADSyncSyncCycle -PolicyType Delta }
Connect-MgGraph -Scopes User.ReadWrite.All -NoWelcome
Revoke-MgUserSignInSession -UserId (Get-ADUser $sam).UserPrincipalName
`;
  const out = sh.run(script).filter((l) => l.kind === 'err');
  assert.deepEqual(out, []);
  const r = grade(w, s);
  const remaining = r.results.filter((x) => !x.pass).map((x) => x.label);
  // Okta import, manual SaaS and the ticket are done in the browser, not PowerShell.
  assert.ok(remaining.every((l) => /Okta|ticket|PayrollPro|SCIM|Ticket/i.test(l)), remaining.join('; '));
  void TEMPLATES;
});

// ---------------------------------------------------------------- -Server (MSP companies)
import { createCompanyWorld } from '../src/world/mspSeed.ts';
import { profileById } from '../src/world/profiles.ts';

function mspShell(): { m: World; b: World; run: (s: string) => string } {
  const m = createWorld(11);
  const b = createCompanyWorld(profileById('brightwater')!);
  const sh = new Shell(m, CMDLETS);
  sh.resolveServer = (s) => (s.toLowerCase() === 'brightwaterlaw.test' || s.toLowerCase() === 'brightwater' ? b : s.toLowerCase() === 'meridianhealth.test' ? m : undefined);
  return { m, b, run: (s) => sh.run(s).map((l) => l.text).join('\n') };
}

test('-Server sends an AD cmdlet to another company domain', () => {
  const { m, b, run } = mspShell();
  run("New-ADUser -Name 'Ana Ruiz' -GivenName Ana -Surname Ruiz -SamAccountName aruiz -Path 'OU=Staging,OU=Firm,DC=brightwaterlaw,DC=test' -Server brightwaterlaw.test");
  assert.ok(b.ad.users.some((u) => u.sam === 'aruiz' && u.upn === 'aruiz@brightwaterlaw.test'), 'created in Brightwater');
  assert.ok(!m.ad.users.some((u) => u.sam === 'aruiz'), 'not in Meridian');
  assert.match(run('Get-ADUser aruiz -Server brightwaterlaw.test'), /DistinguishedName\s+: CN=Ana Ruiz,OU=Staging,OU=Firm,DC=brightwaterlaw,DC=test/);
  assert.match(run('Get-ADUser aruiz -Server dc01.brightwaterlaw.test'), /SamAccountName\s+: aruiz/, 'a DC FQDN works too');
  assert.match(run('Get-ADUser aruiz'), /Cannot find an object with identity: 'aruiz'/);
});

test('-Server with an unknown domain gives the AD server-down error', () => {
  const { run } = mspShell();
  const out = run('Get-ADUser x -Server nope.test');
  assert.match(out, /Get-ADUser : Unable to contact the server\. This may be because this server does not exist, it is currently down, or it does not have the Active Directory Web Services running\./);
  assert.match(out, /CategoryInfo\s+: ResourceUnavailable: \(x:ADUser\) \[Get-ADUser\], ADServerDownException/);
  assert.match(out, /FullyQualifiedErrorId : ActiveDirectoryServer:0,Microsoft\.ActiveDirectory\.Management\.Commands\.GetADUser/);
});

test('-Server is ignored by non-AD cmdlets and a shell without a resolver stays in its own domain', () => {
  const { run } = mspShell();
  assert.doesNotMatch(run('Get-Date -Server brightwaterlaw.test'), /Unable to contact/);
  const { run: plain } = shell();
  assert.match(plain('Get-ADUser vhale -Server meridianhealth.test'), /SamAccountName\s+: vhale/);
  assert.match(plain('Get-ADUser vhale -Server brightwaterlaw.test'), /Unable to contact the server/);
});

// ---------------------------------------------------------------- review fixes (MSP stage 1)
test('review: domain cmdlets describe the company domain, not Meridian', () => {
  const { run } = mspShell();
  const dom = run('Get-ADDomain -Server brightwaterlaw.test');
  assert.match(dom, /DistinguishedName\s+: DC=brightwaterlaw,DC=test/);
  assert.match(dom, /PDCEmulator\s+: BWL-DC01\.brightwaterlaw\.test/);
  assert.doesNotMatch(dom, /meridian/i);
  assert.match(run('Get-ADDomainController -Server brightwaterlaw.test'), /HostName\s+: BWL-DC01\.brightwaterlaw\.test/);
  assert.doesNotMatch(run('Get-ADForest -Server brightwaterlaw.test'), /MHS-DC01/);
  assert.match(run('Get-ADComputer nope -Server brightwaterlaw.test'), /under: 'DC=brightwaterlaw,DC=test'/);
  assert.match(run("New-ADUser -Name 'Wi Fi' -SamAccountName wifi -WhatIf -Server brightwaterlaw.test"), /CN=Users,DC=brightwaterlaw,DC=test/);
});

test('review: objects piped from a company stay in that company', () => {
  const { m, b, run } = mspShell();
  run("New-ADUser -Name 'Pipe Test' -SamAccountName pipetest -Server brightwaterlaw.test");
  run("New-ADUser -Name 'Pipe Test' -SamAccountName pipetest");
  run('Get-ADUser pipetest -Server brightwaterlaw.test | Set-ADUser -Title Piped');
  assert.equal(b.ad.users.find((u) => u.sam === 'pipetest')!.title, 'Piped', 'company user changed');
  assert.notEqual(m.ad.users.find((u) => u.sam === 'pipetest')!.title, 'Piped', 'Meridian user untouched');
  run("Get-ADGroup SG_DMS_USERS -Server brightwaterlaw.test | Add-ADGroupMember -Members pipetest");
  assert.ok(b.ad.users.find((u) => u.sam === 'pipetest')!.memberOf.includes('SG_DMS_USERS'), 'added in the company the group came from');
  assert.ok(!m.ad.users.find((u) => u.sam === 'pipetest')!.memberOf.includes('SG_DMS_USERS'), 'Meridian user untouched');
});

// ---------------------------------------------------------------- Connect-MgGraph -TenantId (stage 3b)
function graphShell(): { m: World; b: World; run: (s: string) => string } {
  const m = createWorld(11);
  const b = createCompanyWorld(profileById('brightwater')!);
  const sh = new Shell(m, CMDLETS);
  sh.resolveTenant = (t) => (['brightwaterlaw.test', 'brightwaterlaw.onmicrosoft.test', 'brightwater'].includes(t.toLowerCase()) ? b : undefined);
  return { m, b, run: (s) => sh.run(s).map((l) => l.text).join('\n') };
}

test('Connect-MgGraph -TenantId points Graph cmdlets at that tenant only', () => {
  const { b, run } = graphShell();
  const out = run('Connect-MgGraph -TenantId brightwaterlaw.onmicrosoft.test -NoWelcome; Get-MgContext | Select-Object -ExpandProperty Account');
  assert.match(out, /msp-admin@brightwaterlaw\.onmicrosoft\.test/);
  const users = run('Get-MgUser -All | Select-Object -ExpandProperty UserPrincipalName');
  assert.ok(users.includes(b.entra.users.find((e) => e.source === 'synced')!.upn));
  assert.doesNotMatch(users, /meridianhealth/);
  run('Disconnect-MgGraph');
  assert.match(run('Get-MgUser -Top 1'), /Authentication needed\. Please call Connect-MgGraph\./);
});

test('Connect-MgGraph to an unknown tenant fails with AADSTS90002', () => {
  const { run } = graphShell();
  assert.match(run('Connect-MgGraph -TenantId contoso.onmicrosoft.com'), /AADSTS90002: Tenant 'contoso\.onmicrosoft\.com' not found\./);
  assert.match(run('Get-MgUser -Top 1'), /Authentication needed/);
});
