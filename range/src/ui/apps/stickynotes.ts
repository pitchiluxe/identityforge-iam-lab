/**
 * ui/apps/stickynotes.ts — Sticky Notes, as on Windows 11.
 *
 * Each note is its own small window with a coloured header (+ new note, the
 * ... menu with colours, Notes list and Delete, and close) and a formatting
 * bar (bold, italic, underline, strikethrough, bullets). The Notes list
 * searches every note. Notes belong to the person, not the company: they live
 * in settings, so resetting the lab world keeps them, and notes that were
 * open come back after the next sign-in, as on Windows.
 */
import { clear, h } from '../dom.ts';
import { persist, store } from '../store.ts';
import { type AppDef, onOpenArg, openApp } from '../wm.ts';
import { showMenu } from '../ctxmenu.ts';
import { type RichDoc, docText } from '../../core/office.ts';
import { renderDoc, richEditor } from '../richdom.ts';

export const NOTE_COLORS = {
  yellow: { name: 'Yellow', head: '#f7e26b', body: '#fff7d1', dark: '#4a4416' },
  green: { name: 'Green', head: '#a8e6a1', body: '#e4f9e0', dark: '#1e4620' },
  pink: { name: 'Pink', head: '#f5a8d4', body: '#ffe4f1', dark: '#5a1f42' },
  purple: { name: 'Purple', head: '#d3b8f2', body: '#f2e6ff', dark: '#3d2560' },
  blue: { name: 'Blue', head: '#a8d8f5', body: '#e2f1ff', dark: '#163d5a' },
  gray: { name: 'Gray', head: '#d8d8d8', body: '#f3f2f1', dark: '#333333' },
  charcoal: { name: 'Charcoal', head: '#4a4a4a', body: '#696969', dark: '#ffffff' },
} as const;
export type NoteColor = keyof typeof NOTE_COLORS;

export interface StickyNote { id: string; color: NoteColor; doc: RichDoc; modified: string; open: boolean; x?: number; y?: number; w?: number; h?: number }

const notes = (): StickyNote[] => (store.settings.stickyNotes ??= []);
const find = (id: string): StickyNote | undefined => notes().find((n) => n.id === id);
const save = (): void => persist();
const ago = (iso: string): string => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  return days < 1 ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : days < 7 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** Every list window and note window redraws its list when a note changes. */
const listeners = new Set<() => void>();
const changed = (): void => { for (const l of listeners) l(); };

export function newNote(near?: StickyNote): StickyNote {
  const n: StickyNote = { id: Math.random().toString(36).slice(2, 10), color: near?.color ?? 'yellow', doc: { paras: [{ style: 'p', runs: [] }] }, modified: new Date().toISOString(), open: true };
  if (near?.x !== undefined) { n.x = near.x + 30; n.y = (near.y ?? 0) + 30; }
  notes().unshift(n);
  save();
  changed();
  openApp(noteWindow(n.id));
  return n;
}

function deleteNote(id: string): void {
  const n = find(id);
  if (!n) return;
  if (docText(n.doc).trim() && !confirm('Delete this note? This can\'t be undone.')) return;
  store.settings.stickyNotes = notes().filter((x) => x.id !== id);
  save();
  changed();
  document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`)?.closest('.win')?.querySelector<HTMLButtonElement>('.cap.close')?.click();
}

/** One note's window. */
export function noteWindow(id: string): AppDef {
  return {
    id: `note:${id}`,
    title: 'Sticky Note',
    icon: 'stickynotes',
    width: 320,
    height: 330,
    customTitlebar: true,
    mount(host, win) {
      const note = find(id);
      if (!note) { setTimeout(() => win.close(), 0); return; }
      const frame = host.closest<HTMLElement>('.win')!;
      frame.classList.add('sn-win');
      frame.dataset.noteId = id;
      if (note.x !== undefined && note.y !== undefined) { frame.style.left = `${note.x}px`; frame.style.top = `${note.y}px`; }
      if (note.w && note.h) { frame.style.width = `${note.w}px`; frame.style.height = `${note.h}px`; }
      note.open = true;
      save();
      // Closing a note puts it away; signing out leaves it open for next time, as on Windows.
      frame.querySelector('.cap.close')?.addEventListener('click', () => { const n = find(id); if (n) { n.open = false; save(); } }, { capture: true });

      const paint = (): void => {
        const c = NOTE_COLORS[note.color];
        frame.style.setProperty('--sn-head', c.head);
        frame.style.setProperty('--sn-body', c.body);
        frame.style.setProperty('--sn-ink', note.color === 'charcoal' ? '#ffffff' : '#1f1f1f');
      };
      paint();

      let timer = 0;
      const ed = richEditor({ cls: 'sn-text', label: 'Note text', placeholder: 'Take a note...', onChange: () => {
        clearTimeout(timer);
        timer = window.setTimeout(() => { note.doc = ed.get(); note.modified = new Date().toISOString(); save(); changed(); }, 300);
      }, onSelection: () => tools() });
      ed.set(note.doc);

      const menu = (e: MouseEvent): void => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        showMenu(r.left, r.bottom, [
          ...(Object.keys(NOTE_COLORS) as NoteColor[]).map((k) => ({ label: NOTE_COLORS[k].name, icon: note.color === k ? '' : '', onClick: () => { note.color = k; save(); paint(); changed(); } })),
          '-',
          { label: 'Notes list', icon: '', onClick: () => openApp(stickyNotesApp) },
          { label: 'Delete note', icon: '', onClick: () => deleteNote(id) },
        ]);
      };
      clear(win.titleSlot!);
      win.titleSlot!.append(
        h('button', { class: 'sn-hbtn', type: 'button', title: 'New note (Ctrl+N)', 'aria-label': 'New note', onClick: () => newNote(note) }, h('span', { class: 'mdl' }, '')),
        h('span', { class: 'sn-drag' }),
        h('button', { class: 'sn-hbtn', type: 'button', title: 'Menu', 'aria-label': 'Menu', onClick: menu }, h('span', { class: 'mdl' }, '')));

      const tb = h('div', { class: 'sn-tools', role: 'toolbar', 'aria-label': 'Formatting' });
      const tool = (icon: string, label: string, on: boolean, cmd: string): HTMLButtonElement =>
        h('button', { class: `sn-tool ${on ? 'on' : ''}`, type: 'button', title: label, 'aria-label': label, 'aria-pressed': on ? 'true' : 'false', onMousedown: (e: Event) => e.preventDefault(), onClick: () => ed.exec(cmd) }, h('span', { class: 'mdl' }, icon));
      function tools(): void {
        const s = ed.state();
        tb.replaceChildren(
          tool('', 'Bold (Ctrl+B)', s.b, 'bold'),
          tool('', 'Italic (Ctrl+I)', s.i, 'italic'),
          tool('', 'Underline (Ctrl+U)', s.u, 'underline'),
          tool('', 'Strikethrough (Ctrl+T)', s.s, 'strikeThrough'),
          tool('', 'Toggle bullets (Ctrl+Shift+L)', s.ul, 'insertUnorderedList'));
      }
      tools();
      ed.el.addEventListener('keydown', (e) => {
        const k = (e.key ?? '').toLowerCase();
        if (e.ctrlKey && k === 't') { e.preventDefault(); ed.exec('strikeThrough'); }
        if (e.ctrlKey && k === 'n') { e.preventDefault(); newNote(note); }
        if (e.ctrlKey && k === 'd') { e.preventDefault(); deleteNote(id); }
      });
      host.append(h('div', { class: 'sn' }, ed.el, tb));
      setTimeout(() => ed.el.focus(), 0);

      // Remember where the note was put and how big it was.
      const remember = (): void => { note.x = frame.offsetLeft; note.y = frame.offsetTop; note.w = frame.offsetWidth; note.h = frame.offsetHeight; save(); };
      frame.addEventListener('pointerup', remember);
      const ro = new ResizeObserver(() => { clearTimeout(timer); timer = window.setTimeout(remember, 300); });
      ro.observe(frame);
      return { dispose: () => {
        ro.disconnect();
        ed.dispose();
        clearTimeout(timer);
        const n = find(id);
        if (n) { n.doc = ed.get(); save(); changed(); }
      } };
    },
  };
}

/** The Notes list: search, new note, open, delete. */
export const stickyNotesApp: AppDef = {
  id: 'stickynotes',
  title: 'Sticky Notes',
  icon: 'stickynotes',
  width: 360,
  height: 560,
  mount(host, win) {
    let q = '';
    host.closest('.win')?.classList.add('sn-list-win');
    const search = h('input', { class: 'sn-search', type: 'search', placeholder: 'Search...', 'aria-label': 'Search notes', onInput: () => { q = search.value.trim().toLowerCase(); list(); } });
    const items = h('div', { class: 'sn-items' });
    function list(): void {
      clear(items);
      const all = notes().filter((n) => !q || docText(n.doc).toLowerCase().includes(q));
      if (!all.length) {
        items.append(h('div', { class: 'sn-none' }, h('span', { class: 'mdl' }, ''), q ? 'No notes match your search.' : 'Tap + to add a note. Notes you make here stay when the company is reset.'));
        return;
      }
      for (const n of all) {
        const c = NOTE_COLORS[n.color];
        const preview = h('div', { class: 'sn-card-text' });
        renderDoc({ paras: n.doc.paras.slice(0, 6) }, preview);
        const empty = !docText(n.doc).trim();
        items.append(h('button', { class: 'sn-card', type: 'button', style: `--sn-head:${c.head};--sn-body:${c.body}`, title: 'Open note',
          onClick: () => openApp(noteWindow(n.id)),
          onContextmenu: (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); showMenu(e.clientX, e.clientY, [{ label: 'Open note', icon: '', onClick: () => openApp(noteWindow(n.id)) }, { label: 'Delete note', icon: '', onClick: () => deleteNote(n.id) }]); } },
          h('span', { class: 'sn-card-date' }, ago(n.modified)),
          empty ? h('div', { class: 'sn-card-text muted' }, 'Empty note') : preview));
      }
    }
    host.append(h('div', { class: 'sn-list' },
      h('div', { class: 'sn-list-head' },
        h('button', { class: 'sn-hbtn', type: 'button', title: 'New note (Ctrl+N)', 'aria-label': 'New note', onClick: () => newNote() }, h('span', { class: 'mdl' }, '')),
        h('h1', null, 'Sticky Notes')),
      search, items));
    list();
    listeners.add(list);
    onOpenArg(win, () => list());
    host.addEventListener('keydown', (e) => { if (e.ctrlKey && (e.key ?? '').toLowerCase() === 'n') { e.preventDefault(); newNote(); } });
    return { dispose: () => { listeners.delete(list); } };
  },
};

/** After sign-in: notes that were open when the session ended come back. */
export function restoreStickyNotes(): void {
  for (const n of notes().filter((x) => x.open)) openApp(noteWindow(n.id));
}

