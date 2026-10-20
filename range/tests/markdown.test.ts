import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headings, parseInline, parseMarkdown, safeHref, type Block } from '../src/core/markdown.ts';
import { createWorld } from '../src/world/seed.ts';

test('headings, paragraphs and inline formatting', () => {
  const b = parseMarkdown('# Title\n\nSome **bold**, *italic*, ~~gone~~ and `Get-ADUser` text.\nSecond line.\n\nSetext\n======\n');
  assert.equal(b[0]!.t, 'h');
  assert.deepEqual(b[0], { t: 'h', level: 1, id: 'title', c: [{ t: 'text', v: 'Title' }] });
  assert.deepEqual(b[1], { t: 'p', c: [
    { t: 'text', v: 'Some ' }, { t: 'strong', c: [{ t: 'text', v: 'bold' }] }, { t: 'text', v: ', ' },
    { t: 'em', c: [{ t: 'text', v: 'italic' }] }, { t: 'text', v: ', ' }, { t: 'del', c: [{ t: 'text', v: 'gone' }] },
    { t: 'text', v: ' and ' }, { t: 'code', v: 'Get-ADUser' }, { t: 'text', v: ' text. Second line.' }] });
  assert.equal((b[2] as Extract<Block, { t: 'h' }>).level, 1);
  assert.deepEqual(parseInline('snake_case_name and a * b'), [{ t: 'text', v: 'snake_case_name and a * b' }]);
  assert.deepEqual(parseInline('a\\*b'), [{ t: 'text', v: 'a*b' }]);
});

test('lists, nested lists, task lists and ordered starts', () => {
  const b = parseMarkdown('- one\n- two\n  - nested\n- [x] done\n- [ ] open\n\n3. three\n4. four\n');
  const ul = b[0] as Extract<Block, { t: 'list' }>;
  assert.equal(ul.ordered, false);
  assert.equal(ul.items.length, 4);
  assert.equal((ul.items[1]!.blocks[1] as Extract<Block, { t: 'list' }>).items.length, 1, 'nested list under item two');
  assert.deepEqual([ul.items[2]!.task, ul.items[2]!.checked, ul.items[3]!.checked], [true, true, false]);
  const ol = b[1] as Extract<Block, { t: 'list' }>;
  assert.deepEqual([ol.ordered, ol.start, ol.items.length], [true, 3, 2]);
});

test('tables with alignment, code fences, quotes and rules', () => {
  const b = parseMarkdown('| Group | Tier |\n|:---|---:|\n| grp-IT | `1` |\n| a \\| b | 2 |\n\n```powershell\nGet-ADUser -Filter *\n  # kept indent\n```\n\n> **Note**\n> quoted\n\n---\n');
  const t = b[0] as Extract<Block, { t: 'table' }>;
  assert.deepEqual(t.align, ['left', 'right']);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[1]![0], [{ t: 'text', v: 'a | b' }]);
  assert.deepEqual(b[1], { t: 'code', lang: 'powershell', v: 'Get-ADUser -Filter *\n  # kept indent' });
  assert.equal(b[2]!.t, 'quote');
  assert.equal(b[3]!.t, 'hr');
});

test('links, images and autolinks', () => {
  assert.deepEqual(parseInline('See [the SOP](JML-Standard-Operating-Procedure.md#leavers) or https://learn.microsoft.com.'), [
    { t: 'text', v: 'See ' }, { t: 'link', href: 'JML-Standard-Operating-Procedure.md#leavers', c: [{ t: 'text', v: 'the SOP' }] },
    { t: 'text', v: ' or ' }, { t: 'link', href: 'https://learn.microsoft.com', c: [{ t: 'text', v: 'https://learn.microsoft.com' }] }, { t: 'text', v: '.' }]);
  assert.deepEqual(parseInline('![logo](img.png)'), [{ t: 'img', src: 'img.png', alt: 'logo' }]);
});

test('raw HTML stays text, and unsafe link schemes are refused', () => {
  const b = parseMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))');
  assert.deepEqual(b[0], { t: 'p', c: [{ t: 'text', v: '<script>alert(1)</script>' }] });
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///c:/x']) assert.equal(safeHref(bad), null, bad);
  assert.deepEqual(safeHref('https://example.invalid'), { kind: 'web', target: 'https://example.invalid' });
  assert.deepEqual(safeHref('#leavers'), { kind: 'anchor', target: 'leavers' });
  assert.deepEqual(safeHref('AD-Naming-Standard.md'), { kind: 'file', target: 'AD-Naming-Standard.md' });
  assert.deepEqual(safeHref('C:\\Users\\admin\\notes.md'), { kind: 'file', target: 'C:\\Users\\admin\\notes.md' });
});

test('duplicate headings get unique anchors, and every policy document parses', () => {
  assert.deepEqual(headings(parseMarkdown('## Steps\n## Steps\n### Access & Approval')).map((x) => x.id), ['steps', 'steps-1', 'access--approval']);
  const docs = createWorld(1).files.filter((f) => /\.md$/i.test(f.path));
  assert.ok(docs.length >= 3);
  for (const f of docs) assert.ok(headings(parseMarkdown(f.content)).length > 0, `${f.path} has headings`);
});
