/**
 * ui/dom.ts — a tiny element builder.
 *
 * Text is always set with textContent, never innerHTML, so ticket text,
 * file contents and model output can never inject markup.
 */
type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
      else if (k === 'checked' && 'checked' in el) (el as HTMLInputElement).checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function button(label: string, onClick: () => void, cls = 'btn', title?: string): HTMLButtonElement {
  return h('button', { class: cls, type: 'button', onClick: (e: Event) => { e.stopPropagation(); onClick(); }, title }, label);
}

let toastHost: HTMLElement | null = null;
/** Settings > Notifications. Errors still show: they explain why an action failed. */
export const toastPrefs = { muted: false };
/** Set by ui/system.ts: records the notification and decides whether it pops up. */
let toastHook: ((message: string, kind: 'ok' | 'err' | 'info') => boolean) | null = null;
export function setToastHook(fn: (message: string, kind: 'ok' | 'err' | 'info') => boolean): void {
  toastHook = fn;
}
export function toast(message: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  if (toastHook && !toastHook(message, kind)) return;
  if (!toastHook && toastPrefs.muted && kind !== 'err') return;
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const t = h('div', { class: `toast toast-${kind}` }, message);
  toastHost.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
}

/** A small, safe Markdown renderer for policies: headings, lists, bold, code. */
export function markdown(src: string): HTMLElement {
  const root = h('div', { class: 'md' });
  let list: HTMLElement | null = null;
  const inline = (text: string): Child[] => {
    const out: Child[] = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
      out.push(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith('**')) out.push(h('strong', null, tok.slice(2, -2)));
      else if (tok.startsWith('`')) out.push(h('code', null, tok.slice(1, -1)));
      else out.push(h('em', null, tok.slice(1, -1)));
      last = (m.index ?? 0) + tok.length;
    }
    out.push(text.slice(last));
    return out;
  };
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      if (!list) { list = h(/^\s*\d/.test(line) ? 'ol' : 'ul'); root.appendChild(list); }
      list.appendChild(h('li', null, inline(li[1]!)));
      continue;
    }
    list = null;
    if (!line) continue;
    const hd = /^(#{1,3})\s+(.*)$/.exec(line);
    if (hd) root.appendChild(h(`h${hd[1]!.length + 1}` as 'h2', null, inline(hd[2]!)));
    else if (line.startsWith('> ')) root.appendChild(h('blockquote', null, inline(line.slice(2))));
    else root.appendChild(h('p', null, inline(line)));
  }
  return root;
}

export function badge(text: string, kind = ''): HTMLSpanElement {
  return h('span', { class: `badge ${kind}` }, text);
}

export function field(label: string, control: HTMLElement): HTMLLabelElement {
  return h('label', { class: 'field' }, h('span', null, label), control);
}

export function table(headers: string[], rows: Child[][], onRow?: (i: number) => void, selected?: number): HTMLTableElement {
  return h('table', { class: 'grid' },
    h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))),
    h('tbody', null, rows.map((r, i) => h('tr', { class: [onRow ? 'clickable' : '', selected === i ? 'sel' : ''].join(' '), onClick: onRow ? () => onRow(i) : undefined, tabindex: onRow ? '0' : undefined, onKeydown: onRow ? (e: KeyboardEvent) => { if (e.key === 'Enter') onRow(i); } : undefined }, r.map((c) => h('td', null, c))))),
  );
}
