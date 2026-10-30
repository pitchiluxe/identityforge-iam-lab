/**
 * PDF-XChange Editor (PDFXEdit.exe): the ribbon editor, one window with a tab
 * per document, as the real one.
 *
 * Documents are the lab PDF format (core/pdfdoc.ts). The ribbon has File,
 * Home, Edit, Comment, View, Form, Organize, Convert, Protect and Help; the
 * left pane shows Thumbnails, Comments and Search results; the status bar has
 * page navigation and zoom. Comment tools (highlight, underline, strikeout,
 * sticky note, typewriter, text box, stamps, shapes, signature) place
 * annotations by click or drag; Edit Text changes the words on the page; Form
 * fields can be filled; Organize inserts, deletes, rotates and moves pages;
 * Protect sets an open password and applies redactions for good.
 * Everything on the page is drawn with textContent and element.style.
 */
import { clear, h, toast } from '../dom.ts';
import { act, persist, store } from '../store.ts';
import { type AppDef, onOpenArg } from '../wm.ts';
import { showMenu, type MenuEntry } from '../ctxmenu.ts';
import { homeDir, writeFile } from '../../world/docs.ts';
import { group, row, col, small, big } from './office.ts';
import {
  newPdf, parsePdf, writePdf, addAnnot, updateAnnot, removeAnnot, insertPages, deletePages, rotatePages, movePage, searchPdf,
  setBlockText, addTextBlock, markRedactions, applyRedactions, fillField, addField, setOpenPassword, checkOpenPassword, isProtected, pdfText,
  STAMPS, DEFAULT_COLOR, PAGE_POINTS, type AnnotKind, type PdfAnnot, type PdfDoc, type PdfHit,
} from '../../core/pdfdoc.ts';

export interface PdfxSettings { recent: string[]; zoom: number; pane: 'thumbs' | 'comments' | 'search' | 'none'; author: string }
const DEFAULTS: PdfxSettings = { recent: [], zoom: 100, pane: 'thumbs', author: '' };
const prefs = (): PdfxSettings => ({ ...DEFAULTS, ...(store.settings.pdfxchange ?? {}) });

type Tool = 'hand' | 'select' | 'edit' | 'addtext' | AnnotKind | 'textfield' | 'checkfield';
const DRAG_TOOLS: Tool[] = ['highlight', 'underline', 'strikeout', 'textbox', 'rect', 'ellipse', 'line', 'arrow', 'textfield', 'checkfield'];
const TOOL_NAMES: Partial<Record<Tool, string>> = {
  hand: 'Hand', select: 'Select Text', edit: 'Edit Text', addtext: 'Add Text', highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikeout', note: 'Sticky Note',
  typewriter: 'Typewriter', textbox: 'Text Box', stamp: 'Stamp', rect: 'Rectangle', ellipse: 'Oval', line: 'Line', arrow: 'Arrow', signature: 'Signature', textfield: 'Text Field', checkfield: 'Check Box',
};

interface Tab { path: string; name: string; doc: PdfDoc; saved: string; undo: PdfDoc[]; redo: PdfDoc[]; page: number; selected: string | null }

const fileOf = (path: string): { content: string; readOnly: boolean } | undefined => {
  const f = store.world.files.find((x) => x.path.toLowerCase() === path.toLowerCase() && !x.deleted);
  return f ? { content: f.content, readOnly: f.readOnly } : undefined;
};
const nowIso = (): string => new Date().toISOString();

export const pdfxchangeApp: AppDef = {
  id: 'pdfxchange',
  title: 'PDF-XChange Editor',
  icon: 'pdfxchange',
  width: 1180,
  height: 780,
  mount(host, win) {
    let p = prefs();
    const savePrefs = (patch: Partial<PdfxSettings>): void => { p = { ...p, ...patch }; store.settings.pdfxchange = p; persist(); };
    const author = (): string => p.author || store.world.player?.displayName || 'admin';
    const tabs: Tab[] = [];
    let cur = -1;
    let ribbonTab = 'Home';
    let tool: Tool = 'hand';
    let stamp: string = STAMPS[0];
    let color = '';
    let hits: PdfHit[] = [];
    let query = '';
    let findOpts = { matchCase: false, wholeWord: false };
    let highlightFields = true;

    const root = h('div', { class: 'pdx', tabindex: '-1' });
    const ribbonTabs = h('div', { class: 'pdx-rtabs', role: 'tablist' });
    const ribbon = h('div', { class: 'rb pdx-rb', role: 'toolbar' });
    const docTabs = h('div', { class: 'pdx-doctabs', role: 'tablist' });
    const paneStrip = h('div', { class: 'pdx-strip' });
    const pane = h('div', { class: 'pdx-pane' });
    const view = h('div', { class: 'pdx-view', tabindex: '0', 'aria-label': 'Document view' });
    const status = h('div', { class: 'pdx-status' });
    const main = h('div', { class: 'pdx-main' }, paneStrip, pane, view);
    root.append(h('div', { class: 'pdx-rb-wrap' }, ribbonTabs, ribbon), docTabs, main, status);
    host.append(root);
    host.closest<HTMLElement>('.win')?.style.setProperty('--off', '#c8102e');

    const tab = (): Tab | undefined => tabs[cur];
    const dirty = (t: Tab): boolean => writePdf(t.doc) !== t.saved;

    // ---------------------------------------------------------------- documents
    function change(fn: (d: PdfDoc) => PdfDoc, redraw = true): boolean {
      const t = tab();
      if (!t) return false;
      try {
        const next = fn(t.doc);
        if (next === t.doc) return false;
        t.undo.push(t.doc); if (t.undo.length > 100) t.undo.shift();
        t.redo = [];
        t.doc = next;
        if (t.page >= next.pages.length) t.page = next.pages.length - 1;
        if (redraw) drawAll();
        return true;
      } catch (e) {
        alertBox('PDF-XChange Editor', (e as Error).message);
        return false;
      }
    }
    function undo(): void { const t = tab(); const d = t?.undo.pop(); if (!t || !d) return; t.redo.push(t.doc); t.doc = d; t.page = Math.min(t.page, d.pages.length - 1); drawAll(); }
    function redo(): void { const t = tab(); const d = t?.redo.pop(); if (!t || !d) return; t.undo.push(t.doc); t.doc = d; drawAll(); }
    function remember(path: string): void { savePrefs({ recent: [path, ...p.recent.filter((x) => x.toLowerCase() !== path.toLowerCase())].slice(0, 10) }); }

    function openPath(path: string): void {
      const i = tabs.findIndex((t) => t.path.toLowerCase() === path.toLowerCase());
      if (i >= 0) { cur = i; drawAll(); return; }
      const f = fileOf(path);
      if (!f) { alertBox('Error', `Error opening document.\n\n${path}\nThe system cannot find the file specified.`); return; }
      let d: PdfDoc;
      try { d = parsePdf(f.content); } catch (e) { alertBox('Error', `Error opening document.\n\n${path}\n${(e as Error).message}`); return; }
      const add = (): void => { tabs.push({ path, name: path.split('\\').pop()!, doc: d, saved: writePdf(d), undo: [], redo: [], page: 0, selected: null }); cur = tabs.length - 1; remember(path); drawAll(); };
      if (!isProtected(d)) { add(); return; }
      const pw = h('input', { class: 'pdx-input', type: 'password', 'aria-label': 'Document Open Password' });
      const msg = h('p', { class: 'pdx-msg err' });
      modal('Password', [h('p', { class: 'pdx-msg' }, `"${path.split('\\').pop()}" is protected. Please enter a Document Open Password.`), pw, msg], [
        ['OK', () => { if (!checkOpenPassword(d, pw.value)) { msg.textContent = 'Invalid password.'; pw.select(); return false; } add(); return undefined; }],
        ['Cancel', () => undefined],
      ]);
    }
    function newDoc(): void {
      let n = 1;
      while (tabs.some((t) => t.name === `Untitled${n}.pdf`)) n++;
      const d = newPdf(`Untitled${n}`, author());
      tabs.push({ path: '', name: `Untitled${n}.pdf`, doc: d, saved: '', undo: [], redo: [], page: 0, selected: null });
      cur = tabs.length - 1;
      drawAll();
    }
    function writeTo(t: Tab, path: string): boolean {
      if (fileOf(path)?.readOnly) { alertBox('Error', `Error saving document.\n\n${path}\nAccess is denied.`); return false; }
      const raw = writePdf(t.doc);
      if (!act((w) => writeFile(w, path, raw))) return false;
      t.path = path; t.name = path.split('\\').pop()!; t.saved = raw;
      remember(path);
      return true;
    }
    function save(t = tab(), then?: () => void): void {
      if (!t) return;
      if (!t.path || fileOf(t.path)?.readOnly) { saveAs(t, then); return; }
      if (writeTo(t, t.path)) { toast(`Saved ${t.name}`, 'ok'); drawAll(); then?.(); }
    }
    function closeTab(i: number): void {
      const t = tabs[i];
      if (!t) return;
      const finish = (): void => { tabs.splice(i, 1); cur = Math.min(cur >= i && cur > 0 ? cur - 1 : cur, tabs.length - 1); drawAll(); };
      if (!dirty(t)) { finish(); return; }
      modal('PDF-XChange Editor', [h('p', { class: 'pdx-msg' }, `Save changes to "${t.name}" before closing?`)], [
        ['Yes', () => { save(t, finish); }], ['No', () => { finish(); }], ['Cancel', () => undefined],
      ]);
    }
    let closing = false;
    function beforeClose(): boolean {
      if (closing || !tabs.some(dirty)) return true;
      const pending = tabs.filter(dirty);
      const next = (): void => {
        const t = pending.shift();
        if (!t) { closing = true; win.close(); return; }
        modal('PDF-XChange Editor', [h('p', { class: 'pdx-msg' }, `Save changes to "${t.name}" before closing?`)], [
          ['Yes', () => { setTimeout(() => save(t, next), 0); }],
          ['No', () => { setTimeout(next, 0); }], ['Cancel', () => undefined],
        ]);
      };
      next();
      return false;
    }

    // ---------------------------------------------------------------- dialogs
    function modal(title: string, content: HTMLElement[], buttons: [string, () => boolean | void][], wide = false): () => void {
      root.querySelector('.pdx-modal')?.remove();
      const close = (): void => { wrap.remove(); view.focus(); };
      const dlg = h('div', { class: `pdx-dlg${wide ? ' wide' : ''}`, role: 'dialog', 'aria-label': title },
        h('div', { class: 'pdx-dlg-title' }, h('span', null, title), h('button', { class: 'pdx-x', type: 'button', 'aria-label': 'Close', onClick: close }, '✕')),
        h('div', { class: 'pdx-dlg-body' }, ...content),
        h('div', { class: 'pdx-dlg-btns' }, buttons.map(([l, fn], i) => h('button', { class: `pdx-btn${i === 0 ? ' def' : ''}`, type: 'button', onClick: () => { if (fn() !== false) close(); } }, l))));
      const wrap = h('div', { class: 'pdx-modal', onKeydown: (e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); (dlg.querySelector('.pdx-btn.def') as HTMLButtonElement | null)?.click(); } } }, dlg);
      root.append(wrap);
      setTimeout(() => (dlg.querySelector('input, select, textarea, .pdx-btn') as HTMLElement | null)?.focus(), 0);
      return close;
    }
    function alertBox(title: string, message: string): void { modal(title, message.split('\n').map((l) => h('p', { class: 'pdx-msg' }, l || ' ')), [['OK', () => undefined]]); }
    const field = (label: string, el: HTMLElement): HTMLElement => h('label', { class: 'pdx-field' }, h('span', null, label), el);

    const FOLDERS = (): string[] => ['Desktop', 'Documents', 'Documents\\Evidence', 'Documents\\Policies', 'Documents\\Reference', 'Downloads'].map((x) => `${homeDir(store.world)}\\${x}`);
    const rel = (path: string): string => path.replace(`${homeDir(store.world)}\\`, '');
    function openDialog(): void {
      let folder = `${homeDir(store.world)}\\Documents\\Policies`;
      const list = h('select', { class: 'pdx-list', size: 10, 'aria-label': 'Files', onDblclick: () => { if (list.value) { close(); openPath(list.value); } } });
      const fill = (): void => {
        clear(list);
        const pre = `${folder.toLowerCase()}\\`;
        for (const f of store.world.files.filter((x) => !x.deleted && x.path.toLowerCase().startsWith(pre) && !x.path.slice(pre.length).includes('\\') && /\.pdf$/i.test(x.path)).sort((a, b) => a.path.localeCompare(b.path))) list.append(h('option', { value: f.path }, f.path.split('\\').pop()!));
        if (!list.options.length) list.append(h('option', { value: '', disabled: true }, 'No PDF documents in this folder'));
      };
      const pick = h('select', { class: 'pdx-input', 'aria-label': 'Look in', onChange: (e: Event) => { folder = (e.target as HTMLSelectElement).value; fill(); } }, FOLDERS().map((f) => h('option', { value: f, selected: f === folder }, rel(f))));
      fill();
      const close = modal('Open', [field('Look in:', pick), list, field('Files of type:', h('select', { class: 'pdx-input', disabled: true }, h('option', null, 'PDF Documents (*.pdf)')))], [
        ['Open', () => { if (!list.value) return false; setTimeout(() => openPath(list.value), 0); return undefined; }], ['Cancel', () => undefined]], true);
    }
    function saveAs(t = tab(), then?: () => void): void {
      if (!t) return;
      const dir = t.path ? t.path.split('\\').slice(0, -1).join('\\') : `${homeDir(store.world)}\\Documents`;
      const pick = h('select', { class: 'pdx-input', 'aria-label': 'Save in' }, FOLDERS().map((f) => h('option', { value: f, selected: f.toLowerCase() === dir.toLowerCase() }, rel(f))));
      const name = h('input', { class: 'pdx-input', value: fileOf(t.path)?.readOnly ? t.name.replace(/\.pdf$/i, ' - Copy.pdf') : t.name, 'aria-label': 'File name' });
      modal('Save As', [field('Save in:', pick), field('File name:', name), field('Save as type:', h('select', { class: 'pdx-input', disabled: true }, h('option', null, 'PDF Document (*.pdf)')))], [
        ['Save', () => {
          let n = name.value.trim();
          if (!n || /[\\/:*?"<>|]/.test(n)) { toast('A file name can\'t contain any of the following characters: \\ / : * ? " < > |', 'err'); return false; }
          if (!/\.pdf$/i.test(n)) n += '.pdf';
          const target = `${pick.value}\\${n}`;
          const finish = (): void => { if (writeTo(t, target)) { toast(`Saved ${n}`, 'ok'); drawAll(); then?.(); } };
          if (fileOf(target) && target.toLowerCase() !== t.path.toLowerCase()) {
            setTimeout(() => modal('Confirm Save As', [h('p', { class: 'pdx-msg' }, `${n} already exists. Do you want to replace it?`)], [
              ['Yes', () => { setTimeout(finish, 0); }], ['No', () => undefined],
            ]), 0);
          } else setTimeout(finish, 0);
          return undefined;
        }], ['Cancel', () => undefined]], true);
      setTimeout(() => { name.focus(); name.setSelectionRange(0, name.value.replace(/\.pdf$/i, '').length); }, 0);
    }
    function properties(): void {
      const t = tab();
      if (!t) return;
      const d = t.doc;
      const title = h('input', { class: 'pdx-input', value: d.title, 'aria-label': 'Title' });
      const auth = h('input', { class: 'pdx-input', value: d.author, 'aria-label': 'Author' });
      const subj = h('input', { class: 'pdx-input', value: d.subject, 'aria-label': 'Subject' });
      const [w, hh] = PAGE_POINTS[d.pages[t.page]!.size];
      modal('Document Properties', [
        h('fieldset', { class: 'pdx-group' }, h('legend', null, 'Description'), field('File:', h('span', null, t.path || '(not saved)')), field('Title:', title), field('Author:', auth), field('Subject:', subj)),
        h('fieldset', { class: 'pdx-group' }, h('legend', null, 'Advanced'), field('Producer:', h('span', null, d.producer)), field('PDF Version:', h('span', null, '1.7 (Acrobat 8.x)')), field('Pages:', h('span', null, String(d.pages.length))),
          field('Page Size:', h('span', null, `${(w / 72 * 25.4).toFixed(1)} x ${(hh / 72 * 25.4).toFixed(1)} mm (${d.pages[t.page]!.size})`)),
          field('Security:', h('span', null, isProtected(d) ? 'Password Security' : 'No Security')),
          field('Comments:', h('span', null, String(d.annots.length))), field('Form fields:', h('span', null, String(d.fields.length)))),
      ], [['OK', () => { change((x) => (x.title === title.value && x.author === auth.value && x.subject === subj.value ? x : { ...x, title: title.value, author: auth.value, subject: subj.value })); }], ['Cancel', () => undefined]], true);
    }
    function passwordDialog(): void {
      const t = tab();
      if (!t) return;
      const on = h('input', { type: 'checkbox', checked: isProtected(t.doc), 'aria-label': 'Require a password to open the document' });
      const a = h('input', { class: 'pdx-input', type: 'password', 'aria-label': 'Document Open Password' });
      const b = h('input', { class: 'pdx-input', type: 'password', 'aria-label': 'Confirm Document Open Password' });
      const msg = h('p', { class: 'pdx-msg err' });
      modal('Password Security - Settings', [h('label', { class: 'pdx-check' }, on, ' Require a password to open the document'), field('Document Open Password:', a), field('Confirm Password:', b), msg,
        h('p', { class: 'pdx-msg dim' }, 'The password is applied when the document is saved. Keep it in the PAM vault, never in the ticket.')], [
        ['OK', () => {
          if (!on.checked) { change((d) => (isProtected(d) ? setOpenPassword(d, null) : d)); return undefined; }
          if (a.value.length < 6) { msg.textContent = 'The password must be at least 6 characters.'; return false; }
          if (a.value !== b.value) { msg.textContent = 'Passwords do not match.'; return false; }
          change((d) => setOpenPassword(d, a.value));
          toast('Password security will be applied when you save', 'info');
          return undefined;
        }], ['Cancel', () => undefined]], true);
    }
    function redactDialog(): void {
      const q = h('input', { class: 'pdx-input', 'aria-label': 'Text to redact', placeholder: 'e.g. 123-45-6789' });
      modal('Search & Redact', [field('Search for:', q), h('p', { class: 'pdx-msg dim' }, 'Every match is marked for redaction. Review the marks, then use Apply All Redactions.')], [
        ['Mark', () => {
          if (!q.value) return false;
          const n = searchPdf(tab()!.doc, q.value, { matchCase: true }).length;
          if (!n) { toast(`No matches found for "${q.value}"`); return false; }
          change((d) => markRedactions(d, q.value, author(), nowIso()));
          toast(`${n} match${n === 1 ? '' : 'es'} marked for redaction`);
          return undefined;
        }], ['Cancel', () => undefined]]);
    }
    function applyRedactDialog(): void {
      const t = tab();
      if (!t) return;
      const n = t.doc.annots.filter((a) => a.kind === 'redact').length;
      if (!n) { alertBox('Apply All Redactions', 'There are no redaction marks in this document.'); return; }
      modal('Apply All Redactions', [h('p', { class: 'pdx-msg' }, `You are about to apply ${n} redaction mark${n === 1 ? '' : 's'}. The marked content will be permanently removed and cannot be recovered after saving.`), h('p', { class: 'pdx-msg' }, 'Do you want to continue?')], [
        ['Yes', () => { change(applyRedactions); }], ['No', () => undefined]]);
    }
    function insertPagesDialog(): void {
      const t = tab();
      if (!t) return;
      const count = h('input', { class: 'pdx-input', type: 'number', min: '1', max: '50', value: '1', 'aria-label': 'Number of pages' });
      const where = h('select', { class: 'pdx-input', 'aria-label': 'Location' }, h('option', { value: 'after' }, 'After current page'), h('option', { value: 'before' }, 'Before current page'), h('option', { value: 'end' }, 'After last page'));
      const size = h('select', { class: 'pdx-input', 'aria-label': 'Page size' }, h('option', { value: 'Letter' }, 'Letter (8.5 x 11 in)'), h('option', { value: 'A4' }, 'A4 (210 x 297 mm)'));
      modal('Insert Empty Pages', [field('Count:', count), field('Location:', where), field('Page size:', size)], [['OK', () => {
        const n = Math.min(50, Math.max(1, Number(count.value) || 1));
        const at = where.value === 'before' ? t.page : where.value === 'end' ? t.doc.pages.length : t.page + 1;
        if (change((d) => insertPages(d, at, n, size.value as 'Letter' | 'A4'))) { t.page = at; drawAll(); scrollToPage(at); }
      }], ['Cancel', () => undefined]]);
    }
    function parseRange(s: string, max: number): number[] | null {
      const out = new Set<number>();
      for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
        const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
        if (!m) return null;
        const a = Number(m[1]), b = Number(m[2] ?? m[1]);
        if (a < 1 || b > max || a > b) return null;
        for (let i = a; i <= b; i++) out.add(i - 1);
      }
      return out.size ? [...out] : null;
    }
    function deletePagesDialog(): void {
      const t = tab();
      if (!t) return;
      const r = h('input', { class: 'pdx-input', value: String(t.page + 1), 'aria-label': 'Pages' });
      modal('Delete Pages', [field('Pages:', r), h('p', { class: 'pdx-msg dim' }, `e.g. 1,3-5 (document has ${t.doc.pages.length} pages)`)], [['OK', () => {
        const idx = parseRange(r.value, t.doc.pages.length);
        if (!idx) { toast('Invalid page range', 'err'); return false; }
        change((d) => deletePages(d, idx));
        return undefined;
      }], ['Cancel', () => undefined]]);
    }
    function signatureDialog(at: { page: number; x: number; y: number }): void {
      const n = h('input', { class: 'pdx-input', value: store.world.player?.displayName ?? '', 'aria-label': 'Type your name' });
      const preview = h('div', { class: 'pdx-sig-preview' }, n.value);
      n.addEventListener('input', () => { preview.textContent = n.value; });
      modal('Add Signature', [field('Type your name:', n), preview, h('p', { class: 'pdx-msg dim' }, 'A typed signature is an appearance only. It is not a digital (certificate) signature.')], [['Place', () => {
        if (!n.value.trim()) return false;
        place({ page: at.page, kind: 'signature', x: at.x, y: at.y, w: 26, h: 5, text: n.value.trim(), color: DEFAULT_COLOR.signature, author: author() });
        return undefined;
      }], ['Cancel', () => undefined]]);
    }
    function about(): void { alertBox('About PDF-XChange Editor', 'PDF-XChange Editor\nVersion 10.4.0 (64-bit)\n\nRange edition: opens and saves the lab PDF documents on this workstation.\nThe real product is made by PDF-XChange Co. Ltd.'); }

    // ---------------------------------------------------------------- annotations
    function place(a: Omit<PdfAnnot, 'id' | 'created'>): void {
      const t = tab();
      if (!t) return;
      if (change((d) => addAnnot(d, { ...a, color: color || a.color }, nowIso()), false)) {
        t.selected = t.doc.annots[t.doc.annots.length - 1]!.id;
        if (tool !== 'stamp') tool = 'hand';
        drawAll();
        if (a.kind === 'note' || a.kind === 'typewriter' || a.kind === 'textbox') setTimeout(() => (view.querySelector('.pdx-annot.sel textarea') as HTMLTextAreaElement | null)?.focus(), 30);
      }
    }
    function selectedAnnot(): PdfAnnot | undefined { const t = tab(); return t?.doc.annots.find((a) => a.id === t.selected); }

    // ---------------------------------------------------------------- page rendering
    const BASE = 816; // Letter width at 100 % (8.5 in x 96 dpi)
    function pageEl(i: number): HTMLElement {
      const t = tab()!;
      const pg = t.doc.pages[i]!;
      const [pw, ph] = PAGE_POINTS[pg.size];
      const z = p.zoom / 100;
      const w = BASE * (pw / 612) * z, hgt = BASE * (ph / 612) * z;
      const sideways = pg.rotate === 90 || pg.rotate === 270;
      const inner = h('div', { class: `pdx-page${tool === 'edit' ? ' editing' : ''}${highlightFields ? ' hl-fields' : ''}`, style: `width:${w}px;height:${hgt}px;--z:${z};transform:rotate(${pg.rotate}deg)`, 'data-page': String(i) });
      const outer = h('div', { class: `pdx-page-wrap${i === t.page ? ' current' : ''}`, style: `width:${sideways ? hgt : w}px;height:${sideways ? w : hgt}px` }, inner);
      // text
      const content = h('div', { class: 'pdx-content' });
      const redactions = t.doc.annots.filter((a) => a.kind === 'redact' && a.page === i && a.text);
      pg.blocks.forEach((b, bi) => {
        const el = h('div', { class: `pdx-b pdx-${b.kind}`, 'data-block': String(bi) });
        const marks: { start: number; end: number; cls: string }[] = [
          ...hits.filter((x) => x.page === i && x.block === bi).map((x) => ({ start: x.start, end: x.end, cls: 'hit' })),
          ...redactions.flatMap((r) => [...b.text.matchAll(new RegExp(r.text!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((m) => ({ start: m.index, end: m.index + m[0].length, cls: 'redact-mark' }))),
        ].sort((a, c) => a.start - c.start);
        let pos = 0;
        for (const m of marks) { if (m.start < pos) continue; if (m.start > pos) el.append(b.text.slice(pos, m.start)); el.append(h('span', { class: m.cls }, b.text.slice(m.start, m.end))); pos = m.end; }
        if (pos < b.text.length) el.append(b.text.slice(pos));
        if (tool === 'edit') {
          el.contentEditable = 'plaintext-only';
          el.addEventListener('focus', () => { el.textContent = b.text; });
          el.addEventListener('blur', () => { const v = el.textContent ?? ''; if (v !== b.text) change((d) => setBlockText(d, i, bi, v)); });
          el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { el.textContent = b.text; el.blur(); } });
        }
        content.append(el);
      });
      inner.append(content);
      // form fields
      for (const f of t.doc.fields.filter((x) => x.page === i)) {
        const pos = `left:${f.x}%;top:${f.y}%;width:${f.w}%;height:${f.h}%`;
        inner.append(h('span', { class: 'pdx-flabel', style: `top:${f.y}%;right:${100 - f.x + 1}%;height:${f.h}%` }, f.name));
        const input = f.type === 'check'
          ? h('input', { type: 'checkbox', class: 'pdx-fcheck', style: pos, checked: f.value === 'Yes', 'aria-label': f.name, onChange: (e: Event) => { change((d) => fillField(d, f.id, (e.target as HTMLInputElement).checked ? 'Yes' : 'Off'), false); retitle(); } })
          : h('input', { type: f.type === 'date' ? 'date' : 'text', class: 'pdx-ftext', style: pos, value: f.value, 'aria-label': f.name, onChange: (e: Event) => { change((d) => fillField(d, f.id, (e.target as HTMLInputElement).value), false); retitle(); } });
        inner.append(input);
      }
      // annotations
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'pdx-lines');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      for (const a of t.doc.annots.filter((x) => x.page === i && x.kind !== 'redact')) {
        if (a.kind === 'line' || a.kind === 'arrow') {
          // Lines keep their start in x,y and their end in w,h.
          const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          for (const [k, v] of [['x1', a.x], ['y1', a.y], ['x2', a.w], ['y2', a.h]] as const) ln.setAttribute(k, String(v));
          ln.setAttribute('stroke', a.color);
          ln.setAttribute('stroke-width', '2');
          ln.setAttribute('vector-effect', 'non-scaling-stroke');
          ln.setAttribute('class', `pdx-ln${t.selected === a.id ? ' sel' : ''}`);
          if (a.kind === 'arrow') ln.setAttribute('marker-end', `url(#pdx-arrow-${i})`);
          ln.addEventListener('pointerdown', (e) => { if (tool !== 'hand' && tool !== 'select') return; e.stopPropagation(); t.selected = a.id; drawAll(); });
          svg.append(ln);
          continue;
        }
        inner.append(annotEl(a));
      }
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', `pdx-arrow-${i}`); marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '6'); marker.setAttribute('markerHeight', '6'); marker.setAttribute('orient', 'auto-start-reverse');
      const tip = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tip.setAttribute('d', 'M0 0L10 5L0 10z'); tip.setAttribute('fill', 'context-stroke');
      marker.append(tip); defs.append(marker); svg.prepend(defs);
      inner.append(svg);
      bindPage(inner, i);
      return outer;
    }
    function annotEl(a: PdfAnnot): HTMLElement {
      const t = tab()!;
      const sel = t.selected === a.id;
      const el = h('div', { class: `pdx-annot k-${a.kind}${sel ? ' sel' : ''}`, style: `left:${a.x}%;top:${a.y}%;width:${a.w}%;height:${a.h}%;--c:${a.color}`, title: `${a.author}  ${new Date(a.created).toLocaleString()}${a.text ? `\n${a.text}` : ''}` });
      if (a.kind === 'note') el.append(h('span', { class: 'mdl' }, ''));
      if (a.kind === 'stamp') el.append(h('span', { class: 'pdx-stamp-t' }, (a.text ?? '').toUpperCase()), h('span', { class: 'pdx-stamp-s' }, `By ${a.author} at ${new Date(a.created).toLocaleString()}`));
      if (a.kind === 'signature') el.append(h('span', { class: 'pdx-sig' }, a.text ?? ''));
      if (a.kind === 'typewriter' || a.kind === 'textbox') {
        if (sel) {
          const ta = h('textarea', { class: 'pdx-annot-text', 'aria-label': 'Text', spellcheck: 'false' }, a.text ?? '');
          ta.addEventListener('pointerdown', (e) => e.stopPropagation());
          ta.addEventListener('change', () => { change((d) => updateAnnot(d, a.id, { text: ta.value }), false); retitle(); });
          el.append(ta);
        } else el.append(h('span', { class: 'pdx-annot-txt' }, a.text ?? ''));
      }
      if (sel && a.kind === 'note') {
        const ta = h('textarea', { class: 'pdx-popup-text', 'aria-label': 'Comment', placeholder: 'Type your comment', spellcheck: 'false' }, a.text ?? '');
        ta.addEventListener('pointerdown', (e) => e.stopPropagation());
        ta.addEventListener('change', () => { change((d) => updateAnnot(d, a.id, { text: ta.value }), false); retitle(); drawPane(); });
        el.append(h('div', { class: 'pdx-popup' }, h('div', { class: 'pdx-popup-head' }, h('strong', null, a.author), h('span', null, new Date(a.created).toLocaleString())), ta));
      }
      el.addEventListener('pointerdown', (e) => {
        if (tool !== 'hand' && tool !== 'select') return;
        e.stopPropagation();
        if (t.selected !== a.id) { t.selected = a.id; drawAll(); return; }
        // Drag to move.
        const pageBox = el.parentElement!.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY, ox = a.x, oy = a.y;
        const move = (ev: PointerEvent): void => { el.style.left = `${Math.max(0, Math.min(100 - a.w, ox + (ev.clientX - sx) / pageBox.width * 100))}%`; el.style.top = `${Math.max(0, Math.min(100 - a.h, oy + (ev.clientY - sy) / pageBox.height * 100))}%`; };
        const up = (ev: PointerEvent): void => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          const dx = (ev.clientX - sx) / pageBox.width * 100, dy = (ev.clientY - sy) / pageBox.height * 100;
          if (Math.abs(dx) + Math.abs(dy) > 0.3) change((d) => updateAnnot(d, a.id, { x: Math.max(0, Math.min(100 - a.w, ox + dx)), y: Math.max(0, Math.min(100 - a.h, oy + dy)) }));
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      });
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); t.selected = a.id; drawAll(); showMenu(e.clientX, e.clientY, annotMenu(a)); });
      return el;
    }
    function annotMenu(a: PdfAnnot): MenuEntry[] {
      return [
        { label: 'Delete', shortcut: 'Del', onClick: () => change((d) => removeAnnot(d, a.id)) },
        { label: 'Color', submenu: ['#ffff00', '#ff0000', '#00a000', '#0000ff', '#ff8c00', '#000000'].map((c) => ({ label: c, checked: a.color === c, onClick: () => change((d) => updateAnnot(d, a.id, { color: c })) })) },
        { label: 'Bring to Front', onClick: () => change((d) => ({ ...d, annots: [...d.annots.filter((x) => x.id !== a.id), a] })) },
      ];
    }
    /** Click and drag on a page with the current tool. */
    function bindPage(pageDiv: HTMLElement, i: number): void {
      pageDiv.addEventListener('pointerdown', (e) => {
        const t = tab()!;
        if ((e.target as HTMLElement).closest('input, textarea')) return;
        t.page = i;
        if (tool === 'hand' || tool === 'select' || tool === 'edit') {
          if (t.selected) { t.selected = null; drawAll(); }
          if (tool === 'hand' && e.button === 0) {
            const sx = e.clientX, sy = e.clientY, sl = view.scrollLeft, st = view.scrollTop;
            const move = (ev: PointerEvent): void => { view.scrollLeft = sl - (ev.clientX - sx); view.scrollTop = st - (ev.clientY - sy); };
            const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
          }
          drawStatus();
          return;
        }
        e.preventDefault();
        const box = pageDiv.getBoundingClientRect();
        const rot = t.doc.pages[i]!.rotate;
        const toPct = (cx: number, cy: number): [number, number] => {
          // Undo the page rotation: convert screen point to the unrotated page.
          let u = (cx - box.left) / box.width, v = (cy - box.top) / box.height;
          if (rot === 90) [u, v] = [v, 1 - u]; else if (rot === 180) [u, v] = [1 - u, 1 - v]; else if (rot === 270) [u, v] = [1 - v, u];
          return [Math.max(0, Math.min(100, u * 100)), Math.max(0, Math.min(100, v * 100))];
        };
        const [x0, y0] = toPct(e.clientX, e.clientY);
        if (tool === 'note') { place({ page: i, kind: 'note', x: Math.min(x0, 96), y: Math.min(y0, 96), w: 3, h: 3, text: '', color: DEFAULT_COLOR.note, author: author() }); return; }
        if (tool === 'typewriter') { place({ page: i, kind: 'typewriter', x: x0, y: y0, w: Math.min(40, 100 - x0), h: 3, text: '', color: DEFAULT_COLOR.typewriter, author: author() }); return; }
        if (tool === 'stamp') { place({ page: i, kind: 'stamp', x: Math.min(x0, 72), y: Math.min(y0, 94), w: 28, h: 6, text: stamp, color: stamp === 'Approved' || stamp === 'Completed' || stamp === 'Final' ? '#2e7d32' : stamp === 'Not Approved' || stamp === 'Void' || stamp === 'Confidential' ? '#c62828' : '#1f4e9c', author: author() }); return; }
        if (tool === 'signature') { signatureDialog({ page: i, x: Math.min(x0, 74), y: Math.min(y0, 95) }); return; }
        if (tool === 'addtext') { change((d) => addTextBlock(d, i, 'New text')); tool = 'edit'; drawAll(); return; }
        if (!DRAG_TOOLS.includes(tool)) return;
        const ghost = h('div', { class: 'pdx-ghost' });
        pageDiv.append(ghost);
        let x1 = x0, y1 = y0;
        const move = (ev: PointerEvent): void => {
          [x1, y1] = toPct(ev.clientX, ev.clientY);
          Object.assign(ghost.style, { left: `${Math.min(x0, x1)}%`, top: `${Math.min(y0, y1)}%`, width: `${Math.abs(x1 - x0)}%`, height: `${Math.abs(y1 - y0)}%` });
        };
        const up = (): void => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          ghost.remove();
          const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
          const k = tool;
          if (k === 'line' || k === 'arrow') { if (w + hh < 1) return; place({ page: i, kind: k, x: x0, y: y0, w: x1, h: y1, color: DEFAULT_COLOR[k], author: author() }); return; }
          if (k === 'textfield' || k === 'checkfield') {
            const n = h('input', { class: 'pdx-input', 'aria-label': 'Field name', value: k === 'checkfield' ? 'Check Box' : 'Text Field' });
            modal('Field Properties', [field('Name:', n)], [['OK', () => {
              if (!n.value.trim()) return false;
              change((d) => addField(d, { page: i, name: n.value.trim(), type: k === 'checkfield' ? 'check' : 'text', x, y, w: k === 'checkfield' ? 2.4 : Math.max(8, w), h: k === 'checkfield' ? 2.4 : Math.max(2.4, hh) }));
              return undefined;
            }], ['Cancel', () => undefined]]);
            return;
          }
          if (w < 0.8 && hh < 0.8) return;
          const kind = k as AnnotKind;
          place({ page: i, kind, x, y, w: Math.max(w, 1), h: Math.max(hh, kind === 'highlight' || kind === 'underline' || kind === 'strikeout' ? 1.2 : 1), text: kind === 'textbox' ? '' : undefined, color: DEFAULT_COLOR[kind], author: author() });
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      });
    }

    // ---------------------------------------------------------------- panes, status, tabs
    function drawPane(): void {
      clear(paneStrip); clear(pane);
      const t = tab();
      const strip = (id: PdfxSettings['pane'], glyph: string, label: string): HTMLElement => h('button', { class: `pdx-strip-b${p.pane === id ? ' on' : ''}`, type: 'button', title: label, 'aria-label': label, onClick: () => { savePrefs({ pane: p.pane === id ? 'none' : id }); drawPane(); } }, h('span', { class: 'mdl' }, glyph));
      paneStrip.append(strip('thumbs', '', 'Thumbnails'), strip('comments', '', 'Comments'), strip('search', '', 'Search'));
      pane.hidden = p.pane === 'none' || !t;
      if (!t || p.pane === 'none') return;
      if (p.pane === 'thumbs') {
        pane.append(h('div', { class: 'pdx-pane-head' }, 'Thumbnails'));
        const list = h('div', { class: 'pdx-thumbs' });
        t.doc.pages.forEach((pg, i) => {
          const mini = h('div', { class: `pdx-thumb-page${pg.size === 'A4' ? ' a4' : ''}`, style: `transform:rotate(${pg.rotate}deg)` }, pg.blocks.slice(0, 8).map((b) => h('div', { class: `pdx-thumb-line k-${b.kind}` })));
          list.append(h('button', { class: `pdx-thumb${i === t.page ? ' on' : ''}`, type: 'button', 'aria-label': `Page ${i + 1}`, onClick: () => { t.page = i; drawAll(); scrollToPage(i); },
            onContextmenu: (e: MouseEvent) => { e.preventDefault(); t.page = i; drawStatus(); showMenu(e.clientX, e.clientY, pageMenu(i)); } }, mini, h('span', null, String(i + 1))));
        });
        pane.append(list);
      } else if (p.pane === 'comments') {
        const list = t.doc.annots.filter((a) => a.kind !== 'redact');
        pane.append(h('div', { class: 'pdx-pane-head' }, `Comments (${list.length})`));
        if (!list.length) pane.append(h('p', { class: 'pdx-empty' }, 'No comments in this document.'));
        for (const a of list) pane.append(h('button', { class: `pdx-cmt${t.selected === a.id ? ' on' : ''}`, type: 'button', onClick: () => { t.selected = a.id; t.page = a.page; drawAll(); scrollToPage(a.page); } },
          h('span', { class: 'pdx-cmt-head' }, h('span', { class: 'pdx-swatch', style: `background:${a.color}` }), h('strong', null, TOOL_NAMES[a.kind] ?? a.kind), h('span', null, `Page ${a.page + 1}`)),
          h('span', { class: 'pdx-cmt-meta' }, `${a.author} · ${new Date(a.created).toLocaleString()}`),
          a.text ? h('span', { class: 'pdx-cmt-text' }, a.text) : null));
      } else {
        const q = h('input', { class: 'pdx-input', value: query, placeholder: 'Search for', 'aria-label': 'Search for' });
        const mc = h('input', { type: 'checkbox', checked: findOpts.matchCase });
        const ww = h('input', { type: 'checkbox', checked: findOpts.wholeWord });
        const go = (): void => { query = q.value; findOpts = { matchCase: mc.checked, wholeWord: ww.checked }; hits = searchPdf(t.doc, query, findOpts); drawView(); drawPane(); if (hits[0]) scrollToPage(hits[0].page); };
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        pane.append(h('div', { class: 'pdx-pane-head' }, 'Search'), q, h('label', { class: 'pdx-check' }, mc, ' Match case'), h('label', { class: 'pdx-check' }, ww, ' Whole words'), h('button', { class: 'pdx-btn def', type: 'button', onClick: go }, 'Search'));
        if (query) pane.append(h('p', { class: 'pdx-empty' }, `${hits.length} instance${hits.length === 1 ? '' : 's'} found`));
        for (const x of hits) {
          const text = t.doc.pages[x.page]!.blocks[x.block]!.text;
          pane.append(h('button', { class: 'pdx-hit', type: 'button', onClick: () => { t.page = x.page; drawStatus(); scrollToPage(x.page); } },
            h('span', { class: 'pdx-cmt-meta' }, `Page ${x.page + 1}`), h('span', null, `…${text.slice(Math.max(0, x.start - 25), x.start)}`, h('mark', null, text.slice(x.start, x.end)), `${text.slice(x.end, x.end + 25)}…`)));
        }
        setTimeout(() => q.focus(), 0);
      }
    }
    function pageMenu(i: number): MenuEntry[] {
      const t = tab()!;
      return [
        { label: 'Insert Empty Pages...', onClick: insertPagesDialog },
        { label: 'Delete Page', disabled: t.doc.pages.length < 2, onClick: () => change((d) => deletePages(d, [i])) },
        '-',
        { label: 'Rotate Clockwise', onClick: () => change((d) => rotatePages(d, [i], 90)) },
        { label: 'Rotate Counterclockwise', onClick: () => change((d) => rotatePages(d, [i], 270)) },
        '-',
        { label: 'Move Up', disabled: i === 0, onClick: () => { if (change((d) => movePage(d, i, i - 1))) { t.page = i - 1; drawAll(); } } },
        { label: 'Move Down', disabled: i >= t.doc.pages.length - 1, onClick: () => { if (change((d) => movePage(d, i, i + 1))) { t.page = i + 1; drawAll(); } } },
      ];
    }
    function drawStatus(): void {
      clear(status);
      const t = tab();
      if (!t) { status.append(h('span', { class: 'pdx-st' }, 'Ready')); return; }
      const n = t.doc.pages.length;
      const go = (i: number): void => { t.page = Math.max(0, Math.min(n - 1, i)); drawStatus(); scrollToPage(t.page); drawPane(); };
      const pg = h('input', { class: 'pdx-pg', value: String(t.page + 1), 'aria-label': 'Current page', onChange: (e: Event) => go(Number((e.target as HTMLInputElement).value) - 1) });
      const nav = (glyph: string, label: string, fn: () => void, dis: boolean): HTMLElement => h('button', { class: 'pdx-nav', type: 'button', title: label, 'aria-label': label, disabled: dis, onClick: fn }, h('span', { class: 'mdl' }, glyph));
      const [w, hh] = PAGE_POINTS[t.doc.pages[t.page]!.size];
      status.append(
        h('span', { class: 'pdx-st grow' }, `${TOOL_NAMES[tool] ?? tool} tool${tool === 'stamp' ? `: ${stamp}` : ''}`),
        h('span', { class: 'pdx-st' }, `W: ${(w / 72 * 25.4).toFixed(1)}mm  H: ${(hh / 72 * 25.4).toFixed(1)}mm`),
        h('span', { class: 'pdx-st nav' }, nav('', 'First Page', () => go(0), t.page === 0), nav('', 'Previous Page', () => go(t.page - 1), t.page === 0), pg, h('span', null, ` / ${n}`), nav('', 'Next Page', () => go(t.page + 1), t.page >= n - 1), nav('', 'Last Page', () => go(n - 1), t.page >= n - 1)),
        h('span', { class: 'pdx-st nav' }, nav('', 'Zoom Out', () => setZoom(p.zoom - 10), p.zoom <= 25),
          h('select', { class: 'pdx-zoom', 'aria-label': 'Zoom', onChange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v === 'width') fitWidth(); else if (v === 'page') fitPage(); else setZoom(Number(v)); } },
            [...new Set([p.zoom, 50, 75, 100, 125, 150, 200, 300])].sort((a, b) => a - b).map((z) => h('option', { value: String(z), selected: z === p.zoom }, `${z}%`)), h('option', { value: 'width' }, 'Fit Width'), h('option', { value: 'page' }, 'Fit Page')),
          nav('', 'Zoom In', () => setZoom(p.zoom + 10), p.zoom >= 400)));
    }
    function drawDocTabs(): void {
      clear(docTabs);
      tabs.forEach((t, i) => docTabs.append(h('div', { class: `pdx-doctab${i === cur ? ' on' : ''}`, role: 'tab', title: t.path || t.name, onMousedown: (e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } else if (e.button === 0 && i !== cur) { cur = i; hits = []; drawAll(); } } },
        h('span', { class: 'pdx-doctab-ico' }, 'PDF'), h('span', null, `${t.name}${dirty(t) ? ' *' : ''}`),
        h('button', { class: 'pdx-x', type: 'button', 'aria-label': `Close ${t.name}`, onMousedown: (e: Event) => e.stopPropagation(), onClick: () => closeTab(i) }, '✕'))));
      docTabs.hidden = !tabs.length;
    }
    function drawView(): void {
      const t = tab();
      const keep = [view.scrollTop, view.scrollLeft];
      clear(view);
      view.dataset.tool = tool;
      if (!t) {
        view.append(h('div', { class: 'pdx-start' }, h('h2', null, 'PDF-XChange Editor'),
          h('button', { class: 'pdx-btn def', type: 'button', onClick: openDialog }, 'Open Document...'), h('button', { class: 'pdx-btn', type: 'button', onClick: newDoc }, 'New Blank Document'),
          p.recent.length ? h('div', { class: 'pdx-recent' }, h('h3', null, 'Recent Documents'), p.recent.map((r) => h('button', { class: 'pdx-link', type: 'button', onClick: () => openPath(r) }, r))) : null));
        return;
      }
      const pages = h('div', { class: 'pdx-pages' });
      t.doc.pages.forEach((_pg, i) => pages.append(pageEl(i)));
      view.append(pages);
      view.scrollTop = keep[0]!; view.scrollLeft = keep[1]!;
    }
    function scrollToPage(i: number): void {
      const el = view.querySelectorAll('.pdx-page-wrap')[i] as HTMLElement | undefined;
      if (el) view.scrollTop = el.offsetTop - 12;
      view.querySelectorAll('.pdx-page-wrap').forEach((x, j) => x.classList.toggle('current', j === i));
    }
    function setZoom(z: number): void { savePrefs({ zoom: Math.max(25, Math.min(400, Math.round(z))) }); drawView(); drawStatus(); }
    function fitWidth(): void { setZoom((view.clientWidth - 48) / BASE * 100); }
    function fitPage(): void { setZoom(Math.min((view.clientWidth - 48) / BASE, (view.clientHeight - 32) / (BASE * 11 / 8.5)) * 100); }

    // ---------------------------------------------------------------- ribbon
    const tl = (glyph: string, t: Tool, label = TOOL_NAMES[t] ?? t, isBig = false): HTMLElement => {
      const on = tool === t;
      const fn = (): void => { tool = tool === t && t !== 'hand' ? 'hand' : t; const tb = tab(); if (tb) tb.selected = null; drawAll(); };
      const b = isBig ? big(glyph, label, fn) : small(glyph, label, fn, { on, text: true });
      if (isBig && on) b.classList.add('on');
      return b;
    };
    function drawRibbon(): void {
      clear(ribbonTabs); clear(ribbon);
      for (const name of ['File', 'Home', 'Edit', 'Comment', 'View', 'Form', 'Organize', 'Convert', 'Protect', 'Help']) {
        ribbonTabs.append(h('button', { class: `pdx-rtab${name === 'File' ? ' file' : ''}${name === ribbonTab ? ' on' : ''}`, type: 'button', role: 'tab', onClick: () => { if (name === 'File') backstage(); else { ribbonTab = name; drawRibbon(); } } }, name));
      }
      const q = h('input', { class: 'pdx-find', placeholder: 'Find...', 'aria-label': 'Find', value: query, onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && tab()) { query = (e.target as HTMLInputElement).value; hits = searchPdf(tab()!.doc, query, findOpts); savePrefs({ pane: 'search' }); drawPane(); drawView(); if (hits[0]) { tab()!.page = hits[0].page; scrollToPage(hits[0].page); drawStatus(); } else toast(`No matches found for "${query}"`); } } });
      ribbonTabs.append(h('span', { class: 'pdx-rspacer' }), q);
      const t = tab();
      const need = !t;
      const sel = selectedAnnot();
      const colorPick = h('input', { type: 'color', class: 'pdx-color', value: sel?.color ?? (color || '#ffff00'), 'aria-label': 'Color', title: sel ? 'Color of the selected comment' : 'Color for new comments', onInput: (e: Event) => { const c = (e.target as HTMLInputElement).value; if (sel) change((d) => updateAnnot(d, sel.id, { color: c })); else { color = c; } } });
      const stampPick = h('select', { class: 'rb-select', 'aria-label': 'Stamp', style: 'width:130px', onChange: (e: Event) => { stamp = (e.target as HTMLSelectElement).value; tool = 'stamp'; drawAll(); } }, STAMPS.map((s) => h('option', { value: s, selected: s === stamp }, s)));
      const add = (...g: HTMLElement[]): void => { ribbon.append(...g); };
      const dis = (b: HTMLButtonElement): HTMLButtonElement => { b.disabled = need; return b; };
      switch (ribbonTab) {
        case 'Home':
          add(group('Tools', row(tl('', 'hand'), tl('', 'select')), row(tl('', 'edit'))),
            group('View', col(dis(small('', 'Zoom In', () => setZoom(p.zoom + 10), { text: true })), dis(small('', 'Zoom Out', () => setZoom(p.zoom - 10), { text: true })), dis(small('', 'Fit Width', fitWidth, { text: true })))),
            group('Comment', row(tl('', 'highlight'), tl('', 'note')), row(tl('', 'typewriter'), tl('', 'stamp')), row(stampPick)),
            group('Organize', col(dis(small('', 'Rotate Pages', () => change((d) => rotatePages(d, [t!.page], 90)), { text: true })), dis(small('', 'Insert Pages', insertPagesDialog, { text: true })), dis(small('', 'Delete Pages', deletePagesDialog, { text: true })))),
            group('Protect', col(dis(small('', 'Password Security', passwordDialog, { text: true })), dis(small('', 'Search & Redact', redactDialog, { text: true })))));
          break;
        case 'Edit':
          add(group('Text', row(tl('', 'edit', 'Edit Text', true), tl('', 'addtext', 'Add Text', true))),
            group('History', col(dis(small('', 'Undo', undo, { text: true, disabled: !t?.undo.length })), dis(small('', 'Redo', redo, { text: true, disabled: !t?.redo.length })))),
            group('Find', col(dis(small('', 'Find', () => { savePrefs({ pane: 'search' }); drawPane(); }, { text: true })))));
          break;
        case 'Comment':
          add(group('Text', row(tl('', 'highlight'), tl('', 'underline')), row(tl('', 'strikeout'), tl('', 'note')), row(tl('', 'typewriter'), tl('', 'textbox'))),
            group('Stamps', row(tl('', 'stamp', 'Stamp', true)), row(stampPick)),
            group('Drawing', row(tl('', 'rect'), tl('', 'ellipse')), row(tl('', 'line'), tl('', 'arrow'))),
            group('Sign', row(tl('', 'signature', 'Signature', true))),
            group('Properties', row(colorPick), row(dis(small('', 'Delete Comment', () => { if (sel) change((d) => removeAnnot(d, sel.id)); }, { text: true, disabled: !sel })))),
            group('Manage', col(dis(small('', 'Comments List', () => { savePrefs({ pane: 'comments' }); drawPane(); }, { text: true })), dis(small('', 'Delete All Comments', () => change((d) => ({ ...d, annots: d.annots.filter((a) => a.kind === 'redact') })), { text: true, disabled: !t?.doc.annots.some((a) => a.kind !== 'redact') })))));
          break;
        case 'View':
          add(group('Zoom', row(dis(big('', 'Zoom In', () => setZoom(p.zoom + 10))), dis(big('', 'Zoom Out', () => setZoom(p.zoom - 10)))), ),
            group('Page Display', col(dis(small('', 'Fit Width', fitWidth, { text: true })), dis(small('', 'Fit Page', fitPage, { text: true })), dis(small('', 'Actual Size', () => setZoom(100), { text: true })))),
            group('Panes', col(small('', 'Thumbnails', () => { savePrefs({ pane: p.pane === 'thumbs' ? 'none' : 'thumbs' }); drawPane(); }, { text: true, on: p.pane === 'thumbs' }), small('', 'Comments', () => { savePrefs({ pane: p.pane === 'comments' ? 'none' : 'comments' }); drawPane(); }, { text: true, on: p.pane === 'comments' }), small('', 'Search', () => { savePrefs({ pane: p.pane === 'search' ? 'none' : 'search' }); drawPane(); }, { text: true, on: p.pane === 'search' }))));
          break;
        case 'Form':
          add(group('Fill', row(tl('', 'hand', 'Fill Form', true)), row(dis(small('', 'Highlight Fields', () => { highlightFields = !highlightFields; drawAll(); }, { text: true, on: highlightFields })))),
            group('Form Fields', row(tl('', 'textfield', 'Text Field', true), tl('', 'checkfield', 'Check Box', true))),
            group('Data', col(dis(small('', 'Reset Form', () => change((d) => ({ ...d, fields: d.fields.map((f) => ({ ...f, value: f.type === 'check' ? 'Off' : '' })) })), { text: true, disabled: !t?.doc.fields.length })))));
          break;
        case 'Organize':
          add(group('Pages', row(dis(big('', 'Insert', insertPagesDialog)), dis(big('', 'Delete', deletePagesDialog)))),
            group('Rotate', col(dis(small('', 'Rotate Clockwise', () => change((d) => rotatePages(d, [t!.page], 90)), { text: true })), dis(small('', 'Rotate Counterclockwise', () => change((d) => rotatePages(d, [t!.page], 270)), { text: true })), dis(small('', 'Rotate All 180°', () => change((d) => rotatePages(d, d.pages.map((_x, i) => i), 180)), { text: true })))),
            group('Move', col(dis(small('', 'Move Page Up', () => { const i = t!.page; if (i > 0 && change((d) => movePage(d, i, i - 1))) { t!.page = i - 1; drawAll(); } }, { text: true })), dis(small('', 'Move Page Down', () => { const i = t!.page; if (i < t!.doc.pages.length - 1 && change((d) => movePage(d, i, i + 1))) { t!.page = i + 1; drawAll(); } }, { text: true })))));
          break;
        case 'Convert':
          add(group('Export', row(dis(big('', 'To Text', () => {
            const tb = tab()!;
            const base = (tb.path || `${homeDir(store.world)}\\Documents\\${tb.name}`).replace(/\.pdf$/i, '.txt');
            const target = fileOf(base)?.readOnly ? `${homeDir(store.world)}\\Documents\\${base.split('\\').pop()}` : base;
            if (act((w) => writeFile(w, target, pdfText(tb.doc).replace(/\f/g, '\n\n')))) toast(`Exported to ${target.split('\\').pop()}`, 'ok');
          })))));
          break;
        case 'Protect':
          add(group('Security', row(dis(big('', 'Password Security', passwordDialog)))),
            group('Redact', row(dis(big('', 'Search & Redact', redactDialog)), dis(big('', 'Apply All Redactions', applyRedactDialog)))));
          break;
        case 'Help':
          add(group('Help', row(big('', 'About', about))));
          break;
      }
    }
    function backstage(): void {
      const t = tab();
      const item = (label: string, fn: () => void, disabled = false): HTMLElement => h('button', { class: 'pdx-bs-item', type: 'button', disabled, onClick: () => { close(); fn(); } }, label);
      root.querySelector('.pdx-backstage')?.remove();
      const close = (): void => panel.remove();
      const panel = h('div', { class: 'pdx-backstage', onKeydown: (e: KeyboardEvent) => { if (e.key === 'Escape') close(); } },
        h('div', { class: 'pdx-bs-nav' },
          h('button', { class: 'pdx-bs-back', type: 'button', 'aria-label': 'Back', onClick: close }, h('span', { class: 'mdl' }, '')),
          item('New Document', newDoc), item('Open...', openDialog), item('Save', () => save(), !t), item('Save As...', () => saveAs(), !t),
          item('Document Properties', properties, !t), item('Close', () => closeTab(cur), !t), item('Exit', () => win.close())),
        h('div', { class: 'pdx-bs-main' }, h('h2', null, 'Recent Documents'),
          p.recent.length ? p.recent.map((r) => h('button', { class: 'pdx-bs-recent', type: 'button', onClick: () => { close(); openPath(r); } }, h('span', { class: 'pdx-doctab-ico' }, 'PDF'), h('span', null, h('strong', null, r.split('\\').pop()!), h('small', null, r)))) : h('p', { class: 'pdx-empty' }, 'No recent documents.')));
      root.append(panel);
    }

    /** Title and document tab only: used where redrawing the page would steal focus from a field. */
    function retitle(): void {
      const t = tab();
      win.setTitle(t ? `${t.name}${dirty(t) ? ' *' : ''} - PDF-XChange Editor` : 'PDF-XChange Editor');
      drawDocTabs();
    }
    function drawAll(): void {
      retitle();
      drawRibbon(); drawPane(); drawView(); drawStatus();
    }

    root.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="plaintext-only"]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const hit = (fn: () => void): void => { e.preventDefault(); fn(); };
      if (ctrl && e.shiftKey && k === 's') return hit(() => saveAs());
      if (ctrl && k === 's') return hit(() => save());
      if (ctrl && k === 'o') return hit(openDialog);
      if (ctrl && k === 'n') return hit(newDoc);
      if (ctrl && k === 'w') return hit(() => closeTab(cur));
      if (ctrl && k === 'z') return hit(undo);
      if (ctrl && k === 'y') return hit(redo);
      if (ctrl && k === 'f') return hit(() => { savePrefs({ pane: 'search' }); drawPane(); });
      if (ctrl && k === 'd') return hit(properties);
      if (ctrl && (k === '=' || k === '+')) return hit(() => setZoom(p.zoom + 10));
      if (ctrl && k === '-') return hit(() => setZoom(p.zoom - 10));
      if (ctrl && k === '0') return hit(fitPage);
      if (ctrl && k === '1') return hit(() => setZoom(100));
      const t = tab();
      if (!t) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && t.selected) return hit(() => { const id = t.selected!; t.selected = null; change((d) => removeAnnot(d, id)); });
      if (e.key === 'Escape') return hit(() => { tool = 'hand'; t.selected = null; drawAll(); });
      if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !ctrl)) return hit(() => { t.page = Math.min(t.doc.pages.length - 1, t.page + 1); scrollToPage(t.page); drawStatus(); });
      if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !ctrl)) return hit(() => { t.page = Math.max(0, t.page - 1); scrollToPage(t.page); drawStatus(); });
      if (e.key === 'Home') return hit(() => { t.page = 0; scrollToPage(0); drawStatus(); });
      if (e.key === 'End') return hit(() => { t.page = t.doc.pages.length - 1; scrollToPage(t.page); drawStatus(); });
      if (!ctrl && !e.altKey) {
        const keys: Record<string, Tool> = { h: 'hand', v: 'select', s: 'note', t: 'typewriter', u: 'highlight' };
        if (keys[k]) return hit(() => { tool = keys[k]!; drawAll(); });
      }
    });
    view.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(p.zoom + (e.deltaY < 0 ? 10 : -10)); } }, { passive: false });
    view.addEventListener('scroll', () => {
      const t = tab();
      if (!t) return;
      const wraps = [...view.querySelectorAll<HTMLElement>('.pdx-page-wrap')];
      const mid = view.scrollTop + view.clientHeight / 3;
      const i = wraps.findIndex((w) => w.offsetTop + w.offsetHeight > mid);
      if (i >= 0 && i !== t.page) { t.page = i; drawStatus(); wraps.forEach((w, j) => w.classList.toggle('current', j === i)); }
    });

    onOpenArg(win, (a) => { if (a) openPath(a); });
    drawAll();
    if (win.arg) openPath(win.arg);
    return { beforeClose, dispose: () => root.remove() };
  },
};
