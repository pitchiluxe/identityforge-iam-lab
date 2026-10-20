/**
 * ui/ctxmenu.ts — the Windows 11 context menu, used by the desktop, taskbar,
 * File Explorer, text boxes and the browser.
 *
 * The browser's own context menu is suppressed across the workstation, as a
 * real desktop would never show it; text boxes get Windows' Cut/Copy/Paste.
 */
import { h } from './dom.ts';

export interface MenuItem {
  label: string;
  /** Segoe Fluent Icons glyph. */
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  bold?: boolean;
  checked?: boolean;
  submenu?: MenuEntry[];
  onClick?: () => void;
}
export type MenuEntry = MenuItem | '-';

let open: HTMLElement[] = [];

export function closeMenus(): void {
  for (const m of open) m.remove();
  open = [];
}

function build(items: MenuEntry[], x: number, y: number, level: number): HTMLElement {
  const menu = h('div', { class: 'cm', role: 'menu' });
  for (const it of items) {
    if (it === '-') { menu.appendChild(h('div', { class: 'cm-sep', role: 'separator' })); continue; }
    const row = h('button', { class: `cm-item ${it.bold ? 'bold' : ''}`, type: 'button', role: 'menuitem', disabled: it.disabled },
      h('span', { class: 'cm-icon mdl' }, it.checked ? '' : it.icon ?? ''),
      h('span', { class: 'cm-label' }, it.label),
      h('span', { class: 'cm-key' }, it.submenu ? '' : it.shortcut ?? ''));
    if (it.submenu) {
      row.classList.add('has-sub');
      const showSub = (): void => {
        for (const m of open.slice(level + 1)) m.remove();
        open = open.slice(0, level + 1);
        const r = row.getBoundingClientRect();
        const sub = build(it.submenu!, r.right - 4, r.top - 4, level + 1);
        document.body.appendChild(sub);
        place(sub, r.right - 4, r.top - 4, r.left);
        open.push(sub);
      };
      row.addEventListener('mouseenter', showSub);
      row.addEventListener('click', (e) => { e.stopPropagation(); showSub(); });
    } else {
      row.addEventListener('mouseenter', () => { for (const m of open.slice(level + 1)) m.remove(); open = open.slice(0, level + 1); });
      row.addEventListener('click', (e) => { e.stopPropagation(); if (it.disabled) return; closeMenus(); it.onClick?.(); });
    }
    menu.appendChild(row);
  }
  void x; void y;
  return menu;
}

function place(menu: HTMLElement, x: number, y: number, flipX?: number): void {
  const r = menu.getBoundingClientRect();
  let left = x, top = y;
  if (left + r.width > window.innerWidth - 4) left = flipX !== undefined ? flipX - r.width + 4 : window.innerWidth - r.width - 4;
  if (top + r.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${top}px`;
}

export function showMenu(x: number, y: number, items: MenuEntry[]): void {
  closeMenus();
  const menu = build(items, x, y, 0);
  document.body.appendChild(menu);
  place(menu, x, y);
  open = [menu];
  (menu.querySelector('.cm-item:not([disabled])') as HTMLElement | null)?.focus({ preventScroll: true });
}

/** Cut/Copy/Paste for text boxes, as Windows shows it. */
function textMenu(el: HTMLInputElement | HTMLTextAreaElement): MenuEntry[] {
  const sel = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  const ro = el.readOnly || el.disabled;
  const insert = (text: string): void => {
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
    el.setRangeText(text, s, e, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return [
    { label: 'Undo', icon: '', shortcut: 'Ctrl+Z', disabled: ro, onClick: () => { el.focus(); document.execCommand('undo'); } },
    '-',
    { label: 'Cut', icon: '', shortcut: 'Ctrl+X', disabled: ro || !sel, onClick: () => { void navigator.clipboard?.writeText(sel).catch(() => undefined); insert(''); } },
    { label: 'Copy', icon: '', shortcut: 'Ctrl+C', disabled: !sel, onClick: () => { void navigator.clipboard?.writeText(sel).catch(() => undefined); } },
    { label: 'Paste', icon: '', shortcut: 'Ctrl+V', disabled: ro, onClick: () => { el.focus(); navigator.clipboard?.readText().then(insert).catch(() => document.execCommand('paste')); } },
    { label: 'Delete', icon: '', disabled: ro || !sel, onClick: () => insert('') },
    '-',
    { label: 'Select All', icon: '', shortcut: 'Ctrl+A', onClick: () => { el.focus(); el.select(); } },
  ];
}

/** Install once: close on outside click / Escape, own every right-click. */
export function installContextMenus(): void {
  document.addEventListener('pointerdown', (e) => { if (!open.some((m) => m.contains(e.target as Node))) closeMenus(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
  window.addEventListener('blur', closeMenus);
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    if (e.defaultPrevented) return;
    e.preventDefault();
    const field = t.closest('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    if (field) showMenu(e.clientX, e.clientY, textMenu(field));
  });
}
