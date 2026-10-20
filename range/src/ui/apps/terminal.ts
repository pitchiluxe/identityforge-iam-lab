/**
 * ui/apps/terminal.ts — Windows Terminal.
 *
 * Tabs in the title bar, the new-tab dropdown with profiles (Windows
 * PowerShell, Command Prompt), split panes, find, zoom, rename/colour/
 * duplicate tabs, colour schemes and a Settings page, with the shortcuts
 * Windows Terminal uses. Each pane hosts the range's real shells.
 */
import { clear, h, toast } from '../dom.ts';
import { persist, store } from '../store.ts';
import { appIcon } from '../icons.ts';
import { type MenuEntry, showMenu } from '../ctxmenu.ts';
import type { AppDef, WinHandle } from '../wm.ts';
import { onOpenArg } from '../wm.ts';
import { mountPowerShell } from './tools.ts';
import { type ConsoleControl, mountCmd } from './console.ts';
import { homeDir } from '../../world/docs.ts';
import type { CmdShell } from '../../terminal/cmd.ts';

type Profile = 'powershell' | 'cmd';

export interface TerminalSettings {
  defaultProfile: Profile;
  scheme: string;
  fontSize: number;
  cursor: 'bar' | 'underscore' | 'block';
  acrylic: boolean;
}

const SCHEMES: Record<string, { bg: string; fg: string; err: string; sel: string }> = {
  'Campbell': { bg: '#0c0c0c', fg: '#cccccc', err: '#e74856', sel: '#264f78' },
  'Campbell Powershell': { bg: '#012456', fg: '#cccccc', err: '#e74856', sel: '#264f78' },
  'One Half Dark': { bg: '#282c34', fg: '#dcdfe4', err: '#e06c75', sel: '#3e4451' },
  'One Half Light': { bg: '#fafafa', fg: '#383a42', err: '#e45649', sel: '#cfd3dc' },
  'Tango Dark': { bg: '#000000', fg: '#d3d7cf', err: '#ef2929', sel: '#555753' },
  'Vintage': { bg: '#000000', fg: '#c0c0c0', err: '#ff0000', sel: '#404040' },
};

const DEFAULTS: TerminalSettings = { defaultProfile: 'powershell', scheme: 'Campbell', fontSize: 14, cursor: 'bar', acrylic: false };
const PROFILE_NAMES: Record<Profile, string> = { powershell: 'Windows PowerShell', cmd: 'Command Prompt' };

function settings(): TerminalSettings {
  return { ...DEFAULTS, ...(store.settings.terminal ?? {}) };
}

interface Pane {
  profile: Profile;
  el: HTMLElement;
  control: { focus(): void; output: HTMLElement; title(): string; dispose(): void };
}

interface Tab {
  title: string;
  custom: string | null;
  color: string | null;
  panes: Pane[];
  dir: 'row' | 'column';
  focused: number;
  zoom: number;
  el: HTMLElement;
}

let seq = 0;

/** Windows Terminal, opening the given profile (or running a batch file in Command Prompt). */
export function terminalWindow(opts: { profile?: Profile; batch?: string; cwd?: string } = {}): AppDef {
  return {
    id: opts.batch || opts.cwd ? `terminal:${++seq}` : 'terminal',
    title: 'Terminal',
    icon: 'terminal',
    width: 980,
    height: 600,
    customTitlebar: true,
    mount(host, win: WinHandle) {
      const tabs: Tab[] = [];
      let active = 0;
      const strip = h('div', { class: 'wt-tabs', role: 'tablist' });
      const body = h('div', { class: 'wt-body' });
      const findBar = h('div', { class: 'wt-find', hidden: true });
      const root = h('div', { class: 'wt' }, findBar, body);
      const winEl = win.titleSlot?.closest('.win') as HTMLElement | null;
      winEl?.classList.add('wt-win');
      win.titleSlot?.appendChild(strip);
      host.appendChild(root);

      const applyLook = (): void => {
        const s = settings();
        const sc = SCHEMES[s.scheme] ?? SCHEMES.Campbell!;
        root.style.setProperty('--wt-bg', sc.bg);
        root.style.setProperty('--wt-fg', sc.fg);
        root.style.setProperty('--wt-err', sc.err);
        root.style.setProperty('--wt-sel', sc.sel);
        root.dataset.cursor = s.cursor;
        root.dataset.acrylic = s.acrylic ? 'on' : 'off';
        for (const t of tabs) t.el.style.fontSize = `${Math.round(s.fontSize * t.zoom)}px`;
      };

      const pane = (profile: Profile, tab: Tab, extra: { batch?: string; cwd?: string } = {}): Pane => {
        const el = h('div', { class: 'wt-pane', onPointerdown: () => { tab.focused = tab.panes.findIndex((p) => p.el === el); markFocus(); } });
        const p: Pane = { profile, el, control: { focus: () => {}, output: el, title: () => PROFILE_NAMES[profile], dispose: () => {} } };
        const mountPs = (cwd?: string, onExit?: () => void): void => {
          clear(el);
          const ps = mountPowerShell(el, { onExit: onExit ?? (() => closePane(tab, p)), cwd });
          p.control = { focus: () => (el.querySelector('.ps-in') as HTMLInputElement | null)?.focus(), output: el.querySelector('.ps-out') as HTMLElement, title: () => 'Windows PowerShell', dispose: ps.dispose };
          drawTabs();
        };
        const mountCmdHere = (shell?: CmdShell, batch?: string): void => {
          clear(el);
          const c: ConsoleControl = mountCmd(el, {
            cwd: extra.cwd, batch, args: [], shell,
            onExit: () => closePane(tab, p),
            onTitle: () => drawTabs(),
            onSwitch: (sh) => mountPs(sh.cwd, () => mountCmdHere(sh)),
          });
          p.control = c;
          drawTabs();
        };
        if (profile === 'powershell') mountPs(extra.cwd);
        else mountCmdHere(undefined, extra.batch);
        return p;
      };

      const layout = (t: Tab): void => {
        clear(t.el);
        t.el.style.flexDirection = t.dir;
        t.panes.forEach((p, i) => {
          if (i) t.el.appendChild(h('div', { class: `wt-split ${t.dir}` }));
          t.el.appendChild(p.el);
        });
        markFocus();
      };

      const markFocus = (): void => {
        const t = tabs[active];
        if (!t) return;
        t.panes.forEach((p, i) => p.el.classList.toggle('focused', i === t.focused && t.panes.length > 1));
      };

      const newTab = (profile: Profile = settings().defaultProfile, extra: { batch?: string; cwd?: string } = {}, at = tabs.length): void => {
        const t: Tab = { title: '', custom: null, color: null, panes: [], dir: 'row', focused: 0, zoom: 1, el: h('div', { class: 'wt-tab-body' }) };
        t.panes.push(pane(profile, t, extra));
        tabs.splice(at, 0, t);
        active = at;
        layout(t);
        draw();
      };

      const split = (dir: 'row' | 'column', profile?: Profile): void => {
        const t = tabs[active]!;
        if (t.panes.length >= 4) return toast('Windows Terminal: a tab here holds up to four panes.');
        if (t.panes.length === 1) t.dir = dir;
        const p = pane(profile ?? t.panes[t.focused]!.profile, t);
        t.panes.splice(t.focused + 1, 0, p);
        t.focused += 1;
        layout(t);
        draw();
      };

      function closePane(t: Tab, p: Pane): void {
        p.control.dispose();
        t.panes.splice(t.panes.indexOf(p), 1);
        if (!t.panes.length) return closeTab(tabs.indexOf(t));
        t.focused = Math.min(t.focused, t.panes.length - 1);
        layout(t);
        draw();
      }

      function closeTab(i: number): void {
        const t = tabs[i];
        if (!t) return;
        for (const p of t.panes) p.control.dispose();
        tabs.splice(i, 1);
        if (!tabs.length) return win.close();
        active = Math.min(active, tabs.length - 1);
        draw();
      }

      const titleOf = (t: Tab): string => t.custom ?? t.panes[t.focused]?.control.title() ?? 'Terminal';

      function drawTabs(): void {
        clear(strip);
        tabs.forEach((t, i) => {
          const p = t.panes[t.focused]!;
          const el = h('div', { class: `wt-tab ${i === active ? 'on' : ''}`, role: 'tab', 'aria-selected': String(i === active), title: titleOf(t), style: t.color ? `--tab-color:${t.color}` : '',
            onMousedown: (e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } else if (e.button === 0 && i !== active) { active = i; draw(); } },
            onDblclick: () => rename(i),
            onContextmenu: (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); tabMenu(e, i); } },
            h('span', { class: `wt-prof ${p.profile}` }, p.profile === 'powershell' ? appIcon('powershell', 16) : appIcon('cmd', 16)),
            h('span', { class: 'wt-tab-title' }, titleOf(t)),
            h('button', { class: 'wt-tab-x', type: 'button', 'aria-label': 'Close tab', onMousedown: (e: MouseEvent) => e.stopPropagation(), onClick: (e: Event) => { e.stopPropagation(); closeTab(i); } }, ''));
          strip.appendChild(el);
        });
        strip.appendChild(h('button', { class: 'wt-new', type: 'button', title: `New tab (Ctrl+Shift+T)`, 'aria-label': 'New tab', onClick: () => newTab() }, ''));
        strip.appendChild(h('button', { class: 'wt-drop', type: 'button', title: 'Open a new tab', 'aria-label': 'Open a new tab', onClick: (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); showMenu(r.left, r.bottom + 2, dropdown()); } }, ''));
        win.setTitle(tabs[active] ? titleOf(tabs[active]!) : 'Terminal');
      }

      function draw(): void {
        drawTabs();
        clear(body);
        const t = tabs[active];
        if (t) { body.appendChild(t.el); applyLook(); markFocus(); setTimeout(() => t.panes[t.focused]?.control.focus(), 0); }
      }

      function dropdown(): MenuEntry[] {
        return [
          { label: 'Windows PowerShell', icon: '', shortcut: 'Ctrl+Shift+1', onClick: () => newTab('powershell') },
          { label: 'Command Prompt', icon: '', shortcut: 'Ctrl+Shift+2', onClick: () => newTab('cmd') },
          '-',
          { label: 'Settings', icon: '', shortcut: 'Ctrl+,', onClick: openSettings },
          { label: 'Command palette', icon: '', shortcut: 'Ctrl+Shift+P', onClick: palette },
          { label: 'About', icon: '', onClick: () => toast('Windows Terminal 1.21.2911.0') },
        ];
      }

      function tabMenu(e: MouseEvent, i: number): void {
        const colors = ['#e74856', '#ff8c00', '#fff100', '#16c60c', '#0078d7', '#886ce4', '#e3008c'];
        showMenu(e.clientX, e.clientY, [
          { label: 'Change tab color...', icon: '', submenu: [...colors.map((c): MenuEntry => ({ label: c, icon: '', onClick: () => { tabs[i]!.color = c; drawTabs(); } })), '-', { label: 'Reset', onClick: () => { tabs[i]!.color = null; drawTabs(); } }] },
          { label: 'Rename tab', icon: '', onClick: () => rename(i) },
          { label: 'Duplicate tab', icon: '', shortcut: 'Ctrl+Shift+D', onClick: () => newTab(tabs[i]!.panes[tabs[i]!.focused]!.profile, {}, i + 1) },
          { label: 'Split tab', icon: '', submenu: [{ label: 'Split right', shortcut: 'Alt+Shift+Plus', onClick: () => { active = i; split('row'); } }, { label: 'Split down', shortcut: 'Alt+Shift+Minus', onClick: () => { active = i; split('column'); } }] },
          '-',
          { label: 'Close tabs to the right', disabled: i === tabs.length - 1, onClick: () => { for (const t of tabs.splice(i + 1)) for (const p of t.panes) p.control.dispose(); active = Math.min(active, i); draw(); } },
          { label: 'Close other tabs', disabled: tabs.length === 1, onClick: () => { const keep = tabs[i]!; for (const t of tabs) if (t !== keep) for (const p of t.panes) p.control.dispose(); tabs.splice(0, tabs.length, keep); active = 0; draw(); } },
          { label: 'Close tab', icon: '', shortcut: 'Ctrl+Shift+W', onClick: () => closeTab(i) },
        ]);
      }

      function rename(i: number): void {
        const name = window.prompt('Rename tab', titleOf(tabs[i]!));
        if (name === null) return;
        tabs[i]!.custom = name.trim() || null;
        drawTabs();
      }

      function palette(): void {
        const actions: [string, () => void][] = [
          ['New tab', () => newTab()], ['New tab: Windows PowerShell', () => newTab('powershell')], ['New tab: Command Prompt', () => newTab('cmd')],
          ['Split pane right', () => split('row')], ['Split pane down', () => split('column')], ['Close pane', () => { const t = tabs[active]!; closePane(t, t.panes[t.focused]!); }],
          ['Find', openFind], ['Increase font size', () => zoom(0.1)], ['Decrease font size', () => zoom(-0.1)], ['Reset font size', () => zoom(0)],
          ['Open settings', openSettings], ['Rename tab', () => rename(active)], ['Duplicate tab', () => newTab(tabs[active]!.panes[tabs[active]!.focused]!.profile, {}, active + 1)],
        ];
        const r = root.getBoundingClientRect();
        showMenu(r.left + r.width / 2 - 180, r.top + 8, actions.map(([label, fn]): MenuEntry => ({ label, onClick: fn })));
      }

      function zoom(d: number): void {
        const t = tabs[active]!;
        t.zoom = d === 0 ? 1 : Math.max(0.6, Math.min(2.5, t.zoom + d));
        applyLook();
      }

      function openFind(): void {
        findBar.hidden = false;
        clear(findBar);
        const input = h('input', { placeholder: 'Find', 'aria-label': 'Find' });
        const count = h('span', { class: 'wt-find-count' });
        const run = (): void => {
          const t = tabs[active]!;
          const outEl = t.panes[t.focused]!.control.output;
          for (const m of outEl.querySelectorAll('.wt-hit')) m.classList.remove('wt-hit');
          if (!input.value) { count.textContent = ''; return; }
          const hits = [...outEl.querySelectorAll('.ps-line')].filter((l) => l.textContent!.toLowerCase().includes(input.value.toLowerCase()));
          hits.forEach((l) => l.classList.add('wt-hit'));
          count.textContent = `${hits.length} result${hits.length === 1 ? '' : 's'}`;
          hits.at(-1)?.scrollIntoView({ block: 'nearest' });
        };
        input.addEventListener('input', run);
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { findBar.hidden = true; input.value = ''; run(); tabs[active]?.panes[tabs[active]!.focused]?.control.focus(); } });
        findBar.append(input, count, h('button', { class: 'wt-ib', type: 'button', 'aria-label': 'Close', onClick: () => { findBar.hidden = true; input.value = ''; run(); } }, ''));
        input.focus();
      }

      function openSettings(): void {
        const s = settings();
        const save = (patch: Partial<TerminalSettings>): void => { store.settings.terminal = { ...s, ...(store.settings.terminal ?? {}), ...patch }; persist(); applyLook(); };
        const shield = h('div', { class: 'mm-shield', style: 'position:fixed;z-index:100000' });
        const close = (): void => shield.remove();
        const sel = (value: string, options: string[], fn: (v: string) => void): HTMLSelectElement => h('select', { class: 'input', onChange: (e: Event) => fn((e.target as HTMLSelectElement).value) }, options.map((o) => h('option', { value: o, selected: o === value }, o)));
        const row = (label: string, control: HTMLElement): HTMLElement => h('label', { class: 'wt-set-row' }, h('span', null, label), control);
        shield.appendChild(h('div', { class: 'wt-settings', role: 'dialog', 'aria-label': 'Terminal settings' },
          h('div', { class: 'wt-set-head' }, h('strong', null, 'Settings'), h('button', { class: 'wt-ib', type: 'button', 'aria-label': 'Close', onClick: close }, '')),
          h('h3', null, 'Startup'),
          row('Default profile', sel(PROFILE_NAMES[s.defaultProfile], Object.values(PROFILE_NAMES), (v) => save({ defaultProfile: v === 'Command Prompt' ? 'cmd' : 'powershell' }))),
          h('h3', null, 'Appearance'),
          row('Color scheme', sel(s.scheme, Object.keys(SCHEMES), (v) => save({ scheme: v }))),
          row('Font size', h('input', { class: 'input', type: 'number', min: '8', max: '32', value: String(s.fontSize), onChange: (e: Event) => save({ fontSize: Math.max(8, Math.min(32, Number((e.target as HTMLInputElement).value) || 14)) }) })),
          row('Cursor shape', sel(s.cursor, ['bar', 'underscore', 'block'], (v) => save({ cursor: v as TerminalSettings['cursor'] }))),
          row('Background acrylic', h('input', { type: 'checkbox', checked: s.acrylic, onChange: (e: Event) => save({ acrylic: (e.target as HTMLInputElement).checked }) })),
          h('div', { class: 'wt-set-foot' }, h('button', { class: 'btn primary', type: 'button', onClick: close }, 'Done'))));
        document.body.appendChild(shield);
      }

      // Shortcuts: active whenever this window is the active one.
      const onKey = (e: KeyboardEvent): void => {
        if (!winEl?.classList.contains('active') || !winEl.isConnected) return;
        const k = (e.key ?? "").toLowerCase();
        const t = tabs[active];
        let handled = true;
        if (e.ctrlKey && e.shiftKey && k === 't') newTab();
        else if (e.ctrlKey && e.shiftKey && (k === '1' || k === '!')) newTab('powershell');
        else if (e.ctrlKey && e.shiftKey && (k === '2' || k === '@')) newTab('cmd');
        else if (e.ctrlKey && e.shiftKey && k === 'w' && t) closePane(t, t.panes[t.focused]!);
        else if (e.ctrlKey && e.shiftKey && k === 'd' && t) newTab(t.panes[t.focused]!.profile, {}, active + 1);
        else if (e.ctrlKey && e.shiftKey && k === 'f') openFind();
        else if (e.ctrlKey && e.shiftKey && k === 'p') palette();
        else if (e.ctrlKey && e.shiftKey && k === 'c') { const sel = window.getSelection()?.toString(); if (sel) void navigator.clipboard?.writeText(sel).catch(() => undefined); }
        else if (e.ctrlKey && e.shiftKey && k === 'v') { const input = t?.panes[t.focused]?.el.querySelector('.ps-in') as HTMLInputElement | null; navigator.clipboard?.readText().then((x) => { if (input) { input.value += x.replace(/\r?\n/g, ' '); input.focus(); } }).catch(() => undefined); }
        else if (e.ctrlKey && k === ',') openSettings();
        else if (e.ctrlKey && k === 'tab' && tabs.length > 1) { active = (active + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length; draw(); }
        else if (e.ctrlKey && e.altKey && /^[1-9]$/.test(k)) { active = Math.min(tabs.length - 1, Number(k) - 1); draw(); }
        else if (e.ctrlKey && !e.shiftKey && (k === '=' || k === '+')) zoom(0.1);
        else if (e.ctrlKey && !e.shiftKey && k === '-') zoom(-0.1);
        else if (e.ctrlKey && !e.shiftKey && k === '0') zoom(0);
        else if (e.altKey && e.shiftKey && (k === '+' || k === '=')) split('row');
        else if (e.altKey && e.shiftKey && (k === '-' || k === '_')) split('column');
        else if (e.altKey && e.shiftKey && k === 'd') split(tabs[active]?.dir ?? 'row');
        else if (e.altKey && !e.shiftKey && /^arrow/.test(k) && t && t.panes.length > 1) { t.focused = (t.focused + (/(right|down)/.test(k) ? 1 : t.panes.length - 1)) % t.panes.length; markFocus(); t.panes[t.focused]!.control.focus(); }
        else handled = false;
        if (handled) { e.preventDefault(); e.stopPropagation(); }
      };
      document.addEventListener('keydown', onKey, true);
      root.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 0.1 : -0.1); } }, { passive: false });
      // Windows Terminal: right-click copies a selection, or pastes.
      root.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sel = window.getSelection()?.toString() ?? '';
        if (sel) { void navigator.clipboard?.writeText(sel).catch(() => undefined); window.getSelection()?.removeAllRanges(); return; }
        const t = tabs[active];
        const input = t?.panes[t.focused]?.el.querySelector('.ps-in') as HTMLInputElement | null;
        navigator.clipboard?.readText().then((x) => { if (input) { input.value += x.replace(/\r?\n/g, ' '); input.focus(); } }).catch(() => input?.focus());
      }, true);

      onOpenArg(win, (arg) => { if (arg === 'cmd' || arg === 'powershell') newTab(arg); });
      newTab(opts.batch ? 'cmd' : opts.profile ?? (win.arg === 'cmd' ? 'cmd' : win.arg === 'powershell' ? 'powershell' : settings().defaultProfile), { batch: opts.batch, cwd: opts.cwd ?? (opts.batch ? opts.batch.slice(0, opts.batch.lastIndexOf('\\')) : undefined) });
      return { dispose: () => { document.removeEventListener('keydown', onKey, true); for (const t of tabs) for (const p of t.panes) p.control.dispose(); } };
    },
  };
}

export const terminalApp: AppDef = terminalWindow();

/** Run a batch file the way a double-click does on Windows 11: in Terminal. */
export function batchWindow(path: string): AppDef {
  return terminalWindow({ batch: path });
}

export const DEFAULT_CWD = (): string => homeDir(store.world);
