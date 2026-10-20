/**
 * ui/apps/office.ts — what Word, Excel and PowerPoint share: the coloured title
 * bar with Quick Access (Save, Undo, Redo), the ribbon with its tabs and
 * groups, the File backstage (New, Open, Save, Save As, Export, Close) and the
 * status bar. Each app supplies its own document and ribbon contents.
 */
import { clear, h, toast } from '../dom.ts';
import { act, persist, store } from '../store.ts';
import { type WinHandle } from '../wm.ts';
import { writeFile } from '../../world/docs.ts';
import { homeDir } from '../../world/docs.ts';

export type OfficeKind = 'word' | 'excel' | 'powerpoint';
export const OFFICE = {
  word: { name: 'Word', letter: 'W', color: '#185abd', ext: '.docx', type: 'Word Document', blank: 'Blank document', untitled: 'Document' },
  excel: { name: 'Excel', letter: 'X', color: '#107c41', ext: '.xlsx', type: 'Excel Workbook', blank: 'Blank workbook', untitled: 'Book' },
  powerpoint: { name: 'PowerPoint', letter: 'P', color: '#c43e1c', ext: '.pptx', type: 'PowerPoint Presentation', blank: 'Blank presentation', untitled: 'Presentation' },
} as const;

/** Which files each app opens. */
export const OPENS: Record<OfficeKind, RegExp> = { word: /\.(docx|txt|md)$/i, excel: /\.(xlsx|csv)$/i, powerpoint: /\.pptx$/i };

// ------------------------------------------------------------------ ribbon controls

export const icon = (glyph: string): HTMLElement => h('span', { class: 'mdl' }, glyph);
export const big = (glyph: string, label: string, fn: () => void, title = label): HTMLButtonElement =>
  h('button', { class: 'rb-big', type: 'button', title, onMousedown: (e: Event) => e.preventDefault(), onClick: fn }, icon(glyph), h('span', null, label));
export const small = (glyph: string, label: string, fn: () => void, opts: { on?: boolean; text?: boolean; title?: string; disabled?: boolean } = {}): HTMLButtonElement =>
  h('button', { class: `rb-sm ${opts.on ? 'on' : ''}`, type: 'button', title: opts.title ?? label, 'aria-label': label, 'aria-pressed': opts.on ? 'true' : 'false', disabled: !!opts.disabled, onMousedown: (e: Event) => e.preventDefault(), onClick: fn }, icon(glyph), opts.text ? h('span', null, label) : null);
export const group = (label: string, ...rows: (HTMLElement | null)[]): HTMLElement =>
  h('div', { class: 'rb-group' }, h('div', { class: 'rb-body' }, ...rows), h('div', { class: 'rb-label' }, label));
export const row = (...items: (HTMLElement | null)[]): HTMLElement => h('div', { class: 'rb-row' }, ...items);
export const col = (...items: (HTMLElement | null)[]): HTMLElement => h('div', { class: 'rb-col' }, ...items);
export function select(label: string, value: string, options: (string | [string, string])[], fn: (v: string) => void, width = 120): HTMLSelectElement {
  return h('select', { class: 'rb-select', 'aria-label': label, title: label, style: `width:${width}px`, onChange: (e: Event) => fn((e.target as HTMLSelectElement).value) },
    ...options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: v === value }, l); }));
}
/** A colour picker that looks like Office's split button: the glyph with a colour bar under it. */
export function colorBtn(glyph: string, label: string, color: string, fn: (c: string) => void): HTMLElement {
  const input = h('input', { type: 'color', value: color, 'aria-label': label, class: 'rb-color-input', onInput: (e: Event) => fn((e.target as HTMLInputElement).value) });
  return h('label', { class: 'rb-sm rb-color', title: label, onMousedown: (e: Event) => { if (e.target !== input) e.preventDefault(); } }, icon(glyph), h('span', { class: 'rb-color-bar', style: `background:${color}` }), input,
    h('button', { class: 'rb-color-apply', type: 'button', title: `Apply ${label.toLowerCase()}`, 'aria-label': `Apply ${label}`, onMousedown: (e: Event) => e.preventDefault(), onClick: (e: Event) => { e.preventDefault(); fn(input.value); } }));
}

// ------------------------------------------------------------------ shell

export interface OfficeDoc {
  /** Current text of the file to save. */
  serialize(asType: string): string;
  load(path: string, content: string): void;
  blank(): void;
  /** Extra Save As types besides the native one, e.g. CSV or plain text. */
  exportTypes: [string, string][];
}

export interface OfficeShell {
  root: HTMLElement;
  ribbonHost: HTMLElement;
  docHost: HTMLElement;
  status: HTMLElement;
  path(): string;
  markDirty(): void;
  drawRibbon(): void;
  save(): void;
  undo: { push(snapshot: string): void; canUndo(): boolean; canRedo(): boolean };
}

export function officeShell(kind: OfficeKind, host: HTMLElement, win: WinHandle, opts: {
  tabs: string[];
  ribbon: (tab: string, into: HTMLElement) => void;
  doc: OfficeDoc;
  restore: (snapshot: string) => void;
  snapshot: () => string;
  initialPath?: string;
}): OfficeShell {
  const meta = OFFICE[kind];
  const frame = host.closest<HTMLElement>('.win');
  frame?.classList.add('off-win', `off-${kind}`);
  frame?.style.setProperty('--off', meta.color);
  let current = opts.initialPath ?? '';
  let dirty = false;
  let tab = opts.tabs[1] ?? opts.tabs[0]!;
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let lastSnap = '';

  const name = (): string => (current ? current.split('\\').pop()! : `${meta.untitled}1`);
  const setTitle = (): void => {
    win.setTitle(`${name()} - ${meta.name}`);
    titleName.textContent = `${name().replace(/\.[^.]+$/, '')}${dirty ? ' • Not saved' : current ? ' • Saved' : ''}`;
  };
  const docsDir = (): string => `${homeDir(store.world)}\\Documents`;

  const remember = (p: string): void => {
    const o = (store.settings.office ??= {});
    o.recent = [p, ...(o.recent ?? []).filter((x) => x.toLowerCase() !== p.toLowerCase())].slice(0, 20);
    persist();
  };
  function writeTo(path: string, type: string): boolean {
    const body = opts.doc.serialize(type);
    if (!act((w) => writeFile(w, path, body))) return false;
    remember(path);
    return true;
  }
  function save(): void {
    if (!current || !new RegExp(`\\${meta.ext}$`, 'i').test(current) && !opts.doc.exportTypes.some(([e]) => current.toLowerCase().endsWith(e))) { backstage('saveas'); return; }
    const ext = current.slice(current.lastIndexOf('.')).toLowerCase();
    if (writeTo(current, ext)) { dirty = false; setTitle(); toast(`Saved ${name()}`, 'ok'); }
  }

  // ---- title bar (drawn into the window's title slot)
  const titleName = h('span', { class: 'off-name' });
  const qa = (glyph: string, label: string, fn: () => void): HTMLButtonElement => h('button', { class: 'off-qa', type: 'button', title: label, 'aria-label': label, onMousedown: (e: Event) => e.preventDefault(), onClick: fn }, icon(glyph));
  if (win.titleSlot) {
    clear(win.titleSlot);
    win.titleSlot.append(
      h('span', { class: 'off-logo', 'aria-hidden': 'true' }, meta.letter),
      h('span', { class: 'off-autosave' }, 'AutoSave', h('span', { class: 'off-switch' }, 'Off')),
      qa('', 'Save (Ctrl+S)', save),
      qa('', 'Undo (Ctrl+Z)', () => doUndo()),
      qa('', 'Redo (Ctrl+Y)', () => doRedo()),
      titleName,
      h('span', { class: 'off-search' }, icon(''), h('span', null, 'Search')));
  }

  // ---- undo history (snapshots of the whole document; small documents, simple and reliable)
  function push(snap: string): void {
    if (snap === lastSnap) return;
    undoStack.push(lastSnap);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    lastSnap = snap;
  }
  function doUndo(): void { const s = undoStack.pop(); if (s === undefined) return; redoStack.push(lastSnap); lastSnap = s; opts.restore(s); dirty = true; setTitle(); }
  function doRedo(): void { const s = redoStack.pop(); if (s === undefined) return; undoStack.push(lastSnap); lastSnap = s; opts.restore(s); dirty = true; setTitle(); }

  // ---- ribbon
  const tabsEl = h('div', { class: 'rb-tabs', role: 'tablist' });
  const ribbonHost = h('div', { class: 'rb', role: 'toolbar' });
  function drawRibbon(): void {
    clear(tabsEl);
    for (const t of opts.tabs) {
      tabsEl.append(h('button', { class: `rb-tab ${t === 'File' ? 'file' : ''} ${t === tab ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': t === tab ? 'true' : 'false', onMousedown: (e: Event) => e.preventDefault(), onClick: () => { if (t === 'File') backstage('home'); else { tab = t; drawRibbon(); } } }, t));
    }
    clear(ribbonHost);
    opts.ribbon(tab, ribbonHost);
  }

  // ---- backstage
  const stage = h('div', { class: 'off-stage', hidden: true });
  function backstage(page: 'home' | 'new' | 'open' | 'saveas' | 'export'): void {
    stage.hidden = false;
    clear(stage);
    const nav = (id: typeof page, glyph: string, label: string): HTMLButtonElement => h('button', { class: `off-snav ${page === id ? 'on' : ''}`, type: 'button', onClick: () => backstage(id) }, icon(glyph), label);
    const files = store.world.files.filter((f) => !f.deleted && OPENS[kind].test(f.path)).sort((a, b) => b.modified.localeCompare(a.modified));
    const fileRow = (p: string, modified?: string): HTMLButtonElement => h('button', { class: 'off-file', type: 'button', onClick: () => open(p) },
      h('span', { class: 'off-ficon', style: `background:${meta.color}` }, meta.letter), h('span', { class: 'off-fname' }, p.split('\\').pop()!), h('span', { class: 'off-fpath' }, p.slice(0, p.lastIndexOf('\\'))), h('span', { class: 'off-fdate' }, modified ? new Date(modified).toLocaleDateString() : ''));
    const blankTile = h('button', { class: 'off-tile', type: 'button', onClick: () => { if (confirmDiscard()) { current = ''; opts.doc.blank(); lastSnap = opts.snapshot(); undoStack.length = 0; dirty = false; setTitle(); close(); } } }, h('span', { class: 'off-tile-page' }), meta.blank);
    let content: HTMLElement;
    if (page === 'home' || page === 'new') {
      const recent = (store.settings.office?.recent ?? []).filter((p) => OPENS[kind].test(p) && files.some((f) => f.path === p));
      content = h('div', null, h('h1', null, page === 'home' ? `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}` : 'New'),
        h('div', { class: 'off-tiles' }, blankTile),
        page === 'home' ? h('div', null, h('h2', null, 'Recent'), recent.length ? h('div', { class: 'off-files' }, ...recent.map((p) => fileRow(p, files.find((f) => f.path === p)?.modified))) : h('p', { class: 'muted' }, 'Files you open or save appear here.')) : null);
    } else if (page === 'open') {
      content = h('div', null, h('h1', null, 'Open'), h('p', { class: 'muted' }, `${meta.name} files on this PC (${kind === 'word' ? '.docx, .txt, .md' : kind === 'excel' ? '.xlsx, .csv' : '.pptx'})`),
        files.length ? h('div', { class: 'off-files' }, ...files.map((f) => fileRow(f.path, f.modified))) : h('p', null, 'No files yet.'));
    } else {
      const exporting = page === 'export';
      const types: [string, string][] = exporting ? opts.doc.exportTypes : [[meta.ext, `${meta.type} (*${meta.ext})`], ...opts.doc.exportTypes];
      const dirs: [string, string][] = [[docsDir(), 'Documents'], [`${homeDir(store.world)}\\Desktop`, 'Desktop'], [`${homeDir(store.world)}\\Downloads`, 'Downloads']];
      const curDir = current ? current.slice(0, current.lastIndexOf('\\')) : docsDir();
      if (!dirs.some(([d]) => d.toLowerCase() === curDir.toLowerCase())) dirs.unshift([curDir, curDir.split('\\').pop()!]);
      const dirSel = h('select', { class: 'w-input', 'aria-label': 'Folder' }, ...dirs.map(([d, l]) => h('option', { value: d, selected: d.toLowerCase() === curDir.toLowerCase() }, l)));
      const nameIn = h('input', { class: 'w-input', 'aria-label': 'File name', value: name().replace(/\.[^.]+$/, '') });
      const typeSel = h('select', { class: 'w-input', 'aria-label': 'Save as type' }, ...types.map(([e, l]) => h('option', { value: e }, l)));
      const go = (): void => {
        const base = nameIn.value.trim().replace(/[\\/:*?"<>|]/g, '');
        if (!base) { toast('Type a file name.', 'err'); return; }
        const ext = typeSel.value;
        const path = `${dirSel.value}\\${base}${ext}`;
        if (store.world.files.some((f) => !f.deleted && f.path.toLowerCase() === path.toLowerCase()) && path.toLowerCase() !== current.toLowerCase() && !confirm(`${base}${ext} already exists. Do you want to replace it?`)) return;
        if (!writeTo(path, ext)) return;
        if (ext === meta.ext || !exporting) { current = path; dirty = false; }
        setTitle();
        toast(`${exporting ? 'Exported' : 'Saved'} ${base}${ext}`, 'ok');
        close();
      };
      nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      content = h('div', null, h('h1', null, exporting ? 'Export' : 'Save As'),
        h('div', { class: 'off-saveas' }, h('label', null, 'Folder', dirSel), h('label', null, 'File name', nameIn), h('label', null, 'Type', typeSel),
          h('button', { class: 'btn primary', type: 'button', onClick: go }, icon(''), exporting ? 'Export' : 'Save')),
        exporting && kind === 'excel' ? h('p', { class: 'muted' }, 'CSV keeps values only: formulas are saved as their results and formatting is dropped, as in Excel.') : null);
      setTimeout(() => { nameIn.focus(); nameIn.select(); }, 0);
    }
    stage.append(
      h('nav', { class: 'off-snavs', style: `background:${meta.color}` },
        h('button', { class: 'off-snav back', type: 'button', title: 'Back', 'aria-label': 'Back', onClick: close }, icon('')),
        nav('home', '', 'Home'), nav('new', '', 'New'), nav('open', '', 'Open'),
        h('span', { class: 'off-snav-sep' }),
        h('button', { class: 'off-snav', type: 'button', onClick: () => { close(); save(); } }, icon(''), 'Save'),
        nav('saveas', '', 'Save As'), opts.doc.exportTypes.length ? nav('export', '', 'Export') : null,
        h('button', { class: 'off-snav', type: 'button', onClick: () => { if (confirmDiscard()) win.close(); } }, icon(''), 'Close')),
      h('div', { class: 'off-scontent' }, content));
    function close(): void { stage.hidden = true; }
  }
  const confirmDiscard = (): boolean => !dirty || confirm(`Discard the unsaved changes to ${name()}?`);

  function open(path: string): void {
    const f = store.world.files.find((x) => !x.deleted && x.path.toLowerCase() === path.toLowerCase());
    if (!f) { toast(`Cannot find ${path}`, 'err'); return; }
    if (!confirmDiscard()) return;
    current = f.path;
    opts.doc.load(f.path, f.content);
    lastSnap = opts.snapshot();
    undoStack.length = 0;
    redoStack.length = 0;
    dirty = false;
    remember(f.path);
    stage.hidden = true;
    setTitle();
    drawRibbon();
  }

  const docHost = h('div', { class: 'off-doc' });
  const status = h('div', { class: 'off-status' });
  const root = h('div', { class: `off off-${kind}`, onKeydown: (e: KeyboardEvent) => {
    const k = (e.key ?? '').toLowerCase();
    if (e.ctrlKey && k === 's') { e.preventDefault(); if (e.shiftKey) backstage('saveas'); else save(); }
    else if (e.ctrlKey && k === 'o') { e.preventDefault(); backstage('open'); }
    else if (e.ctrlKey && k === 'n') { e.preventDefault(); backstage('new'); }
    else if (e.key === 'F12') { e.preventDefault(); backstage('saveas'); }
    else if (e.ctrlKey && k === 'z' && kind !== 'word') { e.preventDefault(); doUndo(); }
    else if (e.ctrlKey && k === 'y' && kind !== 'word') { e.preventDefault(); doRedo(); }
    else if (e.key === 'Escape' && !stage.hidden) { e.preventDefault(); stage.hidden = true; }
  } }, h('div', { class: 'rb-wrap' }, tabsEl, ribbonHost), docHost, status, stage);
  host.append(root);

  const shell: OfficeShell = {
    root, ribbonHost, docHost, status,
    path: () => current,
    markDirty: () => { if (!dirty) { dirty = true; setTitle(); } },
    drawRibbon,
    save,
    undo: { push, canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0 },
  };
  if (current) {
    const f = store.world.files.find((x) => !x.deleted && x.path.toLowerCase() === current.toLowerCase());
    if (f) { opts.doc.load(f.path, f.content); remember(f.path); } else opts.doc.blank();
  } else opts.doc.blank();
  lastSnap = opts.snapshot();
  setTitle();
  drawRibbon();
  return shell;
}
