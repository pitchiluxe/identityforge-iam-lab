/**
 * core/notepadpp.ts — the text engine behind Notepad++ (ui/apps/notepadpp.ts).
 *
 * Pure: languages and their lexers (tokens rebuild the line exactly, so the
 * editor can draw them as coloured spans under a transparent textarea), the
 * Find/Replace modes (Normal, Extended, Regular expression), Edit > Line
 * Operations, Ctrl+Q comments, MIME Tools Base64 and the Encoding menu.
 */

export type Lang = 'normal' | 'powershell' | 'batch' | 'json' | 'markdown' | 'xml' | 'html' | 'ini' | 'javascript';
export type TokKind = 'plain' | 'kw' | 'cmd' | 'param' | 'var' | 'str' | 'num' | 'com' | 'op' | 'tag' | 'attr' | 'key' | 'sec' | 'lbl' | 'head' | 'em';
export interface Token { k: TokKind; v: string }

/** Language menu name, status-bar description, extensions and line comment. */
export const LANGS: Record<Lang, { name: string; status: string; ext: string[]; comment?: string }> = {
  normal: { name: 'None (Normal Text)', status: 'Normal text file', ext: ['txt', 'log', 'csv'] },
  powershell: { name: 'PowerShell', status: 'PowerShell file', ext: ['ps1', 'psm1', 'psd1'], comment: '#' },
  batch: { name: 'Batch', status: 'Batch file', ext: ['bat', 'cmd', 'nt'], comment: 'REM ' },
  json: { name: 'JSON', status: 'JSON file', ext: ['json'] },
  markdown: { name: 'Markdown', status: 'Markdown file', ext: ['md', 'markdown'] },
  xml: { name: 'XML', status: 'eXtensible Markup Language file', ext: ['xml', 'config', 'xsd', 'xaml', 'svg', 'manifest'] },
  html: { name: 'HTML', status: 'Hyper Text Markup Language file', ext: ['html', 'htm'] },
  ini: { name: 'ini file', status: 'MS ini file', ext: ['ini', 'inf', 'cfg', 'url'], comment: ';' },
  javascript: { name: 'JavaScript', status: 'JavaScript file', ext: ['js', 'mjs', 'ts'], comment: '//' },
};

export function languageFor(path: string): Lang {
  const m = /\.([^.\\/]+)$/.exec(path);
  if (!m) return 'normal';
  const ext = m[1]!.toLowerCase();
  return (Object.keys(LANGS) as Lang[]).find((l) => LANGS[l].ext.includes(ext)) ?? 'normal';
}

// ------------------------------------------------------------------ lexers

const PS_KEYWORDS = new Set('begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using while'.split(' '));
const PS_OPS = /^-(eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|and|or|not|xor|replace|split|join|is|isnot|as|f|band|bor|ieq|ceq|ilike|clike)\b/i;
const BAT_KEYWORDS = new Set('call cd chdir cls copy del dir echo else endlocal erase exist exit for goto if in md mkdir move not pause popd pushd rd ren rename rmdir set setlocal shift start title type ver do defined errorlevel'.split(' '));
const JS_KEYWORDS = new Set('async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null return switch this throw true try typeof undefined var void while yield'.split(' '));

type State = { inBlock: boolean };

function lexPowerShell(line: string, st: State): Token[] {
  const out: Token[] = [];
  let i = 0;
  const push = (k: TokKind, v: string): void => { const last = out[out.length - 1]; if (last && last.k === k && k === 'plain') last.v += v; else out.push({ k, v }); };
  while (i < line.length) {
    const rest = line.slice(i);
    if (st.inBlock) {
      const end = rest.indexOf('#>');
      if (end < 0) { push('com', rest); return out; }
      push('com', rest.slice(0, end + 2)); i += end + 2; st.inBlock = false; continue;
    }
    if (rest.startsWith('<#')) { st.inBlock = true; continue; }
    let m: RegExpExecArray | null;
    if (rest[0] === '#') { push('com', rest); break; }
    if ((m = /^'(?:[^']|'')*'?/.exec(rest)) || (m = /^"(?:[^"`]|`.)*"?/.exec(rest))) { push('str', m[0]); i += m[0].length; continue; }
    if ((m = /^\$(?:\{[^}]*\}|[\w:?^$]+)/.exec(rest))) { push('var', m[0]); i += m[0].length; continue; }
    if ((m = PS_OPS.exec(rest)) && (i === 0 || /[\s(]/.test(line[i - 1]!))) { push('op', m[0]); i += m[0].length; continue; }
    if ((m = /^-[A-Za-z][\w]*/.exec(rest)) && (i === 0 || /\s/.test(line[i - 1]!))) { push('param', m[0]); i += m[0].length; continue; }
    if ((m = /^\[[A-Za-z_][\w.]*(\[\])?\]/.exec(rest))) { push('kw', m[0]); i += m[0].length; continue; }
    if ((m = /^[A-Za-z]+-[A-Za-z][\w]*/.exec(rest)) && (i === 0 || /[\s(|;{=]/.test(line[i - 1]!))) { push('cmd', m[0]); i += m[0].length; continue; }
    if ((m = /^\d+(\.\d+)?(kb|mb|gb)?\b/i.exec(rest)) && (i === 0 || !/\w/.test(line[i - 1]!))) { push('num', m[0]); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_]\w*/.exec(rest))) { push(PS_KEYWORDS.has(m[0].toLowerCase()) ? 'kw' : 'plain', m[0]); i += m[0].length; continue; }
    if (/^[=+*/%|{}()[\];,!<>]/.test(rest)) { push('op', rest[0]!); i += 1; continue; }
    push('plain', rest[0]!); i += 1;
  }
  return out;
}

function lexBatch(line: string): Token[] {
  const out: Token[] = [];
  const push = (k: TokKind, v: string): void => { const last = out[out.length - 1]; if (last && last.k === k && k === 'plain') last.v += v; else out.push({ k, v }); };
  const lead = /^\s*/.exec(line)![0];
  const body = line.slice(lead.length);
  if (lead) push('plain', lead);
  if (/^(rem\b|::)/i.test(body)) { push('com', body); return out; }
  if (/^:\w/.test(body)) { push('lbl', body); return out; }
  let i = lead.length;
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^(%~?[\w]*%|%%?~?[A-Za-z0-9]|![\w]+!)/.exec(rest))) { push('var', m[0]); i += m[0].length; continue; }
    if ((m = /^"[^"]*"?/.exec(rest))) { push('str', m[0]); i += m[0].length; continue; }
    if ((m = /^@?[A-Za-z]\w*/.exec(rest))) { push(BAT_KEYWORDS.has(m[0].replace(/^@/, '').toLowerCase()) && (i === 0 || !/\w/.test(line[i - 1]!)) ? 'kw' : 'plain', m[0]); i += m[0].length; continue; }
    if (/^[&|<>()]/.test(rest)) { push('op', rest[0]!); i += 1; continue; }
    push('plain', rest[0]!); i += 1;
  }
  return out;
}

function lexJson(line: string): Token[] {
  const out: Token[] = [];
  const push = (k: TokKind, v: string): void => { const last = out[out.length - 1]; if (last && last.k === k && k === 'plain') last.v += v; else out.push({ k, v }); };
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^"(?:[^"\\]|\\.)*"?/.exec(rest))) { push(/^\s*:/.test(rest.slice(m[0].length)) ? 'key' : 'str', m[0]); i += m[0].length; continue; }
    if ((m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest))) { push('num', m[0]); i += m[0].length; continue; }
    if ((m = /^(true|false|null)\b/.exec(rest))) { push('kw', m[0]); i += m[0].length; continue; }
    if (/^[{}[\]:,]/.test(rest)) { push('op', rest[0]!); i += 1; continue; }
    push('plain', rest[0]!); i += 1;
  }
  return out;
}

function lexMarkup(line: string, st: State): Token[] {
  const out: Token[] = [];
  const push = (k: TokKind, v: string): void => { const last = out[out.length - 1]; if (last && last.k === k && k === 'plain') last.v += v; else out.push({ k, v }); };
  let i = 0;
  let inTag = false;
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpExecArray | null;
    if (st.inBlock) {
      const end = rest.indexOf('-->');
      if (end < 0) { push('com', rest); return out; }
      push('com', rest.slice(0, end + 3)); i += end + 3; st.inBlock = false; continue;
    }
    if (!inTag && rest.startsWith('<!--')) { st.inBlock = true; continue; }
    if (!inTag && (m = /^<\/?[!?]?[\w:.-]*/.exec(rest)) && m[0].length > 1) { push('tag', m[0]); i += m[0].length; inTag = true; continue; }
    if (inTag) {
      if ((m = /^\/?\??>/.exec(rest))) { push('tag', m[0]); i += m[0].length; inTag = false; continue; }
      if ((m = /^"[^"]*"?|^'[^']*'?/.exec(rest))) { push('str', m[0]); i += m[0].length; continue; }
      if ((m = /^[\w:.-]+/.exec(rest))) { push('attr', m[0]); i += m[0].length; continue; }
      if (rest[0] === '=') { push('op', '='); i += 1; continue; }
    }
    if ((m = /^&\w+;/.exec(rest))) { push('kw', m[0]); i += m[0].length; continue; }
    push('plain', rest[0]!); i += 1;
  }
  return out;
}

function lexIni(line: string): Token[] {
  const lead = /^\s*/.exec(line)![0];
  const body = line.slice(lead.length);
  const pre: Token[] = lead ? [{ k: 'plain', v: lead }] : [];
  if (/^[;#]/.test(body)) return [...pre, { k: 'com', v: body }];
  if (/^\[/.test(body)) return [...pre, { k: 'sec', v: body }];
  const eq = body.indexOf('=');
  if (eq > 0) return [...pre, { k: 'key', v: body.slice(0, eq) }, { k: 'op', v: '=' }, ...(body.length > eq + 1 ? [{ k: 'plain' as TokKind, v: body.slice(eq + 1) }] : [])];
  return body ? [...pre, { k: 'plain', v: body }] : pre;
}

function lexMarkdown(line: string, st: State): Token[] {
  if (/^\s*(```|~~~)/.test(line)) { st.inBlock = !st.inBlock; return [{ k: 'str', v: line }]; }
  if (st.inBlock) return line ? [{ k: 'str', v: line }] : [];
  if (/^#{1,6}\s/.test(line)) return [{ k: 'head', v: line }];
  if (/^\s*>/.test(line)) return [{ k: 'com', v: line }];
  const out: Token[] = [];
  const push = (k: TokKind, v: string): void => { const last = out[out.length - 1]; if (last && last.k === k && k === 'plain') last.v += v; else out.push({ k, v }); };
  let i = 0;
  const bullet = /^(\s*)([-*+]|\d+\.)(\s)/.exec(line);
  if (bullet) { if (bullet[1]) push('plain', bullet[1]); push('op', bullet[2]!); i = bullet[1]!.length + bullet[2]!.length; }
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^`[^`]*`/.exec(rest))) { push('str', m[0]); i += m[0].length; continue; }
    if ((m = /^(\*\*|__)[^*_]+\1/.exec(rest)) || (m = /^(\*|_)[^*_\s][^*_]*\1/.exec(rest))) { push('em', m[0]); i += m[0].length; continue; }
    if ((m = /^!?\[[^\]]*\]\([^)]*\)/.exec(rest))) { push('attr', m[0]); i += m[0].length; continue; }
    push('plain', rest[0]!); i += 1;
  }
  return out;
}

function lexJs(line: string, st: State): Token[] {
  const out: Token[] = [];
  const push = (k: TokKind, v: string): void => { const last = out[out.length - 1]; if (last && last.k === k && k === 'plain') last.v += v; else out.push({ k, v }); };
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpExecArray | null;
    if (st.inBlock) {
      const end = rest.indexOf('*/');
      if (end < 0) { push('com', rest); return out; }
      push('com', rest.slice(0, end + 2)); i += end + 2; st.inBlock = false; continue;
    }
    if (rest.startsWith('/*')) { st.inBlock = true; continue; }
    if (rest.startsWith('//')) { push('com', rest); break; }
    if ((m = /^(["'`])(?:(?!\1)[^\\]|\\.)*\1?/.exec(rest))) { push('str', m[0]); i += m[0].length; continue; }
    if ((m = /^\d+(\.\d+)?/.exec(rest)) && (i === 0 || !/\w/.test(line[i - 1]!))) { push('num', m[0]); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_$][\w$]*/.exec(rest))) { push(JS_KEYWORDS.has(m[0]) ? 'kw' : 'plain', m[0]); i += m[0].length; continue; }
    if (/^[=+\-*/%|&{}()[\];,!<>?:.]/.test(rest)) { push('op', rest[0]!); i += 1; continue; }
    push('plain', rest[0]!); i += 1;
  }
  return out;
}

/** Tokens per line. Joining every token's text with "\n" between lines gives back the input. */
export function tokenize(text: string, lang: Lang): Token[][] {
  const st: State = { inBlock: false };
  return text.split('\n').map((line) => {
    switch (lang) {
      case 'powershell': return lexPowerShell(line, st);
      case 'batch': return lexBatch(line);
      case 'json': return lexJson(line);
      case 'xml': case 'html': return lexMarkup(line, st);
      case 'ini': return lexIni(line);
      case 'markdown': return lexMarkdown(line, st);
      case 'javascript': return lexJs(line, st);
      default: return line ? [{ k: 'plain', v: line }] : [];
    }
  });
}

// ------------------------------------------------------------------ find / replace

export type SearchMode = 'normal' | 'extended' | 'regex';
export interface FindOpts { matchCase: boolean; wholeWord: boolean; mode: SearchMode }
export interface Range { start: number; end: number }

/** Extended mode: \n \r \t \0 \\ \xHH as Notepad++ reads them. */
export function expandExtended(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|[nrt0\\])/g, (_m, c: string) => (c[0] === 'x' ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\' } as Record<string, string>)[c]!));
}

function buildRegex(query: string, o: FindOpts): RegExp {
  let src = o.mode === 'regex' ? query : (o.mode === 'extended' ? expandExtended(query) : query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) src = `(?<![\\w])(?:${src})(?![\\w])`;
  try {
    return new RegExp(src, `g${o.matchCase ? '' : 'i'}${o.mode === 'regex' ? 'm' : ''}`);
  } catch {
    throw new Error('Find: Invalid Regular Expression');
  }
}

export function findAll(text: string, query: string, o: FindOpts): Range[] {
  if (!query) return [];
  const re = buildRegex(query, o);
  const out: Range[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0] === '') { re.lastIndex += 1; continue; }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Next match after `from` (or the last before it, going up), wrapping round if asked. */
export function findNext(text: string, query: string, from: number, o: FindOpts, dir: { backward: boolean; wrap: boolean }): Range | null {
  const all = findAll(text, query, o);
  if (!all.length) return null;
  if (dir.backward) {
    const before = all.filter((r) => r.end < from || (r.end <= from && r.start < from));
    return before[before.length - 1] ?? (dir.wrap ? all[all.length - 1]! : null);
  }
  return all.find((r) => r.start >= from) ?? (dir.wrap ? all[0]! : null);
}

export function replaceAll(text: string, query: string, replacement: string, o: FindOpts): { text: string; count: number } {
  if (!query) return { text, count: 0 };
  const re = buildRegex(query, o);
  let count = 0;
  const rep = o.mode === 'extended' ? expandExtended(replacement) : replacement;
  const out = text.replace(re, (...args: unknown[]) => {
    count++;
    if (o.mode !== 'regex') return rep;
    const groups = args.slice(1, -2) as (string | undefined)[];
    return rep.replace(/[\\$](\d)/g, (_m, d: string) => (d === '0' ? String(args[0]) : groups[Number(d) - 1] ?? ''));
  });
  return { text: out, count };
}

// ------------------------------------------------------------------ line operations

export type LineOp = 'duplicate' | 'delete' | 'moveUp' | 'moveDown' | 'sortAsc' | 'sortDesc' | 'removeEmpty' | 'trimTrailing' | 'upper' | 'lower' | 'join';
export interface Edit { text: string; selStart: number; selEnd: number }

function lineSpan(text: string, selStart: number, selEnd: number): { first: number; last: number; lines: string[] } {
  const lines = text.split('\n');
  const lineAt = (pos: number): number => text.slice(0, pos).split('\n').length - 1;
  const first = lineAt(selStart);
  let last = lineAt(selEnd);
  if (selEnd > selStart && last > first && text[selEnd - 1] === '\n') last--;
  return { first, last, lines };
}
const offsetOf = (lines: string[], line: number): number => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);

export function lineOp(text: string, selStart: number, selEnd: number, op: LineOp): Edit {
  if (op === 'upper' || op === 'lower') {
    const mid = text.slice(selStart, selEnd);
    return { text: text.slice(0, selStart) + (op === 'upper' ? mid.toUpperCase() : mid.toLowerCase()) + text.slice(selEnd), selStart, selEnd };
  }
  if (op === 'removeEmpty') { const t = text.split('\n').filter((l) => l.trim() !== '').join('\n'); return { text: t, selStart: Math.min(selStart, t.length), selEnd: Math.min(selStart, t.length) }; }
  if (op === 'trimTrailing') { const t = text.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n'); return { text: t, selStart: Math.min(selStart, t.length), selEnd: Math.min(selStart, t.length) }; }
  const { first, last, lines } = lineSpan(text, selStart, selEnd);
  const block = lines.slice(first, last + 1);
  const caretCol = selStart - offsetOf(lines, first);
  const rebuild = (next: string[], caretLine: number, keepSel = false): Edit => {
    const t = next.join('\n');
    const s = offsetOf(next, caretLine) + Math.min(caretCol, next[caretLine]?.length ?? 0);
    return keepSel ? { text: t, selStart: offsetOf(next, caretLine), selEnd: offsetOf(next, caretLine) + next.slice(caretLine, caretLine + block.length).join('\n').length } : { text: t, selStart: s, selEnd: s };
  };
  switch (op) {
    case 'duplicate': return rebuild([...lines.slice(0, last + 1), ...block, ...lines.slice(last + 1)], first);
    case 'delete': { const next = [...lines.slice(0, first), ...lines.slice(last + 1)]; if (!next.length) next.push(''); return rebuild(next, Math.min(first, next.length - 1)); }
    case 'moveUp': if (first === 0) return { text, selStart, selEnd }; return rebuild([...lines.slice(0, first - 1), ...block, lines[first - 1]!, ...lines.slice(last + 1)], first - 1);
    case 'moveDown': if (last >= lines.length - 1) return { text, selStart, selEnd }; return rebuild([...lines.slice(0, first), lines[last + 1]!, ...block, ...lines.slice(last + 2)], first + 1);
    case 'sortAsc': case 'sortDesc': {
      const sorted = [...block].sort((a, b) => a.localeCompare(b));
      if (op === 'sortDesc') sorted.reverse();
      return rebuild([...lines.slice(0, first), ...sorted, ...lines.slice(last + 1)], first, true);
    }
    case 'join': {
      const joined = block.map((l, i) => (i ? l.trimStart() : l)).join(' ');
      return rebuild([...lines.slice(0, first), joined, ...lines.slice(last + 1)], first);
    }
  }
}

/** Ctrl+Q: comment the selected lines with the language's line comment, or uncomment them. */
export function toggleComment(text: string, selStart: number, selEnd: number, lang: Lang): Edit {
  const c = LANGS[lang].comment;
  if (!c) return { text, selStart, selEnd };
  const { first, last, lines } = lineSpan(text, selStart, selEnd);
  const tag = c.trim().toLowerCase();
  const block = lines.slice(first, last + 1);
  const commented = block.filter((l) => l.trim()).every((l) => l.trimStart().toLowerCase().startsWith(tag));
  const next = block.map((l) => {
    if (!l.trim()) return l;
    if (!commented) return c + l;
    const lead = /^\s*/.exec(l)![0];
    const body = l.slice(lead.length);
    return lead + body.slice(body.toLowerCase().startsWith(c.toLowerCase()) ? c.length : tag.length);
  });
  const all = [...lines.slice(0, first), ...next, ...lines.slice(last + 1)];
  const delta = next[0]!.length - block[0]!.length;
  const s = Math.max(offsetOf(all, first), selStart + delta);
  return { text: all.join('\n'), selStart: s, selEnd: s + (selEnd - selStart) };
}

// ------------------------------------------------------------------ MIME Tools and encodings

export function base64Encode(s: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Decodes standard or URL-safe Base64 (JWT segments too); null when it is not Base64. */
export function base64Decode(s: string): string | null {
  const clean = s.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  const padded = clean.replace(/=+$/, '').padEnd(Math.ceil(clean.replace(/=+$/, '').length / 4) * 4, '=');
  try {
    const bin = atob(padded);
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

export type Encoding = 'UTF-8' | 'UTF-8-BOM' | 'ANSI';
export const ENCODINGS: Encoding[] = ['ANSI', 'UTF-8', 'UTF-8-BOM'];

export function detectEncoding(content: string): { encoding: Encoding; text: string } {
  return content.startsWith('﻿') ? { encoding: 'UTF-8-BOM', text: content.slice(1) } : { encoding: 'UTF-8', text: content };
}

/** Windows-1252 holds Latin-1 plus these; anything else becomes "?" in ANSI. */
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function encodeFor(text: string, enc: Encoding): string {
  if (enc === 'UTF-8-BOM') return `﻿${text}`;
  if (enc === 'ANSI') return Array.from(text, (ch) => (ch.charCodeAt(0) <= 0xff || CP1252_EXTRA.includes(ch) ? ch : '?')).join('');
  return text;
}

// ------------------------------------------------------------------ highlight layer

export type MarkKind = 'smart' | 'found' | 'mark';
export interface Seg { k: TokKind; v: string; mark?: MarkKind }

/** Cut a line's tokens at mark boundaries (offsets within the line) so marks can wrap the coloured text. */
export function markSegments(tokens: Token[], marks: { start: number; end: number; cls: MarkKind }[]): Seg[] {
  if (!marks.length) return tokens.map((t) => ({ k: t.k, v: t.v }));
  const cuts = new Set<number>();
  for (const m of marks) { cuts.add(m.start); cuts.add(m.end); }
  const out: Seg[] = [];
  let pos = 0;
  for (const t of tokens) {
    let i = 0;
    while (i < t.v.length) {
      let j = i + 1;
      while (j < t.v.length && !cuts.has(pos + j)) j++;
      const at = pos + i;
      const m = marks.find((x) => at >= x.start && at < x.end);
      out.push(m ? { k: t.k, v: t.v.slice(i, j), mark: m.cls } : { k: t.k, v: t.v.slice(i, j) });
      i = j;
    }
    pos += t.v.length;
  }
  return out;
}
