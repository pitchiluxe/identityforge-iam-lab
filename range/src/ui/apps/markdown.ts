/**
 * ui/apps/markdown.ts — Markdown Viewer: .md files with all their formatting.
 *
 * Preview, Split (edit on the left, live preview on the right) and Source
 * views; an outline of the headings; links that open web pages in Chrome,
 * scroll to "#headings" or open other .md files (with Back/Forward); zoom,
 * find, copy and print. Rendering builds elements from core/markdown.ts with
 * textContent only, so HTML inside a file is shown, never run.
 */
import { clear, h, toast } from '../dom.ts';
import { act, persist, store } from '../store.ts';
import { type AppDef, onOpenArg, openApp } from '../wm.ts';
import { type Block, type Inline, headings, parseMarkdown, safeHref } from '../../core/markdown.ts';
import { writeFile } from '../../world/docs.ts';
import { browserApp } from './browser.ts';
import { notepadApp } from './tools.ts';

export interface MarkdownPrefs { view: 'preview' | 'split' | 'source'; outline: boolean; zoom: number; wide: boolean }
const DEFAULTS: MarkdownPrefs = { view: 'preview', outline: true, zoom: 100, wide: false };
const prefs = (): MarkdownPrefs => ({ ...DEFAULTS, ...(store.settings.markdown ?? {}) });

const findFile = (path: string) => store.world.files.find((f) => f.path.toLowerCase() === path.toLowerCase() && !f.deleted);

/** A link to "Other.md" from C:\Docs\This.md: next to it first, then anywhere on the disk by name. */
function resolveFile(from: string, target: string): string | null {
  const t = target.replace(/\//g, '\\');
  if (/^[a-z]:\\/i.test(t)) return findFile(t)?.path ?? null;
  const parts = from.split('\\').slice(0, -1);
  for (const seg of t.split('\\')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  const near = findFile(parts.join('\\'));
  if (near) return near.path;
  const name = t.split('\\').pop()!.toLowerCase();
  return store.world.files.find((f) => !f.deleted && f.path.split('\\').pop()!.toLowerCase() === name)?.path ?? null;
}

export function markdownApp(path: string): AppDef {
  return {
    id: `markdown:${path}`,
    title: `${path.split('\\').pop()} - Markdown Viewer`,
    icon: 'markdown',
    width: 1040,
    height: 700,
    mount(host, win) {
      let current = path;
      const back: string[] = [];
      const fwd: string[] = [];
      let draft: string | null = null; // unsaved edits in Split/Source
      let query = '';
      const name = (): string => current.split('\\').pop()!;
      const file = () => findFile(current);
      const text = (): string => draft ?? file()?.content ?? '';
      const setPrefs = (p: Partial<MarkdownPrefs>): void => { store.settings.markdown = { ...prefs(), ...p }; persist(); draw(); };
      const title = (): void => win.setTitle(`${draft !== null ? '*' : ''}${name()} - Markdown Viewer`);

      const navigate = (to: string, anchor?: string): void => {
        if (draft !== null && !confirm(`Discard unsaved changes to ${name()}?`)) return;
        if (to.toLowerCase() !== current.toLowerCase()) { back.push(current); fwd.length = 0; current = to; draft = null; }
        draw();
        if (anchor) scrollTo(anchor);
      };
      const save = (): void => {
        if (draft === null) return;
        const body = draft;
        if (act((w) => writeFile(w, current, body))) { draft = null; toast(`Saved ${name()}`, 'ok'); draw(); }
      };

      // ------------------------------------------------------------ render
      const preview = h('article', { class: 'md-doc' });
      const scrollTo = (id: string): void => {
        const el = preview.querySelector(`[id="${CSS.escape(id)}"]`);
        if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        else toast(`No heading "#${id}" in ${name()}`, 'info');
      };
      const follow = (href: string): void => {
        const l = safeHref(href);
        if (!l) { toast(`Blocked link: ${href.slice(0, 60)}`, 'err'); return; }
        if (l.kind === 'web') { openApp(browserApp, l.target, false); return; }
        if (l.kind === 'anchor') { scrollTo(l.target); return; }
        const anchor = href.includes('#') ? decodeURIComponent(href.slice(href.indexOf('#') + 1)) : undefined;
        const to = resolveFile(current, l.target);
        if (!to) { toast(`Cannot find ${l.target}`, 'err'); return; }
        if (/\.md$/i.test(to)) navigate(to, anchor);
        else openApp(notepadApp(to));
      };

      const mark = (s: string): (string | HTMLElement)[] => {
        if (!query) return [s];
        const out: (string | HTMLElement)[] = [];
        const lower = s.toLowerCase();
        let at = 0;
        for (let i = lower.indexOf(query); i >= 0; i = lower.indexOf(query, at)) {
          out.push(s.slice(at, i), h('mark', null, s.slice(i, i + query.length)));
          at = i + query.length;
        }
        out.push(s.slice(at));
        return out;
      };
      const inline = (c: Inline[]): (string | HTMLElement)[] => c.flatMap((x): (string | HTMLElement)[] => {
        switch (x.t) {
          case 'text': return mark(x.v);
          case 'code': return [h('code', null, ...mark(x.v))];
          case 'strong': return [h('strong', null, ...inline(x.c))];
          case 'em': return [h('em', null, ...inline(x.c))];
          case 'del': return [h('del', null, ...inline(x.c))];
          case 'br': return [h('br')];
          case 'img': return [/^data:image\/(png|jpe?g|gif|webp);/i.test(x.src) ? h('img', { src: x.src, alt: x.alt }) : h('span', { class: 'md-img', title: x.src }, h('span', { class: 'mdl' }, '\uEB9F'), x.alt || x.src)];
          case 'link': {
            const ok = safeHref(x.href);
            return [h('a', { class: ok ? '' : 'blocked', href: '#', title: x.href, onClick: (e: Event) => { e.preventDefault(); follow(x.href); } }, ...inline(x.c))];
          }
        }
      });
      const copyBtn = (v: string): HTMLButtonElement => h('button', { class: 'md-copy', type: 'button', title: 'Copy', onClick: () => { void navigator.clipboard?.writeText(v).then(() => toast('Copied to clipboard', 'ok'), () => toast('Clipboard is not available', 'err')); } }, h('span', { class: 'mdl' }, '\uE8C8'));
      const block = (b: Block): HTMLElement => {
        switch (b.t) {
          case 'h': {
            const tag = (`h${b.level}`) as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
            return h(tag, { id: b.id }, ...inline(b.c), h('a', { class: 'md-anchor', href: '#', title: 'Link to this section', onClick: (e: Event) => { e.preventDefault(); scrollTo(b.id); } }, '#'));
          }
          case 'p': return h('p', null, ...inline(b.c));
          case 'hr': return h('hr');
          case 'quote': {
            const alert = b.blocks[0]?.t === 'p' && b.blocks[0].c[0]?.t === 'text' ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(b.blocks[0].c[0].v) : null;
            if (alert) {
              const kind = alert[1]!.toLowerCase();
              const first = b.blocks[0] as Extract<Block, { t: 'p' }>;
              const rest: Inline[] = [{ t: 'text', v: (first.c[0] as { v: string }).v.slice(alert[0].length).trimStart() }, ...first.c.slice(1)];
              return h('blockquote', { class: `md-alert ${kind}` }, h('p', { class: 'md-alert-title' }, kind[0]!.toUpperCase() + kind.slice(1)), rest.some((x) => x.t !== 'text' || x.v) ? h('p', null, ...inline(rest)) : null, ...b.blocks.slice(1).map(block));
            }
            return h('blockquote', null, ...b.blocks.map(block));
          }
          case 'code': return h('div', { class: 'md-pre' }, b.lang ? h('span', { class: 'md-lang' }, b.lang) : null, copyBtn(b.v), h('pre', null, h('code', null, ...mark(b.v))));
          case 'list': {
            const items = b.items.map((it) => h('li', { class: it.task ? 'task' : '' }, it.task ? h('input', { type: 'checkbox', checked: it.checked, disabled: true, 'aria-label': it.checked ? 'Done' : 'Not done' }) : null, ...it.blocks.map(block)));
            return b.ordered ? h('ol', { start: String(b.start) }, ...items) : h('ul', null, ...items);
          }
          case 'table': {
            const style = (k: number): string => (b.align[k] ? `text-align:${b.align[k]}` : '');
            return h('div', { class: 'md-table' }, h('table', null,
              h('thead', null, h('tr', null, ...b.head.map((c, k) => h('th', { style: style(k) }, ...inline(c))))),
              h('tbody', null, ...b.rows.map((r) => h('tr', null, ...r.map((c, k) => h('td', { style: style(k) }, ...inline(c))))))));
          }
        }
      };

      const source = h('textarea', { class: 'md-src', spellcheck: 'false', 'aria-label': 'Markdown source',
        onInput: () => { draft = source.value; title(); renderPreview(); status(); },
        onKeydown: (e: KeyboardEvent) => {
          if (e.key === 'Tab') { e.preventDefault(); source.setRangeText('  ', source.selectionStart, source.selectionEnd, 'end'); source.dispatchEvent(new Event('input')); }
        } });
      const outline = h('nav', { class: 'md-outline', 'aria-label': 'Outline' });
      const statusBar = h('div', { class: 'md-status' });
      const findInput = h('input', { class: 'md-find', type: 'search', placeholder: 'Find in document', 'aria-label': 'Find in document',
        onInput: () => { query = findInput.value.trim().toLowerCase(); renderPreview(); status(); const first = preview.querySelector('mark'); first?.scrollIntoView({ block: 'center' }); } });

      function renderPreview(): void {
        const blocks = parseMarkdown(text());
        clear(preview);
        preview.style.fontSize = `${prefs().zoom}%`;
        preview.classList.toggle('wide', prefs().wide);
        if (!blocks.length) preview.append(h('p', { class: 'md-empty' }, file() ? 'This file is empty. Switch to Split to start writing.' : `${current} no longer exists.`));
        else preview.append(...blocks.map(block));
        clear(outline);
        const hs = headings(blocks);
        outline.append(h('div', { class: 'md-outline-head' }, 'Outline'));
        if (!hs.length) outline.append(h('p', { class: 'md-empty' }, 'No headings'));
        const min = Math.min(...hs.map((x) => x.level));
        for (const x of hs) outline.append(h('button', { type: 'button', class: 'md-ol-item', style: `padding-left:${10 + (x.level - min) * 14}px`, title: x.text, onClick: () => scrollTo(x.id) }, x.text));
      }
      function status(): void {
        const t = text();
        const words = (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
        const hits = query ? preview.querySelectorAll('mark').length : 0;
        clear(statusBar);
        statusBar.append(...[
          h('span', null, `${words.toLocaleString()} words`), h('span', null, `${Math.max(1, Math.round(words / 220))} min read`), h('span', null, `${t.split('\n').length} lines`),
          query ? h('span', null, `${hits} match${hits === 1 ? '' : 'es'}`) : null,
          file()?.readOnly ? h('span', { class: 'md-ro' }, h('span', { class: 'mdl' }, '\uE72E'), 'Read-only') : null,
          h('span', { class: 'md-path', title: current }, current)].filter((x): x is HTMLSpanElement => !!x));
      }

      const tbtn = (icon: string, label: string, fn: () => void, opts: { on?: boolean; disabled?: boolean; text?: boolean } = {}): HTMLButtonElement =>
        h('button', { class: `md-tb ${opts.on ? 'on' : ''}`, type: 'button', title: label, 'aria-label': label, disabled: !!opts.disabled, onClick: fn }, h('span', { class: 'mdl' }, icon), opts.text ? label : null);

      function draw(): void {
        const p = prefs();
        const ro = !!file()?.readOnly;
        title();
        clear(host);
        source.value = text();
        source.readOnly = ro;
        const docs = store.world.files.filter((f) => !f.deleted && /\.md$/i.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
        const picker = h('select', { class: 'md-pick', 'aria-label': 'Open a Markdown file', onChange: () => navigate(picker.value) },
          ...docs.map((f) => h('option', { value: f.path, selected: f.path.toLowerCase() === current.toLowerCase() }, f.path.split('\\').pop()!)));
        const bar = h('div', { class: 'md-bar' },
          tbtn('\uE72B', 'Back', () => { const to = back.pop(); if (to) { fwd.push(current); current = to; draft = null; draw(); } }, { disabled: !back.length }),
          tbtn('\uE72A', 'Forward', () => { const to = fwd.pop(); if (to) { back.push(current); current = to; draft = null; draw(); } }, { disabled: !fwd.length }),
          picker,
          h('span', { class: 'md-sep' }),
          h('div', { class: 'md-seg', role: 'group', 'aria-label': 'View' },
            tbtn('\uE8A1', 'Preview', () => setPrefs({ view: 'preview' }), { on: p.view === 'preview', text: true }),
            tbtn('\uE89F', 'Split', () => setPrefs({ view: 'split' }), { on: p.view === 'split', text: true }),
            tbtn('\uE943', 'Source', () => setPrefs({ view: 'source' }), { on: p.view === 'source', text: true })),
          h('span', { class: 'md-sep' }),
          tbtn('\uE8FD', 'Outline', () => setPrefs({ outline: !p.outline }), { on: p.outline }),
          tbtn('\uE71F', 'Zoom out', () => setPrefs({ zoom: Math.max(60, p.zoom - 10) })),
          h('span', { class: 'md-zoom' }, `${p.zoom}%`),
          tbtn('\uE8A3', 'Zoom in', () => setPrefs({ zoom: Math.min(200, p.zoom + 10) })),
          tbtn('\uE740', p.wide ? 'Readable width' : 'Full width', () => setPrefs({ wide: !p.wide }), { on: p.wide }),
          h('span', { class: 'md-grow' }),
          findInput,
          tbtn('\uE74E', 'Save (Ctrl+S)', save, { disabled: draft === null || ro }),
          tbtn('\uE70F', 'Edit in Notepad', () => openApp(notepadApp(current))),
          tbtn('\uE8C8', 'Copy Markdown', () => { void navigator.clipboard?.writeText(text()).then(() => toast('Markdown copied', 'ok'), () => toast('Clipboard is not available', 'err')); }),
          tbtn('\uE749', 'Print', () => window.print()));
        const body = h('div', { class: `md-body view-${p.view} ${p.outline && p.view !== 'source' ? 'with-outline' : ''}` },
          p.outline && p.view !== 'source' ? outline : null,
          p.view !== 'preview' ? h('div', { class: 'md-pane md-edit' }, source) : null,
          p.view !== 'source' ? h('div', { class: 'md-pane md-view', 'data-keep-scroll': '' }, preview) : null);
        host.append(h('div', { class: 'mdv', onKeydown: (e: KeyboardEvent) => {
          const k = (e.key ?? '').toLowerCase();
          if (e.ctrlKey && k === 's') { e.preventDefault(); save(); }
          else if (e.ctrlKey && k === 'f') { e.preventDefault(); findInput.focus(); findInput.select(); }
          else if (e.ctrlKey && (k === '=' || k === '+')) { e.preventDefault(); setPrefs({ zoom: Math.min(200, p.zoom + 10) }); }
          else if (e.ctrlKey && k === '-') { e.preventDefault(); setPrefs({ zoom: Math.max(60, p.zoom - 10) }); }
          else if (e.ctrlKey && k === '0') { e.preventDefault(); setPrefs({ zoom: 100 }); }
          else if (e.altKey && k === 'arrowleft' && back.length) { e.preventDefault(); bar.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.click(); }
        } }, bar, body, statusBar));
        renderPreview();
        status();
      }

      onOpenArg(win, (p) => { if (p && p !== current) navigate(p); });
      draw();
      // Another app (Notepad, PowerShell) changed the file: show it, unless we hold unsaved edits.
      let seen = file()?.content;
      return { redraw: () => { const now = file()?.content; if (now !== seen) { seen = now; if (draft === null) { const top = preview.parentElement?.scrollTop ?? 0; draw(); if (preview.parentElement) preview.parentElement.scrollTop = top; } } } };
    },
  };
}
