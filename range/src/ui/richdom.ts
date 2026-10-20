/**
 * ui/richdom.ts — the rich-text editor shared by Word, PowerPoint and Sticky Notes.
 *
 * Editing uses the browser's contenteditable and execCommand (bold, lists,
 * alignment), which is what gives Word-like behaviour for free. What is kept
 * is never the HTML: readDoc() walks the DOM into core/office.ts's model, and
 * renderDoc() builds elements back from it with textContent and element.style.
 * Paste is plain text only, so markup from the clipboard never enters the page.
 */
import { type Align, type Para, type ParaStyle, type RichDoc, type Run, cleanDoc, normalizeRuns, safeColor, safeFont, safeSize } from '../core/office.ts';

const BLOCK_TAG: Record<ParaStyle, 'p' | 'h1' | 'h2' | 'h3' | 'blockquote' | 'li'> = { p: 'p', title: 'p', subtitle: 'p', h1: 'h1', h2: 'h2', h3: 'h3', quote: 'blockquote', ul: 'li', ol: 'li' };

function runEl(r: Run): HTMLElement {
  const s = document.createElement('span');
  s.textContent = r.text;
  if (r.b) s.style.fontWeight = '700';
  if (r.i) s.style.fontStyle = 'italic';
  const deco = [r.u ? 'underline' : '', r.s ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) s.style.textDecoration = deco;
  if (r.color) s.style.color = r.color;
  if (r.bg) s.style.backgroundColor = r.bg;
  if (r.size) s.style.fontSize = `${r.size}pt`;
  if (r.font) s.style.fontFamily = `'${r.font}'`;
  return s;
}

function paraEl(p: Para): HTMLElement {
  const el = document.createElement(BLOCK_TAG[p.style]);
  if (p.style === 'title' || p.style === 'subtitle') el.dataset.style = p.style;
  if (p.align) el.style.textAlign = p.align;
  if (p.runs.length) for (const r of p.runs) el.appendChild(runEl(r));
  else el.appendChild(document.createElement('br'));
  return el;
}

/** Build the DOM for a document: consecutive list paragraphs share one <ul>/<ol>. */
export function renderDoc(doc: RichDoc, into: HTMLElement): void {
  into.replaceChildren();
  let list: HTMLElement | null = null;
  let listKind: ParaStyle | null = null;
  for (const p of doc.paras) {
    if (p.style === 'ul' || p.style === 'ol') {
      if (!list || listKind !== p.style) { list = document.createElement(p.style); listKind = p.style; into.appendChild(list); }
      list.appendChild(paraEl(p));
    } else { list = null; listKind = null; into.appendChild(paraEl(p)); }
  }
}

// ------------------------------------------------------------------ reading the DOM back

const rgbToHex = (v: string): string | undefined => {
  if (!v || v === 'transparent') return undefined;
  if (v.startsWith('#')) return safeColor(v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(v);
  if (!m || m[4] === '0') return undefined;
  return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
};
const ptFrom = (v: string): number | undefined => {
  const m = /^([\d.]+)(px|pt)$/.exec(v.trim());
  if (!m) return undefined;
  return safeSize(m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1]));
};

type Fmt = Omit<Run, 'text'>;
function fmtOf(el: HTMLElement, base: Fmt): Fmt {
  const f: Fmt = { ...base };
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') f.b = true;
  if (tag === 'I' || tag === 'EM') f.i = true;
  if (tag === 'U') f.u = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.s = true;
  if (tag === 'FONT') {
    const c = rgbToHex(el.getAttribute('color') ?? ''); if (c) f.color = c;
    const face = safeFont(el.getAttribute('face')); if (face) f.font = face;
  }
  const st = el.style;
  if (st.fontWeight) { if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) f.b = true; else if (st.fontWeight === 'normal' || Number(st.fontWeight) < 600) delete f.b; }
  if (st.fontStyle) { if (st.fontStyle === 'italic') f.i = true; else delete f.i; }
  const deco = `${st.textDecoration} ${st.textDecorationLine}`;
  if (deco.includes('underline')) f.u = true;
  if (deco.includes('line-through')) f.s = true;
  const color = rgbToHex(st.color); if (color) f.color = color;
  const bg = rgbToHex(st.backgroundColor); if (bg) f.bg = bg;
  const size = ptFrom(st.fontSize); if (size) f.size = size;
  const font = safeFont(st.fontFamily); if (font) f.font = font;
  return f;
}

const isBlock = (el: Element): boolean => /^(P|DIV|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|LI|UL|OL|PRE)$/.test(el.tagName);

function styleOf(el: HTMLElement, list: ParaStyle | null): ParaStyle {
  if (el.tagName === 'LI') return list ?? 'ul';
  if (el.tagName === 'H1') return 'h1';
  if (el.tagName === 'H2') return 'h2';
  if (el.tagName === 'H3' || el.tagName === 'H4') return 'h3';
  if (el.tagName === 'BLOCKQUOTE') return 'quote';
  if (el.dataset.style === 'title' || el.dataset.style === 'subtitle') return el.dataset.style;
  return 'p';
}

export function readDoc(root: HTMLElement): RichDoc {
  const paras: Para[] = [];
  let cur: Para | null = null;
  const open = (style: ParaStyle, align?: string): Para => {
    const p: Para = { style, runs: [] };
    if (align === 'center' || align === 'right' || align === 'justify') p.align = align as Align;
    paras.push(p);
    return p;
  };
  const walk = (node: Node, fmt: Fmt, style: ParaStyle, list: ParaStyle | null, align: string): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/​/g, '');
      if (!text) return;
      cur ??= open(style, align);
      cur.runs.push({ ...fmt, text });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === 'BR') { if (cur && node.nextSibling) cur = open(cur.style, cur.align); else cur ??= open(style, align); return; }
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      cur = null;
      for (const c of node.childNodes) walk(c, fmt, style, node.tagName === 'UL' ? 'ul' : 'ol', align);
      cur = null;
      return;
    }
    if (isBlock(node)) {
      const s = node.tagName === 'DIV' && !node.dataset.style ? style : styleOf(node, list);
      const a = node.style.textAlign || node.getAttribute('align') || align;
      const mine = open(s, a);
      const at = paras.length - 1;
      cur = mine;
      const f = fmtOf(node, fmt);
      for (const c of node.childNodes) walk(c, f, s, list, a);
      // A block that only wrapped other blocks (Chrome puts <ul> inside <p>) is not a paragraph of its own.
      if (!mine.runs.length && paras.length > at + 1) paras.splice(at, 1);
      cur = null;
      return;
    }
    const f = fmtOf(node, fmt);
    for (const c of node.childNodes) walk(c, f, style, list, align);
  };
  for (const c of root.childNodes) walk(c, {}, 'p', null, '');
  for (const p of paras) p.runs = normalizeRuns(p.runs);
  return cleanDoc({ paras });
}

// ------------------------------------------------------------------ editor

export interface RichState { b: boolean; i: boolean; u: boolean; s: boolean; ul: boolean; ol: boolean; align: Align; style: ParaStyle; font: string; size: number }

export interface RichEditor {
  el: HTMLElement;
  get(): RichDoc;
  set(doc: RichDoc): void;
  exec(cmd: string, value?: string): void;
  setFont(font: string): void;
  setSize(pt: number): void;
  setStyle(style: ParaStyle): void;
  clearFormat(): void;
  state(): RichState;
  dispose(): void;
}

export function richEditor(opts: { cls: string; label: string; placeholder?: string; onChange: () => void; onSelection?: () => void }): RichEditor {
  const el = document.createElement('div');
  el.className = `rt ${opts.cls}`;
  el.contentEditable = 'true';
  el.spellcheck = true;
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-multiline', 'true');
  el.setAttribute('aria-label', opts.label);
  if (opts.placeholder) el.dataset.placeholder = opts.placeholder;
  const empty = (): void => { el.classList.toggle('rt-empty', !(el.textContent ?? '').trim() && !el.querySelector('li')); };

  el.addEventListener('input', () => { empty(); opts.onChange(); });
  // Plain text only: markup on the clipboard never reaches the page.
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
  });
  el.addEventListener('drop', (e) => { e.preventDefault(); const text = e.dataTransfer?.getData('text/plain'); if (text) document.execCommand('insertText', false, text); });
  el.addEventListener('keydown', (e) => {
    const k = (e.key ?? '').toLowerCase();
    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      const map: Record<string, string> = { b: 'bold', i: 'italic', u: 'underline', e: 'justifyCenter', l: 'justifyLeft', r: 'justifyRight', j: 'justifyFull' };
      if (map[k]) { e.preventDefault(); exec(map[k]!); }
    }
    if (e.ctrlKey && e.shiftKey && k === 'l') { e.preventDefault(); exec('insertUnorderedList'); }
    if (k === 'tab' && closestIn('LI')) { e.preventDefault(); exec(e.shiftKey ? 'outdent' : 'indent'); }
  });
  const onSel = (): void => { if (el.contains(document.getSelection()?.anchorNode ?? null)) opts.onSelection?.(); };
  document.addEventListener('selectionchange', onSel);

  function closestIn(tag: string): HTMLElement | null {
    let n: Node | null = document.getSelection()?.anchorNode ?? null;
    while (n && n !== el) { if (n instanceof HTMLElement && n.tagName === tag) return n; n = n.parentNode; }
    return null;
  }
  function block(): HTMLElement | null {
    let n: Node | null = document.getSelection()?.anchorNode ?? null;
    while (n && n !== el) { if (n instanceof HTMLElement && isBlock(n) && n.tagName !== 'UL' && n.tagName !== 'OL') return n; n = n.parentNode; }
    return null;
  }
  function exec(cmd: string, value?: string): void {
    el.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd, false, value);
    empty();
    opts.onChange();
    opts.onSelection?.();
  }
  /** execCommand's fontSize only knows 1-7: mark with 7, then swap in real point sizes. */
  function setSize(pt: number): void {
    el.focus();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontSize', false, '7');
    for (const f of el.querySelectorAll('font[size="7"]')) { const s = document.createElement('span'); s.style.fontSize = `${safeSize(pt) ?? 11}pt`; s.append(...f.childNodes); f.replaceWith(s); }
    for (const s of el.querySelectorAll<HTMLElement>('span[style*="xxx-large"]')) s.style.fontSize = `${safeSize(pt) ?? 11}pt`;
    opts.onChange();
    opts.onSelection?.();
  }
  function setStyle(style: ParaStyle): void {
    if (style === 'ul' || style === 'ol') { exec(style === 'ul' ? 'insertUnorderedList' : 'insertOrderedList'); return; }
    if (closestIn('LI')) exec(closestIn('UL') ? 'insertUnorderedList' : 'insertOrderedList');
    const tag = BLOCK_TAG[style];
    el.focus();
    document.execCommand('formatBlock', false, tag === 'li' ? 'p' : tag);
    const b = block();
    if (b) { if (style === 'title' || style === 'subtitle') b.dataset.style = style; else delete b.dataset.style; }
    empty();
    opts.onChange();
    opts.onSelection?.();
  }
  function state(): RichState {
    const q = (c: string): boolean => { try { return document.queryCommandState(c); } catch { return false; } };
    const b = block();
    const cs = b ? getComputedStyle(b) : null;
    const anchor = document.getSelection()?.anchorNode;
    const target = anchor instanceof HTMLElement ? anchor : anchor?.parentElement ?? null;
    const ts = target && el.contains(target) ? getComputedStyle(target) : null;
    const ta = cs?.textAlign ?? 'left';
    return {
      b: q('bold'), i: q('italic'), u: q('underline'), s: q('strikeThrough'),
      ul: !!closestIn('UL') && !!closestIn('LI'), ol: !!closestIn('OL') && !!closestIn('LI'),
      align: (ta === 'center' || ta === 'right' || ta === 'justify' ? ta : 'left') as Align,
      style: b ? styleOf(b, closestIn('OL') ? 'ol' : 'ul') : 'p',
      font: (ts && safeFont(ts.fontFamily)) ?? '',
      size: ts ? Math.round(parseFloat(ts.fontSize) * 0.75 * 2) / 2 : 11,
    };
  }

  const api: RichEditor = {
    el,
    get: () => readDoc(el),
    set: (doc) => { renderDoc(doc, el); empty(); },
    exec,
    setFont: (font) => exec('fontName', safeFont(font) ?? 'Aptos'),
    setSize,
    setStyle,
    clearFormat: () => { exec('removeFormat'); },
    state,
    dispose: () => document.removeEventListener('selectionchange', onSel),
  };
  return api;
}
