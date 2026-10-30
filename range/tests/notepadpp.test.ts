import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  languageFor, LANGS, tokenize, findAll, findNext, replaceAll, lineOp, toggleComment,
  base64Encode, base64Decode, detectEncoding, encodeFor, markSegments, type Lang,
} from '../src/core/notepadpp.ts';

const kinds = (text: string, lang: Lang): string => tokenize(text, lang).map((line) => line.filter((t) => t.k !== 'plain').map((t) => `${t.k}:${t.v}`).join(' ')).join(' | ');

test('notepad++: language follows the extension, like Notepad++', () => {
  assert.equal(languageFor('C:\\x\\Onboard.ps1'), 'powershell');
  assert.equal(languageFor('a.psm1'), 'powershell');
  assert.equal(languageFor('run.BAT'), 'batch');
  assert.equal(languageFor('data.json'), 'json');
  assert.equal(languageFor('README.md'), 'markdown');
  assert.equal(languageFor('web.config'), 'xml');
  assert.equal(languageFor('index.html'), 'html');
  assert.equal(languageFor('setup.ini'), 'ini');
  assert.equal(languageFor('notes.txt'), 'normal');
  assert.equal(languageFor('new 1'), 'normal');
  assert.equal(LANGS.powershell.status, 'PowerShell file');
  assert.equal(LANGS.normal.status, 'Normal text file');
});

test('notepad++: PowerShell lexer colours cmdlets, variables, strings, comments and keywords', () => {
  const out = kinds("# joiner\nif ($sam) { Get-ADUser -Identity 'jdoe' -Properties * }", 'powershell');
  assert.match(out, /^com:# joiner \|/);
  assert.match(out, /kw:if/);
  assert.match(out, /var:\$sam/);
  assert.match(out, /cmd:Get-ADUser/);
  assert.match(out, /param:-Identity/);
  assert.match(out, /str:'jdoe'/);
  // block comments carry over lines
  assert.equal(kinds('<# one\ntwo #> $x', 'powershell'), 'com:<# one | com:two #> var:$x');
});

test('notepad++: batch, JSON, XML, ini and Markdown lexers', () => {
  assert.equal(kinds('REM note\n:start\nset X=1 & echo %X%', 'batch'), 'com:REM note | lbl::start | kw:set op:& kw:echo var:%X%');
  assert.match(kinds('{"name": "jdoe", "on": true, "n": 3}', 'json'), /key:"name" .*str:"jdoe" .*kw:true .*num:3/);
  assert.match(kinds('<user id="1"><!-- c --></user>', 'xml'), /tag:<user attr:id .*str:"1" .*com:<!-- c -->/);
  assert.equal(kinds('[Groups]\n; c\nname=value', 'ini'), 'sec:[Groups] | com:; c | key:name op:=');
  assert.equal(kinds('# Title\n- item\n**bold**', 'markdown'), 'head:# Title | op:- | em:**bold**');
  assert.equal(kinds('plain words', 'normal'), '');
  // the tokens rebuild the text exactly
  const src = "Get-ADUser 'a' # x\n  $y = 2";
  assert.equal(tokenize(src, 'powershell').map((l) => l.map((t) => t.v).join('')).join('\n'), src);
});

test('notepad++: find honours match case, whole word, extended and regex modes', () => {
  const text = 'grp-all-staff\nGRP-ALL\ngrp-allstaff';
  assert.equal(findAll(text, 'grp-all', { matchCase: false, wholeWord: false, mode: 'normal' }).length, 3);
  assert.equal(findAll(text, 'grp-all', { matchCase: true, wholeWord: false, mode: 'normal' }).length, 2);
  assert.equal(findAll('cat concat cat', 'cat', { matchCase: true, wholeWord: true, mode: 'normal' }).length, 2);
  assert.deepEqual(findAll('a\tb', 'a\\tb', { matchCase: true, wholeWord: false, mode: 'extended' }), [{ start: 0, end: 3 }]);
  assert.equal(findAll('E100500 E2', 'E\\d{6}', { matchCase: true, wholeWord: false, mode: 'regex' }).length, 1);
  assert.throws(() => findAll('x', '(', { matchCase: true, wholeWord: false, mode: 'regex' }), /Invalid Regular Expression/);
  const o = { matchCase: false, wholeWord: false, mode: 'normal' as const };
  assert.deepEqual(findNext('ab ab ab', 'ab', 4, o, { backward: false, wrap: true }), { start: 6, end: 8 });
  assert.deepEqual(findNext('ab ab ab', 'ab', 8, o, { backward: false, wrap: true }), { start: 0, end: 2 }, 'wrap around');
  assert.equal(findNext('ab ab ab', 'ab', 8, o, { backward: false, wrap: false }), null);
  assert.deepEqual(findNext('ab ab ab', 'ab', 5, o, { backward: true, wrap: true }), { start: 3, end: 5 });
});

test('notepad++: Replace All counts and supports regex groups', () => {
  const r = replaceAll('jdoe,asmith,jdoe', 'jdoe', 'jdoe2', { matchCase: true, wholeWord: false, mode: 'normal' });
  assert.deepEqual(r, { text: 'jdoe2,asmith,jdoe2', count: 2 });
  const g = replaceAll('Doe, John\nSmith, Ann', '^(\\w+), (\\w+)$', '\\2 \\1', { matchCase: true, wholeWord: false, mode: 'regex' });
  assert.equal(g.text, 'John Doe\nAnn Smith');
  assert.equal(g.count, 2);
  assert.equal(replaceAll('a.b', '.', '-', { matchCase: true, wholeWord: false, mode: 'normal' }).text, 'a-b', 'normal mode is literal');
});

test('notepad++: line operations keep the caret on the moved text', () => {
  assert.deepEqual(lineOp('a\nb\nc', 2, 2, 'duplicate'), { text: 'a\nb\nb\nc', selStart: 2, selEnd: 2 });
  assert.equal(lineOp('a\nb\nc', 2, 2, 'delete').text, 'a\nc');
  assert.equal(lineOp('a\nb\nc', 2, 2, 'moveUp').text, 'b\na\nc');
  assert.equal(lineOp('a\nb\nc', 2, 2, 'moveDown').text, 'a\nc\nb');
  assert.equal(lineOp('c\na\nb', 0, 5, 'sortAsc').text, 'a\nb\nc');
  assert.equal(lineOp('c\na\nb', 0, 5, 'sortDesc').text, 'c\nb\na');
  assert.equal(lineOp('a\n\n  \nb', 0, 0, 'removeEmpty').text, 'a\nb');
  assert.equal(lineOp('a  \nb\t', 0, 0, 'trimTrailing').text, 'a\nb');
  assert.equal(lineOp('ab cd', 0, 5, 'upper').text, 'AB CD');
  assert.equal(lineOp('AB cd', 0, 2, 'lower').text, 'ab cd');
  assert.equal(lineOp('a\nb', 0, 3, 'join').text, 'a b');
});

test('notepad++: Ctrl+Q toggles the language line comment', () => {
  assert.equal(toggleComment('Get-ADUser x', 0, 0, 'powershell').text, '#Get-ADUser x');
  assert.equal(toggleComment('#Get-ADUser x', 0, 0, 'powershell').text, 'Get-ADUser x');
  assert.equal(toggleComment('echo hi', 0, 0, 'batch').text, 'REM echo hi');
  assert.equal(toggleComment('k=v', 0, 0, 'ini').text, ';k=v');
  assert.equal(toggleComment('plain', 0, 0, 'normal').text, 'plain', 'no comment syntax, unchanged');
});

test('notepad++: MIME Tools Base64 and encodings', () => {
  assert.equal(base64Encode('admin:Meridian!2026'), 'YWRtaW46TWVyaWRpYW4hMjAyNg==');
  assert.equal(base64Decode('YWRtaW46TWVyaWRpYW4hMjAyNg=='), 'admin:Meridian!2026');
  assert.equal(base64Decode(base64Encode('café ✓')), 'café ✓');
  assert.equal(base64Decode('eyJhbGciOiJSUzI1NiJ9'), '{"alg":"RS256"}', 'JWT segments decode without padding');
  assert.equal(base64Decode('!!not base64'), null);
  assert.deepEqual(detectEncoding('\uFEFFhello'), { encoding: 'UTF-8-BOM', text: 'hello' });
  assert.deepEqual(detectEncoding('hello'), { encoding: 'UTF-8', text: 'hello' });
  assert.equal(encodeFor('x', 'UTF-8-BOM'), '\uFEFFx');
  assert.equal(encodeFor('café ✓', 'ANSI'), 'café ?', 'ANSI cannot hold characters beyond Windows-1252');
});

test('notepad++: marks split coloured tokens without changing the text', () => {
  const segs = markSegments([{ k: 'cmd', v: 'Get-X' }, { k: 'plain', v: ' a' }], [{ start: 3, end: 6, cls: 'smart' }]);
  assert.deepEqual(segs, [{ k: 'cmd', v: 'Get' }, { k: 'cmd', v: '-X', mark: 'smart' }, { k: 'plain', v: ' ', mark: 'smart' }, { k: 'plain', v: 'a' }]);
  assert.deepEqual(markSegments([{ k: 'str', v: 'ab' }], []), [{ k: 'str', v: 'ab' }]);
});
