/**
 * core/markdown.ts — Markdown (CommonMark + GitHub tables, task lists and
 * strikethrough) parsed into a small tree. Pure: no DOM, no HTML strings.
 *
 * The viewer builds elements from this tree with textContent, so raw HTML in
 * a .md file is shown as text and can never run. Links keep their target as
 * written; deciding which ones are safe to follow is the renderer's job
 * (safeHref below).
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'img'; src: string; alt: string }
  | { t: 'br' };

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem { task: boolean; checked: boolean; blocks: Block[] }

export type Block =
  | { t: 'h'; level: number; id: string; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' };

export interface Heading { level: number; id: string; text: string }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const ATX = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (s: string): number => s.length - s.trimStart().length;
const blank = (s: string | undefined): boolean => s === undefined || s.trim() === '';

/** "Access Request & Approval" -> "access-request--approval", as GitHub makes anchors. */
export function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

export function plainText(c: Inline[]): string {
  return c.map((x) => (x.t === 'text' || x.t === 'code' ? x.v : x.t === 'img' ? x.alt : x.t === 'br' ? ' ' : plainText(x.c))).join('');
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** Does this line start a block other than a paragraph (so it ends one)? */
function startsBlock(line: string, next: string | undefined): boolean {
  return FENCE.test(line) || ATX.test(line) || HR.test(line) || QUOTE.test(line) || (LIST.test(line) && !blank(LIST.exec(line)![4])) || (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-'));
}

function parseBlocks(lines: string[], ids: Map<string, number>): Block[] {
  const out: Block[] = [];
  const heading = (level: number, raw: string): Block => {
    const c = parseInline(raw);
    const base = slug(plainText(c)) || 'section';
    const n = ids.get(base) ?? 0;
    ids.set(base, n + 1);
    return { t: 'h', level, id: n ? `${base}-${n}` : base, c };
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(line)) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1]!;
      const pad = indentOf(line);
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`).test(lines[i]!)) {
        body.push(lines[i]!.slice(Math.min(pad, indentOf(lines[i]!))));
        i++;
      }
      i++;
      out.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') });
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) { out.push(heading(atx[1]!.length, atx[2] ?? '')); i++; continue; }

    if (HR.test(line)) { out.push({ t: 'hr' }); i++; continue; }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !blank(lines[i]) && (QUOTE.test(lines[i]!) || !startsBlock(lines[i]!, lines[i + 1]))) {
        inner.push(lines[i]!.replace(QUOTE, ''));
        i++;
      }
      out.push({ t: 'quote', blocks: parseBlocks(inner, ids) });
      continue;
    }

    const next = lines[i + 1];
    if (line.includes('|') && next !== undefined && TABLE_SEP.test(next) && next.includes('-')) {
      const head = splitRow(line);
      const align: Align[] = splitRow(next).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !blank(lines[i]) && lines[i]!.includes('|')) {
        const cells = splitRow(lines[i]!);
        rows.push(head.map((_, k) => parseInline(cells[k] ?? '')));
        i++;
      }
      out.push({ t: 'table', align: head.map((_, k) => align[k] ?? null), head: head.map((c) => parseInline(c)), rows });
      continue;
    }

    const li = LIST.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]!);
      const base = li[1]!.length;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]!);
        if (!m || m[1]!.length > base + 3 || m[1]!.length < base || /\d/.test(m[2]!) !== ordered) break;
        const contentCol = m[1]!.length + m[2]!.length + Math.min(m[3]!.length || 1, 4);
        const body = [m[4]!];
        i++;
        while (i < lines.length) {
          const l = lines[i]!;
          if (blank(l)) {
            // A blank line continues the item only if indented content follows.
            if (i + 1 < lines.length && !blank(lines[i + 1]) && indentOf(lines[i + 1]!) >= contentCol) { body.push(''); i++; continue; }
            break;
          }
          if (indentOf(l) >= contentCol) { body.push(l.slice(contentCol)); i++; continue; }
          if (startsBlock(l, lines[i + 1])) break;
          body.push(l.trim()); // lazy continuation of the item's paragraph
          i++;
        }
        const task = /^\[([ xX])\]\s+/.exec(body[0]!);
        if (task) body[0] = body[0]!.slice(task[0].length);
        items.push({ task: !!task, checked: !!task && task[1] !== ' ', blocks: parseBlocks(body, ids) });
        if (blank(lines[i]) && i + 1 < lines.length && LIST.test(lines[i + 1]!) && LIST.exec(lines[i + 1]!)![1]!.length === base) i++;
      }
      out.push({ t: 'list', ordered, start: ordered ? parseInt(li[2]!, 10) : 1, items });
      continue;
    }

    // Paragraph, or a setext heading (text underlined with === or ---).
    const para: string[] = [line.trim()];
    i++;
    let setext = 0;
    while (i < lines.length && !blank(lines[i])) {
      if (/^ {0,3}=+\s*$/.test(lines[i]!)) { setext = 1; i++; break; }
      if (/^ {0,3}-+\s*$/.test(lines[i]!)) { setext = 2; i++; break; }
      if (startsBlock(lines[i]!, lines[i + 1])) break;
      para.push(lines[i]!.replace(/^ +/, ''));
      i++;
    }
    out.push(setext ? heading(setext, para.join(' ')) : { t: 'p', c: parseInline(para.join('\n')) });
  }
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  // YAML front matter is metadata, not content.
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) lines.splice(0, end + 1);
  }
  return parseBlocks(lines, new Map());
}

export function headings(blocks: Block[]): Heading[] {
  const out: Heading[] = [];
  const walk = (bs: Block[]): void => {
    for (const b of bs) {
      if (b.t === 'h') out.push({ level: b.level, id: b.id, text: plainText(b.c) });
      else if (b.t === 'quote') walk(b.blocks);
      else if (b.t === 'list') b.items.forEach((it) => walk(it.blocks));
    }
  };
  walk(blocks);
  return out;
}

// ------------------------------------------------------------------ inline

/** Find the closing delimiter, skipping code spans and escapes. */
function findClose(s: string, from: number, delim: string): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0) { i = end + run.length - 1; continue; }
    }
    if (s.startsWith(delim, i) && i > from && s[i - 1] !== ' ' && (delim.length > 1 || s[i + 1] !== delim)) {
      if (delim === '_' && /[\p{L}\p{N}]/u.test(s[i + 1] ?? '')) continue; // snake_case is not emphasis
      return i;
    }
  }
  return -1;
}

/** [text](href "title") starting at `at` (the "["). Returns text, href and the end index. */
function linkAt(s: string, at: number): { text: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let i = at; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '[') depth++;
    if (s[i] === ']' && --depth === 0) { close = i; break; }
  }
  if (close < 0 || s[close + 1] !== '(') return null;
  const end = s.indexOf(')', close + 2);
  if (end < 0) return null;
  const target = s.slice(close + 2, end).trim();
  const href = (/^<([^>]*)>/.exec(target)?.[1] ?? target.split(/\s+/)[0] ?? '');
  return { text: s.slice(at + 1, close), href, end: end + 1 };
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = (): void => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const rest = s.slice(i);
    if (ch === '\\' && i + 1 < s.length) {
      if (s[i + 1] === '\n') { flush(); out.push({ t: 'br' }); i++; continue; }
      if (/[!-/:-@[-`{-~]/.test(s[i + 1]!)) { buf += s[i + 1]; i++; continue; }
    }
    if (ch === '\n') {
      if (buf.endsWith('  ')) { buf = buf.replace(/ +$/, ''); flush(); out.push({ t: 'br' }); } else { buf = buf.replace(/ +$/, '') + ' '; }
      continue;
    }
    if (ch === '`') {
      const run = /^`+/.exec(rest)![0];
      const end = s.indexOf(run, i + run.length);
      if (end > 0) {
        flush();
        let v = s.slice(i + run.length, end).replace(/\n/g, ' ');
        if (v.startsWith(' ') && v.endsWith(' ') && v.trim()) v = v.slice(1, -1);
        out.push({ t: 'code', v });
        i = end + run.length - 1;
        continue;
      }
      buf += run;
      i += run.length - 1;
      continue;
    }
    if (ch === '!' && s[i + 1] === '[') {
      const l = linkAt(s, i + 1);
      if (l) { flush(); out.push({ t: 'img', src: l.href, alt: l.text }); i = l.end - 1; continue; }
    }
    if (ch === '[') {
      const l = linkAt(s, i);
      if (l) { flush(); out.push({ t: 'link', href: l.href, c: parseInline(l.text) }); i = l.end - 1; continue; }
    }
    if (ch === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      if (auto) { flush(); out.push({ t: 'link', href: auto[1]!, c: [{ t: 'text', v: auto[1]!.replace(/^mailto:/i, '') }] }); i += auto[0].length - 1; continue; }
    }
    if ((ch === 'h' || ch === 'w') && /[\s(]$|^$/.test(s.slice(Math.max(0, i - 1), i))) {
      const bare = /^(?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?'")\]]/i.exec(rest);
      if (bare) { flush(); out.push({ t: 'link', href: bare[0].startsWith('www.') ? `https://${bare[0]}` : bare[0], c: [{ t: 'text', v: bare[0] }] }); i += bare[0].length - 1; continue; }
    }
    const delim = rest.startsWith('**') ? '**' : rest.startsWith('__') ? '__' : rest.startsWith('~~') ? '~~' : ch === '*' || ch === '_' ? ch : '';
    if (delim && s[i + delim.length] && s[i + delim.length] !== ' ' && !(delim === '_' && /[\p{L}\p{N}]/u.test(s[i - 1] ?? ''))) {
      const end = findClose(s, i + delim.length, delim);
      if (end > 0) {
        flush();
        const inner = parseInline(s.slice(i + delim.length, end));
        out.push({ t: delim === '~~' ? 'del' : delim.length === 2 ? 'strong' : 'em', c: inner });
        i = end + delim.length - 1;
        continue;
      }
    }
    buf += ch;
  }
  flush();
  return out;
}

/**
 * Which links the viewer may follow. Web pages and mail open in the lab's
 * browser; "#heading" scrolls; anything else is treated as a file path on the
 * virtual disk. javascript:, data: and other schemes are refused.
 */
export function safeHref(href: string): { kind: 'web' | 'anchor' | 'file'; target: string } | null {
  const h = href.trim();
  if (!h) return null;
  if (h.startsWith('#')) return { kind: 'anchor', target: decodeURIComponent(h.slice(1)) };
  if (/^(https?:\/\/|mailto:)/i.test(h)) return { kind: 'web', target: h };
  if (/^[a-z][a-z0-9+.-]+:/i.test(h)) return null; // javascript:, data:, vbscript:, file: (C:\ is a drive letter)
  return { kind: 'file', target: decodeURIComponent(h.split('#')[0]!) };
}
