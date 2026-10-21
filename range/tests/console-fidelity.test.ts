/**
 * The PowerShell console answers the way Windows PowerShell 5.1 does: error
 * records with CategoryInfo and FullyQualifiedErrorId, a prompt for a missing
 * mandatory parameter, help for every command, and the Windows programs
 * (tasklist, net, whoami) a workstation has.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { Shell } from '../src/terminal/shell.ts';
import { CMDLETS } from '../src/terminal/cmdlets.ts';

let t = Date.parse('2026-10-20T20:00:00Z');
setClock(() => (t += 1000));

function shell(): { sh: Shell; run: (s: string) => string } {
  const sh = new Shell(createWorld(5), CMDLETS);
  return { sh, run: (s) => sh.run(s).map((l) => l.text).join('\n') };
}

test('an unknown command gives the PowerShell CommandNotFoundException record', () => {
  const out = shell().run('taskinfo');
  assert.match(out, /^taskinfo : The term 'taskinfo' is not recognized as the name of a cmdlet, function, script file, or operable program\. Check the spelling/);
  assert.match(out, /\+ CategoryInfo {10}: ObjectNotFound: \(taskinfo:String\) \[\], CommandNotFoundException/);
  assert.match(out, /\+ FullyQualifiedErrorId : CommandNotFoundException$/m);
  assert.doesNotMatch(out, /ADIdentityNotFoundException|this range/);
});

test('Get-Command with a name that does not exist is an error, not silence', () => {
  const out = shell().run('Get-Command to list cmdlets');
  assert.match(out, /^Get-Command : The term 'to' is not recognized/);
  assert.match(out, /CommandNotFoundException,Microsoft\.PowerShell\.Commands\.GetCommandCommand/);
});

test('a missing mandatory parameter is prompted for, as at a real console', () => {
  const { sh, run } = shell();
  const first = run('Get-ADUser');
  assert.match(first, /cmdlet Get-ADUser at command pipeline position 1\nSupply values for the following parameters:\n\(Type !\? for Help\.\)/);
  assert.deepEqual(sh.pendingPrompt && { cmd: sh.pendingPrompt.cmd, param: sh.pendingPrompt.param }, { cmd: 'Get-ADUser', param: 'Filter' });
  const answered = sh.answerPrompt("SamAccountName -eq 'vhale'").map((l) => l.text).join('\n');
  assert.match(answered, /SamAccountName\s+: vhale/);
  assert.equal(sh.pendingPrompt, null);
  run('Get-ADUser');
  const cancelled = sh.answerPrompt('').map((l) => l.text).join('\n');
  assert.match(cancelled, /^Get-ADUser : Cannot process command because of one or more missing mandatory parameters: Filter\./);
  assert.match(cancelled, /InvalidArgument: \(:\) \[Get-ADUser\], ParameterBindingException/);
  assert.match(cancelled, /MissingMandatoryParameter,Microsoft\.ActiveDirectory\.Management\.Commands\.GetADUser/);
});

test('inside an assignment or a script the missing parameter is an error, not a prompt', () => {
  const { sh, run } = shell();
  assert.match(run('$u = Get-ADUser'), /MissingMandatoryParameter/);
  assert.equal(sh.pendingPrompt, null);
});

test('AD errors carry the ActiveDirectory exception and error id', () => {
  const { run } = shell();
  const nf = run('Get-ADUser nobody');
  assert.match(nf, /ObjectNotFound: \(:\) \[Get-ADUser\], ADIdentityNotFoundException/);
  assert.match(nf, /ActiveDirectoryCmdlet:Microsoft\.ActiveDirectory\.Management\.ADIdentityNotFoundException,Microsoft\.ActiveDirectory\.Management\.Commands\.GetADUser/);
  assert.match(run('Get-ADUser -Bogus 1'), /NamedParameterNotFound,Microsoft\.ActiveDirectory\.Management\.Commands\.GetADUser/);
});

test('help lists every command; Get-Help shows syntax, parameters and an example', () => {
  const { run } = shell();
  const all = run('help');
  for (const d of CMDLETS) assert.ok(all.includes(d.name), `help lists ${d.name}`);
  assert.match(all, /ACTIVE DIRECTORY[\s\S]*WINDOWS PROGRAMS[\s\S]*MORE HELP/);
  const one = run('Get-Help Get-ADUser');
  for (const part of ['NAME', 'SYNOPSIS', 'SYNTAX', 'PARAMETERS', '-Identity <Object>', 'EXAMPLE', 'REMARKS']) assert.ok(one.includes(part), part);
  assert.match(run('help *group*'), /Get-ADGroupMember/);
  assert.match(run('Get-Help Get-Nothing'), /HelpNotFound/);
});

test('Windows programs run in PowerShell as they do in Command Prompt', () => {
  const { run } = shell();
  assert.match(run('tasklist | findstr chrome'), /^chrome\.exe\s+\d+/);
  assert.equal(run('whoami'), 'meridian\\adm-admin');
  assert.equal(run('whoami /upn'), 'adm-admin@meridianhealth.test');
  assert.match(run('net user vhale /domain'), /Full Name\s+Victor Hale[\s\S]*The command completed successfully/);
  assert.match(run('ping MHS-DC01'), /Reply from 10\.10\.0\.10/);
  assert.match(run('systeminfo'), /Domain:\s+meridianhealth\.test/);
  assert.match(run('where.exe ping'), /C:\\Windows\\System32\\ping\.exe/);
  assert.match(run('Get-Command tasklist'), /Application\s+tasklist\.exe/);
  assert.match(run('Get-Service | Select-String Netlogon'), /Netlogon/);
});

test('PowerShell tries the Get- verb, and dates print as PowerShell prints them', () => {
  const { run } = shell();
  assert.match(run('date'), /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \w+ \d{1,2}, \d{4} \d{1,2}:\d{2}:\d{2} [AP]M$/);
  assert.doesNotMatch(run("Get-ADUser vhale -Properties whenCreated | Select-Object whenCreated"), /\d{4}, \d/);
});

test('object GUIDs are well formed', () => {
  const out = shell().run("Get-ADUser -Filter *");
  for (const g of out.match(/ObjectGUID\s+: (\S+)/g) ?? []) assert.match(g, /: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
