/**
 * Windows PowerShell, Notepad, File Explorer and Event Viewer.
 */
import { fmt } from '../../core/time.ts';
import type { AuditEvent, World } from '../../core/types.ts';
import { AD_EVENT_NAMES } from '../../world/audit.ts';
import { deleteFile, emptyRecycleBin, homeDir, newFile, renameFile, restoreFile, writeFile } from '../../world/docs.ts';
import { Shell } from '../../terminal/shell.ts';
import { CMDLETS } from '../../terminal/cmdlets.ts';
import { clear, h, toast } from '../dom.ts';
import { type MenuEntry, showMenu } from '../ctxmenu.ts';
import { act, notify, persist, store, subscribe } from '../store.ts';
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

export function mountPowerShell(host: HTMLElement, opts: { onExit?: () => void; script?: string; compact?: boolean; cwd?: string } = {}): { control: PsWindowControl; dispose: () => void; shell: Shell } {
  const sh = new Shell(store.world, CMDLETS);
  if (opts.cwd) sh.cwd = opts.cwd;
  const out = h('div', { class: 'ps-out', 'aria-live': 'polite' });
  const input = h('input', { class: 'ps-in', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'PowerShell command' });
  const prompt = h('span', { class: 'ps-prompt' });
  let hist = -1;
  let pending = '';
  let tabCycle: { base: string; hits: string[]; i: number } | null = null;
  const line = (text: string, cls = ''): void => { out.appendChild(h('div', { class: `ps-line ${cls}` }, text || ' ')); };
  const setPrompt = (): void => { prompt.textContent = pending ? '>> ' : `PS ${sh.cwd}> `; };
  if (!opts.compact) {
    line('Windows PowerShell');
    line('Copyright (C) Microsoft Corporation. All rights reserved.');
    line('');
    line('Install the latest PowerShell for new features and improvements! https://aka.ms/PSWindows');
    line('');
  }
  const exec = (cmd: string): void => {
    sh.setWorld(store.world);
    for (const l of sh.run(cmd)) {
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
      out.scrollTop = out.scrollHeight;
    },
  };
  setPrompt();
  const unsub = subscribe(() => sh.setWorld(store.world));
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
      const full = pending ? `${pending}\n${cmd}` : cmd;
      if (incomplete(full) && cmd.trim() !== '') { pending = full; setPrompt(); out.scrollTop = out.scrollHeight; return; }
      pending = '';
      if (full.trim()) exec(full);
      setPrompt();
      out.scrollTop = out.scrollHeight;
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

export function notepadApp(path: string): AppDef {
  const name = path ? path.split('\\').pop()! : 'Untitled.txt';
  return {
    id: `notepad:${path || Date.now()}`,
    title: `${name} - Notepad`,
    icon: 'notepad',
    width: 780,
    height: 560,
    mount(host, win) {
      const f = store.world.files.find((x) => x.path === path);
      const text = h('textarea', { class: 'np-text', spellcheck: 'false', wrap: 'soft', 'aria-label': 'Text editor' }, f?.content ?? '');
      const status = h('div', { class: 'np-status' });
      let dirty = false;
      const pos = (): void => {
        const before = text.value.slice(0, text.selectionStart);
        const ln = before.split('\n').length;
        const col = before.length - before.lastIndexOf('\n');
        clear(status);
        status.append(h('span', null, `Ln ${ln}, Col ${col}`), h('span', null, `${text.value.length} characters`), h('span', null, '100%'), h('span', null, 'Windows (CRLF)'), h('span', null, 'UTF-8'));
      };
      const save = (target = path): void => {
        if (!target || (f?.readOnly && target === path)) return saveAs();
        if (act((w) => writeFile(w, target, text.value))) { dirty = false; win.setTitle(`${target.split('\\').pop()} - Notepad`); }
      };
      const saveAs = (): void => {
        const box = h('input', { class: 'w-input', value: `${homeDir(store.world)}\\Documents\\Evidence\\${name}`, 'aria-label': 'File name' });
        const bar = h('div', { class: 'np-saveas' }, h('span', null, f?.readOnly ? 'This file is read-only. Save a copy as:' : 'Save as:'), box,
          h('button', { class: 'w-btn accent', type: 'button', onClick: () => { save(box.value); bar.remove(); } }, 'Save'),
          h('button', { class: 'w-btn', type: 'button', onClick: () => bar.remove() }, 'Cancel'));
        host.querySelector('.np')!.insertBefore(bar, text);
        box.focus();
      };
      text.addEventListener('input', () => { if (!dirty) { dirty = true; win.setTitle(`*${name} - Notepad`); } pos(); });
      text.addEventListener('click', pos);
      text.addEventListener('keyup', pos);
      text.addEventListener('keydown', (e) => { if (e.key === 's' && e.ctrlKey) { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); } });
      if (f?.readOnly) text.setAttribute('readonly', '');
      host.appendChild(h('div', { class: 'np' },
        h('div', { class: 'np-menu' },
          h('button', { type: 'button', onClick: () => save() }, 'File'), h('button', { type: 'button', onClick: () => saveAs() }, 'Save as'),
          h('button', { type: 'button', onClick: () => { text.focus(); text.select(); } }, 'Edit'), h('button', { type: 'button', onClick: () => text.classList.toggle('nowrap') }, 'View')),
        text, status));
      pos();
    },
  };
}

// ------------------------------------------------------------------- File Explorer

let openFile: (path: string, mode?: 'open' | 'edit' | 'notepad' | 'run') => void = () => {};
export function setFileOpener(fn: (path: string, mode?: 'open' | 'edit' | 'notepad' | 'run') => void): void {
  openFile = fn;
}

export function fileTypeName(path: string): string {
  if (/\.ps1$/i.test(path)) return 'Windows PowerShell Script';
  if (/\.csv$/i.test(path)) return 'Microsoft Excel Comma Separated Values File';
  if (/\.md$/i.test(path)) return 'Markdown Source File';
  if (/\.json$/i.test(path)) return 'JSON Source File';
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
    { label: 'Open with', icon: '\uE7AC', submenu: [
      { label: 'Notepad', icon: '\uE70B', onClick: () => openFile(path, 'notepad') },
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
    { label: 'Windows PowerShell Script', icon: '\uE756', onClick: () => { let p = ''; if (act((w) => { p = newFile(w, dir, 'New Script', '.ps1', '# Write your script here, then double-click the file to run it.\nWrite-Host "Hello from $env:COMPUTERNAME"\n'); })) after(p); } },
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

export const eventViewerApp: AppDef = {
  id: 'eventviewer',
  title: 'Event Viewer',
  icon: 'eventviewer',
  width: 1120,
  height: 660,
  mount(host) {
    let idFilter: number[] = [];
    let text = '';
    let selId = -1;
    let tab: 'general' | 'details' = 'general';
    const layer = h('div', { class: 'mm-layer' });
    const filterDialog = (): void => {
      const ids = h('input', { type: 'text', value: idFilter.join(', ') || '<All Event IDs>', style: 'width:100%' });
      const words = h('input', { type: 'text', value: text, style: 'width:100%' });
      const shield = h('div', { class: 'mm-shield' });
      const close = (): void => shield.remove();
      shield.appendChild(h('div', { class: 'mm-dlg active', style: 'width:min(460px, calc(100% - 16px))' },
        h('div', { class: 'mm-dlg-title' }, glyph('filter'), h('span', { class: 't' }, 'Filter Current Log'), h('button', { class: 'mm-dlg-x', type: 'button', onClick: close }, '\u2715')),
        h('div', { class: 'mm-dlg-body mm-stack' },
          h('div', null, 'Includes/Excludes Event IDs: Enter ID numbers and/or ID ranges separated by commas.'), ids,
          h('div', null, 'User, computer or keyword:'), words),
        h('div', { class: 'mm-dlg-foot' },
          h('button', { class: 'mm-btn default', type: 'button', onClick: () => { idFilter = ids.value.split(/[,\s]+/).map(Number).filter((n) => n > 0); text = words.value.trim(); close(); draw(); } }, 'OK'),
          h('button', { class: 'mm-btn', type: 'button', onClick: () => { idFilter = []; text = ''; close(); draw(); } }, 'Clear'),
          h('button', { class: 'mm-btn', type: 'button', onClick: close }, 'Cancel'))));
      layer.appendChild(shield);
      setTimeout(() => ids.select(), 20);
    };
    const root = h('div', { class: 'mm-root ev' });
    host.append(root, layer);
    const draw = (): void => {
      clear(root);
      const all = store.world.audit.filter((e) => e.source === 'AD' && e.eventId).sort((a, b) => b.time.localeCompare(a.time) || b.id - a.id);
      const ev = all.filter((e) => (!idFilter.length || idFilter.includes(e.eventId!)) && (!text || `${e.target} ${e.actor} ${e.origin} ${e.detail}`.toLowerCase().includes(text.toLowerCase()))).slice(0, 500);
      const sel = ev.find((e) => e.id === selId) ?? null;
      const fail = (e: AuditEvent): boolean => e.eventId === 4625 || e.eventId === 4771;
      root.appendChild(h('div', { class: 'mm-menubar' }, ['File', 'Action', 'View', 'Help'].map((m) => h('span', null, m))));
      root.appendChild(h('div', { class: 'mm-toolbar' }, h('button', { class: 'mm-tb', type: 'button', disabled: true }, glyph('back')), h('button', { class: 'mm-tb', type: 'button', disabled: true }, glyph('forward')), h('span', { class: 'mm-tbsep' }),
        h('button', { class: 'mm-tb', type: 'button', title: 'Filter Current Log...', onClick: filterDialog }, glyph('filter')), h('button', { class: 'mm-tb', type: 'button', title: 'Refresh', onClick: draw }, glyph('refresh'))));
      const tree = h('div', { class: 'mm-tree', style: 'width:220px' },
        ...([['Event Viewer (Local)', 0, 'log'], ['Custom Views', 1, 'container'], ['Windows Logs', 1, 'container'], ['Application', 2, 'log'], ['Security', 2, 'log'], ['Setup', 2, 'log'], ['System', 2, 'log'], ['Forwarded Events', 2, 'log'], ['Applications and Services Logs', 1, 'container'], ['Subscriptions', 1, 'container']] as [string, number, SmallIcon][])
          .map(([n, d, i]) => h('div', { class: `mm-trow ${n === 'Security' ? 'sel' : ''}`, style: `padding-left:${d * 16 + 4}px` }, glyph(i), h('span', { class: 'mm-tlabel' }, n))));
      const listTable = h('table', { class: 'mm-table' },
        h('colgroup', null, h('col', { style: 'width:15%' }), h('col', { style: 'width:20%' }), h('col', { style: 'width:28%' }), h('col', { style: 'width:9%' }), h('col', { style: 'width:28%' })),
        h('thead', null, h('tr', null, ['Keywords', 'Date and Time', 'Source', 'Event ID', 'Task Category'].map((x) => h('th', null, x)))),
        h('tbody', null, ev.map((e) => h('tr', { class: `row ${e.id === selId ? 'sel' : ''}`, onClick: () => { selId = e.id; draw(); } },
          h('td', null, h('span', { class: 'mm-cell' }, glyph(fail(e) ? 'lockFail' : 'keySuccess'), h('span', null, fail(e) ? 'Audit Failure' : 'Audit Success'))), h('td', null, new Date(e.time).toLocaleString()), h('td', null, 'Microsoft Windows security auditing.'),
          h('td', null, String(e.eventId)), h('td', null, taskCategory(e.eventId!))))));
      const message = sel ? `${AD_EVENT_NAMES[sel.eventId!] ?? sel.action}.\n\nSubject:\n\tSecurity ID:\t\t${sel.actor === 'SYSTEM' ? 'SYSTEM' : `MERIDIAN\\${sel.actor}`}\n\tAccount Name:\t\t${sel.actor}\n\tAccount Domain:\t\tMERIDIAN\n\n${sel.eventId === 4740 ? 'Account That Was Locked Out' : 'Target Account'}:\n\tSecurity ID:\t\tMERIDIAN\\${sel.target}\n\tAccount Name:\t\t${sel.target}\n\nAdditional Information:\n\t${sel.eventId === 4740 ? sel.detail : `Client Address:\t\t${sel.origin}`}${sel.detail && sel.eventId !== 4740 ? `\n\tDetail:\t\t\t${sel.detail}` : ''}` : '';
      const details = sel ? `- System\n  - Provider [ Name] Microsoft-Windows-Security-Auditing\n    EventID ${sel.eventId}\n    TimeCreated [ SystemTime] ${sel.time}\n    Computer MHS-DC01.meridianhealth.test\n- EventData\n    TargetUserName ${sel.target}\n    TargetDomainName MERIDIAN\n    SubjectUserName ${sel.actor}\n    ${sel.eventId === 4740 ? `CallerComputerName ${sel.detail.replace('Caller Computer Name: ', '')}` : `IpAddress ${sel.origin}`}` : '';
      const center = h('div', { class: 'ev-center' },
        h('div', { class: 'ev-head' }, h('strong', null, 'Security'), `   Number of events: ${all.length.toLocaleString()}${idFilter.length || text ? `   Filtered: Log: Security; Source: ; Event ID: ${idFilter.join(', ') || 'all'}. Number of events: ${ev.length}` : ''}`),
        h('div', { class: 'mm-list ev-list', 'data-keep-scroll': '' }, listTable),
        h('div', { class: 'ev-detail' },
          h('div', { class: 'ev-detail-head' }, sel ? `Event ${sel.eventId}, Microsoft Windows security auditing.` : 'Select an event to view its details.'),
          h('div', { class: 'mm-tabrow' }, h('div', { class: `mm-tab ${tab === 'general' ? 'sel' : ''}`, onClick: () => { tab = 'general'; draw(); } }, 'General'), h('div', { class: `mm-tab ${tab === 'details' ? 'sel' : ''}`, onClick: () => { tab = 'details'; draw(); } }, 'Details')),
          h('div', { class: 'mm-tabpanel ev-panel' },
            sel ? (tab === 'general'
              ? h('div', null, h('pre', { class: 'ev-msg' }, message), h('div', { class: 'ev-meta' },
                ...([['Log Name:', 'Security'], ['Source:', 'Microsoft Windows security'], ['Logged:', new Date(sel.time).toLocaleString()], ['Event ID:', String(sel.eventId)], ['Task Category:', taskCategory(sel.eventId!)], ['Level:', 'Information'], ['Keywords:', fail(sel) ? 'Audit Failure' : 'Audit Success'], ['User:', 'N/A'], ['Computer:', 'MHS-DC01.meridianhealth.test']] as [string, string][]).flatMap(([k, v]) => [h('span', null, k), h('span', null, v)])))
              : h('pre', { class: 'ev-msg' }, details)) : null)));
      const actions = h('div', { class: 'ev-actions' },
        h('div', { class: 'ev-act-head' }, 'Actions'), h('div', { class: 'ev-act-sub' }, 'Security'),
        ...([['Open Saved Log...', null], ['Create Custom View...', null], ['Import Custom View...', null], ['Clear Log...', null], ['Filter Current Log...', filterDialog], ['Properties', null], ['Find...', filterDialog], ['Save All Events As...', null], ['Refresh', draw]] as [string, (() => void) | null][])
          .map(([l, fn]) => h('button', { class: 'ev-act', type: 'button', disabled: !fn, onClick: () => fn?.() }, l)));
      root.appendChild(h('div', { class: 'mm-panes' }, tree, center, actions));
      root.appendChild(h('div', { class: 'mm-status' }, `${ev.length} event(s) shown`));
    };
    draw();
    return { redraw: draw };
  },
};

function taskCategory(id: number): string {
  if ([4624, 4625].includes(id)) return 'Logon';
  if ([4771].includes(id)) return 'Kerberos Authentication Service';
  if ([4728, 4729, 4732, 4733, 4727].includes(id)) return 'Security Group Management';
  if ([5136, 5139].includes(id)) return 'Directory Service Changes';
  return 'User Account Management';
}
