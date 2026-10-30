/**
 * Windows PowerShell, Notepad, File Explorer and Event Viewer.
 */
import { fmt } from '../../core/time.ts';
import { newBook, newDeck, newWord, writeBook, writeDeck, writeWord } from '../../core/office.ts';
import type { World } from '../../core/types.ts';
import { deleteFile, emptyRecycleBin, homeDir, newFile, renameFile, restoreFile, writeFile } from '../../world/docs.ts';
import { Shell } from '../../terminal/shell.ts';
import { CMDLETS } from '../../terminal/cmdlets.ts';
import { clear, h, toast } from '../dom.ts';
import { type MenuEntry, showMenu } from '../ctxmenu.ts';
import { act, notify, persist, store, subscribe } from '../store.ts';
import { tenantLookup, worldByDomain } from '../companies.ts';
import { type SmallIcon, fileGlyph, glyph } from '../icons.ts';
import { type AppDef, onOpenArg, openApp } from '../wm.ts';

// ------------------------------------------------------------------- Windows PowerShell

/** Open braces, brackets or quotes still waiting to be closed: PowerShell shows ">>" and keeps reading. */
function incomplete(src: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quote) { if (c === '`') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
  }
  return depth > 0 || quote !== null || /`\s*$/.test(src);
}

export interface PsWindowControl {
  run(cmd: string, echo?: boolean): void;
}

export function mountPowerShell(host: HTMLElement, opts: { onExit?: () => void; script?: string; compact?: boolean; cwd?: string; world?: () => World; setup?: (sh: Shell) => void } = {}): { control: PsWindowControl; dispose: () => void; shell: Shell } {
  // Cloud Shell runs in a tenant's world; every other host in the workstation's.
  const worldOf = opts.world ?? ((): World => store.world);
  const sh = new Shell(worldOf(), CMDLETS);
  sh.resolveServer = worldByDomain;
  sh.resolveTenant = tenantLookup;
  opts.setup?.(sh);
  if (opts.cwd) sh.cwd = opts.cwd;
  const out = h('div', { class: 'ps-out', 'aria-live': 'polite' });
  const input = h('input', { class: 'ps-in', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'PowerShell command' });
  const prompt = h('span', { class: 'ps-prompt' });
  let hist = -1;
  let pending = '';
  let tabCycle: { base: string; hits: string[]; i: number } | null = null;
  const line = (text: string, cls = ''): void => { out.appendChild(h('div', { class: `ps-line ${cls}` }, text || ' ')); };
  // A missing mandatory parameter: PowerShell asks for it by name, as in a real console.
  const setPrompt = (): void => { prompt.textContent = sh.pendingPrompt ? `${sh.pendingPrompt.param}: ` : pending ? '>> ' : `PS ${sh.cwd}> `; };
  if (!opts.compact) {
    line('Windows PowerShell');
    line('Copyright (C) Microsoft Corporation. All rights reserved.');
    line('');
    line('Install the latest PowerShell for new features and improvements! https://aka.ms/PSWindows');
    line('');
  }
  const exec = (cmd: string, answer = false): void => {
    sh.setWorld(worldOf());
    for (const l of answer ? sh.answerPrompt(cmd) : sh.run(cmd)) {
      if (l.text === '\u0000CLEAR') { clear(out); continue; }
      if (l.text === '\u0000EXIT') { opts.onExit?.(); continue; }
      if (l.text.startsWith('\u0000OPEN:')) { openHook(l.text.slice(6)); continue; }
      for (const part of l.text.split('\n')) line(part, l.kind === 'err' ? 'err' : l.kind === 'warn' ? 'warn' : l.kind === 'host' ? `host ${l.color ?? ''}` : '');
    }
    if (cmd.trim()) { persist(); notify(); }
  };
  const control: PsWindowControl = {
    run(cmd, echo = true) {
      if (echo) line(`PS ${sh.cwd}> ${cmd}`, 'echo');
      exec(cmd);
      setPrompt();
      (out.parentElement ?? out).scrollTop = 1e9;
    },
  };
  setPrompt();
  const unsub = subscribe(() => sh.setWorld(worldOf()));
  const complete = (): void => {
    const v = input.value.slice(0, input.selectionStart ?? input.value.length);
    const after = input.value.slice(input.selectionStart ?? input.value.length);
    if (!tabCycle) {
      const tok = /(\S*)$/.exec(v)![1]!;
      const before = v.slice(0, v.length - tok.length);
      let hits: string[] = [];
      if (tok.startsWith('-')) {
        const segment = before.split('|').pop()!.trim();
        const cmdName = segment.split(/\s+/)[0] ?? '';
        const def = CMDLETS.find((c) => c.name.toLowerCase() === cmdName.toLowerCase() || c.aliases?.some((a) => a.toLowerCase() === cmdName.toLowerCase()));
        const fn = sh.functions.get(cmdName.toLowerCase());
        const names = def ? [...(def.params ?? []), ...(def.switches ?? []), 'Verbose', 'ErrorAction', 'WhatIf', 'Confirm'] : fn ? fn.params.map((x) => x.name) : [];
        hits = names.filter((n) => n.toLowerCase().startsWith(tok.slice(1).toLowerCase())).map((n) => `-${n}`);
      } else if (tok.startsWith('$')) {
        hits = [...sh.vars.keys(), 'true', 'false', 'null', 'env:USERNAME', 'PSVersionTable'].filter((n) => n.startsWith(tok.slice(1).toLowerCase())).map((n) => `$${n}`);
      } else if (/[\\.]/.test(tok) || before.trim().length) {
        const raw = tok.replace(/^['"]/, '');
        const dirPart = raw.includes('\\') ? raw.slice(0, raw.lastIndexOf('\\') + 1) : '.\\';
        const namePart = raw.slice(dirPart === '.\\' && !raw.startsWith('.\\') ? 0 : dirPart.length);
        const abs = sh.resolvePath(dirPart).toLowerCase();
        const seen = new Set<string>();
        for (const f of store.world.files) {
          if (f.deleted || !f.path.toLowerCase().startsWith(`${abs}\\`)) continue;
          const first = f.path.slice(abs.length + 1).split('\\')[0]!;
          if (first.toLowerCase().startsWith(namePart.toLowerCase())) seen.add(first);
        }
        hits = [...seen].sort().map((n) => { const p = `${dirPart}${n}`; return /\s/.test(p) ? `'${p}'` : p; });
        if (!hits.length && !before.trim()) hits = CMDLETS.map((c) => c.name).filter((n) => n.toLowerCase().startsWith(tok.toLowerCase()));
      } else {
        hits = [...CMDLETS.map((c) => c.name), ...sh.functions.keys()].filter((n) => n.toLowerCase().startsWith(tok.toLowerCase())).sort();
      }
      if (!hits.length) return;
      tabCycle = { base: before, hits, i: 0 };
    } else tabCycle.i = (tabCycle.i + 1) % tabCycle.hits.length;
    input.value = tabCycle.base + tabCycle.hits[tabCycle.i] + after;
    const pos = (tabCycle.base + tabCycle.hits[tabCycle.i]).length;
    input.setSelectionRange(pos, pos);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') tabCycle = null;
    if (e.key === 'Enter') {
      const cmd = input.value;
      input.value = '';
      hist = -1;
      line(`${prompt.textContent}${cmd}`, 'echo');
      if (sh.pendingPrompt) { exec(cmd, true); setPrompt(); (out.parentElement ?? out).scrollTop = 1e9; return; }
      const full = pending ? `${pending}\n${cmd}` : cmd;
      if (incomplete(full) && cmd.trim() !== '') { pending = full; setPrompt(); (out.parentElement ?? out).scrollTop = 1e9; return; }
      pending = '';
      if (full.trim()) exec(full);
      setPrompt();
      (out.parentElement ?? out).scrollTop = 1e9;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const hs = sh.history;
      if (!hs.length) return;
      hist = e.key === 'ArrowUp' ? (hist < 0 ? hs.length - 1 : Math.max(0, hist - 1)) : hist < 0 ? -1 : Math.min(hs.length, hist + 1);
      input.value = hist >= 0 && hist < hs.length ? hs[hist]! : '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'Escape') {
      input.value = '';
    } else if (e.key === 'c' && e.ctrlKey && !input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)) {
      e.preventDefault();
      line(`${prompt.textContent}${input.value}^C`, 'echo');
      input.value = '';
      pending = '';
      sh.pendingPrompt = null;
      setPrompt();
    } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); clear(out); }
  });
  const wrap = h('div', { class: 'ps', onClick: () => { if (!window.getSelection()?.toString()) input.focus(); } }, out, h('div', { class: 'ps-row' }, prompt, input));
  // conhost: right-click copies a selection, or pastes when nothing is selected.
  wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const sel = window.getSelection()?.toString() ?? '';
    if (sel) { void navigator.clipboard?.writeText(sel).catch(() => undefined); window.getSelection()?.removeAllRanges(); return; }
    navigator.clipboard?.readText().then((t) => { input.value += t.replace(/\r?\n/g, ' '); input.focus(); }).catch(() => input.focus());
  });
  host.appendChild(wrap);
  setTimeout(() => input.focus(), 0);
  if (opts.script) setTimeout(() => control.run(`& '${opts.script}'`), 30);
  return { control, dispose: unsub, shell: sh };
}

let openHook: (target: string) => void = () => {};
/** How Start-Process / notepad / ise / Invoke-Item open things on the desktop. */
export function setPowerShellOpener(fn: (target: string) => void): void {
  openHook = fn;
}

/** Shells (PowerShell, Command Prompt) ask the desktop to open something: "kind:target". */
export function openFromShell(target: string): void {
  openHook(target);
}

export function powershellWindow(script?: string, cwd?: string): AppDef {
  return {
    id: script || cwd ? `powershell:${script ?? cwd}:${Date.now()}` : 'powershell',
    title: 'Administrator: Windows PowerShell',
    icon: 'powershell',
    width: 920,
    height: 560,
    mount(host, win) {
      const ps = mountPowerShell(host, { onExit: () => win.close(), script, cwd });
      return { dispose: ps.dispose };
    },
  };
}

export const powershellApp: AppDef = powershellWindow();

// ------------------------------------------------------------------- Notepad

export interface NotepadPrefs { wrap: boolean; status: boolean; zoom: number; font: string; size: number }
const NP_DEFAULTS: NotepadPrefs = { wrap: true, status: true, zoom: 100, font: 'Consolas', size: 15 };
const npPrefs = (): NotepadPrefs => ({ ...NP_DEFAULTS, ...(store.settings.notepad ?? {}) });

/**
 * Notepad, as in Windows 11: File (New, New window, Open, Save, Save as,
 * Print, Close), Edit (Undo, Cut, Copy, Paste, Delete, Search with Bing,
 * Find, Find next/previous, Replace, Go to, Select all, Time/Date, Font) and
 * View (Zoom, Status bar, Word wrap), with the same shortcuts.
 */
export function notepadApp(path: string): AppDef {
  const startName = path ? path.split('\\').pop()! : 'Untitled.txt';
  return {
    id: `notepad:${path || Date.now()}`,
    title: `${startName} - Notepad`,
    icon: 'notepad',
    width: 820,
    height: 580,
    mount(host, win) {
      let current = path;
      const file = (): World['files'][number] | undefined => store.world.files.find((x) => x.path === current && !x.deleted);
      const text = h('textarea', { class: 'np-text', spellcheck: 'false', 'aria-label': 'Text editor' }, file()?.content ?? '');
      const status = h('div', { class: 'np-status' });
      const findBar = h('div', { class: 'np-find', hidden: true });
      const root = h('div', { class: 'np' });
      let dirty = false;
      let lastFind = '';
      const name = (): string => (current ? current.split('\\').pop()! : 'Untitled.txt');
      const setTitle = (): void => win.setTitle(`${dirty ? '*' : ''}${name()} - Notepad`);
      const prefs = (): NotepadPrefs => npPrefs();
      const savePrefs = (patch: Partial<NotepadPrefs>): void => { store.settings.notepad = { ...prefs(), ...patch }; persist(); look(); };
      const look = (): void => {
        const p = prefs();
        text.wrap = p.wrap ? 'soft' : 'off';
        text.classList.toggle('nowrap', !p.wrap);
        text.style.fontFamily = `'${p.font}', Consolas, monospace`;
        text.style.fontSize = `${Math.round(p.size * p.zoom / 100)}px`;
        status.hidden = !p.status;
        pos();
      };
      const pos = (): void => {
        const before = text.value.slice(0, text.selectionStart);
        const ln = before.split('\n').length;
        const col = before.length - before.lastIndexOf('\n');
        clear(status);
        const sel = text.selectionEnd - text.selectionStart;
        status.append(h('span', null, `Ln ${ln}, Col ${col}${sel ? `  (${sel} selected)` : ''}`), h('span', null, `${text.value.length} characters`), h('span', null, `${prefs().zoom}%`), h('span', null, 'Windows (CRLF)'), h('span', null, 'UTF-8'));
      };
      const save = (target = current): void => {
        const f = file();
        if (!target || (f?.readOnly && target === current)) return saveAs();
        if (act((w) => writeFile(w, target, text.value))) { current = target; dirty = false; setTitle(); toast(`Saved ${name()}`, 'ok'); }
      };
      const saveAs = (): void => {
        root.querySelector('.np-saveas')?.remove();
        const folders = ['Desktop', 'Documents', 'Documents\\Evidence', 'Documents\\Scripts', 'Downloads'].map((d) => `${homeDir(store.world)}\\${d}`);
        const folder = h('select', { class: 'w-input', 'aria-label': 'Folder' }, folders.map((d) => h('option', { value: d, selected: current ? current.startsWith(d + '\\') : d.endsWith('Documents') }, d.replace(homeDir(store.world) + '\\', ''))));
        const box = h('input', { class: 'w-input', value: name(), 'aria-label': 'File name' });
        const type = h('select', { class: 'w-input', 'aria-label': 'Save as type' }, [['', 'All files (*.*)'], ['.txt', 'Text Documents (*.txt)'], ['.bat', 'Batch file (*.bat)'], ['.ps1', 'PowerShell script (*.ps1)'], ['.csv', 'CSV (*.csv)'], ['.md', 'Markdown (*.md)']].map(([v, l]) => h('option', { value: v }, l)));
        const doSave = (): void => {
          let n = box.value.trim();
          if (!n) return;
          if (type.value && !n.toLowerCase().endsWith(type.value)) n = n.replace(/\.[^.]*$/, '') + type.value;
          save(`${folder.value}\\${n}`);
          bar.remove();
        };
        box.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') bar.remove(); });
        const bar = h('div', { class: 'np-saveas' }, h('span', null, file()?.readOnly ? 'This file is read-only. Save a copy:' : 'Save as:'), folder, box, type,
          h('button', { class: 'w-btn accent', type: 'button', onClick: doSave }, 'Save'),
          h('button', { class: 'w-btn', type: 'button', onClick: () => bar.remove() }, 'Cancel'));
        root.insertBefore(bar, text);
        box.focus();
        box.setSelectionRange(0, Math.max(0, box.value.lastIndexOf('.')));
      };
      const openDialog = (): void => {
        root.querySelector('.np-saveas')?.remove();
        const files = store.world.files.filter((f) => !f.deleted && /\.(txt|md|csv|ps1|bat|cmd|log|json|ini)$/i.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
        const bar = h('div', { class: 'np-saveas np-open' }, h('span', null, 'Open:'),
          h('select', { class: 'w-input', 'aria-label': 'File', onChange: (e: Event) => { openApp(notepadApp((e.target as HTMLSelectElement).value)); bar.remove(); } },
            h('option', { value: '' }, 'Choose a file...'), files.map((f) => h('option', { value: f.path }, f.path.replace(homeDir(store.world) + '\\', '')))),
          h('button', { class: 'w-btn', type: 'button', onClick: () => bar.remove() }, 'Cancel'));
        root.insertBefore(bar, text);
      };
      const find = (forward = true, needle = lastFind, matchCase = false): boolean => {
        if (!needle) return false;
        lastFind = needle;
        const hay = matchCase ? text.value : text.value.toLowerCase();
        const n = matchCase ? needle : needle.toLowerCase();
        let i = forward ? hay.indexOf(n, text.selectionEnd) : hay.lastIndexOf(n, Math.max(0, text.selectionStart - 1));
        if (i < 0) i = forward ? hay.indexOf(n) : hay.lastIndexOf(n);
        if (i < 0) { toast(`Cannot find "${needle}"`); return false; }
        text.focus();
        text.setSelectionRange(i, i + needle.length);
        const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 20;
        text.scrollTop = Math.max(0, text.value.slice(0, i).split('\n').length * lineHeight - text.clientHeight / 2);
        pos();
        return true;
      };
      const openFind = (replace: boolean): void => {
        findBar.hidden = false;
        clear(findBar);
        const sel = text.value.slice(text.selectionStart, text.selectionEnd);
        const q = h('input', { class: 'w-input', placeholder: 'Find', value: sel || lastFind, 'aria-label': 'Find' });
        const r = h('input', { class: 'w-input', placeholder: 'Replace', 'aria-label': 'Replace', hidden: !replace });
        const mc = h('input', { type: 'checkbox', 'aria-label': 'Match case' });
        const replaceOne = (): void => {
          const s = text.value.slice(text.selectionStart, text.selectionEnd);
          if (s && (mc.checked ? s === q.value : s.toLowerCase() === q.value.toLowerCase())) { text.setRangeText(r.value, text.selectionStart, text.selectionEnd, 'end'); dirty = true; setTitle(); }
          find(true, q.value, mc.checked);
        };
        const replaceAll = (): void => {
          if (!q.value) return;
          const re = new RegExp(q.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), mc.checked ? 'g' : 'gi');
          const count = (text.value.match(re) ?? []).length;
          text.value = text.value.replace(re, r.value);
          dirty = true;
          setTitle();
          toast(`Replaced ${count} occurrence${count === 1 ? '' : 's'}`);
        };
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(!e.shiftKey, q.value, mc.checked); if (e.key === 'Escape') { findBar.hidden = true; text.focus(); } });
        findBar.append(
          h('button', { class: 'np-ib', type: 'button', title: replace ? 'Hide replace' : 'Show replace', onClick: () => openFind(!replace) }, replace ? '' : ''),
          h('div', { class: 'np-find-fields' }, q, r),
          h('button', { class: 'np-ib', type: 'button', title: 'Find previous (Shift+F3)', onClick: () => find(false, q.value, mc.checked) }, ''),
          h('button', { class: 'np-ib', type: 'button', title: 'Find next (F3)', onClick: () => find(true, q.value, mc.checked) }, ''),
          h('label', { class: 'np-mc' }, mc, 'Match case'),
          ...(replace ? [h('button', { class: 'w-btn', type: 'button', onClick: replaceOne }, 'Replace'), h('button', { class: 'w-btn', type: 'button', onClick: replaceAll }, 'Replace all')] : []),
          h('button', { class: 'np-ib', type: 'button', title: 'Close', onClick: () => { findBar.hidden = true; text.focus(); } }, ''));
        q.focus();
        q.select();
      };
      const goTo = (): void => {
        const lines = text.value.split('\n');
        const v = window.prompt(`Go to line (1 - ${lines.length})`, String(text.value.slice(0, text.selectionStart).split('\n').length));
        const n = Number(v);
        if (!v || !Number.isInteger(n) || n < 1 || n > lines.length) { if (v) toast('The line number is beyond the total number of lines'); return; }
        const at = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
        text.focus();
        text.setSelectionRange(at, at);
        pos();
      };
      const insertDate = (): void => {
        const d = new Date();
        text.setRangeText(`${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ${d.toLocaleDateString('en-US')}`, text.selectionStart, text.selectionEnd, 'end');
        dirty = true;
        setTitle();
        pos();
      };
      const fontDialog = (): void => {
        const p = prefs();
        const fam = h('select', { class: 'w-input', 'aria-label': 'Font' }, ['Consolas', 'Cascadia Mono', 'Courier New', 'Lucida Console', 'Segoe UI', 'Arial', 'Calibri'].map((f) => h('option', { value: f, selected: f === p.font }, f)));
        const size = h('select', { class: 'w-input', 'aria-label': 'Size' }, [10, 11, 12, 14, 15, 16, 18, 20, 24].map((s) => h('option', { value: String(s), selected: s === p.size }, String(s))));
        root.querySelector('.np-saveas')?.remove();
        const bar = h('div', { class: 'np-saveas' }, h('span', null, 'Font:'), fam, h('span', null, 'Size:'), size,
          h('button', { class: 'w-btn accent', type: 'button', onClick: () => { savePrefs({ font: fam.value, size: Number(size.value) }); bar.remove(); } }, 'OK'),
          h('button', { class: 'w-btn', type: 'button', onClick: () => bar.remove() }, 'Cancel'));
        root.insertBefore(bar, text);
      };
      const zoom = (d: number): void => savePrefs({ zoom: d === 0 ? 100 : Math.max(10, Math.min(500, prefs().zoom + d)) });
      const cmdOn = (fn: () => void) => (): void => { text.focus(); fn(); };
      const clip = (kind: 'cut' | 'copy' | 'paste' | 'delete'): void => {
        text.focus();
        const sel = text.value.slice(text.selectionStart, text.selectionEnd);
        if (kind === 'copy' || kind === 'cut') void navigator.clipboard?.writeText(sel).catch(() => undefined);
        if (kind === 'cut' || kind === 'delete') { text.setRangeText('', text.selectionStart, text.selectionEnd, 'end'); dirty = true; setTitle(); }
        if (kind === 'paste') navigator.clipboard?.readText().then((t) => { text.setRangeText(t, text.selectionStart, text.selectionEnd, 'end'); dirty = true; setTitle(); pos(); }).catch(() => document.execCommand('paste'));
        pos();
      };
      const menus: Record<string, () => MenuEntry[]> = {
        File: () => [
          { label: 'New tab', shortcut: 'Ctrl+T', icon: '', onClick: () => openApp(notepadApp(''), undefined, false) },
          { label: 'New window', shortcut: 'Ctrl+Shift+N', icon: '', onClick: () => openApp(notepadApp(''), undefined, false) },
          { label: 'Open', shortcut: 'Ctrl+O', icon: '', onClick: openDialog },
          { label: 'Save', shortcut: 'Ctrl+S', icon: '', onClick: () => save() },
          { label: 'Save as', shortcut: 'Ctrl+Shift+S', icon: '', onClick: saveAs },
          '-',
          { label: 'Print', shortcut: 'Ctrl+P', icon: '', onClick: () => window.print() },
          '-',
          { label: 'Close window', shortcut: 'Ctrl+Shift+W', onClick: () => win.close() },
          { label: 'Exit', onClick: () => win.close() },
        ],
        Edit: () => [
          { label: 'Undo', shortcut: 'Ctrl+Z', icon: '', onClick: cmdOn(() => document.execCommand('undo')) },
          '-',
          { label: 'Cut', shortcut: 'Ctrl+X', icon: '', onClick: () => clip('cut') },
          { label: 'Copy', shortcut: 'Ctrl+C', icon: '', onClick: () => clip('copy') },
          { label: 'Paste', shortcut: 'Ctrl+V', icon: '', onClick: () => clip('paste') },
          { label: 'Delete', shortcut: 'Del', icon: '', onClick: () => clip('delete') },
          '-',
          { label: 'Search with Bing', shortcut: 'Ctrl+E', icon: '', onClick: () => { const q = text.value.slice(text.selectionStart, text.selectionEnd) || lastFind; if (q) openFromShell(`url:https://www.bing.com/search?q=${encodeURIComponent(q)}`); } },
          { label: 'Find', shortcut: 'Ctrl+F', icon: '', onClick: () => openFind(false) },
          { label: 'Find next', shortcut: 'F3', onClick: () => find(true) },
          { label: 'Find previous', shortcut: 'Shift+F3', onClick: () => find(false) },
          { label: 'Replace', shortcut: 'Ctrl+H', icon: '', onClick: () => openFind(true) },
          { label: 'Go to', shortcut: 'Ctrl+G', onClick: goTo },
          '-',
          { label: 'Select all', shortcut: 'Ctrl+A', icon: '', onClick: cmdOn(() => text.select()) },
          { label: 'Time/Date', shortcut: 'F5', icon: '', onClick: insertDate },
          '-',
          { label: 'Font', icon: '', onClick: fontDialog },
        ],
        View: () => [
          { label: 'Zoom', icon: '', submenu: [{ label: 'Zoom in', shortcut: 'Ctrl+Plus', onClick: () => zoom(10) }, { label: 'Zoom out', shortcut: 'Ctrl+Minus', onClick: () => zoom(-10) }, { label: 'Restore default zoom', shortcut: 'Ctrl+0', onClick: () => zoom(0) }] },
          { label: 'Status bar', checked: prefs().status, onClick: () => savePrefs({ status: !prefs().status }) },
          { label: 'Word wrap', checked: prefs().wrap, onClick: () => savePrefs({ wrap: !prefs().wrap }) },
        ],
      };
      text.addEventListener('input', () => { if (!dirty) { dirty = true; setTitle(); } pos(); });
      for (const ev of ['click', 'keyup', 'select']) text.addEventListener(ev, pos);
      root.addEventListener('keydown', (e) => {
        const k = (e.key ?? "").toLowerCase();
        let handled = true;
        if (e.ctrlKey && e.shiftKey && k === 's') saveAs();
        else if (e.ctrlKey && e.shiftKey && k === 'n') openApp(notepadApp(''), undefined, false);
        else if (e.ctrlKey && e.shiftKey && k === 'w') win.close();
        else if (e.ctrlKey && k === 's') save();
        else if (e.ctrlKey && (k === 'n' || k === 't')) openApp(notepadApp(''), undefined, false);
        else if (e.ctrlKey && k === 'o') openDialog();
        else if (e.ctrlKey && k === 'p') window.print();
        else if (e.ctrlKey && k === 'f') openFind(false);
        else if (e.ctrlKey && k === 'h') openFind(true);
        else if (e.ctrlKey && k === 'g') goTo();
        else if (e.ctrlKey && k === 'e') { const item = menus.Edit!().find((m) => m !== '-' && m.label === 'Search with Bing'); if (item && item !== '-') item.onClick?.(); }
        else if (e.key === 'F3') find(!e.shiftKey);
        else if (e.key === 'F5') insertDate();
        else if (e.ctrlKey && (k === '=' || k === '+')) zoom(10);
        else if (e.ctrlKey && k === '-') zoom(-10);
        else if (e.ctrlKey && k === '0') zoom(0);
        else handled = false;
        if (handled) { e.preventDefault(); e.stopPropagation(); }
      });
      text.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 10 : -10); } }, { passive: false });
      if (file()?.readOnly) text.setAttribute('readonly', '');
      root.append(
        h('div', { class: 'np-menu', role: 'menubar' }, Object.keys(menus).map((m) => h('button', { type: 'button', role: 'menuitem', onClick: (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); showMenu(r.left, r.bottom + 2, menus[m]!()); } }, m)),
          h('span', { class: 'np-spacer' }),
          h('button', { type: 'button', class: 'np-ib', title: 'Settings: font, word wrap, status bar', 'aria-label': 'Settings', onClick: (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); showMenu(r.right - 220, r.bottom + 2, [...menus.View!(), '-', { label: 'Font', onClick: fontDialog }]); } }, '')),
        findBar, text, status);
      host.appendChild(root);
      look();
      setTimeout(() => text.focus(), 0);
    },
  };
}

// ------------------------------------------------------------------- File Explorer

let openFile: (path: string, mode?: 'open' | 'edit' | 'notepad' | 'run' | 'notepadpp') => void = () => {};
export function setFileOpener(fn: (path: string, mode?: 'open' | 'edit' | 'notepad' | 'run' | 'notepadpp') => void): void {
  openFile = fn;
}

export function fileTypeName(path: string): string {
  if (/\.ps1$/i.test(path)) return 'Windows PowerShell Script';
  if (/\.csv$/i.test(path)) return 'Microsoft Excel Comma Separated Values File';
  if (/\.md$/i.test(path)) return 'Markdown Source File';
  if (/\.json$/i.test(path)) return 'JSON Source File';
  if (/\.docx$/i.test(path)) return 'Microsoft Word Document';
  if (/\.xlsx$/i.test(path)) return 'Microsoft Excel Worksheet';
  if (/\.pptx$/i.test(path)) return 'Microsoft PowerPoint Presentation';
  if (/\.pdf$/i.test(path)) return 'PDF-XChange Editor Document';
  return 'Text Document';
}

/** The menu Windows shows when you right-click a file. Shared with the desktop. */
export function fileMenu(path: string, startRename: () => void): MenuEntry[] {
  const isScript = /\.ps1$/i.test(path);
  const f = store.world.files.find((x) => x.path === path);
  return [
    { label: 'Open', icon: '\uE8E5', bold: true, onClick: () => openFile(path, 'open') },
    ...(isScript ? [
      { label: 'Run with PowerShell', icon: '\uE756', onClick: () => openFile(path, 'run') },
      { label: 'Edit', icon: '\uE70F', onClick: () => openFile(path, 'edit') },
    ] as MenuEntry[] : []),
    ...(/\.(bat|cmd)$/i.test(path) ? [
      { label: 'Run', icon: '\uE768', onClick: () => openFile(path, 'run') },
      { label: 'Run as administrator', icon: '\uE83D', onClick: () => openFile(path, 'run') },
      { label: 'Edit', icon: '\uE70F', onClick: () => openFile(path, 'notepad') },
    ] as MenuEntry[] : []),
    { label: 'Edit with Notepad++', icon: '\uE70F', onClick: () => openFile(path, 'notepadpp') },
    { label: 'Open with', icon: '\uE7AC', submenu: [
      { label: 'Notepad', icon: '\uE70B', onClick: () => openFile(path, 'notepad') },
      { label: 'Notepad++', icon: '\uE70F', onClick: () => openFile(path, 'notepadpp') },
      ...(/\.pdf$/i.test(path) ? [{ label: 'PDF-XChange Editor', icon: '\uEA90', onClick: () => openFile(path, 'open') }] : []),
      { label: 'Windows PowerShell ISE', icon: '\uE756', onClick: () => openFile(path, 'edit') },
    ] },
    '-',
    { label: 'Copy as path', icon: '\uE8C8', shortcut: 'Ctrl+Shift+C', onClick: () => { void navigator.clipboard?.writeText(`"${path}"`).catch(() => undefined); toast('Path copied'); } },
    { label: 'Rename', icon: '\uE8AC', shortcut: 'F2', disabled: f?.readOnly, onClick: startRename },
    { label: 'Delete', icon: '\uE74D', shortcut: 'Del', disabled: f?.readOnly, onClick: () => act((w) => deleteFile(w, path)) },
    '-',
    { label: 'Properties', icon: '\uE946', shortcut: 'Alt+Enter', onClick: () => propertiesDialog(path) },
  ];
}

export function propertiesDialog(path: string): void {
  const f = store.world.files.find((x) => x.path === path);
  if (!f) return;
  const shield = h('div', { class: 'mm-shield', style: 'position:fixed;z-index:100000' });
  const close = (): void => shield.remove();
  const name = path.split('\\').pop()!;
  shield.appendChild(h('div', { class: 'mm-dlg', style: 'width:min(380px, calc(100% - 16px))' },
    h('div', { class: 'mm-dlg-title' }, glyph(fileGlyph(path)), h('span', { class: 't' }, `${name} Properties`), h('button', { class: 'mm-dlg-x', type: 'button', onClick: close }, '\u2715')),
    h('div', { class: 'mm-dlg-body' }, h('div', { class: 'mm-tabpanel', style: 'min-height:0' },
      h('div', { class: 'mm-row', style: 'gap:16px;margin-bottom:10px' }, glyph(fileGlyph(path), 32), h('strong', null, name)),
      h('div', { class: 'mm-hr' }),
      h('div', { class: 'mm-grid', style: 'grid-template-columns:110px 1fr' },
        'Type of file:', fileTypeName(path), 'Opens with:', /\.ps1$/i.test(path) ? 'Windows PowerShell' : 'Notepad',
        'Location:', path.split('\\').slice(0, -1).join('\\'), 'Size:', `${f.content.length.toLocaleString()} bytes`,
        'Modified:', new Date(f.modified).toLocaleString(), 'Attributes:', f.readOnly ? 'Read-only' : 'Archive'))),
    h('div', { class: 'mm-dlg-foot' }, h('button', { class: 'mm-btn default', type: 'button', onClick: close }, 'OK'), h('button', { class: 'mm-btn', type: 'button', onClick: close }, 'Cancel'))));
  document.body.appendChild(shield);
}

/** New ▸ items, shared with the desktop. */
export function newMenu(dir: string, after: (path: string) => void): MenuEntry {
  return { label: 'New', icon: '\uE710', submenu: [
    { label: 'Text Document', icon: '\uE8A5', onClick: () => { let p = ''; if (act((w) => { p = newFile(w, dir, 'New Text Document', '.txt'); })) after(p); } },
    { label: 'Windows Batch File', icon: '\uE756', onClick: () => { let p = ''; if (act((w) => { p = newFile(w, dir, 'New Batch File', '.bat', '@echo off\r\nrem Write your commands here, then double-click the file to run it.\r\necho Hello from %COMPUTERNAME%\r\nwhoami\r\npause\r\n'); })) after(p); } },
    { label: 'Windows PowerShell Script', icon: '\uE756', onClick: () => { let p = ''; if (act((w) => { p = newFile(w, dir, 'New Script', '.ps1', '# Write your script here, then double-click the file to run it.\nWrite-Host "Hello from $env:COMPUTERNAME"\n'); })) after(p); } },
    { label: 'Microsoft Word Document', icon: '\uE8A5', onClick: () => { let p = ''; if (act((w) => { p = newFile(w, dir, 'New Microsoft Word Document', '.docx', writeWord(newWord())); })) after(p); } },
    { label: 'Microsoft Excel Worksheet', icon: '\uE8A5', onClick: () => { let p = ''; if (act((w) => { p = newFile(w, dir, 'New Microsoft Excel Worksheet', '.xlsx', writeBook(newBook())); })) after(p); } },
    { label: 'Microsoft PowerPoint Presentation', icon: '\uE8A5', onClick: () => { let p = ''; if (act((w) => { p = newFile(w, dir, 'New Microsoft PowerPoint Presentation', '.pptx', writeDeck(newDeck())); })) after(p); } },
    { label: 'CSV File', icon: '\uE8A5', onClick: () => { let p = ''; if (act((w) => { p = newFile(w, dir, 'New Data', '.csv', 'EmployeeID,FirstName,LastName,Department\n'); })) after(p); } },
  ] };
}

export const explorerApp: AppDef = {
  id: 'explorer',
  title: 'File Explorer',
  icon: 'explorer',
  width: 980,
  height: 600,
  mount(host, win) {
    const home = (): string => homeDir(store.world);
    let dir = win.arg === 'Recycle Bin' ? 'Recycle Bin' : win.arg && /^C:\\/i.test(win.arg) ? win.arg : `${home()}\\Documents`;
    let query = '';
    let sel = '';
    let renaming = '';
    let sortBy: 'name' | 'date' | 'type' = 'name';
    const back: string[] = [];
    const nav = (d: string): void => { if (d !== dir) back.push(dir); dir = d; sel = ''; query = ''; renaming = ''; draw(); };
    onOpenArg(win, (a) => { if (a) nav(a); });
    const draw = (): void => {
      clear(host);
      const files = store.world.files;
      const recycle = dir === 'Recycle Bin';
      const prefix = `${dir}\\`.toLowerCase();
      const folders = new Set<string>();
      const here = recycle ? files.filter((f) => f.deleted) : files.filter((f) => {
        if (f.deleted || !f.path.toLowerCase().startsWith(prefix)) return false;
        const rest = f.path.slice(prefix.length);
        if (rest.includes('\\')) { folders.add(rest.split('\\')[0]!); return false; }
        return !/desktop\.ini$/i.test(rest);
      }).filter((f) => !query || f.path.split('\\').pop()!.toLowerCase().includes(query.toLowerCase()));
      here.sort((a, b) => sortBy === 'date' ? b.modified.localeCompare(a.modified) : sortBy === 'type' ? fileTypeName(a.path).localeCompare(fileTypeName(b.path)) : a.path.localeCompare(b.path));
      const quick: [string, string, SmallIcon][] = [['Home', home(), 'docs'], ['Desktop', `${home()}\\Desktop`, 'desktop'], ['Downloads', `${home()}\\Downloads`, 'downloads'], ['Documents', `${home()}\\Documents`, 'docs'], ['Policies', `${home()}\\Documents\\Policies`, 'container'], ['Reference', `${home()}\\Documents\\Reference`, 'container'], ['Scripts', `${home()}\\Documents\\Scripts`, 'container'], ['Exports', `${home()}\\Documents\\Exports`, 'container'], ['Evidence', `${home()}\\Documents\\Evidence`, 'container']];
      const crumbs = recycle ? ['Recycle Bin'] : ['This PC', 'Local Disk (C:)', ...dir.split('\\').slice(1)];
      const search = h('input', { class: 'fx-search', type: 'search', placeholder: `Search ${crumbs.at(-1)}`, value: query, 'aria-label': 'Search' });
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { query = search.value; draw(); } });
      const startRename = (p: string): void => { renaming = p; draw(); };
      const rows = [
        ...[...folders].sort().map((d) => ({ key: `d:${d}`, name: d, icon: 'container' as SmallIcon, mod: '', type: 'File folder', size: '', open: () => nav(`${dir}\\${d}`), path: '' })),
        ...here.map((f) => ({ key: f.path, name: recycle ? f.deleted!.from.split('\\').pop()! : f.path.split('\\').pop()!, icon: fileGlyph(f.path), mod: fmt(recycle ? f.deleted!.at : f.modified), type: recycle ? `Deleted from ${f.deleted!.from.split('\\').slice(0, -1).join('\\')}` : fileTypeName(f.path), size: `${Math.max(1, Math.round(f.content.length / 1024))} KB`, open: () => (recycle ? undefined : openFile(f.path)), path: f.path })),
      ];
      const selRow = rows.find((r) => r.key === sel);
      const bgMenu = (x: number, y: number): void => showMenu(x, y, recycle
        ? [{ label: 'Empty Recycle Bin', icon: '\uE74D', disabled: !here.length, onClick: () => act((w) => emptyRecycleBin(w)) }, { label: 'Refresh', icon: '\uE72C', onClick: draw }]
        : [
            { label: 'View', icon: '\uE8FD', submenu: [{ label: 'Details', checked: true }, { label: 'List' }] },
            { label: 'Sort by', icon: '\uE8CB', submenu: [{ label: 'Name', checked: sortBy === 'name', onClick: () => { sortBy = 'name'; draw(); } }, { label: 'Date modified', checked: sortBy === 'date', onClick: () => { sortBy = 'date'; draw(); } }, { label: 'Type', checked: sortBy === 'type', onClick: () => { sortBy = 'type'; draw(); } }] },
            { label: 'Refresh', icon: '\uE72C', onClick: draw },
            '-',
            newMenu(dir, (p) => { sel = p; startRename(p); }),
            '-',
            { label: 'Open in Terminal', icon: '\uE756', onClick: () => openTerminal(dir) },
            { label: 'Properties', icon: '\uE946', disabled: true },
          ]);
      host.appendChild(h('div', { class: 'fx' },
        h('div', { class: 'fx-cmd' },
          h('button', { class: 'fx-cmdbtn', type: 'button', disabled: recycle, onClick: (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); showMenu(r.left, r.bottom, (newMenu(dir, (p) => { sel = p; startRename(p); }) as { submenu: MenuEntry[] }).submenu); } }, '\uE710  New'),
          h('span', { class: 'fx-sep' }),
          h('button', { class: 'fx-cmdbtn', type: 'button', disabled: !selRow?.path || recycle, title: 'Rename (F2)', onClick: () => selRow && startRename(selRow.path) }, '\uE8AC'),
          h('button', { class: 'fx-cmdbtn', type: 'button', disabled: !selRow?.path, title: 'Delete', onClick: () => { if (selRow?.path) act((w) => (recycle ? emptyOne(w, selRow.path) : deleteFile(w, selRow.path))); } }, '\uE74D'),
          recycle ? h('button', { class: 'fx-cmdbtn', type: 'button', disabled: !selRow?.path, onClick: () => { if (selRow?.path) act((w) => restoreFile(w, selRow.path), 'Restored'); } }, '\uE7A7  Restore the selected items') : null,
          recycle ? h('button', { class: 'fx-cmdbtn', type: 'button', disabled: !here.length, onClick: () => act((w) => emptyRecycleBin(w)) }, '\uE74D  Empty Recycle Bin') : null,
          h('span', { class: 'fx-sep' }),
          h('button', { class: 'fx-cmdbtn', type: 'button', onClick: draw }, '\uE72C  Refresh')),
        h('div', { class: 'fx-addr' },
          h('button', { class: 'fx-nav', type: 'button', title: 'Back', disabled: !back.length, onClick: () => { const p = back.pop(); if (p) { dir = p; draw(); } } }, '\uE72B'),
          h('button', { class: 'fx-nav', type: 'button', title: 'Up', disabled: recycle || dir.split('\\').length <= 3, onClick: () => nav(dir.split('\\').slice(0, -1).join('\\')) }, '\uE74A'),
          h('div', { class: 'fx-crumbs' }, crumbs.map((c, i) => [i ? h('span', { class: 'fx-chev' }, '\uE76C') : null, h('button', { type: 'button', class: 'fx-crumb', onClick: () => { if (i >= 2) nav(['C:', ...dir.split('\\').slice(1, i)].join('\\')); } }, c)])),
          search),
        h('div', { class: 'fx-main' },
          h('nav', { class: 'fx-pane', 'aria-label': 'Navigation pane' },
            quick.map(([label, path, icon]) => h('button', { class: `fx-q ${dir === path ? 'on' : ''}`, type: 'button', onClick: () => nav(path) }, glyph(icon), label)),
            h('div', { class: 'fx-div' }),
            h('button', { class: 'fx-q', type: 'button', onClick: () => nav(home()) }, glyph('thisPc'), 'This PC'),
            h('button', { class: 'fx-q', type: 'button', onClick: () => nav(home()) }, glyph('drive'), 'Local Disk (C:)'),
            h('button', { class: `fx-q ${recycle ? 'on' : ''}`, type: 'button', onClick: () => nav('Recycle Bin') }, glyph('delete'), 'Recycle Bin')),
          h('div', { class: 'fx-list', 'data-keep-scroll': '', tabindex: '0',
            onContextmenu: (e: MouseEvent) => { if ((e.target as HTMLElement).closest('tr[data-row]')) return; e.preventDefault(); bgMenu(e.clientX, e.clientY); },
            onKeydown: (e: KeyboardEvent) => {
              if (!selRow?.path || renaming) return;
              if (e.key === 'F2' && !recycle) startRename(selRow.path);
              if (e.key === 'Delete') act((w) => (recycle ? emptyOne(w, selRow.path) : deleteFile(w, selRow.path)));
              if (e.key === 'Enter') selRow.open();
            } },
            h('table', { class: 'fx-table' },
              h('thead', null, h('tr', null, ['Name', recycle ? 'Date deleted' : 'Date modified', recycle ? 'Original location' : 'Type', 'Size'].map((x) => h('th', null, x)))),
              h('tbody', null, rows.map((r) => {
                const nameCell = renaming && r.path === renaming
                  ? (() => {
                      const inp = h('input', { class: 'fx-rename', value: r.name, 'aria-label': 'New name' });
                      const commit = (): void => { const v = inp.value; renaming = ''; if (v && v !== r.name) act((w) => { sel = renameFile(w, r.path, v); }); else draw(); };
                      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { renaming = ''; draw(); } });
                      inp.addEventListener('blur', commit);
                      setTimeout(() => { inp.focus(); const dot = r.name.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : r.name.length); }, 0);
                      return h('span', { class: 'fx-name' }, glyph(r.icon), inp);
                    })()
                  : h('span', { class: 'fx-name' }, glyph(r.icon), r.name);
                return h('tr', { class: sel === r.key ? 'sel' : '', 'data-row': '', tabindex: '0',
                  onClick: () => { sel = r.key; draw(); },
                  onDblclick: r.open,
                  onContextmenu: (e: MouseEvent) => {
                    e.preventDefault();
                    sel = r.key;
                    draw();
                    if (recycle) showMenu(e.clientX, e.clientY, [{ label: 'Restore', icon: '\uE7A7', bold: true, onClick: () => act((w) => restoreFile(w, r.path), 'Restored') }, { label: 'Delete', icon: '\uE74D', onClick: () => act((w) => emptyOne(w, r.path)) }]);
                    else if (r.path) showMenu(e.clientX, e.clientY, fileMenu(r.path, () => startRename(r.path)));
                    else showMenu(e.clientX, e.clientY, [{ label: 'Open', bold: true, icon: '\uE8E5', onClick: r.open }, { label: 'Open in new window', icon: '\uE8A7', onClick: () => openApp(explorerApp, `${dir}\\${r.name}`, false) }, { label: 'Open in Terminal', icon: '\uE756', onClick: () => openTerminal(`${dir}\\${r.name}`) }]);
                  } },
                h('td', null, nameCell), h('td', null, r.mod), h('td', null, r.type), h('td', { class: 'num' }, r.size));
              }))),
            !rows.length ? h('p', { class: 'fx-empty' }, recycle ? 'Recycle Bin is empty.' : query ? 'No items match your search.' : 'This folder is empty.') : null)),
        h('div', { class: 'fx-status' }, `${rows.length} item${rows.length === 1 ? '' : 's'}${sel ? '   1 item selected' : ''}`)));
      win.setTitle(`${crumbs.at(-1)} - File Explorer`);
    };
    draw();
    return { redraw: draw };
  },
};

function emptyOne(w: World, path: string): void {
  w.files = w.files.filter((f) => !(f.deleted && f.path === path));
}

let openTerminal: (dir: string) => void = () => {};
export function setTerminalOpener(fn: (dir: string) => void): void {
  openTerminal = fn;
}


// ------------------------------------------------------------------- Event Viewer

// Event Viewer lives in its own module; re-exported so existing imports keep working.
export { eventViewerApp } from './eventviewer.ts';
