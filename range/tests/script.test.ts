import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { Shell } from '../src/terminal/shell.ts';
import { CMDLETS } from '../src/terminal/cmdlets.ts';

setClock(() => Date.parse('2026-10-19T14:00:00Z'));

test('scripts: functions, param, try/catch, loops, -f, static calls', () => {
  const sh = new Shell(createWorld(3), CMDLETS);
  const run = (s: string): string => sh.run(s).map((l) => l.text).join('\n');
  assert.equal(run("function Add-Two { param([int]$A, $B = 2) return $A + $B }\nAdd-Two -A 5"), '7');
  assert.equal(run('"{0}-{1:D3}" -f "LAB", 7'), 'LAB-007');
  assert.equal(run("try { Get-ADUser nobody -ErrorAction Stop; throw 'x' } catch { 'caught: ' + $_.Exception.Message }").startsWith('caught: '), true);
  assert.equal(run('$i = 0; while ($true) { $i++; if ($i -ge 3) { break } }; $i'), '3');
  assert.equal(run("[string]::IsNullOrWhiteSpace('  ')"), 'True');
  assert.equal(run("$x = 1; if ($x -eq 2) { 'a' } elseif ($x -eq 1) { 'b' } else { 'c' }"), 'b');
  assert.equal(run('$t = 0; foreach ($n in 1,2,3) { $t += $n }; $t'), '6');
  assert.equal(([...run('[System.Web.Security.Membership]::GeneratePassword(14,2)')].length), 14);
});
