/**
 * ui/apps/powerpoint.ts — Microsoft PowerPoint: slide thumbnails, the 16:9
 * slide with its placeholders, speaker notes, layouts, design themes and the
 * full-screen Slide Show (F5; arrows, space and click to advance, Esc to end).
 */
import { clear, h } from '../dom.ts';
import { type AppDef } from '../wm.ts';
import { showMenu } from '../ctxmenu.ts';
import { type DeckFile, FONTS, type Layout, SIZES, THEMES, type ThemeId, newDeck, newSlide, readDeck, writeDeck } from '../../core/office.ts';
import { type RichEditor, renderDoc, richEditor } from '../richdom.ts';
import { type OfficeShell, big, col, colorBtn, group, officeShell, row, select as dropdown, small } from './office.ts';

const LAYOUTS: [Layout, string][] = [['title', 'Title Slide'], ['content', 'Title and Content'], ['section', 'Section Header'], ['blank', 'Blank']];

function applyTheme(el: HTMLElement, theme: ThemeId): void {
  const t = THEMES[theme];
  el.style.setProperty('--sl-bg', t.bg);
  el.style.setProperty('--sl-fg', t.fg);
  el.style.setProperty('--sl-accent', t.accent);
  el.style.setProperty('--sl-title', t.title);
}

/** A slide drawn read-only (thumbnails and the slide show). */
function slideView(deck: DeckFile, i: number): HTMLElement {
  const s = deck.slides[i]!;
  const el = h('div', { class: `sl sl-${s.layout}` });
  applyTheme(el, deck.theme);
  if (s.layout !== 'blank') {
    const t = h('div', { class: 'sl-title rt' }); renderDoc(s.title, t);
    el.append(t);
    if (s.layout !== 'section' || s.body.paras.some((p) => p.runs.length)) { const b = h('div', { class: 'sl-body rt' }); renderDoc(s.body, b); el.append(b); }
  } else { const b = h('div', { class: 'sl-body rt' }); renderDoc(s.body, b); el.append(b); }
  return el;
}

export function powerpointApp(path?: string): AppDef {
  return {
    id: path ? `powerpoint:${path.toLowerCase()}` : `powerpoint:new:${Date.now()}`,
    title: 'PowerPoint',
    icon: 'powerpoint',
    width: 1180,
    height: 760,
    customTitlebar: true,
    mount(host, win) {
      let deck = newDeck();
      let cur = 0;
      let active: RichEditor | null = null;
      let fontColor = '#c00000';
      let snapTimer = 0;
      let shell!: OfficeShell;

      const snapshot = (): string => { saveSlide(); return writeDeck(deck); };
      const thumbs = h('div', { class: 'pp-thumbs', role: 'listbox', 'aria-label': 'Slides' });
      const stage = h('div', { class: 'pp-stage' });
      const notes = h('textarea', { class: 'pp-notes', placeholder: 'Click to add notes', 'aria-label': 'Speaker notes', onInput: () => { deck.slides[cur]!.notes = notes.value; touched(); } });
      let titleEd: RichEditor | null = null;
      let bodyEd: RichEditor | null = null;

      function touched(): void {
        shell.markDirty();
        clearTimeout(snapTimer);
        snapTimer = window.setTimeout(() => { shell.undo.push(snapshot()); drawThumbs(); }, 500);
      }
      function saveSlide(): void {
        const s = deck.slides[cur];
        if (!s) return;
        if (titleEd) s.title = titleEd.get();
        if (bodyEd) s.body = bodyEd.get();
      }
      function editors(): void {
        titleEd?.dispose(); bodyEd?.dispose();
        titleEd = null; bodyEd = null; active = null;
        clear(stage);
        const s = deck.slides[cur]!;
        const el = h('div', { class: `sl sl-${s.layout} sl-edit` });
        applyTheme(el, deck.theme);
        const mk = (cls: string, label: string, placeholder: string): RichEditor => {
          const ed = richEditor({ cls, label, placeholder, onChange: touched, onSelection: () => { active = ed; if (currentTab === 'Home') shell.drawRibbon(); } });
          ed.el.addEventListener('focus', () => { active = ed; });
          return ed;
        };
        if (s.layout !== 'blank') {
          titleEd = mk('sl-title', 'Slide title', s.layout === 'title' ? 'Click to add title' : s.layout === 'section' ? 'Click to add section title' : 'Click to add title');
          titleEd.set(s.title);
          el.append(titleEd.el);
        }
        bodyEd = mk('sl-body', 'Slide content', s.layout === 'title' ? 'Click to add subtitle' : s.layout === 'section' ? 'Click to add text' : 'Click to add text');
        bodyEd.set(s.body);
        el.append(bodyEd.el);
        stage.append(el);
        notes.value = s.notes;
      }
      function drawThumbs(): void {
        clear(thumbs);
        deck.slides.forEach((_, i) => {
          const view = slideView(deck, i);
          thumbs.append(h('div', { class: `pp-thumb ${i === cur ? 'on' : ''}`, role: 'option', 'aria-selected': i === cur ? 'true' : 'false', tabIndex: 0,
            onClick: () => select(i),
            onKeydown: (e: KeyboardEvent) => {
              if (e.key === 'ArrowDown' && i < deck.slides.length - 1) { e.preventDefault(); select(i + 1); focusThumb(); }
              if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); select(i - 1); focusThumb(); }
              if (e.key === 'Delete') { e.preventDefault(); remove(i); }
              if (e.key === 'Enter') { e.preventDefault(); addSlide(deck.slides[i]!.layout === 'title' ? 'content' : deck.slides[i]!.layout); }
            },
            onContextmenu: (e: MouseEvent) => { e.preventDefault(); select(i); showMenu(e.clientX, e.clientY, [
              { label: 'New Slide', icon: '', onClick: () => addSlide('content') },
              { label: 'Duplicate Slide', icon: '', onClick: () => { saveSlide(); deck.slides.splice(i + 1, 0, JSON.parse(JSON.stringify(deck.slides[i])) as DeckFile['slides'][number]); select(i + 1); changed(); } },
              { label: 'Delete Slide', icon: '', disabled: deck.slides.length < 2, onClick: () => remove(i) },
              '-',
              { label: 'Move Up', icon: '', disabled: i === 0, onClick: () => move(i, -1) },
              { label: 'Move Down', icon: '', disabled: i === deck.slides.length - 1, onClick: () => move(i, 1) },
            ]); } },
            h('span', { class: 'pp-num' }, String(i + 1)), h('div', { class: 'pp-mini' }, view)));
        });
        status();
      }
      const focusThumb = (): void => { thumbs.querySelector<HTMLElement>('.pp-thumb.on')?.focus(); };
      function select(i: number): void { saveSlide(); cur = Math.max(0, Math.min(deck.slides.length - 1, i)); editors(); drawThumbs(); }
      function changed(): void { shell.markDirty(); shell.undo.push(snapshot()); drawThumbs(); }
      function addSlide(layout: Layout): void { saveSlide(); deck.slides.splice(cur + 1, 0, newSlide(layout)); cur++; editors(); changed(); }
      function remove(i: number): void { if (deck.slides.length < 2) return; saveSlide(); deck.slides.splice(i, 1); cur = Math.min(cur, deck.slides.length - 1); editors(); changed(); }
      function move(i: number, d: number): void { saveSlide(); const [s] = deck.slides.splice(i, 1); deck.slides.splice(i + d, 0, s!); cur = i + d; editors(); changed(); }
      function setLayout(l: Layout): void { saveSlide(); deck.slides[cur]!.layout = l; editors(); changed(); }

      // ---------------------------------------------------------- slide show
      function show(from: number): void {
        saveSlide();
        let i = from;
        const frame = h('div', { class: 'pp-show-frame' });
        const overlay = h('div', { class: 'pp-show', tabIndex: 0, role: 'dialog', 'aria-label': 'Slide Show' }, frame,
          h('div', { class: 'pp-show-hint' }, 'Click or press → for the next slide. Esc ends the show.'));
        const paint = (): void => {
          clear(frame);
          if (i >= deck.slides.length) frame.append(h('div', { class: 'pp-show-end' }, 'End of slide show, click to exit.'));
          else frame.append(slideView(deck, i));
        };
        const end = (): void => { overlay.remove(); document.removeEventListener('keydown', key, true); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
        const next = (): void => { if (i >= deck.slides.length) end(); else { i++; paint(); } };
        const prev = (): void => { if (i > 0) { i--; paint(); } };
        const key = (e: KeyboardEvent): void => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); end(); }
          else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(e.key)) { e.preventDefault(); next(); }
          else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) { e.preventDefault(); prev(); }
          else if (e.key === 'Home') { e.preventDefault(); i = 0; paint(); }
          else if (e.key === 'End') { e.preventDefault(); i = deck.slides.length - 1; paint(); }
        };
        overlay.addEventListener('click', next);
        overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); prev(); });
        document.addEventListener('keydown', key, true);
        document.body.append(overlay);
        paint();
        overlay.focus();
        void overlay.requestFullscreen?.().catch(() => undefined);
      }

      // ---------------------------------------------------------- ribbon
      let currentTab = 'Home';
      const ed = (): RichEditor | null => active ?? bodyEd;
      function ribbon(t: string, into: HTMLElement): void {
        const e = ed();
        const s = e?.state();
        const layoutMenu = (anchor: HTMLElement, fn: (l: Layout) => void): void => { const r = anchor.getBoundingClientRect(); showMenu(r.left, r.bottom, LAYOUTS.map(([id, label]) => ({ label, onClick: () => fn(id) }))); };
        if (t === 'Home') {
          const nb = big('', 'New Slide', () => layoutMenu(nb, addSlide));
          const lb = small('', 'Layout', () => layoutMenu(lb, setLayout), { text: true });
          into.append(
            group('Slides', nb, col(lb, small('', 'Reset', () => setLayout(deck.slides[cur]!.layout), { text: true }), small('', 'Delete', () => remove(cur), { text: true, disabled: deck.slides.length < 2 }))),
            group('Font',
              row(dropdown('Font', s?.font || 'Aptos', [...FONTS], (v) => e?.setFont(v), 120), dropdown('Font size', String(s?.size ?? 18), SIZES.map(String), (v) => e?.setSize(Number(v)), 56)),
              row(small('', 'Bold', () => e?.exec('bold'), { on: s?.b }), small('', 'Italic', () => e?.exec('italic'), { on: s?.i }), small('', 'Underline', () => e?.exec('underline'), { on: s?.u }),
                small('', 'Strikethrough', () => e?.exec('strikeThrough'), { on: s?.s }), colorBtn('', 'Font color', fontColor, (c) => { fontColor = c; e?.exec('foreColor', c); }), small('', 'Clear formatting', () => e?.clearFormat()))),
            group('Paragraph',
              row(small('', 'Bullets', () => e?.exec('insertUnorderedList'), { on: s?.ul }), small('', 'Numbering', () => e?.exec('insertOrderedList'), { on: s?.ol }),
                small('', 'Decrease list level', () => e?.exec('outdent')), small('', 'Increase list level', () => e?.exec('indent'))),
              row(small('', 'Align left', () => e?.exec('justifyLeft'), { on: s?.align === 'left' }), small('', 'Center', () => e?.exec('justifyCenter'), { on: s?.align === 'center' }), small('', 'Align right', () => e?.exec('justifyRight'), { on: s?.align === 'right' }))));
        } else if (t === 'Insert') {
          const nb = big('', 'New Slide', () => layoutMenu(nb, addSlide));
          into.append(group('Slides', nb), group('Text', big('', 'Date & Time', () => { const x = ed(); x?.el.focus(); document.execCommand('insertText', false, new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })); })));
        } else if (t === 'Design') {
          into.append(group('Themes', h('div', { class: 'pp-themes' }, ...(Object.keys(THEMES) as ThemeId[]).map((id) => {
            const th = THEMES[id];
            return h('button', { class: `pp-theme ${deck.theme === id ? 'on' : ''}`, type: 'button', title: th.name, style: `background:${th.bg};color:${th.title}`, onClick: () => { saveSlide(); deck.theme = id; editors(); changed(); shell.drawRibbon(); } },
              h('span', { class: 'pp-theme-aa' }, 'Aa'), h('span', { class: 'pp-theme-bar', style: `background:${th.accent}` }));
          }))));
        } else if (t === 'Slide Show') {
          into.append(group('Start Slide Show', big('', 'From Beginning', () => show(0), 'From Beginning (F5)'), big('', 'From Current Slide', () => show(cur), 'From Current Slide (Shift+F5)')));
        }
      }
      function status(): void {
        if (!shell) return;
        shell.status.replaceChildren(h('span', null, `Slide ${cur + 1} of ${deck.slides.length}`), h('span', null, 'English (United States)'), h('span', { class: 'off-grow' }),
          h('button', { class: 'off-zbtn wide', type: 'button', onClick: () => show(cur) }, 'Slide Show'));
      }

      shell = officeShell('powerpoint', host, win, {
        tabs: ['File', 'Home', 'Insert', 'Design', 'Slide Show'],
        initialPath: path,
        snapshot,
        restore: (s) => { deck = readDeck(s); cur = Math.min(cur, deck.slides.length - 1); editors(); drawThumbs(); },
        doc: {
          exportTypes: [],
          serialize: () => snapshot(),
          load: (_p, content) => { deck = readDeck(content); cur = 0; editors(); drawThumbs(); },
          blank: () => { deck = newDeck(); cur = 0; editors(); drawThumbs(); },
        },
        ribbon: (t, into) => { currentTab = t; ribbon(t, into); },
      });
      shell.docHost.append(h('div', { class: 'pp' }, thumbs, h('div', { class: 'pp-main' }, h('div', { class: 'pp-stage-wrap' }, stage), notes)));
      // While this window is the active one, its shortcuts work wherever focus is (a re-rendered ribbon drops it to <body>).
      const frame = host.closest<HTMLElement>('.win');
      const keys = (e: KeyboardEvent): void => {
        if (!frame?.classList.contains('active') || document.querySelector('.pp-show')) return;
        if (document.activeElement && document.activeElement !== document.body && !frame.contains(document.activeElement)) return;
        if (e.key === 'F5') { e.preventDefault(); show(e.shiftKey ? cur : 0); }
        if (e.ctrlKey && (e.key ?? '').toLowerCase() === 'm') { e.preventDefault(); addSlide('content'); }
      };
      document.addEventListener('keydown', keys);
      drawThumbs();
      return { dispose: () => { titleEd?.dispose(); bodyEd?.dispose(); clearTimeout(snapTimer); document.removeEventListener('keydown', keys); } };
    },
  };
}

export const powerpointStartApp: AppDef = { ...powerpointApp(), id: 'powerpoint' };
