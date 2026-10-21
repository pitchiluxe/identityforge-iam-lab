/**
 * ui/wm.ts — Windows 11 windows on the desktop.
 *
 * Each app supplies a mount function. Windows redraw when the world changes,
 * except while you are typing in them, so a background sync never eats a
 * half-written work note.
 */
import { h, clear } from './dom.ts';
import { subscribe } from './store.ts';
import { type AppIcon, appIcon } from './icons.ts';
import { showMenu } from './ctxmenu.ts';
import { showLabels } from '../core/taskbar.ts';
import { taskbarPrefs } from './taskbarPrefs.ts';

export interface AppDef {
  id: string;
  title: string;
  icon: AppIcon;
  mount(host: HTMLElement, win: WinHandle): { redraw?: () => void; dispose?: () => void } | void;
  width?: number;
  height?: number;
  /** Pinned apps keep a taskbar button while closed. */
  pinned?: boolean;
  /** The app draws into the title bar (Chrome's tabs). */
  customTitlebar?: boolean;
  /** Not a window (Screen Pen): Start and the taskbar call this instead of opening one. */
  launch?: () => void;
}

export interface WinHandle {
  id: string;
  setTitle(t: string): void;
  close(): void;
  focus(): void;
  arg?: string;
  /** For customTitlebar apps: where to put title-bar content. */
  titleSlot?: HTMLElement;
}

interface Win {
  id: string;
  app: AppDef;
  el: HTMLElement;
  titleEl: HTMLElement;
  minimized: boolean;
  maximized: boolean;
  redraw?: () => void;
  dispose?: () => void;
  dirty: boolean;
  unsub: () => void;
  handle: WinHandle;
}

const wins: Win[] = [];
let z = 10;
let seq = 0;
let desk: HTMLElement;
let taskbar: HTMLElement;
let pinned: AppDef[] = [];
const openHandlers = new Map<string, (arg?: string) => void>();
let pinToggle: (app: AppDef) => void = () => {};

/** Replace the pinned apps (Pin to taskbar / Unpin from taskbar). */
export function setPinned(pins: AppDef[]): void {
  pinned = pins;
  drawTaskbar();
}

export function setPinToggle(fn: (app: AppDef) => void): void {
  pinToggle = fn;
}

export function isPinned(id: string): boolean {
  return pinned.some((p) => p.id === id);
}

export function initWm(desktop: HTMLElement, tasks: HTMLElement, pins: AppDef[]): void {
  desk = desktop;
  taskbar = tasks;
  pinned = pins;
  drawTaskbar();
}

function mobile(): boolean {
  return window.matchMedia('(max-width: 760px)').matches;
}

function activeWin(): Win | undefined {
  return [...wins].filter((w) => !w.minimized).sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex))[0];
}

/** Windows 11 taskbar: pinned apps first, then other running apps; a pill under running ones. */
export function drawTaskbar(): void {
  if (!taskbar) return;
  clear(taskbar);
  const top = activeWin();
  const ids = [...new Set([...pinned.map((p) => p.id), ...wins.map((w) => w.app.id).filter((id) => !pinned.some((p) => p.id === id))])];
  // Combine taskbar buttons and hide labels: with labels, every window gets its own button.
  const labels = showLabels(taskbarPrefs().combine, ids.length + Math.max(0, wins.length - new Set(wins.map((w) => w.app.id)).size));
  taskbar.classList.toggle('labels', labels);
  for (const id of ids) {
    const app = pinned.find((p) => p.id === id) ?? wins.find((w) => w.app.id === id)!.app;
    const running = wins.filter((w) => w.app.id === id);
    const groups: (Win | null)[] = labels && running.length ? running : [running[0] ?? null];
    for (const one of groups) {
      const mine = one ? [one] : running;
      const isActive = !!top && (labels && one ? top === one : top.app.id === id);
      const label = (one ?? running[0])?.titleEl.textContent || app.title;
      taskbar.appendChild(h('button', {
        class: `tb-app ${mine.length ? 'running' : ''} ${isActive ? 'active' : ''}`, type: 'button', title: label, 'aria-label': app.title,
        onClick: () => {
          if (!mine.length) return openApp(app);
          const w = mine[0]!;
          if (isActive && !w.minimized) minimize(w);
          else focusWin(w);
        },
        onAuxclick: (e: MouseEvent) => { if (e.button === 1) openApp(app, undefined, false); },
        onContextmenu: (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          showMenu(e.clientX, e.clientY, [
            ...running.slice(0, 6).map((w) => ({ label: w.titleEl.textContent || app.title, onClick: () => focusWin(w) })),
            ...(running.length ? ['-' as const] : []),
            { label: app.title.replace('Administrator: ', ''), bold: true, onClick: () => openApp(app, undefined, false) },
            { label: isPinned(app.id) ? 'Unpin from taskbar' : 'Pin to taskbar', icon: isPinned(app.id) ? '' : '', onClick: () => pinToggle(app) },
            ...(mine.length ? [{ label: mine.length > 1 ? 'Close all windows' : 'Close window', icon: '', onClick: () => { for (const w of mine) close(w); } }] : []),
          ]);
        },
      }, appIcon(app.icon, 24), labels && mine.length ? h('span', { class: 'tb-label' }, label) : null));
    }
  }
}

/** The open windows, for Task Manager and Task view. */
export function windowList(): { id: string; appId: string; title: string; icon: AppIcon; minimized: boolean; active: boolean }[] {
  const top = activeWin();
  return wins.map((w) => ({ id: w.id, appId: w.app.id, title: w.titleEl.textContent || w.app.title, icon: w.app.icon, minimized: w.minimized, active: w === top }));
}

export function focusWindow(id: string): void {
  const w = wins.find((x) => x.id === id);
  if (w) focusWin(w);
}

/** End task: the window closes without asking, as Task Manager does. */
export function closeWindow(id: string): void {
  const w = wins.find((x) => x.id === id);
  if (w) close(w);
}

/** Task view (Win+Tab): every open window as a card; click one to switch, Esc to leave. */
export function toggleTaskView(): void {
  const existing = document.querySelector('.task-view');
  if (existing) { existing.remove(); return; }
  const host = document.querySelector('.workstation');
  if (!host) return;
  const leave = (): void => { view.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); leave(); } };
  const cards = windowList();
  const view = h('div', { class: 'task-view', role: 'dialog', 'aria-label': 'Task view', onClick: (e: Event) => { if (e.target === view) leave(); } },
    h('div', { class: 'tv-grid' },
      cards.length ? cards.map((c) => h('div', { class: `tv-card ${c.active ? 'on' : ''}` },
        h('div', { class: 'tv-head' }, appIcon(c.icon, 16), h('span', { class: 'tv-title' }, c.title),
          h('button', { class: 'tv-x', type: 'button', title: 'Close', 'aria-label': `Close ${c.title}`, onClick: (e: Event) => { e.stopPropagation(); closeWindow(c.id); leave(); toggleTaskView(); } }, '')),
        h('button', { class: 'tv-thumb', type: 'button', 'aria-label': `Switch to ${c.title}`, onClick: () => { focusWindow(c.id); leave(); } }, appIcon(c.icon, 48), c.minimized ? h('span', { class: 'tv-min' }, 'Minimized') : null)))
        : h('p', { class: 'tv-empty' }, 'No open windows')),
    h('div', { class: 'tv-desktops' }, h('div', { class: 'tv-desk on' }, h('span', null, 'Desktop 1'))));
  host.appendChild(view);
  document.addEventListener('keydown', onKey, true);
}

function focusWin(win: Win): void {
  win.el.style.zIndex = String(++z);
  if (win.minimized) { win.minimized = false; win.el.hidden = false; }
  for (const x of wins) x.el.classList.toggle('active', x === win);
  drawTaskbar();
}

export function openApp(app: AppDef, arg?: string, single = true): void {
  if (app.launch) { app.launch(); return; }
  const existing = wins.find((x) => x.app.id === app.id);
  if (existing && single) {
    focusWin(existing);
    if (arg) openHandlers.get(existing.id)?.(arg);
    return;
  }
  const id = `win-${++seq}`;
  const titleEl = h('span', { class: 'win-title', hidden: app.customTitlebar }, app.title);
  const titleSlot = h('div', { class: 'win-slot', hidden: !app.customTitlebar });
  const body = h('div', { class: 'win-body' });
  const btn = (label: string, glyphChar: string, cls: string, fn: () => void): HTMLButtonElement =>
    h('button', { class: `cap ${cls}`, type: 'button', title: label, 'aria-label': label, tabIndex: -1,
      // Caption buttons never take focus from the app, as on Windows: the next key goes to the app.
      onMousedown: (e: Event) => e.preventDefault(),
      onClick: (e: Event) => { e.stopPropagation(); fn(); } }, glyphChar);
  const el = h('section', { class: 'win', role: 'dialog', 'aria-label': app.title },
    h('header', { class: 'win-bar' },
      app.customTitlebar ? null : h('span', { class: 'win-icon' }, appIcon(app.icon, 16)), titleEl, titleSlot,
      h('span', { class: 'win-caps' },
        btn('Minimize', '', 'min', () => minimize(win)),
        btn('Maximize', '', 'max', () => toggleMax(win)),
        btn('Close', '', 'close', () => close(win)))),
    body);
  const left = mobile() ? 0 : 128;
  const width = Math.min(app.width ?? 900, desk.clientWidth - left - 16);
  const height = Math.min(app.height ?? 600, desk.clientHeight - 24);
  const offset = (wins.length % 6) * 30;
  Object.assign(el.style, { width: `${width}px`, height: `${height}px`, left: `${left + offset}px`, top: `${12 + offset}px` });
  const handle: WinHandle = { id, arg, titleSlot, setTitle: (t) => { titleEl.textContent = t; }, close: () => close(win), focus: () => focusWin(win) };
  const win: Win = { id, app, el, titleEl, minimized: false, maximized: mobile(), dirty: false, unsub: () => {}, handle };
  if (win.maximized) el.classList.add('max');
  desk.appendChild(el);
  wins.push(win);
  el.addEventListener('pointerdown', () => { if (!el.classList.contains('active')) focusWin(win); });
  drag(win);
  const r = app.mount(body, handle) ?? {};
  win.redraw = r.redraw;
  win.dispose = r.dispose;
  win.unsub = subscribe(() => {
    if (!win.redraw) return;
    if (el.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement!.tagName)) { win.dirty = true; return; }
    win.redraw();
  });
  el.addEventListener('focusout', () => {
    setTimeout(() => {
      if (win.dirty && !el.contains(document.activeElement)) { win.dirty = false; win.redraw?.(); }
    }, 0);
  });
  el.classList.add('opening');
  setTimeout(() => el.classList.remove('opening'), 180);
  focusWin(win);
}

export function onOpenArg(win: WinHandle, fn: (arg?: string) => void): void {
  openHandlers.set(win.id, fn);
}

function minimize(win: Win): void {
  win.minimized = true;
  win.el.hidden = true;
  win.el.classList.remove('active');
  const next = activeWin();
  if (next) next.el.classList.add('active');
  drawTaskbar();
}

function toggleMax(win: Win): void {
  win.maximized = !win.maximized;
  win.el.classList.toggle('max', win.maximized);
}

function close(win: Win): void {
  win.unsub();
  win.dispose?.();
  win.el.remove();
  openHandlers.delete(win.id);
  wins.splice(wins.indexOf(win), 1);
  const next = activeWin();
  if (next) focusWin(next);
  else drawTaskbar();
}

export function closeAll(): void {
  for (const w of [...wins]) close(w);
}

/** Minimize every open window to the taskbar (startup apps after sign-in). */
export function minimizeAll(): void {
  for (const w of wins) if (!w.minimized) minimize(w);
}

function drag(win: Win): void {
  const bar = win.el.querySelector('.win-bar') as HTMLElement;
  bar.addEventListener('dblclick', (e) => { if (!(e.target as HTMLElement).closest('button')) toggleMax(win); });
  bar.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button') || win.maximized || e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    const left = win.el.offsetLeft, top = win.el.offsetTop;
    bar.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      win.el.style.left = `${Math.max(-win.el.offsetWidth + 120, Math.min(desk.clientWidth - 120, left + ev.clientX - startX))}px`;
      win.el.style.top = `${Math.max(0, Math.min(desk.clientHeight - 40, top + ev.clientY - startY))}px`;
    };
    const up = (ev: PointerEvent): void => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      // Drag to the top edge to maximise, as on Windows.
      if (ev.clientY <= 2) toggleMax(win);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
}
