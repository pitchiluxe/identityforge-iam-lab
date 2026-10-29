/**
 * ui/sites/azure/frame.ts — what every lab Azure portal blade shares: the
 * signed-in tenant and account, the act() wrapper that runs as that account,
 * and small portal-style building blocks.
 */
import type { World } from '../../../core/types.ts';
import { h } from '../../dom.ts';
import { act, persist, store } from '../../store.ts';
import { allDomains, worldByDomain } from '../../companies.ts';
import type { SiteCtx } from '../common.ts';
import { sessionValid } from '../../azureSession.ts';
import { routePath, type Route } from './routes.ts';

export const MARKER = 'Meridian IAM Range training simulation — never type a real Microsoft password here.';

export interface PortalState {
  /** Signed-in account per tenant (by AD domain), and when it signed in. */
  sessions: Record<string, { upn: string; since: string }>;
  /** The directory on screen. */
  current: string;
}

export function portalState(): PortalState {
  const s = (store.settings.azurePortal ??= { sessions: {}, current: store.world.ad.domain });
  if (!allDomains().some((d) => d.domain === s.current)) s.current = store.world.ad.domain;
  // Sessions saved before they recorded a start time are dropped (sign in again).
  for (const [d, v] of Object.entries(s.sessions)) if (typeof v !== 'object' || !v?.upn) delete s.sessions[d];
  return s;
}

export interface Portal {
  ctx: SiteCtx;
  w: World;
  domain: string;
  /** Signed-in account in this tenant, or null. */
  upn: string | null;
  go(r: Route): void;
  /** Run a world change as the signed-in account in this tenant. */
  run(fn: (w: World, actor: string) => void, success?: string): boolean;
}

export function portal(ctx: SiteCtx): Portal {
  const st = portalState();
  const w = worldByDomain(st.current) ?? store.world;
  // Deleted, disabled or revoked accounts are signed out, as Entra ends their sessions.
  const sess = st.sessions[st.current];
  if (sess && !sessionValid(w, sess.upn, sess.since)) { delete st.sessions[st.current]; persist(); }
  const upn = st.sessions[st.current]?.upn ?? null;
  return {
    ctx, w, domain: st.current, upn,
    go: (r) => ctx.go(routePath(r)),
    run: (fn, success) => act((x) => fn(x, upn ?? ''), success, w),
  };
}

export function signOut(domain: string): void {
  delete portalState().sessions[domain];
  persist();
}

export function switchDirectory(domain: string): void {
  portalState().current = domain;
  persist();
}

/** A blade: title, optional subtitle, command bar, body. */
export function blade(title: string, sub: string | null, commands: HTMLElement[], ...body: (HTMLElement | null)[]): HTMLElement {
  return h('div', { class: 'az-blade' },
    h('div', { class: 'az-blade-head' }, h('h1', null, title), sub ? h('div', { class: 'az-blade-sub' }, sub) : null),
    commands.length ? h('div', { class: 'az-cmdbar', role: 'toolbar' }, commands) : null,
    h('div', { class: 'az-blade-body' }, body));
}

export function cmd(label: string, glyph: string, onClick: () => void, disabled = false): HTMLButtonElement {
  return h('button', { class: 'az-cmd', type: 'button', disabled, onClick }, h('span', { class: 'az-cmd-ic', 'aria-hidden': 'true' }, glyph), label);
}

/** A left-side menu inside a resource blade (Overview, Access control (IAM), ...). */
export function resourceMenu(items: [string, boolean, () => void][]): HTMLElement {
  return h('nav', { class: 'az-resmenu' }, items.map(([label, on, fn]) => h('a', { href: '#', class: on ? 'on' : '', onClick: (e: Event) => { e.preventDefault(); fn(); } }, label)));
}

export function input(attrs: Record<string, string> = {}): HTMLInputElement {
  return h('input', { class: 'input', ...attrs });
}

export function select(options: [string, string][], value = ''): HTMLSelectElement {
  return h('select', { class: 'input' }, options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

export function form(...rows: [string, HTMLElement][]): HTMLElement {
  return h('div', { class: 'az-form' }, rows.map(([label, control]) => h('label', { class: 'az-field' }, h('span', null, label), control)));
}

export function info(text: string): HTMLElement {
  return h('div', { class: 'az-info' }, h('span', { 'aria-hidden': 'true' }, 'ℹ'), h('span', null, text));
}
