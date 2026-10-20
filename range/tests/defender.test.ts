import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanFiles } from '../src/world/defender.ts';
import type { VFile } from '../src/core/types.ts';

const f = (path: string, content: string): VFile => ({ path, content, modified: '2026-10-20T00:00:00Z', readOnly: false });

test('the scan finds test files, hacking tools and plaintext passwords, and nothing in clean files', () => {
  const files = [
    f('C:\\Users\\admin\\Downloads\\eicar.txt', 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
    f('C:\\Users\\admin\\Desktop\\tools.ps1', 'Invoke-Mimikatz -Command "sekurlsa::logonpasswords"'),
    f('C:\\Users\\admin\\Documents\\onboard.ps1', "Set-ADAccountPassword jdoe -Reset -NewPassword (ConvertTo-SecureString 'Welcome2026!' -AsPlainText -Force)"),
    f('C:\\Users\\admin\\Desktop\\clean.ps1', 'Get-ADUser -Filter * | Select-Object SamAccountName'),
    f('C:\\Users\\admin\\Desktop\\prompt.ps1', "$p = Read-Host -AsSecureString 'Password'"),
    f('C:\\Windows\\Temp\\mimikatz.txt', 'mimikatz'),
  ];
  const quick = scanFiles(files, 'quick');
  assert.deepEqual(quick.map((x) => x.name), ['Virus:DOS/EICAR_Test_File', 'HackTool:Win32/Mimikatz', 'Behavior:Script/PlaintextCredential']);
  assert.equal(scanFiles(files, 'full').length, 4, 'a full scan also covers C:\\Windows');
  assert.equal(scanFiles(files, 'quick', 'C:\\Users\\admin\\Documents').length, 1, 'a custom scan covers one folder');
  assert.equal(scanFiles([{ ...files[1]!, deleted: { from: 'x', at: 'y' } }]).length, 0, 'quarantined files are not scanned');
});
