import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../src/core/time.ts';
import { createWorld } from '../src/world/seed.ts';
import { CmdShell } from '../src/terminal/cmd.ts';
import { homeDir, readFile, writeFile, fileExists } from '../src/world/docs.ts';
import { setEnabled } from '../src/world/directory.ts';

let t = Date.parse('2026-10-19T14:00:00Z');
setClock(() => (t += 1000));

const shell = (seed = 5) => {
  const w = createWorld(seed);
  const asked: string[] = [];
  const sh = new CmdShell(w, { powershell: (c) => [{ text: `PS:${c}` }], ask: (p) => { asked.push(p); return 'typed'; } });
  return { w, sh, asked, text: (line: string) => sh.run(line).map((l) => l.text).join('\n') };
};

test('dir, cd, type and redirection work on the virtual disk', () => {
  const { w, sh, text } = shell();
  assert.match(text('dir'), /Directory of C:\\Users\\admin/);
  text('cd Documents');
  assert.equal(sh.cwd, `${homeDir(w)}\\Documents`);
  text('echo first line> notes.txt');
  text('echo second line>> notes.txt');
  assert.equal(readFile(w, `${homeDir(w)}\\Documents\\notes.txt`), 'first line\r\nsecond line\r\n');
  assert.match(text('type notes.txt'), /first line\nsecond line/);
  assert.match(text('cd \\nowhere'), /cannot find the path/);
  assert.equal(text('type notes.txt | find /c "line"'), '2');
});

test('net user /domain reports the account the way Windows does', () => {
  const { w, text } = shell();
  setEnabled(w, 'vhale', false);
  const out = text('net user vhale /domain');
  assert.match(out, /User name\s+vhale/);
  assert.match(out, /Account active\s+No/);
  assert.match(out, /\*Domain Users/);
  assert.match(text('net user nobody /domain'), /could not be found/);
  assert.match(text('net group "Domain Admins" /domain'), /Members/);
  assert.match(text('whoami'), /^meridian\\admin$/);
  assert.match(text('whoami /groups'), /grp-iam-admins|Domain Users/);
});

test('a batch file runs with labels, call, if, for, set /a and arguments', () => {
  const { w, sh, asked } = shell();
  const path = `${homeDir(w)}\\Desktop\\check.bat`;
  writeFile(w, path, [
    '@echo off',
    'setlocal enabledelayedexpansion',
    'set COUNT=0',
    'for /L %%i in (1,1,3) do (',
    '  set /a COUNT+=%%i',
    ')',
    'echo Total: !COUNT!',
    'if "%~1"=="vhale" (echo Checking %1) else (echo No user given)',
    'call :greet Admin',
    'net user %1 /domain | find "Account active"',
    'if exist "%USERPROFILE%\\Desktop\\check.bat" echo found myself',
    'set /p REASON=Reason: ',
    'echo Reason was %REASON%',
    'goto :eof',
    ':greet',
    'echo Hello %1',
    'exit /b 0',
  ].join('\r\n'));
  const out = sh.runBatch(path, [path, 'vhale']).map((l) => l.text);
  assert.ok(out.includes('Total: 6'), out.join('\n'));
  assert.ok(out.includes('Checking vhale'));
  assert.ok(out.includes('Hello Admin'));
  assert.ok(out.some((l) => /Account active\s+Yes/.test(l)));
  assert.ok(out.includes('found myself'));
  assert.ok(out.includes('Reason was typed'));
  assert.deepEqual(asked.map((a) => a.trim()), ['Reason:']);
});

test('errors, && and || and unknown commands behave like cmd.exe', () => {
  const { w, text } = shell();
  assert.match(text('frobnicate'), /is not recognized as an internal or external command/);
  assert.equal(text('cd nowhere 2>nul || echo failed'), 'failed');
  assert.equal(text('echo ok && echo also'), 'ok\nalso');
  text('md Reports');
  assert.match(text('dir /b'), /Reports/);
  text('echo x> Reports\\a.txt');
  assert.ok(fileExists(w, `${homeDir(w)}\\Reports\\a.txt`));
  assert.match(text('powershell -Command Get-Date'), /^PS:Get-Date$/);
});
