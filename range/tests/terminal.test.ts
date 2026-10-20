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
