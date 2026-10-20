/**
 * ui/sites/common.ts — the frame every in-range web app shares.
 */
import { h } from '../dom.ts';

export interface SiteCtx {
  path: string;
  go(path: string): void;
  /** Navigate to another site, e.g. "https://peoplehub.meridianhealth.test/worker/E100401". */
  open(url: string): void;
}

export interface Site {
  host: string;
  name: string;
  short: string;
  color: string;
  render(ctx: SiteCtx): HTMLElement;
}

export function shell(site: Pick<Site, 'name' | 'color'>, nav: [string, string][], ctx: SiteCtx, content: HTMLElement, note?: string): HTMLElement {
  return h('div', { class: 'site', style: `--brand:${site.color}` },
    h('div', { class: 'site-bar' }, h('strong', null, site.name), note ? h('span', { class: 'site-note' }, note) : null),
    h('div', { class: 'site-main' },
      nav.length ? h('nav', { class: 'site-nav', 'aria-label': `${site.name} navigation` }, nav.map(([label, path]) =>
        h('a', { href: '#', class: ctx.path === path || (path !== '/' && ctx.path.startsWith(path)) ? 'on' : '', onClick: (e: Event) => { e.preventDefault(); ctx.go(path); } }, label))) : null,
      h('div', { class: 'site-content', 'data-keep-scroll': '' }, content)));
}

export function link(label: string, fn: () => void): HTMLAnchorElement {
  return h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); e.stopPropagation(); fn(); } }, label);
}

export function kv(pairs: [string, unknown][]): HTMLElement {
  return h('dl', { class: 'kv' }, pairs.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v instanceof Node ? v : String(v ?? '—'))]));
}

export function empty(text: string): HTMLElement {
  return h('p', { class: 'empty' }, text);
}
