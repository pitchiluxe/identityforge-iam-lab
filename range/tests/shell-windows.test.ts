import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { Shell } from '../src/terminal/shell.ts';
import { CMDLETS } from '../src/terminal/cmdlets.ts';
import { CmdShell } from '../src/terminal/cmd.ts';
import { writeFile } from '../src/world/docs.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

function ps() {
  const w = createWorld(3);
  const sh = new Shell(w, CMDLETS);
  return { w, sh, run: (s: string) => sh.run(s).map((l) => l.text).join('\n') };
}
function cmd() {
  const w = createWorld(3);
  const sh = new CmdShell(w, { powershell: () => [], ask: () => '' });
  return { w, sh, run: (s: string) => sh.run(s).map((l) => l.text).join('\n') };
}

test('PowerShell: cd.. and cd\\ work as the built-in functions do on Windows', () => {
  const { sh, run } = ps();
  run('cd Documents');
  assert.match(sh.cwd, /\\Documents$/);
  assert.doesNotMatch(run('cd..'), /not recognized/);
  assert.match(sh.cwd, /^C:\\Users\\admin$/i);
  run('cd..');
  assert.match(sh.cwd, /^C:\\Users$/i);
  assert.doesNotMatch(run('cd\\'), /not recognized/);
  assert.match(sh.cwd, /^C:\\?$/i);
});

test('PowerShell: mkdir and md create a folder', () => {
  const { w, run } = ps();
  assert.doesNotMatch(run('mkdir Projects'), /not recognized/);
  assert.match(run('Test-Path C:\\Users\\admin\\Projects'), /True/);
  run('md Reports');
  assert.ok(w.files.some((f) => /\\Reports\\/i.test(f.path)));
});

test('PowerShell and cmd: calc opens the Calculator', () => {
  assert.match(ps().sh.run('calc').map((l) => l.text).join(''), /OPEN:app:calc/);
  assert.match(cmd().sh.run('calc.exe').map((l) => l.text).join(''), /OPEN:app:calc/);
});

test('cmd: vol, path, netstat, attrib, more and find answer like Windows', () => {
  const { w, run } = cmd();
  assert.match(run('vol'), /Volume in drive C has no label\.[\s\S]*Volume Serial Number is 6E2C-1A9F/);
  assert.match(run('path'), /^PATH=C:\\Windows\\system32;/m);
  assert.match(run('netstat'), /Active Connections[\s\S]*Proto\s+Local Address\s+Foreign Address\s+State/);
  writeFile(w, 'C:\\Users\\admin\\notes.txt', 'first line\nan ERROR here\nlast line\n');
  assert.match(run('attrib notes.txt'), /^A\s+C:\\Users\\admin\\notes\.txt$/m);
  assert.match(run('more notes.txt'), /first line[\s\S]*last line/);
  const f = run('find "ERROR" notes.txt');
  assert.match(f, /---------- C:\\USERS\\ADMIN\\NOTES\.TXT/);
  assert.match(f, /an ERROR here/);
  assert.doesNotMatch(f, /first line/);
});
