/**
 * Notepad++ (notepad++.exe): one window, a tab per document, as the real one.
 *
 * The editor is a transparent textarea over a highlight layer drawn from
 * core/notepadpp.ts tokens (text only, via textContent), with the line-number
 * margin, bookmarks, current-line and smart highlighting. Menus follow
 * Notepad++ 8: File, Edit, Search, View, Encoding, Language, Settings, Tools,
 * Macro, Run, Plugins (MIME Tools, Converter), Window and ?. The Find dialog
 * has the Find, Replace, Find in Files and Mark tabs, with Normal, Extended
 * and Regular expression modes, and results go to the Search results panel.
 * Open tabs, including unsaved text, are kept as Notepad++ keeps its session.
 */
import { clear, h, toast } from '../dom.ts';
import { act, persist, store } from '../store.ts';
import { type AppDef, onOpenArg } from '../wm.ts';
import { showMenu, closeMenus, type MenuEntry } from '../ctxmenu.ts';
import { deleteFile, homeDir } from '../../world/docs.ts';
import { writeFile } from '../../world/docs.ts';
import {
  LANGS, languageFor, tokenize, findAll, findNext, replaceAll, lineOp, toggleComment, markSegments,
  base64Encode, base64Decode, detectEncoding, encodeFor, type Encoding, type FindOpts, type Lang, type LineOp, type MarkKind, type Range, type SearchMode,
} from '../../core/notepadpp.ts';

export interface NppSettings {
  wrap: boolean;
  showAll: boolean;
  zoom: number;
  lineNumbers: boolean;
  currentLine: boolean;
  smartHighlight: boolean;
  theme: 'auto' | 'light' | 'dark';
  tabSize: number;
  tabSpaces: boolean;
  find: FindOpts & { wrap: boolean; backward: boolean };
  recent: string[];
  session: { path: string; name: string; text?: string; lang?: Lang; encoding?: Encoding }[];
  active: number;
}
const DEFAULTS: NppSettings = {
  wrap: false, showAll: false, zoom: 0, lineNumbers: true, currentLine: true, smartHighlight: true, theme: 'auto', tabSize: 4, tabSpaces: false,
  find: { matchCase: false, wholeWord: false, mode: 'normal', wrap: true, backward: false }, recent: [], session: [], active: 0,
};
const prefs = (): NppSettings => ({ ...DEFAULTS, ...(store.settings.notepadpp ?? {}), find: { ...DEFAULTS.find, ...(store.settings.notepadpp?.find ?? {}) } });

interface Doc {
  path: string;
  name: string;
  text: string;
  saved: string;
  lang: Lang;
  encoding: Encoding;
  readOnly: boolean;
  sel: [number, number];
  scroll: [number, number];
  bookmarks: Set<number>;
  marks: Range[];
  /** Converted to another encoding: the bytes on disk differ until saved. */
  converted: boolean;
}

type MacroStep = { kind: 'text'; text: string } | { kind: 'key'; key: 'Enter' | 'Backspace' | 'Delete' | 'Tab' } | { kind: 'op'; op: LineOp | 'comment' };

const VERSION = 'v8.6.9';
const fileOf = (path: string): { content: string; readOnly: boolean } | undefined => {
  const f = store.world.files.find((x) => x.path.toLowerCase() === path.toLowerCase() && !x.deleted);
  return f ? { content: f.content, readOnly: f.readOnly } : undefined;
};

export const notepadppApp: AppDef = {
  id: 'notepadpp',
  title: 'Notepad++',
  icon: 'notepadpp',
  width: 1020,
  height: 660,
  mount(host, win) {
    let p = prefs();
    const savePrefs = (patch: Partial<NppSettings> = {}): void => { p = { ...p, ...patch }; store.settings.notepadpp = p; persist(); };
    const docs: Doc[] = [];
    let cur = 0;
    let ovr = false;
    let recording: MacroStep[] | null = null;
    let macro: MacroStep[] = [];
    let lastQuery = '';

    // ---------------------------------------------------------------- elements
    const root = h('div', { class: 'npp', tabindex: '-1' });
    const menubar = h('div', { class: 'npp-menubar', role: 'menubar' });
    const toolbar = h('div', { class: 'npp-toolbar', role: 'toolbar' });
    const tabs = h('div', { class: 'npp-tabs', role: 'tablist' });
    const gutter = h('div', { class: 'npp-gutter', 'aria-hidden': 'true' });
    const gutterInner = h('div', { class: 'npp-gutter-in' });
    gutter.append(gutterInner);
    const layer = h('div', { class: 'npp-layer', 'aria-hidden': 'true' });
    const ta = h('textarea', { class: 'npp-ta', spellcheck: 'false', autocomplete: 'off', wrap: 'off', 'aria-label': 'Notepad++ editor' });
    const scroll = h('div', { class: 'npp-scroll' }, layer, ta);
    const editor = h('div', { class: 'npp-editor' }, gutter, scroll);
    const results = h('div', { class: 'npp-results', hidden: true });
    const status = h('div', { class: 'npp-status' });
    const body = h('div', { class: 'npp-body' }, editor);
    root.append(menubar, toolbar, tabs, body, results, status);
    host.append(root);

    const doc = (): Doc => docs[cur]!;
    const dirty = (d: Doc): boolean => d.text !== d.saved || d.converted;
    const isDark = (): boolean => p.theme === 'dark' || (p.theme === 'auto' && (document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)));
    const fontPx = (): number => Math.max(6, 13 + p.zoom);

    // ---------------------------------------------------------------- documents
    function newName(): string {
      for (let n = 1; ; n++) if (!docs.some((d) => !d.path && d.name === `new ${n}`)) return `new ${n}`;
    }
    function makeDoc(path: string, name: string, text: string, saved: string, extra: Partial<Doc> = {}): Doc {
      return { path, name, text, saved, lang: path ? languageFor(path) : 'normal', encoding: 'UTF-8', readOnly: false, sel: [0, 0], scroll: [0, 0], bookmarks: new Set(), marks: [], converted: false, ...extra };
    }
    function remember(path: string): void { savePrefs({ recent: [path, ...p.recent.filter((x) => x.toLowerCase() !== path.toLowerCase())].slice(0, 10) }); }
    function openPath(path: string, line?: number): void {
      const i = docs.findIndex((d) => d.path.toLowerCase() === path.toLowerCase());
      if (i >= 0) { switchTo(i); if (line) goLine(line); return; }
      const f = fileOf(path);
      if (!f) { alertBox('Notepad++', `"${path}" cannot be opened:\nThe file does not exist.`); return; }
      const { encoding, text } = detectEncoding(f.content.replace(/\r\n?/g, '\n'));
      const d = makeDoc(path, path.split('\\').pop()!, text, text, { encoding, readOnly: f.readOnly });
      // Notepad++ replaces an untouched "new 1" when you open a file.
      const blank = docs.length === 1 && !docs[0]!.path && !docs[0]!.text;
      if (blank) docs[0] = d; else { stash(); docs.push(d); cur = docs.length - 1; }
      remember(path);
      load();
      if (line) goLine(line);
    }
    function newDoc(): void { stash(); docs.push(makeDoc('', newName(), '', '')); cur = docs.length - 1; load(); }
    function stash(): void {
      const d = docs[cur];
      if (!d) return;
      d.text = ta.value; d.sel = [ta.selectionStart, ta.selectionEnd]; d.scroll = [ta.scrollTop, ta.scrollLeft];
    }
    function switchTo(i: number): void { if (i === cur || !docs[i]) return; stash(); cur = i; load(); }
    function load(): void {
      const d = doc();
      ta.value = d.text;
      ta.readOnly = d.readOnly;
      ta.setSelectionRange(d.sel[0], d.sel[1]);
      look();
      ta.scrollTop = d.scroll[0]; ta.scrollLeft = d.scroll[1];
      drawAll();
      setTimeout(() => ta.focus(), 0);
    }
    function saveSession(): void {
      stash();
      savePrefs({ active: cur, session: docs.map((d) => ({ path: d.path, name: d.name, lang: d.lang, encoding: d.encoding, ...(dirty(d) || !d.path ? { text: d.text } : {}) })) });
    }
    function restoreSession(): void {
      for (const s of p.session) {
        if (s.path) {
          const f = fileOf(s.path);
          if (!f && s.text === undefined) continue;
          const disk = f ? detectEncoding(f.content.replace(/\r\n?/g, '\n')).text : '';
          docs.push(makeDoc(s.path, s.name, s.text ?? disk, f ? disk : '', { lang: s.lang ?? languageFor(s.path), encoding: s.encoding ?? 'UTF-8', readOnly: f?.readOnly ?? false }));
        } else docs.push(makeDoc('', s.name, s.text ?? '', '', { lang: s.lang ?? 'normal' }));
      }
      if (!docs.length) docs.push(makeDoc('', 'new 1', '', ''));
      cur = Math.min(Math.max(0, p.active), docs.length - 1);
    }

    function writeDoc(d: Doc, path: string): boolean {
      if (fileOf(path)?.readOnly) { alertBox('Save failed', `Please check whether if this file is opened in another program.\n\n${path}\nAccess is denied (the file is read-only).`); return false; }
      if (!act((w) => writeFile(w, path, encodeFor(d.text, d.encoding)))) return false;
      const renamed = d.path.toLowerCase() !== path.toLowerCase();
      d.path = path; d.name = path.split('\\').pop()!; d.saved = d.text; d.readOnly = false; d.converted = false;
      if (renamed && d.lang === 'normal') d.lang = languageFor(path);
      remember(path);
      return true;
    }
    function save(d = doc()): void {
      if (d === doc()) stash();
      if (!d.path || d.readOnly) { saveAs(d); return; }
      if (writeDoc(d, d.path)) drawAll();
    }
    function saveAll(): void { stash(); for (const d of docs) if (dirty(d) && d.path && !d.readOnly) writeDoc(d, d.path); drawAll(); const left = docs.filter((d) => dirty(d)); if (left.length) saveAs(left[0]!); }
    function closeDoc(i: number, then?: () => void): void {
      stash();
      const d = docs[i]!;
      const finish = (): void => {
        docs.splice(i, 1);
        if (!docs.length) docs.push(makeDoc('', 'new 1', '', ''));
        cur = Math.min(i <= cur && cur > 0 ? cur - 1 : cur, docs.length - 1);
        load();
        saveSession();
        then?.();
      };
      if (!dirty(d) || (!d.path && !d.text)) { finish(); return; }
      ask('Save', `Save file "${d.path || d.name}" ?`, ['Yes', 'No', 'Cancel'], (b) => {
        if (b === 'Yes') { if (!d.path || d.readOnly) saveAs(d, finish); else if (writeDoc(d, d.path)) finish(); }
        else if (b === 'No') finish();
      });
    }
    function closeMany(which: number[]): void {
      const next = (): void => { const i = which.pop(); if (i !== undefined) closeDoc(i, next); };
      which.sort((a, b) => a - b);
      next();
    }

    // ---------------------------------------------------------------- drawing
    function look(): void {
      root.dataset.theme = isDark() ? 'dark' : 'light';
      root.style.setProperty('--npp-font', `${fontPx()}px`);
      root.style.setProperty('--npp-tab', String(p.tabSize));
      ta.wrap = p.wrap ? 'soft' : 'off';
      root.classList.toggle('wrap', p.wrap);
      root.classList.toggle('show-all', p.showAll);
      gutter.hidden = !p.lineNumbers;
    }
    function lineOfPos(pos: number): number { return ta.value.slice(0, pos).split('\n').length - 1; }
    function smartMarks(): Range[] {
      if (!p.smartHighlight) return [];
      const s = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (!/^\w+$/.test(s)) return [];
      return findAll(ta.value, s, { matchCase: false, wholeWord: true, mode: 'normal' }).filter((r) => r.start !== ta.selectionStart);
    }
    function drawLayer(): void {
      const d = doc();
      const text = ta.value;
      const lines = tokenize(text, d.lang);
      const curLine = lineOfPos(ta.selectionStart);
      const marks: { start: number; end: number; cls: MarkKind }[] = [...smartMarks().map((r) => ({ ...r, cls: 'smart' as MarkKind })), ...d.marks.map((r) => ({ ...r, cls: 'mark' as MarkKind }))];
      clear(layer); clear(gutterInner);
      const gw = `${Math.max(3, String(lines.length).length) + 1.6}ch`;
      root.style.setProperty('--npp-gutter', p.lineNumbers ? gw : '14px');
      let offset = 0;
      const rows: HTMLElement[] = [];
      lines.forEach((toks, i) => {
        const len = text.split('\n')[i]!.length;
        const lineMarks = marks.filter((m) => m.end > offset && m.start < offset + len).map((m) => ({ start: Math.max(0, m.start - offset), end: Math.min(len, m.end - offset), cls: m.cls }));
        const row = h('div', { class: `npp-row${p.currentLine && i === curLine ? ' cur' : ''}` });
        for (const s of markSegments(toks, lineMarks)) {
          const span = h('span', { class: `t-${s.k}${s.mark ? ` m-${s.mark}` : ''}` });
          if (p.showAll && /[ \t]/.test(s.v)) for (const part of s.v.split(/([ \t])/)) { if (part === ' ') span.append(h('span', { class: 'ws-sp' }, ' ')); else if (part === '\t') span.append(h('span', { class: 'ws-tab' }, '\t')); else if (part) span.append(part); }
          else span.textContent = s.v;
          row.append(span);
        }
        if (p.showAll && i < lines.length - 1) row.append(h('span', { class: 'ws-eol' }, 'CRLF'));
        if (!toks.length && !(p.showAll && i < lines.length - 1)) row.append('​');
        rows.push(row);
        layer.append(row);
        gutterInner.append(h('div', { class: `npp-ln${d.bookmarks.has(i) ? ' bm' : ''}${i === curLine ? ' cur' : ''}`, 'data-line': String(i) }, p.lineNumbers ? String(i + 1) : ''));
        offset += len + 1;
      });
      // Wrapped text must break at the textarea's width; unwrapped rows run on so the current-line band scrolls with them.
      layer.style.width = p.wrap ? `${ta.clientWidth}px` : 'max-content';
      layer.style.minWidth = `${ta.clientWidth}px`;
      if (p.wrap) rows.forEach((r, i) => { (gutterInner.children[i] as HTMLElement).style.height = `${r.offsetHeight}px`; });
      syncScroll();
    }
    function syncScroll(): void {
      layer.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
      gutterInner.style.transform = `translateY(${-ta.scrollTop}px)`;
    }
    function drawStatus(): void {
      const d = doc();
      const v = ta.value;
      const ln = lineOfPos(ta.selectionStart);
      const col = ta.selectionStart - (v.lastIndexOf('\n', ta.selectionStart - 1) + 1) + 1;
      const selLen = ta.selectionEnd - ta.selectionStart;
      const selLines = selLen ? lineOfPos(ta.selectionEnd) - ln + 1 : 0;
      clear(status);
      status.append(
        h('span', { class: 'npp-st grow' }, LANGS[d.lang].status),
        h('span', { class: 'npp-st' }, `length : ${(v.length + (v.split('\n').length - 1)).toLocaleString('en-US')}    lines : ${v.split('\n').length.toLocaleString('en-US')}`),
        h('span', { class: 'npp-st' }, `Ln : ${ln + 1}    Col : ${col}    ${selLen ? `Sel : ${selLen} | ${selLines}` : `Pos : ${ta.selectionStart + 1}`}`),
        h('span', { class: 'npp-st' }, 'Windows (CR LF)'),
        h('span', { class: 'npp-st' }, d.encoding),
        h('span', { class: 'npp-st', title: 'Insert key toggles typing mode' }, ovr ? 'OVR' : 'INS'));
    }
    function drawTabs(): void {
      clear(tabs);
      docs.forEach((d, i) => {
        const state = d.readOnly ? 'ro' : dirty(d) ? 'dirty' : 'saved';
        tabs.append(h('div', { class: `npp-tab${i === cur ? ' on' : ''}`, role: 'tab', 'aria-selected': i === cur ? 'true' : 'false', title: d.path || d.name,
          onMousedown: (e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); closeDoc(i); } else if (e.button === 0) switchTo(i); },
          onContextmenu: (e: MouseEvent) => { e.preventDefault(); switchTo(i); showMenu(e.clientX, e.clientY, tabMenu(i)); } },
          h('span', { class: `npp-disk ${state}`, 'aria-label': state === 'dirty' ? 'Modified' : state === 'ro' ? 'Read-only' : 'Saved' }, state === 'ro' ? '' : ''),
          h('span', { class: 'npp-tab-name' }, d.name),
          h('button', { class: 'npp-tab-x', type: 'button', title: 'Close', 'aria-label': `Close ${d.name}`, onMousedown: (e: Event) => e.stopPropagation(), onClick: (e: Event) => { e.stopPropagation(); closeDoc(i); } }, '✕')));
      });
      tabs.append(h('button', { class: 'npp-tab-new', type: 'button', title: 'New (Ctrl+N)', 'aria-label': 'New tab', onClick: newDoc }, '+'));
    }
    function drawAll(): void {
      const d = doc();
      win.setTitle(`${dirty(d) ? '*' : ''}${d.path || d.name} - Notepad++${recording ? ' [Recording]' : ''}`);
      drawTabs(); drawToolbar(); drawLayer(); drawStatus();
    }

    // ---------------------------------------------------------------- editing helpers
    /** Replace the text through the browser's editing so Ctrl+Z undoes it, then place the selection. */
    function applyText(next: string, selStart: number, selEnd: number): void {
      const prev = ta.value;
      let a = 0;
      while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
      let b = 0;
      while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
      ta.focus();
      ta.setSelectionRange(a, prev.length - b);
      const ins = next.slice(a, next.length - b);
      if (!(ins ? document.execCommand('insertText', false, ins) : a === prev.length - b || document.execCommand('delete')) || ta.value !== next) ta.value = next;
      ta.setSelectionRange(selStart, selEnd);
      changed();
    }
    function runOp(op: LineOp | 'comment'): void {
      if (ta.readOnly) return;
      const e = op === 'comment' ? toggleComment(ta.value, ta.selectionStart, ta.selectionEnd, doc().lang) : lineOp(ta.value, ta.selectionStart, ta.selectionEnd, op);
      if (e.text !== ta.value) applyText(e.text, e.selStart, e.selEnd);
      if (recording) recording.push({ kind: 'op', op });
    }
    function insert(text: string): void {
      if (ta.readOnly) return;
      ta.focus();
      const ok = text ? document.execCommand('insertText', false, text) : ta.selectionStart === ta.selectionEnd || document.execCommand('delete');
      if (!ok) ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      changed();
    }
    function changed(): void {
      doc().text = ta.value;
      doc().marks = [];
      drawAll();
      saveSessionSoon();
    }
    let sessionTimer = 0;
    const saveSessionSoon = (): void => { clearTimeout(sessionTimer); sessionTimer = window.setTimeout(saveSession, 800); };
    function selectRange(r: Range): void {
      ta.focus();
      ta.setSelectionRange(r.start, r.end);
      const lh = fontPx() * 1.35;
      const line = lineOfPos(r.start);
      if (line * lh < ta.scrollTop || line * lh > ta.scrollTop + ta.clientHeight - lh * 2) ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
      drawLayer(); drawStatus();
    }
    function goLine(n: number): void {
      const lines = ta.value.split('\n');
      const i = Math.min(Math.max(1, n), lines.length) - 1;
      const pos = lines.slice(0, i).reduce((s, l) => s + l.length + 1, 0);
      selectRange({ start: pos, end: pos });
    }
    function indent(out: boolean): void {
      const v = ta.value;
      const s = ta.selectionStart, e = ta.selectionEnd;
      const unit = p.tabSpaces ? ' '.repeat(p.tabSize) : '\t';
      if (!out && s === e) { insert(unit); return; }
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const le = e > s && v[e - 1] === '\n' ? e - 1 : e;
      const block = v.slice(ls, le).split('\n');
      const next = block.map((l) => (out ? l.replace(new RegExp(`^(\\t| {1,${p.tabSize}})`), '') : unit + l)).join('\n');
      applyText(v.slice(0, ls) + next + v.slice(le), ls, ls + next.length);
    }

    // ---------------------------------------------------------------- dialogs
    function modal(title: string, content: HTMLElement[], buttons: [string, () => boolean | void][], cls = ''): () => void {
      body.querySelector('.npp-modal-wrap')?.remove();
      const close = (): void => { wrap.remove(); ta.focus(); };
      const dlg = h('div', { class: `npp-dlg ${cls}`, role: 'dialog', 'aria-label': title },
        h('div', { class: 'npp-dlg-title' }, h('span', null, title), h('button', { class: 'npp-dlg-x', type: 'button', 'aria-label': 'Close', onClick: close }, '✕')),
        h('div', { class: 'npp-dlg-body' }, ...content),
        h('div', { class: 'npp-dlg-btns' }, buttons.map(([label, fn], i) => h('button', { class: `npp-btn${i === 0 ? ' def' : ''}`, type: 'button', onClick: () => { if (fn() !== false) close(); } }, label))));
      const wrap = h('div', { class: 'npp-modal-wrap', onKeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); (dlg.querySelector('.npp-btn.def') as HTMLButtonElement | null)?.click(); } } }, dlg);
      body.append(wrap);
      setTimeout(() => (dlg.querySelector('input, select, textarea, .npp-btn') as HTMLElement | null)?.focus(), 0);
      return close;
    }
    function alertBox(title: string, message: string): void { modal(title, message.split('\n').map((l) => h('p', { class: 'npp-msg' }, l || ' ')), [['OK', () => undefined]]); }
    function ask(title: string, message: string, buttons: string[], fn: (b: string) => void): void { modal(title, [h('p', { class: 'npp-msg' }, message)], buttons.map((b) => [b, () => { fn(b); }])); }

    const FOLDERS = (): string[] => ['Desktop', 'Documents', 'Documents\\Evidence', 'Documents\\Policies', 'Documents\\Reference', 'Documents\\Scripts', 'Downloads'].map((x) => `${homeDir(store.world)}\\${x}`);
    const rel = (path: string): string => path.replace(`${homeDir(store.world)}\\`, '');
    function fileList(folder: string): string[] {
      const pre = `${folder.toLowerCase()}\\`;
      return store.world.files.filter((f) => !f.deleted && f.path.toLowerCase().startsWith(pre) && !f.path.slice(pre.length).includes('\\')).map((f) => f.path).sort();
    }
    function openDialog(): void {
      let folder = doc().path ? doc().path.split('\\').slice(0, -1).join('\\') : `${homeDir(store.world)}\\Documents`;
      if (!FOLDERS().some((f) => f.toLowerCase() === folder.toLowerCase())) folder = `${homeDir(store.world)}\\Documents`;
      const list = h('select', { class: 'npp-list', size: 10, 'aria-label': 'Files', onDblclick: () => { if (list.value) { openPath(list.value); close(); } } });
      const fill = (): void => { clear(list); for (const f of fileList(folder)) list.append(h('option', { value: f }, f.split('\\').pop()!)); };
      const pick = h('select', { class: 'npp-input', 'aria-label': 'Look in', onChange: (e: Event) => { folder = (e.target as HTMLSelectElement).value; fill(); } }, FOLDERS().map((f) => h('option', { value: f, selected: f.toLowerCase() === folder.toLowerCase() }, rel(f))));
      fill();
      const close = modal('Open', [h('label', { class: 'npp-field' }, 'Look in:', pick), list], [['Open', () => { if (!list.value) return false; openPath(list.value); return undefined; }], ['Cancel', () => undefined]], 'wide');
    }
    function saveAs(d = doc(), then?: () => void, copy = false): void {
      const folders = FOLDERS();
      const dir = d.path ? d.path.split('\\').slice(0, -1).join('\\') : `${homeDir(store.world)}\\Documents`;
      const pick = h('select', { class: 'npp-input', 'aria-label': 'Save in' }, folders.map((f) => h('option', { value: f, selected: f.toLowerCase() === dir.toLowerCase() }, rel(f))));
      const types: [string, string][] = [['', 'All types (*.*)'], ['.txt', 'Normal text file (*.txt)'], ['.ps1', 'PowerShell file (*.ps1;*.psm1)'], ['.bat', 'Batch file (*.bat;*.cmd)'], ['.json', 'JSON file (*.json)'], ['.md', 'Markdown file (*.md)'], ['.xml', 'eXtensible Markup Language file (*.xml)'], ['.html', 'Hyper Text Markup Language file (*.html)'], ['.ini', 'MS ini file (*.ini)'], ['.csv', 'CSV file (*.csv)'], ['.log', 'Log file (*.log)']];
      const type = h('select', { class: 'npp-input', 'aria-label': 'Save as type' }, types.map(([v, l]) => h('option', { value: v, selected: !d.path && v === (LANGS[d.lang].ext[0] ? `.${LANGS[d.lang].ext[0]}` : '.txt') }, l)));
      const name = h('input', { class: 'npp-input', 'aria-label': 'File name', value: d.path ? d.name : `${d.name}` });
      modal(copy ? 'Save a Copy As' : 'Save As', [h('label', { class: 'npp-field' }, 'Save in:', pick), h('label', { class: 'npp-field' }, 'File name:', name), h('label', { class: 'npp-field' }, 'Save as type:', type)], [
        ['Save', () => {
          let n = name.value.trim();
          if (!n || /[\\/:*?"<>|]/.test(n)) { toast('A file name can\'t contain any of the following characters: \\ / : * ? " < > |', 'err'); return false; }
          if (type.value && !/\.[^.]+$/.test(n)) n += type.value;
          const target = `${pick.value}\\${n}`;
          const go = (): void => {
            if (copy) { if (act((w) => writeFile(w, target, encodeFor(d.text, d.encoding)))) toast(`Saved a copy as ${n}`, 'ok'); return; }
            if (writeDoc(d, target)) { drawAll(); saveSession(); then?.(); }
          };
          if (fileOf(target) && target.toLowerCase() !== d.path.toLowerCase()) { setTimeout(() => ask('Confirm Save As', `${n} already exists.\nDo you want to replace it?`, ['Yes', 'No'], (b) => { if (b === 'Yes') go(); }), 0); return undefined; }
          go();
          return undefined;
        }],
        ['Cancel', () => undefined],
      ], 'wide');
      setTimeout(() => { name.focus(); name.setSelectionRange(0, Math.max(0, name.value.lastIndexOf('.') > 0 ? name.value.lastIndexOf('.') : name.value.length)); }, 0);
    }
    function goToDialog(): void {
      const lines = ta.value.split('\n').length;
      const here = lineOfPos(ta.selectionStart) + 1;
      const inp = h('input', { class: 'npp-input', type: 'number', min: '1', 'aria-label': 'You want to go to' });
      const byOffset = h('input', { type: 'radio', name: 'npp-goto' });
      const byLine = h('input', { type: 'radio', name: 'npp-goto', checked: true });
      modal('Go To...', [h('div', { class: 'npp-row2' }, h('label', null, byLine, ' Line'), h('label', null, byOffset, ' Offset')),
        h('p', { class: 'npp-msg' }, `You are here : ${byOffset.checked ? ta.selectionStart : here}`), h('label', { class: 'npp-field' }, 'You want to go to :', inp), h('p', { class: 'npp-msg' }, `You can't go further than : ${lines}`)], [
        ['Go', () => { const n = Number(inp.value); if (!n) return false; if (byOffset.checked) selectRange({ start: Math.min(n, ta.value.length), end: Math.min(n, ta.value.length) }); else goLine(n); return undefined; }],
        ['I\'m going nowhere', () => undefined],
      ]);
    }
    function summary(): void {
      const v = ta.value;
      const d = doc();
      const f = d.path ? store.world.files.find((x) => x.path.toLowerCase() === d.path.toLowerCase() && !x.deleted) : undefined;
      alertBox('Summary', [
        ...(d.path ? [`Full file path: ${d.path}`, `Modified: ${f ? new Date(f.modified).toLocaleString() : ''}`, ''] : []),
        `Characters (without line endings): ${v.replace(/\n/g, '').length.toLocaleString('en-US')}`,
        `Words: ${(v.match(/\b\w+\b/g) ?? []).length.toLocaleString('en-US')}`,
        `Lines: ${v.split('\n').length.toLocaleString('en-US')}`,
        `Document length: ${(v.length + v.split('\n').length - 1).toLocaleString('en-US')}`,
        `Selected characters: ${(ta.selectionEnd - ta.selectionStart).toLocaleString('en-US')}`,
      ].join('\n'));
    }
    function preferences(): void {
      const theme = h('select', { class: 'npp-input', 'aria-label': 'Dark mode' }, (['auto', 'light', 'dark'] as const).map((t) => h('option', { value: t, selected: p.theme === t }, t === 'auto' ? 'Follow Windows' : t === 'light' ? 'Light mode' : 'Dark mode')));
      const size = h('input', { class: 'npp-input', type: 'number', min: '1', max: '16', value: String(p.tabSize), 'aria-label': 'Tab size' });
      const chk = (label: string, on: boolean): HTMLInputElement => { const c = h('input', { type: 'checkbox', checked: on, 'aria-label': label }); return c; };
      const spaces = chk('Replace by space', p.tabSpaces), ln = chk('Display line number', p.lineNumbers), cl = chk('Highlight current line', p.currentLine), sm = chk('Enable smart highlighting', p.smartHighlight);
      modal('Preferences', [
        h('fieldset', { class: 'npp-group' }, h('legend', null, 'Dark Mode'), theme),
        h('fieldset', { class: 'npp-group' }, h('legend', null, 'Editing'), h('label', { class: 'npp-field' }, 'Tab size :', size), h('label', null, spaces, ' Replace by space'), h('label', null, ln, ' Display line number'), h('label', null, cl, ' Highlight current line'), h('label', null, sm, ' Enable smart highlighting')),
      ], [['Close', () => { savePrefs({ theme: theme.value as NppSettings['theme'], tabSize: Math.min(16, Math.max(1, Number(size.value) || 4)), tabSpaces: spaces.checked, lineNumbers: ln.checked, currentLine: cl.checked, smartHighlight: sm.checked }); look(); drawAll(); }]], 'wide');
    }
    function about(): void {
      alertBox('About Notepad++', `Notepad++ ${VERSION}     (64-bit)\nBuild time: Oct 2026\n\nHome: https://notepad-plus-plus.org/\n\nGNU General Public Licence\n\nThis range edition runs inside the Meridian IAM Range: files open from and save to the workstation's virtual disk.`);
    }
    function runDialog(): void {
      const inp = h('input', { class: 'npp-input', value: p.recent.length && doc().path ? '"$(FULL_CURRENT_PATH)"' : 'cmd', 'aria-label': 'The Program to Run' });
      modal('Run...', [h('label', { class: 'npp-field col' }, 'The Program to Run', inp)], [['Run', () => {
        const cmd = inp.value.trim().replace(/\$\(FULL_CURRENT_PATH\)/g, doc().path).replace(/^"(.*)"$/, '$1');
        if (!cmd) return false;
        if (fileOf(cmd)) { if (dirty(doc())) save(); openFileHook(cmd, /\.(ps1|bat|cmd)$/i.test(cmd) ? 'run' : 'open'); }
        else openProgramHook(cmd);
        return undefined;
      }], ['Cancel', () => undefined]]);
    }
    async function hashDialog(algo: 'SHA-1' | 'SHA-256' | 'SHA-512'): Promise<void> {
      const src = ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '';
      const input = h('textarea', { class: 'npp-input npp-hash-in', 'aria-label': 'Text', rows: '4' }, src);
      const out = h('input', { class: 'npp-input', readonly: true, 'aria-label': `${algo} digest` });
      const calc = async (): Promise<void> => {
        const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(input.value));
        out.value = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
      };
      input.addEventListener('input', () => { void calc(); });
      modal(`Generate ${algo} digest`, [h('label', { class: 'npp-field col' }, 'Text to hash', input), h('label', { class: 'npp-field col' }, 'Digest', out)], [
        ['Copy to clipboard', () => { void navigator.clipboard?.writeText(out.value).catch(() => undefined); toast('Digest copied'); return false; }], ['Close', () => undefined]], 'wide');
      await calc();
    }

    // ---------------------------------------------------------------- find dialog and results
    let findTab: 'Find' | 'Replace' | 'Find in Files' | 'Mark' = 'Find';
    let findEl: HTMLElement | null = null;
    function findOpts(): FindOpts { return { matchCase: p.find.matchCase, wholeWord: p.find.wholeWord, mode: p.find.mode }; }
    function findDialog(tab: typeof findTab): void {
      findTab = tab;
      findEl?.remove();
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      const q = h('input', { class: 'npp-input', value: sel && !sel.includes('\n') ? sel : lastQuery, 'aria-label': 'Find what' });
      const r = h('input', { class: 'npp-input', 'aria-label': 'Replace with' });
      const filters = h('input', { class: 'npp-input', value: '*.*', 'aria-label': 'Filters' });
      const dir = h('select', { class: 'npp-input', 'aria-label': 'Directory' }, FOLDERS().concat([homeDir(store.world)]).map((f) => h('option', { value: f, selected: f.endsWith('\\Documents') }, f)));
      const msg = h('div', { class: 'npp-find-msg', role: 'status' });
      const setMsg = (t: string, kind: 'ok' | 'warn' | 'err' = 'ok'): void => { msg.textContent = t; msg.dataset.kind = kind; };
      const opt = (label: string, key: 'matchCase' | 'wholeWord' | 'wrap' | 'backward'): HTMLElement => h('label', null, h('input', { type: 'checkbox', checked: p.find[key], onChange: (e: Event) => savePrefs({ find: { ...p.find, [key]: (e.target as HTMLInputElement).checked } }) }), ` ${label}`);
      const mode = (label: string, m: SearchMode): HTMLElement => h('label', null, h('input', { type: 'radio', name: 'npp-mode', checked: p.find.mode === m, onChange: () => savePrefs({ find: { ...p.find, mode: m } }) }), ` ${label}`);
      const guard = (fn: () => void): void => { lastQuery = q.value; try { fn(); } catch (e) { setMsg((e as Error).message, 'err'); } };
      const next = (backward = p.find.backward): void => guard(() => {
        if (!q.value) return;
        const from = backward ? ta.selectionStart : ta.selectionEnd;
        const hit = findNext(ta.value, q.value, from, findOpts(), { backward, wrap: p.find.wrap });
        if (!hit) { setMsg(`Find: Can't find the text "${q.value}" from caret to ${backward ? 'beginning' : 'end'}-of-file`, 'err'); return; }
        const wrapped = backward ? hit.start >= from : hit.start < from;
        selectRange(hit);
        setMsg(wrapped ? `Find: Found the 1st occurrence from the ${backward ? 'bottom' : 'top'}. The ${backward ? 'beginning' : 'end'} of the document has been reached.` : '', wrapped ? 'warn' : 'ok');
      });
      const count = (): void => guard(() => { const n = findAll(ta.value, q.value, findOpts()).length; setMsg(`Count: ${n} match${n === 1 ? '' : 'es'} in entire file`, n ? 'ok' : 'err'); });
      const replaceOne = (): void => guard(() => {
        if (ta.readOnly) return;
        const all = findAll(ta.value, q.value, findOpts());
        const atSel = all.find((x) => x.start === ta.selectionStart && x.end === ta.selectionEnd);
        if (atSel) {
          const one = replaceAll(ta.value.slice(atSel.start, atSel.end), q.value, r.value, findOpts());
          applyText(ta.value.slice(0, atSel.start) + one.text + ta.value.slice(atSel.end), atSel.start + one.text.length, atSel.start + one.text.length);
        }
        next(false);
      });
      const replaceEverywhere = (alldocs: boolean): void => guard(() => {
        let total = 0;
        if (!alldocs) {
          if (ta.readOnly) return;
          const res = replaceAll(ta.value, q.value, r.value, findOpts());
          if (res.count) applyText(res.text, 0, 0);
          setMsg(`Replace All: ${res.count} occurrence${res.count === 1 ? ' was' : 's were'} replaced in entire file`, res.count ? 'ok' : 'err');
          return;
        }
        stash();
        for (const d of docs) { if (d.readOnly) continue; const res = replaceAll(d.text, q.value, r.value, findOpts()); if (res.count) { d.text = res.text; total += res.count; } }
        load();
        setMsg(`Replace in Opened Files: ${total} occurrence${total === 1 ? ' was' : 's were'} replaced`, total ? 'ok' : 'err');
      });
      const findAllCurrent = (alldocs: boolean): void => guard(() => {
        stash();
        const list = (alldocs ? docs : [doc()]).map((d) => ({ path: d.path || d.name, text: d.text, open: () => { switchTo(docs.indexOf(d)); } }));
        showResults(q.value, list, alldocs ? docs.length : 1);
      });
      const findInFiles = (): void => guard(() => {
        const globs = filters.value.split(/[;\s]+/).filter(Boolean).map((g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i'));
        const pre = `${dir.value.toLowerCase()}\\`;
        const files = store.world.files.filter((f) => !f.deleted && f.path.toLowerCase().startsWith(pre) && (!globs.length || globs.some((g) => g.test(f.path.split('\\').pop()!))));
        showResults(q.value, files.map((f) => ({ path: f.path, text: f.content.replace(/\r\n?/g, '\n'), open: () => openPath(f.path) })), files.length);
      });
      const markAll = (): void => guard(() => { const m = findAll(ta.value, q.value, findOpts()); doc().marks = m; if (bmChk.checked) for (const x of m) doc().bookmarks.add(lineOfPos(x.start)); drawLayer(); setMsg(`Mark: ${m.length} match${m.length === 1 ? '' : 'es'}`, m.length ? 'ok' : 'err'); });
      const bmChk = h('input', { type: 'checkbox' });
      const btn = (label: string, fn: () => void, def = false): HTMLButtonElement => h('button', { class: `npp-btn${def ? ' def' : ''}`, type: 'button', onClick: fn }, label);
      const closeFind = (): void => { findEl?.remove(); findEl = null; ta.focus(); };
      const fields: HTMLElement[] = [h('label', { class: 'npp-field' }, 'Find what :', q)];
      let buttons: HTMLElement[] = [];
      if (tab === 'Replace') fields.push(h('label', { class: 'npp-field' }, 'Replace with :', r));
      if (tab === 'Find in Files') fields.push(h('label', { class: 'npp-field' }, 'Replace with :', r), h('label', { class: 'npp-field' }, 'Filters :', filters), h('label', { class: 'npp-field' }, 'Directory :', dir));
      if (tab === 'Find') buttons = [btn('Find Next', () => next(), true), btn('Count', count), btn('Find All in Current Document', () => findAllCurrent(false)), btn('Find All in All Opened Documents', () => findAllCurrent(true)), btn('Close', closeFind)];
      if (tab === 'Replace') buttons = [btn('Find Next', () => next(), true), btn('Replace', replaceOne), btn('Replace All', () => replaceEverywhere(false)), btn('Replace All in All Opened Documents', () => replaceEverywhere(true)), btn('Close', closeFind)];
      if (tab === 'Find in Files') buttons = [btn('Find All', findInFiles, true), btn('Close', closeFind)];
      if (tab === 'Mark') buttons = [btn('Mark All', markAll, true), btn('Clear all marks', () => { doc().marks = []; drawLayer(); setMsg(''); }), btn('Close', closeFind)];
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (buttons[0] as HTMLButtonElement).click(); } });
      const titleBar = h('div', { class: 'npp-dlg-title' }, h('span', null, tab), h('button', { class: 'npp-dlg-x', type: 'button', 'aria-label': 'Close', onClick: closeFind }, '✕'));
      findEl = h('div', { class: 'npp-dlg npp-find', role: 'dialog', 'aria-label': tab, onKeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeFind(); } if (e.key === 'F3') { e.preventDefault(); next(e.shiftKey); } } },
        titleBar,
        h('div', { class: 'npp-find-tabs', role: 'tablist' }, (['Find', 'Replace', 'Find in Files', 'Mark'] as const).map((t) => h('button', { class: `npp-find-tab${t === tab ? ' on' : ''}`, type: 'button', role: 'tab', onClick: () => { lastQuery = q.value; findDialog(t); } }, t))),
        h('div', { class: 'npp-find-main' },
          h('div', { class: 'npp-find-left' }, ...fields,
            h('div', { class: 'npp-find-opts' },
              h('div', { class: 'npp-col' }, tab === 'Mark' ? h('label', null, bmChk, ' Bookmark line') : null, tab === 'Find in Files' ? null : opt('Backward direction', 'backward'), opt('Match whole word only', 'wholeWord'), opt('Match case', 'matchCase'), tab === 'Find in Files' ? null : opt('Wrap around', 'wrap')),
              h('fieldset', { class: 'npp-group' }, h('legend', null, 'Search Mode'), mode('Normal', 'normal'), mode('Extended (\\n, \\r, \\t, \\0, \\x...)', 'extended'), mode('Regular expression', 'regex')))),
          h('div', { class: 'npp-find-btns' }, ...buttons)),
        msg);
      // Drag by the title bar, as the real dialog moves.
      titleBar.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const el = findEl!;
        const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
        const move = (ev: PointerEvent): void => { el.style.left = `${ev.clientX - sx}px`; el.style.top = `${ev.clientY - sy}px`; el.style.right = 'auto'; };
        const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      });
      body.append(findEl);
      q.focus(); q.select();
    }
    function findAgain(backward: boolean): void {
      if (!lastQuery) { findDialog('Find'); return; }
      try {
        const hit = findNext(ta.value, lastQuery, backward ? ta.selectionStart : ta.selectionEnd, findOpts(), { backward, wrap: p.find.wrap });
        if (hit) selectRange(hit); else toast(`Find: Can't find the text "${lastQuery}"`);
      } catch (e) { toast((e as Error).message, 'err'); }
    }
    function showResults(query: string, files: { path: string; text: string; open: () => void }[], searched: number): void {
      const groups = files.map((f) => ({ ...f, hits: findAll(f.text, query, findOpts()) })).filter((g) => g.hits.length);
      const total = groups.reduce((n, g) => n + g.hits.length, 0);
      clear(results);
      results.hidden = false;
      results.append(h('div', { class: 'npp-res-head' }, h('span', null, `Search results - (${total} hit${total === 1 ? '' : 's'})`), h('button', { class: 'npp-dlg-x', type: 'button', 'aria-label': 'Close search results', onClick: () => { results.hidden = true; } }, '✕')));
      const list = h('div', { class: 'npp-res-list', role: 'tree' });
      list.append(h('div', { class: 'npp-res-q' }, `Search "${query}" (${total} hit${total === 1 ? '' : 's'} in ${groups.length} file${groups.length === 1 ? '' : 's'} of ${searched} searched)`));
      for (const g of groups) {
        list.append(h('div', { class: 'npp-res-file' }, `  ${g.path} (${g.hits.length} hit${g.hits.length === 1 ? '' : 's'})`));
        const lines = g.text.split('\n');
        const seen = new Set<number>();
        for (const hit of g.hits) {
          const ln = g.text.slice(0, hit.start).split('\n').length;
          if (seen.has(ln)) continue;
          seen.add(ln);
          list.append(h('div', { class: 'npp-res-line', role: 'treeitem', tabindex: '0', onDblclick: () => { g.open(); goLine(ln); }, onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { g.open(); goLine(ln); } } }, h('span', { class: 'npp-res-ln' }, `\tLine ${ln}: `), lines[ln - 1]!.trim()));
        }
      }
      results.append(list);
    }

    // ---------------------------------------------------------------- menus
    const ck = (on: boolean): boolean => on;
    const zoom = (z: number): void => { savePrefs({ zoom: Math.max(-6, Math.min(30, z)) }); look(); drawLayer(); };
    const toggleBookmark = (): void => { const l = lineOfPos(ta.selectionStart); const b = doc().bookmarks; if (b.has(l)) b.delete(l); else b.add(l); drawLayer(); };
    const jumpBookmark = (dir: 1 | -1): void => {
      const marks = [...doc().bookmarks].sort((a, b) => a - b);
      if (!marks.length) return;
      const l = lineOfPos(ta.selectionStart);
      const target = dir === 1 ? marks.find((m) => m > l) ?? marks[0]! : [...marks].reverse().find((m) => m < l) ?? marks[marks.length - 1]!;
      goLine(target + 1);
    };
    const selected = (): string => ta.value.slice(ta.selectionStart, ta.selectionEnd);
    const mime = (fn: (s: string) => string | null, what: string): void => {
      const s = selected();
      if (!s) { alertBox('MIME Tools', 'Please select the text you want to convert.'); return; }
      const out = fn(s);
      if (out === null) { alertBox('MIME Tools', `The selected text is not valid ${what}.`); return; }
      const start = ta.selectionStart;
      insert(out);
      ta.setSelectionRange(start, start + out.length);
      drawStatus();
    };
    const toHex = (s: string): string => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    const fromHex = (s: string): string | null => { const c = s.replace(/\s+/g, ''); if (!/^([0-9a-f]{2})+$/i.test(c)) return null; try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(c.match(/../g)!, (x) => parseInt(x, 16))); } catch { return null; } };
    const urlDecode = (s: string): string | null => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return null; } };
    const setLang = (l: Lang): void => { doc().lang = l; drawAll(); saveSessionSoon(); };
    const setEncoding = (e: Encoding, convert: boolean): void => {
      const d = doc();
      if (convert && e === 'ANSI') { const t = encodeFor(ta.value, 'ANSI'); if (t !== ta.value) applyText(t, ta.selectionStart, ta.selectionEnd); }
      d.encoding = e;
      if (convert) d.converted = true;
      drawAll();
    };
    function langMenu(): MenuEntry[] {
      const item = (l: Lang): MenuEntry => ({ label: LANGS[l].name, checked: doc().lang === l, onClick: () => setLang(l) });
      const letter = (ch: string, ls: Lang[]): MenuEntry => ({ label: ch, submenu: ls.map(item) });
      return [item('normal'), '-', letter('B', ['batch']), letter('H', ['html']), letter('I', ['ini']), letter('J', ['javascript', 'json']), letter('M', ['markdown']), letter('P', ['powershell']), letter('X', ['xml'])];
    }
    function tabMenu(i: number): MenuEntry[] {
      const d = docs[i]!;
      return [
        { label: 'Close', shortcut: 'Ctrl+W', onClick: () => closeDoc(i) },
        { label: 'Close All BUT This', onClick: () => closeMany(docs.map((_d, j) => j).filter((j) => j !== i)) },
        { label: 'Close All to the Left', onClick: () => closeMany(docs.map((_d, j) => j).filter((j) => j < i)) },
        { label: 'Close All to the Right', onClick: () => closeMany(docs.map((_d, j) => j).filter((j) => j > i)) },
        '-',
        { label: 'Save', onClick: () => save(d) },
        { label: 'Save As...', onClick: () => saveAs(d) },
        { label: 'Rename', disabled: !d.path, onClick: () => renameDialog(d) },
        { label: 'Move to Recycle Bin', disabled: !d.path || d.readOnly, onClick: () => recycle(i) },
        '-',
        { label: 'Copy Full File Path', disabled: !d.path, onClick: () => copy(d.path) },
        { label: 'Copy Filename', onClick: () => copy(d.name) },
        { label: 'Copy Current Dir. Path', disabled: !d.path, onClick: () => copy(d.path.split('\\').slice(0, -1).join('\\')) },
      ];
    }
    const copy = (s: string): void => { void navigator.clipboard?.writeText(s).catch(() => undefined); toast('Copied to clipboard'); };
    function renameDialog(d: Doc): void {
      const inp = h('input', { class: 'npp-input', value: d.name, 'aria-label': 'New name' });
      modal('Rename Current Tab', [h('label', { class: 'npp-field col' }, 'New name', inp)], [['OK', () => {
        const n = inp.value.trim();
        if (!n || /[\\/:*?"<>|]/.test(n)) return false;
        if (!d.path) { d.name = n; drawAll(); return undefined; }
        const target = `${d.path.split('\\').slice(0, -1).join('\\')}\\${n}`;
        if (fileOf(target)) { toast('There is already a file with the same name in this location.', 'err'); return false; }
        if (d.readOnly) { toast('You need permission to perform this action.', 'err'); return false; }
        const old = d.path;
        if (act((w) => { const f = w.files.find((x) => x.path.toLowerCase() === old.toLowerCase() && !x.deleted); if (f) f.path = target; })) { d.path = target; d.name = n; remember(target); drawAll(); saveSession(); }
        return undefined;
      }], ['Cancel', () => undefined]]);
    }
    function recycle(i: number): void {
      const d = docs[i]!;
      ask('Delete File', `"${d.path}"\nwill be moved to your Recycle Bin and this document will be closed.\nContinue?`, ['Yes', 'No'], (b) => {
        if (b !== 'Yes') return;
        if (act((w) => deleteFile(w, d.path))) { d.saved = d.text; d.path = ''; closeDoc(i); }
      });
    }
    function insertDate(long: boolean): void {
      const now = new Date();
      insert(long ? now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : now.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }));
    }
    function playMacro(times = 1): void {
      ta.focus();
      for (let n = 0; n < times; n++) for (const s of macro) {
        if (s.kind === 'text') insert(s.text);
        else if (s.kind === 'op') runOp(s.op);
        else if (s.key === 'Enter') enter();
        else if (s.key === 'Tab') indent(false);
        else if (s.key === 'Backspace' || s.key === 'Delete') {
          if (ta.selectionStart === ta.selectionEnd) ta.setSelectionRange(s.key === 'Backspace' ? Math.max(0, ta.selectionStart - 1) : ta.selectionStart, s.key === 'Backspace' ? ta.selectionStart : Math.min(ta.value.length, ta.selectionStart + 1));
          insert('');
        }
      }
    }
    function enter(): void {
      const v = ta.value;
      const ls = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const lead = /^[ \t]*/.exec(v.slice(ls, ta.selectionStart))![0];
      insert(`\n${lead}`);
    }
    function menus(): [string, () => MenuEntry[]][] {
      const d = doc();
      const hasSel = ta.selectionEnd > ta.selectionStart;
      return [
        ['File', () => [
          { label: 'New', shortcut: 'Ctrl+N', onClick: newDoc },
          { label: 'Open...', shortcut: 'Ctrl+O', onClick: openDialog },
          { label: 'Open Containing Folder', disabled: !d.path, submenu: [
            { label: 'Explorer', onClick: () => openExplorerHook(d.path.split('\\').slice(0, -1).join('\\')) },
            { label: 'cmd', onClick: () => openProgramHook('cmd') }] },
          { label: 'Reload from Disk', disabled: !d.path, onClick: () => { const f = fileOf(d.path); if (!f) return; const t = detectEncoding(f.content.replace(/\r\n?/g, '\n')).text; d.text = t; d.saved = t; load(); } },
          { label: 'Save', shortcut: 'Ctrl+S', onClick: () => save() },
          { label: 'Save As...', shortcut: 'Ctrl+Alt+S', onClick: () => saveAs() },
          { label: 'Save a Copy As...', onClick: () => { stash(); saveAs(d, undefined, true); } },
          { label: 'Save All', shortcut: 'Ctrl+Shift+S', onClick: saveAll },
          { label: 'Rename...', onClick: () => renameDialog(d) },
          { label: 'Close', shortcut: 'Ctrl+W', onClick: () => closeDoc(cur) },
          { label: 'Close All', shortcut: 'Ctrl+Shift+W', onClick: () => closeMany(docs.map((_d, j) => j)) },
          { label: 'Close Multiple Documents', submenu: [
            { label: 'Close All BUT Current Document', onClick: () => closeMany(docs.map((_d, j) => j).filter((j) => j !== cur)) },
            { label: 'Close All Unchanged', onClick: () => closeMany(docs.map((_d, j) => j).filter((j) => !dirty(docs[j]!))) }] },
          { label: 'Move to Recycle Bin', disabled: !d.path || d.readOnly, onClick: () => recycle(cur) },
          '-',
          ...(p.recent.length ? [...p.recent.slice(0, 9).map((r, i): MenuEntry => ({ label: `${i + 1}: ${r}`, onClick: () => openPath(r) })), { label: 'Empty Recent Files List', onClick: () => savePrefs({ recent: [] }) } as MenuEntry, '-' as MenuEntry] : []),
          { label: 'Exit', shortcut: 'Alt+F4', onClick: () => { saveSession(); win.close(); } },
        ]],
        ['Edit', () => [
          { label: 'Undo', shortcut: 'Ctrl+Z', onClick: () => { ta.focus(); document.execCommand('undo'); changed(); } },
          { label: 'Redo', shortcut: 'Ctrl+Y', onClick: () => { ta.focus(); document.execCommand('redo'); changed(); } },
          '-',
          { label: 'Cut', shortcut: 'Ctrl+X', disabled: !hasSel || d.readOnly, onClick: () => { ta.focus(); document.execCommand('cut'); changed(); } },
          { label: 'Copy', shortcut: 'Ctrl+C', disabled: !hasSel, onClick: () => { ta.focus(); document.execCommand('copy'); } },
          { label: 'Paste', shortcut: 'Ctrl+V', disabled: d.readOnly, onClick: () => { void navigator.clipboard?.readText().then((t) => insert(t)).catch(() => toast('Press Ctrl+V to paste')); } },
          { label: 'Delete', shortcut: 'DEL', disabled: !hasSel || d.readOnly, onClick: () => insert('') },
          { label: 'Select All', shortcut: 'Ctrl+A', onClick: () => { ta.focus(); ta.select(); drawStatus(); } },
          '-',
          { label: 'Insert', submenu: [{ label: 'Date Time (short)', onClick: () => insertDate(false) }, { label: 'Date Time (long)', onClick: () => insertDate(true) }] },
          { label: 'Copy to Clipboard', submenu: [
            { label: 'Copy Current Full File path', disabled: !d.path, onClick: () => copy(d.path) },
            { label: 'Copy Current Filename', onClick: () => copy(d.name) },
            { label: 'Copy Current Dir. Path', disabled: !d.path, onClick: () => copy(d.path.split('\\').slice(0, -1).join('\\')) }] },
          { label: 'Indent', submenu: [{ label: 'Increase Line Indent', shortcut: 'Tab', onClick: () => indent(false) }, { label: 'Decrease Line Indent', shortcut: 'Shift+Tab', onClick: () => indent(true) }] },
          { label: 'Convert Case to', submenu: [{ label: 'UPPERCASE', shortcut: 'Ctrl+Shift+U', onClick: () => runOp('upper') }, { label: 'lowercase', shortcut: 'Ctrl+U', onClick: () => runOp('lower') }] },
          { label: 'Line Operations', submenu: [
            { label: 'Duplicate Current Line', shortcut: 'Ctrl+D', onClick: () => runOp('duplicate') },
            { label: 'Delete Current Line', shortcut: 'Ctrl+Shift+L', onClick: () => runOp('delete') },
            { label: 'Join Lines', shortcut: 'Ctrl+J', onClick: () => runOp('join') },
            { label: 'Move Up Current Line', shortcut: 'Ctrl+Shift+Up', onClick: () => runOp('moveUp') },
            { label: 'Move Down Current Line', shortcut: 'Ctrl+Shift+Down', onClick: () => runOp('moveDown') },
            { label: 'Remove Empty Lines (Containing Blank characters)', onClick: () => runOp('removeEmpty') },
            '-',
            { label: 'Sort Lines Lexicographically Ascending', onClick: () => runOp('sortAsc') },
            { label: 'Sort Lines Lexicographically Descending', onClick: () => runOp('sortDesc') }] },
          { label: 'Comment/Uncomment', submenu: [{ label: 'Toggle Single Line Comment', shortcut: 'Ctrl+Q', disabled: !LANGS[d.lang].comment, onClick: () => runOp('comment') }] },
          { label: 'Blank Operations', submenu: [{ label: 'Trim Trailing Space', onClick: () => runOp('trimTrailing') }] },
          '-',
          { label: 'Read-Only', checked: d.readOnly, disabled: true },
        ]],
        ['Search', () => [
          { label: 'Find...', shortcut: 'Ctrl+F', onClick: () => findDialog('Find') },
          { label: 'Find in Files...', shortcut: 'Ctrl+Shift+F', onClick: () => findDialog('Find in Files') },
          { label: 'Find Next', shortcut: 'F3', onClick: () => findAgain(false) },
          { label: 'Find Previous', shortcut: 'Shift+F3', onClick: () => findAgain(true) },
          { label: 'Replace...', shortcut: 'Ctrl+H', onClick: () => findDialog('Replace') },
          { label: 'Go To...', shortcut: 'Ctrl+G', onClick: goToDialog },
          '-',
          { label: 'Mark...', shortcut: 'Ctrl+M', onClick: () => findDialog('Mark') },
          { label: 'Bookmark', submenu: [
            { label: 'Toggle Bookmark', shortcut: 'Ctrl+F2', onClick: toggleBookmark },
            { label: 'Next Bookmark', shortcut: 'F2', onClick: () => jumpBookmark(1) },
            { label: 'Previous Bookmark', shortcut: 'Shift+F2', onClick: () => jumpBookmark(-1) },
            { label: 'Clear All Bookmarks', onClick: () => { d.bookmarks.clear(); drawLayer(); } }] },
        ]],
        ['View', () => [
          { label: 'Show Symbol', submenu: [{ label: 'Show All Characters', checked: ck(p.showAll), onClick: () => { savePrefs({ showAll: !p.showAll }); look(); drawLayer(); } }] },
          { label: 'Zoom', submenu: [
            { label: 'Zoom In (Ctrl+Mouse Wheel Up)', shortcut: 'Ctrl+Num +', onClick: () => zoom(p.zoom + 1) },
            { label: 'Zoom Out (Ctrl+Mouse Wheel Down)', shortcut: 'Ctrl+Num -', onClick: () => zoom(p.zoom - 1) },
            { label: 'Restore Default Zoom', shortcut: 'Ctrl+Num /', onClick: () => zoom(0) }] },
          { label: 'Word wrap', checked: ck(p.wrap), onClick: () => { savePrefs({ wrap: !p.wrap }); look(); drawLayer(); } },
          '-',
          { label: 'Summary...', onClick: summary },
        ]],
        ['Encoding', () => [
          { label: 'ANSI', checked: d.encoding === 'ANSI', onClick: () => setEncoding('ANSI', false) },
          { label: 'UTF-8', checked: d.encoding === 'UTF-8', onClick: () => setEncoding('UTF-8', false) },
          { label: 'UTF-8-BOM', checked: d.encoding === 'UTF-8-BOM', onClick: () => setEncoding('UTF-8-BOM', false) },
          '-',
          { label: 'Convert to ANSI', onClick: () => setEncoding('ANSI', true) },
          { label: 'Convert to UTF-8', onClick: () => setEncoding('UTF-8', true) },
          { label: 'Convert to UTF-8-BOM', onClick: () => setEncoding('UTF-8-BOM', true) },
        ]],
        ['Language', langMenu],
        ['Settings', () => [{ label: 'Preferences...', onClick: preferences }]],
        ['Tools', () => [
          { label: 'SHA-1', submenu: [{ label: 'Generate...', onClick: () => { void hashDialog('SHA-1'); } }] },
          { label: 'SHA-256', submenu: [{ label: 'Generate...', onClick: () => { void hashDialog('SHA-256'); } }] },
          { label: 'SHA-512', submenu: [{ label: 'Generate...', onClick: () => { void hashDialog('SHA-512'); } }] },
        ]],
        ['Macro', () => [
          { label: 'Start Recording', shortcut: 'Ctrl+Shift+R', disabled: !!recording, onClick: () => { recording = []; drawAll(); } },
          { label: 'Stop Recording', shortcut: 'Ctrl+Shift+R', disabled: !recording, onClick: () => { macro = recording ?? []; recording = null; drawAll(); } },
          { label: 'Playback', shortcut: 'Ctrl+Shift+P', disabled: !!recording || !macro.length, onClick: () => playMacro() },
          { label: 'Run a Macro Multiple Times...', disabled: !!recording || !macro.length, onClick: () => {
            const n = h('input', { class: 'npp-input', type: 'number', min: '1', value: '1', 'aria-label': 'Run times' });
            modal('Run a Macro Multiple Times', [h('label', { class: 'npp-field' }, 'Run', n, 'times')], [['Run', () => { playMacro(Math.min(500, Math.max(1, Number(n.value) || 1))); }], ['Cancel', () => undefined]]);
          } },
        ]],
        ['Run', () => [
          { label: 'Run...', shortcut: 'F5', onClick: runDialog },
          { label: 'Run in PowerShell', disabled: !/\.ps1$/i.test(d.path), onClick: () => { if (dirty(d)) save(); openFileHook(d.path, 'run'); } },
          { label: 'Run batch file', disabled: !/\.(bat|cmd)$/i.test(d.path), onClick: () => { if (dirty(d)) save(); openFileHook(d.path, 'run'); } },
        ]],
        ['Plugins', () => [
          { label: 'Converter', submenu: [{ label: 'ASCII -> HEX', onClick: () => mime(toHex, 'text') }, { label: 'HEX -> ASCII', onClick: () => mime(fromHex, 'HEX') }] },
          { label: 'MIME Tools', submenu: [
            { label: 'Base64 Encode', onClick: () => mime(base64Encode, 'text') },
            { label: 'Base64 Decode', onClick: () => mime(base64Decode, 'Base64') },
            '-',
            { label: 'URL Encode', onClick: () => mime((s) => encodeURIComponent(s), 'text') },
            { label: 'URL Decode', onClick: () => mime(urlDecode, 'URL encoding') }] },
          '-',
          { label: 'Plugins Admin...', onClick: () => alertBox('Plugins Admin', 'Installed\n\nComparePlugin ... not installed\nConverter  4.6\nMIME Tools  3.1\n\nThe range workstation has no internet plugin list; Converter and MIME Tools ship with Notepad++.') },
        ]],
        ['Window', () => [
          ...docs.map((x, i): MenuEntry => ({ label: `${i + 1}: ${x.path || x.name}`, checked: i === cur, onClick: () => switchTo(i) })),
          '-',
          { label: 'Sort By', submenu: [
            { label: 'Name A to Z', onClick: () => { stash(); const c = doc(); docs.sort((a, b) => a.name.localeCompare(b.name)); cur = docs.indexOf(c); drawAll(); } },
            { label: 'Name Z to A', onClick: () => { stash(); const c = doc(); docs.sort((a, b) => b.name.localeCompare(a.name)); cur = docs.indexOf(c); drawAll(); } }] },
        ]],
        ['?', () => [
          { label: 'Notepad++ Online User Manual', onClick: () => openUrlHook('https://npp-user-manual.org/') },
          { label: 'Notepad++ Home', onClick: () => openUrlHook('https://notepad-plus-plus.org/') },
          '-',
          { label: 'About Notepad++', shortcut: 'F1', onClick: about },
        ]],
      ];
    }
    function drawMenubar(): void {
      clear(menubar);
      for (const [label] of menus()) {
        const b = h('button', { class: 'npp-menu', type: 'button', role: 'menuitem', onMousedown: (e: Event) => e.preventDefault(), onClick: () => { stash(); const r = b.getBoundingClientRect(); closeMenus(); showMenu(r.left, r.bottom, menus().find(([l]) => l === label)![1]()); } }, label);
        menubar.append(b);
      }
      menubar.append(h('span', { class: 'npp-menu-spacer' }), h('button', { class: 'npp-menu', type: 'button', title: 'Close current document', onClick: () => closeDoc(cur) }, '✕'));
    }
    function drawToolbar(): void {
      const d = doc();
      clear(toolbar);
      const tb = (glyph: string, label: string, fn: () => void, opts: { cls?: string; on?: boolean; disabled?: boolean; text?: boolean } = {}): HTMLButtonElement =>
        h('button', { class: `npp-tb ${opts.cls ?? ''}${opts.on ? ' on' : ''}`, type: 'button', title: label, 'aria-label': label, disabled: !!opts.disabled, onMousedown: (e: Event) => e.preventDefault(), onClick: fn }, opts.text ? glyph : h('span', { class: 'mdl' }, glyph));
      const sep = (): HTMLElement => h('span', { class: 'npp-tb-sep' });
      toolbar.append(
        tb('', 'New', newDoc, { cls: 'c-new' }), tb('', 'Open', openDialog, { cls: 'c-open' }), tb('', 'Save', () => save(), { cls: 'c-save', disabled: !dirty(d) && !!d.path }), tb('', 'Save All', saveAll, { cls: 'c-save' }),
        tb('', 'Close', () => closeDoc(cur), { cls: 'c-close' }), tb('', 'Close All', () => closeMany(docs.map((_x, j) => j)), { cls: 'c-close' }), sep(),
        tb('', 'Cut', () => { ta.focus(); document.execCommand('cut'); changed(); }), tb('', 'Copy', () => { ta.focus(); document.execCommand('copy'); }), tb('', 'Paste', () => { void navigator.clipboard?.readText().then((t) => insert(t)).catch(() => toast('Press Ctrl+V to paste')); }), sep(),
        tb('', 'Undo', () => { ta.focus(); document.execCommand('undo'); changed(); }), tb('', 'Redo', () => { ta.focus(); document.execCommand('redo'); changed(); }), sep(),
        tb('', 'Find', () => findDialog('Find'), { cls: 'c-find' }), tb('', 'Replace', () => findDialog('Replace'), { cls: 'c-find' }), sep(),
        tb('', 'Zoom in (Ctrl+Mouse Wheel Up)', () => zoom(p.zoom + 1)), tb('', 'Zoom out (Ctrl+Mouse Wheel Down)', () => zoom(p.zoom - 1)), sep(),
        tb('', 'Word wrap', () => { savePrefs({ wrap: !p.wrap }); look(); drawLayer(); drawToolbar(); }, { on: p.wrap }),
        tb('¶', 'Show All Characters', () => { savePrefs({ showAll: !p.showAll }); look(); drawLayer(); drawToolbar(); }, { on: p.showAll, text: true }), sep(),
        tb('', 'Start Recording', () => { recording = []; drawAll(); }, { cls: 'c-rec', disabled: !!recording }),
        tb('', 'Stop Recording', () => { macro = recording ?? []; recording = null; drawAll(); }, { disabled: !recording }),
        tb('', 'Playback', () => playMacro(), { cls: 'c-play', disabled: !!recording || !macro.length }), sep(),
        tb('', 'Run... (F5)', runDialog));
    }

    // ---------------------------------------------------------------- events
    ta.addEventListener('scroll', syncScroll);
    ta.addEventListener('input', changed);
    ta.addEventListener('beforeinput', (e) => {
      if (ovr && e.inputType === 'insertText' && ta.selectionStart === ta.selectionEnd && ta.value[ta.selectionStart] && ta.value[ta.selectionStart] !== '\n') ta.setSelectionRange(ta.selectionStart, ta.selectionStart + 1);
      if (recording) {
        if (e.inputType === 'insertText' && e.data) recording.push({ kind: 'text', text: e.data });
        else if (e.inputType === 'deleteContentBackward') recording.push({ kind: 'key', key: 'Backspace' });
        else if (e.inputType === 'deleteContentForward') recording.push({ kind: 'key', key: 'Delete' });
      }
    });
    const caret = (): void => { drawStatus(); drawLayer(); };
    ta.addEventListener('keyup', (e) => { if (/^(Arrow|Page|Home|End)/.test(e.key)) caret(); });
    ta.addEventListener('mouseup', caret);
    ta.addEventListener('select', drawStatus);
    ta.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const has = ta.selectionEnd > ta.selectionStart;
      showMenu(e.clientX, e.clientY, [
        { label: 'Cut', disabled: !has || ta.readOnly, onClick: () => { ta.focus(); document.execCommand('cut'); changed(); } },
        { label: 'Copy', disabled: !has, onClick: () => { ta.focus(); document.execCommand('copy'); } },
        { label: 'Paste', disabled: ta.readOnly, onClick: () => { void navigator.clipboard?.readText().then((t) => insert(t)).catch(() => toast('Press Ctrl+V to paste')); } },
        { label: 'Delete', disabled: !has || ta.readOnly, onClick: () => insert('') },
        '-',
        { label: 'Select All', onClick: () => { ta.focus(); ta.select(); drawStatus(); } },
        '-',
        { label: 'UPPERCASE', disabled: !has, onClick: () => runOp('upper') },
        { label: 'lowercase', disabled: !has, onClick: () => runOp('lower') },
        '-',
        { label: 'Toggle Single Line Comment', disabled: !LANGS[doc().lang].comment, onClick: () => runOp('comment') },
        { label: 'Base64 Decode', disabled: !has, onClick: () => mime(base64Decode, 'Base64') },
      ]);
    });
    gutter.addEventListener('mousedown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.npp-ln');
      if (!row) return;
      e.preventDefault();
      const l = Number(row.dataset.line);
      if (e.offsetX < 12) { const b = doc().bookmarks; if (b.has(l)) b.delete(l); else b.add(l); drawLayer(); return; }
      const lines = ta.value.split('\n');
      const s = lines.slice(0, l).reduce((n, x) => n + x.length + 1, 0);
      selectRange({ start: s, end: Math.min(ta.value.length, s + lines[l]!.length + 1) });
    });
    scroll.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); zoom(p.zoom + (e.deltaY < 0 ? 1 : -1)); } }, { passive: false });
    const ro = new ResizeObserver(() => drawLayer());
    ro.observe(scroll);
    const themeWatch = new MutationObserver(() => { look(); });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    root.addEventListener('keydown', (e) => {
      const k = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      const inEditor = e.target === ta;
      const hit = (fn: () => void): void => { e.preventDefault(); e.stopPropagation(); fn(); };
      if (ctrl && e.altKey && k.toLowerCase() === 's') return hit(() => saveAs());
      if (ctrl && e.shiftKey) {
        switch (k.toLowerCase()) {
          case 's': return hit(saveAll);
          case 'w': return hit(() => closeMany(docs.map((_d, j) => j)));
          case 'f': return hit(() => findDialog('Find in Files'));
          case 'l': return hit(() => runOp('delete'));
          case 'u': return hit(() => runOp('upper'));
          case 'r': return hit(() => { if (recording) { macro = recording; recording = null; } else recording = []; drawAll(); });
          case 'p': return hit(() => playMacro());
          case 'arrowup': return hit(() => runOp('moveUp'));
          case 'arrowdown': return hit(() => runOp('moveDown'));
          case 'tab': return hit(() => switchTo((cur - 1 + docs.length) % docs.length));
        }
      }
      if (ctrl && !e.shiftKey && !e.altKey) {
        switch (k.toLowerCase()) {
          case 'n': return hit(newDoc);
          case 'o': return hit(openDialog);
          case 's': return hit(() => save());
          case 'w': return hit(() => closeDoc(cur));
          case 'f': return hit(() => findDialog('Find'));
          case 'h': return hit(() => findDialog('Replace'));
          case 'g': return hit(goToDialog);
          case 'm': return hit(() => findDialog('Mark'));
          case 'd': return hit(() => runOp('duplicate'));
          case 'j': return hit(() => runOp('join'));
          case 'q': return hit(() => runOp('comment'));
          case 'u': return hit(() => runOp('lower'));
          case 'tab': return hit(() => switchTo((cur + 1) % docs.length));
          case 'f2': return hit(toggleBookmark);
          case '+': case '=': return hit(() => zoom(p.zoom + 1));
          case '-': return hit(() => zoom(p.zoom - 1));
          case '/': case '0': return hit(() => zoom(0));
        }
      }
      if (k === 'F1') return hit(about);
      if (k === 'F2') return hit(() => jumpBookmark(e.shiftKey ? -1 : 1));
      if (k === 'F3') return hit(() => findAgain(e.shiftKey));
      if (k === 'F5') return hit(runDialog);
      if (!inEditor) return;
      if (k === 'Insert' && !ctrl && !e.shiftKey) return hit(() => { ovr = !ovr; drawStatus(); });
      if (k === 'Tab' && !ctrl) return hit(() => { indent(e.shiftKey); if (recording && !e.shiftKey) recording.push({ kind: 'key', key: 'Tab' }); });
      if (k === 'Enter' && !ctrl && !e.altKey && !ta.readOnly) return hit(() => { enter(); if (recording) recording.push({ kind: 'key', key: 'Enter' }); });
    });

    onOpenArg(win, (a) => { if (a) openPath(a); });
    restoreSession();
    drawMenubar();
    load();
    if (win.arg) openPath(win.arg);
    return {
      dispose: () => { saveSession(); ro.disconnect(); themeWatch.disconnect(); clearTimeout(sessionTimer); root.remove(); },
    };
  },
};

// Launchers are set by ui/launch.ts, which imports this module (no import cycle).
let openFileHook: (path: string, mode: 'open' | 'run') => void = () => undefined;
let openProgramHook: (name: string) => void = () => undefined;
let openExplorerHook: (dir: string) => void = () => undefined;
let openUrlHook: (url: string) => void = () => undefined;
export function setNotepadppLaunchers(l: { file: typeof openFileHook; program: typeof openProgramHook; explorer: typeof openExplorerHook; url: typeof openUrlHook }): void {
  openFileHook = l.file; openProgramHook = l.program; openExplorerHook = l.explorer; openUrlHook = l.url;
}
