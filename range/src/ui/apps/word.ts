/**
 * ui/apps/word.ts — Microsoft Word: a page on the grey canvas, the ribbon
 * (Home, Insert, Layout, Review, View), the styles gallery, find and replace,
 * and the status bar with page and word counts. Opens .docx (lab JSON), .txt
 * and .md; saves .docx, or exports plain text.
 */
import { h, toast } from '../dom.ts';
import { type AppDef } from '../wm.ts';
import { showMenu } from '../ctxmenu.ts';
import { FONTS, type Margins, type ParaStyle, SIZES, docText, newWord, readWord, wordCount, writeWord } from '../../core/office.ts';
import { richEditor } from '../richdom.ts';
import { big, col, colorBtn, group, icon, officeShell, row, select, small } from './office.ts';

const STYLE_GALLERY: [ParaStyle, string][] = [['p', 'Normal'], ['title', 'Title'], ['subtitle', 'Subtitle'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['quote', 'Quote']];
const PAGE_H = 1056; // 11 in at 96 dpi
const SYMBOLS = ['©', '®', '™', '€', '£', '§', '¶', '—', '–', '•', '✓', '→', '°', '±', '½', '…'];

export function wordApp(path?: string): AppDef {
  return {
    id: path ? `word:${path.toLowerCase()}` : `word:new:${Date.now()}`,
    title: 'Word',
    icon: 'word',
    width: 1120,
    height: 760,
    customTitlebar: true,
    mount(host, win) {
      let file = newWord();
      let zoom = 100;
      let spell = true;
      let fontColor = '#c00000';
      let highlight = '#ffff00';
      let snapTimer = 0;

      const findIn = h('input', { class: 'w-input', placeholder: 'Find', 'aria-label': 'Find' });
      const replIn = h('input', { class: 'w-input', placeholder: 'Replace with', 'aria-label': 'Replace with' });
      const bar = h('div', { class: 'wd-find', hidden: true });
      const page = h('div', { class: 'wd-page' });
      const ed = richEditor({ cls: 'wd-text', label: 'Document', onChange: () => {
        shell.markDirty();
        clearTimeout(snapTimer);
        snapTimer = window.setTimeout(() => { shell.undo.push(snapshot()); status(); }, 400);
      }, onSelection: () => { if (tab() === 'Home') shell.drawRibbon(); } });
      page.append(ed.el);
      const canvas = h('div', { class: 'wd-canvas' }, h('div', { class: 'wd-zoom' }, page));

      const snapshot = (): string => writeWord({ ...file, doc: ed.get() });
      const layout = (): void => {
        page.classList.toggle('landscape', file.landscape);
        page.dataset.margins = file.margins;
        (page.parentElement as HTMLElement).style.zoom = String(zoom / 100);
        ed.el.spellcheck = spell;
      };

      let currentTab = 'Home';
      const tab = (): string => currentTab;
      const shell = officeShell('word', host, win, {
        tabs: ['File', 'Home', 'Insert', 'Layout', 'Review', 'View'],
        initialPath: path,
        snapshot,
        restore: (s) => { file = readWord(s); ed.set(file.doc); layout(); setTimeout(status, 0); },
        doc: {
          exportTypes: [['.txt', 'Plain Text (*.txt)']],
          serialize: (type) => (type === '.txt' ? docText(ed.get()).replace(/\n/g, '\r\n') : writeWord({ ...file, doc: ed.get() })),
          load: (_p, content) => { file = readWord(content); ed.set(file.doc); layout(); setTimeout(status, 0); },
          blank: () => { file = newWord(); ed.set(file.doc); layout(); setTimeout(status, 0); },
        },
        ribbon: (t, into) => { currentTab = t; ribbon(t, into); },
      });
      shell.docHost.append(findBar(), canvas);

      // ---------------------------------------------------------- ribbon
      function ribbon(t: string, into: HTMLElement): void {
        const s = ed.state();
        if (t === 'Home') {
          into.append(
            group('Clipboard',
              big('', 'Paste', () => { void navigator.clipboard?.readText().then((txt) => { ed.el.focus(); document.execCommand('insertText', false, txt); }, () => toast('Use Ctrl+V to paste here.', 'info')); }),
              col(small('', 'Cut', () => ed.exec('cut'), { text: true }), small('', 'Copy', () => ed.exec('copy'), { text: true }))),
            group('Font',
              row(select('Font', s.font || 'Aptos', [...FONTS], (v) => ed.setFont(v), 132), select('Font size', String(s.size), SIZES.map(String), (v) => ed.setSize(Number(v)), 56),
                small('', 'Grow font', () => ed.setSize(SIZES.find((x) => x > s.size) ?? 72)), small('', 'Shrink font', () => ed.setSize([...SIZES].reverse().find((x) => x < s.size) ?? 8))),
              row(small('', 'Bold (Ctrl+B)', () => ed.exec('bold'), { on: s.b }), small('', 'Italic (Ctrl+I)', () => ed.exec('italic'), { on: s.i }), small('', 'Underline (Ctrl+U)', () => ed.exec('underline'), { on: s.u }),
                small('', 'Strikethrough', () => ed.exec('strikeThrough'), { on: s.s }),
                colorBtn('', 'Text highlight color', highlight, (c) => { highlight = c; ed.exec('hiliteColor', c); }),
                colorBtn('', 'Font color', fontColor, (c) => { fontColor = c; ed.exec('foreColor', c); }),
                small('', 'Clear all formatting', () => ed.clearFormat()))),
            group('Paragraph',
              row(small('', 'Bullets', () => ed.exec('insertUnorderedList'), { on: s.ul }), small('', 'Numbering', () => ed.exec('insertOrderedList'), { on: s.ol }),
                small('', 'Decrease indent', () => ed.exec('outdent')), small('', 'Increase indent', () => ed.exec('indent'))),
              row(small('', 'Align left (Ctrl+L)', () => ed.exec('justifyLeft'), { on: s.align === 'left' }), small('', 'Center (Ctrl+E)', () => ed.exec('justifyCenter'), { on: s.align === 'center' }),
                small('', 'Align right (Ctrl+R)', () => ed.exec('justifyRight'), { on: s.align === 'right' }), small('', 'Justify (Ctrl+J)', () => ed.exec('justifyFull'), { on: s.align === 'justify' }))),
            group('Styles', h('div', { class: 'wd-styles' }, ...STYLE_GALLERY.map(([id, label]) =>
              h('button', { class: `wd-style s-${id} ${s.style === id ? 'on' : ''}`, type: 'button', onMousedown: (e: Event) => e.preventDefault(), onClick: () => ed.setStyle(id) }, h('span', null, 'AaBbCc'), h('small', null, label))))),
            group('Editing', col(small('', 'Find', () => openFind(false), { text: true }), small('', 'Replace', () => openFind(true), { text: true }),
              small('', 'Select all', () => { ed.el.focus(); document.execCommand('selectAll'); }, { text: true }))));
        } else if (t === 'Insert') {
          into.append(
            group('Text', big('', 'Date & Time', () => { ed.el.focus(); document.execCommand('insertText', false, new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })); }),
              big('', 'Page Break', () => { ed.el.focus(); document.execCommand('insertParagraph'); document.execCommand('insertText', false, ' '); document.execCommand('insertParagraph'); })),
            group('Symbols', big('', 'Symbol', () => {
              const r = into.querySelector<HTMLElement>('.wd-sym')?.getBoundingClientRect();
              showMenu(r?.left ?? 200, r?.bottom ?? 120, SYMBOLS.map((c) => ({ label: c, onClick: () => { ed.el.focus(); document.execCommand('insertText', false, c); } })));
            })));
          into.querySelectorAll('.rb-big')[2]?.classList.add('wd-sym');
        } else if (t === 'Layout') {
          const m = (id: Margins, label: string, detail: string): HTMLButtonElement => h('button', { class: `rb-opt ${file.margins === id ? 'on' : ''}`, type: 'button', onClick: () => { file.margins = id; layout(); shell.markDirty(); shell.drawRibbon(); } }, h('strong', null, label), h('small', null, detail));
          into.append(
            group('Margins', row(m('normal', 'Normal', '1" all sides'), m('narrow', 'Narrow', '0.5" all sides'), m('wide', 'Wide', '1" top/bottom, 2" sides'))),
            group('Orientation', row(small('', 'Portrait', () => { file.landscape = false; layout(); shell.markDirty(); shell.drawRibbon(); }, { on: !file.landscape, text: true }),
              small('', 'Landscape', () => { file.landscape = true; layout(); shell.markDirty(); shell.drawRibbon(); }, { on: file.landscape, text: true }))));
        } else if (t === 'Review') {
          into.append(
            group('Proofing', big('', 'Spelling', () => { spell = !spell; layout(); toast(spell ? 'Check spelling as you type: on' : 'Check spelling as you type: off', 'info'); shell.drawRibbon(); }, 'Check spelling as you type'),
              big('', 'Word Count', () => {
                const text = docText(ed.get());
                toast(`Pages ${pages()} • Words ${wordCount(text)} • Characters ${text.replace(/\n/g, '').length} • Paragraphs ${text.split('\n').filter((x) => x.trim()).length}`, 'info');
              })));
        } else if (t === 'View') {
          into.append(
            group('Zoom', big('', 'Zoom', () => setZoom(zoom === 100 ? 150 : 100)), big('', '100%', () => setZoom(100)),
              big('', 'Page Width', () => setZoom(Math.round(Math.min(200, Math.max(50, ((canvas.clientWidth - 40) / page.offsetWidth) * 100)))))));
        }
      }

      // ---------------------------------------------------------- find and replace
      function findBar(): HTMLElement {
        const next = (): void => {
          const q = findIn.value;
          if (!q) return;
          ed.el.focus();
          const w = window as unknown as { find?: (s: string, cs: boolean, back: boolean, wrap: boolean) => boolean };
          if (!w.find?.(q, false, false, true)) toast(`We couldn't find "${q}".`, 'info');
        };
        const all = (): void => {
          const q = findIn.value;
          if (!q) return;
          const doc = ed.get();
          let n = 0;
          const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          for (const p of doc.paras) for (const r of p.runs) r.text = r.text.replace(re, () => { n++; return replIn.value; });
          if (!n) { toast(`We couldn't find "${q}".`, 'info'); return; }
          ed.set(doc);
          shell.markDirty();
          shell.undo.push(snapshot());
          toast(`All done. We made ${n} replacement${n === 1 ? '' : 's'}.`, 'ok');
        };
        findIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } if (e.key === 'Escape') bar.hidden = true; });
        bar.append(icon(''), findIn, h('button', { class: 'btn', type: 'button', onClick: next }, 'Find Next'), replIn,
          h('button', { class: 'btn', type: 'button', onClick: all }, 'Replace All'), h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Close', onClick: () => { bar.hidden = true; } }, icon('')));
        return bar;
      }
      function openFind(replace: boolean): void { bar.hidden = false; replIn.hidden = !replace; (bar.querySelectorAll('button')[1] as HTMLElement).hidden = !replace; findIn.focus(); findIn.select(); }
      ed.el.addEventListener('keydown', (e) => {
        const k = (e.key ?? '').toLowerCase();
        if (e.ctrlKey && k === 'f') { e.preventDefault(); openFind(false); }
        if (e.ctrlKey && k === 'h') { e.preventDefault(); openFind(true); }
      });

      // ---------------------------------------------------------- status bar
      function pages(): number { return Math.max(1, Math.ceil(ed.el.scrollHeight / (file.landscape ? 816 : PAGE_H))); }
      function setZoom(z: number): void { zoom = z; layout(); status(); shell.drawRibbon(); }
      function status(): void {
        const text = docText(ed.get());
        shell.status.replaceChildren(
          h('span', null, `Page ${Math.min(pages(), Math.max(1, Math.ceil((canvas.scrollTop + 200) / (PAGE_H * zoom / 100))))} of ${pages()}`),
          h('span', null, `${wordCount(text).toLocaleString()} words`),
          h('span', null, 'English (United States)'),
          h('span', { class: 'off-grow' }),
          h('button', { class: 'off-zbtn', type: 'button', 'aria-label': 'Zoom out', onClick: () => setZoom(Math.max(10, zoom - 10)) }, '−'),
          h('input', { class: 'off-zoom', type: 'range', min: '10', max: '500', step: '10', value: String(zoom), 'aria-label': 'Zoom', onInput: (e: Event) => setZoom(Number((e.target as HTMLInputElement).value)) }),
          h('button', { class: 'off-zbtn', type: 'button', 'aria-label': 'Zoom in', onClick: () => setZoom(Math.min(500, zoom + 10)) }, '+'),
          h('span', { class: 'off-zpct' }, `${zoom}%`));
      }
      canvas.addEventListener('scroll', () => status());
      layout();
      status();
      setTimeout(() => ed.el.focus(), 0);
      return { dispose: () => { ed.dispose(); clearTimeout(snapTimer); } };
    },
  };
}

export const wordStartApp: AppDef = { ...wordApp(), id: 'word' };
